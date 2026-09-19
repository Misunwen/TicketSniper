# Changelog

本專案所有值得注意的變更都會記錄於此。
格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

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
