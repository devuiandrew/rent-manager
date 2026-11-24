from django.conf import settings
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ParseError, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView


def _is_accountant(user) -> bool:
    return user.is_staff or user.groups.filter(name="Бухгалтер").exists()


def _is_manager(user) -> bool:
    return user.is_staff or user.groups.filter(name="Менеджер").exists()


from rentals.models import (
    Tenant,
    Contract,
    Service,
    ServiceRate,
    ContractService,
    BillingPeriod,
    Bill,
    ReimbursementContract,
    Supplier,
    SupplierContract,
    SupplierBill,
    SupplierFundPlan,
    PeriodLock,
    LockScope,
)
from rentals.serializers import (
    TenantSerializer,
    ContractSerializer,
    ServiceSerializer,
    ServiceRateSerializer,
    ContractServiceSerializer,
    BillingPeriodSerializer,
    BillSerializer,
    ReimbursementContractSerializer,
    SupplierSerializer,
    SupplierContractSerializer,
    SupplierBillSerializer,
    SupplierFundPlanSerializer,
)
from rentals.services.bill_generator import generate_bills
from rentals.services.mass_accrual import mark_bills_accrued
from rentals.services.mass_payment import mark_bills_paid


class AppVersionView(APIView):
    # Для сповіщення фронта "вийшла нова версія" — просто читаємо значення з .env
    def get(self, request):
        return Response({"latest_version": settings.LATEST_VERSION})


class TenantViewSet(viewsets.ModelViewSet):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer


class ContractViewSet(viewsets.ModelViewSet):
    # prefetch відшкодувань — get_reimbursement_number у серіалізаторі без N+1
    queryset = (
        Contract.objects.select_related("tenant")
        .prefetch_related("reimbursements")
        .all()
    )
    serializer_class = ContractSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        tenant_id = self.request.query_params.get("tenant_id")
        if tenant_id:
            qs = qs.filter(tenant_id=tenant_id)
        return qs


