# Changelog

本專案所有值得注意的變更都會記錄於此。
格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [1.4.3] - 2026-09-20

### Fixed
- KKTIX 同意條款：改為**優先點關聯 `<label>`**（觸發原生 toggle＋change，Angular 的
  `ng-model` 才會真正更新）；修正「DOM 顯示已勾、但 `ng-model` 仍 false（`ng-empty`）、
  下一步不能按、且重繪後被取消」的問題。移除會持續重勾的 interval（避免設定關閉後仍勾）。
- launcher：移除「每 2 秒巡所有分頁做 `Page.enable`」的迴圈（疑似造成**開新分頁時整個
  Chrome 無回應**）；JS 對話框改由 ibon 專用的 `silence_dialogs.js`（MAIN world）處理。
- IBON「下一步」：送出前先呼叫頁面的 `showProcess()` 再 `__doPostBack`（貼近真實點擊），
  並新增「同一頁只送一次」避免重複 postback。
- **IBON 造成 Chrome 無回應（Application Hang）**：IBON 首頁的 `window.alert()` 會卡住分頁。
  新增 `extension/silence_dialogs.js`（僅 ibon、MAIN world、document_start）自動吞掉
  `alert/confirm/prompt`；launcher 另加 CDP `Page.handleJavaScriptDialog` 自動關閉（含新分頁）。
- 移除 IBON 流程中讀取整頁 `document.body.innerHTML` 的除錯碼（大頁面記憶體暴衝風險）；
  IBON 步驟偵測不再掃描全部元素找 shadow DOM，改只查 `tr[rel]`。

## [1.4.2] - 2026-09-20

### Added
- 各平台自動化**獨立開關**：拓元 `tixcraftAuto`、KKTIX `kktixAuto`（IBON 已有 `ibonAuto`），
  可在 popup 單獨關閉某個平台的自動化，方便隔離測試。
- launcher `clean_profile`（預設 true）：**啟動與關閉時清空瀏覽資料**
  （cookie／快取／歷史／登入／Local Storage…），但**保留擴充功能設定**
  （`Default/Local Extension Settings`）與 **`Secure Preferences`（開發人員模式狀態）**。
  每次啟動都是乾淨資料、popup 設定與開發人員模式不流失。

### Fixed
- IBON 運動類數量頁（`UTK0202_.aspx`）現在也會設定張數（原本只處理表演類 `UTK0201_001`）；
  「下一步」按鈕尋找放寬（含 `__doPostBack` 連結與「確認／送出」字樣）。
- IBON **未設定區域關鍵字**時，改為自動選「最高票價」的可選區域去點擊（原本直接放棄）。
- KKTIX 同意條款：`ensureChecked` 增加「點關聯 `<label>`」步驟；並在勾選後 0.7 秒複查，
  若被 Angular 重繪取消會在 LOG 顯示 `⚠️ 同意條款又被取消`。
- KKTIX 同意條款未打勾：`ensureChecked` 不再用 `clickElement`（會退回 `humanClick` 的合成
  click，導致 Angular 被雙擊切換）；改為「有 CDP 受信任點擊才用 → 原生 `.click()` →
  原生 setter＋事件」。另外改為**每輪確認、未勾就重勾**，避免 Angular 重繪把已勾選取消。
- 拓元選區：`clickElement` 後**偵測是否跳頁，未跳頁就自動重試**（避免受信任點擊未生效而卡住）；
  並把 CDP 模擬滑鼠移動改為**目標附近小範圍**（避免座標因頁面微幅變動而失準）。

### Changed
- launcher：`open_extensions_page` 預設改為 `true`（啟動後自動開啟 `chrome://extensions`）。
  開發人員模式（`extensions.ui.developer_mode`）為 Chrome 受保護設定（MAC），
  **程式無法代開、每次啟動都需手動開啟一次**（已於 `Directions.txt` 說明）。
