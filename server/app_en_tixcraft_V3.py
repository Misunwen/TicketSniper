# app_en_tixcraft - V45.0 優化版
from flask import Flask, request, jsonify
from flask_cors import CORS
import ddddocr
import base64
import hashlib
import threading
import os
from datetime import datetime
from collections import OrderedDict
from io import BytesIO
from PIL import Image, ImageOps, ImageStat, ImageFilter
from itertools import combinations
import numpy as np
import sys

# 讓 emoji / 中文輸出不受主控台編碼影響（cp950 會讓 print 丟例外）
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

APP_VERSION = '45.0'
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 單張圖片大小上限 4MB

# ==========================================
# 📝 辨識紀錄檔（tab 分隔，結尾 .dat，可用 Excel 開啟）
# ==========================================
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recognition_log.dat')
LOG_HEADER = [
    '時間', '預期長度', 'Yii2hash', 'hash使用', 'hash驗證', '校正前',
    '結果', '方法', '重試', '策略數', '策略輸出', '前3名', '投票明細', '圖片hash', '快取',
]
_log_lock = threading.Lock()


def write_log(record):
    try:
        with _log_lock:
            new_file = not os.path.exists(LOG_FILE)
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                if new_file:
                    f.write('\ufeff')  # BOM，讓 Excel 正確顯示中文
                    f.write('\t'.join(LOG_HEADER) + '\n')
                f.write('\t'.join(str(x) for x in record) + '\n')
    except Exception as e:
        print(f"⚠ 寫入紀錄檔失敗: {e}")


def _ensure_log_header():
    """若既有紀錄檔欄位與現在不同，先備份再重新開始，避免新舊欄位錯亂。"""
    try:
        if not os.path.exists(LOG_FILE):
            return
        with open(LOG_FILE, 'r', encoding='utf-8-sig') as f:
            first = f.readline().strip('\r\n')
        if first.split('\t') != LOG_HEADER:
            backup = LOG_FILE.replace('.dat', f'_{datetime.now().strftime("%Y%m%d_%H%M%S")}.dat')
            os.replace(LOG_FILE, backup)
            print(f"ℹ 舊紀錄格式不同，已備份為 {os.path.basename(backup)}，重新建立紀錄檔。")
    except Exception as e:
        print(f"⚠ 檢查紀錄檔失敗: {e}")


_ensure_log_header()


def log_payload(cache_key, expected_length, yii_hash, payload, cached, retry=0):
    """把一次辨識的 hash 與結果寫入 .dat。"""
    votes = payload.get('votes') or {}
    vote_str = ' / '.join(f"{k}({v})" for k, v in votes.items())
    top3 = payload.get('top3') or []
    top3_str = ' / '.join(f"{k}({v})" for k, v in top3)
    record = [
        datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        expected_length,
        yii_hash if yii_hash else 0,
        'YES' if payload.get('hash_used') else 'NO',
        payload.get('hash_verified', ''),
        payload.get('corrected_from', ''),
        payload.get('text', ''),
        payload.get('method', ''),
        retry,
        payload.get('total_strategies', ''),
        payload.get('strategies', ''),
        top3_str,
        vote_str,
        cache_key[:12],
        'HIT' if cached else 'NEW',
    ]
    write_log(record)

# 提早結束：當足夠多策略達成強共識時，不再跑完剩下的策略
# （目前策略數僅 6 個且改以逐字元投票，提早結束效益低，預設關閉）
EARLY_EXIT_ENABLED = False
MIN_CONSENSUS_STRATEGIES = 5   # 至少幾個策略同意才可提前結束
CONSENSUS_SHARE = 0.6          # 冠軍得票占總票數比例門檻

app = Flask(__name__)
CORS(app)

# ==========================================
# 🤖 OCR 模型初始化
# ==========================================
ocr = ddddocr.DdddOcr(show_ad=False)
ocr.set_ranges("abcdefghijklmnopqrstuvwxyz")

_ocr_supports_confidence = True


def ocr_classify(img_bytes):
    """
    包裝 ddddocr，回傳 (text, confidence)。
    若此版本不支援 probability 參數則自動退回，confidence 固定 1.0。
    """
    global _ocr_supports_confidence
    if _ocr_supports_confidence:
        try:
            res = ocr.classification(img_bytes, probability=True)
            if isinstance(res, dict):
                text = res.get('text') or ''
                conf = res.get('confidence', 1.0)
                try:
                    conf = float(conf)
                except (TypeError, ValueError):
                    conf = 1.0
                return text, max(0.0, min(1.0, conf))
        except TypeError:
            _ocr_supports_confidence = False
        except Exception:
            return '', 0.0
    try:
        return ocr.classification(img_bytes), 1.0
    except Exception:
        return '', 0.0


# ==========================================
# 🧠 自訓練 ONNX 模型（參考 bouob/tickets_hunter, GPL-3.0）
# 目錄：server/models/{tixcraft_tm,universal}
#   tixcraft_tm：tixcraft / indievox / ticketmaster 家族，純小寫 a-z
#   universal  ：通用（數字+大小寫英文）
# 找不到模型時自動回退下方多策略投票。
# ==========================================
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
MODEL_NAME_MAP = {
    'tixcraft': 'tixcraft_tm',
    'tixcraft_tm': 'tixcraft_tm',
    'indievox': 'tixcraft_tm',
    'ticketmaster': 'tixcraft_tm',
    'universal': 'universal',
}
_custom_ocr_cache = {}
_custom_ocr_lock = threading.Lock()
_ddddocr_custom_support = None


