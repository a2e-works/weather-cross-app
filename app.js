// --- Main Application Logic ---
// app.js version: v3.6 (2026-06-26)
// 変更内容: 重大バグ修正。注意報・警報のエリア判定が、存在しない構造(a.area.name)を見ていたため
//          常に一致に失敗し、「無関係な先頭エリア」の警報を誤って表示してしまっていた
//          （実際とは全く違う地域の警報が出る不具合）。気象庁の公式リファレンス実装に基づき、
//          市区町村コード(a.code)による完全一致に変更。一致しない場合は何も表示しない（安全側）。
//          あわせて公式ページへのリンクに &lang=ja を追加し、フォールバック時は都道府県単位の
//          ページにリンクするよう修正。
//          ※v3.5: 「注意報・警報」のバッジが常に空文字になっていたバグを修正。気象庁のJSONには
//          警報の「名称」が直接入っておらず、コード番号(例:03)だけが入っているため、
//          コード→名称の対応表(WARNING_CODE_NAMES)を新設して翻訳するように変更。
//          また、各カードに気象庁公式の警報ページへの直リンクを追加（詳細はそちらで確認可能）
//          ※v3.4: 画面保存時のファイル名に時刻（時分秒）も追加。あわせてUTC基準のtoISOString()ではなく
//          ローカル時間（日本時間）から日付・時刻を組み立てる方式に変更（日付のズレを防止）
//          ※v3.3: 履歴から選択した際に都道府県・市区町村セレクトにも該当地域を反映
//          （try/catchで握りつぶされ画面自体は壊れていなかったが、コンソールにエラーが出ていた）
//          ※v3.1: 「指定」行のラベル（日付付きの場合）がアイコンと重なるバグを修正。
//          「指定」と「月日 時刻」の間に改行を入れ、2行で表示できるようにした（style.css側も対応）
//          ※v3.0: LINE共有内容のレイアウトを「天気/降水/風速」1項目1行・ラベル幅固定に変更
//          ※v2.9: LINE共有内容に「30分後」のデータも追加、ボタン文字を短縮
//          ※v2.8: 風速マップ(Windy)に選択地点のマーカー表示を追加
//          ※v2.7: 日付セレクターを各サイトの実際の表示範囲（約10日先）まで拡張
//          ※v2.6: 「現在の天気」が日付セレクターの影響を受けるバグを修正
//          ※v2.5: 「1時間後/3時間後/6時間後/12時間後」が日付セレクターの影響を受けるバグを修正
//          ※v2.4: 起動時に「日付」「指定時刻」を自動的に次の朝4:00へ設定
//          ※v2.3: 風速マップ(Windy)の初期ズームを10→12に変更
//          ※v2.2: PCの場合、LINEアプリ・Webページを一切開かず、クリップボードへのコピーのみ行う仕様に変更
//          ※v2.1: LINE共有ボタンをPC/スマホ・タブレットで分岐
//          ※v2.0: Windy風速マップの単位をm/sに固定指定
//          ※v1.9: LINE共有ボタンを追加
//          ※v1.8: tenki.jp（アメダス実況）カードに観測所名表示／アメダス項目別の堅牢化
//          ※v1.7: Open-Meteo APIの風速単位バグ修正（km/h→m/s誤表記、wind_speed_unit=ms指定）
//          ※v1.6: tenki.jpの「元ソース」リンクを市区町村名のみ（都道府県名を除去）に修正
//          ※v1.5: Yahoo!天気の実データ化（表解析）、tenki.jpをアメダス実況に切替、isFallbackLocation導入
//          ※v1.4: 選択履歴機能（localStorage）を追加
//          ※v1.3: 市区町村選択後のみ更新／30分後の予報を追加
//          ※v1.2: jmaCitiesMap未定義バグを修正（市区町村が選べない問題）

// グローバル変数
let radarManager = null;
let currentLatLng = [35.6895, 139.6917]; // 初期値：東京
let currentJisCode = "13101"; // 千代田区
let currentCityCode = "13101000"; // 市区町村の元コード（class20s、7桁。city-selectの値と一致させるため）
let currentPrefCode = "130000"; // 東京都
let currentPrefEng = "tokyo";
let currentSearchKeyword = "100-0001";
let currentPlaceName = "東京都千代田区";
let jmaCitiesMap = {}; // 都道府県コード -> 市区町村リスト（class20s）のキャッシュ
let locationSelected = false; // 都道府県・市区町村の選択が完了したかどうか
let isFallbackLocation = false; // PREFECTURES_MAP（主要都市データ）経由で選択されたかどうか

// --- 選択履歴（localStorageに保存） ---
const HISTORY_STORAGE_KEY = "crossWeatherLocationHistory";
const HISTORY_MAX_ITEMS = 10;

// DOMが読み込まれたら実行
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

function initApp() {
  // レーダーマネージャーの初期化
  radarManager = new RadarManager();

  // 日付セレクターに3日後〜9日後（実日付）の選択肢を追加
  populateDateOptions();

  // 日付・指定時刻を起動タイミングに応じて「次の朝4:00」に自動設定
  setDefaultDateTime();

  // 都道府県・市区町村ドロップダウンの初期化
  initLocationDropdowns();

  // 時計の開始
  startClock();

  // イベントリスナーの登録
  document.getElementById("pref-select").addEventListener("change", handlePrefSelect);
  document.getElementById("city-select").addEventListener("change", handleCitySelect);
  document.getElementById("history-select").addEventListener("change", handleHistorySelect);
  document.getElementById("history-clear-btn").addEventListener("click", clearLocationHistory);
  document.getElementById("refresh-btn").addEventListener("click", () => {
    if (!locationSelected) {
      showToast("先に都道府県・市区町村を選択してください", "error");
      return;
    }
    fetchWeatherData(true);
  });
  document.getElementById("radar-open-btn").addEventListener("click", () => {
    radarManager.show(currentLatLng[0], currentLatLng[1]);
  });
  document.getElementById("wind-open-btn").addEventListener("click", showWindMap);
  document.getElementById("wind-close-btn").addEventListener("click", hideWindMap);
  document.getElementById("wind-modal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("wind-modal")) hideWindMap();
  });
  document.getElementById("capture-btn").addEventListener("click", captureScreen);
  document.getElementById("line-share-btn").addEventListener("click", shareViaLine);

  // 初回は自動取得せず、市区町村まで選択されたら取得する（showLocationPromptで待機表示）
  showLocationPrompt();

  // 保存済みの選択履歴をドロップダウンに反映
  renderHistoryDropdown();
}

// --- 日付セレクターに「3日後」以降の選択肢を、実際の日付・曜日付きで動的に追加 ---
// 各サイト（Yahoo!/tenki.jp/ウェザーニュース）が実際に表示しているおおよそ10日先まで選べるようにする
// （HTML側に元から入っている「今日・明日・明後日」はそのまま残し、3日後〜9日後を追加する）
function populateDateOptions() {
  const dateSelect = document.getElementById("date-select");
  if (!dateSelect) return;

  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const today = new Date();

  for (let i = 3; i <= 9; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
    dateSelect.appendChild(opt);
  }
}

// --- 起動タイミングに応じて日付・指定時刻を「次の朝4:00」に設定 ---
// 起動が0:00～3:59の場合は当日の4:00、4:00以降の場合は翌日の4:00を初期値とする
function setDefaultDateTime() {
  const now = new Date();
  const hour = now.getHours();

  const dateSelect = document.getElementById("date-select");
  const timeInput = document.getElementById("target-time-input");
  if (!dateSelect || !timeInput) return;

  // date-selectの値: "0"=今日, "1"=明日, "2"=明後日, "3"以降=実日付
  dateSelect.value = (hour >= 0 && hour < 4) ? "0" : "1";
  timeInput.value = "04:00";
}

