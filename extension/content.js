// =========================================================================
// 🔺 只在真正需要橋接的 ibon UTK 頁面注入 inject.js（不在整個 ibon 網域執行）
// =========================================================================
// 除錯紀錄開關（由 popup 控制，預設關）：關閉時完全不記錄、不輸出。
let _debugLog = false;
window.botLogs = [];
try {
    chrome.storage.local.get(['debugLog'], d => { _debugLog = !!(d && d.debugLog); });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.debugLog) {
            _debugLog = changes.debugLog.newValue === true;
        }
    });
} catch (e) {}

// 每次載入隨機產生的橋接 token（取代固定字串，避免被頁面監聽辨識）
const IBON_BRIDGE_TOKEN = '__ts_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function injectScript() {
    try {
        let s = document.createElement('script');
        s.src = chrome.runtime.getURL('inject.js');
        s.dataset.tsToken = IBON_BRIDGE_TOKEN;
        s.onload = function() { this.remove(); };
        (document.head || document.documentElement).appendChild(s);
    } catch(e) {}
}
if (window.location.href.includes('UTK0201')) {
    if (document.documentElement) {
        injectScript();
    } else {
        document.addEventListener('DOMContentLoaded', injectScript);
    }
}

// ✅ 全局掃描器管理
let globalIBONScanner = null;

// ✅ 統一的掃描器清理函數
function stopAllScanners() {
    if (globalIBONScanner) {
        globalIBONScanner.stop();
        globalIBONScanner = null;
        extLog('⏹️ 已停止 IBON 掃描器');
    }
}

// =========================================================================
// 🛠️ 共通武器庫（只定義一次）
// =========================================================================

// ① 最底層工具（無依賴）
function randInt(min, max) { 
    return Math.floor(Math.random() * (max - min + 1)) + min; 
}
function randFloat(min, max) { 
    return Math.random() * (max - min) + min; 
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ② 文字處理
function normalizeText(str) {
    if (!str) return '';
    return str
        .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/\u3000/g, ' ')
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        .replace(/[\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
}

// ③ 日誌輸出（由 popup 的「啟用除錯紀錄」控制）
// 跨頁保留：每次只把「新產生」的紀錄附加到 storage，避免換頁覆蓋舊紀錄。
let _logFlushTimer = null;
let _flushedCount = 0;
let _flushChain = Promise.resolve();

function _flushLogs() {
    try {
        const count = window.botLogs.length;
        const pending = window.botLogs.slice(_flushedCount, count);
        if (pending.length === 0) return;
        _flushedCount = count;
        // 串行化 get→set，避免連續 flush 互相覆蓋而遺失紀錄
        _flushChain = _flushChain.then(() => new Promise(resolve => {
            try {
                chrome.storage.local.get(['tsLogs'], d => {
                    const existing = (d && d.tsLogs) || [];
                    const merged = existing.concat(pending).slice(-1500);
                    try { chrome.storage.local.set({ tsLogs: merged }, resolve); }
                    catch (e) { resolve(); }
                });
            } catch (e) { resolve(); }
        })).catch(() => {});
    } catch (e) {}
}
function _scheduleLogFlush(delay) {
    if (_logFlushTimer) return;
    _logFlushTimer = setTimeout(() => { _logFlushTimer = null; _flushLogs(); }, delay || 250);
}
// 換頁／切到背景前先寫入，避免紀錄遺失
try {
    window.addEventListener('pagehide', _flushLogs);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') _flushLogs();
    });
} catch (e) {}

