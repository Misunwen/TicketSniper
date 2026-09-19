# encoding=utf-8
"""
TicketSniper nodriver 啟動器

一鍵流程：
  1. 檢查/安裝 OCR 伺服器套件，並確認 ddddocr 版本為 1.5.6（自訓練模型需求）
  2. 自動啟動 OCR 伺服器（Flask），並等它 /health 就緒
  3. 自動取得 Chrome for Testing（支援自動載入外掛）或使用指定瀏覽器
  4. 用 nodriver 開專用 profile，自動載入 extension 並導到活動頁

Chrome 137+ 只在「品牌 Chrome」移除 --load-extension；Chrome for Testing / Chromium
仍支援，所以預設會自動下載 Chrome for Testing 來達到全自動載入外掛。
若改用品牌 Chrome，會加上 --disable-features=DisableLoadExtensionCommandLineSwitch 嘗試還原。
"""
import asyncio
import json
import platform
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

try:
    from control_server import ControlServer
except Exception:  # 允許從其他工作目錄匯入
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from control_server import ControlServer

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE = Path(__file__).resolve().parent
REQUIRED_DDDDOCR = '1.5.6'
CFT_JSON = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"

DEFAULTS = {
    "url": "",
    "user_data_dir": "chrome_profile",
    "browser_executable_path": "",
    "auto_download_chromium": True,
    "chromium_dir": "../chrome-for-testing",
    "window_size": [1280, 900],
    "try_load_extension": True,
    "extension_dir": "../extension",
    "open_extensions_page": False,
    "start_server": True,
    "server_url": "http://127.0.0.1:5000",
    "trusted_click": True,
    "control_port": 5100,
    "block_trackers": False,
    "save_log": True,
    "extra_args": []
}

# 參考 tickets_hunter 的 nodrver_block_urls：封鎖分析／追蹤／側錄／廣告請求，
# 降低行為被收集與指紋化的機率（不影響購票畫面必要資源）。
TRACKER_BLOCKLIST = [
    # 分析與廣告
    '*google-analytics.*',
    '*analytics.google.com/*',
    '*googletagmanager.*',
    '*googlesyndication.*',
    '*googletagservices.*',
    '*googleadservices.com/*',
    '*adtrafficquality.google/*',
    '*doubleclick.net/*',
    '*connect.facebook.net/*/fbevents.js',
    '*connect.facebook.net/signals/*',
    '*fundingchoicesmessages.google.com/*',
    '*img.uniicreative.com/*',
    # 行為側錄 / 工作階段重播（會記錄滑鼠軌跡、點擊）
    '*static.cloudflareinsights.com/*',
    '*clarity.ms/*',
    '*hotjar.com/*',
    '*hotjar.io/*',
    '*smartlook.com/*',
    '*rollbar.com/*',
    # 行銷自動化 / DMP
    '*appier.net/*',
    '*.c.appier.net/*',
    '*api.quantumgraph.com/*',
    '*cdn.qgr.ph/*',
    '*.aiqua.io/*',
    '*lndata.com/*',
    '*anymind360.com/*',
    '*cdn.cookielaw.org/*',
    '*geolocation.onetrust.com/*',
    '*tour-uat.ibon.com.tw/*',
    # 客服聊天元件
    '*chat.botbonnie.com/*',
    '*asset.botbonnie.com/*',
    '*web-chat-service.project.imbee.io/*',
    '*web-chat-assets.imbee.io/*',
    # 廣告腳本
    '*/adblock.js',
    '*/google_ad_block.js',
    '*ticketmaster.sg/js/adblock*',
    '*ticketmaster.sg/js/ads.js*',
    '*ticketmaster.com/js/ads.js*',
    # 社群 / 影音嵌入
    '*platform.twitter.com/*',
    '*syndication.twitter.com/*',
    '*youtube.com/*',
    '*player.youku.*',
]

