# encoding=utf-8
"""
IBON（orders.ibon.com.tw，舊版 .aspx UTK0201 流程）launcher 端自動化。

參考 tickets_hunter 的作法：
  - 不使用擴充功能的合成事件，改在 CDP 層操作
  - 一般元素：以 CDP Input.dispatchMouseEvent（tab.mouse_click）送「受信任」滑鼠點擊
  - image map / 難以取座標者：以 Runtime 呼叫元素自身的 .click()
  - Angular 表單：以原生值 + input/change 事件觸發更新

流程（依 URL）：
  UTK0201_000.aspx  選區：解析 jsonData → 關鍵字/價格比對 → 點擊對應 area
  UTK0201_001.aspx  數量：設定購買張數
  UTK0201_005 / UTK0206  確認/完成頁：停止

設定（launcher/config.json）：
  ibon_auto（bool）、ibon_area_keyword（str）、ibon_exclude_keyword（str）、
  ibon_fallback（bool）、ibon_ticket_count（int）
"""
import asyncio
import json
import random
import re

# 已處理過的「URL → 避免同頁重複點擊」
_handled = set()
_spa_logged = set()
_spa_clicked = set()


def _log(msg):
    print(msg)


async def _eval(tab, expr):
    try:
        return await tab.evaluate(expr)
    except Exception:
        return None


def _parse_groups(s):
    if not s:
        return []
    s = str(s).strip()
    if not s:
        return []
    return [x.strip() for x in re.split(r"[;,，]", s) if x.strip()]


def _norm(s):
    if not s:
        return ''
    s = str(s)
    trans = str.maketrans(
        {chr(0xFF01 + i): chr(0x21 + i) for i in range(0x5F)})
    s = s.translate(trans).replace('\u3000', ' ').replace('\u200b', '')
    return re.sub(r'\s+', ' ', s).lower().strip()


def _match_all_terms(text, group):
    if not text:
        return False
    terms = [t for t in re.split(r'\s+', str(group)) if t]
    if not terms:
        return True
    t = _norm(text)
    return all(_norm(term) in t for term in terms)


def _is_excluded(text, groups):
    return any(_match_all_terms(text, g) for g in groups)


async def _get_rows(tab):
    """從頁面 <script> 讀出 jsonData 表格資料。"""
    res = await _eval(tab, r'''(() => {
        try {
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
                const t = s.textContent || '';
                if (t.indexOf('jsonData') === -1) continue;
                const m = t.match(/jsonData\s*=\s*'([^']*)'/);
                if (!m) continue;
                let str = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                try { const arr = JSON.parse(str); return JSON.stringify(arr); }
                catch (e) { return null; }
            }
        } catch (e) {}
        return null;
    })()''')
    if not res:
        return []
    try:
        data = json.loads(res)
        return data if isinstance(data, list) else []
    except Exception:
        return []


async def _cdp_move_click(tab, cdp, x, y):
    """模擬滑鼠移動（隨機起點、2~4 段、每段 110~150ms）後以 CDP 受信任點擊。"""
    cdp_input = cdp.input_
    sx = x + random.randint(-140, 140)
    sy = y + random.randint(-90, 90)
    steps = random.randint(2, 4)
    for i in range(1, steps + 1):
        t = i / steps
        ease = 2 * t * t if t < 0.5 else -1 + (4 - 2 * t) * t
        await tab.send(cdp_input.dispatch_mouse_event(
            type_='mouseMoved', x=sx + (x - sx) * ease, y=sy + (y - sy) * ease, buttons=0))
        await asyncio.sleep(random.uniform(0.11, 0.15))
    await tab.send(cdp_input.dispatch_mouse_event(type_='mouseMoved', x=x, y=y, buttons=0))
    await asyncio.sleep(random.uniform(0.11, 0.15))
    await tab.send(cdp_input.dispatch_mouse_event(
        type_='mousePressed', x=x, y=y,
        button=cdp_input.MouseButton.LEFT, buttons=1, click_count=1))
    await asyncio.sleep(random.uniform(0.05, 0.09))
    await tab.send(cdp_input.dispatch_mouse_event(
        type_='mouseReleased', x=x, y=y,
        button=cdp_input.MouseButton.LEFT, buttons=1, click_count=1))


async def _click_selector(tab, selector, cdp=None):
    """先試 CDP 受信任滑鼠（取中心座標）；取不到座標則退回元素 .click()。"""
    sel = json.dumps(selector)
    pt = await _eval(tab, '''(() => {
        const el = document.querySelector(%s);
        if (!el) return null;
        try { el.scrollIntoView({block:'center'}); } catch(e) {}
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
        }
        return JSON.stringify({click: true});
    })()''' % sel)
    if not pt:
        return False
    try:
        info = json.loads(pt)
    except Exception:
        return False
    if isinstance(info, dict) and 'x' in info:
        try:
            if cdp is not None:
                await _cdp_move_click(tab, cdp, float(info['x']), float(info['y']))
            else:
                await tab.mouse_click(float(info['x']), float(info['y']))
            return True
        except Exception:
            pass
    ok = await _eval(tab, '''(() => {
        try {
            const el = document.querySelector(%s);
            if (!el) return false;
            el.click();
            return true;
        } catch (e) { return false; }
    })()''' % sel)
    return bool(ok)


