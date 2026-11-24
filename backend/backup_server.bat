@echo off
REM Ручной бэкап БД (двойной клик): окно остаётся открытым, чтобы увидеть результат.
title Rent Manager - backup
call "%~dp0backup_db.bat"
pause
