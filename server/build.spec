# build.spec - 最終加強版（解決 onnxruntime error 13）
import os
from pathlib import Path

block_cipher = None

# ==================== 收集所有 ddddocr 模型 ====================
datas = []
cache_path = Path(os.path.expanduser("~")) / ".cache" / "ddddocr"

print("正在收集 ddddocr 模型...")

if cache_path.exists():
    for onnx_file in cache_path.rglob("*.onnx"):
        dest_path = f"ddddocr/{onnx_file.name}"
        datas.append((str(onnx_file), dest_path))
        print(f"✓ 加入模型: {onnx_file.name}")
else:
    # 從安裝包中尋找
    try:
        import ddddocr
        ddddocr_path = Path(ddddocr.__file__).parent
        for onnx_file in ddddocr_path.rglob("*.onnx"):
            dest_path = f"ddddocr/{onnx_file.name}"
            datas.append((str(onnx_file), dest_path))
            print(f"✓ 加入模型: {onnx_file.name}")
    except:
        print("⚠ 無法自動找到模型，使用手動路徑")
        datas = [
            ('common.onnx', 'ddddocr/common.onnx'),
            ('common_old.onnx', 'ddddocr/common_old.onnx'),
            ('common_det.onnx', 'ddddocr/common_det.onnx'),
        ]

print(f"總共打包 {len(datas)} 個官方 ddddocr 模型")

# ==================== 本專案自訓練模型（server/models） ====================
try:
    spec_dir = Path(SPECPATH)  # PyInstaller 提供
except NameError:
    spec_dir = Path(os.path.dirname(os.path.abspath(__file__)))
project_models = spec_dir / 'models'
if project_models.exists():
    for model_file in project_models.rglob('*'):
        if model_file.is_file():
            rel = model_file.relative_to(project_models)
            datas.append((str(model_file), str(Path('models') / rel.parent)))
            print(f"✓ 加入自訓練模型: {rel}")
else:
    print("⚠ 找不到 server/models，打包後將沒有自訓練模型（會回退多策略投票）")

a = Analysis(
    ['app_en_tixcraft_V3.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        # ddddocr 1.5.6 為單檔架構，僅需 'ddddocr'
        'ddddocr',
        'cv2',
        'onnxruntime',
        'onnxruntime.capi',
        'onnxruntime.capi.onnxruntime_pybind11_state',
        'flask',
        'flask_cors',
        'werkzeug',
        'jinja2',
        'itsdangerous',
        'click',
        'markupsafe',
        'PIL',
        'numpy',
    ],
    excludes=['tkinter', 'matplotlib', 'PyQt5', 'PySide2'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# 關鍵修正：強制把 onnxruntime 的 dll 也正確打包
for bin_item in a.binaries:
    if 'onnxruntime' in bin_item[0].lower():
        print(f"找到 onnxruntime binary: {bin_item[0]}")

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='TicketSniper_Server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    runtime_tmpdir=None,
)