async def _select_area(tab, cfg, cdp=None):
    url = ''
    try:
        url = tab.url or ''
    except Exception:
        pass
    rows = await _get_rows(tab)
    if not rows:
        return
    available = [r for r in rows
                 if r.get('BACKGROUND_COLOR') != 'disabled' and r.get('AMOUNT') != '已售完']
    if not available:
        return
    exclude = _parse_groups(cfg.get('ibon_exclude_keyword'))
    groups = _parse_groups(cfg.get('ibon_area_keyword'))
    candidates = []
    for r in available:
        text = str(r.get('NAME', ''))
        if _is_excluded(text, exclude):
            continue
        candidates.append(r)
    target = None
    for g in groups:
        for r in candidates:
            if _match_all_terms(str(r.get('NAME', '')), g):
                target = r
                break
        if target:
            break
    if target is None and cfg.get('ibon_fallback', False) and candidates:
        target = candidates[0]
    if target is None:
        _log("ℹ [IBON] 尚未命中關鍵字，等待（可稍後再試）")
        return
    area_id = str(target.get('GROUP_ID') or '').strip()
    if not area_id:
        _log("⚠ [IBON] 目標沒有 GROUP_ID/area id，略過")
        return
    key = (url, area_id)
    if key in _handled:
        return
    _handled.add(key)
    _log("🎯 [IBON] 鎖定：%s（票價 %s）→ 點擊 area=%s" % (
        target.get('NAME'), target.get('PRICE'), area_id))
    await asyncio.sleep(random.uniform(0.11, 0.15))
    ok = await _click_selector(tab, 'area[id="%s"]' % area_id, cdp)
    if ok:
        _log("✅ [IBON] 已送出選區（CDP）")
    else:
        _log("⚠ [IBON] area 點擊失敗")


async def _set_qty(tab, n, cfg=None, cdp=None):
    res = await _eval(tab, '''(function() {
        try {
            let sel = document.querySelector('select[name*="AMOUNT_DDL"]')
                || document.querySelector('select[id*="AMOUNT_DDL"]')
                || document.querySelector('select[name*="Qty"]')
                || document.querySelector('select[name*="qty"]');
            if (!sel) return false;
            sel.value = %s;
            sel.dispatchEvent(new Event('change', {bubbles:true}));
            sel.dispatchEvent(new Event('input', {bubbles:true}));
            return true;
        } catch (e) { return false; }
    })()''' % json.dumps(str(n)))
    if res:
        _log("✅ [IBON] 已設定張數：%s" % n)
        if cfg is None or cfg.get('ibon_auto_next', True):
            await asyncio.sleep(0.5)
            await _click_ibon_next(tab, cdp)
    return bool(res)


async def _click_ibon_next(tab, cdp=None):
    """數量設定完成後，送出「下一步」。優先直接呼叫 ASP.NET __doPostBack
    （合成 click 常只轉圈不送出），再退回 CDP 受信任滑鼠點擊。"""
    r = await _eval(tab, '''(() => {
        try {
            const el = document.querySelector('#ctl00_ContentPlaceHolder1_A2')
                || Array.from(document.querySelectorAll('a, button, input[type="submit"]'))
                    .find(e => ((e.innerText || e.value || '').trim() === '下一步'));
            if (!el) return 'noel';
            const href = el.getAttribute('href') || '';
            const m = href.match(/__doPostBack\\('([^']*)','([^']*)'\\)/);
            const target = m ? m[1] : (el.id || '');
            if (target && typeof __doPostBack === 'function') {
                __doPostBack(target, '');
                return 'postback';
            }
            el.click();
            return 'click';
        } catch (e) { return 'err'; }
    })()''')
    if r in ('postback', 'click'):
        _log("✅ [IBON] 已送出「下一步」(%s)" % r)
        return True
    ok = await _click_selector(tab, '#ctl00_ContentPlaceHolder1_A2', cdp)
    if ok:
        _log("✅ [IBON] 已按「下一步」")
        return True
    _log("ℹ [IBON] 找不到/無法送出「下一步」按鈕")
    return False


async def step(tab, cfg, cdp=None):
    """每個主迴圈 tick 呼叫；依目前 URL 執行對應動作。"""
    if not cfg.get('ibon_auto', False):
        return
    try:
        url = tab.url or ''
    except Exception:
        return
    if 'orders.ibon.com.tw' in url:
        if 'UTK0201_000' in url:
            await _select_area(tab, cfg, cdp)
        elif 'UTK0201_001' in url:
            await _set_qty(tab, cfg.get('ibon_ticket_count', 1), cfg, cdp)
        elif 'UTK0206' in url or 'UTK0201_005' in url:
            pass  # 已到確認/完成頁，交給使用者
        return
    # 新版 SPA（closed Shadow DOM）：以 CDP pierce 探索／點擊
    low = url.lower()
    if cdp is not None and ('/event/' in low or 'tour.ibon.com.tw' in url or 'ticket.ibon.com.tw' in url):
        await _spa_step(tab, cdp, cfg)


