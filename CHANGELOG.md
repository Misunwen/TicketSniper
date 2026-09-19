# Changelog

本專案所有值得注意的變更都會記錄於此。
格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

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