# 參考 tickets_hunter（MaxBot）經 Cloudflare 驗證的啟動參數：關閉多餘背景服務、
# 通知、翻譯、同步等，讓瀏覽器環境更接近一般使用者（降低被偵測機率）。
STEALTH_ARGS = [
    "--disable-background-networking",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-domain-reliability",
    "--disable-infobars",
    "--disable-notifications",
    "--disable-popup-blocking",
    "--disable-renderer-backgrounding",
    "--disable-session-crashed-bubble",
    "--disable-smooth-scrolling",
    "--disable-sync",
    "--disable-translate",
    "--hide-crash-restore-bubble",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-pings",
    "--no-service-autorun",
    "--password-store=basic",
    "--lang=zh-TW",
    "--disable-blink-features=AutomationControlled",
]


def load_config():
    cfg_path = BASE / 'config.json'
    cfg = dict(DEFAULTS)
    if cfg_path.exists():
        try:
            data = json.loads(cfg_path.read_text(encoding='utf-8'))
            cfg.update(data or {})
        except Exception as e:
            print(f"⚠ 讀取 config.json 失敗，使用預設值：{e}")
    else:
        cfg_path.write_text(json.dumps(DEFAULTS, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"ℹ 已建立預設設定檔：{cfg_path}")
    return cfg


def resolve(p):
    path = Path(p)
    return path if path.is_absolute() else (BASE / path).resolve()


# =========================================================================
# OCR 伺服器：版本檢查 + 自動啟動
# =========================================================================
def _ddddocr_version():
    try:
        from importlib.metadata import version
        return version('ddddocr')
    except Exception:
        return None


def ensure_server_deps():
    need = False
    try:
        import flask  # noqa: F401
    except Exception:
        need = True
    v = _ddddocr_version()
    if v != REQUIRED_DDDDOCR:
        need = True
    if not need:
        print(f"✅ 伺服器套件就緒（ddddocr {v}）")
        return
    print(f"ℹ 需安裝/更新伺服器套件（目前 ddddocr：{v or '未安裝'}）...")
    req = (BASE / '..' / 'server' / 'requirements.txt').resolve()
    try:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(req), '-q'])
    except Exception as e:
        print(f"⚠ 安裝伺服器套件失敗：{e}")
    v2 = _ddddocr_version()
    if v2 == REQUIRED_DDDDOCR:
        print(f"✅ ddddocr 已就緒：{v2}")
    else:
        print(f"⚠ ddddocr 版本為 {v2}，預期 {REQUIRED_DDDDOCR}；自訓練模型可能無法使用。")


def is_server_up(url):
    try:
        with urllib.request.urlopen(url.rstrip('/') + '/health', timeout=2) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def start_server_and_wait(cfg, extra_env=None):
    url = (cfg.get('server_url') or 'http://127.0.0.1:5000')
    if is_server_up(url):
        print(f"ℹ OCR 伺服器已在執行：{url}")
        return None
    if not cfg.get('start_server', True):
        print("ℹ 未自動啟動 OCR 伺服器（start_server=false）")
        return None
    server_py = (BASE / '..' / 'server' / 'app_en_tixcraft_V3.py').resolve()
    if not server_py.exists():
        print(f"⚠ 找不到伺服器程式：{server_py}")
        return None

    ensure_server_deps()
    print(f"▶ 啟動 OCR 伺服器：{server_py}")
    import os
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    proc = subprocess.Popen([sys.executable, str(server_py)], cwd=str(server_py.parent), env=env)
    deadline = time.time() + 40
    while time.time() < deadline:
        if is_server_up(url):
            print(f"✅ OCR 伺服器就緒：{url}")
            return proc
        if proc.poll() is not None:
            print("⚠ OCR 伺服器提早結束，請看上方錯誤訊息。")
            return None
        time.sleep(0.5)
    print("⚠ 等待 OCR 伺服器逾時，仍繼續啟動瀏覽器（可稍後再試連線）。")
    return proc


# =========================================================================
# 瀏覽器：自動下載 Chrome for Testing（支援 --load-extension）
# =========================================================================
def _cft_platform():
    """回傳 (Chrome for Testing 平台鍵, 解壓資料夾, 執行檔相對路徑)。"""
    if sys.platform.startswith('win'):
        if sys.maxsize > 2**32:
            return ('win64', 'chrome-win64', 'chrome.exe')
        return ('win32', 'chrome-win32', 'chrome.exe')
    if sys.platform == 'darwin':
        mac_exe = 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        if platform.machine().lower() in ('arm64', 'aarch64'):
            return ('mac-arm64', 'chrome-mac-arm64', mac_exe)
        return ('mac-x64', 'chrome-mac-x64', mac_exe)
    return ('linux64', 'chrome-linux64', 'chrome')


