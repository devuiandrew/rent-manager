# Тести генерації рахунків орендарів (Bill) — раніше покривалась тільки
# сторона постачальників (test_suppliers.py::SupplierGenerationTests),
# хоча generate_bills() створює й оновлює й Bill теж.
#
# Запуск (PowerShell): $env:DB_ENGINE="django.db.backends.sqlite3"; python manage.py test rentals
from datetime import date
from decimal import Decimal

from django.test import TestCase

from rentals.models import Bill, Contract, ContractService, Service, ServiceRate, Tenant
from rentals.services.bill_generator import generate_bills


def _make_service(name, rate='10'):
    service = Service.objects.create(name=name, unit_name='м³', default_rate=Decimal(rate))
    ServiceRate.objects.create(service=service, rate=Decimal(rate), effective_from=date(2020, 1, 1))
    return service


class BillGenerationManualAccrualTests(TestCase):
    """--update-rates оновлює Bill.rate, але не чіпає Bill.accrued_amount,
    якщо нарахування введене вручну (is_manual_accrual) — інакше перегенерація
    затирала б цифру, яку бухгалтер поставив свідомо (напр. 0 за місяці до
    укладення договору)."""

    @classmethod
    def setUpTestData(cls):
        cls.service = _make_service('Вода (bill-ген)', rate='10')
        cls.tenant = Tenant.objects.create(name='ТОВ Оренда (bill-ген)')
        cls.contract = Contract.objects.create(
            tenant=cls.tenant, contract_number='Б-1', address='вул. Тестова, 3',
            area_size='40.00', date_start=date(2026, 1, 1),
        )
        ContractService.objects.create(contract=cls.contract, service=cls.service)

    def _bill(self, month):
        return Bill.objects.get(
            contract=self.contract, service=self.service,
            period__year=2026, period__month=month,
        )

    def test_update_rates_preserves_manual_accrual(self):
        generate_bills(2026, 4)
        bill = self._bill(4)
        bill.quantity = Decimal('27.444')
        bill.accrued_amount = Decimal('0')  # бухгалтер вручну обнулив нарах.
        bill.is_manual_accrual = True
        bill.save()
        ServiceRate.objects.create(
            service=self.service, rate=Decimal('13.75'), effective_from=date(2026, 4, 1),
        )

        result = generate_bills(2026, 4, update_rates=True)
        self.assertEqual(result.updated_rates, 1)
        bill.refresh_from_db()
        self.assertEqual(bill.rate, Decimal('13.75'))
        self.assertEqual(bill.accrued_amount, Decimal('0'))
        self.assertTrue(bill.is_manual_accrual)

    def test_update_rates_still_recalculates_when_not_manual(self):
        # Контрольний тест: без прапорця поведінка не змінилась (регресія)
        generate_bills(2026, 5)
        bill = self._bill(5)
        bill.quantity = Decimal('27.444')
        bill.save()
        ServiceRate.objects.create(
            service=self.service, rate=Decimal('13.75'), effective_from=date(2026, 5, 1),
        )

        result = generate_bills(2026, 5, update_rates=True)
        self.assertEqual(result.updated_rates, 1)
        bill.refresh_from_db()
        self.assertEqual(bill.rate, Decimal('13.75'))
        # half-up: 27.444 × 13.75 = 377.3549... → 377.36
        self.assertEqual(bill.accrued_amount, Decimal('377.36'))
