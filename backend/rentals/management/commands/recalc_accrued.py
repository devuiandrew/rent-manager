"""
Одноразовый пересчёт «Нараховано» по существующим счетам.

Чинит копеечную погрешность float старого фронтенда (до фикса 050e620):
accrued считался в JS как (qty * rate).toFixed(2), двоичная погрешность
резала пол-копейки вниз (13.75 × 27.444 = 377.35499999999996 → 377.35
вместо 377.36). Пересчитываем accrued = quantity × rate точной
Decimal-арифметикой (ROUND_HALF_UP) — так же, как bill_generator
и roundMoney на фронте.

Ручные переопределения «Нарах.» не трогаем: правим только расхождения
в пределах --tolerance (по умолчанию 1 копейка). Большая разница означает,
что сумму ввели напрямую, а не через qty × rate.

Пример:
    python manage.py recalc_accrued --dry-run
    python manage.py recalc_accrued
    python manage.py recalc_accrued --year 2026 --service-id 3
"""
from decimal import Decimal, ROUND_HALF_UP

from django.core.management.base import BaseCommand
from django.db import transaction

from rentals.models import Bill


class Command(BaseCommand):
    help = ('Пересчитывает «Нараховано» (quantity × rate, half-up) в существующих '
            'счетах. Правит только копеечные расхождения от погрешности float; '
            'ручные переопределения суммы не трогает.')

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Тільки показати, що буде виправлено, без запису в БД',
        )
        parser.add_argument(
            '--year', type=int, default=None,
            help='Обмежити одним роком (за замовчуванням — усі)',
        )
        parser.add_argument(
            '--service-id', type=int, default=None,
            help='Обмежити одною послугою (за замовчуванням — усі)',
        )
        parser.add_argument(
            '--tolerance', type=Decimal, default=Decimal('0.01'),
            help='Максимальне розходження, яке вважаємо похибкою float (грн), '
                 'за замовчуванням 0.01',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        tolerance = options['tolerance']

        qs = Bill.objects.select_related('period', 'contract', 'service').order_by(
            'period__year', 'period__month', 'service__name', 'contract__contract_number',
        )
        if options['year'] is not None:
            qs = qs.filter(period__year=options['year'])
        if options['service_id'] is not None:
            qs = qs.filter(service_id=options['service_id'])

        checked = 0
        fixed = 0
        fixed_closed = 0     # исправлено в закрытых периодах
        fixed_verified = 0   # исправлено верифицированных (метку не снимаем)
        skipped_manual = 0   # расхождение больше tolerance — ручной ввод суммы

        prefix = '[DRY-RUN] ' if dry_run else ''

        with transaction.atomic():
            for bill in qs.iterator():
                checked += 1
                # Явный флаг ручного ввода (появился позже этой команды) —
                # надёжнее эвристики с tolerance ниже, проверяем первым
                if bill.is_manual_accrual:
                    skipped_manual += 1
                    continue

                expected = (bill.quantity * bill.rate).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                if bill.accrued_amount == expected:
                    continue

                if abs(bill.accrued_amount - expected) > tolerance:
                    skipped_manual += 1
                    continue

                self.stdout.write(
                    f'{prefix}{bill.period} | {bill.service.name} | '
                    f'договір {bill.contract.contract_number}: '
                    f'{bill.accrued_amount} → {expected}'
                    f'{" [закритий період]" if bill.period.is_closed else ""}'
                )
                if bill.period.is_closed:
                    fixed_closed += 1
                if bill.is_verified:
                    fixed_verified += 1
                if not dry_run:
                    bill.accrued_amount = expected
                    bill.save(update_fields=['accrued_amount', 'updated_at'])
                fixed += 1

        msg = (
            f'{prefix}Перевірено {checked}, виправлено {fixed}, '
            f'пропущено ручних сум {skipped_manual}'
        )
        if fixed_closed:
            msg += f'; у закритих періодах: {fixed_closed}'
        if fixed_verified:
            msg += f'; верифікованих: {fixed_verified} (позначку не знято)'
        self.stdout.write(self.style.SUCCESS(msg))