def ensure_chrome_for_testing(cfg):
    """取得瀏覽器執行檔，回傳 (路徑, 是否為 Chrome for Testing)。"""
    explicit = (cfg.get('browser_executable_path') or '').strip()
    if explicit:
        return explicit, False
    if not cfg.get('auto_download_chromium', True):
        return '', False
    plat, folder, rel_exe = _cft_platform()
    dest = resolve(cfg.get('chromium_dir') or '../chrome-for-testing')
    exe = dest / folder / rel_exe
    if exe.exists():
        return str(exe), True
    try:
        print(f"⬇ 下載 Chrome for Testing（{plat}，支援自動載入外掛，僅第一次需要）...")
        with urllib.request.urlopen(CFT_JSON, timeout=60) as r:
            data = json.loads(r.read().decode('utf-8'))
        downloads = data['channels']['Stable']['downloads']['chrome']
        url = next(d['url'] for d in downloads if d['platform'] == plat)
        dest.mkdir(parents=True, exist_ok=True)
        zip_path = dest / f'{folder}.zip'
        with urllib.request.urlopen(url, timeout=600) as r, open(zip_path, 'wb') as f:
            shutil.copyfileobj(r, f)
        print("解壓縮...")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(dest)
        try:
            zip_path.unlink()
        except OSError:
            pass
        if exe.exists():
            print(f"✅ Chrome for Testing：{exe}")
            return str(exe), True
        print("⚠ 解壓縮後找不到執行檔，改用預設瀏覽器。")
    except Exception as e:
        print(f"⚠ 取得 Chrome for Testing 失敗：{e}（改用預設瀏覽器）")
    return '', False


# =========================================================================
# 網路封鎖（追蹤／分析）
# =========================================================================
async def block_trackers(tab, urls):
    """透過 CDP Network.setBlockedURLs 封鎖追蹤請求（不影響購票必要資源）。"""
    from nodriver.cdp import network as cdp_network
    await tab.send(cdp_network.enable())
    await tab.send(cdp_network.set_blocked_ur_ls(urls=urls))


