import axios, { type AxiosInstance } from 'axios'
import type {
  Tenant, Contract, Service, ServiceRate, ContractService, BillingPeriod, Bill,
  ReimbursementContract, Supplier, SupplierContract, SupplierBill, SupplierFundPlan,
  LockScope,
} from '@/types/billing'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

type GetToken = () => Promise<string | undefined>

export class BillingApiService {
  private client: AxiosInstance

  constructor(getAccessToken?: GetToken) {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    })

    this.client.interceptors.request.use(async (config) => {
      if (getAccessToken) {
        const token = await getAccessToken()
        if (token) config.headers.Authorization = `Bearer ${token}`
      }
      return config
    })

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          window.dispatchEvent(new CustomEvent('auth:unauthorized'))
        }
        return Promise.reject(error)
      },
    )
  }

  // -------- Tenants --------
  getTenants = () =>
    this.client.get<Tenant[]>('/tenants/').then(r => r.data)
  getTenant = (id: number) =>
    this.client.get<Tenant>(`/tenants/${id}/`).then(r => r.data)
  createTenant = (data: Partial<Tenant>) =>
    this.client.post<Tenant>('/tenants/', data).then(r => r.data)
  updateTenant = (id: number, data: Partial<Tenant>) =>
    this.client.patch<Tenant>(`/tenants/${id}/`, data).then(r => r.data)
  deleteTenant = (id: number) =>
    this.client.delete(`/tenants/${id}/`).then(() => undefined)

  // -------- Contracts --------
  getContracts = (tenantId?: number) =>
    this.client.get<Contract[]>('/contracts/', {
      params: tenantId ? { tenant_id: tenantId } : undefined,
    }).then(r => r.data)
  getContract = (id: number) =>
    this.client.get<Contract>(`/contracts/${id}/`).then(r => r.data)
  createContract = (data: Partial<Contract>) =>
    this.client.post<Contract>('/contracts/', data).then(r => r.data)
  updateContract = (id: number, data: Partial<Contract>) =>
    this.client.patch<Contract>(`/contracts/${id}/`, data).then(r => r.data)
  deleteContract = (id: number) =>
    this.client.delete(`/contracts/${id}/`).then(() => undefined)

  // -------- Services --------
  getServices = () =>
    this.client.get<Service[]>('/services/').then(r => r.data)
  createService = (data: Partial<Service>) =>
    this.client.post<Service>('/services/', data).then(r => r.data)
  updateService = (id: number, data: Partial<Service>) =>
    this.client.patch<Service>(`/services/${id}/`, data).then(r => r.data)
  deleteService = (id: number) =>
    this.client.delete(`/services/${id}/`).then(() => undefined)

  // -------- Service rates (історія тарифів) --------
  getServiceRates = (serviceId: number) =>
    this.client.get<ServiceRate[]>('/service-rates/', { params: { service_id: serviceId } }).then(r => r.data)
  createServiceRate = (data: { service_id: number; rate: string; effective_from: string; note?: string }) =>
    this.client.post<ServiceRate>('/service-rates/', data).then(r => r.data)
  deleteServiceRate = (id: number) =>
    this.client.delete(`/service-rates/${id}/`).then(() => undefined)

  // -------- ContractServices (assignment + personal tariff) --------
  getContractServices = (params?: { contract_id?: number; service_id?: number }) =>
    this.client.get<ContractService[]>('/contract-services/', { params }).then(r => r.data)
  createContractService = (data: Partial<ContractService>) =>
    this.client.post<ContractService>('/contract-services/', data).then(r => r.data)
  updateContractService = (id: number, data: Partial<ContractService>) =>
    this.client.patch<ContractService>(`/contract-services/${id}/`, data).then(r => r.data)
  deleteContractService = (id: number) =>
    this.client.delete(`/contract-services/${id}/`).then(() => undefined)

  // -------- Reimbursement contracts (договори відшкодування) --------
  getReimbursements = (contractId?: number) =>
    this.client.get<ReimbursementContract[]>('/reimbursement-contracts/', {
      params: contractId ? { contract_id: contractId } : undefined,
    }).then(r => r.data)
  createReimbursement = (data: Partial<ReimbursementContract>) =>
    this.client.post<ReimbursementContract>('/reimbursement-contracts/', data).then(r => r.data)
  updateReimbursement = (id: number, data: Partial<ReimbursementContract>) =>
    this.client.patch<ReimbursementContract>(`/reimbursement-contracts/${id}/`, data).then(r => r.data)
  deleteReimbursement = (id: number) =>
    this.client.delete(`/reimbursement-contracts/${id}/`).then(() => undefined)

  // -------- Billing periods --------
  getPeriods = () =>
    this.client.get<BillingPeriod[]>('/periods/').then(r => r.data)
  // scope — сущность: замки арендаторов и поставщиков независимы
  closePeriod = (id: number, scope: LockScope = 'tenants') =>
    this.client.post<BillingPeriod>(`/periods/${id}/close/`, { scope }).then(r => r.data)
  reopenPeriod = (id: number, scope: LockScope = 'tenants') =>
    this.client.post<BillingPeriod>(`/periods/${id}/reopen/`, { scope }).then(r => r.data)
  generateBills = (params: {
    year: number
    month: number
    month_to?: number
    service_id?: number
    // Перезапись тарифов в существующих счетах (только бухгалтер/админ)
    update_rates?: boolean
  }) =>
    this.client.post<{
      year: number
      month: number
      month_to: number
      created: number
      skipped_existing: number
      updated_rates: number
      skipped_closed: number[]
      // Записи постачальників — та сама генерація, окремі лічильники
      supplier_created: number
      supplier_skipped_existing: number
      supplier_updated_rates: number
      // Месяцы, закрытые по замку поставщиков (свой, не арендаторский)
      supplier_skipped_closed: number[]
    }>(
      '/periods/generate-bills/',
      params,
    ).then(r => r.data)
  markBillsPaid = (params: {
    year: number
    month: number
    month_to?: number
    service_id?: number
  }) =>
    this.client.post<{
      year: number
      month: number
      month_to: number
      paid: number
      skipped_paid: number
      skipped_closed: number[]
    }>(
      '/periods/mark-paid/',
      params,
    ).then(r => r.data)
  markBillsAccrued = (params: {
    year: number
    month: number
    month_to?: number
    service_id?: number
  }) =>
    this.client.post<{
      year: number
      month: number
      month_to: number
      accrued: number
      skipped_manual: number
      already_ok: number
      skipped_closed: number[]
    }>(
      '/periods/mark-accrued/',
      params,
    ).then(r => r.data)

  // -------- Bills --------
  getBills = (params?: {
    service_id?: number
    tenant_id?: number
    contract_id?: number
    year?: number
    month?: number
  }) =>
    this.client.get<Bill[]>('/bills/', { params }).then(r => r.data)
  getBill = (id: number) =>
    this.client.get<Bill>(`/bills/${id}/`).then(r => r.data)
  createBill = (data: Partial<Bill>) =>
    this.client.post<Bill>('/bills/', data).then(r => r.data)
  updateBill = (id: number, data: Partial<Bill>) =>
    this.client.patch<Bill>(`/bills/${id}/`, data).then(r => r.data)
  deleteBill = (id: number) =>
    this.client.delete(`/bills/${id}/`).then(() => undefined)
  verifyBill = (id: number) =>
    this.client.post<Bill>(`/bills/${id}/verify/`).then(r => r.data)
  unverifyBill = (id: number) =>
    this.client.post<Bill>(`/bills/${id}/unverify/`).then(r => r.data)

  // -------- Suppliers (постачальники) --------
  getSuppliers = () =>
    this.client.get<Supplier[]>('/suppliers/').then(r => r.data)
  createSupplier = (data: Partial<Supplier>) =>
    this.client.post<Supplier>('/suppliers/', data).then(r => r.data)
  updateSupplier = (id: number, data: Partial<Supplier>) =>
    this.client.patch<Supplier>(`/suppliers/${id}/`, data).then(r => r.data)
  deleteSupplier = (id: number) =>
    this.client.delete(`/suppliers/${id}/`).then(() => undefined)

  // -------- Supplier contracts (договори постачальників) --------
  getSupplierContracts = (params?: { supplier_id?: number; service_id?: number }) =>
    this.client.get<SupplierContract[]>('/supplier-contracts/', { params }).then(r => r.data)
  createSupplierContract = (data: Partial<SupplierContract>) =>
    this.client.post<SupplierContract>('/supplier-contracts/', data).then(r => r.data)
  updateSupplierContract = (id: number, data: Partial<SupplierContract>) =>
    this.client.patch<SupplierContract>(`/supplier-contracts/${id}/`, data).then(r => r.data)
  deleteSupplierContract = (id: number) =>
    this.client.delete(`/supplier-contracts/${id}/`).then(() => undefined)

  // -------- Supplier bills (місячні записи постачальників) --------
  getSupplierBills = (params?: { service_id?: number; supplier_contract_id?: number; year?: number }) =>
    this.client.get<SupplierBill[]>('/supplier-bills/', { params }).then(r => r.data)
  updateSupplierBill = (id: number, data: Partial<SupplierBill>) =>
    this.client.patch<SupplierBill>(`/supplier-bills/${id}/`, data).then(r => r.data)

  // Годовые планы фондов поставщика: ?service_id + ?year — все планы для «Рахунків»
  getSupplierFundPlans = (params?: { service_id?: number; supplier_contract_id?: number; year?: number }) =>
    this.client.get<SupplierFundPlan[]>('/supplier-fund-plans/', { params }).then(r => r.data)
  createSupplierFundPlan = (data: Partial<SupplierFundPlan>) =>
    this.client.post<SupplierFundPlan>('/supplier-fund-plans/', data).then(r => r.data)
  updateSupplierFundPlan = (id: number, data: Partial<SupplierFundPlan>) =>
    this.client.patch<SupplierFundPlan>(`/supplier-fund-plans/${id}/`, data).then(r => r.data)

  // -------- Версія застосунку --------
  getLatestVersion = () =>
    this.client.get<{ latest_version: string }>('/version/').then(r => r.data)
}

export default BillingApiService