- **popup 面板重新分組**：共用設定放最上面，接著「平台自動化」（拓元／KKTIX／IBON 各自分組、
  同平台選項放一起），再來「驗證碼辨識（拓元）」與「紀錄」。
- **Cloudflare 處理先維持 v1.4 版**（偵測 + 驅動內建 `verify_cf()`）；三層偵測／DOM pierce
  點擊版先擱置，改回測試。
- 新增 `overwrite_prefs`（預設 true）：啟動前把 profile 偏好寫成一般使用者樣貌
  （關密碼管理／通知／翻譯／SafeBrowsing、DNS-over-HTTPS 關閉）。
- `STEALTH_ARGS` 的 `--disable-features` 補上 `IsolateOrigins,site-per-process`（+ `TranslateUI`）。

## [1.4.1] - 2026-09-20

### Added
- 除錯紀錄：新增「🗑️ 清除紀錄」按鈕（清除 storage 緩衝與頁面內緩衝），避免紀錄一直累積、
  不必每次重新整理就重新抓。
- IBON：選完張數後可自動按「下一步」——擴充功能開關 `ibonAutoNext`；
  launcher 設定 `ibon_auto_next`（舊版 .aspx）。

### Fixed
- IBON「下一步」程式點擊只會轉圈、postback 沒送出（手動點才正常）。改為：
  launcher 模式優先 **CDP 受信任點擊**，否則**直接呼叫 ASP.NET `__doPostBack`**
  （擴充經 MAIN world 橋接、launcher 以 `evaluate`），最後才退回合成 click。

### Changed
- **擬人化強化**：所有點擊加入**模擬滑鼠移動**（隨機起點、2~4 段貝茲曲線）與
  **110~150ms 隨機延遲**：
  - launcher CDP 點擊（`control_server.py` 的受信任點擊、`ibon.py` 的選區/SPA 點擊）。
  - 擴充功能 `humanClick` 的事件間隔、`clickElement` 點後延遲、IBON 選區點擊前。
  - KKTIX 連點加票間隔由 10~30ms 改為 **110~150ms**。
  - 同意條款勾選改為**受信任點擊優先**（再退回原生 `.click()`／setter）。

## [1.4.0] - 2026-09-20

### Added
- launcher **IBON CDP 模式**（`launcher/ibon.py`）：改在 CDP 層操作舊版 `.aspx`（UTK0201），
  一般元素以 `tab.mouse_click`（`Input.dispatchMouseEvent`，受信任）點擊，image map／難取座標者
  以元素 `.click()`；解析頁面 `jsonData` 做關鍵字/價格比對。設定：
  `ibon_auto`、`ibon_area_keyword`、`ibon_exclude_keyword`、`ibon_fallback`、`ibon_ticket_count`。
- 擴充功能新增 **`ibonAuto`** 開關：改用 launcher CDP 模式時可關閉擴充功能的 IBON 動作，避免重複。
- IBON 表格匹配（擴充功能）也套用**排除關鍵字**（輪椅／身障／視線不完整…）。
- launcher **IBON 新版 SPA 支援（實驗）**：以 CDP `DOM.perform_search`（pierce，可穿透
  closed Shadow DOM）探索可點元素並記錄，可用 `ibon_spa_keyword` 指定要點的文字、
  `ibon_spa_query` 指定搜尋選擇器；未設定關鍵字時只記錄不點擊。
- launcher **Cloudflare 驗證自動處理**：定期偵測 Turnstile／「Just a moment」頁面並呼叫
  驅動內建的 `verify_cf()`（`cf_auto_solve`，預設開；`cf_check_interval` 預設 3 秒）。
- launcher **cookie 注入**：`cookies`（JSON 陣列）或 `cookies_file`（JSON 檔）可在啟動後
  注入登入 session 並重新載入；範例 `launcher/cookies.example.json`，`cookies.json` 已 gitignore。
- 擴充功能：新增 IBON WAF／Cloudflare 頁面偵測，LOG 會明確顯示「連線暫時受限」或
  「Cloudflare 驗證」而非只有「找不到 jsonData」。