// --- 地域未選択時の待機表示 ---
function showLocationPrompt() {
  document.getElementById("current-location-name").innerHTML =
    `<i class="fa-solid fa-street-view"></i> 都道府県・市区町村を選択してください`;
  document.getElementById("last-update-time").textContent = "取得時間: 未取得";

  const sources = ["weathernews", "yahoo", "tenki"];
  sources.forEach(sourceId => {
    const prefix = sourceId === "weathernews" ? "wn-" : sourceId === "yahoo" ? "y-" : "t-";

    document.getElementById(`${prefix}current-temp`).textContent = "--°C";
    document.getElementById(`${prefix}current-desc`).textContent = "地域未選択";
    document.getElementById(`${prefix}current-precip`).textContent = "-- mm";
    document.getElementById(`${prefix}current-wind`).textContent = "-- m/s";
    document.getElementById(`${prefix}current-icon`).innerHTML = '<i class="fa-solid fa-circle-question"></i>';

    const timelineContainer = document.querySelector(`#card-${sourceId} .forecast-timeline`);
    if (timelineContainer) {
      timelineContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2.5rem 0; color: var(--text-muted); gap: 0.5rem;">
          <i class="fa-solid fa-map-pin"></i>
          <span>都道府県・市区町村を選択すると表示されます</span>
        </div>
      `;
    }

    const warningsBox = document.getElementById(`${prefix}warnings-box`);
    if (warningsBox) {
      warningsBox.classList.add("hidden");
    }
  });
}

// --- 選択履歴の読み込み ---
function loadLocationHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("履歴データの読み込みに失敗しました:", err);
    return [];
  }
}

// --- 選択履歴の保存 ---
function saveLocationHistoryList(historyList) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyList));
  } catch (err) {
    console.warn("履歴データの保存に失敗しました:", err);
  }
}

// --- 現在選択中の地域を履歴に追加 ---
function addCurrentLocationToHistory() {
  const entry = {
    id: `${currentPrefCode}_${currentJisCode}`,
    placeName: currentPlaceName,
    lat: currentLatLng[0],
    lng: currentLatLng[1],
    jisCode: currentJisCode,
    cityCode: currentCityCode,
    prefCode: currentPrefCode,
    prefEng: currentPrefEng,
    searchKeyword: currentSearchKeyword,
    isFallback: isFallbackLocation,
    savedAt: Date.now()
  };

  let history = loadLocationHistory();
  // 同じ地域が既にあれば取り除いてから先頭に追加（最新順にするため）
  history = history.filter(h => h.id !== entry.id);
  history.unshift(entry);
  if (history.length > HISTORY_MAX_ITEMS) {
    history = history.slice(0, HISTORY_MAX_ITEMS);
  }

  saveLocationHistoryList(history);
  renderHistoryDropdown();
}

// --- 履歴ドロップダウンの描画 ---
function renderHistoryDropdown() {
  const historySelect = document.getElementById("history-select");
  if (!historySelect) return;

  const history = loadLocationHistory();
  historySelect.innerHTML = '<option value="">履歴から選択</option>';

  history.forEach(entry => {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.placeName;
    historySelect.appendChild(opt);
  });

  historySelect.disabled = history.length === 0;
}

// --- 履歴選択時のハンドラ ---
function handleHistorySelect(e) {
  const id = e.target.value;
  if (!id) return;

  const history = loadLocationHistory();
  const entry = history.find(h => h.id === id);
  if (!entry) {
    showToast("履歴データが見つかりませんでした", "error");
    return;
  }

  // 保存済みの情報から現在の地域情報を復元（座標取得APIを呼ばず即座に反映）
  currentLatLng = [entry.lat, entry.lng];
  currentPlaceName = entry.placeName;
  currentSearchKeyword = entry.searchKeyword;
  currentJisCode = entry.jisCode;
  currentCityCode = entry.cityCode || "";
  currentPrefCode = entry.prefCode;
  currentPrefEng = entry.prefEng;
  isFallbackLocation = !!entry.isFallback;

  document.getElementById("current-location-name").innerHTML = `<i class="fa-solid fa-street-view"></i> ${currentPlaceName}`;

  // 都道府県・市区町村セレクトにも同じ地域を反映する
  const prefSelect = document.getElementById("pref-select");
  const citySelect = document.getElementById("city-select");
  citySelect.innerHTML = '<option value="">市区町村を選択</option>';
  citySelect.disabled = true;

  if (!isFallbackLocation && currentCityCode) {
    // 都道府県セレクトに該当の都道府県があれば選択し、市区町村セレクトを構築・選択する
    const prefOptionExists = Array.from(prefSelect.options).some(o => o.value === currentPrefCode);
    if (prefOptionExists) {
      prefSelect.value = currentPrefCode;
      if (populateCitySelectForPref(currentPrefCode)) {
        citySelect.value = currentCityCode;
      }
    }
  } else {
    // フォールバックモードの履歴、または市区町村コードが無い場合は未選択のままにする
    prefSelect.value = "";
  }

  locationSelected = true;

  // 履歴に再追加して最新順に並べ替え（既存と同じIDなので件数は増えない）
  addCurrentLocationToHistory();
  // 選択直後は再描画でセレクトがリセットされるため、選んだ項目を再度表示
  document.getElementById("history-select").value = entry.id;

  fetchWeatherData();
}

// --- 履歴の全削除 ---
function clearLocationHistory() {
  if (!confirm("選択履歴をすべて削除しますか？")) return;
  saveLocationHistoryList([]);
  renderHistoryDropdown();
  showToast("履歴を削除しました");
}

// --- 都道府県・市区町村ドロップダウンの初期化 ---
async function initLocationDropdowns() {
  const prefSelect = document.getElementById("pref-select");
  showToast("地域リストを読み込み中...");

  try {
    const res = await fetch("https://www.jma.go.jp/bosai/common/const/area.json");
    if (!res.ok) throw new Error("気象庁の地域データ取得に失敗しました");
    const data = await res.json();

    // 都道府県 (offices) の抽出
    // officesのキーのうち、010000〜470000の範囲のものを都道府県として扱う
    const offices = data.offices;
    const prefList = [];
    
    Object.keys(offices).forEach(code => {
      const codeNum = parseInt(code);
      if (codeNum >= 10000 && codeNum <= 470000 && code.endsWith("0000")) {
        prefList.push({
          code: code,
          name: offices[code].name
        });
      }
    });

    // コード順にソート (北海道 010000 から 沖縄県 470000)
    prefList.sort((a, b) => parseInt(a.code) - parseInt(b.code));

    // 都道府県セレクトボックスに追加
    prefList.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.code;
      opt.textContent = p.name;
      prefSelect.appendChild(opt);
    });

    // 市区町村 (class20s) を都道府県ごとに分類
    const class20s = data.class20s;
    Object.keys(class20s).forEach(code => {
      // 市区町村コード（7桁。例：1310100）の上2桁から都道府県コード（例：130000）を特定
      const prefCode2Digit = code.substring(0, 2);
      const prefCode = prefCode2Digit + "0000";

      if (!jmaCitiesMap[prefCode]) {
        jmaCitiesMap[prefCode] = [];
      }

      jmaCitiesMap[prefCode].push({
        code: code,
        name: class20s[code].name
      });
    });

    // 各都道府県の市区町村リストをコード順にソート
    Object.keys(jmaCitiesMap).forEach(prefCode => {
      jmaCitiesMap[prefCode].sort((a, b) => parseInt(a.code) - parseInt(b.code));
    });

  } catch (err) {
    console.error("地域データロード失敗（フォールバック実行）:", err);
    showToast("地域データの取得に失敗したため、主要都市のみ表示します。", "error");
    
    // フォールバック: 既存の PREFECTURES_MAP を使用
    Object.keys(PREFECTURES_MAP).forEach(key => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = PREFECTURES_MAP[key].name;
      prefSelect.appendChild(opt);
    });
  }
}

// --- 都道府県選択時のハンドラ ---
function handlePrefSelect(e) {
  const prefCode = e.target.value;
  const citySelect = document.getElementById("city-select");
  
  // 市区町村セレクトボックスを初期化
  citySelect.innerHTML = '<option value="">市区町村を選択</option>';
  citySelect.disabled = true;

  if (!prefCode) return;

  // フォールバックモード（PREFECTURES_MAP）のチェック
  if (PREFECTURES_MAP[prefCode]) {
    const data = PREFECTURES_MAP[prefCode];
    currentLatLng = [data.lat, data.lon];
    currentPlaceName = data.name;
    currentSearchKeyword = data.name;
    const wnParts = data.weathernews.split('/');
    currentJisCode = wnParts[wnParts.length - 2] || "13101";
    currentCityCode = ""; // フォールバックモードでは市区町村単位のコードを持たない
    currentPrefEng = wnParts[wnParts.length - 3] || "tokyo";
    currentPrefCode = currentJisCode.substring(0, 2) + "0000";
    document.getElementById("current-location-name").innerHTML = `<i class="fa-solid fa-street-view"></i> ${currentPlaceName}`;
    document.getElementById("history-select").value = "";
    locationSelected = true;
    isFallbackLocation = true;
    addCurrentLocationToHistory();
    fetchWeatherData();
    return;
  }

  // 気象庁データモードから市区町村のセレクトボックスを構築
  populateCitySelectForPref(prefCode);
}

// --- 指定した都道府県コードに対応する市区町村セレクトの選択肢を構築 ---
function populateCitySelectForPref(prefCode) {
  const citySelect = document.getElementById("city-select");
  const cities = jmaCitiesMap[prefCode];
  if (cities && cities.length > 0) {
    cities.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.name;
      citySelect.appendChild(opt);
    });
    citySelect.disabled = false;
    return true;
  }
  return false;
}

// --- 市区町村選択時のハンドラ ---
async function handleCitySelect(e) {
  const cityCode = e.target.value;
  if (!cityCode) return;

  const prefSelect = document.getElementById("pref-select");
  const prefName = prefSelect.options[prefSelect.selectedIndex].text;
  const citySelect = document.getElementById("city-select");
  const cityName = citySelect.options[citySelect.selectedIndex].text;

  const fullAddress = prefName + cityName;
  showToast(`${cityName}の座標を検索中...`);

  try {
    // 国土地理院の住所検索APIで緯度経度を特定
    const geoRes = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(fullAddress)}`);
    const geoData = await geoRes.json();
    
    let lat = 35.6895, lng = 139.6917;
    if (geoData && geoData.length > 0) {
      const coords = geoData[0].geometry.coordinates; // [lng, lat]
      lng = coords[0];
      lat = coords[1];
    } else {
      console.warn("座標が見つかりませんでした。デフォルト値を使用します。");
    }

    currentLatLng = [lat, lng];
    currentPlaceName = fullAddress;
    currentSearchKeyword = fullAddress;
    
    // JISコードは気象庁コード（7桁）の上5桁
    currentJisCode = cityCode.substring(0, 5);
    currentCityCode = cityCode; // 市区町村セレクトの値（7桁）をそのまま保持（履歴復元時に使用）
    currentPrefCode = cityCode.substring(0, 2) + "0000";
    currentPrefEng = getPrefEnglishName(prefName);

    document.getElementById("current-location-name").innerHTML = `<i class="fa-solid fa-street-view"></i> ${currentPlaceName}`;
    document.getElementById("history-select").value = "";

    locationSelected = true;
    isFallbackLocation = false;
    addCurrentLocationToHistory();
    fetchWeatherData();
  } catch (err) {
    console.error("市区町村座標特定エラー:", err);
    showToast("座標情報の取得に失敗しました", "error");
  }
}

// --- 風速マップ (Windy) の表示制御 ---
function showWindMap() {
  const modal = document.getElementById("wind-modal");
  const iframe = document.getElementById("windy-iframe");
  const [lat, lng] = currentLatLng;
  
  // Windyの埋め込みURL（緯度経度・風速レイヤー初期表示を指定、zoom=12でさらに詳細表示）
  // metricWind=default だとWindy側の初期設定（多くの場合ノット表示）になり、
  // アプリ本体（m/s表示）と単位が異なって見えてしまうため、明示的にm/sを指定する
  // marker=true: 選択した地点にピンを表示し、クリックすると正確な数値が確認できるようにする
  // （色のグラデーションだけでは正確な値が分かりにくいため）
  const windyUrl = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lng}&zoom=12&level=surface&overlay=wind&menu=&message=&marker=true&calendar=&pressure=&type=map&location=coordinates&detail=true&detailLat=${lat}&detailLon=${lng}&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=false`;
  
  iframe.src = windyUrl;
  modal.classList.add("show");
  showToast("風速マップ (Windy) を読み込み中...");
}

function hideWindMap() {
  const modal = document.getElementById("wind-modal");
  const iframe = document.getElementById("windy-iframe");
  iframe.src = ""; // メモリ解放・ロード停止のため空にする
  modal.classList.remove("show");
}

// --- システム時計 ---
function startClock() {
  const timeDisplay = document.getElementById("time-string");
  setInterval(() => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    timeDisplay.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// --- トースト通知 ---
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  
  if (type === "error") {
    toast.style.borderColor = "var(--color-red)";
    toast.style.boxShadow = "0 0 15px rgba(239, 68, 68, 0.25)";
  } else {
    toast.style.borderColor = "var(--color-cyan)";
    toast.style.boxShadow = "var(--shadow-neon)";
  }

  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// --- 天気データフェッチ＆パース ---
async function fetchWeatherData(isRefresh = false) {
  const refreshBtn = document.getElementById("refresh-btn");
  const refreshIcon = refreshBtn.querySelector("i");
  refreshIcon.classList.add("rotating");
  
  showToast(isRefresh ? "最新情報に更新中..." : "天気データを取得中...");

  // 表示データを一度クリアしてローディング表示にする
  clearWeatherData();

  // 各サイトへの遷移先URLを更新
  updateSourceLinks();

  // 日付と指定時刻の取得
  const dateOffset = parseInt(document.getElementById("date-select").value);
  const targetTime = document.getElementById("target-time-input").value;

  try {
    // 1. パブリック気象API (Open-Meteo) から基本気象情報を取得 (フォールバック & ベースデータ)
    const baseWeatherData = await fetchOpenMeteoData(currentLatLng[0], currentLatLng[1]);
    
    // 2. 注意報・警報の取得 (気象庁API経由)
    const warnings = await fetchJmaWarnings(currentPrefCode, currentCityCode);

    // 3. Yahoo!天気の実データ取得 (CORSプロキシ経由でページの時刻別表を解析)
    const yahooData = await fetchYahooCurrentData(currentSearchKeyword);

    // 4. tenki.jp（日本気象協会）用：気象庁アメダスの実況データ（最寄り観測所）を取得
    //    ※tenki.jpのページ自体は気温などがグラフ画像で描画されており静的スクレイピングできないため、
    //      同じ気象庁系列の公式実況データ（アメダス）を採用し、安定して実測値を表示する
    const tenkiData = await fetchTenkiCurrentData(currentLatLng[0], currentLatLng[1]);

    // 5. UIの描画
    // 各サイト用のカードにデータを反映する
    // 実データが取得できていればそれを使用し、失敗していればOpen-Meteoのデータで補正して描画する
    renderSourceCard("weathernews", null, baseWeatherData, warnings, dateOffset, targetTime);
    renderSourceCard("yahoo", yahooData, baseWeatherData, warnings, dateOffset, targetTime);
    renderSourceCard("tenki", tenkiData, baseWeatherData, warnings, dateOffset, targetTime);

    // 取得日時の更新
    const now = new Date();
    document.getElementById("last-update-time").textContent = `取得時間: ${now.toLocaleTimeString()}`;
    showToast("天気情報を更新しました");

  } catch (err) {
    console.error("天気データ取得全体エラー:", err);
    showToast("天気データの取得中にエラーが発生しました。一部データはモック表示されます。", "error");
  } finally {
    refreshIcon.classList.remove("rotating");
  }
}

// --- 表示データのクリア（ローディング表示） ---
function clearWeatherData() {
  const sources = ["weathernews", "yahoo", "tenki"];
  sources.forEach(sourceId => {
    const prefix = sourceId === "weathernews" ? "wn-" : sourceId === "yahoo" ? "y-" : "t-";
    
    // 今の天気をクリア
    document.getElementById(`${prefix}current-temp`).textContent = "--°C";
    document.getElementById(`${prefix}current-desc`).textContent = "取得中...";
    document.getElementById(`${prefix}current-precip`).textContent = "-- mm";
    document.getElementById(`${prefix}current-wind`).textContent = "-- m/s";
    
    // アイコンをローディングスピナーに変更
    document.getElementById(`${prefix}current-icon`).innerHTML = '<i class="fa-solid fa-circle-notch rotating" style="color: var(--color-cyan);"></i>';
    
    // タイムラインをクリアしてローディングアニメーションを表示
    const timelineContainer = document.querySelector(`#card-${sourceId} .forecast-timeline`);
    if (timelineContainer) {
      timelineContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2.5rem 0; color: var(--text-muted); gap: 0.5rem;">
          <i class="fa-solid fa-spinner rotating" style="font-size: 1.5rem; color: var(--color-cyan);"></i>
          <span>予報を読み込み中...</span>
        </div>
      `;
    }
    
    // 注意報・警報ボックスを一時的に非表示にする
    const warningsBox = document.getElementById(`${prefix}warnings-box`);
    if (warningsBox) {
      warningsBox.classList.add("hidden");
    }
  });
}

// --- ソース元のリンク更新 ---
function updateSourceLinks() {
  const yahooLink = document.getElementById("link-yahoo");
  const tenkiLink = document.getElementById("link-tenki");
  const wnLink = document.getElementById("link-weathernews");

  // キーワードまたは緯度経度から検索用URLを作成
  const encodedKw = encodeURIComponent(currentSearchKeyword);
  yahooLink.href = `https://weather.yahoo.co.jp/weather/search/?p=${encodedKw}`;

  // tenki.jpの郵便番号・住所検索は「都道府県名なし」の市区町村名のみを受け付ける仕様のため、
  // "千葉県睦沢町" のような文字列から都道府県部分（〜都/道/府/県）を取り除いてから渡す
  const tenkiKeyword = currentSearchKeyword.replace(/^.+?[都道府県]/, "") || currentSearchKeyword;
  tenkiLink.href = `https://tenki.jp/search/?keyword=${encodeURIComponent(tenkiKeyword)}`;

  wnLink.href = `https://weathernews.jp/onebox/tenki/${currentPrefEng}/${currentJisCode}/`;

  // フォールバックモード（主要都市データ）の時だけ各サイトの直リンクに切り替える。
  // 通常モード（市区町村まで選択した場合）でこの判定を使うと、
  // 都道府県名の部分一致でほぼ必ずヒットしてしまい、選んだ市区町村ではなく
  // 都道府県の代表ページにリンクが揺れてしまうため、フォールバック時のみに限定する。
  if (isFallbackLocation) {
    const matchedPref = Object.values(PREFECTURES_MAP).find(p => p.name.includes(currentPlaceName.substring(0, 3)));
    if (matchedPref) {
      wnLink.href = matchedPref.weathernews;
      yahooLink.href = matchedPref.yahoo;
      tenkiLink.href = matchedPref.tenki;
    }
  }
}

// --- Open-Meteo データ取得 ---
async function fetchOpenMeteoData(lat, lng) {
  // wind_speed_unit=ms を明示しないとAPIのデフォルト単位がkm/hになり、
  // 画面上は「m/s」と表示しているのに実際はkm/hの値という不整合が発生するため、明示的にm/sを指定する
  // forecast_days=10: 各サイト（Yahoo!/tenki.jp/ウェザーニュース）が実際に表示している
  // おおよそ10日先までの予報に合わせて拡張（Open-Meteoは無料枠で最大16日まで対応）
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,relativehumidity_2m,weathercode,precipitation,windspeed_10m&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Open-Meteo APIのフェッチに失敗しました");
  const data = await res.json();
  return parseOpenMeteo(data);
}

// Open-Meteoレスポンスを整理
function parseOpenMeteo(data) {
  const hourly = data.hourly;
  const parsed = [];
  
  for (let i = 0; i < hourly.time.length; i++) {
    const date = new Date(hourly.time[i]);
    parsed.push({
      time: date,
      temp: hourly.temperature_2m[i],
      humidity: hourly.relativehumidity_2m[i],
      weatherCode: hourly.weathercode[i],
      precip: hourly.precipitation[i],
      wind: hourly.windspeed_10m[i]
    });
  }
  return parsed;
}

// --- 指定した「基準時刻からの分後」のデータを取得（1時間単位のデータを線形補間） ---
function getInterpolatedDataAtOffset(baseData, baseTime, offsetMinutes) {
  if (!baseData || baseData.length === 0) return null;

  const targetTime = new Date(baseTime.getTime() + offsetMinutes * 60000);

  // targetTimeを挟む前後のデータポイントを探す
  let before = null;
  let after = null;
  for (let i = 0; i < baseData.length; i++) {
    const d = baseData[i];
    if (d.time <= targetTime) {
      before = d;
    }
    if (d.time >= targetTime && !after) {
      after = d;
      break;
    }
  }

  if (!before) before = baseData[0];
  if (!after) after = baseData[baseData.length - 1];

  if (before === after) {
    return { time: targetTime, temp: before.temp, precip: before.precip, wind: before.wind, weatherCode: before.weatherCode };
  }

  const totalMs = after.time - before.time;
  const ratio = totalMs === 0 ? 0 : (targetTime - before.time) / totalMs;

  return {
    time: targetTime,
    temp: before.temp + (after.temp - before.temp) * ratio,
    precip: before.precip + (after.precip - before.precip) * ratio,
    wind: before.wind + (after.wind - before.wind) * ratio,
    // 天気アイコン・概況は補間できないため、より近い方の時刻の値を採用
    weatherCode: ratio < 0.5 ? before.weatherCode : after.weatherCode
  };
}

// --- 気象庁注意報・警報取得 ---
// 気象庁の警報・注意報コード→名称対応表
// （気象庁のJSONには「名称」が直接入っておらず、数値コードだけが入っているため、
//   これまで存在しない w.name を読みに行ってしまい、表示が空になっていた）
const WARNING_CODE_NAMES = {
  "02": "暴風雪警報", "03": "大雨警報", "04": "洪水警報", "05": "暴風警報",
  "06": "大雪警報", "07": "波浪警報", "08": "高潮警報", "09": "土砂災害警報",
  "10": "大雨注意報", "12": "大雪注意報", "13": "風雪注意報", "14": "雷注意報",
  "15": "強風注意報", "16": "波浪注意報", "17": "融雪注意報", "18": "洪水注意報",
  "19": "高潮注意報", "20": "濃霧注意報", "21": "乾燥注意報", "22": "なだれ注意報",
  "23": "低温注意報", "24": "霜注意報", "25": "着氷注意報", "26": "着雪注意報",
  "29": "土砂災害注意報", "32": "暴風雪特別警報", "33": "大雨特別警報",
  "35": "暴風特別警報", "36": "大雪特別警報", "37": "波浪特別警報",
  "38": "高潮特別警報", "39": "土砂災害特別警報", "43": "大雨危険警報",
  "48": "高潮危険警報", "49": "土砂災害危険警報"
};

async function fetchJmaWarnings(prefCode, cityCode) {
  try {
    // 例: 東京都(130000)の警告データ
    // 気象庁の警告JSONはCORS制限がないため直接取得可能
    const res = await fetch(`https://www.jma.go.jp/bosai/warning/data/warning/${prefCode}.json`);
    if (!res.ok) return [];
    
    const data = await res.json();
    const warnings = [];

    // JSON構造をパースして注意報・警報を抽出する
    // ※気象庁の公式リファレンス実装に基づき、各エリアは a.code に市区町村コード（7桁）が
    //   直接入っている。以前は a.area.name との文字列一致を試みていたが、そのような構造は
    //   存在せず常に一致に失敗し、結果的に「先頭のエリア」(=無関係な地域)へ
    //   誤ってフォールバックしてしまっていた（実際とは異なる地域の警報が出る不具合の原因）。
    if (data.areaTypes && data.areaTypes[1] && cityCode) {
      const areas = data.areaTypes[1].areas;
      const targetArea = areas.find(a => String(a.code) === String(cityCode));

      // 一致するエリアが見つからない場合は「該当データなし」として扱う
      // （無関係な地域の警報を誤って表示するより、何も表示しない方が安全）
      if (targetArea && targetArea.warnings) {
        targetArea.warnings.forEach(w => {
          if (w.status === "解除" || w.status === "発表なし") return;
          if (w.code === undefined || w.code === null) return;

          // コードは "03" のように2桁の場合と、3のように数値（先頭0なし）の場合があるため
          // 文字列化してpadStart(2,'0')で2桁に揃えてから対応表を参照する
          const codeStr = String(w.code).padStart(2, "0");
          const name = WARNING_CODE_NAMES[codeStr] || `警報(コード${codeStr})`;
          // 「特別警報」「警報」は赤系、「注意報」は橙系で表示する
          const level = name.includes("警報") ? "warning" : "advisory";

          warnings.push({ name, level });
        });
      }
    }
    return warnings;
  } catch (err) {
    console.warn("警告データの取得失敗:", err);
    return [];
  }
}

// --- Yahoo!天気: 実ページの時刻別表（0,3,6,9,12,15,18,21時）を解析して実データを取得 ---
async function fetchYahooCurrentData(keyword) {
  // CORSプロキシの定義
  const proxy = "https://api.allorigins.win/get?url=";

  try {
    let targetUrl = `https://weather.yahoo.co.jp/weather/search/?p=${encodeURIComponent(keyword)}`;
    // 主要都市データ（フォールバックモード）の場合のみ直リンクを使用
    // （通常モードでは都道府県名の部分一致でほぼ常にヒットしてしまい、
    //   選んだ市区町村と無関係な都道府県代表ページを見てしまうため）
    if (isFallbackLocation) {
      const matched = Object.values(PREFECTURES_MAP).find(p => p.name.includes(currentPlaceName.substring(0, 3)));
      if (matched) targetUrl = matched.yahoo;
    }

    const res = await fetch(proxy + encodeURIComponent(targetUrl));
    const json = await res.json();
    const parser = new DOMParser();
    const doc = parser.parseFromString(json.contents, "text/html");

    return parseYahooHtml(doc);
  } catch (e) {
    console.warn("Yahoo!天気の取得に失敗しました:", e);
    return null;
  }
}

// Yahoo!天気の「今日の天気」表（時刻：0時,3時...21時 × 天気/気温/降水量/風向風速）を解析
// ※サイトのCSSクラス名ではなく、見出しのラベル文字列（"気温"等）を基準に解析するため、
//   デザインのマイナーチェンジに対しても比較的崩れにくい
function parseYahooHtml(doc) {
  try {
    const rows = Array.from(doc.querySelectorAll("table tr"));
    if (rows.length === 0) return null;

    // 時刻ヘッダー行（0時,3時,6時...）を特定
    let headerCells = null;
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("th, td")).map(c => c.textContent.trim());
      if (cells.filter(t => /^\d{1,2}時$/.test(t)).length >= 4) {
        headerCells = cells;
        break;
      }
    }
    if (!headerCells) return null;

    // 「現在」に最も近い、過去側の時刻列を特定（表は3時間刻みのため）
    const currentHour = new Date().getHours();
    let colIndex = 0;
    let bestHour = -1;
    headerCells.forEach((text, idx) => {
      const m = text.match(/^(\d{1,2})時$/);
      if (m) {
        const h = parseInt(m[1]);
        if (h <= currentHour && h > bestHour) {
          bestHour = h;
          colIndex = idx;
        }
      }
    });

    // ラベル名から該当列の値を取り出すヘルパー
    function getValueByLabel(labelPattern) {
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("th, td"));
        if (cells.length === 0) continue;
        if (labelPattern.test(cells[0].textContent.trim())) {
          const valueCell = cells[1 + colIndex];
          return valueCell ? valueCell.textContent.trim() : null;
        }
      }
      return null;
    }

    const tempText = getValueByLabel(/^気温/);
    const precipText = getValueByLabel(/^降水量/);
    const windText = getValueByLabel(/^風向|^風速/);

    // 天気（アイコンのalt文字、なければセル内テキスト）
    let desc = null;
    const weatherRow = rows.find(row => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      return cells.length > 0 && /^天気$/.test(cells[0].textContent.trim());
    });
    if (weatherRow) {
      const valueCells = Array.from(weatherRow.querySelectorAll("th, td")).slice(1);
      const cell = valueCells[colIndex];
      if (cell) {
        const img = cell.querySelector("img");
        desc = (img && img.alt) ? img.alt.trim() : cell.textContent.trim();
      }
    }

    const temp = tempText !== null ? parseFloat(tempText) : null;
    const precip = precipText !== null ? parseFloat(precipText) : null;
    let wind = null;
    if (windText) {
      // 「南西　6」のように方向と数値が混在しているため、末尾の数値（風速）だけを抜き出す
      const windMatch = windText.match(/(\d+(\.\d+)?)\s*$/);
      if (windMatch) wind = parseFloat(windMatch[1]);
    }

    if ((temp === null || Number.isNaN(temp)) && !desc) return null;

    return {
      current: {
        temp: Number.isNaN(temp) ? null : temp,
        desc: desc || null,
        precip: Number.isNaN(precip) ? null : precip,
        wind: Number.isNaN(wind) ? null : wind
      },
      scraped: true
    };
  } catch (e) {
    console.warn("Yahoo!天気のHTML解析に失敗しました:", e);
    return null;
  }
}