def _ddddocr_supports_custom():
    """這些 custom.onnx 的輸出是 int64 索引，需 ddddocr 1.5.x 解碼；
    ddddocr 1.6+（有 compat 模組）會做 argmax 而得到錯誤結果，故停用。"""
    global _ddddocr_custom_support
    if _ddddocr_custom_support is None:
        try:
            import ddddocr.compat  # noqa: F401  (僅 1.6+ 存在)
            print("⚠ 偵測到 ddddocr 1.6+，與自訓練模型不相容；請安裝 requirements 的 ddddocr==1.5.6")
            _ddddocr_custom_support = False
        except Exception:
            _ddddocr_custom_support = True
    return _ddddocr_custom_support


def get_custom_ocr(model_key):
    """依 model_key 取得（並快取）自訓練 ddddocr 實例；無對應模型回傳 None。"""
    model_name = MODEL_NAME_MAP.get((model_key or '').strip().lower())
    if not model_name:
        return None
    if not _ddddocr_supports_custom():
        return None
    with _custom_ocr_lock:
        if model_name in _custom_ocr_cache:
            return _custom_ocr_cache[model_name]
        onnx_path = os.path.join(MODEL_DIR, model_name, 'custom.onnx')
        charsets_path = os.path.join(MODEL_DIR, model_name, 'charsets.json')
        obj = None
        if os.path.exists(onnx_path) and os.path.exists(charsets_path):
            try:
                obj = ddddocr.DdddOcr(
                    det=False, ocr=False, show_ad=False,
                    import_onnx_path=onnx_path,
                    charsets_path=charsets_path
                )
                print(f"✅ 載入自訓練模型：{model_name}")
            except Exception as e:
                print(f"⚠ 自訓練模型載入失敗 ({model_name}): {e}")
                obj = None
        else:
            print(f"ℹ 找不到自訓練模型，回退策略投票：{onnx_path}")
        _custom_ocr_cache[model_name] = obj
        return obj


def custom_ocr_classify(ocr_obj, img_bytes, model_name):
    """自訓練模型辨識（直接吃原始圖片 bytes，無需前處理）。"""
    try:
        res = ocr_obj.classification(img_bytes)
        if isinstance(res, dict):
            text = res.get('text') or ''
            conf = res.get('confidence', 1.0)
            try:
                conf = float(conf)
            except (TypeError, ValueError):
                conf = 1.0
        else:
            text, conf = (res or ''), 1.0
        text = (text or '').strip()
        if model_name == 'tixcraft_tm':
            text = text.lower()
        return text, max(0.0, min(1.0, conf))
    except Exception as e:
        print(f"⚠ 自訓練模型辨識失敗: {e}")
        return '', 0.0


# ==========================================
# 🗃️ 辨識結果快取（同一張圖重複請求直接命中）
# ==========================================
_result_cache = OrderedDict()
_result_cache_lock = threading.Lock()
RESULT_CACHE_MAX = 128


def cache_get(key):
    with _result_cache_lock:
        if key in _result_cache:
            _result_cache.move_to_end(key)
            return _result_cache[key]
    return None


def cache_put(key, value):
    with _result_cache_lock:
        _result_cache[key] = value
        _result_cache.move_to_end(key)
        while len(_result_cache) > RESULT_CACHE_MAX:
            _result_cache.popitem(last=False)

# ==========================================
# 🔵 核心提取器：多層次白色提取
# ==========================================
def extract_white_multilevel(original_rgb, threshold=150):
    """
    多層次白色提取
    - 計算每個像素的「白色程度」
    - 用 threshold 控制敏感度
    """
    img_array = np.array(original_rgb.convert('RGB'), dtype=np.float32)
    R = img_array[:,:,0]
    G = img_array[:,:,1]
    B = img_array[:,:,2]

    # 亮度 = 三通道平均
    brightness = (R + G + B) / 3.0

    # 色彩飽和度 = 最大通道 - 最小通道
    # 白色飽和度接近0，藍色飽和度高
    saturation = np.max(img_array, axis=2) - np.min(img_array, axis=2)

    # 白色條件：亮度高 且 飽和度低
    white_mask = (brightness > threshold) & (saturation < 60)

    result = np.zeros((img_array.shape[0], img_array.shape[1]), dtype=np.uint8)
    result[white_mask] = 255

    return Image.fromarray(result, mode='L')


