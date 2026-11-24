import useSWR, { type SWRConfiguration } from 'swr'
import { useAuthContext } from '@/context/auth-provider'
import type { BillingApiService } from '@/lib/api-client'
import { hasActiveEdits } from '@/lib/unsaved-tracker'

// Інтервал авто-оновлення спільних даних (мс).
// Вирішує проблему "одночасного редагування": якщо інший користувач
// у мережі змінив дані — вони підтягнуться максимум через цей час.
const REFRESH_INTERVAL = 30_000

/**
 * Generic SWR hook helper — auto-injects apiService dependency.
 * Use one of the typed wrappers below.
 */
function useApiSWR<T>(
  key: string | null,
  fetcher: (api: BillingApiService) => Promise<T>,
  // NoInfer: T выводится только из fetcher. Без него liveConfig
  // (SWRConfiguration<any>) «заражал» вывод, и data у всех live-хуков была any
  config?: SWRConfiguration<NoInfer<T>>,
) {
  const { apiService } = useAuthContext()
  return useSWR<T>(key, () => fetcher(apiService), config)
}

// Конфіг авто-оновлення для "живих" даних (рахунки, періоди).
// isPaused: поки користувач редагує комірку — refresh не спрацьовує,
// щоб не збити введені дані під час набору.
const liveConfig: SWRConfiguration = {
  refreshInterval: REFRESH_INTERVAL,
  isPaused: () => hasActiveEdits(),
}

// -------- Tenants --------
export const useTenants = () =>
  useApiSWR('/tenants', api => api.getTenants())

export const useTenant = (id: number | null) =>
  useApiSWR(id ? `/tenants/${id}` : null, api => api.getTenant(id!))

// -------- Contracts --------
export const useContracts = (tenantId?: number) =>
  useApiSWR(
    tenantId ? `/contracts?tenant_id=${tenantId}` : '/contracts',
    api => api.getContracts(tenantId),
  )

export const useContract = (id: number | null) =>
  useApiSWR(id ? `/contracts/${id}` : null, api => api.getContract(id!))

// -------- Reimbursement contracts (договори відшкодування) --------
export const useReimbursements = () =>
  useApiSWR('/reimbursement-contracts', api => api.getReimbursements())

// -------- Services --------
export const useServices = () =>
  useApiSWR('/services', api => api.getServices())

// -------- Service rates (історія тарифів) --------
export const useServiceRates = (serviceId: number | null) =>
  useApiSWR(
    serviceId ? `/service-rates?service_id=${serviceId}` : null,
    api => api.getServiceRates(serviceId!),
  )

// -------- ContractServices --------
export const useContractServices = (params?: { contract_id?: number; service_id?: number }) => {
  const key = params
    ? `/contract-services?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    : '/contract-services'
  return useApiSWR(key, api => api.getContractServices(params))
}

// -------- Suppliers (постачальники) --------
export const useSuppliers = () =>
  useApiSWR('/suppliers', api => api.getSuppliers())

export const useSupplierContracts = (params?: { supplier_id?: number; service_id?: number }) => {
  const key = params
    ? `/supplier-contracts?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
    : '/supplier-contracts'
  return useApiSWR(key, api => api.getSupplierContracts(params))
}

// Місячні записи постачальників — "живі" дані, як рахунки орендарів
export const useSupplierBills = (params?: { service_id?: number; year?: number }) => {
  const key = params
    ? `/supplier-bills?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
    : '/supplier-bills'
  return useApiSWR(key, api => api.getSupplierBills(params), liveConfig)
}

// Годовые планы фондов поставщика по услуге и году (SWR-ключ — URL, как у записей)
export const useSupplierFundPlans = (params?: { service_id?: number; supplier_contract_id?: number; year?: number }) => {
  const key = params
    ? `/supplier-fund-plans?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
    : '/supplier-fund-plans'
  return useApiSWR(key, api => api.getSupplierFundPlans(params), liveConfig)
}

// -------- Periods --------
export const usePeriods = () =>
  useApiSWR('/periods', api => api.getPeriods(), liveConfig)

// -------- Bills --------
export const useBills = (params?: {
  service_id?: number
  tenant_id?: number
  contract_id?: number
  year?: number
  month?: number
}) => {
  const key = params
    ? `/bills?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
    : '/bills'
  return useApiSWR(key, api => api.getBills(params), liveConfig)
}