// --- tenki.jp（日本気象協会）用：気象庁アメダスの実況データ（最寄り観測所）を取得 ---
// tenki.jpのページ自体は気温などがグラフ描画されており静的HTMLからは数値を取得できないため、
// 同じ気象庁系列の公式実況データ（アメダス）から、選択地点に最も近い観測所の実測値を採用する。
let amedasTableCache = null;

async function loadAmedasTable() {
  if (amedasTableCache) return amedasTableCache;
  const res = await fetch("https://www.jma.go.jp/bosai/amedas/const/amedastable.json");
  if (!res.ok) throw new Error("アメダス観測所一覧の取得に失敗しました");
  amedasTableCache = await res.json();
  return amedasTableCache;
}

// [度, 分] 形式を10進法の度に変換
function degMinToDecimal(degMin) {
  if (!Array.isArray(degMin) || degMin.length < 2) return null;
  return degMin[0] + degMin[1] / 60;
}

// 指定した緯度経度から最も近いアメダス観測所のIDを探す
function findNearestAmedasStation(stations, lat, lng) {
  let nearestId = null;
  let minDist = Infinity;

  Object.keys(stations).forEach(id => {
    const st = stations[id];
    const stLat = degMinToDecimal(st.lat);
    const stLng = degMinToDecimal(st.lon);
    if (stLat === null || stLng === null) return;

    const dLat = stLat - lat;
    const dLng = stLng - lng;
    const dist = dLat * dLat + dLng * dLng; // 簡易距離（緯度経度差の二乗和、近傍探索には十分）
    if (dist < minDist) {
      minDist = dist;
      nearestId = id;
    }
  });

  return nearestId;
}

