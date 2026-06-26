// --- Radar Controller using Leaflet and JMA (気象庁) 高解像度降水ナウキャスト ---
// radar.js version: v2.1 (2026-06-26)
// 変更内容: 初期表示のズームレベルを10→12に変更（2段階拡大表示）
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
    // 地図の作成 (CartoDB Dark Matter レイヤーを使用)
    this.map = L.map('radar-map', {
      zoomControl: true,
      minZoom: 5,
      maxZoom: 18
    }).setView(this.currentLatLng, 12);

    // ダークテーマ地図タイル
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
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

      const latestDate = parseJmaTime(latest.validtime);

      // 30分後・1時間後に最も近い予報を、同じbasetimeの予報一覧（n2Data）から探す
      const findClosestForecast = (offsetMinutes) => {
        const targetDate = new Date(latestDate.getTime() + offsetMinutes * 60000);
        let closest = null;
        let minDiff = Infinity;
        n2Data.forEach(entry => {
          if (entry.basetime !== latest.basetime) return; // 同じ基準時刻の予報のみ対象
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
          opacity: 0.65,
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

  formatDisplayTime(jmaTimeStr) {
    if (!jmaTimeStr) return '--:--';
    const hour = jmaTimeStr.substring(8, 10);
    const min = jmaTimeStr.substring(10, 12);
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
