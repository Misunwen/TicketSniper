@echo off
chcp 65001 >nul
title TicketSniper - 安裝/檢測套件
color 0E
cd /d "%~dp0"
echo ===================================================
echo    TicketSniper - 套件檢測與安裝
echo ===================================================
echo.
python --version >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [錯誤] 找不到 Python。請先安裝 Python 3.10～3.12 並勾選 "Add Python to PATH"。
    echo.
    pause
    exit /b
)
python "%~dp0tools\setup_deps.py"
echo.
pause