### Changed
- launcher 預設驅動改為 **zendriver**（nodriver 的維護分支，stealth/CDP 修正較新），
  可用 `launcher/config.json` 的 `driver` 設回 `"nodriver"`；找不到 zendriver 時自動退回。
- `launcher/requirements.txt` 加入 `zendriver>=0.16`。

### Fixed
- KKTIX／拓元同意條款：改為「重試直到確認真的被勾選」（依序：原生 `.click()` → CDP 受信任點擊
  → 原生 `checked` setter + `input/change` 事件），修正只勾一次而可能沒打勾、導致後續
  「下一步／電腦配位」按鈕一直無法使用的問題。
- launcher（zendriver）：若前一次啟動的 Chrome 仍開著並佔用 `chrome_profile`，新的啟動會
  出現「Failed to connect to browser」；請先關閉舊的啟動器瀏覽器視窗再重跑。

## [1.3.1] - 2026-09-19

### Changed
- 補充 **IBON 使用說明**：IBON 的售票流程（Cloudflare + Queue-it）會擋啟動器使用的
  Chrome for Testing / nodriver 環境（出現「連線暫時受限」）。要跑 IBON 請改用
  `啟動伺服器.bat` + **一般 Chrome 手動載入 extension**，不要用 `啟動瀏覽器.bat`。
  （實測一般 Chrome + 外掛可正常選位。）已更新 `Directions.txt` 的啟動器章節與常見問題。

## [1.3.0] - 2026-09-19

### Added
- **CDP 受信任點擊**：由 `launcher` 啟動一個只綁定 `127.0.0.1` 的本機控制伺服器
  （`launcher/control_server.py`，需 `X-TS-Token`），擴充功能取得元素座標後改以
  nodriver/CDP `Input.dispatchMouseEvent` 發送真正的滑鼠事件（`isTrusted` 為 `true`），
  取代網頁層級的合成事件。適用於 tixcraft 選區、KKTIX 加票，以及 ibon image map
  票區（以 `coords` 換算座標；失敗時自動退回原本的 `callSend` 橋接）。
- 伺服器新增 `GET /config`（CORS 僅允許目標平台與擴充功能），回傳控制伺服器網址與
  token；未由 launcher 啟動時 `trustedClick=false`，擴充功能自動退回一般點擊。
- `launcher/config.json` / `config` 新增 `trusted_click`、`control_port`。
- **封鎖追蹤／分析請求（選用，預設關閉）**：launcher 可用 CDP
  `Network.setBlockedURLs` 封鎖 GA／GTM／DoubleClick／Facebook Pixel／Cloudflare
  Insights／Clarity／Hotjar 等分析與側錄腳本，以及 ibon DMP 主機。
  **預設 `block_trackers: false`**：缺少 analytics／側錄 beacon 反而會被部分平台
  判定為機器人（參考 `tickets_hunter` 的紀錄），經實測開啟時會直接被 IBON 限制，
  故預設關閉，僅在確認不影響的平台才建議開啟。
- **KKTIX 選位控制**：設定面板新增「選好票數後自動按」選項，可選擇
  `不自動`／`自動按「自行選位」`（`challenge()`）／`自動按「電腦配位／電腦選位」`
  （`challenge(1)`）；選好張數後會等待按鈕可用再點擊（受信任點擊優先）。
  若該頁沒有選位選項（按鈕只有「下一步」），會直接按「下一步」繼續。
- **除錯紀錄與匯出**：popup 新增「啟用除錯紀錄」開關與「匯出紀錄 (.txt)」按鈕；
  開啟後會記錄自動化過程並可下載成 TXT（含版本、時間、網址與設定），方便回報。
  預設關閉；關閉時完全不記錄、不輸出。
- **啟動器輸出紀錄**：`launcher` 主控台輸出同步寫入 `launcher/launcher_log.txt`
  （可用 `save_log: false` 關閉；已加入 .gitignore）。

