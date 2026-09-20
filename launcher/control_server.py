# encoding=utf-8
"""
TicketSniper 本機控制伺服器（CDP 受信任輸入）

由 launcher.py 在背景啟動，只綁定 127.0.0.1，並要求 X-TS-Token。
擴充功能拿到座標後呼叫 /click，本模組透過 nodriver/CDP 的
Input.dispatchMouseEvent 送出「受信任」滑鼠事件（isTrusted 為 true），
避免使用網頁層級的合成事件。

端點：
  GET  /health          -> {"ok": true}
  POST /click  {x,y,href} -> 在對應頁面分頁點擊 (x, y)
"""
import asyncio
import json
import random
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class ControlServer:
    def __init__(self, browser, loop, token, cdp=None, host='127.0.0.1', port=5100):
        self.browser = browser
        self.loop = loop
        self.token = token
        self.cdp = cdp
        self.host = host
        self.port = port
        self._httpd = None
        self._thread = None

    # ------------------------------------------------------------------ #
    def start(self):
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code, obj):
                body = json.dumps(obj).encode('utf-8')
                self.send_response(code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-TS-Token')
                self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except Exception:
                    pass

            def do_OPTIONS(self):
                self._send(204, {})

            def do_GET(self):
                if self.path.startswith('/health'):
                    self._send(200, {'ok': True})
                else:
                    self._send(404, {'ok': False, 'error': 'not found'})

            def do_POST(self):
                if self.headers.get('X-TS-Token') != server.token:
                    self._send(403, {'ok': False, 'error': 'bad token'})
                    return
                try:
                    length = int(self.headers.get('Content-Length') or 0)
                    data = json.loads(self.rfile.read(length) or b'{}')
                except Exception:
                    self._send(400, {'ok': False, 'error': 'bad json'})
                    return
                try:
                    if self.path.startswith('/click'):
                        result = server._submit(server._do_click(data))
                    else:
                        self._send(404, {'ok': False, 'error': 'not found'})
                        return
                    self._send(200, {'ok': True, 'result': result})
                except Exception as e:
                    self._send(500, {'ok': False, 'error': str(e)})

        self._httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        try:
            if self._httpd:
                self._httpd.shutdown()
                self._httpd.server_close()
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    def _submit(self, coro, timeout=15):
        fut = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return fut.result(timeout)

    async def _resolve_tab(self, href=None):
        browser = self.browser
        tabs = []
        try:
            tabs = list(browser.tabs)
        except Exception:
            tabs = []
        if href:
            base = href.split('#')[0].rstrip('/')
            for t in tabs:
                try:
                    url = (t.target.url or '').split('#')[0].rstrip('/')
                    if url and (url == base or url.startswith(base) or base.startswith(url)):
                        return t
                except Exception:
                    continue
        try:
            return browser.main_tab
        except Exception:
            pass
        if tabs:
            return tabs[-1]
        raise RuntimeError('找不到可用的瀏覽器分頁')

    async def _do_click(self, data):
        x = float(data['x'])
        y = float(data['y'])
        tab = await self._resolve_tab(data.get('href'))
        cdp = self.cdp
        if cdp is None:
            from nodriver import cdp  # 備援
        cdp_input = cdp.input_

        async def move(mx, my):
            await tab.send(cdp_input.dispatch_mouse_event(
                type_='mouseMoved', x=mx, y=my, buttons=0))

        # 模擬滑鼠移動：目標附近小範圍擺動（避免跑到視窗外），2~3 段、每段 110~150ms
        sx = max(5.0, min(x + random.randint(-45, 45), 1915.0))
        sy = max(5.0, min(y + random.randint(-35, 35), 1000.0))
        steps = random.randint(2, 3)
        for i in range(1, steps + 1):
            t = i / steps
            ease = 2 * t * t if t < 0.5 else -1 + (4 - 2 * t) * t
            await move(sx + (x - sx) * ease, sy + (y - sy) * ease)
            await asyncio.sleep(random.uniform(0.11, 0.15))
        await move(x, y)
        await asyncio.sleep(random.uniform(0.11, 0.15))

        await tab.send(cdp_input.dispatch_mouse_event(
            type_='mousePressed', x=x, y=y,
            button=cdp_input.MouseButton.LEFT, buttons=1, click_count=1))
        await asyncio.sleep(random.uniform(0.05, 0.09))
        await tab.send(cdp_input.dispatch_mouse_event(
            type_='mouseReleased', x=x, y=y,
            button=cdp_input.MouseButton.LEFT, buttons=1, click_count=1))
        return {'x': x, 'y': y}