# =========================================================================
# 主流程
# =========================================================================
async def main():
    try:
        import nodriver as uc
    except ImportError:
        print("❌ 尚未安裝 nodriver，請先執行：pip install -r requirements.txt")
        return

    cfg = load_config()
    profile = resolve(cfg['user_data_dir'])
    ext = resolve(cfg['extension_dir'])
    url = (cfg.get('url') or '').strip()
    profile.mkdir(parents=True, exist_ok=True)

    # CDP 受信任點擊：先產生 token／port，讓 OCR 伺服器能提供給擴充功能
    control_token = secrets.token_urlsafe(24)
    control_port = int(cfg.get('control_port') or 5100)
    control_env = {
        'TS_CONTROL_URL': f'http://127.0.0.1:{control_port}',
        'TS_CONTROL_TOKEN': control_token,
    }

    # 1) OCR 伺服器
    server_proc = start_server_and_wait(cfg, control_env)

    # 2) 瀏覽器執行檔
    chrome_exe, using_cft = ensure_chrome_for_testing(cfg)

    # 3) 參數
    args = []
    ws = cfg.get('window_size') or []
    if len(ws) == 2:
        args.append(f"--window-size={ws[0]},{ws[1]}")
    disabled_features = ["TranslateUI"]
    if cfg.get('try_load_extension') and ext.exists():
        args.append(f"--load-extension={ext}")
        if not using_cft:
            # 品牌 Chrome 137+ 的還原開關（Chrome for Testing 不需要）
            disabled_features.append("DisableLoadExtensionCommandLineSwitch")
    elif cfg.get('try_load_extension'):
        print(f"⚠ 找不到外掛資料夾，略過自動載入：{ext}")
    args.append("--disable-features=" + ",".join(disabled_features))
    args += STEALTH_ARGS
    args += list(cfg.get('extra_args') or [])

    print("=" * 60)
    print(" TicketSniper nodriver 啟動器")
    print(f" 專用設定檔：{profile}")
    print(f" 外掛資料夾：{ext if ext.exists() else '（未找到）'}")
    print(f" 瀏覽器　　：{chrome_exe or '（系統預設 Chrome）'}")
    print(f" 目標網址　：{url or '（未設定，請填 config.json 的 url）'}")
    print("=" * 60)

    uc_kwargs = dict(headless=False, user_data_dir=str(profile), browser_args=args)
    if chrome_exe:
        uc_kwargs['browser_executable_path'] = chrome_exe

    browser = await uc.start(**uc_kwargs)

    # 3.5) 封鎖追蹤／分析請求
    if cfg.get('block_trackers', True):
        try:
            await block_trackers(browser.main_tab, TRACKER_BLOCKLIST)
            print(f"✅ 已封鎖 {len(TRACKER_BLOCKLIST)} 項追蹤／分析請求")
        except Exception as e:
            print(f"⚠ 封鎖追蹤請求失敗（不影響其他功能）：{e}")

    # 4) CDP 控制伺服器（受信任點擊）
    control_server = None
    if cfg.get('trusted_click', True):
        try:
            control_server = ControlServer(
                browser=browser, loop=asyncio.get_running_loop(),
                token=control_token, host='127.0.0.1', port=control_port)
            control_server.start()
            print(f"✅ CDP 受信任點擊控制埠：http://127.0.0.1:{control_port}")
        except Exception as e:
            control_server = None
            print(f"⚠ 無法啟動 CDP 控制伺服器（將改用一般點擊）：{e}")

    if url:
        await browser.get(url)
        print(f"✅ 已開啟：{url}")
    else:
        await browser.get("about:blank")
        print("ℹ config.json 的 url 為空，已開新分頁；請填入目標網址後重新啟動。")

    # 導覽後再套用一次（確保在此分頁的 Network domain 已建立）
    if cfg.get('block_trackers', True):
        try:
            await block_trackers(browser.main_tab, TRACKER_BLOCKLIST)
        except Exception:
            pass

    if cfg.get('open_extensions_page'):
        try:
            await browser.get("chrome://extensions", new_tab=True)
            print("ℹ 已開啟 chrome://extensions（若外掛未載入，請手動載入一次）。")
        except Exception as e:
            print(f"ℹ 請手動開啟 chrome://extensions 載入外掛。({e})")

    print("瀏覽器保持開啟中；按 Ctrl+C 或關閉此視窗即可結束。")
    try:
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        if control_server:
            control_server.stop()
        try:
            browser.stop()
        except Exception:
            pass
        if server_proc:
            try:
                server_proc.terminate()
            except Exception:
                pass


# =========================================================================
# 輸出紀錄（把主控台輸出同時寫入 launcher_log.txt，方便回報）
# =========================================================================
class _Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            try:
                s.write(data)
            except Exception:
                pass

    def flush(self):
        for s in self.streams:
            try:
                s.flush()
            except Exception:
                pass


def _setup_log_file():
    try:
        cfg_path = BASE / 'config.json'
        save = True
        if cfg_path.exists():
            try:
                save = json.loads(cfg_path.read_text(encoding='utf-8')).get('save_log', True)
            except Exception:
                pass
        if not save:
            return None
        f = open(BASE / 'launcher_log.txt', 'w', encoding='utf-8')
        out = sys.__stdout__ or sys.stdout
        err = sys.__stderr__ or sys.stderr
        sys.stdout = _Tee(out, f)
        sys.stderr = _Tee(err, f)
        print(f"ℹ 啟動器輸出同步寫入：{BASE / 'launcher_log.txt'}")
        return f
    except Exception:
        return None


if __name__ == '__main__':
    _log_file = _setup_log_file()
    try:
        import nodriver as uc
        uc.loop().run_until_complete(main())
    except KeyboardInterrupt:
        print("\n已結束。")
    finally:
        if _log_file:
            try:
                _log_file.close()
            except Exception:
                pass