### Fixed
- 拓元選票頁：智慧蹲點與選票頁流程同時要辨識時，後者因 `captchaExecuting` 回傳
  `null` 被誤記為「驗證碼辨識失敗」。改為偵測到辨識進行中即交由既有流程處理，不再誤報。
- KKTIX：勾選同意條款在 Angular 尚未反映狀態前會重複點擊，改為每個頁面只勾一次。

### Notes
- 受信任點擊需由 `啟動瀏覽器.bat`（launcher）啟動；若 OCR 伺服器是以
  `啟動伺服器.bat` 手動啟動，則沒有控制資訊，會使用原本的合成事件。

## [1.2.1] - 2026-09-19

### Changed
- 移除 MAIN world 反偵測腳本（覆寫 `isTrusted`／`addEventListener`）與 `#bot-hud` DOM。
  這類覆寫本身是常見的機器人指紋：把 `isTrusted` 強制為 `true` 會被頁面用一個合成事件
  直接測出，覆寫 `addEventListener` 也會因函式特徵不同而被辨識。
- 頁面日誌預設靜音（`TS_DEBUG = false`）：不輸出 console、不插入任何 DOM。
- ibon 橋接只在 `UTK0201` 頁面注入（不再於整個 ibon 網域），改用每次載入隨機 token，
  並以 `event.source === window` 驗證來源。
- 移除 `patchIbonErrors` 對 `console.error` 的覆寫；必要隱藏元素只在 UTK 頁面建立。
- 啟動器加入參考 `tickets_hunter`（MaxBot）的隱蔽啟動參數：關閉背景網路／通知／同步／
  翻譯、`--no-pings`、`--disable-blink-features=AutomationControlled` 等。

### Notes
- 擴充功能以合成 DOM 事件操作，`isTrusted` 本質為 `false`，進階防護仍可能偵測。
  若目標平台防護嚴格，建議改用 nodriver/CDP 的受信任輸入（作法參考 `tickets_hunter`）。

## [1.2] - 2026-09-19

### Added
- `tools/setup_deps.py`，並重寫 `安裝套件.bat`：逐一檢測伺服器／啟動器所需套件，
  缺少或版本不符者自動 `pip install`（含固定 `ddddocr==1.5.6`）。
- `打包分享.bat`：打包成 `TicketSniper.zip`（排除 `.git`、`chrome_profile`、
  Chrome for Testing、`recognition_log*.dat`、`__pycache__`；可選一併打包 CfT）。
- `server/requirements-build.txt`：把 `pyinstaller` 移出執行時相依。
- Chrome for Testing 跨平台偵測（win32/win64/mac-x64/mac-arm64/linux64）。

### Changed
- 啟動器 `.bat` 改為 UTF-8 + `chcp 65001`，中文與 emoji 訊息可正常顯示。
- OCR 伺服器綁定改為 `127.0.0.1`（僅限本機存取）。
- 反偵測改為在 MAIN world（`extension/anti_detection.js`）執行，才真正影響頁面；
  content script 僅保留原生 `isTrusted` getter 供判斷真人點擊。
- `/recognize` 加上 CORS 來源允許清單，僅接受目標平台與擴充功能來源。
- ddddocr 推論改為序列化（執行緒鎖），避免 `threaded=True` 併發競態。
- `extension/inject.js`／`inject.min.js` 二選一，移除未使用的重複檔（改用 `inject.js`）。

### Fixed
- 伺服器在自訓練模型回傳長度不符且多策略無結果時，不再回 HTTP 500，
  改回傳模型輸出（`length_mismatch`）或 200 `success:false`，讓前端能換圖重試。
- 擴充功能辨識失敗、伺服器非 2xx、長度不符或 hash 驗證失敗時，改為「點擊換圖後重試」，
  不再對同一張圖重複請求。