function _nowStr() {
    const d = new Date();
    const p = (n, w) => String(n).padStart(w || 2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function extLog(message) {
    if (!_debugLog) return;
    const fullMsg = `[${_nowStr()}] ${message}`;
    window.botLogs.push(fullMsg);
    console.info('[TicketSniper]', fullMsg);
    _scheduleLogFlush();
}

// ⓪ 保留原生 isTrusted getter（供辨識真人點擊；不覆寫頁面 Event.prototype）
(function captureNativeIsTrusted() {
    try {
        const _nativeIsTrustedGet = Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get;
        window.__nativeIsTrusted = function(e) {
            try {
                return _nativeIsTrustedGet ? _nativeIsTrustedGet.call(e) : !!e.isTrusted;
            } catch(_) {
                return false;
            }
        };
    } catch(e) {
        window.__nativeIsTrusted = function(e) {
            try { return !!e.isTrusted; } catch(_) { return false; }
        };
    }
})();

// ④ 人類模擬輸入
async function simulateHumanInput(targetElement, value) {
    if (!targetElement) return;
    try {
        let proto = targetElement.tagName.toLowerCase() === 'select'
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
        let setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

        targetElement.dispatchEvent(new Event('focus', { bubbles: true }));
        await sleep(randInt(30, 80));

        if (setter) setter.call(targetElement, value);
        else targetElement.value = value;

        targetElement.dispatchEvent(new Event('input',  { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(randInt(20, 60));

        targetElement.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch(e) {
        extLog(`⚠️ 模擬輸入失敗: ${e.message}`);
    }
}

// ⑤ 滑鼠移動軌跡
async function moveMouseTo(el) {
    if (!el) return;
    try {
        let rect = el.getBoundingClientRect();
        let targetX = rect.left + randFloat(rect.width * 0.25, rect.width * 0.75);
        let targetY = rect.top  + randFloat(rect.height * 0.25, rect.height * 0.75);

        let steps = randInt(5, 8);
        let startX = targetX + randInt(-100, 100);
        let startY = targetY + randInt(-50, 50);

        for (let i = 0; i <= steps; i++) {
            let progress = i / steps;
            let ease = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;
            let x = startX + (targetX - startX) * ease + randFloat(-2, 2);
            let y = startY + (targetY - startY) * ease + randFloat(-2, 2);
            document.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                screenX: x + (window.screenX || 0),
                screenY: y + (window.screenY || 0)
            }));
            await sleep(randInt(10, 30));
        }
    } catch(e) {
        extLog(`⚠️ 滑鼠移動失敗: ${e.message}`);
    }
}

// ⑥ 人類模擬點擊
async function humanClick(el) {
    if (!el) return;
    try {
        await moveMouseTo(el);

        let rect = el.getBoundingClientRect();
        let cx = rect.left + randFloat(rect.width * 0.25, rect.width * 0.75);
        let cy = rect.top  + randFloat(rect.height * 0.25, rect.height * 0.75);
        
        const make = (type, extra = {}) => {
            let isPointer  = type.startsWith('pointer');
            let EventClass = isPointer ? PointerEvent : MouseEvent;
            let opts = {
                view: window, bubbles: true, cancelable: true, composed: true, buttons: 1, button: 0,
                clientX: cx, clientY: cy,
                screenX: cx + (window.screenX || 0),
                screenY: cy + (window.screenY || 0),
                ...extra
            };
            if (isPointer) { opts.pointerId = 1; opts.pointerType = 'mouse'; opts.isPrimary = true; }
            return new EventClass(type, opts);
        };
        
        el.focus();
        await sleep(randInt(10, 30));
        el.dispatchEvent(make('pointerover'));
        el.dispatchEvent(make('mouseover'));
        await sleep(randInt(20, 60));
        el.dispatchEvent(make('pointermove'));
        el.dispatchEvent(make('mousemove'));
        await sleep(randInt(15, 40));
        el.dispatchEvent(make('pointerdown'));
        el.dispatchEvent(make('mousedown'));
        await sleep(randInt(40, 100));
        el.dispatchEvent(make('pointerup'));
        el.dispatchEvent(make('mouseup'));
        await sleep(randInt(10, 30));
        el.dispatchEvent(make('click'));
        await sleep(randInt(50, 150));
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    } catch(e) {
        extLog(`⚠️ 模擬點擊失敗: ${e.message}`);
    }
}

// =========================================================================
// 🖱️ CDP 受信任點擊（由 launcher 的 control server 發送真實滑鼠事件）
//    取不到 control 設定時，呼叫端會自動退回 humanClick()。
// =========================================================================
let _controlConfig = null;

async function getControlConfig() {
    if (_controlConfig) return _controlConfig;
    try {
        const d = await storageGet(['serverUrl']);
        const base = (d.serverUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');
        const res = await fetch(base + '/config', { method: 'GET' });
        if (!res.ok) return null;
        const j = await res.json();
        if (j && j.trustedClick && j.controlUrl && j.controlToken) {
            _controlConfig = {
                url: String(j.controlUrl).replace(/\/+$/, ''),
                token: String(j.controlToken)
            };
        }
    } catch (e) {}
    return _controlConfig;
}

// 計算 <area>（image map）在畫面上的中心點
function areaClickPoint(el) {
    try {
        const map = el.parentElement;
        const coords = (el.getAttribute('coords') || '').split(',').map(n => parseFloat(n));
        const shape = (el.getAttribute('shape') || 'rect').toLowerCase();
        if (!coords.length || coords.some(isNaN)) return null;

        let img = null;
        const mapName = map && (map.getAttribute('name') || map.id);
        if (mapName) img = document.querySelector(`img[usemap="#${CSS.escape(mapName)}"]`);
        if (!img) img = document.querySelector('img[usemap]');
        if (!img) return null;

        const r = img.getBoundingClientRect();
        if (!r || r.width <= 0) return null;
        const sx = r.width / (img.naturalWidth || r.width || 1);
        const sy = r.height / (img.naturalHeight || r.height || 1);

        let lx, ly;
        if (shape === 'rect' && coords.length >= 4) {
            lx = (coords[0] + coords[2]) / 2;
            ly = (coords[1] + coords[3]) / 2;
        } else if (shape === 'circle' && coords.length >= 3) {
            lx = coords[0]; ly = coords[1];
        } else if (shape === 'poly' && coords.length >= 2) {
            lx = coords[0]; ly = coords[1];
        } else {
            return null;
        }
        return { x: r.left + lx * sx, y: r.top + ly * sy };
    } catch (e) {
        return null;
    }
}

function elementClickPoint(el) {
    try {
        if (!el || !el.tagName) return null;
        if (el.tagName.toLowerCase() === 'area') return areaClickPoint(el);
        if (el.scrollIntoView) {
            try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
        }
        const r = el.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) return null;
        const x = r.left + r.width * (0.35 + Math.random() * 0.3);
        const y = r.top + r.height * (0.35 + Math.random() * 0.3);
        if (x < 0 || y < 0) return null;
        return { x, y };
    } catch (e) {
        return null;
    }
}

async function trustedClick(el) {
    const cfg = await getControlConfig();
    if (!cfg) return false;
    const pt = elementClickPoint(el);
    if (!pt) return false;
    try {
        const res = await fetch(cfg.url + '/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-TS-Token': cfg.token },
            body: JSON.stringify({ x: pt.x, y: pt.y, href: location.href })
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

// 優先使用 CDP 受信任點擊，失敗才退回合成事件
async function clickElement(el) {
    if (!el) return false;
    try {
        if (await trustedClick(el)) {
            extLog('🖱️ CDP 受信任點擊');
            await sleep(randInt(30, 90));
            return true;
        }
    } catch (e) {}
    await humanClick(el);
    return true;
}

// 勾選 checkbox 並確認真的被勾選（Angular 常不會即時反映，需重試／用原生 setter）
function setNativeChecked(el, checked) {
    try {
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked');
        if (desc && desc.set) desc.set.call(el, checked);
        else el.checked = checked;
    } catch (e) {
        try { el.checked = checked; } catch (_) {}
    }
}

async function ensureChecked(cb) {
    if (!cb) return false;
    for (let i = 0; i < 4; i++) {
        if (cb.checked) return true;
        // 1) 原生 .click()（會 toggle 並觸發 change，Angular 才會更新）
        try { cb.click(); } catch (e) {}
        await sleep(150);
        if (cb.checked) return true;
        // 2) 第二輪起：CDP 受信任點擊（launcher 模式）
        if (i >= 1) {
            try { await clickElement(cb); } catch (e) {}
            await sleep(150);
            if (cb.checked) return true;
        }
        // 3) 第三輪起：原生 setter + input/change/click 事件
        if (i >= 2) {
            try {
                setNativeChecked(cb, true);
                cb.dispatchEvent(new Event('input', { bubbles: true }));
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
            await sleep(120);
            if (cb.checked) return true;
        }
    }
    return !!cb.checked;
}

// ⑦ 判斷數量選擇器
function isQuantitySelect(sel) {
    if (!sel) return false;
    let name = (sel.name || sel.id || '').toLowerCase();
    if (/ticketcount|ticket.*count|qty|quantity|amount/i.test(name)) return true;
    let opts = Array.from(sel.options).map(o => o.value.trim().toLowerCase());
    return (
        opts.some(v => /^\d+$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 10) ||
        opts.some(v => /qty|num|count|張|ticket/i.test(v)) ||
        Array.from(sel.options).some(o => /^\d+\s*張/.test(o.text.trim()))
    );
}

// ⑧ 不規則間隔執行
function makeIrregularInterval(callback, baseMs, jitterMs) {
    let stopped = false;
    let timerId;
    
    function next() {
        if (stopped) return;
        let delay;
        if (Math.random() < 0.08) {
            delay = randInt(2000, 3000);
            extLog('⏸️ 模擬真人停頓...');
        } else {
            delay = Math.max(50, baseMs + randInt(-jitterMs, jitterMs));
        }
        timerId = setTimeout(async () => {
            try { 
                await callback(); 
            } catch(e) { 
                if (_debugLog) console.error(e); 
            }
            next();
        }, delay);
    }
    
    next();
    
    return { 
        stop() { 
            stopped = true; 
            clearTimeout(timerId); 
        },
        resume() {
            if (stopped) {
                stopped = false;
                next();
            }
        },
        isStopped() {
            return stopped;
        }
    };
}

// ⑨ 自動重整
window.isReloading = false;
async function triggerAutoReload(autoReloadOpt) {
    if (window.isReloading || !autoReloadOpt) return;
    window.isReloading = true;
    let waitTime = randInt(5000, 15000);
    extLog(`🔄 [重整] 售完或無目標，${Math.round(waitTime/1000)}秒後自動重整...`);
    await sleep(waitTime);
    window.location.reload();
}

// =========================================================================
// 🎯 關鍵字引擎（參考 tickets_hunter）
//   - `;` 或 `,` 分組 = OR，由左至右優先；同一組內「空白」= AND
//   - 排除字（黑名單）先過濾；支援選區順序模式與找不到時自動遞補
// =========================================================================
const DEFAULT_EXCLUDE_KEYWORDS = '輪椅;身障;身心;障礙;Restricted View;燈柱遮蔽;視線不完整';
const SOLD_OUT_KEYWORDS = ['售完', '已售完', '選購一空', 'sold out', 'soldout', 'no tickets',
    'no tickets available', '暫無票', '暫無票券', '空席なし', '完売'];
const NOT_OPEN_KEYWORDS = ['未開賣', '尚未開賣', '尚未開始', '即將開賣', 'not started',
    'not yet', '尚未開放', '尚未販售', 'coming soon'];

function parseKeywordGroups(str) {
    if (!str) return [];
    let s = String(str).trim();
    if (!s) return [];
    if (s.startsWith('[')) {
        try {
            let arr = JSON.parse(s);
            if (Array.isArray(arr)) return arr.map(x => String(x)).filter(x => x.trim());
        } catch (e) {}
    }
    return s.split(/[;,，]/).map(x => x.trim()).filter(Boolean);
}

function matchTextAllTerms(text, group) {
    if (!text) return false;
    let terms = String(group).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    let t = normalizeText(text);
    return terms.every(term => t.includes(normalizeText(term)));
}

function isExcludedText(text, excludeGroups) {
    if (!text || !excludeGroups || excludeGroups.length === 0) return false;
    return excludeGroups.some(g => matchTextAllTerms(text, g));
}

function isUnavailableText(text) {
    if (!text) return true;
    let t = normalizeText(text);
    if (SOLD_OUT_KEYWORDS.some(k => t.includes(normalizeText(k)))) return true;
    if (NOT_OPEN_KEYWORDS.some(k => t.includes(normalizeText(k)))) return true;
    return false;
}

// 以「完整 class token」判斷，避免 full-width / disabled-x 之類的誤判
function hasUnavailableClass(el) {
    if (!el || !el.className) return false;
    let raw = typeof el.className === 'string' ? el.className : '';
    if (!raw) return false;
    return raw.toLowerCase().split(/\s+/).some(t =>
        t === 'disabled' || t === 'full' || t === 'unavailable' ||
        (t.includes('sold') && t.includes('out'))
    );
}

function selectIndexByMode(len, mode) {
    if (len <= 0) return -1;
    switch (String(mode || '').replace(/_/g, ' ').toLowerCase()) {
        case 'from bottom to top': return len - 1;
        case 'center': return Math.floor(len / 2);
        case 'random': return randInt(0, len - 1);
        default: return 0; // from top to bottom
    }
}

// =========================================================================
// 🔊 成功提示音（WebAudio，無需音檔）
// =========================================================================
let _audioCtx = null;
function playBeep(type) {
    if (!window.__tsPlaySound) return;
    try {
        _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _audioCtx;
        const seq = type === 'order' ? [784, 1175] : [880];
        let t0 = ctx.currentTime;
        seq.forEach(freq => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
            o.start(t0);
            o.stop(t0 + 0.24);
            t0 += 0.16;
        });
    } catch (e) {}
}

// =========================================================================
// 🟠 IBON 專用函數
// =========================================================================

// =========================================================================
// ✅ 穿透 Shadow DOM 輔助函數（僅 IBON 使用）
// =========================================================================
function findAllInShadow(selector) {
    let results = [];
    document.querySelectorAll(selector).forEach(el => results.push(el));
    if (results.length > 0) return results;
    document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
            el.shadowRoot.querySelectorAll(selector).forEach(el2 => results.push(el2));
        }
    });
    return results;
}

// =========================================================================
// ✅ 修正：analyzeKeywordType - 支援多關鍵字 + priorityList
// =========================================================================
function analyzeKeywordType(keywords) {
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return { 
            type: 'NONE', 
            value: null, 
            allKeywords: [],
            priceKeywords: [],
            zoneKeywords: [],
            priorityList: []
        };
    }
    
    let priceKeywords = [];
    let zoneKeywords = [];
    let priorityList = [];
    
    for (let kw of keywords) {
        let trimmed = kw.trim();
        if (!trimmed) continue;
        
        if (/^\d+$/.test(trimmed)) {
            let num = parseInt(trimmed);
            if (num >= 100) {
                priceKeywords.push(num);
                priorityList.push({ type: 'PRICE', value: num, original: trimmed });
                continue;
            }
        }
        
        if (trimmed.includes('樓') || trimmed.includes('區') || 
            trimmed.includes('包廂') || trimmed.includes('席') ||
            trimmed.includes('M樓')) {
            zoneKeywords.push(trimmed);
            priorityList.push({ type: 'ZONE', value: trimmed, original: trimmed });
            continue;
        }
        
        let cleanNum = trimmed.replace(/,/g, '');
        if (/^\d+$/.test(cleanNum)) {
            let num = parseInt(cleanNum);
            if (num >= 100) {
                priceKeywords.push(num);
                priorityList.push({ type: 'PRICE', value: num, original: trimmed });
                continue;
            }
        }
        
        zoneKeywords.push(trimmed);
        priorityList.push({ type: 'ZONE', value: trimmed, original: trimmed });
    }
    
    let primaryType = 'NONE';
    let primaryValue = null;
    
    if (priceKeywords.length > 0) {
        primaryType = 'PRICE';
        primaryValue = priceKeywords[0];
    } else if (zoneKeywords.length > 0) {
        primaryType = 'ZONE';
        primaryValue = zoneKeywords[0];
    }
    
    return {
        type: primaryType,
        value: primaryValue,
        allKeywords: keywords,
        priceKeywords: priceKeywords,
        zoneKeywords: zoneKeywords,
        priorityList: priorityList
    };
}

// =========================================================================
// ✅ IBON 表格解析（從 jsonData 解析）
// 只掃描 <script> 節點文字，避免每次序列化整份 DOM
// =========================================================================
let _lastIBONParseCount = -1;
let _noJsonDataLogged = false;
function parseIBONTableFromHTML() {
    let jsonStr = null;
    let scripts = document.querySelectorAll('script');
    for (let s of scripts) {
        let text = s.textContent || '';
        if (text.indexOf('jsonData') === -1) continue;
        let m = text.match(/jsonData\s*=\s*'([^']*)'/);
        if (m) { jsonStr = m[1]; break; }
    }

    if (!jsonStr) {
        if (!_noJsonDataLogged) {
            _noJsonDataLogged = true;
            extLog('⚠️ [解析] 找不到 jsonData');
        }
        return [];
    }
    _noJsonDataLogged = false;

    jsonStr = jsonStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    try {
        let jsonData = JSON.parse(jsonStr);
        if (!Array.isArray(jsonData)) {
            extLog('⚠️ [解析] jsonData 不是陣列');
            return [];
        }

        let result = jsonData.map(item => ({
            tr: null,
            zoneName: item.NAME || '',
            priceText: item.PRICE_STR || '',
            price: item.PRICE || 0,
            seatText: item.AMOUNT || '',
            isDisabled: item.BACKGROUND_COLOR === 'disabled' || item.AMOUNT === '已售完',
            id: item.PERFORMANCE_PRICE_AREA_ID || '',
            rel: item.GROUP_ID || ''
        }));

        if (result.length !== _lastIBONParseCount) {
            _lastIBONParseCount = result.length;
            extLog(`✅ [解析] 從 jsonData 解析到 ${result.length} 行表格資料`);
        }
        return result;
    } catch(e) {
        extLog(`⚠️ [解析] JSON 解析失敗: ${e.message}`);
        return [];
    }
}