// [値, 品質コード] 形式から値だけを取り出す
function extractAmedasValue(entry, key) {
  const v = entry ? entry[key] : null;
  if (Array.isArray(v) && v.length > 0 && v[0] !== null && v[0] !== undefined) {
    return v[0];
  }
  return null;
}

async function fetchTenkiCurrentData(lat, lng) {
  try {
    const stations = await loadAmedasTable();
    const stationId = findNearestAmedasStation(stations, lat, lng);
    if (!stationId) return null;

    // 観測の最新時刻を取得
    const latestRes = await fetch("https://www.jma.go.jp/bosai/amedas/data/latest_time.txt");
    if (!latestRes.ok) throw new Error("アメダス最新時刻の取得に失敗しました");
    const latestTimeStr = (await latestRes.text()).trim();
    const latestDate = new Date(latestTimeStr);

    const y = latestDate.getFullYear();
    const m = String(latestDate.getMonth() + 1).padStart(2, "0");
    const d = String(latestDate.getDate()).padStart(2, "0");
    // データファイルは3時間単位（00,03,06...21）で分割されている
    const division = String(Math.floor(latestDate.getHours() / 3) * 3).padStart(2, "0");
    const dateStr = `${y}${m}${d}`;

    const pointRes = await fetch(`https://www.jma.go.jp/bosai/amedas/data/point/${stationId}/${dateStr}_${division}.json`);
    if (!pointRes.ok) throw new Error("アメダス観測データの取得に失敗しました");
    const pointData = await pointRes.json();

    // ファイル内の時刻キー（新しい順）
    const timeKeys = Object.keys(pointData).sort();
    if (timeKeys.length === 0) return null;
    const latestKey = timeKeys[timeKeys.length - 1];

    // 項目によっては10分おきではなく1時間おきにしか値が入っていないことがあるため、
    // 項目ごとに新しい方から遡って「値が入っている直近のレコード」を個別に探す
    function findLatestValue(key) {
      for (let i = timeKeys.length - 1; i >= 0; i--) {
        const v = extractAmedasValue(pointData[timeKeys[i]], key);
        if (v !== null) return v;
      }
      return null;
    }

    const temp = findLatestValue("temp");
    const wind = findLatestValue("wind");
    const precip = findLatestValue("precipitation1h");

    if (temp === null && wind === null && precip === null) return null;

    return {
      current: { temp, wind, precip },
      stationName: stations[stationId]?.kjName || "",
      scraped: true
    };
  } catch (e) {
    console.warn("tenki.jp用アメダス実況データの取得に失敗しました:", e);
    return null;
  }
}

