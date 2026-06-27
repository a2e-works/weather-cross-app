// --- Radar Controller using Leaflet and JMA (気象庁) 高解像度降水ナウキャスト ---
// radar.js version: v2.3 (2026-06-26)
// 変更内容: 背景マップを暗いテーマ(dark_all)から薄いテーマ(light_all)に変更し、降水ナウキャストの
//          薄い雨が暗い背景に埋もれて見えなくなる問題を解消。雨雲レイヤーの透明度も0.65→0.85に。
//          また「表示時刻」がUTC基準のまま表示され日本時間と9時間ズレていたバグを修正
//          （Date.UTC()で明示的にUTCとして解釈し、ブラウザのローカル時刻＝日本時間に変換）
//          ※v2.2: 30分後・1時間後の予報が見つからないことがあるバグを修正。実況(N1)の最新基準時刻と
//          予報(N2)の更新タイミングがごくわずかにズレることがあり、突き合わせに失敗していたため、
//          N2データ自身が持つ最新の基準時刻を信頼するよう変更（レースコンディション対策）
//          ※v2.1: 初期表示のズームレベルを10→12に変更（2段階拡大表示）
//          ※v2.0: 気象庁の実際のナウキャストAPI（jmatile/data/nowc）に全面修正
//          （旧コードは存在しないURL（jmaradar/data/radar）を使っていたため常に表示されなかった）
//          ナウキャストの予報範囲は60分先までのため「3時間後」は廃止し、現在/30分後/1時間後の3点に変更
class RadarManager {
  constructor() {
    this.map = null;
    this.radarLayers = {}; // { timeIndex: TileLayer }
    this.activeTimeIndex = 0;
    this.isPlaying = false;
    this.playInterval = null;
    this.timeIndexMap = {}; // { timeIndex: { basetime, validtime } } 表示時刻の文字列用
    this.currentLatLng = [35.6895, 139.6917]; // デフォルト東京
    this.locationMarker = null;

    // DOM Elements
    this.modal = document.getElementById('radar-modal');
    this.closeBtn = document.getElementById('radar-close-btn');
    this.slider = document.getElementById('radar-time-slider');
    this.playBtn = document.getElementById('radar-play-btn');
    this.timeDisplay = document.getElementById('radar-time-display');
    this.sliderLabels = document.querySelectorAll('.slider-labels span');

    this.initEvents();
  }