// =========================================================================
// ✅ 點擊表格行（先模擬滑鼠行為，再執行 callSend）
// =========================================================================
async function clickIBONTableRow(rowData) {
    if (!rowData) return false;

    extLog(`🖱️ [IBON] 嘗試點擊：${rowData.zoneName} (id=${rowData.id}, rel=${rowData.rel})`);

    let rel = rowData.rel;
    if (!rel) {
        extLog(`❌ [IBON] 沒有 rel 屬性，無法點擊`);
        return false;
    }

    let areaIds = rel.split(' ');
    let targetArea = null;

    // 找出第一個可用的 area
    for (let areaId of areaIds) {
        let area = document.querySelector(`area[id="${areaId}"]`);
        if (area) {
            targetArea = area;
            break;
        }
    }

    if (!targetArea) {
        extLog(`❌ [IBON] 找不到任何 area 元素`);
        return false;
    }

    // ✅ 優先用 CDP 受信任點擊（image map 以座標換算後點擊）
    try {
        if (await trustedClick(targetArea)) {
            extLog(`✅ [IBON] CDP 受信任點擊 (area=${targetArea.id})`);
            await sleep(randInt(100, 300));
            return true;
        }
    } catch(e) {
        extLog(`⚠️ [IBON] 受信任點擊失敗: ${e.message}`);
    }

    // ✅ 步驟1：模擬滑鼠移動到 area（產生真實軌跡）
    try {
        await moveMouseTo(targetArea);
        extLog(`✅ [IBON] 滑鼠已移動到 area`);
    } catch(e) {
        extLog(`⚠️ [IBON] 滑鼠移動失敗: ${e.message}`);
    }

    // 短暫停頓，模擬人類觀察
    await sleep(randInt(100, 300));

    // ✅ 步驟2：執行 callSend，真正觸發 Send
    let href = targetArea.getAttribute('href') || '';
    if (href && href.includes('Send')) {
        let script = href.replace(/^javascript:/i, '').trim();
        if (script) {
            try {
                let success = callSend(script);
                if (success) {
                    extLog(`✅ [IBON] callSend 點擊成功 (area=${targetArea.id})`);
                    return true;
                } else {
                    extLog(`⚠️ [IBON] callSend 返回 false，可能未執行`);
                }
            } catch(e) {
                extLog(`⚠️ [IBON] callSend 失敗: ${e.message}`);
            }
        }
    }

    // ✅ 步驟3：如果 callSend 失敗，嘗試直接執行 eval（備案）
    try {
        let script = href.replace(/^javascript:/i, '').trim();
        if (script) {
            eval(script);
            extLog(`✅ [IBON] eval 執行成功 (area=${targetArea.id})`);
            return true;
        }
    } catch(e) {
        extLog(`⚠️ [IBON] eval 失敗: ${e.message}`);
    }

    extLog(`❌ [IBON] 所有點擊方法都失敗`);
    return false;
}

// =========================================================================
// ✅ IBON 數量頁自動設定張數
// =========================================================================
async function runIBONQty(settings) {
    const dropdownValue = settings.dropdownValue || "1";
    
    extLog(`📋 [IBON-QTY] 設定購買數量：${dropdownValue}`);
    
    let waitStart = Date.now();
    let dropdown = null;
    while (Date.now() - waitStart < 3000) {
        dropdown = document.querySelector('select[name*="AMOUNT_DDL"]');
        if (!dropdown) {
            dropdown = document.querySelector('select[id*="AMOUNT_DDL"]');
        }
        if (!dropdown) {
            dropdown = document.querySelector('select[name*="Qty"], select[name*="qty"]');
        }
        if (dropdown) {
            break;
        }
        await sleep(200);
    }
    
    if (dropdown) {
        try {
            dropdown.value = String(dropdownValue);
            dropdown.dispatchEvent(new Event('change', { bubbles: true }));
            dropdown.dispatchEvent(new Event('input', { bubbles: true }));
            extLog(`✅ [IBON-QTY] 已設定購買數量：${dropdownValue}`);
            
            if (globalIBONScanner) {
                globalIBONScanner.stop();
                globalIBONScanner = null;
            }
            
            return true;
        } catch(e) {
            extLog(`⚠️ [IBON-QTY] 設定數量失敗：${e.message}`);
        }
    } else {
        extLog(`⚠️ [IBON-QTY] 找不到數量選擇器`);
        let allSelects = document.querySelectorAll('select');
        extLog(`🔍 [除錯] 頁面上有 ${allSelects.length} 個 select：`);
        allSelects.forEach((s, i) => {
            extLog(`  ${i+1}. name=${s.name || '(無)'}, id=${s.id || '(無)'}, options=${s.options.length}`);
        });
    }
    
    return false;
}

// =========================================================================
// ✅ IBON 步驟偵測
// =========================================================================
function detectIBONStep() {
    let pageText = document.body ? document.body.textContent || '' : '';
    
    if (pageText.includes('確認訂單')) {
        return 'STEP_CONFIRM';
    }
    
    let areas = document.querySelectorAll('area[href*="Send"], area[onclick*="Send"]');
    let tableRows = findAllInShadow('tr[rel]');
    if (areas.length > 0 || tableRows.length > 0) {
        return 'STEP_SELECT_ZONE';
    }
    
    let amountSelects = document.querySelectorAll('select[name*="AMOUNT_DDL"]');
    let qtySelects = document.querySelectorAll('select[name*="Qty"], select[name*="qty"]');
    if (amountSelects.length > 0 || qtySelects.length > 0 || pageText.includes('購買張數')) {
        return 'STEP_SELECT_QTY';
    }
    
    return 'STEP_WAITING';
}

// =========================================================================
// ✅ IBON 模式偵測
// =========================================================================
function detectIBONSelectionMode() {
    let url = window.location.href;
    if (!url.includes('UTK0201_000')) {
        return 'UNKNOWN';
    }
    
    let tableRows = parseIBONTableFromHTML();
    
    if (tableRows.length > 0) {
        extLog(`🔍 [偵測模式] ✅ 表格模式 (${tableRows.length} 行，從 HTML 解析)`);
        return 'TABLE_MODE';
    }

    let areas = document.querySelectorAll('area[href*="Send"], area[onclick*="Send"]');
    if (areas.length > 0) {
        extLog(`🔍 [偵測模式] 地圖模式 (${areas.length} 個區域)`);
        return 'MAP_MODE';
    }

    extLog(`🔍 [偵測模式] ❌ 未知模式`);
    return 'UNKNOWN';
}

// =========================================================================
// ✅ IBON 輔助函數
// =========================================================================
function isDynamicMap() {
    let el = document.getElementById('ctl00_ContentPlaceHolder1_show_dynamic_map');
    if (!el) return false;
    return el.value != '0' && el.value !== '' && el.value != null;
}

function callSend(actionStr) {
    if (!actionStr) return false;
    if (isDynamicMap()) return false;
    if (!actionStr.includes('Send')) return false;
    let script = actionStr.replace(/^javascript:/i, '').trim();
    extLog(`🚀 [IBON] 靜態地圖橋接：${script.slice(0, 60)}`);
    window.postMessage({
        type: IBON_BRIDGE_TOKEN,
        script: script
    }, '*');
    return true;
}

function patchIbonErrors() {
    // 僅在 ibon UTK 選位頁面處理；不在整個 ibon 網域留下任何 DOM 變更
    if (!window.location.href.includes('UTK0201')) return;
    if (window.__patchedIbonErrors) return;
    window.__patchedIbonErrors = true;

    try {
        let container = document.body || document.documentElement;
        if (!container) return;
        ['performanceId', 'productId', 'eventId'].forEach(id => {
            if (!document.getElementById(id)) {
                let div = document.createElement('div');
                div.id = id;
                div.style.display = 'none';
                container.appendChild(div);
            }
        });
    } catch (e) {}
}

// =========================================================================
// 🟠 IBON 完整版（選區 + 數量頁整合）
// =========================================================================
// 偵測 IBON 的 WAF／Cloudflare 頁面，讓 LOG 明確顯示「被擋」而非只有找不到資料
function detectIbonWafPage() {
    try {
        const t = (document.body ? document.body.innerText : '') || '';
        const restricted = ['連線暫時受限', 'Access Temporarily Restricted', '暫時停止操作',
            'unusual activity', '異常活動', '錯誤參考編號'];
        if (restricted.some(m => t.includes(m))) return 'RESTRICTED';
        const cf = ['正在驗證您是否是人類', 'Verify you are human', 'Just a moment',
            'Checking your browser', '正在檢查您的瀏覽器'];
        if (cf.some(m => t.includes(m))) return 'CLOUDFLARE';
        return null;
    } catch (e) {
        return null;
    }
}