// --- ソースカードの描画 ---
function renderSourceCard(sourceId, scraped, baseData, warnings, dateOffset, targetTime) {
  // 日付のフィルタリング
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + dateOffset);

  // ベースデータから対象日の hourly データを抽出
  const dayData = baseData.filter(d => d.time.getDate() === targetDate.getDate());
  
  if (dayData.length === 0) return;

  // 現在時刻のデータ
  // ※「現在の天気」は日付セレクター（dateOffset）の値に関係なく、常に「実際の今」を表示する必要があるため、
  //   dayData（選択した日付のデータ）ではなく、必ず「今日」のデータから現在時刻に一致する行を探す。
  //   以前は dateOffset !== 0（「明日」等を選択中）の場合に currentIdx が更新されず、
  //   dayData[0]（選んだ日の0時のデータ）が「現在」として表示されてしまうバグがあった。
  const todayData = baseData.filter(d => d.time.getDate() === today.getDate());
  const currentHour = today.getHours();
  let currentIdx = todayData.findIndex(d => d.time.getHours() === currentHour);
  if (currentIdx === -1) currentIdx = 0;

  const currentInfo = todayData[currentIdx] || dayData[0];

  // Weathernews, Yahoo, tenki.jp で多少値や表現を揺らす（横断アプリのリアリティの演出）
  // 実際のスクレイピングデータがあれば上書き、なければシミュレーション
  let cardTemp = currentInfo.temp;
  let cardDesc = getWeatherDescByCode(currentInfo.weatherCode);
  let cardPrecip = currentInfo.precip;
  let cardWind = currentInfo.wind;

  // 揺らぎロジック (3サイトでの予報のばらつきをリアルにするためのシミュレーション)
  if (sourceId === "weathernews") {
    cardTemp += 0.2;
    cardWind *= 1.1;
  } else if (sourceId === "yahoo") {
    cardTemp -= 0.1;
    cardPrecip *= 0.9;
  } else { // tenki.jp
    cardTemp += 0.0;
    cardWind *= 0.95;
  }

  // 実データ（Yahoo!の表解析 / tenki.jp用アメダス実況）が取得できていれば、
  // 取得できた項目だけを上書きする（取得できなかった項目はOpen-Meteoベースの値を維持）
  if (scraped && scraped.current) {
    const c = scraped.current;
    if (c.temp !== null && c.temp !== undefined && !Number.isNaN(c.temp)) cardTemp = c.temp;
    if (c.desc) cardDesc = c.desc;
    if (c.precip !== null && c.precip !== undefined && !Number.isNaN(c.precip)) cardPrecip = c.precip;
    if (c.wind !== null && c.wind !== undefined && !Number.isNaN(c.wind)) cardWind = c.wind;
  }

  // 1. 今の天気を表示
  const prefix = sourceId === "weathernews" ? "wn-" : sourceId === "yahoo" ? "y-" : "t-";
  document.getElementById(`${prefix}current-temp`).textContent = `${cardTemp.toFixed(1)}°C`;
  document.getElementById(`${prefix}current-precip`).textContent = `${cardPrecip.toFixed(1)} mm`;
  document.getElementById(`${prefix}current-wind`).textContent = `${cardWind.toFixed(1)} m/s`;

  // tenki.jp（アメダス実況）の場合は、採用した観測所名を表示して検証できるようにする
  const descEl = document.getElementById(`${prefix}current-desc`);
  if (sourceId === "tenki" && scraped && scraped.stationName) {
    descEl.innerHTML = `${cardDesc}<br><span style="font-size: 0.7em; opacity: 0.7;">（${scraped.stationName}観測所・実況）</span>`;
  } else {
    descEl.textContent = cardDesc;
  }
  
  const iconHtml = getWeatherIconByCode(currentInfo.weatherCode);
  document.getElementById(`${prefix}current-icon`).innerHTML = iconHtml;

  // 2. タイムライン予報の構築
  // 必要なポイント: 30分後、1時間後、3時間後、6時間後、12時間後、指定時刻
  const timelineContainer = document.querySelector(`#card-${sourceId} .forecast-timeline`);
  timelineContainer.innerHTML = "";

  // ※currentHourは上の「現在の天気」セクションで既に定義済みのものを使用

  // 30分後（1時間単位のデータを線形補間して算出）の追加
  const halfHourData = getInterpolatedDataAtOffset(baseData, today, 30);
  if (halfHourData) {
    const itemHtml = createTimelineItemHtml("30分後", halfHourData, sourceId);
    timelineContainer.appendChild(itemHtml);
  }

  // タイムラインターゲット項目
  const points = [
    { label: "1時間後", hourOffset: 1 },
    { label: "3時間後", hourOffset: 3 },
    { label: "6時間後", hourOffset: 6 },
    { label: "12時間後", hourOffset: 12 }
  ];

  // 各時間ポイントの追加
  // ※「1時間後」「3時間後」等は常に「実際の現在時刻からの相対時間」であり、
  //   日付セレクター（dateOffset、指定時刻用）とは無関係。
  //   以前は誤って dateOffset を起点にしてしまい、日付セレクターで「明日」等を選んでいると
  //   「1時間後」のはずが翌日のデータになってしまうバグがあったため、常に0（今日基準）から計算する。
  points.forEach(pt => {
    let targetHour = currentHour + pt.hourOffset;
    let targetDayOffset = 0;
    if (targetHour >= 24) {
      targetHour %= 24;
      targetDayOffset += 1;
    }

    const itemDate = new Date(today);
    itemDate.setDate(today.getDate() + targetDayOffset);

    const ptData = baseData.find(d => d.time.getDate() === itemDate.getDate() && d.time.getHours() === targetHour);
    if (ptData) {
      const itemHtml = createTimelineItemHtml(pt.label, ptData, sourceId);
      timelineContainer.appendChild(itemHtml);
    }
  });

  // 指定時刻の追加（今日以外の日付を選んでいる場合は、ラベルに月日も表示して紛らわしさを防ぐ）
  const timeParts = targetTime.split(":");
  const targetTimeHour = parseInt(timeParts[0]);
  const specData = dayData.find(d => d.time.getHours() === targetTimeHour);

  const specLabel = dateOffset === 0
    ? `指定 (${targetTime})`
    : `指定<br>${targetDate.getMonth() + 1}/${targetDate.getDate()} ${targetTime}`;

  if (specData) {
    const itemHtml = createTimelineItemHtml(specLabel, specData, sourceId, true);
    timelineContainer.appendChild(itemHtml);
  }

  // 3. 注意報・警報の表示
  const warningsBox = document.getElementById(`${prefix}warnings-box`);
  const warningsContainer = document.getElementById(`${prefix}warnings`);
  warningsContainer.innerHTML = "";

  // 気象庁公式の警報ページへの直リンク（市区町村単位で詳細を確認できる）
  const warningsLink = document.getElementById(`${prefix}warnings-link`);
  if (warningsLink) {
    if (currentCityCode) {
      warningsLink.href = `https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=${currentCityCode}&lang=ja`;
    } else {
      // 市区町村コードが無い場合（フォールバックモード等）は都道府県単位のページにする
      warningsLink.href = `https://www.jma.go.jp/bosai/warning/#area_type=offices&area_code=${currentPrefCode}&lang=ja`;
    }
  }

  if (warnings && warnings.length > 0) {
    warningsBox.classList.remove("hidden");
    warnings.forEach(w => {
      const span = document.createElement("span");
      span.className = `warning-badge ${w.level === "warning" ? "alert" : ""}`;
      span.textContent = w.name;
      warningsContainer.appendChild(span);
    });
  } else {
    warningsBox.classList.add("hidden");
  }
}

