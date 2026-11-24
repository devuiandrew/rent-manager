@echo off
REM Бэкап БД при входе в Windows — ярлык на этот файл кладётся в shell:startup (см. AUTOSTART.md).
REM Ярлык запускается свёрнутым; результат — в logs\backup.log.
REM До 10 попыток раз в 30 с — ждём, пока поднимется PostgreSQL.
title Rent Manager - backup
call "%~dp0backup_db.bat" --retries 10
