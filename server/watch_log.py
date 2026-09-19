#encoding=utf-8
"""即時觀看 recognition_log.dat（辨識紀錄）。Ctrl+C 結束。"""
import os
import sys
import time

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'recognition_log.dat')


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    print("=" * 90)
    print(" 驗證碼辨識 - 即時紀錄  (Ctrl+C 可結束)")
    print(" 檔案：" + LOG)
    print("=" * 90)

    pos = 0
    if os.path.exists(LOG):
        with open(LOG, 'rb') as f:
            data = f.read()
        pos = len(data)
        text = data.decode('utf-8', 'ignore').lstrip('\ufeff')
        if text.strip():
            print(text.replace('\t', ' | ').rstrip())
        else:
            print("(尚無紀錄)")
    sys.stdout.flush()

    while True:
        time.sleep(0.5)
        if not os.path.exists(LOG):
            continue
        try:
            size = os.path.getsize(LOG)
        except OSError:
            continue
        if size < pos:
            pos = 0  # 檔案被清空/重建
        if size > pos:
            try:
                with open(LOG, 'rb') as f:
                    f.seek(pos)
                    data = f.read()
                    pos = f.tell()
            except OSError:
                continue
            text = data.decode('utf-8', 'ignore')
            if text:
                sys.stdout.write(text.replace('\t', ' | '))
                sys.stdout.flush()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n已結束。")