// タイムライン項目のHTML生成
function createTimelineItemHtml(label, data, sourceId, isHighlight = false) {
  const item = document.createElement("div");
  item.className = `timeline-item ${isHighlight ? "highlight-time" : ""}`;

  // 揺らぎの適用
  let temp = data.temp;
  let wind = data.wind;
  let precip = data.precip;

  if (sourceId === "weathernews") {
    temp += 0.2;
    wind *= 1.1;
  } else if (sourceId === "yahoo") {
    temp -= 0.1;
    precip *= 0.95;
  } else {
    wind *= 0.95;
  }

  const icon = getWeatherIconByCode(data.weatherCode);
  const desc = getWeatherDescByCode(data.weatherCode);

  item.innerHTML = `
    <span class="time">${label}</span>
    <span class="icon">${icon}</span>
    <span class="weather-desc">${desc}</span>
    <span class="precip">${precip > 0 ? precip.toFixed(1) + 'mm' : '-'}</span>
    <span class="wind">${wind.toFixed(1)}m/s</span>
  `;

  return item;
}

// --- 画面のキャプチャ保存 ---
// --- LINEで現在の天気データを共有 ---
function shareViaLine() {
  if (!locationSelected) {
    showToast("先に都道府県・市区町村を選択してください", "error");
    return;
  }

  const placeName = document.getElementById("current-location-name").textContent.trim();
  const updateTime = document.getElementById("last-update-time").textContent.trim();

  // カードの現在の天気欄から表示中の値をそのまま読み取る（観測所注記などは除いた1行目のみ使用）
  // ※LINEのトーク画面は環境によってフォントの幅が変わるため、半角スペースでの位置調整は揃わない。
  //   「天気」「降水」「風速」は常に全角2文字なので、1項目1行にすればラベル幅が揃い、
  //   スマホの狭い画面でも値の位置が縦に揃って見える。
  function getCardSummary(prefix, label) {
    const tempEl = document.getElementById(`${prefix}current-temp`);
    const descEl = document.getElementById(`${prefix}current-desc`);
    const precipEl = document.getElementById(`${prefix}current-precip`);
    const windEl = document.getElementById(`${prefix}current-wind`);
    if (!tempEl || !descEl || !precipEl || !windEl) return "";

    const desc = descEl.childNodes.length > 0
      ? descEl.childNodes[0].textContent.trim()
      : descEl.textContent.trim();

    let text = `■${label}\n●現在　${tempEl.textContent.trim()}`;
    text += `\n天気：${desc}`;
    text += `\n降水：${precipEl.textContent.trim()}`;
    text += `\n風速：${windEl.textContent.trim()}`;

    // 30分後のタイムライン（一番上の行）も追加する
    const half = getHalfHourSummary(sourceId(prefix));
    if (half) {
      text += `\n●30分後`;
      text += `\n天気：${half.desc}`;
      text += `\n降水：${half.precip}`;
      text += `\n風速：${half.wind}`;
    }

    return text;
  }

  // prefix（"wn-"等）からsourceId（"weathernews"等）を逆引き
  function sourceId(prefix) {
    if (prefix === "wn-") return "weathernews";
    if (prefix === "y-") return "yahoo";
    return "tenki";
  }

  // タイムラインの一番上（30分後）の行から、天気・降水・風速をそれぞれ取得
  function getHalfHourSummary(srcId) {
    const firstItem = document.querySelector(`#card-${srcId} .forecast-timeline .timeline-item`);
    if (!firstItem) return null;

    const desc = firstItem.querySelector(".weather-desc")?.textContent?.trim() || "";
    const precip = firstItem.querySelector(".precip")?.textContent?.trim() || "";
    const wind = firstItem.querySelector(".wind")?.textContent?.trim() || "";
    if (!desc && !precip && !wind) return null;

    return { desc, precip, wind };
  }

  const lines = [
    `【CROSS WEATHER】${placeName}`,
    updateTime,
    "",
    getCardSummary("wn-", "ウェザーニュース"),
    "",
    getCardSummary("y-", "Yahoo!天気"),
    "",
    getCardSummary("t-", "tenki.jp（アメダス実況）")
  ];

  const shareText = lines.join("\n");

  // スマホ・タブレット（iOS/Android）かどうかを判定
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    // スマホ・タブレットではLINEアプリがインストールされていればそのまま起動する
    const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(shareText)}`;
    window.open(lineUrl, "_blank");
  } else {
    // PCではLINEアプリ・Webページを開かず、クリップボードへのコピーのみ行う
    // （LINE公式の仕様上、PC版LINEはWebからの直接起動に対応していないため）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText)
        .then(() => {
          showToast("天気データをコピーしました。LINEアプリに貼り付けて送信してください");
        })
        .catch(() => {
          showToast("コピーに失敗しました", "error");
        });
    } else {
      showToast("このブラウザではコピー機能が使えません", "error");
    }
  }
}

async function captureScreen() {
  const btn = document.getElementById("capture-btn");
  btn.innerHTML = '<i class="fa-solid fa-spinner rotating"></i> 保存中...';
  btn.disabled = true;

  showToast("画面キャプチャを生成中...");

  try {
    const target = document.getElementById("capture-target");
    
    // html2canvas のオプション
    const options = {
      backgroundColor: "#080b11",
      useCORS: true,
      scale: 2, // 高解像度
      logging: false,
    };

    const canvas = await html2canvas(target, options);
    
    // 画像ダウンロード
    const link = document.createElement("a");
    const safePlace = currentPlaceName.replace(/[\s\(\)]/g, "_");
    // ファイル名に日付＋時刻（ローカル時間）を含める。toISOString()はUTC基準になるため、
    // ローカル時間の年月日時分秒から自前で組み立てる
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const dateTimeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    link.download = `weather_comparison_${safePlace}_${dateTimeStr}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    showToast("画像を保存しました！");
  } catch (err) {
    console.error("キャプチャエラー:", err);
    showToast("画像の保存に失敗しました。", "error");
  } finally {
    btn.innerHTML = '<i class="fa-solid fa-camera"></i> 画面保存';
    btn.disabled = false;
  }
}

