"""
Команда: python manage.py backup_db

Робить pg_dump поточної БД і зберігає в backups/backup_YYYY-MM-DD_HH-MM.sql.gz
Автоматично видаляє старі бекапи якщо їх більше ніж --keep (default 30).

Запуск вручну:
  python manage.py backup_db
  python manage.py backup_db --keep 60

Через Task Scheduler / автозагрузку — обгортка backup_db.bat (без PowerShell):
  python manage.py backup_db --keep 30 --log logs/backup.log
  python manage.py backup_db --keep 30 --log logs/backup.log --retries 10
"""

import gzip
import logging
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger('api')


class Command(BaseCommand):
    help = 'Резервна копія PostgreSQL бази даних'

    def add_arguments(self, parser):
        parser.add_argument(
            '--keep',
            type=int,
            default=30,
            help='Кількість бекапів що зберігаються (старіші видаляються). Default: 30',
        )
        parser.add_argument(
            '--output-dir',
            type=str,
            default=None,
            help='Папка для бекапів (default: backups/ поруч з manage.py)',
        )
        parser.add_argument(
            '--retries',
            type=int,
            default=1,
            help='Кількість спроб (при старті ПК PostgreSQL піднімається не одразу). Default: 1',
        )
        parser.add_argument(
            '--retry-delay',
            type=int,
            default=30,
            help='Пауза між спробами, сек. Default: 30',
        )
        parser.add_argument(
            '--log',
            type=str,
            default=None,
            help='Дописати результат у файл (запуск без консолі — інакше помилку ніде не видно)',
        )

    def handle(self, *args, **options):
        retries = max(1, options['retries'])
        stamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        error = None

        for attempt in range(1, retries + 1):
            lines = []
            try:
                self._backup_once(options, lines)
                error = None
                break
            except CommandError as exc:
                error = exc
                if attempt < retries:
                    # Ждём, пока поднимется служба PostgreSQL
                    time.sleep(options['retry_delay'])

        if options['log']:
            status = 'OK' if error is None else 'FAIL'
            if retries > 1:
                status += f' | спроба {attempt}/{retries}'
            if error is not None:
                lines.append(str(error))
            self._write_log(Path(options['log']), stamp, status, lines)

        # CommandError → код виходу 1 (видно в планувальнику)
        if error is not None:
            raise error

    def _write_log(self, log_file, stamp, status, lines):
        log_file.parent.mkdir(parents=True, exist_ok=True)
        # Обрезаем лог, если разросся больше 1 МБ (задача ежедневная, лог вечный)
        if log_file.exists() and log_file.stat().st_size > 1024 * 1024:
            log_file.replace(log_file.with_name(log_file.name + '.old'))
        with log_file.open('a', encoding='utf-8') as f:
            f.write(f'[{stamp}] {status}\n')
            for line in lines:
                f.write(line.rstrip() + '\n')
            f.write('\n')

    def _say(self, lines, msg, style=None):
        # Пишем и в консоль, и в буфер для лога
        self.stdout.write(style(msg) if style else msg)
        lines.append(msg)

    def _backup_once(self, options, lines):
        db = settings.DATABASES['default']

        if 'postgresql' not in db.get('ENGINE', ''):
            raise CommandError(
                'backup_db підтримує тільки PostgreSQL. '
                f'Поточний ENGINE: {db.get("ENGINE")}'
            )

        # ── Папка для бекапів ──────────────────────────────────────────
        backup_dir = Path(options['output_dir']) if options['output_dir'] else (
            Path(settings.BASE_DIR) / 'backups'
        )
        backup_dir.mkdir(exist_ok=True)

        # ── Ім'я файлу з часовою міткою ───────────────────────────────
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M')
        filename = backup_dir / f'backup_{timestamp}.sql.gz'

        # ── Перевірка pg_dump ──────────────────────────────────────────
        pg_dump = shutil.which('pg_dump')
        if not pg_dump:
            # Немає в PATH (типова ситуація під Task Scheduler) — шукаємо серед
            # встановлених версій Postgres і беремо найновішу (18 > 17 > ...)
            candidates = sorted(
                Path(r'C:\Program Files\PostgreSQL').glob('*/bin/pg_dump.exe'),
                key=lambda p: int(p.parts[-3]) if p.parts[-3].isdigit() else 0,
                reverse=True,
            )
            if not candidates:
                raise CommandError(
                    'pg_dump не знайдено. '
                    'Переконайся що PostgreSQL встановлений і pg_dump є в PATH.'
                )
            pg_dump = str(candidates[0])

        # ── Запуск pg_dump і стиснення результату ─────────────────────
        cmd = [
            pg_dump,
            '--no-password',
            '--format=plain',
            '--encoding=UTF8',
            f'--dbname={db["NAME"]}',
            f'--host={db.get("HOST", "localhost")}',
            f'--port={db.get("PORT", "5432")}',
            f'--username={db.get("USER", "postgres")}',
        ]

        # LC_MESSAGES=C — ошибки pg_dump на английском: локализованные идут в cp1251 и бьются при decode utf-8
        env = {'PGPASSWORD': db.get('PASSWORD', ''), 'LC_MESSAGES': 'C'}

        self._say(lines, f'Бекап → {filename}')

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                env={**__import__('os').environ, **env},
            )

            if result.returncode != 0:
                err = result.stderr.decode('utf-8', errors='replace')
                raise CommandError(f'pg_dump завершився з помилкою:\n{err}')

            # Стискаємо gzip прямо в Python — не потрібен окремий gzip.exe
            with gzip.open(filename, 'wb') as gz:
                gz.write(result.stdout)

        except FileNotFoundError:
            raise CommandError(f'Не вдалося запустити pg_dump: {pg_dump}')

        size_kb = filename.stat().st_size // 1024
        self._say(lines, f'✓ Бекап збережено: {filename.name} ({size_kb} KB)', self.style.SUCCESS)
        logger.info(f'BACKUP | {filename.name} | {size_kb} KB')

        # ── Видаляємо старі бекапи ─────────────────────────────────────
        keep = options['keep']
        all_backups = sorted(backup_dir.glob('backup_*.sql.gz'))
        to_delete = all_backups[:-keep] if len(all_backups) > keep else []

        for old in to_delete:
            old.unlink()
            self._say(lines, f'  видалено старий бекап: {old.name}')

        if to_delete:
            self._say(lines, f'Видалено {len(to_delete)} старих бекапів.')
