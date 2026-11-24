# Тесты фичи «Постачальники»: overlap-валидация договоров + API записей.
# Тесты генерации записей поставщиков — ниже, класс SupplierGenerationTests.
#
# Запуск (PowerShell): $env:DB_ENGINE="django.db.backends.sqlite3"; python manage.py test rentals
# (пояснение, почему sqlite — в шапке tests.py)
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from django.db import IntegrityError, transaction

from rentals.models import (
    BillingPeriod, Contract, ContractService, Fund, LockScope, PeriodLock,
    Service, ServiceRate, Supplier, SupplierBill, SupplierContract,
    SupplierFundPlan, Tenant,
)
from rentals.services.bill_generator import generate_bills

User = get_user_model()

CONTRACTS_URL = '/api/supplier-contracts/'
BILLS_URL = '/api/supplier-bills/'
PLANS_URL = '/api/supplier-fund-plans/'


def _make_service(name, rate='10'):
    """Хелпер: услуга с начальной записью истории тарифов."""
    service = Service.objects.create(name=name, unit_name='м³', default_rate=Decimal(rate))
    ServiceRate.objects.create(service=service, rate=Decimal(rate), effective_from=date(2020, 1, 1))
    return service


class SupplierContractValidationTests(APITestCase):
    """Декілька постачальників можуть одночасно діяти на одну послугу
    (рішення клієнта 2026-09-02) — перетини періодів дозволені, тест
    перевіряє, що лишається тільки валідація дат."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('tester', password='x')
        cls.service = _make_service('Вода (тест)')
        cls.other_service = _make_service('Газ (тест)')
        cls.supplier = Supplier.objects.create(name='Водоканал')
        cls.other_supplier = Supplier.objects.create(name='Аква-Сервіс')
        # Существующий договор с конечным периодом: весь 2026 год
        cls.existing = SupplierContract.objects.create(
            supplier=cls.supplier, service=cls.service,
            number='П-1', date_start=date(2026, 1, 1), date_end=date(2026, 12, 31),
        )

    def setUp(self):
        self.client.force_authenticate(user=self.user)

    def _payload(self, **kwargs):
        data = {
            'supplier_id': self.other_supplier.id,
            'service_id': self.service.id,
            'number': 'П-2',
            'date_start': '2026-06-01',
            'date_end': '2027-05-31',
            'note': '',
        }
        data.update(kwargs)
        return data

    def test_overlapping_period_allowed(self):
        # Період перетинається з П-1, той самий постачальник/послуга — тепер ОК
        resp = self.client.post(CONTRACTS_URL, self._payload(), format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_open_ended_new_overlaps_future_existing_allowed(self):
        # Новий безстроковий (date_end=null), починається всередині П-1 — тепер ОК
        resp = self.client.post(
            CONTRACTS_URL, self._payload(date_start='2026-06-01', date_end=None),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_open_ended_existing_does_not_block_later_contract(self):
        # Існуючий безстроковий договір більше не блокує пізніший період тієї ж послуги
        SupplierContract.objects.create(
            supplier=self.supplier, service=self.other_service,
            number='П-Г', date_start=date(2026, 1, 1), date_end=None,
        )
        resp = self.client.post(
            CONTRACTS_URL,
            self._payload(
                service_id=self.other_service.id,
                date_start='2030-01-01', date_end='2030-12-31',
            ),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_adjacent_periods_allowed(self):
        # Смежные периоды (П-1 кончился 31.12.2026, новый с 01.01.2027) — не пересечение
        resp = self.client.post(
            CONTRACTS_URL,
            self._payload(date_start='2027-01-01', date_end='2027-12-31'),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_other_service_same_period_allowed(self):
        # Тот же период, но другая услуга — конфликта нет
        resp = self.client.post(
            CONTRACTS_URL, self._payload(service_id=self.other_service.id),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_patch_self(self):
        # PATCH самого себя (сдвиг даты) проходит без ошибок
        resp = self.client.patch(
            f'{CONTRACTS_URL}{self.existing.id}/',
            {'date_end': '2026-11-30'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_date_end_before_start_rejected(self):
        resp = self.client.post(
            CONTRACTS_URL,
            self._payload(date_start='2028-06-01', date_end='2028-01-01'),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class SupplierBillApiTests(APITestCase):
    """API записей поставщика: редактирование в закрытом периоде, фильтры, дубли."""

    @classmethod
    def setUpTestData(cls):
        # Обычный пользователь без групп и is_staff — самый ограниченный в правах
        cls.user = User.objects.create_user('operator', password='x')
        cls.service = _make_service('Опалення (тест)')
        cls.supplier = Supplier.objects.create(name='Теплоенерго')
        cls.contract = SupplierContract.objects.create(
            supplier=cls.supplier, service=cls.service,
            number='Т-1', date_start=date(2026, 1, 1), date_end=None,
        )
        cls.closed_period = BillingPeriod.objects.create(year=2026, month=1)
        PeriodLock.objects.create(period=cls.closed_period, scope=LockScope.TENANTS)
        cls.open_period = BillingPeriod.objects.create(year=2026, month=2)
        cls.bill_closed = SupplierBill.objects.create(
            supplier_contract=cls.contract, period=cls.closed_period,
            quantity=Decimal('100'), rate=Decimal('10'), accrued_amount=Decimal('1000'),
        )

    def setUp(self):
        self.client.force_authenticate(user=self.user)

    def test_tenants_lock_does_not_block_supplier_edit(self):
        # Было (v1): «закрытие периодов не действует на поставщиков».
        # Стало (B3): у поставщиков СВОЙ замок, а замок АРЕНДАТОРОВ их не
        # блокирует — записи вносят задним числом, когда у арендаторов период
        # уже закрыт. closed_period закрыт только для арендаторов (у Bill — 403)
        resp = self.client.patch(
            f'{BILLS_URL}{self.bill_closed.id}/',
            {'paid_amount': '500.00'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.bill_closed.refresh_from_db()
        self.assertEqual(self.bill_closed.paid_amount, Decimal('500.00'))

    def test_suppliers_lock_blocks_edit_for_non_staff(self):
        # B3: замок поставщиков действует так же, как у арендаторов
        PeriodLock.objects.create(period=self.open_period, scope=LockScope.SUPPLIERS)
        bill = SupplierBill.objects.create(
            supplier_contract=self.contract, period=self.open_period,
        )
        resp = self.client.patch(
            f'{BILLS_URL}{bill.id}/', {'paid_amount': '1.00'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        bill.refresh_from_db()
        self.assertEqual(bill.paid_amount, Decimal('0'))

    def test_suppliers_lock_allows_admin_edit(self):
        # Как у арендаторов: закрытый период правит только админ
        admin = User.objects.create_user('supadmin', password='x', is_staff=True)
        PeriodLock.objects.create(period=self.open_period, scope=LockScope.SUPPLIERS)
        bill = SupplierBill.objects.create(
            supplier_contract=self.contract, period=self.open_period,
        )
        self.client.force_authenticate(user=admin)
        resp = self.client.patch(
            f'{BILLS_URL}{bill.id}/', {'paid_amount': '1.00'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_debt_end_computed(self):
        # debt_end = debt_start + нарах. + корекція − сплачено (read-only из property)
        resp = self.client.get(f'{BILLS_URL}{self.bill_closed.id}/')
        self.assertEqual(
            Decimal(resp.data['debt_end']),
            self.bill_closed.total_debt_end,
        )

    def test_filter_by_service_and_year(self):
        # Фильтры, которыми пользуется страница «Рахунки»
        other_service = _make_service('Світло (тест)')
        other_contract = SupplierContract.objects.create(
            supplier=self.supplier, service=other_service,
            number='С-1', date_start=date(2026, 1, 1),
        )
        SupplierBill.objects.create(supplier_contract=other_contract, period=self.open_period)

        resp = self.client.get(BILLS_URL, {'service_id': self.service.id, 'year': 2026})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [b['supplier_contract_id'] for b in resp.data]
        self.assertEqual(ids, [self.contract.id])
        # service_id отдаётся в каждой записи — фронт группирует по нему
        self.assertEqual(resp.data[0]['service_id'], self.service.id)

    def test_duplicate_rejected_as_400(self):
        # Дубль (договор, период, фонд) — 400 от явного UniqueTogetherValidator, не 500.
        # fund не передан → дефолт 'spec', а такая запись уже есть в setUpTestData
        resp = self.client.post(
            BILLS_URL,
            {
                'supplier_contract_id': self.contract.id,
                'period_id': self.closed_period.id,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_second_fund_same_month_allowed(self):
        # Гвоздь фичи: на месяц приходится ДВА записи — спец. и общий фонд.
        # bill_closed уже занимает 'spec', общий фонд должен создаться
        resp = self.client.post(
            BILLS_URL,
            {
                'supplier_contract_id': self.contract.id,
                'period_id': self.closed_period.id,
                'fund': Fund.GENERAL,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['fund'], Fund.GENERAL)
        self.assertEqual(
            SupplierBill.objects.filter(
                supplier_contract=self.contract, period=self.closed_period,
            ).count(),
            2,
        )

    def test_third_record_same_fund_rejected_on_db_level(self):
        # Уникальность держится и в БД, не только в сериализаторе
        SupplierBill.objects.create(
            supplier_contract=self.contract, period=self.closed_period,
            fund=Fund.GENERAL,
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                SupplierBill.objects.create(
                    supplier_contract=self.contract, period=self.closed_period,
                    fund=Fund.GENERAL,
                )

    def test_filter_by_fund(self):
        SupplierBill.objects.create(
            supplier_contract=self.contract, period=self.closed_period,
            fund=Fund.GENERAL,
        )
        resp = self.client.get(BILLS_URL, {'fund': Fund.GENERAL})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([b['fund'] for b in resp.data], [Fund.GENERAL])

    def test_existing_records_default_to_special_fund(self):
        # Старые записи (созданные до фичи) миграция заполняет 'spec' —
        # здесь проверяем сам дефолт модели, на который опирается миграция
        self.assertEqual(self.bill_closed.fund, Fund.SPECIAL)

    def test_unauthenticated_401(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get(BILLS_URL)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class SupplierGenerationTests(APITestCase):
    """generate_bills создаёт записи поставщиков: перенос долга, закрытые
    периоды, update_rates, границы дат договора."""

    @classmethod
    def setUpTestData(cls):
        cls.service = _make_service('Вода (ген)', rate='10')
        cls.supplier = Supplier.objects.create(name='Водоканал (ген)')
        cls.contract = SupplierContract.objects.create(
            supplier=cls.supplier, service=cls.service,
            number='Г-1', date_start=date(2026, 1, 1), date_end=None,
        )

    def _bill(self, month, contract=None, fund=Fund.SPECIAL):
        # На месяц приходится два записи (спец. + общий), поэтому фонд
        # обязателен в выборке. По умолчанию — спец., он «основной»
        return SupplierBill.objects.get(
            supplier_contract=contract or self.contract,
            period__year=2026, period__month=month, fund=fund,
        )

    def test_creates_supplier_bill_with_history_rate(self):
        # Тариф берётся из истории на 1-е число месяца, не текущий
        ServiceRate.objects.create(
            service=self.service, rate=Decimal('15'), effective_from=date(2026, 3, 1),
        )
        result = generate_bills(2026, 2, 3)
        # 2 місяці x 1 договір x 2 фонди
        self.assertEqual(result.supplier_created, 4)
        self.assertEqual(self._bill(2).rate, Decimal('10'))
        self.assertEqual(self._bill(3).rate, Decimal('15'))

    def test_debt_carryover(self):
        # Борг переносится: debt_start месяца 2 = total_debt_end месяца 1
        generate_bills(2026, 1)
        bill1 = self._bill(1)
        bill1.quantity = Decimal('100')
        bill1.accrued_amount = Decimal('1000')
        bill1.paid_amount = Decimal('400')
        bill1.save()

        generate_bills(2026, 2)
        self.assertEqual(self._bill(2).debt_start, Decimal('600.00'))

    def test_creates_both_funds(self):
        # На місяць — два записи, навіть якщо фактично задіяний один фонд
        generate_bills(2026, 1)
        funds = set(
            SupplierBill.objects.filter(
                supplier_contract=self.contract, period__month=1,
            ).values_list('fund', flat=True)
        )
        self.assertEqual(funds, {Fund.SPECIAL, Fund.GENERAL})

    def test_debt_carryover_does_not_mix_funds(self):
        # Борг переноситься всередині свого фонду. Цифри — з реального акта
        # Київводоканалу: спец. 42 198,13 / загальний 60 729,51
        generate_bills(2026, 1)
        spec = self._bill(1)
        spec.accrued_amount = Decimal('42198.13')
        spec.save()
        general = self._bill(1, fund=Fund.GENERAL)
        general.accrued_amount = Decimal('60729.51')
        general.save()

        generate_bills(2026, 2)
        self.assertEqual(self._bill(2).debt_start, Decimal('42198.13'))
        self.assertEqual(
            self._bill(2, fund=Fund.GENERAL).debt_start, Decimal('60729.51'),
        )

    def test_suppliers_lock_skips_supplier_generation(self):
        # B3: месяц, закрытый для поставщиков, пропускается целиком —
        # и попадает в свой отчётный список, отдельный от арендаторского
        closed = BillingPeriod.objects.create(year=2026, month=7)
        PeriodLock.objects.create(period=closed, scope=LockScope.SUPPLIERS)

        result = generate_bills(2026, 7)
        self.assertEqual(result.supplier_skipped_closed, [7])
        self.assertEqual(result.skipped_closed, [])  # арендаторы открыты
        self.assertEqual(result.supplier_created, 0)
        self.assertFalse(
            SupplierBill.objects.filter(period__month=7).exists()
        )

    def test_closed_period_skips_tenant_but_creates_supplier(self):
        # Главный тест решения: закрытый период пропускает арендаторов,
        # но записи поставщика создаются (фича выезжает середина года —
        # прошлые месяцы уже закрыты, а поставщика надо заполнить задним числом)
        closed = BillingPeriod.objects.create(year=2026, month=5)
        PeriodLock.objects.create(period=closed, scope=LockScope.TENANTS)
        tenant = Tenant.objects.create(name='ТОВ Оренда (ген)')
        t_contract = Contract.objects.create(
            tenant=tenant, contract_number='А-1', address='вул. Тестова, 2',
            area_size='50.00', date_start=date(2026, 1, 1),
        )
        ContractService.objects.create(contract=t_contract, service=self.service)

        result = generate_bills(2026, 5)
        self.assertEqual(result.skipped_closed, [5])
        self.assertEqual(result.created, 0)          # арендатор пропущен
        self.assertEqual(result.supplier_created, 2)  # поставщик создан (2 фонда)
        self.assertTrue(
            SupplierBill.objects.filter(
                supplier_contract=self.contract, period__month=5,
            ).exists()
        )

    def test_service_id_filter_applies_to_suppliers(self):
        other_service = _make_service('Газ (ген)')
        SupplierContract.objects.create(
            supplier=self.supplier, service=other_service,
            number='Г-2', date_start=date(2026, 1, 1),
        )
        result = generate_bills(2026, 1, service_id=self.service.id)
        self.assertEqual(result.supplier_created, 2)  # 1 договір x 2 фонди
        self.assertEqual(
            SupplierBill.objects.filter(supplier_contract__service=other_service).count(), 0,
        )

    def test_two_suppliers_same_service_both_generated(self):
        # Декілька постачальників одночасно на одну послугу (рішення клієнта
        # 2026-09-02) — генерація створює запис для кожного, з тим самим
        # спільним тарифом послуги
        second_supplier = Supplier.objects.create(name='Аква-Сервіс (ген)')
        second_contract = SupplierContract.objects.create(
            supplier=second_supplier, service=self.service,
            number='Г-3', date_start=date(2026, 1, 1), date_end=None,
        )
        result = generate_bills(2026, 1)
        self.assertEqual(result.supplier_created, 4)  # 2 договори x 2 фонди
        self.assertEqual(self._bill(1).rate, Decimal('10'))
        self.assertEqual(self._bill(1, second_contract).rate, Decimal('10'))

    def test_update_rates_rewrites_rate_and_accrued(self):
        generate_bills(2026, 4)
        bill = self._bill(4)
        bill.quantity = Decimal('27.444')
        bill.accrued_amount = Decimal('274.44')
        bill.save()
        # Задним числом добавили тариф, действующий с апреля
        ServiceRate.objects.create(
            service=self.service, rate=Decimal('13.75'), effective_from=date(2026, 4, 1),
        )

        result = generate_bills(2026, 4, update_rates=True)
        # Тариф спільний — оновлюється в обох фондах
        self.assertEqual(result.supplier_updated_rates, 2)
        bill.refresh_from_db()
        self.assertEqual(bill.rate, Decimal('13.75'))
        # half-up: 27.444 × 13.75 = 377.3549... → 377.35... квантизуется до 0.01
        self.assertEqual(bill.accrued_amount, Decimal('377.36'))

    def test_update_rates_preserves_manual_accrual(self):
        # Ручне нарахування (is_manual_accrual) захищене від перезапису при
        # --update-rates: тариф оновлюється, accrued_amount лишається як увів бухгалтер
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
        # Тариф спільний — оновлюється в обох фондах
        self.assertEqual(result.supplier_updated_rates, 2)
        bill.refresh_from_db()
        self.assertEqual(bill.rate, Decimal('13.75'))
        self.assertEqual(bill.accrued_amount, Decimal('0'))
        self.assertTrue(bill.is_manual_accrual)

    def test_update_rates_skips_when_unchanged(self):
        # Тариф не изменился → early-exit, нарах. не трогается (та же семантика,
        # что у арендаторов — задокументированное ограничение)
        generate_bills(2026, 6)
        bill = self._bill(6)
        bill.accrued_amount = Decimal('999.99')  # ручной ввод суммы
        bill.save()

        result = generate_bills(2026, 6, update_rates=True)
        self.assertEqual(result.supplier_updated_rates, 0)
        self.assertEqual(result.supplier_skipped_existing, 2)
        bill.refresh_from_db()
        self.assertEqual(bill.accrued_amount, Decimal('999.99'))

    def test_contract_date_bounds(self):
        # Договор, закончившийся до месяца, и начинающийся после — не генерятся
        ended = SupplierContract.objects.create(
            supplier=self.supplier, service=_make_service('Світло (ген)'),
            number='Г-3', date_start=date(2025, 1, 1), date_end=date(2025, 12, 31),
        )
        future = SupplierContract.objects.create(
            supplier=self.supplier, service=_make_service('Сміття (ген)'),
            number='Г-4', date_start=date(2026, 9, 1),
        )
        generate_bills(2026, 7)
        self.assertFalse(SupplierBill.objects.filter(supplier_contract=ended).exists())
        self.assertFalse(SupplierBill.objects.filter(supplier_contract=future).exists())

    def test_supplier_change_starts_with_zero_debt(self):
        # Смена поставщика: долг числится за старым договором, новый стартует с 0
        service = _make_service('Опалення (ген)')
        old = SupplierContract.objects.create(
            supplier=self.supplier, service=service,
            number='Г-5', date_start=date(2026, 1, 1), date_end=date(2026, 1, 31),
        )
        new_supplier = Supplier.objects.create(name='Нове Тепло')
        new = SupplierContract.objects.create(
            supplier=new_supplier, service=service,
            number='Г-6', date_start=date(2026, 2, 1),
        )
        generate_bills(2026, 1, service_id=service.id)
        old_bill = self._bill(1, contract=old)
        old_bill.accrued_amount = Decimal('500')
        old_bill.save()

        generate_bills(2026, 2, service_id=service.id)
        self.assertEqual(self._bill(2, contract=new).debt_start, Decimal('0'))

    def test_tenant_counters_unchanged(self):
        # Регрессия: генерация арендаторов считает так же, как раньше
        tenant = Tenant.objects.create(name='ТОВ Лічильники')
        t_contract = Contract.objects.create(
            tenant=tenant, contract_number='А-2', address='вул. Тестова, 3',
            area_size='70.00', date_start=date(2026, 1, 1),
        )
        ContractService.objects.create(contract=t_contract, service=self.service)

        result = generate_bills(2026, 8)
        self.assertEqual(result.created, 1)           # 1 арендаторский счёт
        self.assertEqual(result.supplier_created, 2)  # 1 договір x 2 фонди
        result2 = generate_bills(2026, 8)
        self.assertEqual(result2.skipped_existing, 1)
        self.assertEqual(result2.supplier_skipped_existing, 2)


class SupplierFundPlanApiTests(APITestCase):
    """Годовой план фонда: год разделяет планы (ради этого отдельная таблица),
    уникальность (договор, год, фонд), фильтры для «Рахунків»."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('planner', password='x')
        cls.service = _make_service('Вода (план)')
        cls.supplier = Supplier.objects.create(name='Водоканал (план)')
        # Бессрочный договор — именно из-за него план привязан к году
        cls.contract = SupplierContract.objects.create(
            supplier=cls.supplier, service=cls.service,
            number='ПЛ-1', date_start=date(2026, 1, 1), date_end=None,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.user)

    def _post(self, **kwargs):
        data = {
            'supplier_contract_id': self.contract.id,
            'year': 2026,
            'fund': Fund.SPECIAL,
            'planned_amount': '42198.13',
            'planned_volume': '1145.09',
        }
        data.update(kwargs)
        return self.client.post(PLANS_URL, data, format='json')

    def test_create(self):
        resp = self._post()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['service_id'], self.service.id)
        self.assertEqual(Decimal(resp.data['planned_amount']), Decimal('42198.13'))

    def test_amount_without_volume_allowed(self):
        # В таблице сумму и объём вводят по отдельности — запись создаётся
        # по первому введённому полю, второе пока пустое
        resp = self._post(planned_volume=None)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(resp.data['planned_volume'])

    def test_duplicate_rejected_as_400(self):
        self._post()
        resp = self._post(planned_amount='1.00')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_same_year_other_fund_allowed(self):
        self._post()
        resp = self._post(fund=Fund.GENERAL, planned_amount='60729.51')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_plan_does_not_leak_into_next_year(self):
        # Гвоздь дизайна: план 2026 не подтягивается в 2027
        self._post()
        resp = self.client.get(PLANS_URL, {'service_id': self.service.id, 'year': 2027})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data, [])
        resp = self.client.get(PLANS_URL, {'service_id': self.service.id, 'year': 2026})
        self.assertEqual(len(resp.data), 1)

    def test_filter_by_service(self):
        self._post()
        other = _make_service('Газ (план)')
        other_contract = SupplierContract.objects.create(
            supplier=self.supplier, service=other,
            number='ПЛ-2', date_start=date(2026, 1, 1),
        )
        SupplierFundPlan.objects.create(
            supplier_contract=other_contract, year=2026, fund=Fund.SPECIAL,
        )
        resp = self.client.get(PLANS_URL, {'service_id': self.service.id})
        self.assertEqual(
            [p['supplier_contract_id'] for p in resp.data], [self.contract.id],
        )

    def test_patch_amount(self):
        plan_id = self._post().data['id']
        resp = self.client.patch(
            f'{PLANS_URL}{plan_id}/', {'planned_amount': '50000.00'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(resp.data['planned_amount']), Decimal('50000.00'))