async function runIBON(settings) {
    patchIbonErrors();

    const waf = detectIbonWafPage();
    if (waf) {
        extLog(waf === 'RESTRICTED'
            ? '⛔ [IBON] 偵測到「連線暫時受限 / Access Temporarily Restricted」WAF 頁面，停止自動化（請冷卻或換 IP）'
            : '⛔ [IBON] 偵測到 Cloudflare 驗證頁面，停止自動化（需手動或 Cloudflare 處理）');
        return;
    }

    if (settings.ibonAuto === false) {
        extLog('ℹ️ [IBON] 擴充自動化已關閉（改用 launcher CDP 模式）');
        return;
    }
    
    const autoClickZone = settings.autoClickZone === true;
    const zoneKeywords = settings.zoneKeywords || "";
    const dropdownValue = settings.dropdownValue || "1";
    const autoReload = settings.autoReload === true || settings.autoReload === 'true';
    const excludeGroups = parseKeywordGroups(settings.keywordExclude || DEFAULT_EXCLUDE_KEYWORDS);
    
    let url = window.location.href;
    
    // ✅ 數量頁：直接設定張數
    if (url.includes('UTK0201_001')) {
        extLog(`📋 [IBON] 數量頁，設定張數：${dropdownValue}`);
        await runIBONQty(settings);
        return;
    }
    
    // ✅ 確認頁或完成頁：停止掃描
    if (url.includes('UTK0201_005') || url.includes('UTK0206')) {
        extLog(`🎉 [IBON] 已到達確認/完成頁，停止掃描`);
        if (globalIBONScanner) {
            globalIBONScanner.stop();
            globalIBONScanner = null;
        }
        return;
    }
    
    // ✅ 只在選區頁面執行以下邏輯
    if (!url.includes('UTK0201_000')) {
        extLog(`⏸️ [IBON] 非選區頁面 (${url})，不執行`);
        return;
    }
    
    extLog(`🚀 [IBON] ════════════════════════════════════════`);
    extLog(`🚀 [IBON] 啟動設定`);
    extLog(`🚀 [IBON] 自動選區：${autoClickZone ? '✅ 開' : '❌ 關'}`);
    extLog(`🚀 [IBON] 目標：${zoneKeywords || '(未設定)'}`);
    extLog(`🚀 [IBON] 購買張數：${dropdownValue}`);
    extLog(`🚀 [IBON] 自動重整：${autoReload ? '✅ 開' : '❌ 關'}`);
    extLog(`🚀 [IBON] ════════════════════════════════════════`);
 
    // ✅ 等待表格載入（最多等待 3 秒）
    let waitStart = Date.now();
    let tableRows = [];
    while (Date.now() - waitStart < 3000) {
        tableRows = parseIBONTableFromHTML();
        extLog(`🔍 [等待] 已抓取 ${tableRows.length} 行資料`);
        if (tableRows.length > 0) {
            let available = tableRows.filter(r => !r.isDisabled && r.seatText !== '已售完');
            extLog(`✅ [IBON] 找到 ${tableRows.length} 行，可用 ${available.length} 行`);
            if (available.length > 0) {
                break;
            }
        }
        await sleep(200);
    }
    
    if (tableRows.length === 0) {
        extLog(`⚠️ [IBON] 等待 3 秒後仍未載入表格，停止掃描`);
        let bodyHtml = document.body.innerHTML;
        let match = bodyHtml.match(/<table[^>]*class="[^"]*table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
        if (match) {
            extLog(`🔍 [IBON] 在 body 中找到 table，長度: ${match[1].length}`);
        }
        return;
    }

    let keywords = parseKeywordGroups(zoneKeywords);

    let keywordInfo = analyzeKeywordType(keywords);
    
    extLog(`💰 [關鍵字分析] 主要類型：${keywordInfo.type}，主值：${keywordInfo.value}`);
    
    if (!keywordInfo.priorityList || keywordInfo.priorityList.length === 0) {
        extLog(`⚠️ [關鍵字分析] 沒有有效的關鍵字`);
        keywordInfo.priorityList = [];
    } else {
        extLog(`💰 [關鍵字分析] 優先級順序（共 ${keywordInfo.priorityList.length} 個）：`);
        keywordInfo.priorityList.forEach((item, idx) => {
            extLog(`  ${idx+1}. ${item.type === 'PRICE' ? '💰 票價' : '🏷️ 票區'}：${item.value}`);
        });
    }

    let state = {
        lastStep: '',
        attempts: 0,
        clicked: false,
        clickedAt: 0,
        qtyDone: false,
        noKwLogShown: false,
        noHitLogShown: false,
        lastAreaCount: -1,
        startTime: null,
        selectionMode: null,
        lastDOM: null,
        keywordType: keywordInfo.type || 'NONE',
        keywordValue: keywordInfo.value || null,
        priceKeywords: keywordInfo.priceKeywords || [],
        zoneKeywords: keywordInfo.zoneKeywords || [],
        priorityList: keywordInfo.priorityList || [],
        scanCompleted: false,
        manualClickPromptShown: false,
        isProcessing: false,
        lastMatchedCount: 0,
        matchAttempts: 0,
        checkedPriorityIndex: 0,
        clickStartTime: 0,
        clickAttempted: false,
        stopScanning: false,
        scanStartTime: 0,
        maxScanDuration: 2000
    };

    if (globalIBONScanner) {
        extLog(`⏹️ [IBON] 停止舊掃描器`);
        globalIBONScanner.stop();
        globalIBONScanner = null;
    }

    globalIBONScanner = makeIrregularInterval(async () => {
        if (state.stopScanning) {
            return;
        }
        
        if (state.scanStartTime > 0) {
            let elapsed = Date.now() - state.scanStartTime;
            if (elapsed > state.maxScanDuration) {
                extLog(`⏹️ [IBON] 掃描超過 ${state.maxScanDuration/1000} 秒，自動停止`);
                state.stopScanning = true;
                globalIBONScanner.stop();
                globalIBONScanner = null;
                return;
            }
        }
        
        if (state.isProcessing || window.isReloading) return;
        state.isProcessing = true;

        try {
            let step = detectIBONStep();

            if (step === 'STEP_WAITING') {
                if (state.lastStep !== 'STEP_WAITING') {
                    extLog(`\n⏸️ [IBON] 進入等待狀態，停止掃描`);
                    extLog(`⏸️ [IBON] 請前往搶票頁面\n`);
                    globalIBONScanner.stop();
                    globalIBONScanner = null;
                }
                state.isProcessing = false;
                return;
            }

            if (step !== state.lastStep) {
                extLog(`\n📄 ════════════════════════════════════════`);
                extLog(`📄 [IBON] 步驟切換：${state.lastStep || '【初始】'} → ${step}`);
                extLog(`📄 ════════════════════════════════════════\n`);
                state.lastStep = step;
                state.selectionMode = detectIBONSelectionMode();

                if (step === 'STEP_SELECT_ZONE') {
                    state.clicked = false;
                    state.clickedAt = 0;
                    state.attempts = 0;
                    state.noHitLogShown = false;
                    state.lastAreaCount = -1;
                    state.startTime = null;
                    state.manualClickPromptShown = false;
                    state.lastMatchedCount = 0;
                    state.matchAttempts = 0;
                    state.checkedPriorityIndex = 0;
                    state.clickStartTime = 0;
                    state.clickAttempted = false;
                    state.stopScanning = false;
                    state.scanStartTime = Date.now();
                    extLog(`✅ [IBON] 進入選區步驟，模式：${state.selectionMode}`);
                }

                if (step === 'STEP_SELECT_QTY') {
                    state.qtyDone = false;
                    extLog(`✅ [IBON] 進入數量步驟`);
                }
            }

            if (step === 'STEP_SELECT_ZONE') {
                if (!autoClickZone) {
                    if (!state.manualClickPromptShown) {
                        extLog(`\n🔍 ════════════════════════════════════════`);
                        extLog(`🔍 [IBON] 自動選區已關閉`);
                        extLog(`👆 [提示] 請手動點擊要購買的票區`);
                        extLog(`🔍 ════════════════════════════════════════\n`);
                        state.manualClickPromptShown = true;
                    }
                    state.isProcessing = false;
                    return;
                }

                if (state.clicked) {
                    let elapsedMs = Date.now() - state.clickedAt;
                    
                    if (elapsedMs > 3000) {
                        let nextStep = detectIBONStep();
                        if (nextStep === 'STEP_SELECT_QTY' || nextStep === 'STEP_CONFIRM') {
                            extLog(`✅ [IBON] 點擊成功，已跳轉到 ${nextStep}，停止掃描`);
                            state.stopScanning = true;
                            globalIBONScanner.stop();
                            globalIBONScanner = null;
                            state.isProcessing = false;
                            return;
                        } else {
                            extLog(`⚠️ [IBON] 點擊後 3 秒無反應，解鎖重試`);
                            state.clicked = false;
                            state.clickedAt = 0;
                            state.clickAttempted = false;
                        }
                    } else {
                        state.isProcessing = false;
                        return;
                    }
                }

                if (state.keywordType === 'NONE' || state.priorityList.length === 0) {
                    if (!state.noKwLogShown) {
                        extLog('⚠️ [IBON] 自動選區已開啟，但未設定目標 → 請手動點選');
                        state.noKwLogShown = true;
                    }
                    state.isProcessing = false;
                    return;
                }

                if (state.selectionMode === 'UNKNOWN') {
                    state.isProcessing = false;
                    return;
                }

                if (!state.startTime) state.startTime = Date.now();
                state.attempts++;

                // ─── 表格模式（強制優先） ───
                if (state.selectionMode === 'TABLE_MODE') {
                    extLog(`\n📊 [表格模式] 掃描 #${state.attempts}`);

                    let allRows = parseIBONTableFromHTML();
                    
                    let availableRows = allRows.filter(row => {
                        if (row.isDisabled) return false;
                        if (row.seatText === '已售完' || row.seatText === '') return false;
                        return true;
                    });

                    if (allRows.length !== state.lastAreaCount) {
                        state.lastAreaCount = allRows.length;
                        extLog(`📊 [掃描] 找到 ${allRows.length} 行，可用 ${availableRows.length} 行`);
                    }

                    if (availableRows.length === 0) {
                        if (!state.noHitLogShown) {
                            extLog(`⚠️ [IBON] 所有表格票區已售完，停止掃描`);
                            state.noHitLogShown = true;
                        }
                        state.stopScanning = true;
                        globalIBONScanner.stop();
                        globalIBONScanner = null;
                        state.isProcessing = false;
                        return;
                    }

                    if (state.attempts % 2 === 0 && availableRows.length > 0) {
                        let debugLimit = Math.min(availableRows.length, 5);
                        extLog(`📊 [DEBUG] 可用區域前 ${debugLimit} 個：`);
                        for (let i = 0; i < debugLimit; i++) {
                            let row = availableRows[i];
                            extLog(`  ${i+1}. ${row.zoneName} (票價 ${row.price}) 空位: ${row.seatText}`);
                        }
                    }

                    let matchedRows = [];

                    for (let pIdx = 0; pIdx < state.priorityList.length; pIdx++) {
                        let target = state.priorityList[pIdx];
                        
                        for (let row of availableRows) {
                            let zoneName = normalizeText(row.zoneName);
                            let price = row.price;

                            // 先套用排除關鍵字（輪椅/身障/視線不完整…）
                            if (isExcludedText(row.zoneName, excludeGroups)) {
                                continue;
                            }

                            let isMatch = false;
                            
                            if (target.type === 'PRICE') {
                                if (price === target.value) {
                                    isMatch = true;
                                }
                            } else {
                                if (zoneName.includes(normalizeText(target.value))) {
                                    isMatch = true;
                                }
                            }
                            
                            if (isMatch) {
                                matchedRows.push({
                                    row: row,
                                    price: price,
                                    zoneName: row.zoneName,
                                    id: row.id,
                                    rel: row.rel,
                                    priorityIndex: pIdx,
                                    target: target
                                });
                                extLog(`  🎯 匹配關鍵字 #${pIdx+1} (${target.type === 'PRICE' ? '💰票價' : '🏷️票區'} ${target.value})：${row.zoneName} (票價 ${price})`);
                            }
                        }
                        
                        if (matchedRows.length > 0) {
                            break;
                        }
                    }

                    if (matchedRows.length > 0) {
                        state.noHitLogShown = false;
                        
                        matchedRows.sort((a, b) => {
                            if (b.price !== a.price) return b.price - a.price;
                            let aSeat = parseInt(a.row.seatText) || 0;
                            let bSeat = parseInt(b.row.seatText) || 0;
                            return bSeat - aSeat;
                        });
                        let best = matchedRows[0];
                        
                        extLog(`\n🎯 ════════════════════════════════════════`);
                        extLog(`🎯 [IBON] 🎯 最終選擇：${best.zoneName}`);
                        extLog(`🎯 [IBON] 票價：${best.price}`);
                        extLog(`🎯 [IBON] 匹配關鍵字 #${best.priorityIndex+1}：${best.target.value}`);
                        extLog(`🎯 ════════════════════════════════════════\n`);

                        state.clicked = true;
                        state.clickedAt = Date.now();
                        state.clickAttempted = true;

                        await sleep(randInt(200, 500));

                        let success = await clickIBONTableRow(best.row);
                        if (success) {
                            extLog(`✅ [IBON] 點擊成功！等待跳轉...`);
                            state.isProcessing = false;
                            return;
                        }
                        
                        extLog(`⚠️ [IBON] 點擊失敗，嘗試直接執行 area`);
                        let rel = best.row.rel;
                        if (rel) {
                            let areaIds = rel.split(' ');
                            for (let areaId of areaIds) {
                                let area = document.querySelector(`area[id="${areaId}"]`);
                                if (area) {
                                    let href = area.getAttribute('href') || '';
                                    if (href && href.includes('Send')) {
                                        try {
                                            let script = href.replace(/^javascript:/i, '').trim();
                                            eval(script);
                                            extLog(`✅ [IBON] 直接執行成功！`);
                                            state.isProcessing = false;
                                            return;
                                        } catch(e) {}
                                    }
                                }
                            }
                        }
                        
                        extLog(`⚠️ [IBON] 所有點擊方法都失敗，停止掃描`);
                        state.stopScanning = true;
                        globalIBONScanner.stop();
                        globalIBONScanner = null;
                        state.isProcessing = false;
                        return;
                    }

                    if (!state.noHitLogShown) {
                        extLog(`⚠️ [IBON] 所有關鍵字都無匹配區域，停止掃描`);
                        state.noHitLogShown = true;
                    }
                    
                    state.stopScanning = true;
                    globalIBONScanner.stop();
                    globalIBONScanner = null;
                    state.isProcessing = false;
                    return;

                } else if (state.selectionMode === 'MAP_MODE') {
                    extLog(`⚠️ [IBON] 地圖模式，等待表格載入...`);
                    let waitStart2 = Date.now();
                    while (Date.now() - waitStart2 < 5000) {
                        let rows = parseIBONTableFromHTML();
                        if (rows.length > 0) {
                            extLog(`✅ [IBON] 表格已載入，重新檢測模式`);
                            state.selectionMode = detectIBONSelectionMode();
                            state.isProcessing = false;
                            return;
                        }
                        await sleep(200);
                    }
                    extLog(`⚠️ [IBON] 等待表格逾時，停止掃描`);
                    state.stopScanning = true;
                    globalIBONScanner.stop();
                    globalIBONScanner = null;
                    state.isProcessing = false;
                    return;
                }

                let elapsed = Date.now() - state.startTime;
                if (elapsed > 3000) {
                    extLog(`⛔ [IBON] 已等待 ${Math.round(elapsed / 1000)} 秒未找到，停止掃描`);
                    state.stopScanning = true;
                    globalIBONScanner.stop();
                    globalIBONScanner = null;
                }
                state.isProcessing = false;
                return;
            }

            // ─────────────────────────────────────────────
            // STEP_SELECT_QTY（理論上不會在這裡執行，因為數量頁已被攔截）
            // ─────────────────────────────────────────────
            if (step === 'STEP_SELECT_QTY') {
                if (state.qtyDone) {
                    state.isProcessing = false;
                    return;
                }

                extLog(`\n📋 [IBON] 設定購買數量：${dropdownValue}`);

                let dropdown = document.querySelector('select[name*="AMOUNT_DDL"]');
                if (!dropdown) {
                    dropdown = document.querySelector('select[id*="AMOUNT_DDL"]');
                }
                if (!dropdown) {
                    dropdown = document.querySelector('select[name*="Qty"], select[name*="qty"]');
                }

                if (dropdown) {
                    try {
                        dropdown.value = String(dropdownValue);
                        dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                        dropdown.dispatchEvent(new Event('input', { bubbles: true }));
                        extLog(`✅ [IBON] 已設定購買數量：${dropdownValue}`);
                        state.qtyDone = true;
                        
                        state.stopScanning = true;
                        if (globalIBONScanner) {
                            globalIBONScanner.stop();
                            globalIBONScanner = null;
                        }
                        extLog(`⏹️ [IBON] 數量已設定，停止掃描`);
                        
                        await sleep(randInt(300, 800));
                    } catch(e) {
                        extLog(`⚠️ [IBON] 設定數量失敗：${e.message}`);
                    }
                } else {
                    extLog(`⚠️ [IBON] 找不到數量選擇器`);
                    state.stopScanning = true;
                    if (globalIBONScanner) {
                        globalIBONScanner.stop();
                        globalIBONScanner = null;
                    }
                    let allSelects = document.querySelectorAll('select');
                    extLog(`🔍 [除錯] 頁面上有 ${allSelects.length} 個 select：`);
                    allSelects.forEach((s, i) => {
                        extLog(`  ${i+1}. name=${s.name || '(無)'}, id=${s.id || '(無)'}, options=${s.options.length}`);
                    });
                }
                
                state.isProcessing = false;
                return;
            }

            if (step === 'STEP_CONFIRM') {
                extLog('🎉 [IBON] 已到達確認頁，停止掃描');
                state.stopScanning = true;
                globalIBONScanner.stop();
                globalIBONScanner = null;
                state.isProcessing = false;
                return;
            }

        } catch (err) {
            extLog(`⚠️ [IBON] 掃描錯誤：${err.message}`);
        }

        state.isProcessing = false;

    }, 300, 150);
}

