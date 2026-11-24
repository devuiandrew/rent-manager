import {useState, useCallback, useMemo, useEffect, useRef} from "react";
import {toast} from "sonner";
import {useSWRConfig} from "swr";
import {BillingTable} from "./billing-table";
import {ClosePeriodDialog} from "./close-period-dialog";
import {GenerateBillsDialog} from "./generate-bills-dialog";
import {MarkPaidDialog} from "./mark-paid-dialog";
import {MarkAccruedDialog} from "./mark-accrued-dialog";
import {useAuthContext} from "@/context/auth-provider";
import {
    useBills,
    useContracts,
    useServices,
    useTenants,
    usePeriods,
    useContractServices,
    useReimbursements,
    useSupplierContracts,
    useSupplierBills,
    useSupplierFundPlans,
} from "@/hooks/use-billing-data";
import {
    filterBillingContracts,
    groupBillsByContract,
    resolveReimbursements,
    findBill,
    filterSupplierContracts,
    groupSupplierBills,
    roundMoney,
    MONTH_NAMES_UK,
} from "@/lib/billing-utils";
import type {
    Bill,
    BillingPeriod,
    ContractService,
    SupplierBill,
    SupplierFund,
    SupplierFundPlan,
} from "@/types/billing";
import {Spinner} from "@/components/ui/spinner";
import {getApiError} from "@/lib/api-error";
import {Inbox} from "lucide-react";

