"""
Бізнес-логика масового проставлення нарахування за місяць або діапазон місяців.

Дзеркало mass_payment.py: чиста функція, не залежить від HTTP, викликається
з view. Кнопка «Нарахування» в тулбарі білінгу.

Навіщо окрема дія (рішення клієнта 2026-09-04): помісячні цифри в програмі
мають збігатися з помісячними цифрами в паперових документах, а з нарахуванням
регулярно трапляються форс-мажори (напр. договір укладено пізніше фактичного
початку оренди — за попередні місяці нарахування має лишитись нульовим). Тому
автоматична формула не є правильною за замовчуванням: нарахування лишається 0,
поки бухгалтер не проставить його свідомо. Простіше поміняти цифру одиницям,
ніж проставляти значення кожному — звідси ця кнопка (масово проставити
об'єм × тариф) плюс ручне редагування окремих комірок.
"""
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from rentals.models import Bill, BillingPeriod, LockScope


@dataclass
class MassAccrualResult:
    """Результат — скільки рахунків нараховано/пропущено."""
    accrued: int = 0
    # Нарахування введене вручну — не чіпаємо, щоб не затерти цифру бухгалтера
    skipped_manual: int = 0
    # Вже дорівнює формулі — записувати немає сенсу (той самий early-exit,
    # що і в bill_generator._update_bill_rate)
    already_ok: int = 0
    skipped_closed: list[int] = field(default_factory=list)
    period_year: int = 0
    period_month: int = 0      # начало диапазона
    period_month_to: int = 0   # конец диапазона (включительно)


def _formula(quantity: Decimal, rate: Decimal) -> Decimal:
    """Той самий half-up, що і roundMoney на фронті (не banker's rounding)."""
    return (quantity * rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def mark_bills_accrued(
    year: int,
    month_from: int,
    month_to: int | None = None,
    *,
    service_id: int | None = None,
) -> MassAccrualResult:
    """
    Проставляє accrued_amount = quantity × rate для рахунків за місяць або
    діапазон місяців у межах одного року.

    Постачальників (SupplierBill) НЕ чіпає — як і кнопка «Сплачено»: дані
    орендарів і постачальників вносять різні люди, і у постачальників
    нарахування досі рахується автоматично при вводі обсягу
    (рішення клієнта 2026-09-04).

    Закриті періоди пропускаються цілком (як у generate_bills). Рахунок із
    ручним нарахуванням (is_manual_accrual) пропускається — його скидають
    окремою іконкою біля комірки.

    Raises:
        ValueError: якщо місяці не в діапазоні 1–12 або month_to < month_from
    """
    if month_to is None:
        month_to = month_from
    if not (1 <= month_from <= 12) or not (1 <= month_to <= 12):
        raise ValueError(f'місяць має бути 1–12, отримано: {month_from}–{month_to}')
    if month_to < month_from:
        raise ValueError(f'кінцевий місяць ({month_to}) менший за початковий ({month_from})')

    result = MassAccrualResult(
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
                if bill.is_manual_accrual:
                    result.skipped_manual += 1
                    continue
                amount = _formula(bill.quantity, bill.rate)
                if bill.accrued_amount == amount:
                    result.already_ok += 1
                    continue
                bill.accrued_amount = amount
                bill.save(update_fields=['accrued_amount', 'updated_at'])
                result.accrued += 1

    return result