// =========================================================================
// ⑪ 平台偵測（只定義一次）
// =========================================================================
function detectPlatform() {
    let host = window.location.hostname;
    let url = window.location.href;
    
    if (host.includes('ibon') || host.includes('utk') || url.includes('UTK0201')) return 'IBON';
    if (host.includes('tixcraft')) return 'TIXCRAFT';
    if (host.includes('kktix')) return 'KKTIX';
    return 'UNKNOWN';
}

// =========================================================================
// 🟢 拓元 (TixCraft) 完整版
// =========================================================================
function runTixCraft(settings) {
    const autoCheck = settings.autoCheck !== false;
    const dropdownValue = settings.dropdownValue || "none";
    const autoClickZone = settings.autoClickZone === true;
    const zoneKeywords = settings.zoneKeywords || "";
    const autoReload = settings.autoReload === true;
    const autoSubmit = settings.autoSubmit === true;
    const keywordExclude = settings.keywordExclude || DEFAULT_EXCLUDE_KEYWORDS;
    const areaSelectMode = settings.areaSelectMode || 'from top to bottom';
    const areaAutoFallback = settings.areaAutoFallback === true;
    
    let attempts = 0;
    let isStopped = false;
    let isWaitingLogShown = false;
    let waitTicks = 0;
    let localIsClicking = false;
    let lastLinkCount = -1;
    let captchaHandled = false;
    
    function isSoldOut(el) {
        if (!el) return true;
        let text = normalizeText(el.innerText + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('alt') || ''));
        if (isUnavailableText(text) || text.includes('noseat')) return true;
        let parent = el.closest('li, td, div, span');
        if (parent) {
            let parentText = normalizeText(parent.innerText);
            if (isUnavailableText(parentText)) return true;
            if (hasUnavailableClass(parent)) return true;
        }
        if (hasUnavailableClass(el)) return true;
        return false;
    }
    
    async function loop() {
        if (isStopped || window.isReloading || attempts >= 400) return;
        let url = window.location.href;
        let isZonePage = url.includes('/ticket/area/');
        let isTicketPage = url.includes('/ticket/ticket/');
        
        if (!isZonePage && !isTicketPage) {
            waitTicks++;
            if (!isWaitingLogShown) {
                extLog(`🚀 [拓元] 潛伏中... 請手動進入「選區」或「選票」頁面（目前：${url}）`);
                isWaitingLogShown = true;
            } else if (waitTicks % 10 === 0) {
                extLog(`⏳ [拓元] 等待中… 目前頁面：${url}`);
            }
            setTimeout(loop, 500);
            return;
        }
        
        attempts++;
        try {
            if (!localIsClicking) {
                if (autoCheck) {
                    let cb = document.querySelector('#TicketForm_agree, #agree');
                    if (cb && !cb.checked) {
                        if (await ensureChecked(cb)) {
                            extLog("✅ [拓元] 已勾選同意條款");
                        }
                    }
                }
                
                let qtySelects = Array.from(document.querySelectorAll('select')).filter(isQuantitySelect);
                if (qtySelects.length > 0 && dropdownValue !== "none") {
                    for (let sel of qtySelects) {
                        let desiredValue = dropdownValue.toString();
                        let validOpts = Array.from(sel.options).filter(opt => parseInt(opt.value) > 0);
                        if (!Array.from(sel.options).some(opt => opt.value === desiredValue) && validOpts.length > 0) {
                            desiredValue = validOpts[validOpts.length - 1].value;
                        }
                        if (sel.value !== desiredValue) {
                            await simulateHumanInput(sel, desiredValue);
                            extLog(`✅ [拓元] 已自動選擇 ${desiredValue} 張`);
                        }
                    }
                }
                
                if (isZonePage) {
                    if (!autoClickZone) {
                        if (!isWaitingLogShown) {
                            extLog('⏳ [拓元] 等待中... 尚未啟用自動選區');
                            isWaitingLogShown = true;
                        }
                        setTimeout(loop, randInt(200, 500));
                        return;
                    }
                    
                    if (zoneKeywords || areaAutoFallback) {
                        const excludeGroups = parseKeywordGroups(keywordExclude);
                        const groups = parseKeywordGroups(zoneKeywords);

                        const ZONE_SELECTORS = [
                            '.zone-area a', '.area-list a',
                            '[class*="zone"] a', '[class*="area"] a',
                            '[class*="ticket"] a', '[class*="seat"] a',
                            'table a[href*="ticket"]',
                            'map area[href]',
                            'a[href*="/ticket/"]',
                        ];

                        let linkSet = new Set();
                        let links = [];
                        for (let sel of ZONE_SELECTORS) {
                            try {
                                document.querySelectorAll(sel).forEach(el => {
                                    if (!linkSet.has(el)) { linkSet.add(el); links.push(el); }
                                });
                            } catch(e) {}
                        }

                        if (links.length !== lastLinkCount) {
                            lastLinkCount = links.length;
                            extLog(`🔍 [拓元] 共掃到 ${links.length} 個連結`);
                        }

                        if (links.length > 0) {
                            let candidates = [];
                            for (let link of links) {
                                if (isSoldOut(link)) continue;
                                let text = link.innerText + ' ' + (link.getAttribute('title') || '');
                                if (isExcludedText(text, excludeGroups)) {
                                    extLog(`🚫 [拓元] 排除：${normalizeText(text).slice(0, 40)}`);
                                    continue;
                                }
                                candidates.push({ link, text });
                            }

                            let matchedLinks = [];
                            for (let gi = 0; gi < groups.length && matchedLinks.length === 0; gi++) {
                                for (let c of candidates) {
                                    if (matchTextAllTerms(c.text, groups[gi])) {
                                        matchedLinks.push({ link: c.link, kwIndex: gi, text: c.text });
                                    }
                                }
                            }

                            if (matchedLinks.length === 0 && areaAutoFallback && candidates.length > 0) {
                                extLog('⏳ [拓元] 關鍵字未命中，啟用自動遞補（依選區順序）');
                                matchedLinks = candidates.map(c => ({ link: c.link, kwIndex: 999, text: c.text }));
                            }

                            if (matchedLinks.length > 0) {
                                matchedLinks.forEach((item, i) => {
                                    extLog(`🏷️ 候選第${i+1}名 [KW:${item.kwIndex}]：${normalizeText(item.text).slice(0, 50)}`);
                                });
                                let best = matchedLinks[selectIndexByMode(matchedLinks.length, areaSelectMode)];
                                extLog(`🎯 [拓元] 鎖定區域: ${best.link.innerText.trim().slice(0, 50)}（${areaSelectMode}），仿生點擊！`);
                                playBeep('found');
                                localIsClicking = true;
                                isStopped = true;
                                await clickElement(best.link);
                                return;
                            } else {
                                if (!isWaitingLogShown) {
                                    extLog('⏳ [拓元] 關鍵字尚未命中，繼續等待...');
                                    isWaitingLogShown = true;
                                }
                                if (attempts > 30) {
                                    await triggerAutoReload(autoReload);
                                }
                            }
                        } else if (attempts > 30) {
                            await triggerAutoReload(autoReload);
                        }
                    }
                } else if (isTicketPage) {
                    // 選票頁：數量與同意條款設定完成後，接手處理驗證碼
                    if (!captchaHandled && captchaPresent()) {
                        captchaHandled = true;
                        if (captchaExecuting) {
                            // 智慧蹲點已在辨識，讓既有流程處理，避免重複請求
                            extLog('ℹ️ [拓元] 驗證碼辨識進行中，交由既有流程處理');
                        } else {
                            extLog('🧩 [拓元] 偵測到驗證碼，啟動自動辨識...');
                            let code = await solveCaptchaOnce(true, autoSubmit);
                            if (code) {
                                extLog(`✅ [拓元] 驗證碼已填入：${code}`);
                            } else {
                                extLog('⚠️ [拓元] 驗證碼辨識失敗，改為手動輸入');
                            }
                        }
                    }
                }
            }
        } catch (err) {
            extLog(`⚠️ [拓元] 錯誤：${err.message}`);
        }
        setTimeout(loop, randInt(200, 500));
    }
    loop();
}

