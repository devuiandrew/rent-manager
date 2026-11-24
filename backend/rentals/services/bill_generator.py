"""
Бизнес-логика генерации счетов за месяц или диапазон месяцев.

Изолирована от транспорта (CLI / HTTP) — функция принимает данные,
возвращает результат. Используется и management командой, и view.
"""
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Q

from rentals.models import (
    BillingPeriod, Bill, Contract, ContractService, Fund, LockScope,
    SupplierBill, SupplierContract,
)


@dataclass
class GenerationResult:
    """Результат генерации — что создано/обновлено/пропущено."""
    created: int = 0
    skipped_existing: int = 0
    # Существующие счета, где тариф перезаписан по истории (флаг update_rates)
    updated_rates: int = 0
    # Закрытые месяцы пропускаются целиком — их номера для отчёта
    skipped_closed: list[int] = field(default_factory=list)
    # Записи поставщиков — отдельные счётчики (та же генерация, вторая таблица)
    supplier_created: int = 0
    supplier_skipped_existing: int = 0
    supplier_updated_rates: int = 0
    # Месяцы, закрытые по замку ПОСТАВЩИКОВ (свой замок, не арендаторский)
    supplier_skipped_closed: list[int] = field(default_factory=list)
    period_year: int = 0
    period_month: int = 0      # начало диапазона
    period_month_to: int = 0   # конец диапазона (включительно)
    dry_run: bool = False


def generate_bills(
    year: int,
    month_from: int,
    month_to: int | None = None,
    *,
    dry_run: bool = False,
    service_id: int | None = None,
    update_rates: bool = False,
) -> GenerationResult:
    """
    Генерує рахунки за місяць або діапазон місяців (у межах одного року)
    для всіх активних договір↔послуг.

    - Переносить debt_start з попереднього місяця (стратегія "Opening Balance").
      Місяці обробляються за зростанням, тому перенос працює і всередині діапазону.
    - update_rates=True: в існуючих рахунках оновлює тариф за історією ServiceRate
      (тариф на 1-ше число місяця) і перераховує нараховане (quantity × rate);
      позначка «перевірено» знімається. Оплати і корекції не змінюються.
    - Закриті місяці пропускаються цілком (потрапляють у result.skipped_closed).

    Raises:
        ValueError: якщо місяці не в діапазоні 1–12 або month_to < month_from
    """
    if month_to is None:
        month_to = month_from
    if not (1 <= month_from <= 12) or not (1 <= month_to <= 12):
        raise ValueError(f'місяць має бути 1–12, отримано: {month_from}–{month_to}')
    if month_to < month_from:
        raise ValueError(f'кінцевий місяць ({month_to}) менший за початковий ({month_from})')

    result = GenerationResult(
        period_year=year,
        period_month=month_from,
        period_month_to=month_to,
        dry_run=dry_run,
    )

    # Одна транзакция на весь диапазон: либо всё, либо ничего
    with transaction.atomic():
        for month in range(month_from, month_to + 1):
            _generate_month(
                result, year, month,
                dry_run=dry_run, service_id=service_id, update_rates=update_rates,
            )
            # Записи поставщиков — той же кнопкой/командой, но отдельной функцией:
            # у них свой замок периода (suppliers), арендаторский не действует
            _generate_supplier_month(
                result, year, month,
                dry_run=dry_run, service_id=service_id, update_rates=update_rates,
            )

    return result


def _generate_month(
    result: GenerationResult,
    year: int,
    month: int,
    *,
    dry_run: bool,
    service_id: int | None,
    update_rates: bool,
) -> None:
    """Обрабатывает один месяц диапазона, дописывает счётчики в result."""
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)

    # Період (створюємо тільки якщо не dry-run)
    if dry_run:
        period = BillingPeriod.objects.filter(year=year, month=month).first()
    else:
        period, _ = BillingPeriod.objects.get_or_create(year=year, month=month)

    # Закрытый месяц не трогаем вообще: ни создания, ни обновления тарифов
    if period and period.is_closed_for(LockScope.TENANTS):
        result.skipped_closed.append(month)
        return

    prev_period = BillingPeriod.objects.filter(year=prev_year, month=prev_month).first()

    # Активні договори, що діють у цільовому місяці
    first_day = date(year, month, 1)
    last_day = date(year, month, monthrange(year, month)[1])

    active_contracts = Contract.objects.filter(
        is_active=True,
        date_start__lte=last_day,
    ).filter(
        Q(date_end__isnull=True) | Q(date_end__gte=first_day),
    )

    cs_qs = ContractService.objects.filter(
        is_active=True,
        contract__in=active_contracts,
    ).select_related('contract', 'service')

    if service_id is not None:
        cs_qs = cs_qs.filter(service_id=service_id)

    for cs in cs_qs:
        existing = None
        if period:
            existing = Bill.objects.filter(
                contract=cs.contract, service=cs.service, period=period,
            ).first()

        if existing:
            if update_rates:
                _update_bill_rate(result, existing, cs.rate_for(first_day), dry_run=dry_run)
            else:
                result.skipped_existing += 1
            continue

        # debt_start = total_debt_end з попереднього місяця
        debt_start = Decimal('0')
        if prev_period:
            prev_bill = Bill.objects.filter(
                contract=cs.contract, service=cs.service, period=prev_period,
            ).first()
            if prev_bill:
                debt_start = prev_bill.total_debt_end

        if not dry_run:
            Bill.objects.create(
                contract=cs.contract,
                service=cs.service,
                period=period,
                debt_start=debt_start,
                # Тариф, що діяв на початок місяця нарахування (історія тарифів),
                # а не поточний — інакше перегенерація старого періоду взяла б нову ставку
                rate=cs.rate_for(first_day),
                quantity=Decimal('0'),
                accrued_amount=Decimal('0'),
                paid_amount=Decimal('0'),
                correction=Decimal('0'),
            )
        result.created += 1