export function BillingPage() {
    const {apiService, isAccountant, isManager} = useAuthContext();
    const {mutate} = useSWRConfig();

    const [year, setYear] = useState(new Date().getFullYear());
    // activeServiceId — null поки не завантажились послуги. Після — беремо першу
    const [activeServiceId, setActiveServiceId] = useState<number | null>(null);
    const [closePeriodDialogOpen, setClosePeriodDialogOpen] = useState(false);
    const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
    const [markPaidDialogOpen, setMarkPaidDialogOpen] = useState(false);
    const [markAccruedDialogOpen, setMarkAccruedDialogOpen] = useState(false);
    // Флаг щоб нагадування показувалось тільки один раз за сесію
    const reminderShown = useRef(false);

    // Завантажуємо довідники
    const {data: services, isLoading: servicesLoading} = useServices();
    const {data: tenants} = useTenants();
    const {data: contracts} = useContracts();
    const {data: periods, mutate: mutatePeriods} = usePeriods();
    const {data: reimbursements} = useReimbursements();

    // Нагадування: якщо поточний місяць без рахунків — показати toast
    useEffect(() => {
        // Тільки для менеджера, тільки з 3-го числа, тільки якщо дивимось поточний рік
        if (!isManager) return;
        if (!periods) return;
        if (reminderShown.current) return;

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const dayOfMonth = now.getDate();

        // Не нагадуємо 1-2 числа — адмін міг ще не встигнути
        if (dayOfMonth < 3) return;
        if (year !== currentYear) return;

        const hasBillsThisMonth = periods.some(
            (p: BillingPeriod) =>
                p.year === currentYear && p.month === currentMonth,
        );

        if (!hasBillsThisMonth) {
            reminderShown.current = true;
            const monthLabel = MONTH_NAMES_UK[currentMonth - 1];
            toast.warning(
                <div>
                    <div className="font-semibold">
                        Рахунки за {monthLabel} {currentYear} не створено
                    </div>
                    <div className="text-sm opacity-80 mt-0.5">
                        Натисніть «Згенерувати» щоб створити рахунки за поточний
                        місяць
                    </div>
                </div>,
                {duration: 10000},
            );
        }
    }, [isManager, periods, year]);

    // Дефолт: перша послуга у списку
    // useMemo щоб не пересчитувати на кожному рендері
    const effectiveServiceId = useMemo(() => {
        if (activeServiceId !== null) return activeServiceId;
        return services?.[0]?.id ?? null;
    }, [activeServiceId, services]);

    // Завантажуємо рахунки тільки коли є послуга
    const {
        data: bills,
        isLoading: billsLoading,
        error,
    } = useBills(
        effectiveServiceId ? {service_id: effectiveServiceId, year} : undefined,
    );

    // Перевіряємо чи є договори, прив'язані до поточної послуги (ContractService)
    const {data: contractServices} = useContractServices(
        effectiveServiceId ? {service_id: effectiveServiceId} : undefined,
    );

    // Дані секції «Постачальник»: договори + місячні записи поточної послуги/року
    const {data: supplierContracts} = useSupplierContracts(
        effectiveServiceId ? {service_id: effectiveServiceId} : undefined,
    );
    const {data: supplierBills} = useSupplierBills(
        effectiveServiceId ? {service_id: effectiveServiceId, year} : undefined,
    );
    // Годовые планы фондов — тот же ключ (услуга + год), что у записей
    const {data: supplierPlans} = useSupplierFundPlans(
        effectiveServiceId ? {service_id: effectiveServiceId, year} : undefined,
    );

    // Договори, що відображаються в таблиці: активні + діють у вибраному році
    // + мають підключену поточну послугу. Правило спільне з Excel-експортом
    // (filterBillingContracts); service_id тут не передаємо — зв'язки вже
    // відфільтровані бекендом за поточною послугою
    const activeContracts = useMemo(
        () =>
            filterBillingContracts(contracts ?? [], contractServices, null, year),
        [contracts, contractServices, year],
    );

    // Роки з реальних договорів — для селектора у таблиці
    const availableYears = useMemo(() => {
        if (!contracts?.length) return [new Date().getFullYear()];
        const years = new Set<number>();
        contracts.forEach((c) => {
            years.add(parseInt(c.date_start.substring(0, 4), 10));
            if (c.date_end) years.add(parseInt(c.date_end.substring(0, 4), 10));
        });
        years.add(new Date().getFullYear());
        return Array.from(years).sort((a, b) => b - a);
    }, [contracts]);

    // Документи відшкодування, чинні у вибраному році (див. resolveReimbursements)
    const reimbursementMap = useMemo(
        () => resolveReimbursements(reimbursements ?? [], year),
        [reimbursements, year],
    );

    // Перетворюємо плоский Bill[] у структуру для таблиці
    const tableData = useMemo(() => {
        if (!bills || !tenants || !effectiveServiceId) return [];
        return groupBillsByContract(
            bills,
            activeContracts,
            tenants,
            effectiveServiceId,
            contractServices ?? [],
            reimbursementMap,
        );
    }, [
        bills,
        tenants,
        activeContracts,
        effectiveServiceId,
        contractServices,
        reimbursementMap,
    ]);

    // Рядки секції «Постачальник»: договори постачальників поточної послуги,
    // що діють у вибраному році. Порожній масив → секція не рендериться
    const supplierTableData = useMemo(() => {
        if (!supplierContracts || !effectiveServiceId) return [];
        const active = filterSupplierContracts(
            supplierContracts,
            effectiveServiceId,
            year,
        );
        return groupSupplierBills(
            supplierBills ?? [],
            active,
            supplierPlans ?? [],
        );
    }, [supplierContracts, supplierBills, supplierPlans, effectiveServiceId, year]);

    // Місяці поточного РОКУ, за які вже є рахунки саме по вибраній послузі.
    // bills завантажені під (effectiveServiceId + year), тому це рівно "ця послуга за цей рік".
    // Явна анотація (b: Bill) і Set<number> — бо useBills через liveConfig
    // виводить data як any (той самий обхід, що і з BillingPeriod вище)
    const serviceBillMonths = useMemo(
        () => new Set<number>((bills ?? []).map((b: Bill) => b.month)),
        [bills],
    );
    // Назва вибраної послуги — для тексту підказки
    const activeServiceName = useMemo(
        () => services?.find((s) => s.id === effectiveServiceId)?.name ?? "",
        [services, effectiveServiceId],
    );

    const handleServiceChange = useCallback((serviceId: number) => {
        setActiveServiceId(serviceId);
    }, []);

    const handleYearChange = useCallback((newYear: number) => {
        setYear(newYear);
    }, []);

    // PATCH /api/bills/{id}/ — редагування комірки таблиці.
    //
    // Нарахування НЕ проставляється саме (рішення клієнта 2026-09-04): ввід
    // показника міняє тільки обсяг, «Нарах.» лишається нулем, поки бухгалтер
    // не проставить його свідомо — вручну в комірці або кнопкою «Нарахування»
    // в тулбарі (масово, POST /api/periods/mark-accrued/). Причина: помісячні
    // цифри в програмі мають збігатися з паперовими документами, а з
    // нарахуванням регулярно трапляються форс-мажори (напр. договір укладено
    // пізніше фактичного початку оренди). Простіше поправити одиниці, ніж
    // проставляти кожному.
    // - Пряме редагування "charged" (колонка «Нарах.») встановлює is_manual_accrual —
    //   таку комірку не чіпає ні кнопка, ні перегенерація з --update-rates.
    // - Формула обсяг × тариф лишається довідковою в колонці «Спожито» —
    //   вона рахується на льоту при рендері, в БД не зберігається.
    //
    // Optimistic update: оновлюємо локальний кеш SWR без рефетчу — щоб не
    // скидати скрол таблиці і не блимати спіннером.
    const handleUpdateCell = useCallback(
        async (
            contractId: number,
            month: number,
            field: "consumption" | "rate" | "charged" | "paid" | "correction",
            value: number,
        ) => {
            if (!bills) return;
            // Шукаємо рахунок напряму по contractId — без ризику знайти не той договір
            const bill = findBill(bills, contractId, month);
            if (!bill) {
                toast.error("Рахунок за цей місяць ще не створено");
                return;
            }

            const payload: Record<string, string | boolean> = {};

            if (field === "consumption") {
                payload.quantity = String(value);
            } else if (field === "rate") {
                payload.rate = String(value);
            } else if (field === "charged") {
                payload.accrued_amount = roundMoney(value);
                payload.is_manual_accrual = true;
            } else if (field === "paid") {
                payload.paid_amount = String(value);
            } else if (field === "correction") {
                payload.correction = String(value);
            }

            try {
                const updated = await apiService.updateBill(bill.id, payload);
                // Оновлюємо ВСІ кеші '/bills...' локально, без рефетчу (зберігає скрол)
                await mutate(
                    (key) =>
                        typeof key === "string" && key.startsWith("/bills"),
                    (current: Bill[] | undefined) => {
                        if (!current) return current;
                        return current.map((b) =>
                            b.id === updated.id ? updated : b,
                        );
                    },
                    {revalidate: false},
                );
            } catch (e: unknown) {
                const msg =
                    e instanceof Error ? e.message : "Помилка збереження";
                toast.error(msg);
            }
        },
        [bills, apiService, mutate],
    );
    // Скидання ручного нарахування — повертає «Нарах.» до формули qty × rate
    // і знімає is_manual_accrual (кнопка-іконка поруч із коміркою в амбер-режимі)
    const handleResetAccrual = useCallback(
        async (contractId: number, month: number) => {
            if (!bills) return;
            const bill = findBill(bills, contractId, month);
            if (!bill) return;
            const payload = {
                accrued_amount: roundMoney(
                    Number(bill.quantity) * Number(bill.rate),
                ),
                is_manual_accrual: false,
            };
            try {
                const updated = await apiService.updateBill(bill.id, payload);
                await mutate(
                    (key) =>
                        typeof key === "string" && key.startsWith("/bills"),
                    (current: Bill[] | undefined) =>
                        current?.map((b) =>
                            b.id === updated.id ? updated : b,
                        ),
                    {revalidate: false},
                );
            } catch (e: unknown) {
                toast.error(getApiError(e, "Помилка скидання нарахування"));
            }
        },
        [bills, apiService, mutate],
    );
    // PATCH /api/contract-services/{id}/ — ручной план «Сума/Обсяг за договором».
    // Optimistic update: обновляем кеш SWR локально, без рефетча (сохраняет скролл)
    const handleUpdatePlanned = useCallback(
        async (
            contractServiceId: number,
            field: "planned_amount" | "planned_volume",
            value: number,
        ) => {
            try {
                const update = await apiService.updateContractService(
                    contractServiceId,
                    {[field]: String(value)},
                );
                await mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/contract-services"),
                    (current: ContractService[] | undefined) =>
                        current?.map((cs) =>
                            cs.id === update.id ? update : cs,
                        ),
                    {revalidate: false},
                );
            } catch (e: unknown) {
                toast.error(getApiError(e, "Помилка збереження плану"));
            }
        },
        [apiService, mutate],
    );
    // Верифікація рахунку бухгалтером — переключає is_verified
    const handleVerifyBill = useCallback(
        async (contractId: number, month: number) => {
            if (!bills) return;
            const bill = findBill(bills, contractId, month);
            if (!bill) return;
            try {
                const updated = bill.is_verified
                    ? await apiService.unverifyBill(bill.id)
                    : await apiService.verifyBill(bill.id);
                await mutate(
                    (key) =>
                        typeof key === "string" && key.startsWith("/bills"),
                    (current: Bill[] | undefined) =>
                        current?.map((b) =>
                            b.id === updated.id ? updated : b,
                        ),
                    {revalidate: false},
                );
            } catch (e: unknown) {
                toast.error(getApiError(e, "Помилка верифікації"));
            }
        },
        [bills, apiService, mutate],
    );
    // PATCH /api/supplier-bills/{id}/ — секция «Постачальник».
    //
    // ВАЖЛИВО: тут auto-recalc лишається (на відміну від орендарів вище) —
    // дані орендарів і постачальників вносять різні люди, і зміна «нарахування
    // не проставляється саме» стосується поки тільки орендарів (рішення
    // клієнта 2026-09-04). Кнопка «Нарахування» постачальників теж не чіпає.
    const handleUpdateSupplierCell = useCallback(
        async (
            billId: number,
            field: "consumption" | "rate" | "charged" | "paid" | "correction",
            value: number,
        ) => {
            if (!supplierBills) return;
            // По id, а не по (договор, месяц): с фондами записей на месяц две
            const bill = supplierBills.find((b) => b.id === billId);
            if (!bill) {
                // Редактируемая ячейка есть только у существующей записи —
                // сюда попадаем лишь при устаревшем кеше
                toast.error("Запис не знайдено — оновіть сторінку");
                return;
            }

            const payload: Record<string, string | boolean> = {};
            if (field === "consumption") {
                payload.quantity = String(value);
                if (!bill.is_manual_accrual) {
                    payload.accrued_amount = roundMoney(
                        value * Number(bill.rate),
                    );
                }
            } else if (field === "rate") {
                payload.rate = String(value);
                if (!bill.is_manual_accrual) {
                    payload.accrued_amount = roundMoney(
                        Number(bill.quantity) * value,
                    );
                }
            } else if (field === "charged") {
                payload.accrued_amount = roundMoney(value);
                payload.is_manual_accrual = true;
            } else if (field === "paid") {
                payload.paid_amount = String(value);
            } else if (field === "correction") {
                payload.correction = String(value);
            }

            try {
                const updated = await apiService.updateSupplierBill(
                    bill.id,
                    payload,
                );
                // Точный префикс /supplier-bills — кеши арендаторов не задеваем
                await mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-bills"),
                    (current: SupplierBill[] | undefined) =>
                        current?.map((b) =>
                            b.id === updated.id ? updated : b,
                        ),
                    {revalidate: false},
                );
            } catch (e: unknown) {
                toast.error(getApiError(e, "Помилка збереження"));
            }
        },
        [supplierBills, apiService, mutate],
    );
    // Зеркало handleResetAccrual для секції «Постачальник»
    const handleResetSupplierAccrual = useCallback(
        async (billId: number) => {
            if (!supplierBills) return;
            const bill = supplierBills.find((b) => b.id === billId);
            if (!bill) return;
            const payload = {
                accrued_amount: roundMoney(
                    Number(bill.quantity) * Number(bill.rate),
                ),
                is_manual_accrual: false,
            };
            try {
                const updated = await apiService.updateSupplierBill(
                    bill.id,
                    payload,
                );
                await mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-bills"),
                    (current: SupplierBill[] | undefined) =>
                        current?.map((b) =>
                            b.id === updated.id ? updated : b,
                        ),
                    {revalidate: false},
                );
            } catch (e: unknown) {
                toast.error(getApiError(e, "Помилка скидання нарахування"));
            }
        },
        [supplierBills, apiService, mutate],
    );
    // Годовой план фонда поставщика — правится прямо в таблице, как
    // «Сума за договором» у арендаторов. Плана на год ещё нет → создаём,
    // есть → обновляем. Год — просматриваемый (планы загружены по нему)
    const handleUpdateSupplierPlan = useCallback(
        async (
            supplierContractId: number,
            fund: SupplierFund,
            field: "planned_amount" | "planned_volume",
            value: number,
        ) => {
            // Деньги — только half-up (roundMoney), объём — как есть
            const payloadValue =
                field === "planned_amount" ? roundMoney(value) : String(value);
            // План ищем в кеше по (договор, фонд), а не берём id из строки:
            // строка могла отрисоваться до того, как пришёл только что созданный план
            const existing = supplierPlans?.find(
                (p) =>
                    p.supplier_contract_id === supplierContractId &&
                    p.fund === fund,
            );
            try {
                const saved = existing
                    ? await apiService.updateSupplierFundPlan(existing.id, {
                          [field]: payloadValue,
                      })
                    : await apiService.createSupplierFundPlan({
                          supplier_contract_id: supplierContractId,
                          year,
                          fund,
                          [field]: payloadValue,
                      });
                await mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-fund-plans"),
                    (current: SupplierFundPlan[] | undefined) =>
                        existing
                            ? current?.map((p) =>
                                  p.id === saved.id ? saved : p,
                              )
                            : [...(current ?? []), saved],
                    {revalidate: false},
                );
            } catch (e: unknown) {
                toast.error(getApiError(e, "Помилка збереження плану"));
            }
        },
        [supplierPlans, apiService, mutate, year],
    );

    const handleLoadMore = useCallback(() => {}, []);

    const handleExport = useCallback(
        async (format: "csv" | "xlsx" | "pdf") => {
            if (format !== "xlsx") {
                toast.info("Доступний тільки Excel-експорт (XLSX)");
                return;
            }
            if (!services || !contracts || !tenants) {
                toast.error("Дані ще завантажуються");
                return;
            }
            try {
                // Динамический импорт: библиотека xlsx (~0.4 МБ) не грузится
                // при старте — чанк скачивается при первом клике «Експорт»
                const {exportBillingXlsx} = await import("@/lib/export-xlsx");
                await exportBillingXlsx(
                    apiService,
                    services,
                    contracts,
                    tenants,
                    year,
                );
                toast.success(`Файл billing_${year}.xlsx збережено`);
            } catch (e) {
                toast.error(getApiError(e, "Помилка експорту"));
            }
        },
        [apiService, services, contracts, tenants, year],
    );

    // ─── Стани завантаження ───────────────────────────
    if (servicesLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Spinner className="w-10 h-10" />
            </div>
        );
    }

    // Нема жодної послуги — пропонуємо створити
    if (!services || services.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                    <Inbox className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                    <h2 className="text-lg font-semibold mb-1">Немає послуг</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Спочатку додайте послуги (вода, опалення, газ і т.д.) на
                        сторінці "Послуги".
                    </p>
                </div>
            </div>
        );
    }

    // Помилка завантаження рахунків
    if (error) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center text-destructive">
                    Помилка завантаження рахунків: {String(error)}
                </div>
            </div>
        );
    }

    const noContracts = activeContracts.length === 0;
    // Чи є хоч один договір, де підключена ця послуга
    const noServiceContracts = (contractServices?.length ?? 0) === 0;

    return (
        <>
            {noContracts && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                    ⚠️ Немає активних договорів. Додайте договір на сторінці
                    "Договори".
                </div>
            )}
            {!noContracts && noServiceContracts && (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                    ⚠️ Жоден договір не підключено до цієї послуги. Додайте
                    послугу до договору на сторінці "Договори".
                </div>
            )}
            <div className="flex-1 min-h-0">
                <BillingTable
                    data={tableData}
                    services={services}
                    activeServiceId={effectiveServiceId ?? services[0].id}
                    onServiceChange={handleServiceChange}
                    year={year}
                    onYearChange={handleYearChange}
                    onUpdateCell={handleUpdateCell}
                    onUpdatePlanned={handleUpdatePlanned}
                    onLoadMore={handleLoadMore}
                    availableYears={availableYears}
                    hasMore={false}
                    isLoading={billsLoading}
                    isLoadingMore={false}
                    totalCount={tableData.length}
                    onExport={handleExport}
                    periods={periods ?? []}
                    isAccountant={isAccountant}
                    isManager={isManager}
                    onVerifyBill={handleVerifyBill}
                    onClosePeriodClick={() => setClosePeriodDialogOpen(true)}
                    onGenerateClick={() => setGenerateDialogOpen(true)}
                    onMarkPaidClick={() => setMarkPaidDialogOpen(true)}
                    onMarkAccruedClick={() => setMarkAccruedDialogOpen(true)}
                    onResetAccrual={handleResetAccrual}
                    supplierRows={supplierTableData}
                    onUpdateSupplierCell={handleUpdateSupplierCell}
                    onResetSupplierAccrual={handleResetSupplierAccrual}
                    onUpdateSupplierPlan={handleUpdateSupplierPlan}
                />
            </div>

            <ClosePeriodDialog
                open={closePeriodDialogOpen}
                onOpenChange={setClosePeriodDialogOpen}
                periods={periods ?? []}
                defaultYear={year}
                serviceName={activeServiceName}
                serviceBillMonths={serviceBillMonths}
                onSuccess={() => mutatePeriods()}
            />
            <GenerateBillsDialog
                open={generateDialogOpen}
                onOpenChange={setGenerateDialogOpen}
                defaultYear={year}
                defaultServiceId={effectiveServiceId ?? services[0].id}
            />
            <MarkPaidDialog
                open={markPaidDialogOpen}
                onOpenChange={setMarkPaidDialogOpen}
                defaultYear={year}
                defaultServiceId={effectiveServiceId ?? services[0].id}
            />
            <MarkAccruedDialog
                open={markAccruedDialogOpen}
                onOpenChange={setMarkAccruedDialogOpen}
                defaultYear={year}
                defaultServiceId={effectiveServiceId ?? services[0].id}
            />
        </>
    );
}

export default BillingPage;
