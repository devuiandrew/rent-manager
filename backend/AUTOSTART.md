# Автозапуск backend-сервера (Waitress) при старте Windows

> **Все команды из этого файла выполняются на СЕРВЕРНОМ ПК** (не на рабочем).
> Прод развёрнут на отдельной машине; путь `C:\rent_manager\backend` в примерах — заглушка,
> подставь фактическую папку проекта на сервере.

Два способа. Уже настроен **вариант 1** (папка «Автозагрузка») — сервер стартует
при входе в Windows. Вариант 2 (Task Scheduler) требует прав администратора,
здесь описан на случай, если права появятся позже.

Оба варианта запускают `run_server.bat` — он переходит в `backend/` и запускает
`python serve.py` (Waitress на порту 8000) в видимом окне, которое не закрывается
само, если сервер упадёт с ошибкой.

> **Без PowerShell — намеренно.** Раньше запуск шёл через
> `powershell -ExecutionPolicy Bypass [-WindowStyle Hidden] -File *.ps1`, и SOC/EDR
> поднимал инцидент T1059.001 (скрытый запуск PowerShell с обходом политики — типичный
> приём вредоносов). Теперь вся логика — в `.bat` (cmd) и в Python, `.ps1` удалены.
> Не возвращать запуск через `powershell -ExecutionPolicy Bypass`.

## Переход со старых `.ps1` (один раз на сервере, после обновления кода)

1. Ярлыки в `shell:startup` (`RentManager Backend.lnk`, `RentManager Backup.lnk`) указывают
   на `.bat` — их **не трогать**, они сразу начнут работать без PowerShell.
2. Найти задачи планировщика, которые всё ещё вызывают PowerShell:

   ```powershell
   Get-ScheduledTask | Where-Object { $_.Actions.Execute -match "powershell" } |
       Select-Object TaskName, @{n="Args";e={$_.Actions.Arguments}}
   ```

   Задачи RentManager из списка удалить (`Unregister-ScheduledTask -TaskName "<имя>" -Confirm:$false`)
   и создать заново по инструкциям ниже — уже на `.bat`. Удалённые `.ps1` больше не существуют,
   так что старые задачи будут ещё и падать.

---

## Вариант 1 — ярлык в папке «Автозагрузка» (не требует прав администратора)

Уже сделано на этой машине. Чтобы повторить на другой:

1. `Win+R` → ввести `shell:startup` → Enter. Откроется папка автозагрузки текущего пользователя.
2. Открыть PowerShell и выполнить (путь поменять на актуальный, если проект лежит в другом месте):

   ```powershell
   $startupFolder = [Environment]::GetFolderPath('Startup')
   $targetBat = "C:\rent_manager\backend\run_server.bat"
   $workDir = "C:\rent_manager\backend"
   $lnkPath = Join-Path $startupFolder "RentManager Backend.lnk"

   $WshShell = New-Object -ComObject WScript.Shell
   $Shortcut = $WshShell.CreateShortcut($lnkPath)
   $Shortcut.TargetPath = $targetBat
   $Shortcut.WorkingDirectory = $workDir
   $Shortcut.Description = "Rent Manager backend (Waitress) - автозапуск при вході"
   $Shortcut.Save()
   ```

3. Проверить не перезагружаясь: открыть папку `shell:startup` и дважды кликнуть по
   созданному ярлыку `RentManager Backend.lnk` — должно открыться окно PowerShell
   с сервером.

**Убрать автозапуск:** удалить `.lnk`-файл из папки `shell:startup`. Файлы проекта
(`run_server.bat`) при этом не трогаются.

**Особенности:**
- Стартует только при входе именно этого пользователя в систему (не при простом
  включении ПК до логина).
- Если сервер упадёт — окна авто-перезапуска нет, но окно останется открытым с
  текстом ошибки (не исчезнет мгновенно).

---

## Вариант 2 — задача в Task Scheduler (нужны права администратора)

1. Открыть PowerShell **от имени администратора**
   (правой кнопкой на значке PowerShell → «Запуск от имени администратора»).
