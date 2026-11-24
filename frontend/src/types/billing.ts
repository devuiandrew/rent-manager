// ============================================================================
// Backend API models — match Django models 1:1
// ============================================================================

export interface Tenant {
  id: number
  name: string
  tax_id: string
  phone: string
  email: string
  contact_person: string
  created_at: string
  updated_at: string
}

export interface Contract {
  id: number
  tenant_id: number
  tenant_name: string
  contract_number: string
  address: string
  area_size: string // Decimal serializes as string in DRF
  date_start: string
  date_end: string | null
  is_active: boolean
  // Read-only: номер действующего СЕГОДНЯ договора відшкодування ('' если нет).
  // Вычисляется на бэке из истории документов; привязка — через ReimbursementContract
  reimbursement_number: string
  created_at: string
  updated_at: string
}

// Договір відшкодування — документ на период (~год), покрывает 1..N договоров аренды.
// Периоды документов одного договора не пересекаются (валидация на бэке)
export interface ReimbursementContract {
  id: number
  number: string
  date_start: string // YYYY-MM-DD
  date_end: string
  note: string
  contract_ids: number[]
  // Данные договоров для отображения — read-only с бэкенда
  contracts_info: { id: number; contract_number: string; tenant_name: string }[]
  created_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface Service {
  id: number
  name: string
  unit_name: string
  default_rate: string // Decimal — начальное значение/fallback
  current_rate: string // Decimal — действующий сегодня тариф (из истории ServiceRate)
  // Ближайшая будущая смена тарифа (для бейджа), null если изменений нет
  upcoming_change: { rate: string; effective_from: string } | null
  color: string
  created_at: string
}

// Запись истории тарифа услуги (модель ServiceRate на бэке)
export interface ServiceRate {
  id: number
  service_id: number
  rate: string // Decimal
  effective_from: string // YYYY-MM-DD — дата начала действия
  note: string
  created_at: string
  created_by: number | null
  created_by_name: string | null
}

export interface ContractService {
  id: number
  contract_id: number
  service_id: number
  // Дані послуги — read-only з бекенду, не потрібно робити окремий запит
  service_name: string
  service_unit_name: string
  service_default_rate: string  // Decimal
  service_current_rate: string  // Decimal — актуальный тариф услуги (из истории, на сегодня)
  service_color: string
  personal_rate: string | null  // Decimal or null — null = використовується загальний
  effective_rate: string        // Decimal — обчислюється на бекенді
  is_active: boolean
  // Річний план за договором (вводиться вручну в білінг-таблиці)
  planned_amount: string | null  // Decimal — «Сума за договором», грн
  planned_volume: string | null  // Decimal — «Обсяг за договором», натуральні од.
}

// Сущность, по которой закрывается период — зеркало LockScope на бэке.
// landlords есть в модели, но закрывать его API пока не даёт (вкладки нет)
export type LockScope = 'tenants' | 'suppliers' | 'landlords'

export interface PeriodLockInfo {
  closed_by: number | null
  closed_at: string
}

export interface BillingPeriod {
  id: number
  year: number
  month: number
  // Замок АРЕНДАТОРОВ — старые поля, оставлены для совместимости
  is_closed: boolean
  closed_by: number | null
  closed_at: string | null
  // Замок по каждой сущности; null — период для неё открыт.
  // Optional: старый бэкенд (до B2) поля не отдаёт
  locks?: Record<LockScope, PeriodLockInfo | null>
}

export interface Bill {
  id: number
  contract_id: number
  service_id: number
  period_id: number
  year: number
  month: number
  debt_start: string // Decimal
  quantity: string
  rate: string
  accrued_amount: string
  is_manual_accrual: boolean // нарах. введене вручну — генерація/оновлення тарифів його не чіпає
  paid_amount: string
  correction: string
  debt_end: string // Decimal — computed
  is_verified: boolean
  verified_by: number | null
  verified_at: string | null
  created_at: string
  updated_at: string
  created_by: number | null
}

// Постачальник послуги (газ, вода) — зеркало Tenant
export interface Supplier {
  id: number
  name: string
  tax_id: string
  phone: string
  email: string
  contact_person: string
  created_at: string
  updated_at: string
}

// Договір з постачальником на одну послугу. Периоды договоров одной услуги
// не пересекаются (валидация на бэке) — в момент времени один действующий поставщик
export interface SupplierContract {
  id: number
  supplier_id: number
  supplier_name: string
  service_id: number
  service_name: string
  service_unit_name: string
  number: string
  date_start: string // YYYY-MM-DD
  date_end: string | null // null = безстроковий
  note: string
  created_at: string
  updated_at: string
}

// Місячний запис постачальника — зеркало Bill без верификации.
// Закрытие периодов на него НЕ действует (редактируется всегда)
// Бюджетный фонд записи поставщика — зеркало Fund на бэке.
// На месяц у договора ДВА записи: спец. (возмещения арендаторов) и общий (бюджет)
export type SupplierFund = 'spec' | 'general'

export interface SupplierBill {
  id: number
  supplier_contract_id: number
  period_id: number
  service_id: number // read-only, из договора — для группировки по услуге
  year: number
  month: number
  fund: SupplierFund
  debt_start: string // Decimal
  quantity: string
  rate: string
  accrued_amount: string
  is_manual_accrual: boolean // дзеркало Bill.is_manual_accrual
  paid_amount: string
  correction: string
  debt_end: string // Decimal — computed
  created_at: string
  updated_at: string
  created_by: number | null
}

// Годовой план договора поставщика по одному фонду. Нет записи — плана нет.
// Год обязателен (в отличие от ContractService.planned_*): договор бывает
// бессрочным, а план каждый год свой
export interface SupplierFundPlan {
  id: number
  supplier_contract_id: number
  service_id: number // read-only, из договора
  year: number
  fund: SupplierFund
  planned_amount: string | null // Decimal
  planned_volume: string | null // Decimal
}

// ============================================================================
// UI-level aggregated types — used by billing-table to display month-grouped data
// ============================================================================

export interface MonthData {
  billId: number
  consumption: number
  rate: number
  charged: number
  isManualAccrual: boolean // нарах. введене вручну — «Спожито» (consumption × rate) лишається довідковим
  paid: number
  correction: number
  isVerified: boolean
}

// Ссылка «договор → его документ відшкодування» для строк таблицы.
// groupSize — сколько всего договоров под документом: 2+ → строка уходит
// в отдельную секцию таблицы, 0/1 → остаётся в основной
export interface ReimbursementRef {
  id: number
  number: string
  groupSize: number
}

export interface MonthlyBillData {
  tenantId: number
  tenantName: string
  contractId: number
  contractNumber: string
  // Документ відшкодування, действующий в просматриваемом году (резолв по дате);
  // null = документа нет
  reimbursement: ReimbursementRef | null
  area: number
  address: string
  serviceId: number
  months: {
    january?: MonthData
    february?: MonthData
    march?: MonthData
    april?: MonthData
    may?: MonthData
    june?: MonthData
    july?: MonthData
    august?: MonthData
    september?: MonthData
    october?: MonthData
    november?: MonthData
    december?: MonthData
  }
  // Ручний річний план (з ContractService); null = зв'язок не знайдено / план не заданий
  contractServiceId: number | null
  plannedAmount: number | null
  plannedVolume: number | null
}

// Данные месяца поставщика — как MonthData, но без верификации (её у поставщика нет)
export type SupplierMonthData = Omit<MonthData, 'isVerified'>

// Строка секции «Постачальник» в «Рахунках»: договор поставщика + мапа месяцев
export interface SupplierMonthlyData {
  supplierContractId: number
  // Строка = пара (договор, фонд), поэтому supplierContractId у двух строк одинаковый
  fund: SupplierFund
  supplierName: string
  contractNumber: string
  // Годовой план фонда на просматриваемый год (SupplierFundPlan).
  // planId = null — плана ещё нет, первая правка в таблице его создаст
  planId: number | null
  plannedAmount: number | null
  plannedVolume: number | null
  months: {
    january?: SupplierMonthData
    february?: SupplierMonthData
    march?: SupplierMonthData
    april?: SupplierMonthData
    may?: SupplierMonthData
    june?: SupplierMonthData
    july?: SupplierMonthData
    august?: SupplierMonthData
    september?: SupplierMonthData
    october?: SupplierMonthData
    november?: SupplierMonthData
    december?: SupplierMonthData
  }
}
