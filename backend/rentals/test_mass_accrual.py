# Тести кнопки «Нарахування» — services/mass_accrual.py::mark_bills_accrued.
#
# Запуск (PowerShell): $env:DB_ENGINE="django.db.backends.sqlite3"; python manage.py test rentals
from datetime import date
from decimal import Decimal

from django.test import TestCase

from rentals.models import (
    Bill, BillingPeriod, Contract, ContractService, Fund, LockScope, PeriodLock,
    Service, ServiceRate, Supplier, SupplierBill, SupplierContract, Tenant,
)
from rentals.services.bill_generator import generate_bills
from rentals.services.mass_accrual import mark_bills_accrued


def _make_service(name, rate='10'):
    service = Service.objects.create(name=name, unit_name='м³', default_rate=Decimal(rate))
    ServiceRate.objects.create(service=service, rate=Decimal(rate), effective_from=date(2020, 1, 1))
    return service


class MassAccrualTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.service = _make_service('Вода (нарах.)')
        cls.tenant = Tenant.objects.create(name='ТОВ Оренда (нарах.)')
        cls.contract = Contract.objects.create(
            tenant=cls.tenant, contract_number='Н-1', address='вул. Тестова, 5',
            area_size='30.00', date_start=date(2026, 1, 1),
        )
        ContractService.objects.create(contract=cls.contract, service=cls.service)

    def _bill(self, month):
        return Bill.objects.get(
            contract=self.contract, service=self.service,
            period__year=2026, period__month=month,
        )

    def test_accrues_quantity_times_rate(self):
        generate_bills(2026, 3)
        bill = self._bill(3)
        bill.quantity = Decimal('20')
        bill.save()

        result = mark_bills_accrued(2026, 3)
        self.assertEqual(result.accrued, 1)
        bill.refresh_from_db()
        self.assertEqual(bill.accrued_amount, Decimal('200.00'))

    def test_generated_bill_stays_zero_until_button(self):
        # Головна вимога: саме по собі нарахування не проставляється
        generate_bills(2026, 4)
        bill = self._bill(4)
        bill.quantity = Decimal('15')
        bill.save()
        self.assertEqual(bill.accrued_amount, Decimal('0'))

    def test_skips_manual_accrual(self):
        # Ручну цифру бухгалтера кнопка не затирає
        generate_bills(2026, 5)
        bill = self._bill(5)
        bill.quantity = Decimal('20')
        bill.accrued_amount = Decimal('0')
        bill.is_manual_accrual = True
        bill.save()

        result = mark_bills_accrued(2026, 5)
        self.assertEqual(result.accrued, 0)
        self.assertEqual(result.skipped_manual, 1)
        bill.refresh_from_db()
        self.assertEqual(bill.accrued_amount, Decimal('0'))

    def test_skips_closed_period(self):
        generate_bills(2026, 6)
        PeriodLock.objects.create(
            period=BillingPeriod.objects.get(year=2026, month=6), scope=LockScope.TENANTS,
        )

        result = mark_bills_accrued(2026, 6)
        self.assertEqual(result.skipped_closed, [6])
        self.assertEqual(result.accrued, 0)

    def test_already_matching_value_not_rewritten(self):
        generate_bills(2026, 7)
        bill = self._bill(7)
        bill.quantity = Decimal('10')
        bill.accrued_amount = Decimal('100.00')
        bill.save()

        result = mark_bills_accrued(2026, 7)
        self.assertEqual(result.accrued, 0)
        self.assertEqual(result.already_ok, 1)

    def test_rounding_is_half_up(self):
        # 13.75 × 27.444 = 377.355 → 377.36 (а не 377.35 через float)
        service = _make_service('Тепло (нарах.)', rate='27.444')
        ContractService.objects.create(contract=self.contract, service=service)
        generate_bills(2026, 8)
        bill = Bill.objects.get(
            contract=self.contract, service=service,
            period__year=2026, period__month=8,
        )
        bill.quantity = Decimal('13.75')
        bill.save()

        mark_bills_accrued(2026, 8, service_id=service.id)
        bill.refresh_from_db()
        self.assertEqual(bill.accrued_amount, Decimal('377.36'))

    def test_service_id_filter(self):
        other_service = _make_service('Газ (нарах.)')
        ContractService.objects.create(contract=self.contract, service=other_service)
        generate_bills(2026, 9)
        for bill in Bill.objects.filter(period__year=2026, period__month=9):
            bill.quantity = Decimal('5')
            bill.save()

        result = mark_bills_accrued(2026, 9, service_id=self.service.id)
        self.assertEqual(result.accrued, 1)
        other_bill = Bill.objects.get(
            contract=self.contract, service=other_service,
            period__year=2026, period__month=9,
        )
        self.assertEqual(other_bill.accrued_amount, Decimal('0'))  # інша послуга не зачеплена

    def test_range_across_months(self):
        generate_bills(2026, 10, 11)
        for month in (10, 11):
            bill = self._bill(month)
            bill.quantity = Decimal('7')
            bill.save()

        result = mark_bills_accrued(2026, 10, 11)
        self.assertEqual(result.accrued, 2)
        for month in (10, 11):
            self.assertEqual(self._bill(month).accrued_amount, Decimal('70.00'))

    def test_invalid_month_range_raises(self):
        with self.assertRaises(ValueError):
            mark_bills_accrued(2026, 8, 3)


class MassAccrualSupplierTests(TestCase):
    """Кнопка постачальників НЕ чіпає (рішення клієнта 2026-09-04: дані
    орендарів і постачальників вносять різні люди, у постачальників
    нарахування рахується автоматично при вводі обсягу)."""

    @classmethod
    def setUpTestData(cls):
        cls.service = _make_service('Вода (пост. нарах.)')
        cls.supplier = Supplier.objects.create(name='Водоканал (нарах.)')
        cls.sc = SupplierContract.objects.create(
            supplier=cls.supplier, service=cls.service,
            number='ПН-1', date_start=date(2026, 1, 1),
        )

    def _bill(self, month):
        # На месяц приходится два записи (спец. + общий) — берём спец.
        return SupplierBill.objects.get(
            supplier_contract=self.sc, period__year=2026, period__month=month,
            fund=Fund.SPECIAL,
        )

    def test_supplier_bill_untouched(self):
        generate_bills(2026, 3)
        bill = self._bill(3)
        bill.quantity = Decimal('40')
        bill.save()

        result = mark_bills_accrued(2026, 3)
        self.assertEqual(result.accrued, 0)  # орендарів тут немає взагалі
        bill.refresh_from_db()
        self.assertEqual(bill.accrued_amount, Decimal('0'))