2. Выполнить (путь поменять на актуальный, если проект лежит в другом месте):

   ```powershell
   schtasks /Create /TN "RentManager Backend" /TR '"C:\rent_manager\backend\run_server.bat"' /SC ONLOGON /RL LIMITED /F
   ```

   Разбор флагов:
   - `/TN "RentManager Backend"` — имя задачи в планировщике.
   - `/TR '...'` — команда, которая выполняется (тот же `run_server.bat`, что и в варианте 1).
   - `/SC ONLOGON` — триггер «при входе в систему» (для любого пользователя,
     если не указан конкретный через `/RU`).
   - `/RL LIMITED` — запуск с обычными правами пользователя, а не «наивысшими».
     Это важно: именно `LIMITED` даёт видимое окно на рабочем столе. Настройка
     «Run whether user is logged on or not» в Task Scheduler запускает задачу в
     скрытой сессии без окна — сюда не подходит.
   - `/F` — перезаписать задачу, если уже существует с таким же именем.

3. Проверить: открыть «Планировщик заданий» (Task Scheduler) → «Библиотека
   планировщика заданий» → найти «RentManager Backend» → правой кнопкой →
   «Выполнить» — должно открыться окно с сервером.

**Убрать автозапуск:**
```powershell
schtasks /Delete /TN "RentManager Backend" /F
```

**Плюс перед вариантом 1:** во вкладке «Параметры» задачи в Task Scheduler можно
включить «Перезапустить задачу через ... минут, если сбой» — авто-восстановление
после падения сервера. У ярлыка в «Автозагрузке» такой опции нет.

---

## Если нужно поменять хост/порт/число потоков

`serve.py` читает переменные окружения (по умолчанию порт 8000, хост 0.0.0.0,
8 потоков):

```bat
set WAITRESS_PORT=8080
python serve.py
```

Чтобы это подхватывалось и при автозапуске — прописать `set ...` строкой выше
внутри `run_server.bat` перед вызовом `python serve.py`.

---

# Авто-бэкап БД по расписанию (Task Scheduler)

Запускается `backend/backup_db.bat` — обёртка над `python manage.py backup_db`.
Он переходит в папку `backend/`, делает `pg_dump` + gzip в `backups/`, удаляет всё
старше последних 30 копий и пишет результат в `logs/backup.log` (это делает сама
команда, флаг `--log`). Под планировщиком на несколько секунд мелькнёт окно консоли —
это нормально (скрытый запуск через PowerShell ловил SOC, см. начало файла).

**Важно:** задачу надо создавать на **серверном ПК**, в папке прода —
БД берётся из `.env` рядом со скриптом.

## Шаг 0. Проверить, что уже есть на сервере

Если бэкапы «когда-то делались, а потом перестали» — скорее всего осталась задача,
которая ссылается на удалённый из репозитория `backup_scheduler.ps1` или `backup_db.ps1`:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -match "ackup|ent" } |
    Select-Object TaskName, State, @{n="Action";e={$_.Actions.Execute + " " + $_.Actions.Arguments}}

# дата последнего успешного бэкапа
Get-ChildItem "C:\rent_manager\backend\backups\backup_*.sql.gz" |
    Sort-Object LastWriteTime -Desc | Select-Object -First 3 Name, LastWriteTime
```

Найденную старую задачу удалить перед созданием новой:
`Unregister-ScheduledTask -TaskName "<имя>" -Confirm:$false`

## Шаг 1. Проверить скрипт вручную

Двойной клик по `backup_server.bat` (окно останется открытым с результатом), затем:

```powershell
Get-Content "C:\rent_manager\backend\logs\backup.log" -Tail 5 -Encoding UTF8
```

В логе должно быть `OK` и строка `✓ Бекап збережено: backup_....sql.gz`.
Если `FAIL` — там же будет текст ошибки (обычно: не найден `pg_dump` или неверный пароль в `.env`).

## Шаг 2. Создать задачу

Вариант А — одной командой (проще; задача выполнится только если ПК включён в 23:00):

```powershell
schtasks /Create /TN "RentManager Backup" /TR '"C:\rent_manager\backend\backup_db.bat"' /SC DAILY /ST 23:00 /F
```

Вариант Б — рекомендуемый: то же самое, но с «догнать пропущенный запуск», если ПК
был выключен в 23:00 (`schtasks` такую опцию задать не умеет, поэтому через командлеты):

```powershell
$backend = "C:\rent_manager\backend"

$action = New-ScheduledTaskAction -Execute "$backend\backup_db.bat" -WorkingDirectory $backend

$trigger = New-ScheduledTaskTrigger -Daily -At 23:00

