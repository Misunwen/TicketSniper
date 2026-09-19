chrome.runtime.onInstalled.addListener(() => {
    console.log('验证码识别插件已安装');
});

// ==========================================
// 讀取／觸發 Yii2 驗證碼 hash
// 需在頁面 MAIN world 執行才能存取頁面的 jQuery 與 yiiCaptcha 外掛
// ==========================================

// 注入到頁面：讀取目前 hash 與外掛狀態（不可引用外部變數）
function readHashInPage() {
    try {
        const jq = window.jQuery || window.$;
        if (!jq) return { hash: 0, hasPlugin: false, keys: [] };
        const img = jq('#TicketForm_verifyCode-image');
        const hasPlugin = !!(img.length && typeof img.yiiCaptcha === 'function');
        const d = jq('body').data('yiiCaptcha/ticket/captcha');
        let keys = [];
        try { keys = Object.keys(jq('body').data() || {}); } catch (e) {}
        return {
            hash: (d && d[0]) ? Number(d[0]) : 0,
            hasPlugin: hasPlugin,
            keys: keys
        };
    } catch (e) {
        return { hash: 0, hasPlugin: false, keys: [], error: String(e) };
    }
}

// 注入到頁面：觸發 yiiCaptcha refresh（會產生新的圖片與 hash）
function refreshCaptchaInPage() {
    try {
        const jq = window.jQuery || window.$;
        if (!jq) return false;
        const img = jq('#TicketForm_verifyCode-image');
        if (img.length && typeof img.yiiCaptcha === 'function') {
            img.yiiCaptcha('refresh');
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

async function readHash(tabId) {
    const res = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: readHashInPage
    });
    return (res && res[0] && res[0].result) || { hash: 0, hasPlugin: false, keys: [] };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'getYiiHash') return;

    const tabId = request.tabId || (sender.tab && sender.tab.id);
    if (!tabId) {
        sendResponse({ hash: 0 });
        return;
    }

    (async () => {
        let r = await readHash(tabId);
        let refreshed = false;

        // 若讀不到 hash 且頁面有 yiiCaptcha 外掛，主動 refresh 取得
        if ((!r.hash || r.hash <= 0) && r.hasPlugin && request.allowRefresh !== false) {
            const rr = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                func: refreshCaptchaInPage
            });
            refreshed = !!(rr && rr[0] && rr[0].result);
            if (refreshed) {
                // 一出現 hash 就馬上回傳（每 80ms 檢查，最多等 1.5 秒）
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                    await new Promise((res) => setTimeout(res, 80));
                    const rr2 = await readHash(tabId);
                    if (rr2.hash && rr2.hash > 0) { r = rr2; break; }
                    r = rr2;
                }
            }
        }

        sendResponse({
            hash: r.hash || 0,
            hasPlugin: !!r.hasPlugin,
            refreshed: refreshed,
            keys: r.keys || []
        });
    })();

    return true; // 非同步回覆
});