# =========================================================================
# 新版 SPA（Angular + closed Shadow DOM）→ 以 CDP DOM.perform_search 穿透
# =========================================================================
async def _pierce_node_ids(tab, cdp, query):
    try:
        await tab.send(cdp.dom.get_document(depth=-1, pierce=True))
    except Exception as e:
        _log("⚠ [IBON-SPA] get_document 失敗：%s" % e)
        return []
    try:
        search_id, count = await tab.send(
            cdp.dom.perform_search(query=query, include_user_agent_shadow_dom=True))
    except Exception as e:
        _log("⚠ [IBON-SPA] perform_search 失敗：%s" % e)
        return []
    if not count:
        try:
            await tab.send(cdp.dom.discard_search_results(search_id=search_id))
        except Exception:
            pass
        return []
    ids = []
    try:
        ids = await tab.send(cdp.dom.get_search_results(
            search_id=search_id, from_index=0, to_index=count))
    except Exception:
        ids = []
    try:
        await tab.send(cdp.dom.discard_search_results(search_id=search_id))
    except Exception:
        pass
    return list(ids or [])


async def _node_text(tab, cdp, node_id):
    try:
        obj = await tab.send(cdp.dom.resolve_node(node_id=node_id))
        oid = getattr(obj, 'object_id', None)
        if not oid:
            return ''
        r = await tab.send(cdp.runtime.call_function_on(
            function_declaration='function(){ return (this.innerText || this.textContent || "").replace(/\\s+/g," ").trim(); }',
            object_id=oid, return_by_value=True))
        return getattr(r, 'value', '') or ''
    except Exception:
        return ''


async def _node_center(tab, cdp, node_id):
    try:
        box = await tab.send(cdp.dom.get_box_model(node_id=node_id))
        quad = getattr(box, 'content', None)
        w = getattr(box, 'width', 0) or 0
        h = getattr(box, 'height', 0) or 0
        if not quad or len(quad) < 6 or w <= 0 or h <= 0:
            return None
        return ((quad[0] + quad[2]) / 2.0, (quad[1] + quad[5]) / 2.0)
    except Exception:
        return None


async def _click_node(tab, cdp, node_id):
    try:
        await tab.send(cdp.dom.scroll_into_view_if_needed(node_id=node_id))
    except Exception:
        pass
    c = await _node_center(tab, cdp, node_id)
    if c:
        try:
            await _cdp_move_click(tab, cdp, c[0], c[1])
            return True
        except Exception:
            pass
    try:
        obj = await tab.send(cdp.dom.resolve_node(node_id=node_id))
        oid = getattr(obj, 'object_id', None)
        if oid:
            await tab.send(cdp.runtime.call_function_on(
                function_declaration='function(){ this.click(); return true; }',
                object_id=oid, return_by_value=True))
            return True
    except Exception:
        pass
    return False


async def _spa_step(tab, cdp, cfg):
    try:
        url = tab.url or ''
    except Exception:
        url = ''
    query = cfg.get('ibon_spa_query') or 'button, a, [role="button"]'
    ids = await _pierce_node_ids(tab, cdp, query)
    if not ids:
        return
    exclude = _parse_groups(cfg.get('ibon_exclude_keyword'))
    cands = []
    for nid in ids[:250]:
        c = await _node_center(tab, cdp, nid)
        if not c:
            continue
        txt = await _node_text(tab, cdp, nid)
        if not txt:
            continue
        cands.append({'id': nid, 'text': txt, 'x': c[0], 'y': c[1]})
    if not cands:
        return
    sig = (url, len(cands))
    if sig not in _spa_logged:
        _spa_logged.add(sig)
        _log("🔎 [IBON-SPA] 發現 %d 個可點元素（可用 ibon_spa_keyword 指定要點的文字）：" % len(cands))
        for c in cands[:25]:
            _log("   - %s" % c['text'][:50])
    keyword = (cfg.get('ibon_spa_keyword') or '').strip()
    groups = _parse_groups(keyword) if keyword else []
    if not groups:
        return
    target = None
    for g in groups:
        for c in cands:
            if _is_excluded(c['text'], exclude):
                continue
            if _match_all_terms(c['text'], g):
                target = c
                break
        if target:
            break
    if not target or target['id'] in _spa_clicked:
        return
    _log("🎯 [IBON-SPA] 點擊：%s" % target['text'][:50])
    ok = await _click_node(tab, cdp, target['id'])
    if ok:
        _spa_clicked.add(target['id'])
        _log("✅ [IBON-SPA] 已點擊")
    else:
        _log("⚠ [IBON-SPA] 點擊失敗")
