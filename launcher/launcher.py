# encoding=utf-8
"""
TicketSniper nodriver 啟動器

用 nodriver 開啟一個「專用 Chrome 設定檔」並導到活動頁；
擴充功能若已載入此設定檔，就會沿用 TicketSniper 既有的自動點擊 + 驗證碼邏輯。

注意：Chrome 137+ 已移除命令列的 --load-extension。
- Chromium / 舊版 Chrome：可直接自動載入外掛（try_load_extension=true）。
- 新版 Chrome：請在此設定檔手動載入一次（開發人員模式 → 載入未封裝項目），
  之後會保存在這個專用 profile，不需再載入。
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE = Path(__file__).resolve().parent

DEFAULTS = {
    "url": "https://tixcraft.com/",
    "user_data_dir": "chrome_profile",
    "browser_executable_path": "",
    "window_size": [1280, 900],
    "try_load_extension": True,
    "extension_dir": "../extension",
    "open_extensions_page": True,
    "start_server": False,
    "extra_args": []
}


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


def start_server_if_needed(cfg):
    if not cfg.get('start_server'):
        return None
    server_py = (BASE / '..' / 'server' / 'app_en_tixcraft_V3.py').resolve()
    if not server_py.exists():
        print(f"⚠ 找不到伺服器程式：{server_py}")
        return None
    print(f"▶ 同時啟動 OCR 伺服器：{server_py}")
    return subprocess.Popen([sys.executable, str(server_py)], cwd=str(server_py.parent))


async def main():
    try:
        import nodriver as uc
    except ImportError:
        print("❌ 尚未安裝 nodriver，請先執行：pip install -r requirements.txt")
        return

    cfg = load_config()
    profile = resolve(cfg['user_data_dir'])
    ext = resolve(cfg['extension_dir'])
    profile.mkdir(parents=True, exist_ok=True)

    args = []
    ws = cfg.get('window_size') or []
    if len(ws) == 2:
        args.append(f"--window-size={ws[0]},{ws[1]}")
    if cfg.get('try_load_extension') and ext.exists():
        args.append(f"--load-extension={ext}")
    elif cfg.get('try_load_extension'):
        print(f"⚠ 找不到外掛資料夾，略過自動載入：{ext}")
    args += list(cfg.get('extra_args') or [])
    args += ["--no-first-run", "--no-default-browser-check"]

    server_proc = start_server_if_needed(cfg)

    print("=" * 60)
    print(" TicketSniper nodriver 啟動器")
    print(f" 專用設定檔：{profile}")
    print(f" 外掛資料夾：{ext if ext.exists() else '（未找到）'}")
    print(f" 目標網址　：{cfg['url']}")
    print("=" * 60)

    uc_kwargs = dict(headless=False, user_data_dir=str(profile), browser_args=args)
    if cfg.get('browser_executable_path'):
        uc_kwargs['browser_executable_path'] = cfg['browser_executable_path']

    browser = await uc.start(**uc_kwargs)
    await browser.get(cfg['url'])
    print(f"✅ 已開啟：{cfg['url']}")

    if cfg.get('open_extensions_page'):
        try:
            await browser.get("chrome://extensions", new_tab=True)
            print("ℹ 已開啟 chrome://extensions。若外掛未載入，請開『開發人員模式』→"
                  "『載入未封裝項目』選 extension 資料夾（只需一次，會保存在此設定檔）。")
        except Exception as e:
            print(f"ℹ 請手動開啟 chrome://extensions 載入外掛（只需一次）。({e})")

    print("瀏覽器保持開啟中；按 Ctrl+C 或關閉此視窗即可結束。")
    try:
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        try:
            browser.stop()
        except Exception:
            pass
        if server_proc:
            try:
                server_proc.terminate()
            except Exception:
                pass


if __name__ == '__main__':
    try:
        import nodriver as uc
        uc.loop().run_until_complete(main())
    except KeyboardInterrupt:
        print("\n已結束。")
