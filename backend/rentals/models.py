from datetime import date
from decimal import Decimal
from django.conf import settings
from django.db import models
from django.utils import timezone


class Tenant(models.Model):
    """Орендар — юридична або фізична особа."""
    name = models.CharField(max_length=200, verbose_name='Назва')
    tax_id = models.CharField(max_length=20, blank=True, verbose_name='ЄДРПОУ/ІПН')
    phone = models.CharField(max_length=30, blank=True, verbose_name='Телефон')
    email = models.EmailField(blank=True)
    contact_person = models.CharField(max_length=100, blank=True, verbose_name='Контактна особа')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Орендар'
        verbose_name_plural = 'Орендарі'

    def __str__(self):
        return self.name


class Contract(models.Model):
    """Договір оренди приміщення."""
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='contracts')
    contract_number = models.CharField(max_length=50, verbose_name='Номер договору')
    address = models.CharField(max_length=300, verbose_name='Адреса')
    area_size = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='Площа, м²')
    date_start = models.DateField(verbose_name='Дата початку')
    date_end = models.DateField(null=True, blank=True, verbose_name='Дата закінчення')
    is_active = models.BooleanField(default=True, verbose_name='Активний')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date_start']
        verbose_name = 'Договір'
        verbose_name_plural = 'Договори'

    def reimbursement_for(self, on_date: date):
        """Договір відшкодування, чинний на вказану дату, або None.

        Періоди відшкодувань одного договору не перетинаються (валідація
        в серіалізаторі) — тому збігів максимум один.
        """
        # Python-цикл замість .filter() — щоб працював prefetch_related('reimbursements')
        # у списках (інакше N+1 запитів)
        for doc in self.reimbursements.all():
            if doc.date_start <= on_date <= doc.date_end:
                return doc
        return None

    def __str__(self):
        return f'{self.contract_number} — {self.tenant.name}'


class ReimbursementContract(models.Model):
    """Договір відшкодування — документ на період (~рік), що покриває
    один або кілька договорів оренди (у т.ч. різних орендарів).

    Щороку перезаключається — тому в одного договору оренди з часом
    накопичується історія документів. Періоди документів одного договору
    не можуть перетинатися (валідація в серіалізаторі). Статус
    (діючий/майбутній/минулий) виводиться з дат, окремого прапорця немає.
    """
    number = models.CharField(max_length=50, verbose_name='Номер')
    date_start = models.DateField(verbose_name='Дата початку')
    date_end = models.DateField(verbose_name='Дата закінчення')
    note = models.CharField(max_length=200, blank=True, verbose_name='Примітка')
    contracts = models.ManyToManyField(
        Contract, related_name='reimbursements', blank=True,
        verbose_name='Договори оренди',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_reimbursements',
    )

    class Meta:
        ordering = ['-date_start']
        verbose_name = 'Договір відшкодування'
        verbose_name_plural = 'Договори відшкодування'

    @classmethod
    def overlap_error(cls, contracts, date_start, date_end, exclude_pk=None):
        """Текст ошибки, если период пересекается с другим документом
        какого-либо из договоров, иначе None.

        Инвариант «периоды одного договора не пересекаются» держит резолв
        reimbursement_for (совпадений максимум одно), поэтому проверка общая
        для API-сериализатора и Django admin. Интервалы пересекаются,
        если s1 <= e2 и e1 >= s2 — один запрос сразу на все договоры.
        """
        qs = cls.objects.filter(
            contracts__in=contracts,
            date_start__lte=date_end,
            date_end__gte=date_start,
        )
        if exclude_pk is not None:
            qs = qs.exclude(pk=exclude_pk)
        # values по тому же M2M-пути — join фильтра переиспользуется,
        # поэтому contract_number принадлежит именно конфликтующей паре
        conflict = qs.values(
            'number', 'date_start', 'date_end', 'contracts__contract_number',
        ).first()
        if conflict is None:
            return None
        return (
            f'Договір {conflict["contracts__contract_number"]} вже покритий відшкодуванням '
            f'«{conflict["number"]}» ({conflict["date_start"].strftime("%d.%m.%Y")} — '
            f'{conflict["date_end"].strftime("%d.%m.%Y")}). '
            f'Періоди не можуть перетинатися.'
        )

    def __str__(self):
        return f'{self.number} ({self.date_start} — {self.date_end})'


