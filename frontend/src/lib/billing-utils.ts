import type {
    Bill,
    BillingPeriod,
    Contract,
    ContractService,
    MonthlyBillData,
    MonthData,
    Tenant,
    ReimbursementContract,
    ReimbursementRef,
    LockScope,
    SupplierBill,
    SupplierContract,
    SupplierFund,
    SupplierFundPlan,
    SupplierMonthlyData,
} from "@/types/billing";

export const MONTH_KEYS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
] as const;

export type MonthKey = (typeof MONTH_KEYS)[number];

// API повертає Decimal як рядок ('45.50'). Конвертуємо у число для розрахунків
function n(v: string | number): number {
    return typeof v === "number" ? v : Number(v);
}

// Состояние периода для раскраски: закрытый > пройденный > плановый
export type PeriodState = "closed" | "past" | "future";

// Фон ячейки месяца по состоянию периода; пустая ячейка (нет данных) — серая.
// Общая точка для таблицы арендаторов и секции «Постачальник»
export function monthCellBg(state: PeriodState, hasData: boolean): string {
    if (!hasData) return "bg-muted/40";
    if (state === "closed") return "bg-red-50 dark:bg-red-950/30";
    if (state === "future") return "bg-blue-50 dark:bg-blue-950/30";
    return "bg-green-50 dark:bg-green-950/30";
}

// Ячейка «Нарах.», заполненная вручную (is_manual_accrual). Заметная рамка +
// плотная заливка: такую цифру не перезапишет ни кнопка «Нарахування», ни
// перегенерация тарифов, поэтому её надо видеть сразу. Ring (box-shadow),
// а не border — не сдвигает содержимое и не ломает высоту строки.
// Общая точка для таблицы арендаторов и секции «Постачальник»
export const MANUAL_ACCRUAL_CELL =
    "bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-500 dark:ring-amber-500/70 " +
    "font-semibold text-amber-900 dark:text-amber-100";

// Округление денег до 2 знаков с компенсацией погрешности float.
// Пример: 13.75 * 27.444 = 377.35499999999996 (двоичная погрешность),
// а математически 377.355 → должно быть 377.36. toPrecision(13)
// «прищёлкивает» хвост погрешности до округления.
export function roundMoney(value: number): string {
    return (Math.round(Number((value * 100).toPrecision(13))) / 100).toFixed(2);
}

// «Спожито» = обсяг × тариф — справочная величина, всегда по формуле
// (в отличие от «Нарах.», которое можно ввести вручную). Единственное место
// формулы: таблица арендаторов, строки поставщика, Excel.
// Строка — как у roundMoney; где нужно число, вызывающий оборачивает в Number()
export function consumedAmount(consumption: number, rate: number): string {
    return roundMoney(consumption * rate);
}

