from django.urls import path
from rest_framework.routers import DefaultRouter
from rentals import views

router = DefaultRouter()
router.register('tenants', views.TenantViewSet, basename='tenant')
router.register('contracts', views.ContractViewSet, basename='contract')
router.register('reimbursement-contracts', views.ReimbursementContractViewSet, basename='reimbursement-contract')
router.register('services', views.ServiceViewSet, basename='service')
router.register('service-rates', views.ServiceRateViewSet, basename='service-rate')
router.register('contract-services', views.ContractServiceViewSet, basename='contract-service')
router.register('periods', views.BillingPeriodViewSet, basename='period')
router.register('bills', views.BillViewSet, basename='bill')
router.register('suppliers', views.SupplierViewSet, basename='supplier')
router.register('supplier-contracts', views.SupplierContractViewSet, basename='supplier-contract')
router.register('supplier-bills', views.SupplierBillViewSet, basename='supplier-bill')
router.register('supplier-fund-plans', views.SupplierFundPlanViewSet, basename='supplier-fund-plan')

urlpatterns = router.urls + [
    path('version/', views.AppVersionView.as_view(), name='app-version'),
]
