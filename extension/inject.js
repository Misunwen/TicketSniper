// =========================================================================
// ibon 頁面橋接（MAIN world）
// 只在使用者主動點擊票區、需要執行站方 javascript: 連結時才被注入。
// token 由 content.js 每次載入隨機產生並透過 script[data-ts-token] 傳入，
// 且只接受來自同一個 window 的訊息，降低被頁面監聽／辨識的風險。
// =========================================================================
(function () {
    var el = document.currentScript;
    var TOKEN = (el && el.dataset && el.dataset.tsToken) || '';
    if (!TOKEN) return;

    window.addEventListener("message", function (event) {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== TOKEN) return;
        var code = event.data.script;
        if (typeof code !== 'string' || !code) return;
        try {
            (0, eval)(code); // 執行站方原本的 javascript: 內容
        } catch (e) { /* 靜默 */ }
    });
})();