// Сегодня в формате YYYY-MM-DD. Строим локально: toISOString даёт UTC —
// возможен сдвиг на день около полуночи
export function todayIso(): string {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${mm}-${dd}`;
}

// '2026-08-01' → '01.08.2026'
export function formatDate(iso: string): string {
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
}

// Дата, на которую резолвим документ для просматриваемого года:
// сегодня, зажатое в границы [01.01, 31.12] года. Прошлый год → 31.12,
// будущий → 01.01, текущий → сегодня
export function reimbursementResolveDate(year: number): string {
    const today = todayIso();
    const lo = `${year}-01-01`;
    const hi = `${year}-12-31`;
    if (today < lo) return lo;
    if (today > hi) return hi;
    return today;
}

/**
 * Резолвит для каждого договора действующий документ відшкодування.
 * Периоды документов одного договора не пересекаются (гарантия бэка),
 * поэтому на дату подходит максимум один документ.
 */
export function resolveReimbursements(
    docs: ReimbursementContract[],
    year: number,
): Map<number, ReimbursementRef> {
    const onDate = reimbursementResolveDate(year);
    const map = new Map<number, ReimbursementRef>();
    for (const doc of docs) {
        // ISO-строки YYYY-MM-DD корректно сравниваются лексикографически
        if (doc.date_start > onDate || doc.date_end < onDate) continue;
        for (const contractId of doc.contract_ids) {
            map.set(contractId, {
                id: doc.id,
                number: doc.number,
                groupSize: doc.contract_ids.length,
            });
        }
    }
    return map;
}

/**
 * Разбивает строки на основную таблицу и секции відшкодувань:
 * документ на 2+ договоров → своя секция (порядок секций = первое появление),
 * иначе строка остаётся в основной части. Единая точка бизнес-правила
 * для таблицы «Рахунки» и Excel-экспорта.
 */
export function partitionReimbursementSections<T>(
    items: T[],
    getData: (item: T) => MonthlyBillData,
): {main: T[]; sections: {id: number; number: string; rows: T[]}[]} {
    const main: T[] = [];
    const byId = new Map<number, {id: number; number: string; rows: T[]}>();
    for (const item of items) {
        const rm = getData(item).reimbursement;
        if (rm && rm.groupSize >= 2) {
            let sec = byId.get(rm.id);
            if (!sec) {
                sec = {id: rm.id, number: rm.number, rows: []};
                byId.set(rm.id, sec);
            }
            sec.rows.push(item);
        } else {
            main.push(item);
        }
    }
    return {main, sections: [...byId.values()]};
}

/**
 * Договоры, отображаемые по услуге: активные + действуют в выбранном году
 * + услуга подключена (активная связь ContractService). serviceId = null →
 * по услуге не фильтруем (страница грузит связи уже отфильтрованными с бэка).
 * contractServices = undefined → связи ещё не загружены, по ним не фильтруем
 * (иначе таблица мигает пустотой при первом рендере).
 * Единая точка правила для таблицы «Рахунки» и Excel-экспорта.
 */
export function filterBillingContracts(
    contracts: Contract[],
    contractServices: ContractService[] | undefined,
    serviceId: number | null,
    year: number,
): Contract[] {
    const linkedIds = contractServices
        ? new Set(
              contractServices
                  .filter(
                      (cs) =>
                          (serviceId === null || cs.service_id === serviceId) &&
                          cs.is_active,
                  )
                  .map((cs) => cs.contract_id),
          )
        : null;
    return contracts.filter((c) => {
        if (!c.is_active) return false;
        if (linkedIds !== null && !linkedIds.has(c.id)) return false;
        // Срок договора пересекается с выбранным годом (без date_end = бессрочный)
        const startYear = parseInt(c.date_start.substring(0, 4), 10);
        const endYear = c.date_end
            ? parseInt(c.date_end.substring(0, 4), 10)
            : 9999;
        return startYear <= year && endYear >= year;
    });
}

/**
 * Перетворює плоский список Bill[] з API у структуру для таблиці.
 *
 * Логіка:
 * - Беремо всі активні договори (вони мають бути показані навіть якщо рахунків
 *   за них ще нема — порожній рядок з '—' у комірках)
 * - Для кожного договору будуємо MonthlyBillData з мапою місяців
 * - Заповнюємо комірки тих місяців, для яких є реальний Bill
 */
export function groupBillsByContract(
    bills: Bill[],
    contracts: Contract[],
    tenants: Tenant[],
    serviceId: number,
    // Зв'язки договір↔послуга — джерело ручного плану (planned_amount/planned_volume)
    contractServices: ContractService[] = [],
    // Документы відшкодування, зарезолвленные на просматриваемый год
    // (см. resolveReimbursements). Пустая Map = группировка не используется
    reimbursements: Map<number, ReimbursementRef> = new Map(),
): MonthlyBillData[] {
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    // Зв'язок за contract_id (фільтруємо за поточною послугою)
    const csByContract = new Map(
        contractServices
            .filter((cs) => cs.service_id === serviceId)
            .map((cs) => [cs.contract_id, cs]),
    );
    // Bills у словнику за contract_id для O(1) пошуку
    const billsByContract = new Map<number, Bill[]>();
    for (const bill of bills) {
        const arr = billsByContract.get(bill.contract_id) ?? [];
        arr.push(bill);
        billsByContract.set(bill.contract_id, arr);
    }

    return contracts.map((contract) => {
        const tenant = tenantById.get(contract.tenant_id);
        const contractBills = billsByContract.get(contract.id) ?? [];
        const cs = csByContract.get(contract.id);
        // Номер із резолва по году (не contract.reimbursement_number — тот
        // считается «на сегодня» и врёт для прошлых/будущих лет)
        const rm = reimbursements.get(contract.id);

        // Заповнюємо комірки для кожного місяця, де є рахунок
        const months: Partial<Record<MonthKey, MonthData>> = {};
        for (const bill of contractBills) {
            const key = MONTH_KEYS[bill.month - 1];
            if (!key) continue;
            months[key] = {
                billId: bill.id,
                consumption: n(bill.quantity),
                rate: n(bill.rate),
                charged: n(bill.accrued_amount),
                isManualAccrual: bill.is_manual_accrual,
                paid: n(bill.paid_amount),
                correction: n(bill.correction),
                isVerified: bill.is_verified,
            };
        }

        return {
            tenantId: contract.tenant_id,
            tenantName: tenant?.name ?? "—",
            contractId: contract.id,
            contractNumber: contract.contract_number,
            reimbursement: rm ?? null,
            area: n(contract.area_size),
            address: contract.address,
            serviceId,
            months,
            contractServiceId: cs?.id ?? null,
            plannedAmount:
                cs?.planned_amount != null ? n(cs.planned_amount) : null,
            plannedVolume:
                cs?.planned_volume != null ? n(cs.planned_volume) : null,
        };
    });
}

/**
 * Знаходить Bill за конкретний місяць у списку.
 * Потрібно для редагування комірки — щоб дізнатися id рахунку для PATCH.
 */
export function findBill(
    bills: Bill[],
    contractId: number,
    month: number,
): Bill | undefined {
    return bills.find((b) => b.contract_id === contractId && b.month === month);
}

/**
 * Договоры поставщиков по услуге, действующие в выбранном году —
 * зеркало filterBillingContracts (date_end = null → бессрочный).
 * Единая точка правила для секции «Постачальник» и Excel-экспорта.
 */
export function filterSupplierContracts(
    contracts: SupplierContract[],
    serviceId: number,
    year: number,
): SupplierContract[] {
    return contracts.filter((sc) => {
        if (sc.service_id !== serviceId) return false;
        const startYear = parseInt(sc.date_start.substring(0, 4), 10);
        const endYear = sc.date_end
            ? parseInt(sc.date_end.substring(0, 4), 10)
            : 9999;
        return startYear <= year && endYear >= year;
    });
}

// Нарастающий долг по месяцам года: долг месяца = Σ (нарах. + корекція −
// сплач.) с января по этот месяц включительно. Задачи клиента «Борг з січня
// переноситься на лютий» и «Борг = нарахування за всі попередні місяці −
// сплачено»: неоплаченный январь висит долгом и в феврале.
// Месяц без записи долг не меняет — переносит предыдущий.
// Год начинается с 0: перенос из прошлого года не считаем (вопрос клиенту).
// Считается из данных месяцев, а не из серверного debt_start: тот
// записывается один раз при генерации и устаревает после правок января.
// Декабрь = «Заг. борг» за год
export function runningDebts(
    months: Partial<
        Record<MonthKey, {charged: number; correction: number; paid: number}>
    >,
): number[] {
    let acc = 0;
    return MONTH_KEYS.map((mk) => {
        const m = months[mk];
        // half-up на каждом шаге: нарастающий итог копит погрешность float
        if (m) acc = Number(roundMoney(acc + m.charged + m.correction - m.paid));
        return acc;
    });
}

// Нормализация для поиска: регистр, апострофы и кавычки, лишние пробелы.
// В украинских названиях встречаются все варианты апострофа (' ʼ ’ `) —
// пользователь не должен угадывать, какой стоит в базе
export function normalizeSearchText(s: string): string {
    return s
        .toLowerCase()
        .replace(/[ʼ’‘`´]/g, "'")
        .replace(/["«»„“”]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// Строка «Рахунків» подходит под запрос, если КАЖДОЕ слово запроса есть в её
// тексте: «укргазбанк 10182» находит договор, хотя имя и номер — разные
// колонки. Ищем только по тексту (имя, адрес, номера договоров) — по суммам
// и объёмам поиск давал ложные совпадения («10» находило любой тариф 10)
export function matchesBillingSearch(
    row: MonthlyBillData,
    query: string,
): boolean {
    const words = normalizeSearchText(query).split(" ").filter(Boolean);
    if (words.length === 0) return true;
    const haystack = normalizeSearchText(
        [
            row.tenantName,
            row.address,
            row.contractNumber,
            row.reimbursement?.number ?? "",
        ].join(" "),
    );
    return words.every((w) => haystack.includes(w));
}

// Сущности, которые можно закрыть в диалоге. landlords пока нет — вкладки
// «Орендодавці» ещё нет, и API такой замок отклоняет
export const CLOSABLE_SCOPES = ["tenants", "suppliers"] as const;
export type ClosableScope = (typeof CLOSABLE_SCOPES)[number];

export const LOCK_SCOPE_LABELS: Record<ClosableScope, string> = {
    tenants: "Орендарі",
    suppliers: "Постачальники",
};

// Закрыт ли период для сущности — единая проверка для диалога и таблицы.
// Старый бэкенд (до B2) не отдаёт locks: тогда для арендаторов берём
// is_closed, остальные считаем открытыми
export function isPeriodClosedFor(p: BillingPeriod, scope: LockScope): boolean {
    if (p.locks) return p.locks[scope] != null;
    return scope === "tenants" ? p.is_closed : false;
}

// Порядок строк фондов в блоке поставщика — спец. первым, как на бэке (ordering -fund)
export const SUPPLIER_FUNDS: readonly SupplierFund[] = ["spec", "general"];

// Короткие подписи фондов — таблица, Excel, строки подытогов
export const FUND_LABELS: Record<SupplierFund, string> = {
    spec: "Спец. фонд",
    general: "Заг. фонд",
};

/**
 * Превращает плоский список SupplierBill[] в строки секции «Постачальник».
 * Строка = пара (договор, фонд): на месяц у договора два записи, поэтому
 * на каждый договор — ДВЕ строки, всегда, даже если записей одного фонда
 * ещё нет (пустые месяцы покажут «—», как у арендаторов).
 * plans — годовые планы фондов, УЖЕ отфильтрованные по просматриваемому году
 * (API отдаёт их по ?year) — план привязывается к строке по той же паре.
 */
export function groupSupplierBills(
    bills: SupplierBill[],
    contracts: SupplierContract[],
    plans: SupplierFundPlan[] = [],
): SupplierMonthlyData[] {
    // Ключ — пара (договор, фонд). По одному договору записи двух фондов
    // одного месяца перезаписывали друг друга
    const billsByKey = new Map<string, SupplierBill[]>();
    for (const bill of bills) {
        const key = `${bill.supplier_contract_id}:${bill.fund}`;
        const arr = billsByKey.get(key) ?? [];
        arr.push(bill);
        billsByKey.set(key, arr);
    }
    const planByKey = new Map<string, SupplierFundPlan>();
    for (const plan of plans) {
        planByKey.set(`${plan.supplier_contract_id}:${plan.fund}`, plan);
    }

    return contracts.flatMap((sc) =>
        SUPPLIER_FUNDS.map((fund) => {
            const plan = planByKey.get(`${sc.id}:${fund}`);
            const months: SupplierMonthlyData["months"] = {};
            for (const bill of billsByKey.get(`${sc.id}:${fund}`) ?? []) {
                const monthKey = MONTH_KEYS[bill.month - 1];
                if (!monthKey) continue;
                months[monthKey] = {
                    billId: bill.id,
                    consumption: n(bill.quantity),
                    rate: n(bill.rate),
                    charged: n(bill.accrued_amount),
                    isManualAccrual: bill.is_manual_accrual,
                    paid: n(bill.paid_amount),
                    correction: n(bill.correction),
                };
            }
            return {
                supplierContractId: sc.id,
                fund,
                supplierName: sc.supplier_name,
                contractNumber: sc.number,
                planId: plan?.id ?? null,
                // null остаётся null: «плана нет» и «план = 0» — разные вещи
                plannedAmount:
                    plan?.planned_amount != null
                        ? n(plan.planned_amount)
                        : null,
                plannedVolume:
                    plan?.planned_volume != null
                        ? n(plan.planned_volume)
                        : null,
                months,
            };
        }),
    );
}

/** Українські назви місяців. */
export const MONTH_NAMES_UK = [
    "Січень",
    "Лютий",
    "Березень",
    "Квітень",
    "Травень",
    "Червень",
    "Липень",
    "Серпень",
    "Вересень",
    "Жовтень",
    "Листопад",
    "Грудень",
] as const;

export function monthName(month: number): string {
    return MONTH_NAMES_UK[month - 1] ?? "?";
}
