@echo off
chcp 65001 >nul
title TicketSniper - 安裝 Python 套件
color 0E
cd /d "%~dp0server"

echo ===================================================
echo    TicketSniper - 安裝 Python 套件
echo ===================================================
echo.

python --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [錯誤] 找不到 Python。請先安裝並勾選 "Add Python to PATH"。
    pause
    exit /b
)

pip install -r requirements.txt
echo.
echo 安裝完成。
pause