def extract_non_blue_channel(original_rgb, sensitivity=40):
    """
    濾掉藍色背景
    藍色特徵：B >> R 且 B >> G
    """
    img_array = np.array(original_rgb.convert('RGB'), dtype=np.int32)
    R = img_array[:,:,0]
    G = img_array[:,:,1]
    B = img_array[:,:,2]

    # 非藍色條件：B 不是明顯大於 R 和 G
    not_blue = ~((B > R + sensitivity) & (B > G + sensitivity // 2))

    brightness = ((R + G + B) / 3).astype(np.uint8)
    result = np.zeros_like(brightness)
    result[not_blue] = brightness[not_blue]

    return Image.fromarray(result, mode='L')


def extract_by_hue(original_rgb):
    """
    用色相(Hue)過濾藍色
    藍色 Hue ≈ 200~260度
    白色 Hue = 任意（飽和度接近0）
    """
    img_hsv = original_rgb.convert('RGB')
    img_array = np.array(img_hsv, dtype=np.float32) / 255.0
    R = img_array[:,:,0]
    G = img_array[:,:,1]
    B = img_array[:,:,2]

    maxC = np.max(img_array, axis=2)
    minC = np.min(img_array, axis=2)
    delta = maxC - minC

    # 飽和度
    saturation = np.where(maxC > 0, delta / maxC, 0)
    # 亮度（V通道）
    value = maxC

    # 白色：高亮度 + 低飽和度
    white_mask = (value > 0.65) & (saturation < 0.25)

    result = np.zeros((img_array.shape[0], img_array.shape[1]), dtype=np.uint8)
    result[white_mask] = 255

    return Image.fromarray(result, mode='L')


# ==========================================
# 🧅 基礎預處理
# ==========================================
def standardize_captcha_image(img_rgb):
    img = img_rgb.convert('L')
    w, h = img.size

    edges = []
    for x in range(w):
        edges.extend([img.getpixel((x, 0)), img.getpixel((x, h-1))])
    for y in range(h):
        edges.extend([img.getpixel((0, y)), img.getpixel((w-1, y))])

    outer_bg = max(set(edges), key=edges.count)
    mask = img.point(lambda p: 255 if abs(p - outer_bg) > 20 else 0)
    bbox = mask.getbbox()
    if bbox:
        img = img.crop(bbox)

    w, h = img.size
    inner_edges = []
    for x in range(w):
        inner_edges.extend([img.getpixel((x, 0)), img.getpixel((x, h-1))])
    for y in range(h):
        inner_edges.extend([img.getpixel((0, y)), img.getpixel((w-1, y))])

    if inner_edges:
        inner_bg = max(set(inner_edges), key=inner_edges.count)
        if inner_bg < 127:
            img = ImageOps.invert(img)

    return img

# ==========================================
# 🧠 自適應閾值
# ==========================================
def get_adaptive_threshold(img):
    stat = ImageStat.Stat(img)
    mean = stat.mean[0]
    stddev = stat.stddev[0]

    if stddev > 40:
        threshold = mean - stddev * 0.2
    else:
        histogram = img.histogram()
        total_pixels = sum(histogram)
        cumsum = 0
        threshold = 127
        for i, count in enumerate(histogram):
            cumsum += count
            if cumsum >= total_pixels * 0.4:
                threshold = i
                break

    return max(80, min(200, int(threshold)))

# ==========================================
# 🔬 形態學
# ==========================================
def morphology_open(img, size=3):
    if size % 2 == 0:
        size += 1
    img = img.filter(ImageFilter.MinFilter(size))
    img = img.filter(ImageFilter.MaxFilter(size))
    return img
def morphology_close(img, size=3):
    if size % 2 == 0:
        size += 1
    img = img.filter(ImageFilter.MaxFilter(size))
    img = img.filter(ImageFilter.MinFilter(size))
    return img
def dilate(img, size=3):
    """膨脹：讓白色區域變大（填補空洞）"""
    if size % 2 == 0:
        size += 1
    return img.filter(ImageFilter.MaxFilter(size))
def erode(img, size=3):
    """腐蝕：讓白色區域縮小（去噪點）"""
    if size % 2 == 0:
        size += 1
    return img.filter(ImageFilter.MinFilter(size))


# ==========================================
# 📊 智慧切割
# ==========================================
def find_ink_valleys(img, expected_chars, valley_ratio=0.35):
    w, h = img.size
    pixels = img.load()

    col_ink = []
    for x in range(w):
        ink_count = sum(1 for y in range(h) if pixels[x, y] < 128)
        col_ink.append(ink_count)

    if not col_ink or max(col_ink) == 0:
        return []

    max_ink = max(col_ink)
    n_cuts = expected_chars - 1
    if n_cuts <= 0:
        return []

    # 平滑處理
    window = 3
    smoothed = []
    for i in range(len(col_ink)):
        start = max(0, i - window)
        end = min(len(col_ink), i + window + 1)
        smoothed.append(sum(col_ink[start:end]) / (end - start))

    # 找谷底（valley_ratio 越大越容易找到淺谷，適合黏連字）
    valleys = []
    for i in range(2, len(smoothed) - 2):
        if (smoothed[i] <= smoothed[i-1] and
            smoothed[i] <= smoothed[i+1] and
            smoothed[i] < max_ink * valley_ratio):
            valleys.append((i, smoothed[i]))

    if len(valleys) < n_cuts:
        return []

    return _select_best_valleys(valleys, n_cuts, w)

def _select_best_valleys(valleys, n_cuts, total_width):
    if len(valleys) == n_cuts:
        return [v[0] for v in valleys]
    ideal_spacing = total_width / (n_cuts + 1)
    best_score = float('inf')
    best_combo = None
    candidates = valleys[:min(len(valleys), 15)]
    for combo in combinations(candidates, n_cuts):
        positions = sorted([c[0] for c in combo])
        score = sum(
            abs(pos - ideal_spacing * (i + 1))
            for i, pos in enumerate(positions)
        )
        ink_penalty = sum(c[1] for c in combo)
        total_score = score + ink_penalty * 2
        if total_score < best_score:
            best_score = total_score
            best_combo = positions
    return best_combo or [v[0] for v in valleys[:n_cuts]]
# ==========================================
# 🔧 增強版長度修正（針對 tixcraft 常見黏連）
# ==========================================
def try_fix_length(text, expected_length, _seen=None, _depth=0):
    if not text or not expected_length:
        return text
    if len(text) == expected_length:
        return text
    if _depth >= 4:
        return text
    if _seen is None:
        _seen = set()
    if text in _seen:
        return text
    _seen.add(text)

    diff = expected_length - len(text)
    original_text = text

    # 長度不足：展開黏連字母（單字被讀成一個，需還原成兩個）
    if diff > 0:
        sticky_map = {
            'w': ['uu', 'vv'],
            'm': ['rn', 'nn', 'in', 'ni', 'rm'],
            'n': ['ri', 'il', 'ii', 'in'],
            'u': ['ii', 'vv'],
            'o': ['oo', 'cq'],
            'h': ['ln', 'lr'],
            'b': ['lo', 'lb'],
            'd': ['cl', 'ol'],
            'g': ['cj', 'qj'],
            'v': ['u', 'w'],
            'i': ['l', 't', 'j'],
            'l': ['i', 't'],
            't': ['l', 'i', 'f'],
            'c': ['o'],
        }

        for i, ch in enumerate(text):
            if ch not in sticky_map:
                continue
            for expansion in sticky_map[ch]:
                candidate = text[:i] + expansion + text[i+1:]
                if len(candidate) == expected_length:
                    return candidate
                if len(candidate) < expected_length:
                    # 遞迴展開（處理多處黏連，含深度與重複防護）
                    fixed = try_fix_length(candidate, expected_length, _seen, _depth + 1)
                    if len(fixed) == expected_length:
                        return fixed

    # 長度過多：合併黏連字母（兩個字被讀成兩個，需合併成一個）
    if diff < 0:
        merge_map = {
            'rn': 'm', 'nn': 'm', 'rm': 'm', 'in': 'm', 'ni': 'm',
            'uu': 'w', 'vv': 'w',
            'il': 'n', 'ri': 'n', 'li': 'n', 'ii': 'n',
            'cj': 'g', 'qj': 'g',
            'lo': 'b', 'lb': 'b',
            'cl': 'd', 'ol': 'd',
            'lr': 'h', 'ln': 'h',
        }
        for pattern, replacement in merge_map.items():
            if pattern in text:
                candidate = text.replace(pattern, replacement, 1)
                if len(candidate) == expected_length:
                    return candidate
                if len(candidate) > expected_length:
                    fixed = try_fix_length(candidate, expected_length, _seen, _depth + 1)
                    if len(fixed) == expected_length:
                        return fixed

    return original_text


# ==========================================
# 🏆 強化版投票系統（新增黏連信心度）
# ==========================================
def calculate_confidence(text, expected_length, strategy_name=""):
    if not text:
        return 0.0
    score = 1.0
    
    # 長度分數
    if expected_length:
        length_diff = abs(len(text) - expected_length)
        score *= max(0.1, 1.0 - length_diff * 0.45)
    
    # 有效字母比例
    valid_chars = sum(1 for c in text if c.islower() and c.isalpha())
    score *= (valid_chars / len(text)) if text else 0
    
    # 黏連模式獎勵（如果有修正過但長度正確，給予加分）
    if expected_length and len(text) == expected_length:
        if 'w' in text or 'm' in text or 'vv' in text or 'rn' in text:
            score *= 1.15  # 這些常見黏連字母，如果修正成功則加分
    
    return min(1.0, score)
def weighted_vote(results, expected_length):
    vote_box = {}
    image_box = {}
    strategy_type_weight = {
        'BLUE': 1.35,      # BLUE 系列最可靠
        'HUE':  1.15,
        'SMART': 1.25,     # 智慧切割很重要
        'AGGRO': 0.85,
        'NONBLUE': 0.9,
    }
    
    for strategy_name, text, image, base_weight, ocr_conf in results:
        if not text:
            continue
            
        fixed_text = try_fix_length(text, expected_length)
        is_fixed = fixed_text != text
        
        # 取得策略類型權重
        type_weight = 1.0
        for key, weight in strategy_type_weight.items():
            if key in strategy_name.upper():
                type_weight = weight
                break
                
        confidence = calculate_confidence(fixed_text, expected_length, strategy_name)
        # OCR 模型信心度：0.6~1.0 之間微調，避免完全主導投票
        conf_factor = 0.6 + 0.4 * max(0.0, min(1.0, ocr_conf))
        final_weight = base_weight * confidence * type_weight * conf_factor
        
        # 如果有進行長度修正，給予額外獎勵（因為這是我們最需要解決的問題）
        if is_fixed and len(fixed_text) == expected_length:
            final_weight *= 1.25
        
        if fixed_text in vote_box:
            vote_box[fixed_text] += final_weight
        else:
            vote_box[fixed_text] = final_weight
            image_box[fixed_text] = image
    
    if not vote_box:
        return None, None, {}
    
    best = max(vote_box, key=vote_box.get)
    return best, image_box.get(best), vote_box


# ==========================================
# 🎨 共用後處理流程
# ==========================================
def post_process(img_L, zoom, h_mult, w_mult, threshold=127,
                 do_open=False, do_close=False,
                 dilate_size=0, erode_size=0,
                 sharpen=False, invert_output=True):
    """
    統一的後處理流程：
    1. 縮放
    2. 二值化
    3. 形態學操作
    4. 裁切
    5. 標準化尺寸
    """
    resample = getattr(Image, 'Resampling', Image).LANCZOS

    # 縮放
    new_w = max(int(img_L.width * zoom), 1)
    new_h = max(int(img_L.height * zoom), 1)
    img_L = img_L.resize((new_w, new_h), resample)

    # 二值化
    img_L = img_L.point(lambda p: 255 if p > threshold else 0)

    # 形態學
    if erode_size > 0:
        img_L = erode(img_L, erode_size)
        img_L = img_L.point(lambda p: 255 if p > 127 else 0)
    if dilate_size > 0:
        img_L = dilate(img_L, dilate_size)
        img_L = img_L.point(lambda p: 255 if p > 127 else 0)
    if do_open:
        img_L = morphology_open(img_L, 3)
        img_L = img_L.point(lambda p: 255 if p > 127 else 0)
    if do_close:
        img_L = morphology_close(img_L, 3)
        img_L = img_L.point(lambda p: 255 if p > 127 else 0)

    # 銳化
    if sharpen:
        img_L = img_L.filter(ImageFilter.SHARPEN)
        img_L = img_L.point(lambda p: 255 if p > 127 else 0)

    # 反轉為白底黑字（OCR標準）
    if invert_output:
        img_L = ImageOps.invert(img_L)

    # 裁切空白
    bbox = ImageOps.invert(img_L).getbbox()
    if bbox:
        img_L = img_L.crop(bbox)

    # 標準化高度
    h = max(int(42 * h_mult), 1)
    w = max(int(img_L.width * (h / max(img_L.height, 1)) * w_mult), 1)
    img_L = img_L.resize((w, h), resample)

    return ImageOps.expand(img_L, border=20, fill='white')


# ==========================================
# 🎯 策略工廠 - V45.0 優化版（重點強化黏連與長度）
# ==========================================
def extract_cached(cache, key, factory):
    """同一次辨識中，相同條件的提取只做一次（前處理共用）。"""
    if cache is None:
        return factory()
    if key not in cache:
        cache[key] = factory()
    return cache[key]


# --- BLUE 系列：白色亮度提取（核心，最穩定）---
def make_blue_strategy(threshold=150, zoom=2.5, h_mult=1.0, w_mult=1.0,
                       do_close=False, dilate_size=0, erode_size=0,
                       sharpen=False, post_threshold=127):
    def strategy(img_rgb, cache=None):
        img_L = extract_cached(
            cache, ('white', threshold),
            lambda: extract_white_multilevel(img_rgb, threshold)
        )
        return post_process(img_L, zoom, h_mult, w_mult,
                            threshold=post_threshold,
                            do_close=do_close, dilate_size=dilate_size,
                            erode_size=erode_size, sharpen=sharpen)
    return strategy
# --- HUE 系列：色相提取（對藍底干擾抵抗力強）---
def make_hue_strategy(zoom=2.5, h_mult=1.0, dilate_size=0,
                      post_threshold=127):
    def strategy(img_rgb, cache=None):
        img_L = extract_cached(cache, ('hue',), lambda: extract_by_hue(img_rgb))
        return post_process(img_L, zoom, h_mult, 1.0,
                            threshold=post_threshold,
                            dilate_size=dilate_size)
    return strategy
# --- NONBLUE 系列：非藍通道（輔助用）---
def make_nonblue_strategy(sensitivity=40, zoom=2.5, h_mult=1.0,
                          post_threshold=80):
    def strategy(img_rgb, cache=None):
        img_L = extract_cached(
            cache, ('nonblue', sensitivity),
            lambda: extract_non_blue_channel(img_rgb, sensitivity)
        )
        return post_process(img_L, zoom, h_mult, 1.0, threshold=post_threshold)
    return strategy
# --- SMART SPLIT 系列：智慧切割（針對黏連專用）---
def make_smart_split(expected_chars=4, zoom=3.2, gap=4, h_mult=1.0,
                     valley_ratio=0.35, thin_size=0):
    def strategy(img_gray, cache=None):
        resample = getattr(Image, 'Resampling', Image).LANCZOS
        img_L = img_gray.resize(
            (int(img_gray.width * zoom), int(img_gray.height * zoom)), resample
        )
        thr = get_adaptive_threshold(img_L)
        img_L = img_L.point(lambda p: 255 if p > thr else 0)

        # 細化筆畫（讓黏在一起的字分開）：黑字小幅變細
        if thin_size and thin_size > 0:
            size = thin_size if thin_size % 2 == 1 else thin_size + 1
            img_L = img_L.filter(ImageFilter.MaxFilter(size))
            img_L = img_L.point(lambda p: 255 if p > 127 else 0)

        cut_points = find_ink_valleys(img_L, expected_chars, valley_ratio)
        if cut_points:
            pixels = img_L.load()
            W, H = img_L.size
            bbox = ImageOps.invert(img_L).getbbox()
            if bbox:
                top, bottom = bbox[1], bbox[3]
                for cx in cut_points:
                    for gx in range(-gap, gap + 1):
                        x = cx + gx
                        if 0 <= x < W:
                            for y in range(top, bottom):
                                pixels[x, y] = 255
        bbox = ImageOps.invert(img_L).getbbox()
        if bbox:
            img_L = img_L.crop(bbox)
        h = max(int(42 * h_mult), 1)
        w = max(int(img_L.width * (h / max(img_L.height, 1))), 1)
        img_L = img_L.resize((w, h), resample)
        return ImageOps.expand(img_L, border=20, fill='white')
    return strategy
# --- AGGRO SPLIT：暴力均分切割（當智慧切割失敗時的保底）---
def make_aggro_split(expected_chars=4, zoom=3.0, gap=5):
    def strategy(img_gray, cache=None):
        resample = getattr(Image, 'Resampling', Image).LANCZOS
        img_L = img_gray.resize(
            (int(img_gray.width * zoom), int(img_gray.height * zoom)), resample
        )
        img_L = img_L.point(lambda p: 255 if p > 127 else 0)
        bbox = ImageOps.invert(img_L).getbbox()
        if bbox:
            left, top, right, bottom = bbox
            W = img_L.size[0]
            pixels = img_L.load()
            total_width = right - left
            segment_width = total_width / expected_chars
            for i in range(1, expected_chars):
                cut_x = left + int(segment_width * i)
                for gx in range(-gap//2, gap//2 + 1):
                    cx = cut_x + gx
                    if 0 <= cx < W:
                        for y in range(top, bottom):
                            pixels[cx, y] = 255
        bbox = ImageOps.invert(img_L).getbbox()
        if bbox:
            img_L = img_L.crop(bbox)
        h = 42
        w = max(int(img_L.width * (h / max(img_L.height, 1))), 1)
        img_L = img_L.resize((w, h), resample)
        return ImageOps.expand(img_L, border=20, fill='white')
    return strategy


# ==========================================
# ❤️ 健康檢查（供擴充功能偵測伺服器狀態）
# ==========================================
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'success': True, 'status': 'ok', 'version': APP_VERSION})


# ==========================================
# 🔒 單飛鎖（同一張圖併發請求只計算一次）
# ==========================================
_key_locks = {}
_key_locks_guard = threading.Lock()


def get_key_lock(key):
    with _key_locks_guard:
        lock = _key_locks.get(key)
        if lock is None:
            if len(_key_locks) > 1024:
                _key_locks.clear()
            lock = threading.Lock()
            _key_locks[key] = lock
        return lock


# ==========================================
# 🎯 策略表（依預期長度動態產生）
# ==========================================
def build_strategies(expected_length):
    # 依 102 張真實拓元樣本調校出的精選策略。
    # 實測：少數「多樣」策略（不同提取法 + 切割）逐字元投票，明顯優於大量相似變體。
    return [
        ("NONBLUE_30_z20", 10, True, make_nonblue_strategy(sensitivity=30, zoom=2.0, post_threshold=75)),
        ("NONBLUE_20_z20", 10, True, make_nonblue_strategy(sensitivity=20, zoom=2.0, post_threshold=75)),
        ("NONBLUE_40_z28", 10, True, make_nonblue_strategy(sensitivity=40, zoom=2.8, post_threshold=75)),
        ("BLUE_140_z20",   10, True, make_blue_strategy(threshold=140, zoom=2.0, post_threshold=75)),
        ("HUE_z18",         9, True, make_hue_strategy(zoom=1.8, post_threshold=80)),
        # 切割類：提供與提取法不同的錯誤型態，逐字元投票時能互補（也處理黏連）
        ("SMART_z28",       6, False, make_smart_split(expected_chars=expected_length, zoom=2.8, gap=4)),
        ("AGGRO_z28",       5, False, make_aggro_split(expected_chars=expected_length, zoom=2.8, gap=6)),
    ]


# ==========================================
# 🧠 核心辨識（多策略 + 投票）
# ==========================================
def strategy_family(name):
    for fam in ('NONBLUE', 'SMART', 'AGGRO', 'BLUE', 'HUE'):
        if name.upper().startswith(fam):
            return fam
    return 'OTHER'


def reached_consensus(results, expected_length):
    """判斷目前結果是否已達到可提早結束的強共識。
    需同時滿足：足夠策略同意、跨至少兩個策略家族、冠軍票數占比夠高。
    """
    if len(results) < MIN_CONSENSUS_STRATEGIES:
        return False
    best, _img, vote_map = weighted_vote(results, expected_length)
    if not best or not vote_map:
        return False
    total = sum(vote_map.values())
    if total <= 0:
        return False
    agreeing = [
        n for n, t, _im, _bw, _c in results
        if t and try_fix_length(t, expected_length) == best
    ]
    if len(agreeing) < MIN_CONSENSUS_STRATEGIES:
        return False
    families = {strategy_family(n) for n in agreeing}
    return len(families) >= 2 and (vote_map[best] / total) >= CONSENSUS_SHARE


# ==========================================
# 🔐 Yii2 驗證碼 hash 校正（參考 Yii2 CaptchaAction::generateValidationHash）
# ==========================================
def yii_captcha_hash(code):
    """Yii2 前端驗證用的加權總和：sum(ord(c) << i)，小寫。"""
    return sum(ord(c) << i for i, c in enumerate(code.lower()))


def yii_captcha_correct(answer, expected_hash, charset="abcdefghijklmnopqrstuvwxyz", length=4):
    """
    若 answer 與頁面提供的 hash 不符，找出「只改一個字元」就能對上 hash 的候選。
    注意：此 hash 碰撞多，只能用於「單一字元錯誤」的修正，不能反解全部。
    回傳 (corrected, matched, candidates)。
    """
    if not answer or not expected_hash or len(answer) != length:
        return answer, False, []
    answer = answer.lower()
    if yii_captcha_hash(answer) == expected_hash:
        return answer, True, [answer]

    codes = [ord(c) for c in charset]
    lo, hi = min(codes), max(codes)
    candidates = []
    for pos in range(length):
        fixed_sum = sum(ord(answer[j]) << j for j in range(length) if j != pos)
        remainder = expected_hash - fixed_sum
        shift = 1 << pos
        if remainder > 0 and remainder % shift == 0:
            c_code = remainder // shift
            if lo <= c_code <= hi and chr(c_code) != answer[pos]:
                candidates.append(answer[:pos] + chr(c_code) + answer[pos + 1:])
    if candidates:
        return candidates[0], True, candidates
    return answer, False, []


def position_vote(results, expected_length):
    """
    逐字元投票（主要決策）：
    只採用「長度等於 expected_length」的策略輸出，逐個位置取加權多數。
    對拓元這種字數固定、偶爾把相鄰字併成一個的情況，比全字串投票準確。
    回傳 (text or None, 每位置票數)。
    """
    if not expected_length or expected_length < 1:
        return None, None
    cols = [dict() for _ in range(expected_length)]
    for _name, text, _img, _bw, conf in results:
        if len(text) != expected_length:
            continue
        w = 0.6 + 0.4 * max(0.0, min(1.0, conf))
        for i, ch in enumerate(text):
            cols[i][ch] = cols[i].get(ch, 0.0) + w
    if not all(cols):
        return None, None
    return ''.join(max(c, key=c.get) for c in cols), cols


def recognize_core(original_rgb, base_img, expected_length,
                   current_round=1, recognize_times_total=1,
                   custom_ocr=None, raw_bytes=None, custom_model_name=None):
    # ① 自訓練模型優先（raw bytes，無需前處理）
    if custom_ocr is not None and raw_bytes is not None:
        try:
            text, conf = custom_ocr_classify(custom_ocr, raw_bytes, custom_model_name or '')
            if text:
                print(f"\n🧠 自訓練模型 [{custom_model_name}] → '{text}' (len={len(text)}, conf={conf:.2f})")
                if not expected_length or len(text) == expected_length:
                    return {
                        'success': True,
                        'text': text,
                        'method': 'custom',
                        'votes': {text: round(conf, 2)},
                        'top3': [[text, round(conf, 2)]],
                        'strategies': f"[{custom_model_name}]={text}",
                        'total_strategies': 1,
                        'winner_votes': round(conf, 2),
                        'version': APP_VERSION,
                    }
                print(f"   ↳ 長度不符（期望 {expected_length}），改用多策略投票")
        except Exception as e:
            print(f"⚠ 自訓練模型流程失敗: {e}")

    strategies = build_strategies(expected_length)
    print(f"\n{'='*60}")
    print(f"🚀 Captcha Sniper V{APP_VERSION} | 預期長度：{expected_length} | 策略數：{len(strategies)}")
    print(f"{'='*60}")

    results = []
    ocr_cache = {}       # 處理後圖片 hash → (text, conf)，相同圖片不重複 OCR
    extract_cache = {}   # 提取結果共用（同門檻的 BLUE/HUE/NONBLUE 只算一次）

    for strategy_name, base_weight, use_rgb, strategy_func in strategies:
        try:
            src = original_rgb if use_rgb else base_img
            processed = strategy_func(src, extract_cache)
            processed_rgb = processed.convert('RGB')
            with BytesIO() as buf:
                processed_rgb.save(buf, format="PNG")
                png_bytes = buf.getvalue()

            img_hash = hashlib.sha1(png_bytes).hexdigest()
            if img_hash in ocr_cache:
                text, ocr_conf = ocr_cache[img_hash]
            else:
                text, ocr_conf = ocr_classify(png_bytes)
                ocr_cache[img_hash] = (text, ocr_conf)

            print(f"   [{strategy_name:<15}] → '{text}' (len={len(text)}, conf={ocr_conf:.2f})")
            results.append((strategy_name, text, processed_rgb, base_weight, ocr_conf))
        except Exception as e:
            print(f"   [{strategy_name:<15}] ⚠ 錯誤: {e}")
            results.append((strategy_name, "", None, 0, 0.0))

        if EARLY_EXIT_ENABLED and reached_consensus(results, expected_length):
            print(f"   ⚡ 已達強共識，提早結束（只跑 {len(results)}/{len(strategies)} 個策略）")
            break

    # 主要決策：逐字元投票（固定字數時最準）
    pos_text, _cols = position_vote(results, expected_length)

    # 備援／顯示：全字串加權投票
    best_text, _best_image, vote_map = weighted_vote(results, expected_length)
    if not best_text:
        best_text, _best_image, vote_map = weighted_vote(results, None)

    final_text = pos_text or best_text
    if not final_text:
        return None

    vote_info = sorted(vote_map.items(), key=lambda x: x[1], reverse=True)
    top3 = vote_info[:3]
    method = 'position' if pos_text else 'string'
    print(f"\n🏆 最終結果：'{final_text}' ({method})  (第 {current_round}/{recognize_times_total} 次)")
    print(f"📊 字串投票分數：{vote_info[:5]}")

    return {
        'success': True,
        'text': final_text,
        'method': method,
        'votes': {k: round(v, 2) for k, v in vote_map.items()},
        'top3': [[k, round(v, 2)] for k, v in top3],
        'strategies': '; '.join(f"{n}={t}" for n, t, _im, _bw, _c in results),
        'total_strategies': len(results),
        'winner_votes': round(vote_map.get(final_text, 0), 2),
        'version': APP_VERSION
    }


# ==========================================
# 🌐 路由 - V45.0 精選策略版
# ==========================================
@app.route('/recognize', methods=['POST'])
def recognize_captcha():
    try:
        data = request.get_json(silent=True) or {}
        image_data = data.get('image')
        expected_length = data.get('length') or 4
        recognize_times_total = data.get('recognizeTimes', 1)
        current_round = data.get('currentRound', 1)
        model_key = str(data.get('model') or '').strip().lower()
        try:
            yii_hash = int(data.get('yiiHash') or 0)
        except (TypeError, ValueError):
            yii_hash = 0
        try:
            retry_count = int(data.get('retryCount') or 0)
        except (TypeError, ValueError):
            retry_count = 0
        if not image_data:
            return jsonify({'success': False, 'error': '未收到圖片'}), 400
        if isinstance(image_data, str) and image_data.startswith('data:image'):
            image_data = image_data.split(',', 1)[1]

        # 快取：同一張圖 + 相同長度 + 相同 hash，直接回傳上次結果
        cache_key = hashlib.sha256(
            f"{expected_length}|{model_key}|{yii_hash}|".encode('utf-8') + image_data.encode('utf-8', 'ignore')
        ).hexdigest()
        cached = cache_get(cache_key)
        if cached is not None:
            print(f"⚡ 快取命中，直接回傳：'{cached.get('text')}'")
            log_payload(cache_key, expected_length, yii_hash, cached, True, retry_count)
            return jsonify(cached)

        try:
            image_bytes = base64.b64decode(image_data)
        except Exception:
            return jsonify({'success': False, 'error': '圖片 base64 解碼失敗'}), 400
        if len(image_bytes) > MAX_IMAGE_BYTES:
            return jsonify({'success': False, 'error': '圖片過大'}), 400

        try:
            original_image = Image.open(BytesIO(image_bytes))
            original_image.load()
        except Exception:
            return jsonify({'success': False, 'error': '無法解析圖片格式'}), 400

        if original_image.mode == 'RGBA':
            bg = Image.new("RGB", original_image.size, (255,255,255))
            bg.paste(original_image, mask=original_image.split()[3])
            original_rgb = bg
        else:
            original_rgb = original_image.convert('RGB')
        base_img = standardize_captcha_image(original_rgb)

        # 依平台挑選自訓練模型（無對應或檔案缺失則 None → 策略投票）
        custom_ocr = get_custom_ocr(model_key)
        custom_model_name = MODEL_NAME_MAP.get(model_key)

        # 單飛鎖：同圖併發時只計算一次，其餘請求等待後取快取
        lock = get_key_lock(cache_key)
        with lock:
            payload = cache_get(cache_key)
            if payload is None:
                payload = recognize_core(
                    original_rgb, base_img, expected_length,
                    current_round, recognize_times_total,
                    custom_ocr=custom_ocr,
                    raw_bytes=image_bytes,
                    custom_model_name=custom_model_name
                )
                if payload is None:
                    return jsonify({'success': False, 'error': '所有策略均失敗'}), 500

                # Yii2 hash 校正：只修「單一字元」的 OCR 錯誤
                if yii_hash:
                    original_text = payload.get('text', '')
                    corrected, matched, _cands = yii_captcha_correct(original_text, yii_hash)
                    payload['hash_verified'] = matched
                    payload['hash_used'] = True
                    if corrected != original_text:
                        print(f"🔐 Yii2 hash 校正：'{original_text}' → '{corrected}'")
                        payload['corrected_from'] = original_text
                        payload['text'] = corrected

                cache_put(cache_key, payload)
                log_payload(cache_key, expected_length, yii_hash, payload, False, retry_count)

        final_text = payload.get('text', '')
        # 正確性檢查（如果有傳 correct 欄位，僅用於記錄）
        correct = data.get('correct')
        if correct and correct.lower() == final_text.lower():
            print(f"✅✅✅ 答對！正確答案：'{correct}'")
        elif correct:
            print(f"❌❌❌ 答錯！正確：'{correct}'，我答：'{final_text}'")
        return jsonify(payload)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
# ==========================================
# 🚀 啟動
# ==========================================
if __name__ == '__main__':
    print("="*60)
    print("🚀 Captcha Sniper V5.0 - 強化版")
    print("  AAAAAAAAAAAAAAAAAAAAAAA  ")
    print("="*60)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
