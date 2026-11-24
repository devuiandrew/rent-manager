"""
Створює стандартні групи користувачів: Менеджер і Бухгалтер.
(Адміністратор — це is_staff, окрема група не потрібна.)

Запуск: python manage.py setup_groups
"""
import sys
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Створює групи Менеджер та Бухгалтер'

    def handle(self, *args, **options):
        sys.stdout.reconfigure(encoding='utf-8')
        for name in ['Менеджер', 'Бухгалтер']:
            group, created = Group.objects.get_or_create(name=name)
            status = 'створено' if created else 'вже існує'
            self.stdout.write(f'Група "{name}" — {status}')
        self.stdout.write(self.style.SUCCESS('Готово.'))