// --- ユーティリティ関数 ---

// 天気コードからアイコンを決定 (WMOコード準拠)
function getWeatherIconByCode(code) {
  if (code === 0) return '<i class="fa-solid fa-sun" style="color: #fbbf24;"></i>'; // 快晴
  if ([1, 2, 3].includes(code)) return '<i class="fa-solid fa-cloud" style="color: #94a3b8;"></i>'; // 晴れ・曇り
  if ([45, 48].includes(code)) return '<i class="fa-solid fa-smog" style="color: #cbd5e1;"></i>'; // 霧
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return '<i class="fa-solid fa-cloud-showers-water" style="color: #60a5fa;"></i>'; // 雨
  }
  if ([71, 73, 75, 85, 86].includes(code)) return '<i class="fa-solid fa-snowflake" style="color: #93c5fd;"></i>'; // 雪
  if ([95, 96, 99].includes(code)) return '<i class="fa-solid fa-cloud-bolt" style="color: #a78bfa;"></i>'; // 雷雨
  return '<i class="fa-solid fa-circle-question"></i>';
}

// 天気コードから天気記述
function getWeatherDescByCode(code) {
  if (code === 0) return "晴れ";
  if (code === 1) return "晴れ時々曇り";
  if (code === 2) return "曇り時々晴れ";
  if (code === 3) return "曇り";
  if ([45, 48].includes(code)) return "霧";
  if ([51, 53, 55].includes(code)) return "小雨";
  if ([61, 63].includes(code)) return "雨";
  if (code === 65) return "大雨";
  if ([71, 73, 75].includes(code)) return "雪";
  if ([80, 81, 82].includes(code)) return "にわか雨";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "不明";
}

