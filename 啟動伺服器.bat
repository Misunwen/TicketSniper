@echo off
title TicketSniper - 驗證碼辨識伺服器
color 0A
cd /d "%~dp0server"
echo ===================================================
echo    TicketSniper 驗證碼辨識伺服器
echo ===================================================
echo.
python --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [錯誤] 找不到 Python。
    echo 請先安裝 Python 並勾選 "Add Python to PATH"。
    echo.
    pause
    exit /b
)
echo [1/2] 檢查並安裝所需套件（第一次會比較久）...
pip install -r requirements.txt -q
echo       完成。
echo.
echo [2/2] 啟動伺服器，請保持此視窗開啟（縮小即可，勿關閉）...
echo ===================================================
python app_en_tixcraft_V3.py
echo.
echo 伺服器已結束。
pause
