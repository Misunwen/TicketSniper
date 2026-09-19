# encoding=utf-8
"""
TicketSniper 套件檢測與自動安裝

檢查 server/ 與 launcher/ 的 requirements.txt，
逐項比對已安裝版本：缺缺少或版本不符者，自動 pip install。
"""
import re
import subprocess
import sys
from importlib.metadata import version, PackageNotFoundError
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE = Path(__file__).resolve().parent.parent
REQ_FILES = [
    ('伺服器 server', BASE / 'server' / 'requirements.txt'),
    ('啟動器 launcher', BASE / 'launcher' / 'requirements.txt'),
]
REQUIRED_DDDDOCR = '1.5.6'


def parse_requirements(path):
    items = []
    if not path.exists():
        return items
    for raw in path.read_text(encoding='utf-8', errors='ignore').splitlines():
        line = raw.split('#', 1)[0].strip()
        if not line or line.startswith('-'):
            continue
        m = re.match(r'^([A-Za-z0-9_.\-]+)\s*(.*)$', line)
        if not m:
            continue
        items.append((m.group(1), m.group(2).strip()))
    return items


def is_satisfied(name, spec):
    try:
        v = version(name)
    except PackageNotFoundError:
        return False, None
    if spec.startswith('=='):
        return (v == spec[2:].strip()), v
    return True, v


def main():
    print("=" * 60)
    print(" TicketSniper 套件檢測與安裝")
    print("=" * 60)

    pv = sys.version_info
    print(f"Python：{pv.major}.{pv.minor}.{pv.micro}")
    if pv >= (3, 13):
        print("⚠ ddddocr 1.5.6 不支援 Python 3.13+，請改用 Python 3.10～3.12。")

    r = subprocess.run([sys.executable, '-m', 'pip', '--version'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if r.returncode != 0:
        print("ℹ 找不到 pip，嘗試啟用 ensurepip ...")
        subprocess.run([sys.executable, '-m', 'ensurepip', '--upgrade'])

    need_files = []
    for label, path in REQ_FILES:
        print(f"\n[{label}] {path.name}")
        items = parse_requirements(path)
        if not items:
            print("  （找不到或無內容，略過）")
            continue
        missing = []
        for name, spec in items:
            ok, v = is_satisfied(name, spec)
            show = (name + spec) if spec else name
            if ok:
                print(f"  ✅ {show:<38} ({v})")
            else:
                print(f"  ❌ {show:<38} (目前: {v or '未安裝'})")
                missing.append(show)
        if missing:
            need_files.append((label, path, missing))

    if not need_files:
        print("\n🎉 所有套件都已安裝，無需處理。")
        _ddddocr_notice()
        return 0

    print("\n" + "=" * 60)
    print(" 開始安裝缺少的套件...")
    print("=" * 60)
    for label, path, missing in need_files:
        print(f"\n▶ [{label}] pip install -r {path.name}")
        rc = subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(path)])
        if rc.returncode != 0:
            print(f"⚠ [{label}] 安裝過程有錯誤（可能網路或權限問題）。")

    print("\n" + "=" * 60)
    print(" 安裝後檢查")
    print("=" * 60)
    all_ok = True
    for label, path in REQ_FILES:
        for name, spec in parse_requirements(path):
            ok, v = is_satisfied(name, spec)
            show = (name + spec) if spec else name
            print(f"  {'✅' if ok else '❌'} {show:<38} ({v or '未安裝'})")
            all_ok = all_ok and ok

    _ddddocr_notice()
    print("\n" + ("🎉 全部完成！" if all_ok else "⚠ 仍有套件未安裝，請檢查上面的錯誤。"))
    return 0 if all_ok else 1


def _ddddocr_notice():
    try:
        dv = version('ddddocr')
    except PackageNotFoundError:
        return
    if dv != REQUIRED_DDDDOCR:
        print(f"\n⚠ ddddocr 目前為 {dv}，自訓練模型需要 {REQUIRED_DDDDOCR}；"
              f"請執行 pip install ddddocr=={REQUIRED_DDDDOCR}")


if __name__ == '__main__':
    sys.exit(main())
