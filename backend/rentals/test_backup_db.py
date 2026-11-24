import tempfile
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase


class BackupDbLogTests(SimpleTestCase):
    """Повторы и запись в лог (тесты на SQLite — команда падает сразу на проверке ENGINE)."""

    def test_fail_written_to_log_after_all_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "logs" / "backup.log"
            with self.assertRaises(CommandError):
                call_command("backup_db", retries=2, retry_delay=0, log=str(log))
            text = log.read_text(encoding="utf-8")
            self.assertIn("FAIL | спроба 2/2", text)
            self.assertIn("тільки PostgreSQL", text)

    def test_log_rotated_when_over_1mb(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "backup.log"
            log.write_text("x" * (1024 * 1024 + 1), encoding="utf-8")
            with self.assertRaises(CommandError):
                call_command("backup_db", log=str(log))
            self.assertTrue((Path(tmp) / "backup.log.old").exists())
            self.assertTrue(log.read_text(encoding="utf-8").startswith("["))