// =========================================================================
// 🔵 KKTIX 完整版
// =========================================================================
// KKTIX：找「自行選位」/「電腦配位」按鈕；若無選位選項（只有「下一步」）則直接按下一步
function findKKTIXSeatButton(mode) {
    const buttons = Array.from(document.querySelectorAll('button.btn'));
    const textOf = b => (b.innerText || '').replace(/\s+/g, '');
    const clickOf = b => b.getAttribute('ng-click') || '';
    const pick = (pred) => buttons.find(pred) || null;

    if (mode === 'self') {
        return pick(b => textOf(b).includes('自行選位'))
            || pick(b => /challenge\(\s*\)/.test(clickOf(b)))   // 含「下一步」
            || null;
    }
    return pick(b => /電腦(配位|選位)/.test(textOf(b)))
        || pick(b => /challenge\(\s*1\s*\)/.test(clickOf(b)))
        || pick(b => textOf(b).includes('下一步'))
        || pick(b => /challenge\(\s*\)/.test(clickOf(b)))       // 沒有選位選項 → 下一步
        || null;
}

function isButtonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('disabled') !== null) return false;
    if (btn.classList.contains('btn-disabled-alt')) return false;
    return true;
}

// 選好票數後，依設定自動點擊選位按鈕
async function clickKKTIXSeatButton(mode, timeoutMs = 6000) {
    const want = mode === 'self' ? '自行選位' : '電腦配位';
    const deadline = Date.now() + timeoutMs;
    let waitLogged = false;
    while (Date.now() < deadline) {
        const btn = findKKTIXSeatButton(mode);
        if (btn && isButtonEnabled(btn)) {
            const label = (btn.innerText || '').replace(/\s+/g, '') || want;
            extLog(`🎯 [KKTIX] 自動點擊「${label}」`);
            playBeep('found');
            await clickElement(btn);
            return true;
        }
        if (btn && !isButtonEnabled(btn) && !waitLogged) {
            extLog(`⏳ [KKTIX] 「${(btn.innerText || '').replace(/\s+/g, '') || want}」尚未可用，等待中...`);
            waitLogged = true;
        }
        await sleep(150);
    }
    extLog(`⚠️ [KKTIX] 找不到可用的「${want}」按鈕（可能忙碌中或已跳頁）`);
    return false;
}

function runKKTIX(settings) {
    const autoCheck = settings.autoCheck !== false;
    const dropdownValue = settings.dropdownValue === "none" ? 1 : (parseInt(settings.dropdownValue) || 1);
    const autoClickZone = settings.autoClickZone === true;
    const zoneKeywords = settings.zoneKeywords || "";
    const autoReload = settings.autoReload === true;
    const keywordExclude = settings.keywordExclude || DEFAULT_EXCLUDE_KEYWORDS;
    const areaSelectMode = settings.areaSelectMode || 'from top to bottom';
    const areaAutoFallback = settings.areaAutoFallback === true;
    const kktixSeatMode = settings.kktixSeatMode || 'none';
    
    let attempts = 0;
    let isStopped = false;
    let isWaitingLogShown = false;
    let localIsClicking = false;
    let agreeChecked = false;
    
    function extractPrice(ticketUnit) {
        if (!ticketUnit) return 0;
        let priceEl = ticketUnit.querySelector('.ticket-price .ng-binding');
        if (!priceEl) return 0;
        let raw = priceEl.innerText.replace(/[^0-9]/g, '');
        return parseInt(raw) || 0;
    }
    
    function isSoldOut(ticketUnit) {
        if (!ticketUnit) return true;
        let soldOutSpan = ticketUnit.querySelector('span[ng-if="!purchasableAndSelectable"]');
        if (soldOutSpan && soldOutSpan.offsetParent !== null) return true;
        let text = normalizeText(ticketUnit.innerText);
        if (text.includes('已售完') || text.includes('售完') || text.includes('暫無票券')) return true;
        let plusBtn = ticketUnit.querySelector('button.plus');
        if (!plusBtn) return true;
        if (plusBtn.disabled || plusBtn.classList.contains('disabled')) return true;
        return false;
    }
    
    async function loop() {
        if (isStopped || window.isReloading) return;
        if (!window.location.href.includes('registrations/new')) {
            if (!isWaitingLogShown) {
                extLog('🚀 [KKTIX] 潛伏中... 等待進入選票頁面');
                isWaitingLogShown = true;
            }
            setTimeout(loop, 500);
            return;
        }
        
        attempts++;
        try {
            if (!localIsClicking) {
                if (autoCheck && !agreeChecked) {
                    let cb = document.getElementById('person_agree_terms');
                    if (cb) {
                        if (cb.checked) {
                            agreeChecked = true;
                            extLog("✅ [KKTIX] 已勾選同意條款");
                        } else {
                            // 尚未真的打勾：重試（含受信任點擊／原生 setter），成功才繼續
                            let ok = await ensureChecked(cb);
                            if (ok) {
                                agreeChecked = true;
                                extLog("✅ [KKTIX] 已勾選同意條款");
                            } else {
                                setTimeout(loop, randInt(300, 500));
                                return;
                            }
                        }
                    }
                }
                
                let allUnits = Array.from(document.querySelectorAll('.ticket-unit'));
                let availableUnits = allUnits.filter(unit => !isSoldOut(unit));
                
                if (availableUnits.length > 0) {
                    if (!autoClickZone) {
                        if (!isWaitingLogShown) {
                            extLog('⏳ [KKTIX] 等待中... 尚未啟用自動選票');
                            isWaitingLogShown = true;
                        }
                        setTimeout(loop, randInt(200, 500));
                        return;
                    }
                    
                    let targetUnit = null;
                    if (zoneKeywords || areaAutoFallback) {
                        const excludeGroups = parseKeywordGroups(keywordExclude);
                        const groups = parseKeywordGroups(zoneKeywords);

                        let candidates = [];
                        for (let unit of availableUnits) {
                            let nameEl = unit.querySelector('.ticket-name');
                            let nameText = nameEl ? nameEl.innerText : unit.innerText;
                            if (isExcludedText(nameText, excludeGroups)) {
                                extLog(`🚫 [KKTIX] 排除：${normalizeText(nameText).slice(0, 40)}`);
                                continue;
                            }
                            candidates.push({ unit, nameText, price: extractPrice(unit) });
                        }

                        let matchedUnits = [];
                        for (let gi = 0; gi < groups.length && matchedUnits.length === 0; gi++) {
                            let nkwDigits = normalizeText(groups[gi]).replace(/[^0-9]/g, '');
                            for (let c of candidates) {
                                let matchName = matchTextAllTerms(c.nameText, groups[gi]);
                                let matchPrice = nkwDigits !== '' && /^\d+$/.test(nkwDigits) && c.price === parseInt(nkwDigits);
                                if (matchName || matchPrice) {
                                    matchedUnits.push({ unit: c.unit, kwIndex: gi, price: c.price, text: normalizeText(c.nameText) });
                                }
                            }
                        }

                        if (matchedUnits.length === 0 && areaAutoFallback && candidates.length > 0) {
                            extLog('⏳ [KKTIX] 關鍵字未命中，啟用自動遞補');
                            matchedUnits = candidates.map(c => ({ unit: c.unit, kwIndex: 999, price: c.price, text: normalizeText(c.nameText) }));
                        }

                        if (matchedUnits.length > 0) {
                            matchedUnits.forEach((item, i) => {
                                extLog(`🏷️ 候選第${i+1}名 [KW:${item.kwIndex} 票價:${item.price}]：${item.text.slice(0, 50)}`);
                            });
                            targetUnit = matchedUnits[selectIndexByMode(matchedUnits.length, areaSelectMode)].unit;
                        } else {
                            if (!isWaitingLogShown) {
                                extLog('⏳ [KKTIX] 關鍵字尚未命中，繼續等待...');
                                isWaitingLogShown = true;
                            }
                            if (attempts > 15 && autoReload) {
                                extLog('⚠️ [KKTIX] 關鍵字長時間無命中，觸發重整...');
                                await triggerAutoReload(autoReload);
                            }
                        }
                    } else {
                        if (!isWaitingLogShown) {
                            extLog('⏳ [KKTIX] 未設定關鍵字，等待手動選票...');
                            isWaitingLogShown = true;
                        }
                        setTimeout(loop, randInt(200, 500));
                        return;
                    }
                    
                    if (targetUnit) {
                        let plusBtn = targetUnit.querySelector('button.plus');
                        if (plusBtn) {
                            localIsClicking = true;
                            isStopped = true;
                            let nameEl = targetUnit.querySelector('.ticket-name');
                            let label = nameEl ? nameEl.innerText.trim() : '?';
                            let price = extractPrice(targetUnit);
                            extLog(`🎯 [KKTIX] 鎖定：${label}（TWD$${price}），連點 ${dropdownValue} 張...`);
                            playBeep('found');
                            for (let i = 0; i < dropdownValue; i++) {
                                await clickElement(plusBtn);
                                if (i < dropdownValue - 1) {
                                    await sleep(randInt(10, 30) + randInt(0, 5));
                                }
                            }
                            extLog(`✅ [KKTIX] 已完成 ${dropdownValue} 張！`);
                            if (kktixSeatMode === 'self' || kktixSeatMode === 'auto') {
                                await sleep(randInt(200, 500));
                                await clickKKTIXSeatButton(kktixSeatMode);
                            } else {
                                extLog('ℹ️ [KKTIX] 未設定自動選位，請手動按「自行選位／電腦配位」');
                            }
                            return;
                        }
                    }
                } else {
                    if (attempts > 30 && autoReload) {
                        extLog('⚠️ [KKTIX] 畫面無可選票種，觸發重整...');
                        await triggerAutoReload(autoReload);
                    }
                }
            }
        } catch (err) {
            extLog(`⚠️ [KKTIX] 錯誤：${err.message}`);
        }
        setTimeout(loop, randInt(200, 500));
    }
    loop();
}