class Service(models.Model):
    """Комунальна послуга (вода, газ, опалення тощо)."""
    name = models.CharField(max_length=100, unique=True, verbose_name='Назва')
    unit_name = models.CharField(max_length=20, verbose_name='Одиниця виміру')
    default_rate = models.DecimalField(
        max_digits=18, decimal_places=9, default=Decimal('0'),
        verbose_name='Тариф за замовчуванням',
    )
    color = models.CharField(max_length=7, blank=True, help_text='Hex, напр. #3b82f6')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Послуга'
        verbose_name_plural = 'Послуги'

    def rate_on(self, on_date: date) -> Decimal:
        """Тариф, що діє на вказану дату (остання зміна з effective_from <= on_date).

        Джерело істини — історія ServiceRate. default_rate лишається fallback
        для послуг без жодного запису історії.
        """
        rate_row = (
            self.rates.filter(effective_from__lte=on_date)
            .order_by('-effective_from')
            .first()
        )
        return rate_row.rate if rate_row else self.default_rate

    @property
    def current_rate(self) -> Decimal:
        """Тариф, що діє сьогодні (для відображення в UI)."""
        return self.rate_on(date.today())

    @property
    def upcoming_rate_change(self):
        """Найближча майбутня зміна тарифу (effective_from > сьогодні) або None."""
        return (
            self.rates.filter(effective_from__gt=date.today())
            .order_by('effective_from')
            .first()
        )

    def __str__(self):
        return self.name


class ServiceRate(models.Model):
    """Тариф послуги, що діє з певної дати. Історія змін тарифу.

    При зміні тарифу послуги (напр. подорожчання води) додається новий запис
    з датою початку дії — він застосовується до всіх договорів, що використовують
    тариф за замовчуванням. Старі рахунки не зачіпаються (вони зберігають копію
    тарифу в Bill.rate на момент генерації).
    """
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='rates')
    rate = models.DecimalField(max_digits=18, decimal_places=9, verbose_name='Тариф')
    effective_from = models.DateField(verbose_name='Діє з')
    note = models.CharField(max_length=200, blank=True, verbose_name='Примітка')

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_service_rates',
    )

    class Meta:
        # Один тариф на дату для послуги — інакше неоднозначність "яка ставка діє"
        unique_together = (('service', 'effective_from'),)
        ordering = ['-effective_from']
        verbose_name = 'Тариф послуги'
        verbose_name_plural = 'Тарифи послуг'

    def __str__(self):
        return f'{self.service.name}: {self.rate} з {self.effective_from}'


class ContractService(models.Model):
    """Зв'язок договір↔послуга з опціональним персональним тарифом."""
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='contract_services')
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='contract_services')
    personal_rate = models.DecimalField(
        max_digits=18, decimal_places=9, null=True, blank=True,
        help_text='Якщо вказано — перекриває default_rate послуги',
    )
    is_active = models.BooleanField(default=True)

    # Річний план за договором (вводиться вручну). Гроші — 2 знаки, обсяг — 9 (як quantity).
    # «Сума за договором» / «Обсяг за договором» — раніше були обчислюваними, тепер ручні.
    planned_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        verbose_name='Сума за договором (план)',
    )
    planned_volume = models.DecimalField(
        max_digits=18, decimal_places=9, null=True, blank=True,
        verbose_name='Обсяг за договором (план)',
    )

    class Meta:
        unique_together = (('contract', 'service'),)
        verbose_name = 'Послуга договору'
        verbose_name_plural = 'Послуги договорів'

    def rate_for(self, on_date: date) -> Decimal:
        """Тариф на вказану дату: персональний override або тариф послуги на цю дату.

        Використовується при генерації рахунків — береться тариф, що діяв у місяці
        нарахування (а не поточний).
        """
        if self.personal_rate is not None:
            return self.personal_rate
        return self.service.rate_on(on_date)

    @property
    def effective_rate(self) -> Decimal:
        """Тариф, який реально застосовується сьогодні (для відображення)."""
        return self.rate_for(date.today())

    def __str__(self):
        return f'{self.contract.contract_number} — {self.service.name}'


