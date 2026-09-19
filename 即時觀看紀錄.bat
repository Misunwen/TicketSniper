@echo off
chcp 65001 >nul
title TicketSniper - 即時辨識紀錄
cd /d "%~dp0server"
python -u watch_log.py
pause