// =========================================================================
// 🚀 核心路由
// =========================================================================
function startAutoFill() {
    let platform = detectPlatform();
    if (platform === 'UNKNOWN') return;
    
    let flagKey = `hasStartedAutoFill_${platform}`;
    if (window[flagKey]) return;
    window[flagKey] = true;
    
    stopAllScanners();
    
    chrome.storage.local.get(
        ['autoCheck', 'autoReload', 'dropdownValue', 'autoClickZone', 'zoneKeywords', 'autoSubmit',
         'keywordExclude', 'areaSelectMode', 'areaAutoFallback', 'playSound', 'kktixSeatMode', 'ibonAuto'],
        function(data) {
            let raw = data || {};
            let toBool = v => v === true || v === 'true';
            let settings = {
                autoCheck: toBool(raw.autoCheck),
                autoReload: toBool(raw.autoReload),
                autoClickZone: toBool(raw.autoClickZone),
                autoSubmit: toBool(raw.autoSubmit),
                areaAutoFallback: toBool(raw.areaAutoFallback),
                playSound: toBool(raw.playSound),
                dropdownValue: raw.dropdownValue || "none",
                zoneKeywords: raw.zoneKeywords || "",
                keywordExclude: raw.keywordExclude || DEFAULT_EXCLUDE_KEYWORDS,
                areaSelectMode: raw.areaSelectMode || "from top to bottom",
                kktixSeatMode: raw.kktixSeatMode || "none",
                ibonAuto: raw.ibonAuto !== false
            };

            window.__tsPlaySound = settings.playSound;
            window.__tsSubmitted = false;
            
            extLog(`🚀 [路由] 平台：${platform}｜${window.location.href}`);
            extLog(`🚀 [路由] 設定：autoCheck=${settings.autoCheck}, autoReload=${settings.autoReload}, autoClickZone=${settings.autoClickZone}, mode=${settings.areaSelectMode}, kktixSeatMode=${settings.kktixSeatMode}`);
            
            if (platform === 'TIXCRAFT') runTixCraft(settings);
            else if (platform === 'KKTIX') runKKTIX(settings);
            else if (platform === 'IBON') runIBON(settings);
        }
    );
}

// ✅ 監聽自動檢測勾選
if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.autoCheck) {
            if (changes.autoCheck.newValue === true) {
                startAutoFill();
            }
        }
    });
}

// ✅ 頁面載入時檢查設定
(function init() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startAutoFill();
    } else {
        document.addEventListener('DOMContentLoaded', startAutoFill);
        window.addEventListener('load', startAutoFill);
    }
    setTimeout(startAutoFill, 300);
})();

// =========================================================================
// 🧩 驗證碼辨識模組（整合自 Captcha_Sniper）
// =========================================================================
const CAPTCHA_IMG_SELECTORS = [
    '#yw0', '#vadimg', '#ValidCode', '#imgCaptcha', '#captcha_image',
    'img[alt*="驗證碼"]', 'img[alt*="验证码" i]', 'img[alt*="captcha" i]',
    'img[src*="VaildImage" i]', 'img[src*="captcha" i]', 'img[src*="Verify" i]',
    'img[src*="Validate" i]', 'img[src*="Code.aspx" i]', 'img[src*="CreateCode" i]',
    'img[alt*="驗證" i]', 'img[src*="Code" i]',
    'img[class*="captcha" i]', 'img[class*="code" i]', 'img[id*="captcha" i]',
    '.captcha img', '.captcha-img', '#captcha',
    // 泛用 data:image 放最後，避免誤選頁面上的非驗證碼圖片
    'img[src^="data:image"]'
];

const CAPTCHA_MAX_RETRIES = 3;
let detectedCaptchaImg = null;
let captchaExecuting = false;
let _captchaLengthHint = 4;   // 供 isSubmitReady 使用（由辨識時實際設定帶入）

function isCaptchaImageElement(el) {
    if (!el || el.tagName.toLowerCase() !== 'img') return false;
    return CAPTCHA_IMG_SELECTORS.some(sel => {
        try { return el.matches(sel); } catch (e) { return false; }
    });
}

function findCaptchaImage() {
    for (const selector of CAPTCHA_IMG_SELECTORS) {
        const el = document.querySelector(selector);
        if (el && el.offsetHeight > 0) return el;
    }
    return null;
}

function captchaPresent() {
    return !!findCaptchaImage();
}

// 驗證碼模組僅在拓元 (Yii2) 啟用；KKTIX / ibon 無驗證碼，不處理
function isCaptchaPlatform() {
    try { return detectPlatform() === 'TIXCRAFT'; } catch (e) { return false; }
}

// 回傳伺服器要用的自訓練模型鍵
function captchaModelForPlatform() {
    try { return detectPlatform() === 'TIXCRAFT' ? 'tixcraft' : 'universal'; } catch (e) { return 'tixcraft'; }
}

function storageGet(keys) {
    return new Promise(resolve => {
        try {
            chrome.storage.local.get(keys, d => resolve(d || {}));
        } catch (e) {
            resolve({});
        }
    });
}

// 讀取 Yii2 驗證碼 hash（經 background 在 MAIN world 取得）
function getYiiHash(timeoutMs = 2500, allowRefresh = true) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; resolve(0); }
        }, timeoutMs);
        try {
            chrome.runtime.sendMessage({ action: 'getYiiHash', allowRefresh: allowRefresh }, (resp) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (chrome.runtime.lastError || !resp) { resolve(0); return; }
                extLog(`🔐 Yii2 hash=${resp.hash || 0}｜外掛=${resp.hasPlugin ? '有' : '無'}｜已換圖=${resp.refreshed ? '是' : '否'}`);
                resolve(resp.hash || 0);
            });
        } catch (e) {
            if (!settled) { settled = true; clearTimeout(timer); resolve(0); }
        }
    });
}

// =========================================================================
// 手動選擇輸入框
// =========================================================================
function startSelectionMode() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.1);z-index:999999;cursor:crosshair;';
    document.body.appendChild(overlay);

    let lastElement = null;

    const mouseMoveHandler = (e) => {
        overlay.style.pointerEvents = 'none';
        const target = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'auto';
        if (target && target !== lastElement) {
            if (lastElement) lastElement.style.outline = '';
            if (target.tagName.toLowerCase() === 'input') {
                target.style.outline = '3px solid red';
                lastElement = target;
            } else {
                lastElement = null;
            }
        }
    };

    const clickHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (lastElement) {
            lastElement.style.outline = '';
            const selector = generateSelector(lastElement);
            chrome.storage.local.set({ savedSelector: selector }, () => {
                alert('✅ 已成功選擇輸入框！\n標識符：' + selector);
            });
        }
        document.body.removeChild(overlay);
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('click', clickHandler, true);
    };

    function generateSelector(element) {
        if (element.id) return '#' + element.id;
        if (element.name) return `input[name="${element.name}"]`;
        let selector = element.tagName.toLowerCase();
        if (element.className) {
            selector += '.' + Array.from(element.classList).join('.');
        }
        return selector;
    }

    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('click', clickHandler, true);
}

// =========================================================================
// 抓取驗證碼圖片 → base64
// =========================================================================
function getCaptchaImageRaw() {
    return new Promise((resolve) => {
        let captchaImg = (detectedCaptchaImg && document.body.contains(detectedCaptchaImg))
            ? detectedCaptchaImg
            : findCaptchaImage();
        if (!captchaImg) {
            detectedCaptchaImg = null;
            resolve(null);
            return;
        }
        detectedCaptchaImg = captchaImg;
        convertImageToBase64(captchaImg, (imageData) => resolve(imageData || null));
    });
}

function convertImageToBase64(captchaImg, callback) {
    // 只讀取目前 src，不改動頁面上的 <img>（避免破壞網站自己的換圖/hash 流程）
    const imgSrc = captchaImg.currentSrc || captchaImg.getAttribute('src') || captchaImg.src || '';
    if (!imgSrc) { callback(null); return; }
    const isBase64 = imgSrc.startsWith('data:image');

    const img = new Image();
    if (!isBase64) img.crossOrigin = 'anonymous';

    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            callback(canvas.toDataURL('image/png'));
        } catch (e) {
            if (_debugLog) console.warn('[TicketSniper] canvas 轉換失敗:', e);
            callback(null);
        }
    };
    img.onerror = () => callback(null);

    if (isBase64) {
        img.src = imgSrc;
    } else {
        const separator = imgSrc.includes('?') ? '&' : '?';
        img.src = imgSrc + separator + 't=' + new Date().getTime();
    }
}

// =========================================================================
// 模擬真人輸入
// =========================================================================
function fireMouse(el, type) {
    try {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width * (0.3 + Math.random() * 0.4);
        const y = r.top + r.height * (0.3 + Math.random() * 0.4);
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    } catch (e) {}
}

function fireKey(input, ch, type, keyCode) {
    try {
        input.dispatchEvent(new KeyboardEvent(type, {
            key: ch, code: 'Key' + ch.toUpperCase(), keyCode: keyCode, which: keyCode,
            bubbles: true, cancelable: true,
        }));
    } catch (e) {}
}

async function simulateTyping(inputElement, text) {
    fireMouse(inputElement, 'mouseover');
    fireMouse(inputElement, 'mousemove');
    fireMouse(inputElement, 'mousedown');
    fireMouse(inputElement, 'mouseup');
    fireMouse(inputElement, 'click');
    try { inputElement.focus(); } catch (e) {}
    inputElement.dispatchEvent(new Event('focus', { bubbles: false }));

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (nativeSetter) nativeSetter.call(inputElement, '');
    else inputElement.value = '';

    await sleep(90 + Math.random() * 210);

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const upper = ch.toUpperCase();
        const kc = upper.charCodeAt(0);
        fireKey(inputElement, ch, 'keydown', kc);
        fireKey(inputElement, ch, 'keypress', ch.charCodeAt(0));
        const partial = text.slice(0, i + 1);
        if (nativeSetter) nativeSetter.call(inputElement, partial);
        else inputElement.value = partial;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        fireKey(inputElement, ch, 'keyup', kc);
        let delay = 65 + Math.random() * 130;
        if (Math.random() < 0.15) delay += 120 + Math.random() * 210;
        await sleep(delay);
    }

    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(35 + Math.random() * 90);
    inputElement.dispatchEvent(new Event('blur', { bubbles: true }));
}

function instantInput(inputElement, text) {
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (nativeSet) nativeSet.call(inputElement, text);
    else inputElement.value = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}

async function fillCaptchaInput(text, selector, typingMode = 'simulate') {
    let inputField = null;
    if (selector) inputField = document.querySelector(selector);
    if (!inputField) {
        const defaultSelectors = [
            'input[name*="captcha" i]', 'input[name*="verify" i]',
            'input[id*="captcha" i]', 'input[id*="verify" i]',
            'input[placeholder*="验证码" i]', 'input[placeholder*="驗證碼" i]'
        ];
        for (let sel of defaultSelectors) {
            inputField = document.querySelector(sel);
            if (inputField) break;
        }
    }
    if (inputField) {
        if (typingMode === 'simulate') await simulateTyping(inputField, text);
        else instantInput(inputField, text);
    }
}