class LockScope(models.TextChoices):
    """Сутність, по якій закривається період.

    Закриття — це факт не про період, а про пару «період + сутність»:
    рахунки орендарів бухгалтер закриває в одному ритмі, дані постачальників
    приходять заднім числом за 1-2 місяці й закриваються пізніше.
    """
    TENANTS = 'tenants', 'Орендарі'
    SUPPLIERS = 'suppliers', 'Постачальники'
    LANDLORDS = 'landlords', 'Орендодавці'


class BillingPeriod(models.Model):
    """Розрахунковий період (місяць). Закритий період редагувати не можна."""
    year = models.IntegerField()
    month = models.IntegerField()

    class Meta:
        unique_together = (('year', 'month'),)
        ordering = ['-year', '-month']
        verbose_name = 'Розрахунковий період'
        verbose_name_plural = 'Розрахункові періоди'

    def lock_for(self, scope):
        """Замок по вказаній сутності або None, якщо період для неї відкритий."""
        # Перебір по .all(), а не .filter(): список періодів тягнеться з
        # prefetch_related('locks'), і фільтр у БД зводив би prefetch нанівець.
        # Ціна — кеш на інстансі: після зміни замків потрібен refresh_from_db().
        for lock in self.locks.all():
            if lock.scope == scope:
                return lock
        return None

    def is_closed_for(self, scope) -> bool:
        return self.lock_for(scope) is not None

    # Совместимость: без scope — речь об арендаторах. Внутри бэкенда все
    # проверки уже идут через is_closed_for(scope). Свойство НЕ удалять, пока
    # поля is_closed/closed_by/closed_at отдаёт API: Electron-клиенты у
    # пользователей обновляются не одновременно с сервером, старый клиент
    # читает is_closed
    @property
    def is_closed(self) -> bool:
        return self.is_closed_for(LockScope.TENANTS)

    @property
    def closed_by(self):
        lock = self.lock_for(LockScope.TENANTS)
        return lock.closed_by if lock else None

    @property
    def closed_at(self):
        lock = self.lock_for(LockScope.TENANTS)
        return lock.closed_at if lock else None

    def __str__(self):
        suffix = ' [закрито]' if self.is_closed else ''
        return f'{self.year}-{self.month:02d}{suffix}'


class PeriodLock(models.Model):
    """Замок періоду по одній сутності. Немає рядка — період для неї відкритий."""
    period = models.ForeignKey(BillingPeriod, on_delete=models.CASCADE, related_name='locks')
    scope = models.CharField(max_length=20, choices=LockScope.choices, verbose_name='Сутність')
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='period_locks',
    )
    # default, а не auto_now_add: міграція переносить historical closed_at зі старих полів
    closed_at = models.DateTimeField(default=timezone.now, verbose_name='Закрито о')

    class Meta:
        unique_together = (('period', 'scope'),)
        ordering = ['period', 'scope']
        verbose_name = 'Замок періоду'
        verbose_name_plural = 'Замки періодів'

    def __str__(self):
        return f'{self.period} — {self.get_scope_display()}'


