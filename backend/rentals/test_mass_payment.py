# Тести кнопки «Сплачено» — services/mass_payment.py::mark_bills_paid.
#
# Запуск (PowerShell): $env:DB_ENGINE="django.db.backends.sqlite3"; python manage.py test rentals
from datetime import date
from decimal import Decimal

from django.test import TestCase

from rentals.models import (
    Bill, BillingPeriod, Contract, ContractService, LockScope, PeriodLock,
    Service, ServiceRate, Tenant,
)
from rentals.services.bill_generator import generate_bills
from rentals.services.mass_payment import mark_bills_paid


def _make_service(name, rate='10'):
    service = Service.objects.create(name=name, unit_name='м³', default_rate=Decimal(rate))
    ServiceRate.objects.create(service=service, rate=Decimal(rate), effective_from=date(2020, 1, 1))
    return service


class MassPaymentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.service = _make_service('Вода (оплата)')
        cls.tenant = Tenant.objects.create(name='ТОВ Оренда (оплата)')
        cls.contract = Contract.objects.create(
            tenant=cls.tenant, contract_number='О-1', address='вул. Тестова, 4',
            area_size='30.00', date_start=date(2026, 1, 1),
        )
        ContractService.objects.create(contract=cls.contract, service=cls.service)

    def _bill(self, month):
        return Bill.objects.get(
            contract=self.contract, service=self.service,
            period__year=2026, period__month=month,
        )

    def test_marks_paid_equal_to_accrued(self):
        generate_bills(2026, 3)
        bill = self._bill(3)
        bill.quantity = Decimal('20')
        bill.accrued_amount = Decimal('200.00')
        bill.save()

        result = mark_bills_paid(2026, 3)
        self.assertEqual(result.paid, 1)
        self.assertEqual(result.skipped_paid, 0)
        bill.refresh_from_db()
        self.assertEqual(bill.paid_amount, Decimal('200.00'))

    def test_skips_closed_period(self):
        generate_bills(2026, 4)
        PeriodLock.objects.create(
            period=BillingPeriod.objects.get(year=2026, month=4), scope=LockScope.TENANTS,
        )

        result = mark_bills_paid(2026, 4)
        self.assertEqual(result.skipped_closed, [4])
        self.assertEqual(result.paid, 0)
        bill = self._bill(4)
        self.assertEqual(bill.paid_amount, Decimal('0'))

    def test_skips_bill_with_existing_payment(self):
        # Часткова/ручна оплата не затирається кнопкою — оператор править сам
        generate_bills(2026, 5)
        bill = self._bill(5)
        bill.accrued_amount = Decimal('150.00')
        bill.paid_amount = Decimal('50.00')
        bill.save()

        result = mark_bills_paid(2026, 5)
        self.assertEqual(result.paid, 0)
        self.assertEqual(result.skipped_paid, 1)
        bill.refresh_from_db()
        self.assertEqual(bill.paid_amount, Decimal('50.00'))

    def test_service_id_filter(self):
        other_service = _make_service('Газ (оплата)')
        ContractService.objects.create(contract=self.contract, service=other_service)
        generate_bills(2026, 6)
        other_bill = Bill.objects.get(
            contract=self.contract, service=other_service,
            period__year=2026, period__month=6,
        )
        other_bill.accrued_amount = Decimal('75.00')
        other_bill.save()

        result = mark_bills_paid(2026, 6, service_id=self.service.id)
        self.assertEqual(result.paid, 1)
        other_bill.refresh_from_db()
        self.assertEqual(other_bill.paid_amount, Decimal('0'))  # інша послуга не зачеплена

    def test_range_across_months(self):
        generate_bills(2026, 7, 8)
        for month in (7, 8):
            bill = self._bill(month)
            bill.accrued_amount = Decimal('100.00')
            bill.save()

        result = mark_bills_paid(2026, 7, 8)
        self.assertEqual(result.paid, 2)
        for month in (7, 8):
            self.assertEqual(self._bill(month).paid_amount, Decimal('100.00'))

    def test_invalid_month_range_raises(self):
        with self.assertRaises(ValueError):
            mark_bills_paid(2026, 8, 3)