// 語音驗證碼直接偷答案
function checkAudioCaptchaBypass() {
    const audioBtn = document.querySelector('#playcaptcha, a[href*="translate_tts"]');
    if (audioBtn && audioBtn.href) {
        try {
            const url = new URL(audioBtn.href);
            let qParam = url.searchParams.get('q');
            if (qParam) return qParam.replace(/["']/g, '');
        } catch (e) {}
    }
    return null;
}

// =========================================================================
// 自動送出（可切換）
// =========================================================================
window.__tsSubmitted = false;

function findClickableByText(textList) {
    const nodes = document.querySelectorAll('button, input[type="submit"], a');
    for (let el of nodes) {
        let t = ((el.innerText || el.value || '') + '').trim();
        if (t && textList.some(x => t.includes(x))) return el;
    }
    return null;
}

function clickSubmitButton() {
    let btn = document.querySelector('#TicketForm_submit');
    if (!btn) btn = document.querySelector('button[type="submit"], input[type="submit"]');
    if (!btn) btn = findClickableByText(['下一步', '送出', '確認', '註冊', '立即購票', '前往結帳']);
    if (!btn || btn.disabled) return false;
    try { btn.click(); return true; } catch (e) { return false; }
}

// 送出前就緒檢查（參考 tickets_hunter：驗證碼/票數/同意皆就緒才送出）
function isSubmitReady() {
    let need = _captchaLengthHint > 0 ? _captchaLengthHint : 4;
    let cap = document.querySelector('#TicketForm_verifyCode');
    if (cap && cap.offsetParent !== null && (cap.value || '').length < need) return false;
    let agree = document.querySelector('#TicketForm_agree, #agree');
    if (agree && !agree.checked) return false;
    let qtySelects = Array.from(document.querySelectorAll('select')).filter(isQuantitySelect);
    if (qtySelects.length > 0 && !qtySelects.some(sel => parseInt(sel.value) > 0)) return false;
    return true;
}

async function maybeAutoSubmit() {
    if (window.__tsSubmitted) return;
    const d = await storageGet(['autoSubmit']);
    if (!(d.autoSubmit === true || d.autoSubmit === 'true')) return;
    if (!isSubmitReady()) {
        extLog('⏳ 送出前檢查未通過（驗證碼／票數／同意），暫不送出');
        return;
    }
    window.__tsSubmitted = clickSubmitButton();
    if (window.__tsSubmitted) {
        extLog('🚀 已自動送出！');
        playBeep('order');
    }
}

// =========================================================================
// 核心：辨識一次（Promise 版）
// =========================================================================
// 點擊驗證碼圖片換一張新圖，並清掉快取的圖片參照
async function refreshCaptchaImage(waitMs = 1500) {
    const img = (detectedCaptchaImg && document.body.contains(detectedCaptchaImg))
        ? detectedCaptchaImg
        : findCaptchaImage();
    if (img) {
        try { img.click(); } catch (e) {}
    }
    detectedCaptchaImg = null;
    await sleep(waitMs);
}

// 強制重跑：若目前正在辨識，先等它結束，避免兩個辨識流程重疊
async function forceSolveCaptcha(allowSubmit) {
    let guard = 0;
    while (captchaExecuting && guard++ < 100) {
        await sleep(100);
    }
    return solveCaptchaOnce(true, allowSubmit);
}

async function solveCaptchaOnce(forceRun = false, allowSubmit = false, doFill = true) {
    if (captchaExecuting) return null;
    const data = await storageGet(['autoRun', 'serverUrl', 'savedSelector', 'typingMode', 'captchaLength', 'recognizeTimes', 'yiiHashEnabled']);
    if (!data.autoRun && !forceRun) return null;

    captchaExecuting = true;
    try {
        const typingMode = data.typingMode || 'simulate';
        const expectedLength = data.captchaLength ? parseInt(data.captchaLength) : null;
        if (expectedLength && !isNaN(expectedLength)) _captchaLengthHint = expectedLength;

        let bypassAnswer = checkAudioCaptchaBypass();
        if (bypassAnswer) {
            if (expectedLength && !isNaN(expectedLength)) bypassAnswer = bypassAnswer.substring(0, expectedLength);
            if (doFill) await fillCaptchaInput(bypassAnswer, data.savedSelector, typingMode);
            extLog(`✅ 驗證碼(語音)${doFill ? '已填入' : '辨識'}：${bypassAnswer}`);
            if (allowSubmit) await maybeAutoSubmit();
            return bypassAnswer;
        }

        const apiUrl = (data.serverUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '') + '/recognize';
        const yiiHash = (data.yiiHashEnabled === false) ? 0 : await getYiiHash();

        for (let attempt = 0; attempt <= CAPTCHA_MAX_RETRIES; attempt++) {
            const imageData = await getCaptchaImageRaw();
            if (!imageData) {
                extLog('❌ 找不到驗證碼圖片');
                return null;
            }

            let resData = null;
            let serverFailed = false;
            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image: imageData,
                        length: expectedLength,
                        model: captchaModelForPlatform(),
                        recognizeTimes: 1,
                        currentRound: attempt + 1,
                        yiiHash: yiiHash,
                        retryCount: attempt
                    })
                });
                if (!res.ok) {
                    serverFailed = true;
                    extLog(`⚠️ 辨識伺服器回應 ${res.status}`);
                }
                resData = await res.json().catch(() => null);
            } catch (err) {
                extLog(`❌ 驗證碼伺服器錯誤：${err.message}`);
                return null;
            }

            const text = resData && (resData.text || resData.result);
            const lengthBad = expectedLength && text && text.length < expectedLength;
            const mismatch = resData && resData.length_mismatch === true;
            const hashBad = resData && resData.hash_used && resData.hash_verified === false;

            if (!text || serverFailed || lengthBad || mismatch || hashBad) {
                let why = '辨識失敗';
                if (serverFailed) why = '伺服器錯誤';
                else if (lengthBad) why = `長度不足 (${text.length}<${expectedLength})`;
                else if (mismatch) why = '長度不符';
                else if (hashBad) why = 'hash 驗證失敗';
                extLog(`⚠️ ${why}，換圖重試...`);
                if (attempt < CAPTCHA_MAX_RETRIES) {
                    await refreshCaptchaImage(1500);
                    continue;
                }
                return null;
            }

            if (doFill) await fillCaptchaInput(text, data.savedSelector, typingMode);
            extLog(`✅ 驗證碼${doFill ? '已填入' : '辨識完成'}：${text}`);
            if (allowSubmit) await maybeAutoSubmit();
            return text;
        }
        return null;
    } finally {
        captchaExecuting = false;
    }
}

// =========================================================================
// popup 指令
// =========================================================================
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'startSelecting') {
            startSelectionMode();
            sendResponse({ status: 'ok' });
        } else if (request.action === 'getCaptchaImage') {
            getCaptchaImageRaw().then(img => sendResponse(img ? { imageData: img } : { error: '未找到驗證碼圖像' }));
            return true;
        } else if (request.action === 'fillCaptcha') {
            fillCaptchaInput(request.text, request.selector, request.typingMode).then(() => sendResponse({ status: 'ok' }));
            return true;
        } else if (request.action === 'runAutoNow') {
            solveCaptchaOnce(true, true);
            sendResponse({ status: 'ok' });
        } else if (request.action === 'recognizeNow') {
            solveCaptchaOnce(true, false, request.autoFill !== false).then(text => sendResponse({ text: text || null }));
            return true;
        }
    });
}

// =========================================================================
// 觸發時機：智能蹲點 + 真人點圖重跑 + F4
// =========================================================================
function whenImageReady(img, cb) {
    if (!img) { cb(); return; }
    if (img.complete && img.naturalWidth > 0) {
        setTimeout(cb, 25);
        return;
    }
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); cb(); };
    const timer = setTimeout(finish, 1500);
    img.addEventListener('load', finish, { once: true });
    img.addEventListener('error', finish, { once: true });
}

function startSmartObserver() {
    if (!isCaptchaPlatform()) return;
    const maxMs = 5000;
    const startTime = Date.now();
    let finished = false;
    let observer = null;
    let pollTimer = null;

    const tryFire = (source) => {
        if (finished) return;
        const imgEl = findCaptchaImage();
        if (imgEl && imgEl.offsetHeight > 0) {
            finished = true;
            if (pollTimer) clearInterval(pollTimer);
            if (observer) observer.disconnect();
            extLog(`👀 發現驗證碼圖片（${source}，${Date.now() - startTime}ms）`);
            whenImageReady(imgEl, () => solveCaptchaOnce(false, true));
        }
    };

    tryFire('立即');

    pollTimer = setInterval(() => {
        if (finished) { clearInterval(pollTimer); return; }
        if (Date.now() - startTime > maxMs) {
            finished = true;
            clearInterval(pollTimer);
            if (observer) observer.disconnect();
            return;
        }
        tryFire('輪詢');
    }, 250);

    try {
        observer = new MutationObserver(() => tryFire('DOM 變動'));
        observer.observe(document.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
        });
    } catch (e) {}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSmartObserver);
} else {
    startSmartObserver();
}

// 真人點擊驗證碼圖片 → 重新辨識（用原生 isTrusted 判斷，避免被反偵測偽造影響）
document.addEventListener('click', (e) => {
    if (!isCaptchaPlatform()) return;
    if (typeof window.__nativeIsTrusted === 'function' && !window.__nativeIsTrusted(e)) return;
    const target = e.target;
    const img = target && target.tagName && target.tagName.toLowerCase() === 'img'
        ? target
        : (target && target.closest ? target.closest('img') : null);
    const isCaptchaImg = img && (img === detectedCaptchaImg || isCaptchaImageElement(img));
    if (!isCaptchaImg) return;
    chrome.storage.local.get(['autoRun'], (data) => {
        if (!data.autoRun) return;
        extLog('🖱️ 手動點擊驗證碼，等待新圖後重新辨識...');
        const oldImg = detectedCaptchaImg;
        const oldSrc = oldImg ? (oldImg.getAttribute('src') || '') : '';
        let waited = 0;
        const iv = setInterval(() => {
            waited += 60;
            const cur = (oldImg && document.body.contains(oldImg)) ? oldImg : findCaptchaImage();
            const curSrc = cur ? (cur.getAttribute('src') || '') : '';
            if ((curSrc && curSrc !== oldSrc) || waited >= 1500) {
                clearInterval(iv);
                whenImageReady(cur, () => forceSolveCaptcha(true));
            }
        }, 60);
    });
}, true);

// F4 快捷鍵強制重跑
document.addEventListener('keydown', (e) => {
    if (e.key === 'F4') {
        if (!isCaptchaPlatform()) return;
        e.preventDefault();
        extLog('⌨️ F4 強制重新辨識驗證碼');
        forceSolveCaptcha(false);
    }
});