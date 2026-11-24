# Тесты замков периода (PeriodLock): закрытие стало фактом про пару
# «период + сущность», а не флагом на периоде.
#
# Запуск (PowerShell): $env:DB_ENGINE="django.db.backends.sqlite3"; python manage.py test rentals
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APITestCase

from rentals.models import BillingPeriod, LockScope, PeriodLock

User = get_user_model()


class PeriodLockModelTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.period = BillingPeriod.objects.create(year=2026, month=3)

    def test_period_open_without_lock(self):
        self.assertFalse(self.period.is_closed)
        self.assertIsNone(self.period.closed_by)
        self.assertIsNone(self.period.closed_at)

    def test_tenants_lock_closes_period(self):
        user = User.objects.create_user('buh', password='x')
        PeriodLock.objects.create(period=self.period, scope=LockScope.TENANTS, closed_by=user)

        self.assertTrue(self.period.is_closed)
        self.assertEqual(self.period.closed_by, user)
        self.assertIsNotNone(self.period.closed_at)

    def test_supplier_lock_does_not_close_tenants(self):
        # Главное свойство фичи: замки сущностей независимы
        PeriodLock.objects.create(period=self.period, scope=LockScope.SUPPLIERS)

        self.assertTrue(self.period.is_closed_for(LockScope.SUPPLIERS))
        self.assertFalse(self.period.is_closed)

    def test_duplicate_lock_rejected(self):
        PeriodLock.objects.create(period=self.period, scope=LockScope.TENANTS)
        with self.assertRaises(IntegrityError), transaction.atomic():
            PeriodLock.objects.create(period=self.period, scope=LockScope.TENANTS)


class PeriodCloseApiTests(APITestCase):
    """Поведение endpoint'ов не изменилось — сменилось только хранение."""

    @classmethod
    def setUpTestData(cls):
        cls.accountant = User.objects.create_user('buh', password='x', is_staff=True)
        cls.manager = User.objects.create_user('man', password='x')
        cls.period = BillingPeriod.objects.create(year=2026, month=4)

    def test_close_creates_tenants_lock(self):
        self.client.force_authenticate(self.accountant)
        response = self.client.post(f'/api/periods/{self.period.id}/close/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['is_closed'])
        self.assertEqual(response.data['closed_by'], self.accountant.id)
        lock = PeriodLock.objects.get(period=self.period)
        self.assertEqual(lock.scope, LockScope.TENANTS)
        self.assertEqual(lock.closed_by, self.accountant)

    def test_close_twice_rejected(self):
        self.client.force_authenticate(self.accountant)
        self.client.post(f'/api/periods/{self.period.id}/close/')
        response = self.client.post(f'/api/periods/{self.period.id}/close/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(PeriodLock.objects.count(), 1)

    def test_reopen_removes_lock(self):
        PeriodLock.objects.create(period=self.period, scope=LockScope.TENANTS)
        self.client.force_authenticate(self.accountant)
        response = self.client.post(f'/api/periods/{self.period.id}/reopen/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['is_closed'])
        self.assertFalse(PeriodLock.objects.exists())

    def test_manager_cannot_close(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/periods/{self.period.id}/close/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(PeriodLock.objects.exists())


class PeriodCloseByScopeTests(APITestCase):
    """B2: close/reopen по сущности. Замки независимы: закрытие поставщиков
    не закрывает арендаторов и наоборот."""

    @classmethod
    def setUpTestData(cls):
        cls.accountant = User.objects.create_user('buh2', password='x', is_staff=True)
        cls.period = BillingPeriod.objects.create(year=2026, month=5)

    def setUp(self):
        self.client.force_authenticate(self.accountant)

    def _post(self, action, scope=None):
        body = {'scope': scope} if scope else {}
        return self.client.post(
            f'/api/periods/{self.period.id}/{action}/', body, format='json',
        )

    def test_close_suppliers_leaves_tenants_open(self):
        response = self._post('close', LockScope.SUPPLIERS)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # is_closed — это арендаторы (совместимость со старым фронтом)
        self.assertFalse(response.data['is_closed'])
        self.assertIsNotNone(response.data['locks']['suppliers'])
        self.assertIsNone(response.data['locks']['tenants'])
        self.assertEqual(
            response.data['locks']['suppliers']['closed_by'], self.accountant.id,
        )

    def test_both_scopes_can_be_closed(self):
        self._post('close', LockScope.TENANTS)
        response = self._post('close', LockScope.SUPPLIERS)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(PeriodLock.objects.filter(period=self.period).count(), 2)

    def test_close_same_scope_twice_rejected(self):
        self._post('close', LockScope.SUPPLIERS)
        response = self._post('close', LockScope.SUPPLIERS)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reopen_suppliers_keeps_tenants_lock(self):
        self._post('close', LockScope.TENANTS)
        self._post('close', LockScope.SUPPLIERS)
        response = self._post('reopen', LockScope.SUPPLIERS)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['is_closed'])  # арендаторы всё ещё закрыты
        self.assertIsNone(response.data['locks']['suppliers'])

    def test_without_scope_means_tenants(self):
        # Старый фронт шлёт close без тела — должен закрыть арендаторов
        response = self._post('close')
        self.assertTrue(response.data['is_closed'])
        self.assertEqual(PeriodLock.objects.get().scope, LockScope.TENANTS)

    def test_unknown_scope_rejected(self):
        response = self._post('close', 'nonsense')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PeriodLock.objects.exists())

    def test_landlords_not_closable_yet(self):
        # Вкладки «Орендодавці» ещё нет — замок никто бы не проверял
        response = self._post('close', LockScope.LANDLORDS)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PeriodLock.objects.exists())

    def test_list_reports_locks_per_scope(self):
        self._post('close', LockScope.SUPPLIERS)
        response = self.client.get('/api/periods/')
        period = next(p for p in response.data if p['id'] == self.period.id)
        self.assertEqual(set(period['locks']), set(LockScope.values))
        self.assertIsNotNone(period['locks']['suppliers'])
