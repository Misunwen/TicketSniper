# Changelog

本專案所有值得注意的變更都會記錄於此。
格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

## [1.1] - 2026-09-19

### Added
- 自訓練 ONNX 驗證碼模型（`server/models/tixcraft_tm`、`universal`）：拓元改用專用模型，
  伺服器依平台自動選模型，找不到模型時回退多策略投票。
- 關鍵字引擎升級（參考 tickets_hunter）：
  - `;`／`,` 分組＝備案（由左至右優先），組內「空白」＝同時符合（AND）。
  - 排除關鍵字（輪椅／身障／視線不完整…）先過濾。
  - 選區順序：由上而下／由下而上／取中間／隨機。
  - 找不到時「自動遞補」開關（預設關）。
- 擴充功能新增設定：排除關鍵字、選區順序、自動遞補、成功提示音。
- 送出前就緒檢查（驗證碼長度／票數／同意）通過才自動送出。
- 搶到票與送出成功時以 WebAudio 播放提示音。
- 可選的 nodriver 啟動器（`launcher/` + `啟動瀏覽器.bat`）：一鍵自動
  1) 檢查/安裝伺服器套件並確認 `ddddocr==1.5.6`、2) 啟動 OCR 伺服器並等 `/health` 就緒、
  3) 自動下載並使用 Chrome for Testing（支援 `--load-extension`，可全自動載入外掛）、
  4) 開專用 profile 並導到活動頁。
  品牌 Chrome 137+ 已移除 `--load-extension`，會以 `--disable-features=DisableLoadExtensionCommandLineSwitch` 嘗試還原。

### Changed
- `server/requirements.txt` 固定 `ddddocr==1.5.6`（1.6+ 對自訓練模型解碼不相容）。
- 擴充功能送出驗證碼請求時附帶 `model` 平台提示。
- 伺服器強制 UTF-8 輸出，避免 cp950 主控台因 emoji 崩潰。

### Fixed
- 售完／未開賣判斷改用完整關鍵字清單（含英文、日文）。

### Notes
- `server/models` 內模型來自 tickets_hunter（GPL-3.0），出處見 `server/models/NOTICE.txt`。
- 本專案採 GNU GPL-3.0（見 `LICENSE`）。

## [1.0] - 2026-09-19

### Added
- 整合自動搶票（拓元 tixcraft / KKTIX / ibon）與地端 ddddocr 驗證碼辨識。
- 自動勾選同意條款、自動點擊指定區域／票價、自動選擇票數。
- 售完自動重整（隨機等待 5–15 秒）。
- 拓元選票頁自動辨識並填入 Yii2 驗證碼（含 hash 單字元校正）。
- 「驗證碼填完後自動送出／下一步」可切換開關（預設關）。
- 反偵測：保留原生 `isTrusted`，供驗證碼模組判斷是否為真人點擊。
- 智能蹲點（DOM 變動 + 輪詢）、點擊驗證碼圖片重新辨識、F4 快捷鍵強制重辨識。
- Flask + ddddocr OCR 伺服器，附一鍵啟動／安裝／即時紀錄 `.bat`。
- 驗證碼引擎限定拓元；KKTIX、ibon 不啟用。

### Changed
- 設定儲存由 `chrome.storage.sync` 統一為 `chrome.storage.local`。
- 驗證碼核心 Promise 化為 `solveCaptchaOnce()`，供平台流程與 popup 共用。
- 擴充功能 `manifest.json` 合併權限（storage / activeTab / scripting）。

### Notes
- 驗證碼圖片僅傳送至本機 `127.0.0.1`，不上傳至任何雲端。
- 僅供個人研究與學習，請遵守各售票網站的使用條款與相關法令。