- IBON 區域關鍵字改用共用解析（支援 `;`／`,` 備案分組），與 tixcraft／KKTIX 一致。
- 售完判斷改以完整 class token 比對，避免 `full-width` 等誤判。
- `isSubmitReady` 的驗證碼長度改用設定值，不再寫死 4。
- 不再改寫頁面驗證碼 `<img>` 的 `src`（避免破壞網站換圖／hash 流程）；
  泛用 `data:image` 選擇器移到最後，降低誤選。
- `setup_deps.py` 支援 `>=`／`<=`／`>`／`<`／`!=` 版本運算子。
- popup 版本號改由 manifest 動態取得；background 訊息繁體化並加上錯誤處理。

## [1.1] - 2026-09-19

### Added
- 自訓練 ONNX 驗證碼模型（`server/models`）：目標網站改用專用模型，
  伺服器依網站自動選模型，找不到模型時回退多策略投票。
- 關鍵字引擎升級（參考第三方開源實作）：
  - `;`／`,` 分組＝備案（由左至右優先），組內「空白」＝同時符合（AND）。
  - 排除關鍵字（輪椅／身障／視線不完整…）先過濾。
  - 選區順序：由上而下／由下而上／取中間／隨機。
  - 找不到時「自動遞補」開關（預設關）。
- 擴充功能新增設定：排除關鍵字、選區順序、自動遞補、成功提示音。
- 送出前就緒檢查（驗證碼長度／票數／同意）通過才自動送出。
- 成功取得與送出成功時以 WebAudio 播放提示音。
- 可選的 nodriver 啟動器（`launcher/` + `啟動瀏覽器.bat`）：一鍵自動
  1) 檢查/安裝伺服器套件並確認 `ddddocr==1.5.6`、2) 啟動 OCR 伺服器並等 `/health` 就緒、
  3) 自動下載並使用 Chrome for Testing（支援 `--load-extension`，可全自動載入外掛）、
  4) 開專用 profile 並導到活動頁。
  品牌 Chrome 137+ 已移除 `--load-extension`，會以 `--disable-features=DisableLoadExtensionCommandLineSwitch` 嘗試還原。

### Changed
- `server/requirements.txt` 固定 `ddddocr==1.5.6`（1.6+ 對自訓練模型解碼不相容）。
- 擴充功能送出驗證碼請求時附帶 `model` 目標網站提示。
- 伺服器強制 UTF-8 輸出，避免 cp950 主控台因 emoji 崩潰。

### Fixed
- 售完／未開賣判斷改用完整關鍵字清單（含英文、日文）。

### Notes
- `server/models` 內模型來自第三方開源專案（GPL-3.0），出處見 `server/models/NOTICE.txt`。
- 本專案採 GNU GPL-3.0（見 `LICENSE`）。

## [1.0] - 2026-09-19

### Added
- 整合瀏覽器自動化與地端 ddddocr 驗證碼辨識。
- 自動勾選同意條款、自動點擊指定區域／價格、自動選擇數量。
- 售完自動重整（隨機等待 5–15 秒）。
- 目標網頁自動辨識並填入 Yii2 驗證碼（含 hash 單字元校正）。
- 「驗證碼填完後自動送出／下一步」可切換開關（預設關）。
- 反偵測：保留原生 `isTrusted`，供驗證碼模組判斷是否為真人點擊。
- 智能蹲點（DOM 變動 + 輪詢）、點擊驗證碼圖片重新辨識、F4 快捷鍵強制重辨識。
- Flask + ddddocr OCR 伺服器，附一鍵啟動／安裝／即時紀錄 `.bat`。
- 驗證碼引擎僅在需要的目標網站啟用。

### Changed
- 設定儲存由 `chrome.storage.sync` 統一為 `chrome.storage.local`。
- 驗證碼核心 Promise 化為 `solveCaptchaOnce()`，供平台流程與 popup 共用。
- 擴充功能 `manifest.json` 合併權限（storage / activeTab / scripting）。

### Notes
- 驗證碼圖片僅傳送至本機 `127.0.0.1`，不上傳至任何雲端。
- 僅供個人研究與學習，請遵守各網站的使用條款與相關法令。
