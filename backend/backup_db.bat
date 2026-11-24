@echo off
REM Бэкап БД без PowerShell: ежедневная задача Task Scheduler, автозагрузка, ручной запуск.
REM Результат (и ошибка) дописывается в logs\backup.log — под планировщиком консоли не видно.
REM Доп. аргументы пробрасываются в manage.py backup_db, например: backup_db.bat --retries 10
chcp 65001 >nul
REM Рабочая папка планировщика — C:\Windows\System32, переходим в backend\ явно
cd /d "%~dp0"

REM У планировщика PATH может отличаться от PATH пользователя — fallback на типовой путь
set "PY=python"
where python >nul 2>&1 || set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not "%PY%"=="python" if not exist "%PY%" (
    if not exist logs mkdir logs
    >>logs\backup.log echo [%date% %time:~0,8%] FAIL ^| python не знайдено: %PY%
    exit /b 1
)

"%PY%" manage.py backup_db --keep 30 --log logs\backup.log %*
REM Код выхода видно в планировщике в колонке "Результат последнего запуска"
exit /b %ERRORLEVEL%
