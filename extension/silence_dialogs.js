// =========================================================================
// 僅在 IBON 頁面、MAIN world、document_start 執行：
// IBON 首頁會跳出 window.alert()（會員登入提示），JS 對話框會讓分頁／瀏覽器
// 「沒有回應」。這裡在最早期把 alert/confirm/prompt 覆寫掉，避免卡住。
// =========================================================================
(function () {
    try {
        window.alert = function () { return undefined; };
        window.confirm = function () { return true; };
        window.prompt = function () { return null; };
    } catch (e) {}
})();
