from django import forms
from django.contrib import admin
from .models import (
    Tenant, Contract, Service, ServiceRate, ContractService, BillingPeriod, Bill,
    ReimbursementContract, Supplier, SupplierContract, SupplierBill, PeriodLock,
    SupplierFundPlan,
)


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ('name', 'tax_id', 'phone', 'email')
    search_fields = ('name', 'tax_id', 'phone', 'email')


@admin.register(Contract)
class ContractAdmin(admin.ModelAdmin):
    list_display = ('contract_number', 'tenant', 'address', 'area_size', 'date_start', 'date_end', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('contract_number', 'address', 'tenant__name')
    autocomplete_fields = ('tenant',)


class ReimbursementContractForm(forms.ModelForm):
    """Та же валидация пересечений, что и в API-сериализаторе: без неё admin
    мог бы нарушить инвариант «периоды одного договора не пересекаются»,
    на котором держится резолв reimbursement_for."""

    class Meta:
        model = ReimbursementContract
        fields = '__all__'

    def clean(self):
        cleaned = super().clean()
        contracts = cleaned.get('contracts')
        date_start = cleaned.get('date_start')
        date_end = cleaned.get('date_end')
        if contracts is not None and date_start and date_end:
            if date_end < date_start:
                raise forms.ValidationError(
                    'Дата закінчення не може бути раніше дати початку.'
                )
            error = ReimbursementContract.overlap_error(
                contracts, date_start, date_end, exclude_pk=self.instance.pk,
            )
            if error:
                raise forms.ValidationError(error)
        return cleaned


@admin.register(ReimbursementContract)
class ReimbursementContractAdmin(admin.ModelAdmin):
    form = ReimbursementContractForm
    list_display = ('number', 'date_start', 'date_end', 'note', 'created_by')
    search_fields = ('number', 'contracts__contract_number', 'contracts__tenant__name')
    # M2M зручніше редагувати двома списками (доступні/обрані), ніж мультиселектом
    filter_horizontal = ('contracts',)


class ServiceRateInline(admin.TabularInline):
    model = ServiceRate
    extra = 1
    fields = ('rate', 'effective_from', 'note')
    ordering = ('-effective_from',)


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ('name', 'unit_name', 'default_rate', 'current_rate', 'color')
    search_fields = ('name',)
    inlines = (ServiceRateInline,)


@admin.register(ServiceRate)
class ServiceRateAdmin(admin.ModelAdmin):
    list_display = ('service', 'rate', 'effective_from', 'note', 'created_by')
    list_filter = ('service',)
    search_fields = ('service__name',)
    autocomplete_fields = ('service',)


@admin.register(ContractService)
class ContractServiceAdmin(admin.ModelAdmin):
    list_display = ('contract', 'service', 'personal_rate', 'is_active')
    list_filter = ('is_active', 'service')
    autocomplete_fields = ('contract',)


@admin.register(BillingPeriod)
class BillingPeriodAdmin(admin.ModelAdmin):
    # is_closed/closed_by/closed_at — тепер property поверх PeriodLock,
    # тому фільтрувати по них не можна (не поля БД)
    list_display = ('year', 'month', 'is_closed', 'closed_by', 'closed_at')
    list_filter = ('year',)


@admin.register(PeriodLock)
class PeriodLockAdmin(admin.ModelAdmin):
    list_display = ('period', 'scope', 'closed_by', 'closed_at')
    list_filter = ('scope',)


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = (
        'contract', 'service', 'period',
        'debt_start', 'accrued_amount', 'paid_amount', 'correction',
        'is_verified',
    )
    list_filter = ('is_verified', 'period', 'service')
    search_fields = ('contract__contract_number', 'contract__tenant__name')
    autocomplete_fields = ('contract',)
    readonly_fields = ('created_at', 'updated_at', 'created_by', 'verified_at', 'verified_by')


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ('name', 'tax_id', 'phone', 'email')
    # search_fields нужен и для autocomplete_fields в SupplierContractAdmin
    search_fields = ('name', 'tax_id', 'phone', 'email')


class SupplierContractForm(forms.ModelForm):
    """Та же валидация дат, что и в API-сериализаторе. Перетини періодів
    дозволені (декілька постачальників на одну послугу, рішення клієнта
    2026-09-02) — тут лишається лише перевірка коректності самих дат."""

    class Meta:
        model = SupplierContract
        fields = '__all__'

    def clean(self):
        cleaned = super().clean()
        date_start = cleaned.get('date_start')
        date_end = cleaned.get('date_end')
        if date_start and date_end and date_end < date_start:
            raise forms.ValidationError(
                'Дата закінчення не може бути раніше дати початку.'
            )
        return cleaned


@admin.register(SupplierContract)
class SupplierContractAdmin(admin.ModelAdmin):
    form = SupplierContractForm
    list_display = ('number', 'supplier', 'service', 'date_start', 'date_end')
    list_filter = ('service',)
    # search_fields нужен и для autocomplete_fields в SupplierBillAdmin
    search_fields = ('number', 'supplier__name', 'service__name')
    autocomplete_fields = ('supplier', 'service')


@admin.register(SupplierBill)
class SupplierBillAdmin(admin.ModelAdmin):
    # fund — две записи на месяц иначе неотличимы
    list_display = (
        'supplier_contract', 'period', 'fund',
        'debt_start', 'accrued_amount', 'paid_amount', 'correction',
    )
    list_filter = ('period', 'fund')
    search_fields = ('supplier_contract__number', 'supplier_contract__supplier__name')
    autocomplete_fields = ('supplier_contract',)
    readonly_fields = ('created_at', 'updated_at', 'created_by')


@admin.register(SupplierFundPlan)
class SupplierFundPlanAdmin(admin.ModelAdmin):
    list_display = ('supplier_contract', 'year', 'fund', 'planned_amount', 'planned_volume')
    list_filter = ('year', 'fund')
    search_fields = ('supplier_contract__number', 'supplier_contract__supplier__name')
    autocomplete_fields = ('supplier_contract',)