class ReimbursementContractViewSet(viewsets.ModelViewSet):
    """Договори відшкодування. Фільтр: ?contract_id=N"""

    # prefetch договорів з орендарями — contracts_info у серіалізаторі без N+1
    queryset = (
        ReimbursementContract.objects.prefetch_related("contracts__tenant")
        .select_related("created_by")
        .all()
    )
    serializer_class = ReimbursementContractSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if contract_id := self.request.query_params.get("contract_id"):
            qs = qs.filter(contracts__id=contract_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ServiceViewSet(viewsets.ModelViewSet):
    queryset = Service.objects.all()
    serializer_class = ServiceSerializer

    def perform_create(self, serializer):
        # При створенні послуги фіксуємо початковий тариф у історію (діє з сьогодні),
        # щоб current_rate одразу мав запис, а не покладався лише на fallback
        service = serializer.save()
        ServiceRate.objects.create(
            service=service,
            rate=service.default_rate,
            effective_from=timezone.now().date(),
            created_by=self.request.user,
            note="Початковий тариф",
        )


class ServiceRateViewSet(viewsets.ModelViewSet):
    """Історія тарифів послуги. Фільтр: ?service_id=N"""

    queryset = ServiceRate.objects.select_related("service", "created_by").all()
    serializer_class = ServiceRateSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if service_id := self.request.query_params.get("service_id"):
            qs = qs.filter(service_id=service_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ContractServiceViewSet(viewsets.ModelViewSet):
    queryset = ContractService.objects.select_related("contract", "service").all()
    serializer_class = ContractServiceSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if contract_id := self.request.query_params.get("contract_id"):
            qs = qs.filter(contract_id=contract_id)
        if service_id := self.request.query_params.get("service_id"):
            qs = qs.filter(service_id=service_id)
        return qs


class SupplierViewSet(viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer


class SupplierContractViewSet(viewsets.ModelViewSet):
    """Договори постачальників. Фільтри: ?supplier_id=N ?service_id=N"""

    queryset = SupplierContract.objects.select_related("supplier", "service").all()
    serializer_class = SupplierContractSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if supplier_id := self.request.query_params.get("supplier_id"):
            qs = qs.filter(supplier_id=supplier_id)
        if service_id := self.request.query_params.get("service_id"):
            qs = qs.filter(service_id=service_id)
        return qs


class SupplierBillViewSet(viewsets.ModelViewSet):
    """Місячні записи постачальників.

    Фільтри: ?service_id ?supplier_contract_id ?supplier_id ?year ?month ?fund.
    Закрытие периода — СВОЁ, по замку suppliers (B3, 2026-09-28): замок
    арендаторов записи поставщика не блокирует — их вносят задним числом
    за 1–2 месяца, когда у арендаторов период уже закрыт. До B3 записи
    поставщика редактировались всегда (решение v1).
    """

    # select_related supplier_contract — service_id у серіалізаторі без N+1
    queryset = SupplierBill.objects.select_related(
        "supplier_contract__service",
        "period",
    ).all()
    serializer_class = SupplierBillSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if service_id := params.get("service_id"):
            qs = qs.filter(supplier_contract__service_id=service_id)
        if supplier_contract_id := params.get("supplier_contract_id"):
            qs = qs.filter(supplier_contract_id=supplier_contract_id)
        if supplier_id := params.get("supplier_id"):
            qs = qs.filter(supplier_contract__supplier_id=supplier_id)
        if fund := params.get("fund"):
            qs = qs.filter(fund=fund)
        if year := params.get("year"):
            qs = qs.filter(period__year=year)
        if month := params.get("month"):
            qs = qs.filter(period__month=month)
        return qs

    def perform_update(self, serializer):
        # Как у арендаторов: закрытый период правит только админ
        bill = self.get_object()
        if (
            bill.period.is_closed_for(LockScope.SUPPLIERS)
            and not self.request.user.is_staff
        ):
            raise PermissionDenied(
                "Період закрито для постачальників — редагування заборонено."
            )
        serializer.save()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class SupplierFundPlanViewSet(viewsets.ModelViewSet):
    """Годовые планы фондов поставщика.

    Фильтры: ?service_id ?supplier_contract_id ?year. «Рахунки» берут
    планы по услуге и году одним запросом.
    Права не ограничиваем — как и ContractService.planned_* у арендаторов.
    """

    queryset = SupplierFundPlan.objects.select_related("supplier_contract").all()
    serializer_class = SupplierFundPlanSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if service_id := params.get("service_id"):
            qs = qs.filter(supplier_contract__service_id=service_id)
        if supplier_contract_id := params.get("supplier_contract_id"):
            qs = qs.filter(supplier_contract_id=supplier_contract_id)
        if year := params.get("year"):
            qs = qs.filter(year=year)
        return qs


# Сущности, которые сейчас можно закрыть через API. landlords есть в модели,
# но вкладки «Орендодавці» ещё нет — такой замок никто бы не проверял
CLOSABLE_SCOPES = (LockScope.TENANTS, LockScope.SUPPLIERS)


def _scope_from_request(request) -> str:
    """Сущность из тела close/reopen. Без scope — арендаторы: старый фронт
    (до выбора сущности в диалоге) продолжает работать без изменений."""
    scope = request.data.get("scope") or LockScope.TENANTS
    if scope not in CLOSABLE_SCOPES:
        raise ParseError(f"Невідома сутність для закриття: {scope}.")
    return scope


class BillingPeriodViewSet(viewsets.ModelViewSet):
    # prefetch замків — інакше кожен період у списку робив би свій запит
    queryset = BillingPeriod.objects.prefetch_related('locks')
    serializer_class = BillingPeriodSerializer

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Закрыть период по сущности: body {"scope": "tenants" | "suppliers"}.

        Без scope — арендаторы. Закрытие — строка PeriodLock, а не флаг
        на периоде: арендаторов и поставщиков закрывают в разном ритме.
        """
        if not _is_accountant(request.user):
            raise PermissionDenied("Тільки бухгалтер може закривати періоди.")
        scope = _scope_from_request(request)
        period = self.get_object()
        if period.is_closed_for(scope):
            return Response(
                {"detail": f"Період вже закрито ({LockScope(scope).label})."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        PeriodLock.objects.create(
            period=period,
            scope=scope,
            closed_by=request.user,
            closed_at=timezone.now(),
        )
        period.refresh_from_db()  # скидаємо кеш locks, інакше відповідь скаже «відкрито»
        return Response(BillingPeriodSerializer(period).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """Открыть период по сущности (тот же body, что у close). Бухгалтер."""
        if not _is_accountant(request.user):
            return Response(
                {"detail": "Недостатньо прав."}, status=status.HTTP_403_FORBIDDEN
            )
        scope = _scope_from_request(request)
        period = self.get_object()
        # Открыть = снять замок этой сущности; остальные замки не трогаем
        period.locks.filter(scope=scope).delete()
        period.refresh_from_db()
        return Response(BillingPeriodSerializer(period).data)

    @action(detail=False, methods=["post"], url_path="generate-bills")
    def generate_bills(self, request):
        """Створює рахунки за місяць або діапазон місяців одного року.

        POST /api/periods/generate-bills/
        Body: {
            "year": 2024, "month": 3,
            "month_to": 12 (optional, за замовчуванням = month),
            "service_id": 1 (optional),
            "update_rates": true (optional, тільки бухгалтер/адмін)
        }
        """
        try:
            year = int(request.data.get("year"))
            month = int(request.data.get("month"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Поля year та month обов'язкові (числа)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        month_to = request.data.get("month_to")
        if month_to is not None:
            try:
                month_to = int(month_to)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "month_to має бути числом."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        service_id = request.data.get("service_id")
        if service_id is not None:
            try:
                service_id = int(service_id)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "service_id має бути числом."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Перезапись тарифов меняет чужие данные — только бухгалтер/админ
        update_rates = bool(request.data.get("update_rates"))
        if update_rates and not _is_accountant(request.user):
            return Response(
                {
                    "detail": "Оновлювати тарифи може тільки бухгалтер або адміністратор."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            result = generate_bills(
                year=year,
                month_from=month,
                month_to=month_to,
                service_id=service_id,
                update_rates=update_rates,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "year": result.period_year,
                "month": result.period_month,
                "month_to": result.period_month_to,
                "created": result.created,
                "skipped_existing": result.skipped_existing,
                "updated_rates": result.updated_rates,
                "skipped_closed": result.skipped_closed,
                # Записи поставщиків — та сама генерація, окремі лічильники
                "supplier_created": result.supplier_created,
                "supplier_skipped_closed": result.supplier_skipped_closed,
                "supplier_skipped_existing": result.supplier_skipped_existing,
                "supplier_updated_rates": result.supplier_updated_rates,
            }
        )

    @action(detail=False, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request):
        """Проставляє оплату = нарахуванню для рахунків орендарів за місяць
        або діапазон місяців (кнопка «Сплачено»).

        POST /api/periods/mark-paid/
        Body: {
            "year": 2024, "month": 3,
            "month_to": 12 (optional, за замовчуванням = month),
            "service_id": 1 (optional)
        }
        """
        try:
            year = int(request.data.get("year"))
            month = int(request.data.get("month"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Поля year та month обов'язкові (числа)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        month_to = request.data.get("month_to")
        if month_to is not None:
            try:
                month_to = int(month_to)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "month_to має бути числом."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        service_id = request.data.get("service_id")
        if service_id is not None:
            try:
                service_id = int(service_id)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "service_id має бути числом."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            result = mark_bills_paid(
                year=year,
                month_from=month,
                month_to=month_to,
                service_id=service_id,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "year": result.period_year,
                "month": result.period_month,
                "month_to": result.period_month_to,
                "paid": result.paid,
                "skipped_paid": result.skipped_paid,
                "skipped_closed": result.skipped_closed,
            }
        )

    @action(detail=False, methods=["post"], url_path="mark-accrued")
    def mark_accrued(self, request):
        """Проставляє нарахування = об'єм × тариф для рахунків орендарів за
        місяць або діапазон місяців (кнопка «Нарахування»).

        POST /api/periods/mark-accrued/
        Body: {
            "year": 2024, "month": 3,
            "month_to": 12 (optional, за замовчуванням = month),
            "service_id": 1 (optional)
        }
        """
        try:
            year = int(request.data.get("year"))
            month = int(request.data.get("month"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Поля year та month обов'язкові (числа)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        month_to = request.data.get("month_to")
        if month_to is not None:
            try:
                month_to = int(month_to)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "month_to має бути числом."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        service_id = request.data.get("service_id")
        if service_id is not None:
            try:
                service_id = int(service_id)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "service_id має бути числом."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            result = mark_bills_accrued(
                year=year,
                month_from=month,
                month_to=month_to,
                service_id=service_id,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "year": result.period_year,
                "month": result.period_month,
                "month_to": result.period_month_to,
                "accrued": result.accrued,
                "skipped_manual": result.skipped_manual,
                "already_ok": result.already_ok,
                "skipped_closed": result.skipped_closed,
            }
        )


class BillViewSet(viewsets.ModelViewSet):
    queryset = Bill.objects.select_related("contract", "service", "period").all()
    serializer_class = BillSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if service_id := params.get("service_id"):
            qs = qs.filter(service_id=service_id)
        if contract_id := params.get("contract_id"):
            qs = qs.filter(contract_id=contract_id)
        if tenant_id := params.get("tenant_id"):
            qs = qs.filter(contract__tenant_id=tenant_id)
        if year := params.get("year"):
            qs = qs.filter(period__year=year)
        if month := params.get("month"):
            qs = qs.filter(period__month=month)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        # Заборонити редагування рахунків у закритому періоді
        bill = self.get_object()
        if (
            bill.period.is_closed_for(LockScope.TENANTS)
            and not self.request.user.is_staff
        ):
            raise PermissionDenied("Період закрито — редагування заборонено.")
        serializer.save()

    #! Нужно будет удалить , это для кружков в таблице
    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Бухгалтер позначає рахунок як перевірений."""
        if not _is_accountant(request.user):
            raise PermissionDenied("Тільки бухгалтер може верифікувати рахунки.")
        bill = self.get_object()
        bill.is_verified = True
        bill.verified_by = request.user
        bill.verified_at = timezone.now()
        bill.save()
        return Response(BillSerializer(bill).data)

    @action(detail=True, methods=["post"])
    def unverify(self, request, pk=None):
        """Скасувати позначку перевірки."""
        if not _is_accountant(request.user):
            raise PermissionDenied("Тільки бухгалтер може скасовувати верифікацію.")
        bill = self.get_object()
        bill.is_verified = False
        bill.verified_by = None
        bill.verified_at = None
        bill.save()
        return Response(BillSerializer(bill).data)