class Bill(models.Model):
    """Місячне нарахування за послугу по договору."""
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name='bills')
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='bills')
    period = models.ForeignKey(BillingPeriod, on_delete=models.PROTECT, related_name='bills')

    # Snapshot полів — фіксуються на момент створення
    debt_start = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                     verbose_name='Борг на початок')
    quantity = models.DecimalField(max_digits=18, decimal_places=9, default=Decimal('0'),
                                   verbose_name='Кількість')
    rate = models.DecimalField(max_digits=18, decimal_places=9, default=Decimal('0'),
                               verbose_name='Тариф')
    accrued_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                         verbose_name='Нараховано')
    # Нарахування вручну (2026-09): бухгалтер вводить accrued_amount напряму,
    # тоді генерація/перегенерація тарифів його не перезаписує (quantity×rate
    # лишається довідковою величиною — колонка «Спожито» на фронті)
    is_manual_accrual = models.BooleanField(default=False, verbose_name='Нарах. вручну')
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                      verbose_name='Сплачено')
    correction = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                     verbose_name='Корекція')

    # Двохрольова робота: оператор вводить, бухгалтер перевіряє
    is_verified = models.BooleanField(default=False, verbose_name='Перевірено')
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='verified_bills',
    )
    verified_at = models.DateTimeField(null=True, blank=True)

    # Аудит
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_bills',
    )

    class Meta:
        unique_together = (('contract', 'service', 'period'),)
        ordering = ['-period__year', '-period__month']
        verbose_name = 'Рахунок'
        verbose_name_plural = 'Рахунки'

    @property
    def total_debt_end(self) -> Decimal:
        """Борг на кінець періоду = (вхідний борг + нараховано + корекція) - сплачено."""
        return (self.debt_start + self.accrued_amount + self.correction) - self.paid_amount

    def __str__(self):
        return f'{self.contract.contract_number} / {self.service.name} / {self.period}'


class Supplier(models.Model):
    """Постачальник послуги (газ, вода тощо) — дзеркало Tenant.

    Компанія платить постачальнику за послугу; облік — дзеркальний до
    орендарського білінгу (таблиця «Постачальник» у «Рахунках»).
    """
    name = models.CharField(max_length=200, verbose_name='Назва')
    tax_id = models.CharField(max_length=20, blank=True, verbose_name='ЄДРПОУ/ІПН')
    phone = models.CharField(max_length=30, blank=True, verbose_name='Телефон')
    email = models.EmailField(blank=True)
    contact_person = models.CharField(max_length=100, blank=True, verbose_name='Контактна особа')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Постачальник'
        verbose_name_plural = 'Постачальники'

    def __str__(self):
        return self.name


class SupplierContract(models.Model):
    """Договір з постачальником на одну послугу, діє в періоді дат.

    Декілька постачальників можуть одночасно діяти на одну послугу
    (рішення клієнта 2026-09-02) — перетини періодів дозволені, окремої
    валідації немає. Історія за роками — окремі записи (постачальник
    води може змінитися). Статус (діючий/майбутній/минулий) виводиться
    з дат; date_end = null означає безстроковий договір.

    Тариф у постачальника СПІЛЬНИЙ з орендарями — Service.rate_on(дата),
    своєї історії тарифів немає (рішення клієнта 2026-07-10).
    """
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='contracts')
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='supplier_contracts')
    number = models.CharField(max_length=50, verbose_name='Номер договору')
    date_start = models.DateField(verbose_name='Дата початку')
    date_end = models.DateField(null=True, blank=True, verbose_name='Дата закінчення')
    note = models.CharField(max_length=200, blank=True, verbose_name='Примітка')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date_start']
        verbose_name = 'Договір постачальника'
        verbose_name_plural = 'Договори постачальників'

    def __str__(self):
        return f'{self.number} — {self.supplier.name} / {self.service.name}'


class Fund(models.TextChoices):
    """Бюджетні фонди установи-платника.

    Спеціальний — власні надходження (те, що відшкодовують орендарі),
    загальний — бюджетне фінансування. Акт постачальника приходить однією
    сумою, бухгалтер вручну розписує її на два фонди (і суму, і обсяг).
    Правила розподілу немає — програма зберігає те, що ввели.
    """
    SPECIAL = 'spec', 'Спеціальний фонд'
    GENERAL = 'general', 'Загальний фонд'