  initEvents() {
    // モーダル閉じる
    this.closeBtn.addEventListener('click', () => this.hide());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.hide();
    });

    // スライダー操作
    this.slider.addEventListener('input', (e) => {
      this.setTimeIndex(parseInt(e.target.value));
    });

    // 再生ボタン
    this.playBtn.addEventListener('click', () => this.togglePlay());

    // スライダーのラベルクリック
    this.sliderLabels.forEach(label => {
      label.addEventListener('click', () => {
        const index = parseInt(label.getAttribute('data-index'));
        this.setTimeIndex(index);
      });
    });
  }

  async show(lat, lng) {
    if (lat && lng) {
      this.currentLatLng = [lat, lng];
    }

    this.modal.classList.add('show');

    // 地図の初期化（初回のみ）
    if (!this.map) {
      this.initMap();
    } else {
      this.map.invalidateSize();
      this.map.setView(this.currentLatLng, 12);
    }

    // マーカーの更新
    this.updateMarker();

    // 気象庁の最新の時刻情報を取得し、レイヤーを準備
    await this.loadRadarLayers();
  }

  hide() {
    this.stopPlay();
    this.modal.classList.remove('show');
  }

  initMap() {
    // 地図の作成
    // ※以前はダークテーマ(dark_all)を使用していたが、降水ナウキャストのタイルは
    //   薄い降水(水色)が暗い背景では非常に見えにくくなるため、気象庁公式サイトに近い
    //   薄い色調の地図(light_all)に変更し、雨雲の視認性を確保する
    this.map = L.map('radar-map', {
      zoomControl: true,
      minZoom: 5,
      maxZoom: 18
    }).setView(this.currentLatLng, 12);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);
  }

  updateMarker() {
    if (this.locationMarker) {
      this.locationMarker.setLatLng(this.currentLatLng);
    } else {
      const redIcon = L.divIcon({
        html: '<i class="fa-solid fa-location-dot" style="color: #ff007f; font-size: 24px; text-shadow: 0 0 10px rgba(255,0,127,0.5);"></i>',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        className: 'custom-div-icon'
      });
      this.locationMarker = L.marker(this.currentLatLng, { icon: redIcon }).addTo(this.map);
    }
  }

  async loadRadarLayers() {
    try {
      // 古いレイヤーの削除
      Object.values(this.radarLayers).forEach(layer => {
        if (this.map.hasLayer(layer)) {
          this.map.removeLayer(layer);
        }
      });
      this.radarLayers = {};
      this.timeIndexMap = {};

      // 実況（現在）の時刻一覧（新しい順に並んでいるため先頭が最新）
      const n1Res = await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json');
      if (!n1Res.ok) throw new Error('気象庁の実況時刻データ取得に失敗しました');
      const n1Data = await n1Res.json();
      if (!n1Data || n1Data.length === 0) throw new Error('実況時刻データが空です');
      const latest = n1Data[0]; // { basetime, validtime } 現在の実況

      // 予報（向こう60分、5分間隔）の時刻一覧
      const n2Res = await fetch('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json');
      if (!n2Res.ok) throw new Error('気象庁の予報時刻データ取得に失敗しました');
      const n2Data = await n2Res.json();

      // basetimeをDateに変換するヘルパー
      const parseJmaTime = (str) => {
        const y = parseInt(str.substring(0, 4));
        const mo = parseInt(str.substring(4, 6)) - 1;
        const d = parseInt(str.substring(6, 8));
        const h = parseInt(str.substring(8, 10));
        const mi = parseInt(str.substring(10, 12));
        const s = parseInt(str.substring(12, 14)) || 0;
        return new Date(y, mo, d, h, mi, s);
      };

      // 予報データ（N2）自身が持つ最新の基準時刻を採用する。
      // 実況（N1）の最新基準時刻と予報（N2）の更新タイミングがごくわずかにズレることがあり、
      // N1の最新値で突き合わせると一致せず予報が見つからなくなることがあるため、
      // N2データ自身の中で最新のbasetimeを信頼する。
      let n2Basetime = null;
      n2Data.forEach(e => {
        if (!n2Basetime || e.basetime > n2Basetime) n2Basetime = e.basetime;
      });

      // 30分後・1時間後に最も近い予報を、N2自身の最新基準時刻のグループから探す
      const findClosestForecast = (offsetMinutes) => {
        if (!n2Basetime) return null;
        const baseDate = parseJmaTime(n2Basetime);
        const targetDate = new Date(baseDate.getTime() + offsetMinutes * 60000);
        let closest = null;
        let minDiff = Infinity;
        n2Data.forEach(entry => {
          if (entry.basetime !== n2Basetime) return; // 同じ基準時刻の予報のみ対象
          const vDate = parseJmaTime(entry.validtime);
          const diff = Math.abs(vDate - targetDate);
          if (diff < minDiff) {
            minDiff = diff;
            closest = entry;
          }
        });
        return closest;
      };

      const points = [
        { idx: 0, entry: latest },
        { idx: 1, entry: findClosestForecast(30) },
        { idx: 2, entry: findClosestForecast(60) }
      ];

      points.forEach(({ idx, entry }) => {
        if (!entry) return; // 予報が見つからなければそのインデックスはスキップ
        const layerUrl = `https://www.jma.go.jp/bosai/jmatile/data/nowc/${entry.basetime}/none/${entry.validtime}/surf/hrpns/{z}/{x}/{y}.png`;
        this.radarLayers[idx] = L.tileLayer(layerUrl, {
          opacity: 0.85,
          maxZoom: 18,
          maxNativeZoom: 10, // ナウキャストのタイルはズーム10までのため、それ以上は拡大表示する
          minZoom: 5,
          attribution: '気象データ: 気象庁 高解像度降水ナウキャスト'
        });
        this.timeIndexMap[idx] = entry.validtime;
      });

      // スライダーの初期位置を「現在（0）」に設定
      this.setTimeIndex(0);

    } catch (err) {
      console.error('雨雲レーダーレイヤーのロードエラー:', err);
      showToast('雨雲レーダーの読み込みに失敗しました。');
    }
  }

  // 気象庁のvalidtime（basetime/validtime文字列）はUTC基準のため、日本時間に変換して表示する
  // （これまでは文字列をそのまま切り出していたため、表示が実際の日本時間と9時間ズレていた）
  formatDisplayTime(jmaTimeStr) {
    if (!jmaTimeStr) return '--:--';
    const y = parseInt(jmaTimeStr.substring(0, 4));
    const mo = parseInt(jmaTimeStr.substring(4, 6)) - 1;
    const d = parseInt(jmaTimeStr.substring(6, 8));
    const h = parseInt(jmaTimeStr.substring(8, 10));
    const mi = parseInt(jmaTimeStr.substring(10, 12));
    const utcDate = new Date(Date.UTC(y, mo, d, h, mi));
    const hour = String(utcDate.getHours()).padStart(2, '0'); // ブラウザのローカル時刻(日本時間)に自動変換される
    const min = String(utcDate.getMinutes()).padStart(2, '0');
    return `${hour}:${min}`;
  }

  setTimeIndex(index) {
    this.activeTimeIndex = index;
    this.slider.value = index;

    // UIラベルのアクティブ表示切替
    this.sliderLabels.forEach(label => {
      const idx = parseInt(label.getAttribute('data-index'));
      if (idx === index) {
        label.classList.add('label-active');
      } else {
        label.classList.remove('label-active');
      }
    });

    // レイヤーの切り替え表示
    Object.keys(this.radarLayers).forEach(idx => {
      const layer = this.radarLayers[idx];
      if (parseInt(idx) === index) {
        if (!this.map.hasLayer(layer)) {
          layer.addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(layer)) {
          this.map.removeLayer(layer);
        }
      }
    });

    // 時刻表示の更新
    const validtime = this.timeIndexMap[index];
    this.timeDisplay.textContent = `表示時刻: ${this.formatDisplayTime(validtime)}`;
  }

  togglePlay() {
    if (this.isPlaying) {
      this.stopPlay();
    } else {
      this.startPlay();
    }
  }

  startPlay() {
    this.isPlaying = true;
    this.playBtn.innerHTML = '<i class="fa-solid fa-pause"></i> 一時停止';

    this.playInterval = setInterval(() => {
      let nextIndex = this.activeTimeIndex + 1;
      if (nextIndex > 2) nextIndex = 0;
      this.setTimeIndex(nextIndex);
    }, 1500); // 1.5秒ごとに切り替え
  }

  stopPlay() {
    this.isPlaying = false;
    this.playBtn.innerHTML = '<i class="fa-solid fa-play"></i> 再生';
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }
}