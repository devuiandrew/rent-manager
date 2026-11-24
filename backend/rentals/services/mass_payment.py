"""
Бізнес-логика масового проставлення оплати за місяць або діапазон місяців.

Дзеркало bill_generator.py: чиста функція, не залежить від HTTP, викликається
з view. Кнопка «Сплачено» в тулбарі білінгу — оператору не потрібно вручну
проставляти оплату кожному орендарю окремо, коли більшість платить вчасно
(рішення клієнта 2026-09-02).
"""
from dataclasses import dataclass, field
from decimal import Decimal

from django.db import transaction

from rentals.models import Bill, BillingPeriod, LockScope


@dataclass
class MassPaymentResult:
    """Результат — скільки рахунків оплачено/пропущено."""
    paid: int = 0
    # Рахунок з уже ненульовою оплатою (часткова/ручна) — не чіпаємо,
    # щоб не затерти те, що оператор вніс окремо
    skipped_paid: int = 0
    skipped_closed: list[int] = field(default_factory=list)
    period_year: int = 0
    period_month: int = 0      # начало диапазона
    period_month_to: int = 0   # конец диапазона (включительно)


def mark_bills_paid(
    year: int,
    month_from: int,
    month_to: int | None = None,
    *,
    service_id: int | None = None,
) -> MassPaymentResult:
    """
    Проставляє paid_amount = accrued_amount для рахунків орендарів (Bill) за
    місяць або діапазон місяців у межах одного року.

    Постачальників (SupplierBill) НЕ чіпає — кнопка «Сплачено» стосується
    тільки орендарів. Закриті періоди пропускаються цілком (як у generate_bills).
    Рахунок із вже ненульовою оплатою пропускається — залишки/корекції оператор
    править вручну.

    Raises:
        ValueError: якщо місяці не в діапазоні 1–12 або month_to < month_from
    """
    if month_to is None:
        month_to = month_from
    if not (1 <= month_from <= 12) or not (1 <= month_to <= 12):
        raise ValueError(f'місяць має бути 1–12, отримано: {month_from}–{month_to}')
    if month_to < month_from:
        raise ValueError(f'кінцевий місяць ({month_to}) менший за початковий ({month_from})')

    result = MassPaymentResult(
        period_year=year, period_month=month_from, period_month_to=month_to,
    )

    with transaction.atomic():
        for month in range(month_from, month_to + 1):
            period = BillingPeriod.objects.filter(year=year, month=month).first()
            if period is None:
                continue
            # Только счета арендаторов — значит, и замок арендаторский
            if period.is_closed_for(LockScope.TENANTS):
                result.skipped_closed.append(month)
                continue

            bills_qs = Bill.objects.filter(period=period)
            if service_id is not None:
                bills_qs = bills_qs.filter(service_id=service_id)

            for bill in bills_qs:
                if bill.paid_amount != Decimal('0'):
                    result.skipped_paid += 1
                    continue
                bill.paid_amount = bill.accrued_amount
                bill.save(update_fields=['paid_amount', 'updated_at'])
                result.paid += 1

    return result
