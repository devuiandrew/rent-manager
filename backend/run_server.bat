@echo off
REM Запуск Waitress-сервера: ярлык в shell:startup (автозапуск при входе) или двойной клик.
REM Без PowerShell: запуск .ps1 с -ExecutionPolicy Bypass антивирус/SOC считает подозрительным.
REM Окно остаётся открытым всегда — видно, что сервер работает, и видна ошибка, если он упал.
chcp 65001 >nul
title Rent Manager - server
cd /d "%~dp0"

python serve.py

echo.
echo Сервер зупинено (код виходу: %ERRORLEVEL%).
pause
