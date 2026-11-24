# Развёртывание Rent Manager на выделенном ПК-сервере

Документ для установки production-окружения на **отдельном Windows-ПК**, который
играет роль сервера в локальной сети.

## Архитектура

```
┌─────────────────────────────┐         ┌──────────────┐
│  ПК-СЕРВЕР (Windows, 24/7)   │◀── HTTP ─│  Клиент №1   │  .exe
│                             │  :8000  └──────────────┘
│  PostgreSQL  ← база тут      │         ┌──────────────┐
│      ▲ localhost:5432        │◀── HTTP ─│  Клиент №2   │  .exe
│      │ (только Django!)      │  :8000  └──────────────┘
│  Django + Waitress :8000     │
└─────────────────────────────┘
```

- **Клиенты не подключаются к БД напрямую** — только по HTTP к Django. Django ходит
  в PostgreSQL на `localhost`.
- База и код лежат на **локальном диске** сервера, не на сетевой шаре
  (SQLite/Postgres на SMB-шаре = риск повреждения данных).
- Клиенты адресуют сервер **по имени машины**, не по «голому» IP — имя стабильно
  при смене DHCP.

---

## Фаза 1. Подготовить машину

- Windows 10/11, ПК включён **24/7**.
- Задать **стабильное имя ПК** (Свойства системы → Переименовать, напр. `rent-server`).
- Задать **статический IP** или резервацию на роутере.

## Фаза 2. Поставить софт

- **Python** — та же версия, что на текущем проде.
- **PostgreSQL для Windows** (инсталлятор EDB). Запомнить пароль суперюзера `postgres`.

## Фаза 3. База данных

Создать роль и пустую БД (в `psql` под `postgres`):

```sql
CREATE USER rent_user WITH PASSWORD 'пароль-из-backend/.env';
CREATE DATABASE rent_manager OWNER rent_user;
```

**Перенос данных** (если на текущем проде есть рабочие данные):

```powershell
# на СТАРОМ проде — снять дамп (-F c = сжатый бинарный формат)
pg_dump -U rent_user -h localhost -F c -f rent_manager.dump rent_manager

# перенести rent_manager.dump на новый ПК, затем восстановить в пустую БД
pg_restore -U rent_user -h localhost -d rent_manager rent_manager.dump
```

> Есть готовая команда `python manage.py backup_db` (pg_dump + gzip в `backups/`) —
> её же можно использовать как источник дампа.

Если стартуешь **с нуля** — restore пропустить, схему нальёт `migrate` ниже.

## Фаза 4. Приложение

```powershell
# скопировать папку проекта на локальный диск, перенести backend/.env
cd backend
pip install -r requirements.txt
pip install waitress
python manage.py migrate          # на случай, если код новее дампа / старт с нуля
python manage.py setup_groups     # группы Бухгалтер/Менеджер — без них роли в JWT не работают
# только если БД пустая (старт с нуля):
python manage.py createsuperuser
```

## Фаза 5. Сеть и проверка

```powershell
# от имени администратора: открыть входящий порт 8000
New-NetFirewallRule -DisplayName "Rent Manager API" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow

# запустить сервер (слушает 0.0.0.0:8000)
cd backend
python serve.py
```

Проверка с клиента — **TCP-портом, НЕ ping** (ICMP по умолчанию закрыт,
`PingSucceeded: False` — это норма):

```powershell
Test-NetConnection rent-server -Port 8000   # ждём TcpTestSucceeded: True
```

Если `False` — по порядку проверить:
1. Запущен ли `serve.py` (некому слушать порт).
2. На сервере: `Get-NetTCPConnection -LocalPort 8000 -State Listen` — должен быть
   `0.0.0.0:8000` (а не `127.0.0.1:8000`).
3. Правило фаервола активно и на нужном профиле:
   `Get-NetFirewallRule -DisplayName "Rent Manager API" | fl Enabled,Action,Profile`
   + `Get-NetConnectionProfile` (профиль правила должен совпадать с активным).

## Фаза 6. Автозапуск (обязательно)

Обернуть `serve.py` в службу Windows через **NSSM** — чтобы сервер:
- стартовал сам при загрузке ПК;
- работал без залогиненной сессии (иначе процесс умрёт при выходе пользователя);
- перезапускался при падении.

Ориентир: `nssm install RentManager "python" "serve.py"`, рабочая папка — `backend/`.

## Фаза 7. Клиентские `.exe`

Адрес API вшивается в сборку. Собирать с **именем сервера** (не IP):

```powershell
# frontend/.env.network:
#   VITE_API_URL=http://rent-server:8000/api      ← имя + суффикс /api
npm run electron:build:network:installer
```

Раздать установщик клиентам (удобно — через сетевую папку).

## Фаза 8. Безопасность `.env`

> ⚠️ При `DEBUG=False` **обязательно** правильно задать `ALLOWED_HOSTS`, иначе Django
> вернёт `400 Bad Request` на все запросы.

Что поправить в `backend/.env`:

| Параметр | Сейчас (небезопасно) | Задать |
|----------|----------------------|--------|
| `DEBUG` | — | `False` |
| `SECRET_KEY` | — | уникальный, НЕ коммитить в git |
| `ALLOWED_HOSTS` | `*` | `rent-server,IP-сервера,localhost` |

```dotenv
DEBUG=False
ALLOWED_HOSTS=rent-server,192.168.1.50,localhost
```

**Важно про формат `ALLOWED_HOSTS`:** значение режется по запятой **без обрезки
пробелов** (`settings.py`) — писать без пробелов после запятых.

### CORS — здесь осторожно (не ломать клиента!)

Логичный шаг «`CORS_ALLOW_ALL_ORIGINS=False` + whitelist» для этого приложения
**рискован**. Причина: prod-Electron грузит фронт через `file://`, поэтому его
запросы приходят с `Origin: null` (или без Origin). Если залочить CORS на
`http://`-origins — клиентский `.exe` под них **не подпадёт**, и приложение
перестанет получать ответы.

Что делать:

1. **Приоритет — `ALLOWED_HOSTS` + `DEBUG=False` + свой `SECRET_KEY`.** Это реальные
   средства защиты в проде. CORS в изолированной локальной сети с десктоп-клиентом
   даёт мало пользы (CORS защищает браузерных пользователей от чужих сайтов, а у нас
   не браузер и нет интернета).
2. Прежде чем что-то менять в CORS — **посмотреть, какой `Origin` реально шлёт
   собранный `.exe`**: в `logs/api.log` (пишет `RequestLoggingMiddleware`) или через
   DevTools → Network. Если там `null`/пусто (ожидаемо для `file://`), то whitelist
   из `http://`-origins клиента сломает.
3. Практический вывод: на изолированной LAN допустимо оставить `CORS_ALLOW_ALL_ORIGINS`
   как есть — риск ниже, чем поломка клиента. Лочить CORS есть смысл только если
   заранее проверен и учтён реальный Origin клиента.

---

## Проверка после запуска (чек-лист)

- [ ] `Test-NetConnection rent-server -Port 8000` → `TcpTestSucceeded: True`
- [ ] Клиентский `.exe` логинится (admin/accountant/manager видят свои права)
- [ ] Данные на месте (если был перенос)
- [ ] Служба NSSM переживает перезагрузку ПК
- [ ] Порт 5432 (PostgreSQL) наружу **не** открыт