class SupplierBill(models.Model):
    """Місячний запис постачальника — структурне дзеркало Bill без верифікації.

    НЕ прив'язаний до BillingPeriod.is_closed: закриття періодів стосується
    лише рахунків орендарів, записи постачальника редагуються завжди
    (окреме закриття для постачальників — поза скоупом v1, рішення клієнта).

    На кожен місяць договору припадає ДВА записи — по одному на фонд
    (рішення клієнта 2026-09-18). Якщо фактично задіяний один фонд,
    другий лишається нулями.
    """
    supplier_contract = models.ForeignKey(
        SupplierContract, on_delete=models.CASCADE, related_name='bills',
    )
    period = models.ForeignKey(BillingPeriod, on_delete=models.PROTECT, related_name='supplier_bills')
    fund = models.CharField(
        max_length=10, choices=Fund.choices, default=Fund.SPECIAL,
        verbose_name='Фонд',
    )

    # Snapshot полів — ті самі точності, що в Bill (гроші 12,2; обсяг/тариф 18,9)
    debt_start = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                     verbose_name='Борг на початок')
    quantity = models.DecimalField(max_digits=18, decimal_places=9, default=Decimal('0'),
                                   verbose_name='Кількість')
    rate = models.DecimalField(max_digits=18, decimal_places=9, default=Decimal('0'),
                               verbose_name='Тариф')
    accrued_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                         verbose_name='Нараховано')
    # Дзеркало Bill.is_manual_accrual — див. коментар там
    is_manual_accrual = models.BooleanField(default=False, verbose_name='Нарах. вручну')
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                      verbose_name='Сплачено')
    correction = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'),
                                     verbose_name='Корекція')

    # Аудит
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_supplier_bills',
    )

    class Meta:
        unique_together = (('supplier_contract', 'period', 'fund'),)
        # fund у сортуванні — щоб спеціальний завжди йшов перед загальним
        # ('general' < 'spec' за алфавітом, тому спец. просимо через -fund)
        ordering = ['-period__year', '-period__month', '-fund']
        verbose_name = 'Рахунок постачальника'
        verbose_name_plural = 'Рахунки постачальників'

    @property
    def total_debt_end(self) -> Decimal:
        """Борг на кінець періоду = (вхідний борг + нараховано + корекція) - сплачено."""
        return (self.debt_start + self.accrued_amount + self.correction) - self.paid_amount

    def __str__(self):
        return f'{self.supplier_contract.number} / {self.period} / {self.get_fund_display()}'


class SupplierFundPlan(models.Model):
    """Годовой план договора поставщика по одному фонду: сумма и объём.

    Отдельная таблица, а не поля в SupplierContract: договор бывает
    бессрочным (date_end = null), а план каждый год свой — бухгалтер
    корректирует его под арендаторов (решение клиента 2026-09-18).

    ⚠️ Асимметрия с арендаторами намеренная: ContractService.planned_amount
    хранится БЕЗ года, здесь год обязателен.

    Нет записи — плана на этот год нет (в таблице колонки плана пустые).
    """
    supplier_contract = models.ForeignKey(
        SupplierContract, on_delete=models.CASCADE, related_name='fund_plans',
    )
    year = models.PositiveIntegerField(verbose_name='Рік')
    fund = models.CharField(max_length=10, choices=Fund.choices, verbose_name='Фонд')
    # Точности как у ContractService.planned_*: деньги 12,2; объём 18,9
    planned_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        verbose_name='Сума за договором (план)',
    )
    planned_volume = models.DecimalField(
        max_digits=18, decimal_places=9, null=True, blank=True,
        verbose_name='Обсяг за договором (план)',
    )

    class Meta:
        unique_together = (('supplier_contract', 'year', 'fund'),)
        ordering = ['-year', '-fund']
        verbose_name = 'План фонду постачальника'
        verbose_name_plural = 'Плани фондів постачальників'

    def __str__(self):
        return f'{self.supplier_contract.number} / {self.year} / {self.get_fund_display()}'
