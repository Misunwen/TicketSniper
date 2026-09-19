@echo off
chcp 65001 >nul
title TicketSniper - 啟動瀏覽器 (zendriver)
color 0B
cd /d "%~dp0launcher"
echo ===================================================
echo    TicketSniper - 瀏覽器啟動器
echo ===================================================
echo.
python --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [錯誤] 找不到 Python。請先安裝並勾選 "Add Python to PATH"。
    pause
    exit /b
)
echo [1/2] 檢查並安裝瀏覽器驅動（zendriver／nodriver）...
pip install -r requirements.txt -q
echo       完成。
echo.
echo [2/2] 啟動瀏覽器（請保持此視窗開啟，Ctrl+C 結束）...
echo ===================================================
python launcher.py
echo.
pause
