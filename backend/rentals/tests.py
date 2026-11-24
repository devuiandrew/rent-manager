# Тесты фичи «Договір відшкодування» — первые тесты проекта.
#
# Запуск (Git Bash):   DB_ENGINE=django.db.backends.sqlite3 python manage.py test rentals
# Запуск (PowerShell): $env:DB_ENGINE="django.db.backends.sqlite3"; python manage.py test rentals
# Переопределение движка нужно потому, что у rent_user нет права CREATEDB в Postgres
# (тест-раннер создаёт временную БД). Альтернатива — одноразово выполнить от postgres:
# ALTER USER rent_user CREATEDB;  — тогда тесты пойдут и на Postgres без переменной.
#
# Как это работает:
# - `python manage.py test rentals` создаёт ВРЕМЕННУЮ пустую БД (test_<имя>),
#   прогоняет все миграции, выполняет тесты и удаляет БД. Реальные данные не трогаются.
# - Каждый test_* метод выполняется в транзакции с откатом — тесты не влияют друг на друга.
# - setUpTestData() создаёт общие объекты ОДИН раз на класс (быстрее, чем setUp,
#   который выполняется перед каждым тестом).
# - APITestCase — TestCase с клиентом DRF: делает настоящие HTTP-запросы через роутер.
#   force_authenticate() подставляет пользователя, минуя JWT — авторизацию проверяем
#   отдельно (test_unauthenticated_401), а бизнес-логику — без возни с токенами.
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from rentals.models import Tenant, Contract, ReimbursementContract

User = get_user_model()

URL = '/api/reimbursement-contracts/'


def _make_contract(tenant, number, **kwargs):
    """Хелпер: договор с обязательными полями по умолчанию."""
    defaults = {
        'address': 'вул. Тестова, 1',
        'area_size': '100.00',
        'date_start': date(2025, 1, 1),
    }
    defaults.update(kwargs)
    return Contract.objects.create(tenant=tenant, contract_number=number, **defaults)


class ReimbursementForModelTests(APITestCase):
    """Contract.reimbursement_for(date) — резолв документа по дате."""

    @classmethod
    def setUpTestData(cls):
        cls.tenant = Tenant.objects.create(name='ТОВ Тест')
        cls.contract = _make_contract(cls.tenant, '101')
        # Два последовательных года документов — история без пересечений
        cls.doc_2025 = ReimbursementContract.objects.create(
            number='В-2025', date_start=date(2025, 8, 1), date_end=date(2026, 7, 31),
        )
        cls.doc_2025.contracts.add(cls.contract)
        cls.doc_2026 = ReimbursementContract.objects.create(
            number='В-2026', date_start=date(2026, 8, 1), date_end=date(2027, 7, 31),
        )
        cls.doc_2026.contracts.add(cls.contract)

    def test_boundary_dates_inclusive(self):
        # Границы периода входят в него (обе даты включительно)
        self.assertEqual(self.contract.reimbursement_for(date(2025, 8, 1)), self.doc_2025)
        self.assertEqual(self.contract.reimbursement_for(date(2026, 7, 31)), self.doc_2025)

    def test_resolves_correct_year(self):
        # Середина каждого периода — свой документ
        self.assertEqual(self.contract.reimbursement_for(date(2026, 1, 15)), self.doc_2025)
        self.assertEqual(self.contract.reimbursement_for(date(2026, 12, 15)), self.doc_2026)

    def test_outside_any_period(self):
        # До первого документа и после последнего — None
        self.assertIsNone(self.contract.reimbursement_for(date(2025, 7, 31)))
        self.assertIsNone(self.contract.reimbursement_for(date(2027, 8, 1)))

    def test_contract_without_documents(self):
        other = _make_contract(self.tenant, '102')
        self.assertIsNone(other.reimbursement_for(date(2026, 1, 1)))


