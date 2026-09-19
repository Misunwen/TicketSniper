@echo off
chcp 65001 >nul
title TicketSniper - 登入 GitHub
color 0B
set "GH=gh"
where gh >nul 2>&1 || set "GH=C:\Program Files\GitHub CLI\gh.exe"
echo ===================================================
echo    TicketSniper - 登入 GitHub（只需一次）
echo ===================================================
echo.
echo 請依序選擇：
echo   1) GitHub.com
echo   2) HTTPS
echo   3) Yes（用 GitHub 認證 Git）
echo   4) Login with a web browser
echo   5) 複製畫面上的 one-time code，按 Enter 開瀏覽器，貼上並授權
echo.
"%GH%" auth login
echo.
echo ---- 登入狀態 ----
"%GH%" auth status
echo.
pause