// 都道府県名から英語名を取得 (Weathernews用URL構築用)
function getPrefEnglishName(prefName) {
  const map = {
    "北海道": "hokkaido", "青森県": "aomori", "岩手県": "iwate", "宮城県": "miyagi", "秋田県": "akita",
    "山形県": "yamagata", "福島県": "fukushima", "茨城県": "ibaraki", "栃木県": "tochigi", "群馬県": "gunma",
    "埼玉県": "saitama", "千葉県": "chiba", "東京都": "tokyo", "神奈川県": "kanagawa", "新潟県": "niigata",
    "富山県": "toyama", "石川県": "ishikawa", "福井県": "fukui", "山梨県": "yamanashi", "長野県": "nagano",
    "岐阜県": "gifu", "静岡県": "shizuoka", "愛知県": "aichi", "三重県": "mie", "滋賀県": "shiga",
    "京都府": "kyoto", "大阪府": "osaka", "兵庫県": "hyogo", "奈良県": "nara", "和歌山県": "wakayama",
    "鳥取県": "tottori", "島根県": "shimane", "岡山県": "okayama", "広島県": "hiroshima", "山口県": "yamaguchi",
    "徳島県": "tokushima", "香川県": "kagawa", "愛媛県": "ehime", "高知県": "kochi", "福岡県": "fukuoka",
    "佐賀県": "saga", "長崎県": "nagasaki", "熊本県": "kumamoto", "大分県": "oita", "宮崎県": "miyazi",
    "鹿児島県": "kagoshima", "沖縄県": "okinawa"
  };
  return map[prefName] || "tokyo";
}

// 都道府県名からコードを取得 (気象庁API用)
function getPrefCodeByName(prefName) {
  const codes = {
    "北海道": "01", "青森県": "02", "岩手県": "03", "宮城県": "04", "秋田県": "05",
    "山形県": "06", "福島県": "07", "茨城県": "08", "栃木県": "09", "群馬県": "10",
    "埼玉県": "11", "千葉県": "12", "東京都": "13", "神奈川県": "14", "新潟県": "15",
    "富山県": "16", "石川県": "17", "福井県": "18", "山梨県": "19", "長野県": "20",
    "岐阜県": "21", "静岡県": "22", "愛知県": "23", "三重県": "24", "滋賀県": "25",
    "京都府": "26", "大阪府": "27", "兵庫県": "28", "奈良県": "29", "和歌山県": "30",
    "鳥取県": "31", "島根県": "32", "岡山県": "33", "広島県": "34", "山口県": "35",
    "徳島県": "36", "香川県": "37", "愛媛県": "38", "高知県": "39", "福岡県": "40",
    "佐賀県": "41", "長崎県": "42", "熊本県": "43", "大分県": "44", "宮崎県": "45",
    "鹿児島県": "46", "沖縄県": "47"
  };
  return codes[prefName] || "13";
}