class ReimbursementValidationTests(APITestCase):
    """Валидация пересечения периодов — через реальные POST/PATCH к API."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('tester', password='x')
        cls.tenant = Tenant.objects.create(name='ТОВ Валідація')
        cls.contract = _make_contract(cls.tenant, '201')
        cls.existing = ReimbursementContract.objects.create(
            number='В-1', date_start=date(2026, 1, 1), date_end=date(2026, 12, 31),
        )
        cls.existing.contracts.add(cls.contract)

    def setUp(self):
        # force_authenticate вешается на клиент, а клиент создаётся заново на каждый тест
        self.client.force_authenticate(user=self.user)

    def _payload(self, **kwargs):
        data = {
            'number': 'В-2',
            'date_start': '2026-06-01',
            'date_end': '2027-05-31',
            'note': '',
            'contract_ids': [self.contract.id],
        }
        data.update(kwargs)
        return data

    def test_overlap_rejected(self):
        # Период пересекается с существующим В-1 → 400 с понятным текстом
        resp = self.client.post(URL, self._payload(), format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        # Ошибка validate() попадает в non_field_errors — проверяем содержание
        msg = str(resp.data)
        self.assertIn('201', msg)   # номер договора
        self.assertIn('В-1', msg)   # номер конфликтующего документа

    def test_adjacent_periods_allowed(self):
        # Смежные периоды (старый кончился 31.12, новый с 01.01) — НЕ пересечение
        resp = self.client.post(
            URL,
            self._payload(date_start='2027-01-01', date_end='2027-12-31'),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_end_before_start_rejected(self):
        resp = self.client.post(
            URL,
            self._payload(date_start='2027-06-01', date_end='2027-01-01'),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('раніше дати початку', str(resp.data))

    def test_patch_does_not_conflict_with_self(self):
        # Сдвиг дат самого документа не должен ловить конфликт с собой (exclude pk)
        resp = self.client.patch(
            f'{URL}{self.existing.id}/',
            {'date_end': '2026-11-30'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_patch_partial_still_validates_overlap(self):
        # PATCH без contract_ids: договоры берутся из instance, пересечение всё равно ловится
        other_doc = ReimbursementContract.objects.create(
            number='В-3', date_start=date(2027, 1, 1), date_end=date(2027, 12, 31),
        )
        other_doc.contracts.add(self.contract)
        # Пытаемся растянуть В-1 до марта 2027 — влезает в период В-3
        resp = self.client.patch(
            f'{URL}{self.existing.id}/',
            {'date_end': '2027-03-01'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('В-3', str(resp.data))

    def test_history_without_overlap_allowed(self):
        # Один договор в двух документах с РАЗНЫМИ периодами — это норма (история по годам)
        resp = self.client.post(
            URL,
            self._payload(number='В-4', date_start='2028-01-01', date_end='2028-12-31'),
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)


class ReimbursementApiTests(APITestCase):
    """CRUD-поведение эндпоинта: авторизация, создание, фильтр, вычисляемые поля."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('apitester', password='x')
        cls.tenant_a = Tenant.objects.create(name='Орендар А')
        cls.tenant_b = Tenant.objects.create(name='Орендар Б')
        cls.contract_a = _make_contract(cls.tenant_a, '301')
        cls.contract_b = _make_contract(cls.tenant_b, '302')

    def setUp(self):
        self.client.force_authenticate(user=self.user)

    def test_unauthenticated_401(self):
        # Все /api/ кроме /auth/ закрыты JWT — без токена 401
        self.client.force_authenticate(user=None)
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_links_contracts_and_author(self):
        resp = self.client.post(
            URL,
            {
                'number': 'В-10',
                'date_start': '2026-01-01',
                'date_end': '2026-12-31',
                'contract_ids': [self.contract_a.id, self.contract_b.id],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        doc = ReimbursementContract.objects.get(pk=resp.data['id'])
        # M2M слинкован, created_by проставлен через perform_create
        self.assertEqual(doc.contracts.count(), 2)
        self.assertEqual(doc.created_by, self.user)

    def test_contracts_info_content(self):
        doc = ReimbursementContract.objects.create(
            number='В-11', date_start=date(2026, 1, 1), date_end=date(2026, 12, 31),
        )
        doc.contracts.add(self.contract_a)
        resp = self.client.get(f'{URL}{doc.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['contracts_info'], [{
            'id': self.contract_a.id,
            'contract_number': '301',
            'tenant_name': 'Орендар А',
        }])

    def test_filter_by_contract_id(self):
        doc_a = ReimbursementContract.objects.create(
            number='В-12', date_start=date(2026, 1, 1), date_end=date(2026, 12, 31),
        )
        doc_a.contracts.add(self.contract_a)
        doc_b = ReimbursementContract.objects.create(
            number='В-13', date_start=date(2026, 1, 1), date_end=date(2026, 12, 31),
        )
        doc_b.contracts.add(self.contract_b)
        resp = self.client.get(f'{URL}?contract_id={self.contract_a.id}')
        numbers = [d['number'] for d in resp.data]
        self.assertEqual(numbers, ['В-12'])


class ContractResolvedNumberTests(APITestCase):
    """ContractSerializer.reimbursement_number — номер действующего сегодня документа."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('resolver', password='x')
        cls.tenant = Tenant.objects.create(name='ТОВ Резолв')
        cls.contract = _make_contract(cls.tenant, '401')
        today = date.today()
        # Прошлогодний документ (закончился) и действующий сейчас
        cls.old_doc = ReimbursementContract.objects.create(
            number='СТАРИЙ',
            date_start=today - timedelta(days=730),
            date_end=today - timedelta(days=366),
        )
        cls.old_doc.contracts.add(cls.contract)
        cls.current_doc = ReimbursementContract.objects.create(
            number='ЧИННИЙ',
            date_start=today - timedelta(days=30),
            date_end=today + timedelta(days=300),
        )
        cls.current_doc.contracts.add(cls.contract)

    def setUp(self):
        self.client.force_authenticate(user=self.user)

    def test_resolves_current_document(self):
        resp = self.client.get(f'/api/contracts/{self.contract.id}/')
        self.assertEqual(resp.data['reimbursement_number'], 'ЧИННИЙ')

    def test_empty_when_no_active_document(self):
        other = _make_contract(self.tenant, '402')
        resp = self.client.get(f'/api/contracts/{other.id}/')
        self.assertEqual(resp.data['reimbursement_number'], '')
