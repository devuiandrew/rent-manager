from datetime import date

from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator
from rentals.models import (
    Tenant, Contract, Service, ServiceRate, ContractService, BillingPeriod, Bill,
    LockScope,
    ReimbursementContract, Supplier, SupplierContract, SupplierBill, SupplierFundPlan,
)


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = [
            'id', 'name', 'tax_id', 'phone', 'email', 'contact_person',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class ContractSerializer(serializers.ModelSerializer):
    tenant_id = serializers.IntegerField(write_only=False)
    tenant_name = serializers.CharField(source='tenant.name', read_only=True)
    # Номер чинного СЬОГОДНІ договору відшкодування (read-only, з історії документів).
    # Прив'язка договорів до документів — через /reimbursement-contracts/
    reimbursement_number = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = [
            'id', 'tenant_id', 'tenant_name', 'contract_number', 'address',
            'area_size', 'date_start', 'date_end', 'is_active',
            'reimbursement_number',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'tenant_name']

    def get_reimbursement_number(self, obj):
        doc = obj.reimbursement_for(date.today())
        return doc.number if doc else ''


class ReimbursementContractSerializer(serializers.ModelSerializer):
    # M2M: на запис приймаємо список id договорів, source='contracts' пише напряму у зв'язок
    contract_ids = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Contract.objects.all(), source='contracts',
    )
    # Дані договорів для відображення (номер + орендар) — без додаткових запитів з фронта
    contracts_info = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = ReimbursementContract
        fields = [
            'id', 'number', 'date_start', 'date_end', 'note',
            'contract_ids', 'contracts_info',
            'created_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = ['created_at', 'created_by', 'created_by_name']

    def get_contracts_info(self, obj):
        return [
            {
                'id': c.id,
                'contract_number': c.contract_number,
                'tenant_name': c.tenant.name,
            }
            for c in obj.contracts.all()
        ]

    def validate(self, attrs):
        """Бізнес-правило: періоди відшкодувань одного договору не перетинаються.

        Інакше resolve «який документ діє на дату X» стає неоднозначним.
        """
        # PATCH може прислати лише частину полів — відсутні беремо з instance
        date_start = attrs.get(
            'date_start', self.instance.date_start if self.instance else None,
        )
        date_end = attrs.get(
            'date_end', self.instance.date_end if self.instance else None,
        )
        if date_end < date_start:
            raise serializers.ValidationError(
                'Дата закінчення не може бути раніше дати початку.'
            )

        contracts = attrs.get('contracts')
        if contracts is None and self.instance is not None:
            contracts = list(self.instance.contracts.all())

        if contracts:
            # Общая проверка пересечений (модель) — при редактировании
            # не конфликтуем сами с собой (exclude_pk)
            error = ReimbursementContract.overlap_error(
                contracts, date_start, date_end,
                exclude_pk=self.instance.pk if self.instance else None,
            )
            if error:
                raise serializers.ValidationError(error)
        return attrs


class ServiceSerializer(serializers.ModelSerializer):
    # current_rate/upcoming_change обчислюються з історії тарифів (ServiceRate).
    # default_rate лишається як початкове значення/fallback.
    current_rate = serializers.DecimalField(max_digits=18, decimal_places=9, read_only=True)
    upcoming_change = serializers.SerializerMethodField()

    class Meta:
        model = Service
        fields = [
            'id', 'name', 'unit_name', 'default_rate', 'current_rate',
            'upcoming_change', 'color', 'created_at',
        ]
        read_only_fields = ['created_at', 'current_rate', 'upcoming_change']

    def get_upcoming_change(self, obj):
        """Найближча майбутня зміна тарифу — для бейджа в UI. None якщо немає."""
        nxt = obj.upcoming_rate_change
        if nxt is None:
            return None
        return {'rate': str(nxt.rate), 'effective_from': nxt.effective_from.isoformat()}


class ServiceRateSerializer(serializers.ModelSerializer):
    service_id = serializers.IntegerField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = ServiceRate
        fields = [
            'id', 'service_id', 'rate', 'effective_from', 'note',
            'created_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = ['created_at', 'created_by', 'created_by_name']
        # service_id перейменовано → авто-валідатор unique_together не вішається,
        # додаємо явно (один тариф на дату для послуги)
        validators = [
            UniqueTogetherValidator(
                queryset=ServiceRate.objects.all(),
                fields=['service_id', 'effective_from'],
                message='Для цієї послуги вже задано тариф на цю дату.',
            )
        ]


class ContractServiceSerializer(serializers.ModelSerializer):
    contract_id = serializers.IntegerField()
    service_id = serializers.IntegerField()
    # Дані послуги — read-only, для відображення в UI без додаткових запитів
    service_name = serializers.CharField(source='service.name', read_only=True)
    service_unit_name = serializers.CharField(source='service.unit_name', read_only=True)
    service_default_rate = serializers.DecimalField(
        source='service.default_rate', max_digits=18, decimal_places=9, read_only=True,
    )
    # Поточний тариф послуги (з історії, на сьогодні) — для колонки "Загальний"
    service_current_rate = serializers.DecimalField(
        source='service.current_rate', max_digits=18, decimal_places=9, read_only=True,
    )
    service_color = serializers.CharField(source='service.color', read_only=True)
    effective_rate = serializers.DecimalField(max_digits=18, decimal_places=9, read_only=True)

    class Meta:
        model = ContractService
        fields = [
            'id', 'contract_id', 'service_id',
            'service_name', 'service_unit_name', 'service_default_rate',
            'service_current_rate', 'service_color',
            'personal_rate', 'effective_rate', 'is_active',
            'planned_amount', 'planned_volume',
        ]
        # Поля переименованы в contract_id/service_id, поэтому DRF не вешает
        # авто-валидатор unique_together — добавляем его явно. Иначе дубликат
        # пары договор+услуга падает в БД (IntegrityError → 500) вместо 400.
        validators = [
            UniqueTogetherValidator(
                queryset=ContractService.objects.all(),
                fields=['contract_id', 'service_id'],
                message='Ця послуга вже додана до цього договору.',
            )
        ]


class BillingPeriodSerializer(serializers.ModelSerializer):
    # Поля закриття живуть у PeriodLock, на періоді це property — тому оголошені
    # явно: без цього DRF віддав би closed_by об'єктом User і впав на рендері.
    # Форма відповіді не змінилась (фронт читає is_closed як і раніше).
    is_closed = serializers.BooleanField(read_only=True)
    closed_by = serializers.PrimaryKeyRelatedField(read_only=True)
    closed_at = serializers.DateTimeField(read_only=True)
    # Состояние по каждой сущности: {scope: {closed_by, closed_at} | None}.
    # is_closed/closed_* выше — это замок арендаторов, оставлены для старого фронта
    locks = serializers.SerializerMethodField()

    class Meta:
        model = BillingPeriod
        fields = ['id', 'year', 'month', 'is_closed', 'closed_by', 'closed_at', 'locks']

    def get_locks(self, period):
        # lock_for перебирает prefetch-кеш — список периодов без лишних запросов
        date_field = serializers.DateTimeField()
        result = {}
        for scope in LockScope.values:
            lock = period.lock_for(scope)
            result[scope] = (
                {
                    'closed_by': lock.closed_by_id,
                    'closed_at': date_field.to_representation(lock.closed_at),
                }
                if lock else None
            )
        return result


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id', 'name', 'tax_id', 'phone', 'email', 'contact_person',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class SupplierContractSerializer(serializers.ModelSerializer):
    supplier_id = serializers.IntegerField()
    service_id = serializers.IntegerField()
    # Дані для відображення в CRUD-таблиці — без додаткових запитів з фронта
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    service_name = serializers.CharField(source='service.name', read_only=True)
    service_unit_name = serializers.CharField(source='service.unit_name', read_only=True)

    class Meta:
        model = SupplierContract
        fields = [
            'id', 'supplier_id', 'supplier_name', 'service_id',
            'service_name', 'service_unit_name',
            'number', 'date_start', 'date_end', 'note',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate(self, attrs):
        """Декілька постачальників можуть одночасно діяти на одну послугу
        (рішення клієнта 2026-09-02) — перетини періодів дозволені, тут
        лишається тільки перевірка коректності самих дат.
        """
        # PATCH може прислати лише частину полів — відсутні беремо з instance
        date_start = attrs.get(
            'date_start', self.instance.date_start if self.instance else None,
        )
        date_end = attrs.get(
            'date_end', self.instance.date_end if self.instance else None,
        )
        # date_end = null означає безстроковий договір — це валідно
        if date_end is not None and date_end < date_start:
            raise serializers.ValidationError(
                'Дата закінчення не може бути раніше дати початку.'
            )
        return attrs


class SupplierBillSerializer(serializers.ModelSerializer):
    supplier_contract_id = serializers.IntegerField()
    period_id = serializers.IntegerField()
    year = serializers.IntegerField(source='period.year', read_only=True)
    month = serializers.IntegerField(source='period.month', read_only=True)
    debt_end = serializers.DecimalField(
        source='total_debt_end', max_digits=12, decimal_places=2, read_only=True,
    )
    # id послуги — фронту для групування записів по активній послузі
    service_id = serializers.IntegerField(
        source='supplier_contract.service_id', read_only=True,
    )

    class Meta:
        model = SupplierBill
        fields = [
            'id', 'supplier_contract_id', 'period_id', 'service_id', 'year', 'month',
            'fund', 'debt_start', 'quantity', 'rate',
            'accrued_amount', 'is_manual_accrual', 'paid_amount', 'correction', 'debt_end',
            'created_at', 'updated_at', 'created_by',
        ]
        read_only_fields = [
            'service_id', 'year', 'month', 'debt_end',
            'created_at', 'updated_at', 'created_by',
        ]
        # Поля переименованы в *_id → авто-валидатор unique_together не вешается,
        # добавляем явно. Иначе дубликат тройки договор+период+фонд = IntegrityError → 500.
        # fund в списке обязателен: без него второй фонд того же месяца
        # отклонялся бы как дубликат
        validators = [
            UniqueTogetherValidator(
                queryset=SupplierBill.objects.all(),
                fields=['supplier_contract_id', 'period_id', 'fund'],
                message='Запис за цей місяць і фонд для цього договору вже існує.',
            )
        ]


class SupplierFundPlanSerializer(serializers.ModelSerializer):
    supplier_contract_id = serializers.IntegerField()
    # id послуги — фронту для вибірки планів по активній послузі
    service_id = serializers.IntegerField(
        source='supplier_contract.service_id', read_only=True,
    )

    class Meta:
        model = SupplierFundPlan
        fields = [
            'id', 'supplier_contract_id', 'service_id', 'year', 'fund',
            'planned_amount', 'planned_volume',
        ]
        read_only_fields = ['service_id']
        # Та же ловушка, что у SupplierBillSerializer: поле переименовано в *_id,
        # авто-валидатор unique_together DRF не вешает — дубль дал бы 500
        validators = [
            UniqueTogetherValidator(
                queryset=SupplierFundPlan.objects.all(),
                fields=['supplier_contract_id', 'year', 'fund'],
                message='План цього фонду на цей рік для договору вже існує.',
            )
        ]


class BillSerializer(serializers.ModelSerializer):
    contract_id = serializers.IntegerField()
    service_id = serializers.IntegerField()
    period_id = serializers.IntegerField()
    year = serializers.IntegerField(source='period.year', read_only=True)
    month = serializers.IntegerField(source='period.month', read_only=True)
    debt_end = serializers.DecimalField(
        source='total_debt_end', max_digits=12, decimal_places=2, read_only=True,
    )

    class Meta:
        model = Bill
        fields = [
            'id', 'contract_id', 'service_id', 'period_id', 'year', 'month',
            'debt_start', 'quantity', 'rate',
            'accrued_amount', 'is_manual_accrual', 'paid_amount', 'correction', 'debt_end',
            'is_verified', 'verified_by', 'verified_at',
            'created_at', 'updated_at', 'created_by',
        ]
        read_only_fields = [
            'year', 'month', 'debt_end',
            'verified_by', 'verified_at',
            'created_at', 'updated_at', 'created_by',
        ]