# StartWhenAvailable — запустить, как только ПК включат, если время пропущено
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName "RentManager Backup" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description "Щоденний бекап БД Rent Manager" -Force
```

## Шаг 3. Проверить задачу

```powershell
Start-ScheduledTask -TaskName "RentManager Backup"      # запустить прямо сейчас
Get-ScheduledTaskInfo -TaskName "RentManager Backup"    # LastTaskResult должен быть 0
```

`LastTaskResult = 0` — успех. Любое другое число — смотреть `logs/backup.log`.

## Управление задачей

```powershell
Disable-ScheduledTask -TaskName "RentManager Backup"    # временно выключить
Enable-ScheduledTask  -TaskName "RentManager Backup"
Unregister-ScheduledTask -TaskName "RentManager Backup" -Confirm:$false   # удалить
```

## Настройки, которые меняются в скрипте

- `--keep 30` в `backup_db.bat` — сколько копий хранить.
- Путь к Python: берётся из PATH; если под планировщиком не находится —
  поправить fallback-путь в переменной `PY` в `backup_db.bat` (сейчас указан `Python314`).
  Если python не найден совсем — в логе будет `FAIL | python не знайдено`.

---

# Авто-бэкап БД при включении ПК

Дополняет (или заменяет) ежедневную задачу в 23:00: если ПК выключают вечером
(`shutdown.bat`), бэкап в 23:00 не сработает. Бэкап при старте сохраняет то же
состояние, что было на момент выключения, и не зависит от того, как ПК выключили
(в т.ч. кнопкой или из-за пропажи света).

Запускается `backend/backup_on_startup.bat` → `backup_db.bat --retries 10`: окно
свёрнуто в панель задач (ярлык с `WindowStyle = 7`), результат в `logs/backup.log`. Сразу после входа в Windows служба PostgreSQL может
ещё не подняться, поэтому скрипт делает до 10 попыток с паузой 30 с (≈5 минут).
В логе видно, с какой попытки прошло: `OK | спроба 2/10`.

## Вариант 1 — ярлык в «Автозагрузке» (без прав администратора)

Так же, как автозапуск сервера. В PowerShell на серверном ПК (путь поменять на актуальный):

```powershell
$backend = "C:\rent_manager\backend"
$lnkPath = Join-Path ([Environment]::GetFolderPath('Startup')) "RentManager Backup.lnk"

$Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnkPath)
$Shortcut.TargetPath = "$backend\backup_on_startup.bat"
$Shortcut.WorkingDirectory = $backend
$Shortcut.WindowStyle = 7          # свёрнуто — без мелькания консоли
$Shortcut.Description = "Rent Manager - бекап БД при вході"
$Shortcut.Save()
```

Проверить: двойной клик по ярлыку в `shell:startup`, через ~15 с:

```powershell
Get-Content "C:\rent_manager\backend\logs\backup.log" -Tail 5
```

**Убрать:** удалить `RentManager Backup.lnk` из `shell:startup`.

## Вариант 2 — Task Scheduler, триггер «при входе» (нужны права администратора)

```powershell
$backend = "C:\rent_manager\backend"

$action = New-ScheduledTaskAction -Execute "$backend\backup_db.bat" `
    -Argument "--retries 10" -WorkingDirectory $backend

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT1M"            # старт через минуту после входа

$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName "RentManager Backup Startup" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description "Бекап БД Rent Manager при вході в Windows" -Force
```

Проверка и удаление — как у ежедневной задачи (`Start-ScheduledTask` /
`Get-ScheduledTaskInfo` / `Unregister-ScheduledTask` с именем `RentManager Backup Startup`).

## Учесть

- Бэкапы при старте и в 23:00 лежат в одной папке и делят лимит `--keep 30`.
  Если работают оба (2 бэкапа в день), история — ~15 дней. При необходимости поднять
  `--keep` в `backup_db.bat`.
- Если ПК перезагружают несколько раз за день, каждый вход = новый бэкап
  (имя с минутами, не перезаписываются) — тоже съедает лимит.

## Восстановление из бэкапа

```powershell
# распаковать
python -c "import gzip,shutil,io; shutil.copyfileobj(gzip.open(r'backups\backup_2026-09-08_23-00.sql.gz'), open(r'backups\restore.sql','wb'))"
# залить (БД должна существовать и быть пустой)
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U rent_user -d rent_manager -f backups\restore.sql
```