def _update_bill_rate(
    result: GenerationResult,
    bill: Bill,
    new_rate: Decimal,
    *,
    dry_run: bool,
) -> None:
    """Перезаписывает тариф существующего счёта и пересчитывает начисленное.

    Оплаты/корекции не трогаем. Отметка «перевірено» снимается — изменённые
    счета всплывут у бухгалтера в фильтре «Не перевірені». Якщо нарахування
    введене вручну (is_manual_accrual) — accrued_amount НЕ чіпаємо, оновлюємо
    лише тариф (для довідки/майбутніх місяців), інакше --update-rates затер би
    ручну цифру бухгалтера.
    """
    if bill.rate == new_rate:
        result.skipped_existing += 1
        return

    if not dry_run:
        bill.rate = new_rate
        update_fields = ['rate', 'is_verified', 'verified_by', 'verified_at', 'updated_at']
        if not bill.is_manual_accrual:
            # Тот же half-up, что и roundMoney на фронте (не banker's rounding)
            bill.accrued_amount = (bill.quantity * new_rate).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP,
            )
            update_fields.append('accrued_amount')
        bill.is_verified = False
        bill.verified_by = None
        bill.verified_at = None
        bill.save(update_fields=update_fields)
    result.updated_rates += 1


def _generate_supplier_month(
    result: GenerationResult,
    year: int,
    month: int,
    *,
    dry_run: bool,
    service_id: int | None,
    update_rates: bool,
) -> None:
    """Записи поставщиков за один месяц — зеркало _generate_month.

    На каждый договор создаёт ДВА записи — спец. и общий фонд. Счётчик
    supplier_created считает записи, а не договоры, поэтому его значение
    вдвое больше числа договоров — это норма, а не дубли.

    Смотрит только СВОЙ замок (suppliers): замок арендаторов записи
    поставщика не блокирует — их создают задним числом за 1–2 месяца,
    когда у арендаторов период уже закрыт. Закрытый для поставщиков месяц
    пропускается целиком, как у арендаторов.
    """
    prev_year, prev_month = (year - 1, 12) if month == 1 else (year, month - 1)

    if dry_run:
        period = BillingPeriod.objects.filter(year=year, month=month).first()
    else:
        period, _ = BillingPeriod.objects.get_or_create(year=year, month=month)

    if period and period.is_closed_for(LockScope.SUPPLIERS):
        result.supplier_skipped_closed.append(month)
        return

    prev_period = BillingPeriod.objects.filter(year=prev_year, month=prev_month).first()

    first_day = date(year, month, 1)
    last_day = date(year, month, monthrange(year, month)[1])

    # Договоры поставщиков, действующие в целевом месяце
    # (date_end = null — бессрочный, действует всегда после date_start)
    sc_qs = SupplierContract.objects.filter(
        date_start__lte=last_day,
    ).filter(
        Q(date_end__isnull=True) | Q(date_end__gte=first_day),
    ).select_related('service')

    if service_id is not None:
        sc_qs = sc_qs.filter(service_id=service_id)

    for sc in sc_qs:
        # Тариф общий для обоих фондов — считаем один раз на договор
        rate = sc.service.rate_on(first_day)

        # Два записи на месяц — по одному на фонд. Если фактически задействован
        # один, второй остаётся нулями (решение клиента 2026-09-18)
        for fund in (Fund.SPECIAL, Fund.GENERAL):
            existing = None
            if period:
                existing = SupplierBill.objects.filter(
                    supplier_contract=sc, period=period, fund=fund,
                ).first()

            if existing:
                if update_rates:
                    _update_supplier_bill_rate(
                        result, existing, rate, dry_run=dry_run,
                    )
                else:
                    result.supplier_skipped_existing += 1
                continue

            # debt_start = total_debt_end прошлого месяца ТОГО ЖЕ договора
            # и ТОГО ЖЕ фонда — фонды не смешиваются.
            # При смене поставщика новый договор стартует с 0 — долг остаётся
            # числиться за старым поставщиком (бизнес-корректно)
            debt_start = Decimal('0')
            if prev_period:
                prev_bill = SupplierBill.objects.filter(
                    supplier_contract=sc, period=prev_period, fund=fund,
                ).first()
                if prev_bill:
                    debt_start = prev_bill.total_debt_end

            if not dry_run:
                SupplierBill.objects.create(
                    supplier_contract=sc,
                    period=period,
                    fund=fund,
                    debt_start=debt_start,
                    # Общий тариф услуги на 1-е число месяца (истории у поставщика нет)
                    rate=rate,
                    quantity=Decimal('0'),
                    accrued_amount=Decimal('0'),
                    paid_amount=Decimal('0'),
                    correction=Decimal('0'),
                )
            result.supplier_created += 1


def _update_supplier_bill_rate(
    result: GenerationResult,
    bill: SupplierBill,
    new_rate: Decimal,
    *,
    dry_run: bool,
) -> None:
    """Зеркало _update_bill_rate без сброса верификации (у поставщика её нет).

    Та же семантика early-exit: тариф не изменился → нарах. не пересчитывается.
    Та же защита ручного нарахування (is_manual_accrual) — см. _update_bill_rate.
    """
    if bill.rate == new_rate:
        result.supplier_skipped_existing += 1
        return

    if not dry_run:
        bill.rate = new_rate
        update_fields = ['rate', 'updated_at']
        if not bill.is_manual_accrual:
            bill.accrued_amount = (bill.quantity * new_rate).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP,
            )
            update_fields.append('accrued_amount')
        bill.save(update_fields=update_fields)
    result.supplier_updated_rates += 1
