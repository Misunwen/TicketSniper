// 讀取分頁的 Yii2 驗證碼 hash（經 background 在 MAIN world 取得）
function getYiiHashFromTab(tabId, allowRefresh = true, timeoutMs = 2500) {
    return new Promise((resolve) => {
        if (!tabId) { resolve(0); return; }
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; resolve(0); }
        }, timeoutMs);
        try {
            chrome.runtime.sendMessage(
                { action: 'getYiiHash', tabId: tabId, allowRefresh: allowRefresh },
                (resp) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (chrome.runtime.lastError || !resp) { resolve(0); return; }
                    resolve(resp);
                });
        } catch (e) {
            if (!settled) { settled = true; clearTimeout(timer); resolve(0); }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);

    const autoCheck        = $('autoCheck');
    const autoReload       = $('autoReload');
    const dropdownValue    = $('dropdownValue');
    const autoClickZone    = $('autoClickZone');
    const zoneKeywords     = $('zoneKeywords');

    const serverStatus     = $('serverStatus');
    const hashStatus       = $('hashStatus');
    const autoFill         = $('autoFill');
    const autoRun          = $('autoRun');
    const yiiHashEnabled   = $('yiiHashEnabled');
    const autoSubmit       = $('autoSubmit');
    const serverUrl        = $('serverUrl');
    const typingMode       = $('typingMode');
    const captchaLength    = $('captchaLength');
    const recognizeTimes   = $('recognizeTimes');

    const fieldInfo        = $('field-info');
    const fieldName        = $('fieldName');
    const resultDiv        = $('result');
    const selectBtn        = $('selectBtn');
    const recognizeBtn     = $('recognizeBtn');
    const clearBtn         = $('clearBtn');

    // =========================================
    // 載入設定
    // =========================================
    chrome.storage.local.get([
        'autoCheck', 'autoReload', 'dropdownValue', 'autoClickZone', 'zoneKeywords', 'autoSubmit',
        'autoFill', 'autoRun', 'yiiHashEnabled', 'serverUrl', 'typingMode', 'captchaLength', 'recognizeTimes',
        'savedSelector'
    ], (data) => {
        if (data.autoCheck !== undefined) autoCheck.checked = data.autoCheck;
        if (data.autoReload !== undefined) autoReload.checked = data.autoReload;
        if (data.dropdownValue !== undefined) dropdownValue.value = data.dropdownValue;
        if (data.autoClickZone !== undefined) autoClickZone.checked = data.autoClickZone;
        if (data.zoneKeywords !== undefined) zoneKeywords.value = data.zoneKeywords;
        if (data.autoSubmit !== undefined) autoSubmit.checked = data.autoSubmit;

        if (data.autoFill !== undefined) autoFill.checked = data.autoFill;
        if (data.autoRun !== undefined) autoRun.checked = data.autoRun;
        if (data.yiiHashEnabled !== undefined) yiiHashEnabled.checked = data.yiiHashEnabled;
        serverUrl.value = data.serverUrl || 'http://127.0.0.1:5000';
        if (data.typingMode) typingMode.value = data.typingMode;
        captchaLength.value = data.captchaLength || 4;
        recognizeTimes.value = data.recognizeTimes || 1;

        if (data.savedSelector) {
            fieldInfo.style.display = 'block';
            fieldName.textContent = data.savedSelector;
        }

        // 補寫預設值，確保 content.js 讀得到
        const defaults = {};
        if (!data.captchaLength) defaults.captchaLength = 4;
        if (!data.recognizeTimes) defaults.recognizeTimes = 1;
        if (Object.keys(defaults).length > 0) chrome.storage.local.set(defaults);

        checkServerStatus(serverUrl.value);
        refreshHashStatus();
    });

    // =========================================
    // 儲存設定
    // =========================================
    autoCheck.addEventListener('change', () => chrome.storage.local.set({ autoCheck: autoCheck.checked }));
    autoReload.addEventListener('change', () => chrome.storage.local.set({ autoReload: autoReload.checked }));
    dropdownValue.addEventListener('change', () => chrome.storage.local.set({ dropdownValue: dropdownValue.value }));
    autoClickZone.addEventListener('change', () => chrome.storage.local.set({ autoClickZone: autoClickZone.checked }));
    autoSubmit.addEventListener('change', () => chrome.storage.local.set({ autoSubmit: autoSubmit.checked }));

    autoFill.addEventListener('change', () => chrome.storage.local.set({ autoFill: autoFill.checked }));
    yiiHashEnabled.addEventListener('change', () => {
        chrome.storage.local.set({ yiiHashEnabled: yiiHashEnabled.checked });
        refreshHashStatus();
    });
    typingMode.addEventListener('change', () => chrome.storage.local.set({ typingMode: typingMode.value }));

    let kwTimer = null;
    zoneKeywords.addEventListener('input', () => {
        clearTimeout(kwTimer);
        kwTimer = setTimeout(() => chrome.storage.local.set({ zoneKeywords: zoneKeywords.value }), 400);
    });

    captchaLength.addEventListener('change', () => {
        let v = parseInt(captchaLength.value);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 10) v = 10;
        captchaLength.value = v;
        chrome.storage.local.set({ captchaLength: v });
    });

    recognizeTimes.addEventListener('change', () => {
        let v = parseInt(recognizeTimes.value);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 5) v = 5;
        recognizeTimes.value = v;
        chrome.storage.local.set({ recognizeTimes: v });
    });

    let urlTimer = null;
    serverUrl.addEventListener('input', () => {
        chrome.storage.local.set({ serverUrl: serverUrl.value });
        clearTimeout(urlTimer);
        urlTimer = setTimeout(() => checkServerStatus(serverUrl.value), 800);
    });

    // 開啟全自動模式時，立即對目前分頁執行一次
    autoRun.addEventListener('change', () => {
        chrome.storage.local.set({ autoRun: autoRun.checked });
        if (autoRun.checked) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'runAutoNow' }, () => void chrome.runtime.lastError);
            });
        }
    });

    // =========================================
    // 伺服器 / hash 狀態
    // =========================================
    async function checkServerStatus(url) {
        serverStatus.textContent = '🟡 檢查中...';
        serverStatus.style.color = '#f39c12';
        const targetUrl = (url || 'http://127.0.0.1:5000').replace(/\/+$/, '');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
            const res = await fetch(targetUrl + '/health', { method: 'GET', signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                serverStatus.textContent = '🟢 正常連線';
                serverStatus.style.color = '#2ecc71';
            } else {
                serverStatus.textContent = '🟠 已連線（舊版伺服器）';
                serverStatus.style.color = '#f39c12';
            }
        } catch (err) {
            clearTimeout(timeoutId);
            serverStatus.textContent = err.name === 'AbortError' ? '🔴 連線逾時' : '🔴 無法連線';
            serverStatus.style.color = '#e74c3c';
        }
    }

    function setHashStatus(text, color) {
        hashStatus.textContent = text;
        hashStatus.style.color = color;
    }

    function refreshHashStatus() {
        if (!yiiHashEnabled.checked) { setHashStatus('⏸️ 已停用', '#999'); return; }
        setHashStatus('🟡 讀取中...', '#f39c12');
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (!tabs[0]) { setHashStatus('— 無分頁', '#999'); return; }
            const r = await getYiiHashFromTab(tabs[0].id, false);
            if (r && r.hash > 0) setHashStatus(`🟢 可用（hash=${r.hash}）`, '#2ecc71');
            else if (r && r.hasPlugin) setHashStatus('🟠 尚未產生（辨識時會自動換圖取得）', '#f39c12');
            else setHashStatus('⚪ 此頁無 yiiCaptcha 外掛/hash', '#999');
        });
    }

    // =========================================
    // 手動選擇輸入框
    // =========================================
    selectBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) { alert('找不到目前的分頁，請切換到有驗證碼的網頁後再試！'); return; }
            chrome.tabs.sendMessage(tabs[0].id, { action: 'startSelecting' }, () => {
                if (chrome.runtime.lastError) {
                    alert('無法連線到網頁，請重新整理（F5）後再試！');
                }
            });
            window.close();
        });
    });

    clearBtn.addEventListener('click', () => {
        chrome.storage.local.remove('savedSelector', () => {
            fieldInfo.style.display = 'none';
            fieldName.textContent = '';
            resultDiv.style.display = 'block';
            resultDiv.className = 'success';
            resultDiv.textContent = '✅ 已清除選擇的輸入框';
        });
    });

    // =========================================
    // 手動識別
    // =========================================
    recognizeBtn.addEventListener('click', () => {
        resultDiv.style.display = 'block';
        resultDiv.className = 'loading';
        resultDiv.textContent = '⏳ 正在辨識驗證碼...';

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                resultDiv.className = 'error';
                resultDiv.textContent = '❌ 找不到目前的分頁。';
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'recognizeNow',
                autoFill: autoFill.checked
            }, (resp) => {
                if (chrome.runtime.lastError || !resp) {
                    resultDiv.className = 'error';
                    resultDiv.textContent = '❌ 無法連線到網頁，請重新整理（F5）後再試。';
                    return;
                }
                if (resp.text) {
                    resultDiv.className = 'success';
                    resultDiv.innerHTML = `✅ 識別成功：<strong style="font-size:16px;color:#7ee08a">${resp.text}</strong>`
                        + (autoFill.checked ? '<br><small style="color:#8a95a1">已自動填入輸入框</small>' : '');
                } else {
                    resultDiv.className = 'error';
                    resultDiv.textContent = '❌ 識別失敗：請確認 OCR 伺服器已啟動、驗證碼圖片存在。';
                }
            });
        });
    });
});
