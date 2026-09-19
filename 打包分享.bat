@echo off
chcp 65001 >nul
title TicketSniper - 打包分享
color 0D
cd /d "%~dp0"
echo ===================================================
echo    TicketSniper - 打包成 TicketSniper.zip
echo ===================================================
echo.
set "SRC=%~dp0"
set "STAGE=%TEMP%\TicketSniper_pack"
set /p INC_CFT=要一起打包 Chrome for Testing 嗎? (Y/N，預設 N，需要可離線執行但檔案很大): 
if /i "%INC_CFT%"=="Y" (set "EXCFT=") else (set "EXCFT=chrome-for-testing")
echo.
echo 複製檔案到暫存 (%STAGE%) ...
rmdir /s /q "%STAGE%" 2>nul
robocopy "%SRC%." "%STAGE%" /E /XD ".git" "chrome_profile" "__pycache__" "tickets_hunter-main" %EXCFT% /XF "recognition_log.dat" "recognition_log_*.dat" "*.zip" >nul
if %errorlevel% GEQ 8 (
    color 0C
    echo [錯誤] 複製檔案失敗。
    pause
    exit /b
)
echo 壓縮中...
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%SRC%TicketSniper.zip' -Force"
if %errorlevel% neq 0 (
    color 0C
    echo [錯誤] 壓縮失敗。
    rmdir /s /q "%STAGE%" 2>nul
    pause
    exit /b
)
rmdir /s /q "%STAGE%" 2>nul
echo.
echo 完成！已產生：%SRC%TicketSniper.zip
echo 對方解壓後：先跑「安裝套件.bat」，再跑「啟動瀏覽器.bat」。
pause
