"""
Создаёт счета за месяц или диапазон месяцев для всех активных договір↔послуг.

Тонкая обёртка над rentals.services.bill_generator.generate_bills.

Пример:
    python manage.py create_next_month_bills 2024 3
    python manage.py create_next_month_bills 2024 3 --dry-run
    python manage.py create_next_month_bills 2024 1 --month-to 12 --update-rates
"""
from django.core.management.base import BaseCommand, CommandError

from rentals.services.bill_generator import generate_bills


class Command(BaseCommand):
    help = ('Створює рахунки за місяць або діапазон місяців. '
            'Переносить debt_start з попереднього місяця.')

    def add_arguments(self, parser):
        parser.add_argument('year', type=int, help='Рік (напр. 2024)')
        parser.add_argument('month', type=int, help='Місяць 1–12 (початок діапазону)')
        parser.add_argument(
            '--month-to', type=int, default=None,
            help='Кінець діапазону (включно), за замовчуванням = month',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Тільки показати, що буде створено, без запису в БД',
        )
        parser.add_argument(
            '--service-id', type=int, default=None,
            help='Обмежити одною послугою (за замовчуванням — усі)',
        )
        parser.add_argument(
            '--update-rates', action='store_true',
            help='Перезаписати тариф в існуючих рахунках за історією тарифів '
                 '(нарах. перераховується, позначка «перевірено» знімається)',
        )

    def handle(self, *args, **options):
        try:
            result = generate_bills(
                year=options['year'],
                month_from=options['month'],
                month_to=options['month_to'],
                dry_run=options['dry_run'],
                service_id=options['service_id'],
                update_rates=options['update_rates'],
            )
        except ValueError as e:
            raise CommandError(str(e))

        prefix = '[DRY-RUN] ' if result.dry_run else ''
        period_label = f'{result.period_year}-{result.period_month:02d}'
        if result.period_month_to != result.period_month:
            period_label += f'..{result.period_month_to:02d}'

        msg = (
            f'{prefix}Період {period_label}: '
            f'створено {result.created}, '
            f'пропущено (вже існували) {result.skipped_existing}'
        )
        if result.updated_rates:
            msg += f', оновлено тарифів {result.updated_rates}'
        if result.skipped_closed:
            closed = ', '.join(str(m) for m in result.skipped_closed)
            msg += f', пропущено закриті місяці: {closed}'
        # Записи поставщиков — той же генерацией, но со своим замком (suppliers)
        if result.supplier_created or result.supplier_updated_rates:
            # Записей, а не договоров: на месяц их два — спец. и общий фонд
            msg += f'; постачальники: створено {result.supplier_created} записів'
            if result.supplier_updated_rates:
                msg += f', оновлено тарифів {result.supplier_updated_rates}'
        if result.supplier_skipped_closed:
            closed = ', '.join(str(m) for m in result.supplier_skipped_closed)
            msg += f'; постачальники: пропущено закриті місяці: {closed}'
        self.stdout.write(self.style.SUCCESS(msg))
