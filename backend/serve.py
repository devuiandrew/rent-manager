"""
Production-запуск Django через Waitress (WSGI-сервер для Windows).

Замена dev-команде `python manage.py runserver` — runserver не предназначен
для продакшена (однопоточный, без авто-перезапуска, watcher файлов).

Запуск из папки backend/:
    python serve.py

Хост/порт можно переопределить через переменные окружения:
    WAITRESS_HOST (по умолчанию 0.0.0.0 — слушать всю локальную сеть)
    WAITRESS_PORT (по умолчанию 8000 — prod-порт; dev работает на 8001)
"""

import os
import sys

# Принудительный UTF-8 в консоли Windows — иначе кириллица в логах ломается.
# getattr-защита: под Task Scheduler без консоли stdout может не иметь reconfigure
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        _reconfigure = getattr(_stream, "reconfigure", None)
        if _reconfigure:
            _reconfigure(encoding="utf-8", errors="replace")

from waitress import serve

# config.wsgi выставляет DJANGO_SETTINGS_MODULE и собирает WSGI-приложение
from config.wsgi import application

HOST = os.environ.get("WAITRESS_HOST", "0.0.0.0")
PORT = int(os.environ.get("WAITRESS_PORT", "8000"))
# Кол-во потоков = столько запросов обслуживается одновременно
THREADS = int(os.environ.get("WAITRESS_THREADS", "8"))

if __name__ == "__main__":
    print(f"Waitress: http://{HOST}:{PORT} (threads={THREADS}). Ctrl+C для остановки.")
    serve(application, host=HOST, port=PORT, threads=THREADS)
