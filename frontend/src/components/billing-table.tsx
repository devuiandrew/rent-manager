import React, {useState, useEffect, useRef, useMemo, useCallback} from "react";
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    flexRender,
    type Column,
    type ColumnDef,
    type Row,
    type SortingState,
    type ColumnFiltersState,
    type VisibilityState,
    type ColumnSizingState,
} from "@tanstack/react-table";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {Badge} from "@/components/ui/badge";
import {Spinner} from "@/components/ui/spinner";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import {
    partitionReimbursementSections,
    monthCellBg,
    consumedAmount,
    isPeriodClosedFor,
    matchesBillingSearch,
    roundMoney,
    runningDebts,
    FUND_LABELS,
    SUPPLIER_FUNDS,
    MANUAL_ACCRUAL_CELL,
    type PeriodState,
} from "@/lib/billing-utils";
// Общая редактируемая ячейка — используется и секцией «Постачальник»
import {EditableCell} from "@/components/billing-cells";
// Провайдер клавиатурной навигации по ячейкам (Enter/Tab между орендарями)
import {BillingNavProvider} from "@/components/billing-nav-context";
import {
    Download,
    ChevronUp,
    ChevronDown,
    ChevronsUpDown,
    Check,
    Loader2,
    Search,
    Columns3,
    Calendar,
    Lock,
    // CheckCircle,
    // Circle,
    Pin,
    PanelLeftClose,
    PanelLeftOpen,
    FileCheck,
    Truck,
    Hand,
    MousePointer2,
    RotateCcw,
    Banknote,
    Calculator,
} from "lucide-react";
import type {
    BillingPeriod,
    MonthlyBillData,
    Service,
    SupplierFund,
    SupplierMonthlyData,
} from "@/types/billing";

// Поля, які можна редагувати inline у таблиці
export type EditableField =
    | "consumption"
    | "rate"
    | "charged"
    | "paid"
    | "correction";

const MONTHS = [
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
];
const MONTH_KEYS = [
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

// Типи підколонок для перемикача видимості
const COL_TYPES = [
    {key: "consumption", label: "Споживання"},
    {key: "rate", label: "Тариф"},
    {key: "consumed", label: "Спожито"},
    {key: "charged", label: "Нараховано"},
    {key: "paid", label: "Сплачено"},
    {key: "correction", label: "Корекція"},
    {key: "debt", label: "Борг"},
] as const;

// Колонки які приховані за замовчуванням (для не загромаджувати таблицю —
// користувач може вмикати через меню Columns3)
const HIDDEN_BY_DEFAULT: Array<(typeof COL_TYPES)[number]["key"]> = [
    "correction",
];

// Ручные колонки «Підсумку» (вводятся вручную) — янтарный фон,
// чтобы отличать от вычисляемых колонок
const EDITABLE_TOTAL_IDS = new Set(["contractAmount", "plannedVolume"]);
const EDITABLE_TOTAL_CELL_BG = "bg-amber-50 dark:bg-amber-950/30";
const EDITABLE_TOTAL_HEADER_BG = "bg-amber-100 dark:bg-amber-950/40";

// Колонки группы «Орендар», любую из которых можно закрепить слева (одна за раз)
const PINNABLE_COLS = [
    {id: "tenantName", label: "Ім'я"},
    {id: "area", label: "Площа"},
    {id: "address", label: "Адреса"},
    {id: "contractNumber", label: "Договір оренди"},
    {id: "reimbursementNumber", label: "Договір відшкодування"},
] as const;
// "" — нічого не закріплено
const DEFAULT_PINNED = "reimbursementNumber";
const PINNED_STORAGE_KEY = "billing.pinnedColumn";
const SIDEBAR_STORAGE_KEY = "billing.servicesSidebarOpen";
const PAN_STORAGE_KEY = "billing.panEnabled";
const HIDDEN_MONTHS_STORAGE_KEY = "billing.hiddenMonths";
const COL_SIZING_STORAGE_KEY = "billing.columnSizing";

// Описания колонок блока «Підсумок»: текст + формула.
// Показываются в тултипе при наведении на заголовок (см. SortableHeader)
// Подсказка к помесячной колонке «Борг»: с 1.6.0 долг нарастающий
const MONTH_DEBT_HINT = {
    text: "Борг наростаючим підсумком: неоплачене в попередніх місяцях переноситься далі",
    formula: "Σ (Нарах. + Корекція − Сплач.) з січня по цей місяць",
};

const TOTALS_HINTS: Record<string, {text: string; formula: string}> = {
    totalCharged: {
        text: "Нараховано за минулі місяці та поточний включно",
        formula: "Σ Нарах. (січень … поточний місяць)",
    },
    totalConsumption: {
        text: "Спожитий обсяг за минулі місяці та поточний включно",
        formula: "Σ Обсяг (січень … поточний місяць)",
    },
    totalPaid: {
        text: "Оплачено за минулі місяці та поточний включно",
        formula: "Σ Сплач. (січень … поточний місяць)",
    },
    contractAmount: {
        text: "Річна сума за договором. Вводиться вручну",
        formula: "план на рік, грн",
    },
    plannedVolume: {
        text: "Річний обсяг за договором. Вводиться вручну",
        formula: "план на рік, в одиницях послуги",
    },
    balance: {
        text: "Переплата (+) або недостача (−) за минулі місяці та поточний",
        formula: "Сплачено − (Нарах. + Корекція)",
    },
    balanceVolume: {
        text: "Залишок договірного обсягу на поточний момент",
        formula: "Обсяг за договором − Виставлено обсяг",
    },
    totalDebt: {
        text: "Загальний борг за всі місяці року",
        formula: "Σ (Нарах. + Корекція − Сплач.)",
    },
    calcAmount: {
        text: "Факт минулих місяців + план майбутніх (усі 12 місяців)",
        formula: "Σ (Нарах. + Корекція) за рік",
    },
    calcVolume: {
        text: "Обсяг за всі 12 місяців: факт минулих + план майбутніх",
        formula: "Σ Обсяг за рік",
    },
    calcBalance: {
        text: "Розбіжність річного плану з розрахунковою сумою. ≠ 0 — місячні суми розійшлися з договором",
        formula: "Сума за договором − Розрах. сума",
    },
    calcBalanceVolume: {
        text: "Розбіжність річного плану з розрахунковим обсягом",
        formula: "Обсяг за договором − Розрах. обсяг",
    },
};

// «Розрахункова сума по договором» = факт прошлых месяцев + план будущих.
// План живёт в обычных Bill будущих периодов, поэтому это сумма за весь год
function calcYearAmount(row: Pick<PlannedRow, "months">): number {
    return MONTH_KEYS.reduce((s, mk) => {
        const m = row.months[mk];
        return m ? s + m.charged + m.correction : s;
    }, 0);
}

// Натуральный аналог «Розрах. суми» — объём за весь год (у корекції объёма нет)
function calcYearVolume(row: Pick<PlannedRow, "months">): number {
    return MONTH_KEYS.reduce(
        (s, mk) => s + (row.months[mk]?.consumption ?? 0),
        0,
    );
}

// Стиль закреплённой ячейки (sticky слева). Общий для строк данных, итогов
// и заголовка (тот поднимает z-index до z-20 — должен перекрывать ячейки)
const PINNED_CELL_CN =
    "sticky z-5 bg-blue-50/95 dark:bg-blue-950/30 border border-blue-200/90 shadow-[inset_-3px_0_0_0_var(--color-primary)]";

// Суммы месяца, которые складывают итоговые строки. Есть и у арендатора,
// и у поставщика — поэтому общая часть итогов работает с обоими
type MonthAmounts = {
    consumption: number;
    charged: number;
    paid: number;
    correction: number;
};

// Строка, по которой считаются итоги с планом: помесячные суммы + годовой план.
// Подходят и арендаторская MonthlyBillData, и строка фонда поставщика
type PlannedRow = {
    months: Partial<Record<(typeof MONTH_KEYS)[number], MonthAmounts>>;
    plannedAmount: number | null;
    plannedVolume: number | null;
};

// Общая часть итогов: помесячные суммы, «Виставлено/Обсяг/Сплачено» за окно
// и годовой долг. Правило долга и окно подсчёта — только здесь.
// computeTotals досчитывает поверх плановые колонки
function computeMonthTotals(
    rows: {months: Partial<Record<(typeof MONTH_KEYS)[number], MonthAmounts>>}[],
    isCountedMonth: (monthIndex: number) => boolean,
): Record<string, number> {
    const result: Record<string, number> = {};
    MONTH_KEYS.forEach((mk) => {
        result[`${mk}_consumption`] = rows.reduce(
            (s, r) => s + (r.months[mk]?.consumption ?? 0),
            0,
        );
        result[`${mk}_charged`] = rows.reduce(
            (s, r) => s + (r.months[mk]?.charged ?? 0),
            0,
        );
        result[`${mk}_paid`] = rows.reduce(
            (s, r) => s + (r.months[mk]?.paid ?? 0),
            0,
        );
        result[`${mk}_correction`] = rows.reduce(
            (s, r) => s + (r.months[mk]?.correction ?? 0),
            0,
        );
        // Пока — долг ЭТОГО месяца; ниже превращается в нарастающий
        result[`${mk}_debt`] = rows.reduce((s, r) => {
            const m = r.months[mk];
            return s + (m ? m.charged + m.correction - m.paid : 0);
        }, 0);
    });
    // Підсумки «Виставлено»/«Сплачено»/«Обсяг» — тільки за вікно (минулі + поточний)
    result.totalCharged = MONTH_KEYS.reduce(
        (s, mk, i) => (isCountedMonth(i) ? s + result[`${mk}_charged`] : s),
        0,
    );
    result.totalConsumption = MONTH_KEYS.reduce(
        (s, mk, i) => (isCountedMonth(i) ? s + result[`${mk}_consumption`] : s),
        0,
    );
    result.totalPaid = MONTH_KEYS.reduce(
        (s, mk, i) => (isCountedMonth(i) ? s + result[`${mk}_paid`] : s),
        0,
    );
    // Долг в итогах — нарастающий, как в строках (runningDebts); декабрь =
    // годовой «Заг. борг». Half-up на каждом шаге — как в runningDebts
    let debtAcc = 0;
    MONTH_KEYS.forEach((mk) => {
        debtAcc = Number(roundMoney(debtAcc + result[`${mk}_debt`]));
        result[`${mk}_debt`] = debtAcc;
    });
    result.totalDebt = debtAcc;
    return result;
}

// Итоги каждой числовой колонки по набору строк (ключ = id колонки).
// Используется для общего «Разом» и подытогов секций відшкодувань.
// isCountedMonth передаётся снаружи: окно «прошедшие + текущий» зависит от года
function computeTotals(
    rows: PlannedRow[],
    isCountedMonth: (monthIndex: number) => boolean,
): Record<string, number> {
    const result = computeMonthTotals(rows, isCountedMonth);
    // «Сума за договором» у футері — сума ручних планів
    result.contractAmount = rows.reduce(
        (s, r) => s + (r.plannedAmount ?? 0),
        0,
    );
    result.plannedVolume = rows.reduce((s, r) => s + (r.plannedVolume ?? 0), 0);
    // Залишок — як і в рядках: сплачено мінус факт (нарах.+корекція) за вікно, НЕ план
    const totalCorrection = MONTH_KEYS.reduce(
        (s, mk, i) => (isCountedMonth(i) ? s + result[`${mk}_correction`] : s),
        0,
    );
    result.balance = result.totalPaid - (result.totalCharged + totalCorrection);
    // Об'ємний залишок — від суми планів, як і «Розрах. зал. обсяг»
    result.balanceVolume = result.plannedVolume - result.totalConsumption;
    // «Розрах. сума/обсяг» — факт прошлых + план будущих = весь год
    result.calcAmount = rows.reduce((s, r) => s + calcYearAmount(r), 0);
    result.calcVolume = rows.reduce((s, r) => s + calcYearVolume(r), 0);
    // «Розрах. залишок» — от суммы ручных планов (строки без плана дают 0)
    result.calcBalance = result.contractAmount - result.calcAmount;
    result.calcBalanceVolume = result.plannedVolume - result.calcVolume;
    return result;
}

// Итоги строк поставщика — те же, что у арендаторов (с планом), кроме
// «Залишку» (сплачено − нараховано): в строках поставщика его нет, и итог
// не должен показывать больше, чем строки над ним
function computeSupplierTotals(
    rows: SupplierMonthlyData[],
    isCountedMonth: (monthIndex: number) => boolean,
): Record<string, number> {
    const totals = computeTotals(rows, isCountedMonth);
    delete totals.balance;
    return totals;
}

// Цвета секций відшкодувань — фиолетовая гамма (свободна: красный/зелёный/синий
// заняты состояниями периодов, янтарный — ручными полями)
const SECTION_HEADER_CN =
    "bg-violet-100/80 dark:bg-violet-950/40 border-t-2 border-violet-300 dark:border-violet-800 hover:bg-violet-100/80";
const SECTION_ROW_CN =
    "bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-100/40";
// Підсумок групи — та ж заливка, що й банер, + товста нижня лінія:
// разом вони «беруть секцію в рамку» і відділяють від загального «Разом»
const SECTION_TOTAL_CN =
    "bg-violet-100/80 dark:bg-violet-950/40 border-t border-violet-200 dark:border-violet-800 border-b-2 border-b-violet-300 dark:border-b-violet-800 font-semibold hover:bg-violet-100/80";
// Ярлыки строк итогов — только заливка/цвет текста, без sticky и границ
// (ячейка широкая — лишние акценты выглядят как отдельный блок)
const SECTION_TOTAL_LABEL_CN =
    "bg-violet-100 dark:bg-violet-950 text-violet-900 dark:text-violet-200";
// Цвет текста заголовка секции — по умолчанию фиолетовый (відшкодування)
const SECTION_HEADER_TEXT_CN = "text-violet-900 dark:text-violet-200";
const GRAND_TOTAL_LABEL_CN = "bg-muted";

// Цвета блока «Постачальник» — бирюзовая гамма (контраст к фиолетовым
// секциям відшкодувань; green/blue заняты только в шапке месяцев)
const SUPPLIER_HEADER_CN =
    "bg-teal-100/80 dark:bg-teal-950/40 border-t-2 border-teal-300 dark:border-teal-800 hover:bg-teal-100/80";
const SUPPLIER_ROW_CN =
    "bg-teal-50/50 dark:bg-teal-950/20 hover:bg-teal-100/40";
const SUPPLIER_TOTAL_LABEL_CN =
    "bg-teal-100 dark:bg-teal-950 text-teal-900 dark:text-teal-200";
// Подытоги фондов — легче общего «Підсумку»: без жирной нижней границы,
// чтобы четыре итоговые строки подряд не сливались в одну тяжёлую плашку
const SUPPLIER_SUBTOTAL_CN =
    "bg-teal-50/80 dark:bg-teal-950/30 border-t border-teal-200 dark:border-teal-800 font-medium hover:bg-teal-50/80";
// «Підсумок» поставщика — итог блока: тот же бирюзовый, но насыщеннее
// подытогов фондов и с жирной чертой сверху
const SUPPLIER_GRAND_CN =
    "bg-teal-200/70 dark:bg-teal-900/50 border-t-2 border-teal-400 dark:border-teal-700 font-bold hover:bg-teal-200/70";
const SUPPLIER_GRAND_LABEL_CN =
    "bg-teal-200 dark:bg-teal-900 text-teal-950 dark:text-teal-100";
// «Різниця» — не итог поставщика, а сверка двух блоков: нейтральный slate,
// ни бирюзовый, ни серый «Разом». Янтарные цифры расхождений на нём заметнее
const SUPPLIER_DIFF_CN =
    "bg-slate-100 dark:bg-slate-900/60 border-t-2 border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-100";
const SUPPLIER_DIFF_LABEL_CN =
    "bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200";
const SUPPLIER_HEADER_TEXT_CN = "text-teal-900 dark:text-teal-200";

// Заголовок секції (відшкодування/постачальник): одна комірка на всю ширину
// таблиці, ярлик — sticky left, тому не їде при горизонтальному скролі
function SectionHeaderRow({
    label,
    colSpan,
    icon,
    // Дефолт — фиолетовая гамма секций відшкодувань,
    // блок «Постачальник» передаёт бирюзовую
    className = SECTION_HEADER_CN,
    textClassName = SECTION_HEADER_TEXT_CN,
}: {
    label: string;
    colSpan: number;
    icon?: React.ReactNode;
    className?: string;
    textClassName?: string;
}) {
    return (
        <TableRow className={className}>
            <TableCell colSpan={colSpan} className="py-2 px-2">
                <div
                    className={cn(
                        "sticky left-2 inline-flex items-center gap-2 font-semibold text-sm whitespace-nowrap",
                        textClassName,
                    )}>
                    {icon ?? <FileCheck className="h-4 w-4 shrink-0" />}
                    {label}
                </div>
            </TableCell>
        </TableRow>
    );
}

// Значение «Різниці» (пост. − орендарі): 0 — нейтральное,
// ≠0 — акцент (данные не сошлись), «+» показывает направление перевеса
function DiffValue({value}: {value: number}) {
    const isZero = Math.abs(value) < 0.005;
    return (
        <div
            className={cn(
                "text-right whitespace-nowrap",
                isZero
                    ? "text-muted-foreground"
                    : "text-amber-700 dark:text-amber-400 font-medium",
            )}>
            {value > 0 ? "+" : ""}
            {value.toLocaleString("uk-UA", {minimumFractionDigits: 2})}
        </div>
    );
}

interface TotalsRowProps {
    // Текст в первой ячейке («Разом», «Разом «№232»»)
    label: string;
    totals: Record<string, number>;
    leafColumns: Column<MonthlyBillData, unknown>[];
    // Заливка ярлыка (фиолетовая у секций, серая у общего «Разом»)
    labelClassName?: string;
    className?: string;
}

// Строка итогов поверх видимых колонок таблицы: border начала блоков,
// цвет по знаку. Ярлык — в первой ячейке, без sticky и пін-стилю
// (закрепление путалось бы с функцией пін-колонки)
function TotalsRow({
    label,
    totals,
    leafColumns,
    labelClassName,
    className,
}: TotalsRowProps) {
    return (
        <TableRow className={className}>
            {leafColumns.map((col, idx) => {
                const isBlockStart =
                    col.id.endsWith("_consumption") ||
                    col.id === "totalCharged";
                if (idx === 0) {
                    return (
                        <TableCell
                            key={col.id}
                            style={{width: col.getSize()}}
                            className={cn(
                                "py-1.5 px-2 text-sm overflow-hidden",
                                labelClassName,
                            )}>
                            {/* Длинный номер обрезаем, полный текст — на hover */}
                            <div className="truncate" title={label}>
                                {label}
                            </div>
                        </TableCell>
                    );
                }
                const val = totals[col.id];
                if (val === undefined) {
                    return (
                        <TableCell
                            key={col.id}
                            style={{width: col.getSize()}}
                            className={cn(
                                "py-1.5 px-2",
                                isBlockStart && "border-l border-border",
                            )}
                        />
                    );
                }
                const isDebt =
                    col.id.endsWith("_debt") || col.id === "totalDebt";
                const isBalance = col.id === "balance";
                // Залишки красим по знаку, но без «+»
                const isCalcBalance =
                    col.id === "calcBalance" ||
                    col.id === "calcBalanceVolume" ||
                    col.id === "balanceVolume";
                const isPaid =
                    col.id.endsWith("_paid") || col.id === "totalPaid";
                return (
                    <TableCell
                        key={col.id}
                        style={{width: col.getSize()}}
                        className={cn(
                            "py-1.5 px-2 text-sm overflow-hidden",
                            isBlockStart && "border-l border-border",
                        )}>
                        <div
                            className={cn(
                                "text-right whitespace-nowrap",
                                isDebt && val > 0 && "text-red-600",
                                isDebt && val < 0 && "text-green-600",
                                isBalance && val > 0 && "text-green-600",
                                isBalance && val < 0 && "text-red-600",
                                isCalcBalance && val > 0 && "text-green-600",
                                isCalcBalance && val < 0 && "text-red-600",
                                isPaid && val > 0 && "text-green-600",
                            )}>
                            {isBalance && val > 0 ? "+" : ""}
                            {val.toLocaleString("uk-UA", {
                                minimumFractionDigits: 2,
                            })}
                        </div>
                    </TableCell>
                );
            })}
        </TableRow>
    );
}

interface BillingTableProps {
    data: MonthlyBillData[];
    services: Service[];
    activeServiceId: number;
    onServiceChange: (serviceId: number) => void;
    year: number;
    onYearChange: (year: number) => void;
    onUpdateCell: (
        contractId: number,
        month: number,
        field: EditableField,
        value: number,
    ) => Promise<void>;
    onUpdatePlanned: (
        contractServiceId: number,
        field: "planned_amount" | "planned_volume",
        value: number,
    ) => Promise<void>;
    onLoadMore: () => void;
    hasMore: boolean;
    isLoading: boolean;
    isLoadingMore: boolean;
    totalCount: number;
    onExport: (format: "csv" | "xlsx" | "pdf") => Promise<void>;
    availableYears?: number[];
    // Ролі та дії бухгалтера
    periods: BillingPeriod[];
    isAccountant: boolean;
    isManager: boolean;
    onVerifyBill: (contractId: number, month: number) => Promise<void>;
    onClosePeriodClick: () => void;
    onGenerateClick: () => void;
    onMarkPaidClick: () => void;
    onMarkAccruedClick: () => void;
    // Скидання ручного нарахування («Спожито» × тариф знову перераховує «Нарах.»)
    onResetAccrual: (contractId: number, month: number) => Promise<void>;
    // Блок «Постачальник» — рядки в ТІЙ ЖЕ таблиці після «Разом»:
    // колонки/ширини/видимість спільні з орендарями (ідеальне вирівнювання)
    supplierRows?: SupplierMonthlyData[];
    // Запись адресуется по id, а не по (договор, месяц): с фондами
    // таких записей на месяц две, и пара перестала быть однозначной
    onUpdateSupplierCell?: (
        billId: number,
        field: EditableField,
        value: number,
    ) => Promise<void>;
    onResetSupplierAccrual?: (billId: number) => Promise<void>;
    // Годовой план фонда поставщика — правится в колонках «Сума/Обсяг за
    // договором», как план арендатора. Адресуется парой (договор, фонд):
    // записи плана может ещё не быть
    onUpdateSupplierPlan?: (
        supplierContractId: number,
        fund: SupplierFund,
        field: "planned_amount" | "planned_volume",
        value: number,
    ) => Promise<void>;
}

function SortableHeader({
    column,
    children,
    hint,
}: {
    column: {
        getIsSorted: () => false | "asc" | "desc";
        toggleSorting: (desc?: boolean) => void;
    };
    children: React.ReactNode;
    // Описание колонки + формула — показываются в тултипе при наведении
    hint?: {text: string; formula: string};
}) {
    const sorted = column.getIsSorted();
    const button = (
        <button
            onClick={() => column.toggleSorting(sorted === "asc")}
            className="flex items-center justify-center gap-1 w-full hover:text-foreground transition-colors">
            {children}
            {sorted === "asc" ? (
                <ChevronUp className="h-3 w-3" />
            ) : sorted === "desc" ? (
                <ChevronDown className="h-3 w-3" />
            ) : (
                <ChevronsUpDown className="h-3 w-3 opacity-40" />
            )}
        </button>
    );
    if (!hint) return button;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-64 text-left">
                <div>{hint.text}</div>
                <div className="mt-1 font-mono text-[11px] opacity-80">
                    {hint.formula}
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

export function BillingTable({
    data,
    services,
    activeServiceId,
    onServiceChange,
    year,
    onYearChange,
    onUpdateCell,
    onUpdatePlanned,
    onLoadMore,
    hasMore,
    isLoading,
    isLoadingMore,
    totalCount,
    onExport,
    availableYears,
    periods,
    isAccountant,
    isManager,
    onVerifyBill,
    onClosePeriodClick,
    onGenerateClick,
    onMarkPaidClick,
    onMarkAccruedClick,
    onResetAccrual,
    supplierRows,
    onUpdateSupplierCell,
    onUpdateSupplierPlan,
    onResetSupplierAccrual,
}: BillingTableProps) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    // Стартова видимість: ховаємо колонки з HIDDEN_BY_DEFAULT (correction)
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        () => {
            const v: VisibilityState = {};
            MONTH_KEYS.forEach((mk) => {
                HIDDEN_BY_DEFAULT.forEach((type) => {
                    v[`${mk}_${type}`] = false;
                });
            });
            return v;
        },
    );
    // Скрытые месяцы — ВТОРОЕ измерение видимости, перпендикулярное типам
    // подколонок: january_correction видна, только если видны и тип, и месяц.
    // Храним отдельно — в одном состоянии TanStack они затирали бы друг друга.
    // Запоминается в браузере: удобство конкретного пользователя
    const [hiddenMonths, setHiddenMonths] = useState<Set<string>>(() => {
        try {
            const raw = localStorage.getItem(HIDDEN_MONTHS_STORAGE_KEY);
            const arr: unknown = raw ? JSON.parse(raw) : [];
            return new Set(
                Array.isArray(arr)
                    ? arr.filter(
                          (k): k is string =>
                              typeof k === "string" &&
                              (MONTH_KEYS as readonly string[]).includes(k),
                      )
                    : [],
            );
        } catch {
            return new Set();
        }
    });
    const updateHiddenMonths = useCallback(
        (update: (prev: Set<string>) => Set<string>) => {
            setHiddenMonths((prev) => {
                const next = update(prev);
                try {
                    localStorage.setItem(
                        HIDDEN_MONTHS_STORAGE_KEY,
                        JSON.stringify([...next]),
                    );
                } catch {
                    // приватный режим / хранилище недоступно — просто не запомним
                }
                return next;
            });
        },
        [],
    );
    // Что видит таблица: видимость типов ∩ видимость месяцев
    const effectiveVisibility = useMemo(() => {
        if (hiddenMonths.size === 0) return columnVisibility;
        const v: VisibilityState = {...columnVisibility};
        hiddenMonths.forEach((mk) =>
            COL_TYPES.forEach(({key}) => {
                v[`${mk}_${key}`] = false;
            }),
        );
        return v;
    }, [columnVisibility, hiddenMonths]);
    // Ширины колонок, заданные перетаскиванием — {id колонки: px}.
    // Запоминаются в браузере, как закрепление и скрытые месяцы
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
        try {
            const raw = localStorage.getItem(COL_SIZING_STORAGE_KEY);
            const obj: unknown = raw ? JSON.parse(raw) : {};
            return obj && typeof obj === "object"
                ? (obj as ColumnSizingState)
                : {};
        } catch {
            return {};
        }
    });
    // Пишем с задержкой: при перетаскивании ширина меняется на каждое
    // движение мыши, а в хранилище нужна только итоговая
    useEffect(() => {
        const t = setTimeout(() => {
            try {
                localStorage.setItem(
                    COL_SIZING_STORAGE_KEY,
                    JSON.stringify(columnSizing),
                );
            } catch {
                // хранилище недоступно — просто не запомним
            }
        }, 300);
        return () => clearTimeout(t);
    }, [columnSizing]);
    const [globalFilter, setGlobalFilter] = useState("");
    const [isExporting, setIsExporting] = useState(false);
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Закреплённая слева колонка (одна за раз, "" — нічого не закріплено).
    const [pinnedCol, setPinnedCol] = useState<string>(() => {
        try {
            const raw = localStorage.getItem(PINNED_STORAGE_KEY);
            if (
                raw !== null &&
                (raw === "" || PINNABLE_COLS.some((c) => c.id === raw))
            )
                return raw;
        } catch {
            // Повреждённое значение — используем дефолт
        }
        return DEFAULT_PINNED;
    });

    const setPinned = useCallback((id: string) => {
        setPinnedCol(id);
        localStorage.setItem(PINNED_STORAGE_KEY, id);
    }, []);

    // Згортання бокової панелі «Послуги» — зберігаємо вибір користувача
    const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
        try {
            return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "0";
        } catch {
            return true;
        }
    });

    const toggleSidebar = useCallback(() => {
        setSidebarOpen((prev) => {
            const next = !prev;
            localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
            return next;
        });
    }, []);

    // Режим "рука": перетаскивание таблицы мышью. Тогл в тулбаре, выбор запоминаем.
    // По умолчанию включён — сохраняем прежнее поведение таблицы.
    const [panEnabled, setPanEnabled] = useState<boolean>(() => {
        try {
            return localStorage.getItem(PAN_STORAGE_KEY) !== "0";
        } catch {
            return true;
        }
    });

    const togglePan = useCallback(() => {
        setPanEnabled((prev) => {
            const next = !prev;
            localStorage.setItem(PAN_STORAGE_KEY, next ? "1" : "0");
            return next;
        });
    }, []);

    // Drag-to-pan: перетаскивание таблицы мышью за пустые места
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef({x: 0, y: 0, left: 0, top: 0});

    const handlePanStart = useCallback(
        (e: React.MouseEvent) => {
            // Режим "рука" выключен — обычный курсор, таблицу не тянем
            if (!panEnabled) return;
            if (e.button !== 0) return;
            // Не перехватываем интерактивные элементы (кнопки-ячейки, инпуты, меню)
            const target = e.target as HTMLElement;
            if (
                target.closest(
                    "button, input, a, select, [role=menuitem], [data-col-resizer]",
                )
            )
                return;
            const el = tableContainerRef.current;
            if (!el) return;
            // Клик по нативному скроллбару — не наш случай
            const rect = el.getBoundingClientRect();
            if (
                e.clientX - rect.left > el.clientWidth ||
                e.clientY - rect.top > el.clientHeight
            )
                return;
            panStart.current = {
                x: e.clientX,
                y: e.clientY,
                left: el.scrollLeft,
                top: el.scrollTop,
            };
            setIsPanning(true);
        },
        [panEnabled],
    );

    useEffect(() => {
        if (!isPanning) return;
        const el = tableContainerRef.current;
        const onMove = (e: MouseEvent) => {
            if (!el) return;
            // Гасим выделение текста во время перетаскивания
            e.preventDefault();
            el.scrollLeft =
                panStart.current.left - (e.clientX - panStart.current.x);
            el.scrollTop =
                panStart.current.top - (e.clientY - panStart.current.y);
        };
        const onUp = () => setIsPanning(false);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [isPanning]);

    // Окно подсчёта итогов «Виставлено факт»/«Сплачено»/«Залишок»:
    // прошедшие месяцы + текущий (по календарю, не по закрытию периодов).
    // Прошлый год — все 12 месяцев, будущий — ни одного.
    // Объявлен до columnTotals — тот использует его при рендере.
    const isCountedMonth = useCallback(
        (monthIndex: number): boolean => {
            const now = new Date();
            const cy = now.getFullYear();
            if (year < cy) return true;
            if (year > cy) return false;
            return monthIndex + 1 <= now.getMonth() + 1;
        },
        [year],
    );

    // Підсумки кожної числової колонки — для рядка "Разом" в footer.
    // Логика вынесена в computeTotals (module-level) — та же функция
    // считает подытоги секций відшкодувань
    const columnTotals = useMemo(
        () => computeTotals(data, isCountedMonth),
        [data, isCountedMonth],
    );

    // Подытоги блока поставщика: «Разом» по каждому фонду + общий «Підсумок»
    // (решение клиента 2026-09-18). Те же формулы, что у арендаторов
    const supplierFundTotals = useMemo(
        () =>
            SUPPLIER_FUNDS.map((fund) => ({
                fund,
                totals: computeSupplierTotals(
                    (supplierRows ?? []).filter((r) => r.fund === fund),
                    isCountedMonth,
                ),
            })),
        [supplierRows, isCountedMonth],
    );
    const supplierGrandTotals = useMemo(
        () => computeSupplierTotals(supplierRows ?? [], isCountedMonth),
        [supplierRows, isCountedMonth],
    );

    // Помісячні суми постачальників — для рядка «Різниця» (пост. − орендарі).
    // hasData: сверка показывается только за месяцы, где есть запись поставщика.
    // ⚠️ Складываются ОБА фонда — «Різниця» сравнивает арендаторов с общим
    // подытогом поставщика. Решение временное: арендаторы возмещают только
    // в спец. фонд, возможно, сравнивать нужно с ним (вопрос клиенту)
    const supplierMonthTotals = useMemo(() => {
        const totals = MONTH_KEYS.map(() => ({
            consumption: 0,
            charged: 0,
            hasData: false,
        }));
        (supplierRows ?? []).forEach((row) => {
            MONTH_KEYS.forEach((mk, i) => {
                const m = row.months[mk];
                if (m) {
                    totals[i].consumption += m.consumption;
                    totals[i].charged += m.charged;
                    totals[i].hasData = true;
                }
            });
        });
        return totals;
    }, [supplierRows]);

    // Річні підсумки «Різниці» — вікно «минулі + поточний», як «Виставлено».
    // Орендарські суми беремо з columnTotals (повні дані, без квік-фільтра)
    const supplierDiffTotals = useMemo(() => {
        let volume = 0;
        let money = 0;
        supplierMonthTotals.forEach((s, i) => {
            if (!s.hasData || !isCountedMonth(i)) return;
            volume +=
                s.consumption -
                (columnTotals[`${MONTH_KEYS[i]}_consumption`] ?? 0);
            money +=
                s.charged - (columnTotals[`${MONTH_KEYS[i]}_charged`] ?? 0);
        });
        return {volume, money};
    }, [supplierMonthTotals, columnTotals, isCountedMonth]);

    const years = useMemo(
        () =>
            availableYears ??
            Array.from({length: 5}, (_, i) => new Date().getFullYear() - i),
        [availableYears],
    );

    const activeService = services.find((s) => s.id === activeServiceId);
    const unit = activeService?.unit_name || "од.";

    // Словник закритих місяців: monthIndex (0-based) → true/false
    const closedMonths = useMemo(() => {
        const map: Record<number, boolean> = {};
        periods.forEach((p) => {
            if (p.year === year)
                map[p.month - 1] = isPeriodClosedFor(p, "tenants");
        });
        return map;
    }, [periods, year]);
    // Замок поставщиков — свой, независимый от арендаторского
    const closedSupplierMonths = useMemo(() => {
        const map: Record<number, boolean> = {};
        periods.forEach((p) => {
            if (p.year === year)
                map[p.month - 1] = isPeriodClosedFor(p, "suppliers");
        });
        return map;
    }, [periods, year]);

    // Тип периода для месяца (0-based): закрытый перекрывает всё, иначе по календарю
    const getMonthState = useCallback(
        (monthIndex: number): PeriodState => {
            if (closedMonths[monthIndex]) return "closed";
            const now = new Date();
            const cy = now.getFullYear();
            const cm = now.getMonth() + 1;
            if (year < cy) return "past";
            if (year > cy) return "future";
            // Текущий год: будущие месяцы — план, текущий и прошлые — пройдено
            return monthIndex + 1 > cm ? "future" : "past";
        },
        [closedMonths, year],
    );

    // Строки поставщика: «закрыто» — по СВОЕМУ замку (suppliers), замок
    // арендаторов на них не действует; иначе — календарь, как у арендаторов
    const getSupplierMonthState = useCallback(
        (monthIndex: number): PeriodState => {
            if (closedSupplierMonths[monthIndex]) return "closed";
            const now = new Date();
            const cy = now.getFullYear();
            if (year < cy) return "past";
            if (year > cy) return "future";
            return monthIndex + 1 > now.getMonth() + 1 ? "future" : "past";
        },
        [closedSupplierMonths, year],
    );

    const handleVerify = useCallback(
        (contractId: number, month: number) => onVerifyBill(contractId, month),
        [onVerifyBill],
    );

    const columns = useMemo<ColumnDef<MonthlyBillData>[]>(() => {
        // Group 1 — Орендар (spans tenant info columns)
        const tenantGroup: ColumnDef<MonthlyBillData> = {
            id: "tenant_group",
            header: "Орендар",
            columns: [
                {
                    accessorKey: "tenantName",
                    header: ({column}) => (
                        <SortableHeader column={column}>
                            Ім&apos;я
                        </SortableHeader>
                    ),
                    cell: ({row}) => (
                        <div
                            className="font-medium truncate"
                            title={row.original.tenantName}>
                            {row.original.tenantName}
                        </div>
                    ),
                    enableSorting: true,
                    size: 280,
                },
                {
                    accessorKey: "area",
                    header: ({column}) => (
                        <SortableHeader column={column}>
                            Площа, м²
                        </SortableHeader>
                    ),
                    cell: ({row}) => (
                        <div className="text-right">
                            {row.original.area.toFixed(2)}
                        </div>
                    ),
                    enableSorting: true,
                    size: 90,
                },
                {
                    accessorKey: "address",
                    header: ({column}) => (
                        <SortableHeader column={column}>Адреса</SortableHeader>
                    ),
                    cell: ({row}) => (
                        <div
                            className="truncate"
                            title={row.original.address}>
                            {row.original.address}
                        </div>
                    ),
                    enableSorting: true,
                    size: 180,
                },
                {
                    accessorKey: "contractNumber",
                    header: ({column}) => (
                        <SortableHeader column={column}>Договір</SortableHeader>
                    ),
                    cell: ({row}) => (
                        <div className="font-mono text-sm whitespace-nowrap">
                            {row.original.contractNumber}
                        </div>
                    ),
                    enableSorting: true,
                    size: 110,
                },
                {
                    // Номер договору відшкодування — щоб знаходити рядок пошуком і по ньому.
                    // id збережено: він же DEFAULT_PINNED і ключ видимості колонки
                    id: "reimbursementNumber",
                    accessorFn: (r) => r.reimbursement?.number ?? "",
                    header: ({column}) => (
                        <SortableHeader column={column}>
                            Відшкодування
                        </SortableHeader>
                    ),
                    cell: ({row}) => (
                        <div className="font-mono text-sm whitespace-nowrap text-muted-foreground">
                            {row.original.reimbursement?.number || "—"}
                        </div>
                    ),
                    enableSorting: true,
                    size: 120,
                },
            ],
        };

        // Groups 2–13 — Each month (7 sub-columns: unit, rate, consumed, charged, paid, correction, debt)
        const monthGroups: ColumnDef<MonthlyBillData>[] = MONTHS.map(
            (monthName, index) => {
                const monthKey = MONTH_KEYS[index];
                return {
                    id: `month_${monthKey}`,
                    header: () => {
                        const state = getMonthState(index);
                        return (
                            <span
                                className={cn(
                                    "flex items-center justify-center gap-1",
                                    state === "closed" && "text-red-600",
                                    state === "past" &&
                                        "text-green-700 dark:text-green-500",
                                    state === "future" && "text-blue-600",
                                )}>
                                {monthName}
                                {state === "closed" && (
                                    <Lock className="h-3 w-3" />
                                )}
                            </span>
                        );
                    },
                    columns: [
                        {
                            accessorFn: (row) =>
                                row.months[monthKey]?.consumption ?? 0,
                            id: `${monthKey}_consumption`,
                            header: ({column}) => (
                                <SortableHeader column={column}>
                                    {unit}
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                return (
                                    <EditableCell
                                        value={d.consumption}
                                        onSave={(v) =>
                                            onUpdateCell(
                                                row.original.contractId,
                                                index + 1,
                                                "consumption",
                                                v,
                                            )
                                        }
                                        type="quantity"
                                        cellKey={`${row.id}::${monthKey}_consumption`}
                                    />
                                );
                            },
                            size: 70,
                            enableSorting: true,
                        },
                        {
                            accessorFn: (row) =>
                                row.months[monthKey]?.rate ?? 0,
                            id: `${monthKey}_rate`,
                            header: ({column}) => (
                                <SortableHeader column={column}>
                                    Тариф
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                return (
                                    <EditableCell
                                        value={d.rate}
                                        onSave={(v) =>
                                            onUpdateCell(
                                                row.original.contractId,
                                                index + 1,
                                                "rate",
                                                v,
                                            )
                                        }
                                        type="quantity"
                                        className="text-muted-foreground"
                                        cellKey={`${row.id}::${monthKey}_rate`}
                                    />
                                );
                            },
                            size: 75,
                            enableSorting: true,
                        },
                        {
                            // Спожито = споживання × тариф — довідкова величина, завжди
                            // за формулою (на відміну від «Нарах.», яке можна ввести вручну)
                            accessorFn: (row) => {
                                const m = row.months[monthKey];
                                return m
                                    ? Number(consumedAmount(m.consumption, m.rate))
                                    : 0;
                            },
                            id: `${monthKey}_consumed`,
                            header: ({column}) => (
                                <SortableHeader column={column}>
                                    Спожито
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                return (
                                    <div className="text-right px-2 py-1 text-sm select-none text-muted-foreground">
                                        {consumedAmount(d.consumption, d.rate)}
                                    </div>
                                );
                            },
                            size: 85,
                            enableSorting: true,
                        },
                        {
                            accessorFn: (row) =>
                                row.months[monthKey]?.charged ?? 0,
                            id: `${monthKey}_charged`,
                            header: ({column}) => (
                                <SortableHeader column={column}>
                                    Нарах.
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                return (
                                    <div className="flex items-center justify-end gap-1 px-2 py-1">
                                        <EditableCell
                                            value={d.charged}
                                            onSave={(v) =>
                                                onUpdateCell(
                                                    row.original.contractId,
                                                    index + 1,
                                                    "charged",
                                                    v,
                                                )
                                            }
                                            type="currency"
                                            className={
                                                d.isManualAccrual
                                                    ? MANUAL_ACCRUAL_CELL
                                                    : undefined
                                            }
                                            cellKey={`${row.id}::${monthKey}_charged`}
                                        />
                                        {d.isManualAccrual && (
                                            <button
                                                onClick={() =>
                                                    onResetAccrual(
                                                        row.original.contractId,
                                                        index + 1,
                                                    )
                                                }
                                                title="Нарах. введено вручну — скинути до споживання × тариф"
                                                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                                                <RotateCcw className="h-3 w-3 text-amber-600" />
                                            </button>
                                        )}
                                    </div>
                                );
                            },
                            size: 85,
                            enableSorting: true,
                        },
                        {
                            accessorFn: (row) =>
                                row.months[monthKey]?.paid ?? 0,
                            id: `${monthKey}_paid`,
                            header: ({column}) => (
                                <SortableHeader column={column}>
                                    Сплач.
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                return (
                                    <EditableCell
                                        value={d.paid}
                                        onSave={(v) =>
                                            onUpdateCell(
                                                row.original.contractId,
                                                index + 1,
                                                "paid",
                                                v,
                                            )
                                        }
                                        type="currency"
                                        className={cn(
                                            d.paid >= d.charged &&
                                                "text-green-600",
                                            d.paid > 0 &&
                                                d.paid < d.charged &&
                                                "text-amber-600",
                                            d.paid === 0 &&
                                                d.charged > 0 &&
                                                "text-red-600",
                                        )}
                                        cellKey={`${row.id}::${monthKey}_paid`}
                                    />
                                );
                            },
                            size: 85,
                            enableSorting: true,
                        },
                        {
                            accessorFn: (row) =>
                                row.months[monthKey]?.correction ?? 0,
                            id: `${monthKey}_correction`,
                            header: ({column}) => (
                                <SortableHeader column={column}>
                                    Корекція
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                return (
                                    <EditableCell
                                        value={d.correction}
                                        onSave={(v) =>
                                            onUpdateCell(
                                                row.original.contractId,
                                                index + 1,
                                                "correction",
                                                v,
                                            )
                                        }
                                        type="currency"
                                        className={
                                            d.correction !== 0
                                                ? "text-amber-600"
                                                : "text-muted-foreground"
                                        }
                                        cellKey={`${row.id}::${monthKey}_correction`}
                                    />
                                );
                            },
                            size: 80,
                            enableSorting: true,
                        },
                        {
                            // Борг — НАРАСТАЮЩИЙ с января: Σ (нарах. + корекція −
                            // сплач.) по этот месяц (runningDebts, задача клиента)
                            accessorFn: (row) =>
                                row.months[monthKey]
                                    ? runningDebts(row.months)[index]
                                    : 0,
                            id: `${monthKey}_debt`,
                            header: ({column}) => (
                                <SortableHeader
                                    column={column}
                                    hint={MONTH_DEBT_HINT}>
                                    Борг
                                </SortableHeader>
                            ),
                            cell: ({row}) => {
                                const d = row.original.months[monthKey];
                                if (!d)
                                    return (
                                        <div className="text-right text-muted-foreground text-xs">
                                            —
                                        </div>
                                    );
                                const debt = runningDebts(row.original.months)[
                                    index
                                ];
                                return (
                                    <div className="flex items-center justify-end gap-1 px-2 py-1">
                                        <span
                                            className={cn(
                                                "text-sm",
                                                debt > 0 &&
                                                    "text-red-600 font-medium",
                                                debt < 0 && "text-green-600",
                                                debt === 0 &&
                                                    "text-muted-foreground",
                                            )}>
                                            {debt.toLocaleString("uk-UA", {
                                                minimumFractionDigits: 2,
                                            })}
                                        </span>
                                        {/* {isAccountant && (
                                            <button
                                                onClick={() =>
                                                    handleVerify(
                                                        row.original.contractId,
                                                        index + 1,
                                                    )
                                                }
                                                title={
                                                    d.isVerified
                                                        ? "Скасувати перевірку"
                                                        : "Позначити як перевірено"
                                                }
                                                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                                                {d.isVerified ? (
                                                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                                ) : (
                                                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                                                )}
                                            </button>
                                        )} */}
                                    </div>
                                );
                            },
                            size: 95,
                            enableSorting: true,
                        },
                    ],
                };
            },
        );

        // Summary group at end (wrapped in group so structure stays uniform: all top-level cols are groups)
        const totalsGroup: ColumnDef<MonthlyBillData> = {
            id: "totals_group",
            header: "Підсумок",
            columns: [
                {
                    // Рахуємо тільки за вікно (минулі місяці + поточний)
                    id: "totalCharged",
                    accessorFn: (row) =>
                        MONTH_KEYS.reduce((s, mk, i) => {
                            const m = row.months[mk];
                            return m && isCountedMonth(i) ? s + m.charged : s;
                        }, 0),
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.totalCharged}>
                            Нараховано, грн
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const val = getValue() as number;
                        return (
                            <div className="text-right font-semibold px-2 py-1 whitespace-nowrap text-sm">
                                {val.toLocaleString("uk-UA", {
                                    minimumFractionDigits: 2,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 125,
                },
                {
                    // Натуральний аналог «Нараховано, грн» — сумарний обсяг за вікно
                    id: "totalConsumption",
                    accessorFn: (row) =>
                        MONTH_KEYS.reduce((s, mk, i) => {
                            const m = row.months[mk];
                            return m && isCountedMonth(i)
                                ? s + m.consumption
                                : s;
                        }, 0),
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.totalConsumption}>
                            Виставлено обсяг
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const val = getValue() as number;
                        return (
                            <div className="text-right font-semibold px-2 py-1 whitespace-nowrap text-sm">
                                {val.toLocaleString("uk-UA", {
                                    maximumFractionDigits: 9,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 130,
                },
                {
                    id: "totalPaid",
                    accessorFn: (row) =>
                        MONTH_KEYS.reduce((s, mk, i) => {
                            const m = row.months[mk];
                            return m && isCountedMonth(i) ? s + m.paid : s;
                        }, 0),
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.totalPaid}>
                            Фактично сплачено
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const val = getValue() as number;
                        return (
                            <div
                                className={cn(
                                    "text-right font-semibold px-2 py-1 whitespace-nowrap text-sm",
                                    val > 0
                                        ? "text-green-600"
                                        : "text-muted-foreground",
                                )}>
                                {val.toLocaleString("uk-UA", {
                                    minimumFractionDigits: 2,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 145,
                },
                {
                    // «Сума за договором» — річний план, вводиться вручну (ContractService.planned_amount)
                    id: "contractAmount",
                    accessorFn: (row) => row.plannedAmount ?? 0,
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.contractAmount}>
                            Сума за договором
                        </SortableHeader>
                    ),
                    cell: ({row}) => {
                        const csId = row.original.contractServiceId;
                        if (!csId)
                            return (
                                <div className="text-right px-2 py-1 text-sm text-muted-foreground">
                                    —
                                </div>
                            );
                        return (
                            <EditableCell
                                value={row.original.plannedAmount ?? 0}
                                type="currency"
                                className={cn(
                                    "font-semibold text-sm whitespace-nowrap",
                                    row.original.plannedAmount == null &&
                                        "text-muted-foreground",
                                )}
                                onSave={(v) =>
                                    onUpdatePlanned(csId, "planned_amount", v)
                                }
                                cellKey={`${row.id}::contractAmount`}
                            />
                        );
                    },
                    enableSorting: true,
                    size: 145,
                },
                {
                    // «Обсяг за договором» — річний план, вводиться вручну (ContractService.planned_volume)
                    id: "plannedVolume",
                    accessorFn: (row) => row.plannedVolume ?? 0,
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.plannedVolume}>
                            Обсяг за договором
                        </SortableHeader>
                    ),
                    cell: ({row}) => {
                        const csId = row.original.contractServiceId;
                        if (!csId)
                            return (
                                <div className="text-right px-2 py-1 text-sm text-muted-foreground">
                                    —
                                </div>
                            );
                        return (
                            <EditableCell
                                value={row.original.plannedVolume ?? 0}
                                type="quantity"
                                className={cn(
                                    "font-semibold text-sm whitespace-nowrap",
                                    row.original.plannedVolume == null &&
                                        "text-muted-foreground",
                                )}
                                onSave={(v) =>
                                    onUpdatePlanned(csId, "planned_volume", v)
                                }
                                cellKey={`${row.id}::plannedVolume`}
                            />
                        );
                    },
                    enableSorting: true,
                    size: 140,
                },
                {
                    // Залишок (+) = переплата, Недостача (−) = борг
                    id: "balance",
                    accessorFn: (row) => {
                        // Обидві частини — за вікно, щоб сходилось із «Виставлено»/«Сплачено»
                        const paid = MONTH_KEYS.reduce((s, mk, i) => {
                            const m = row.months[mk];
                            return m && isCountedMonth(i) ? s + m.paid : s;
                        }, 0);
                        const due = MONTH_KEYS.reduce((s, mk, i) => {
                            const m = row.months[mk];
                            return m && isCountedMonth(i)
                                ? s + m.charged + m.correction
                                : s;
                        }, 0);
                        return paid - due;
                    },
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.balance}>
                            Залишок (+/−)
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const val = getValue() as number;
                        return (
                            <div
                                className={cn(
                                    "text-right font-semibold px-2 py-1 whitespace-nowrap text-sm",
                                    val > 0 && "text-green-600",
                                    val < 0 && "text-red-600",
                                    val === 0 && "text-muted-foreground",
                                )}>
                                {val > 0 ? "+" : ""}
                                {val.toLocaleString("uk-UA", {
                                    minimumFractionDigits: 2,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 120,
                },
                {
                    // Объёмный аналог «Залишку»: сколько договорного объёма
                    // ещё не выставлено (окно: прошедшие месяцы + текущий)
                    id: "balanceVolume",
                    accessorFn: (row) => {
                        if (row.plannedVolume == null) return 0;
                        const consumed = MONTH_KEYS.reduce((s, mk, i) => {
                            const m = row.months[mk];
                            return m && isCountedMonth(i)
                                ? s + m.consumption
                                : s;
                        }, 0);
                        return row.plannedVolume - consumed;
                    },
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.balanceVolume}>
                            Залишок обсяг
                        </SortableHeader>
                    ),
                    cell: ({row, getValue}) => {
                        // Без ручного плана остаток посчитать не от чего
                        if (row.original.plannedVolume == null)
                            return (
                                <div className="text-right px-2 py-1 text-sm text-muted-foreground">
                                    —
                                </div>
                            );
                        const val = getValue() as number;
                        return (
                            <div
                                className={cn(
                                    "text-right font-semibold px-2 py-1 whitespace-nowrap text-sm",
                                    val > 0 && "text-green-600",
                                    val < 0 && "text-red-600",
                                    val === 0 && "text-muted-foreground",
                                )}>
                                {val.toLocaleString("uk-UA", {
                                    maximumFractionDigits: 9,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 125,
                },
                {
                    id: "totalDebt",
                    accessorFn: (row) =>
                        MONTH_KEYS.reduce((sum, key) => {
                            const m = row.months[key];
                            return m
                                ? sum + (m.charged + m.correction - m.paid)
                                : sum;
                        }, 0),
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.totalDebt}>
                            Заг. борг
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const debt = getValue() as number;
                        return (
                            <div
                                className={cn(
                                    "text-right font-semibold px-2 py-1 whitespace-nowrap text-sm",
                                    debt > 0 && "text-red-600",
                                    debt < 0 && "text-green-600",
                                    debt === 0 && "text-muted-foreground",
                                )}>
                                {debt.toLocaleString("uk-UA", {
                                    minimumFractionDigits: 2,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 110,
                },
                {
                    // Розрах. сума = Σ (нарах. + корекція) за все 12 месяцев:
                    // факт прошлых + план будущих (план — Bill будущих периодов)
                    id: "calcAmount",
                    accessorFn: (row) => calcYearAmount(row),
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.calcAmount}>
                            Розрах. сума
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const val = getValue() as number;
                        return (
                            <div className="text-right font-semibold px-2 py-1 whitespace-nowrap text-sm">
                                {val.toLocaleString("uk-UA", {
                                    minimumFractionDigits: 2,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 120,
                },
                {
                    // Натуральный аналог «Розрах. суми» — объём за весь год
                    id: "calcVolume",
                    accessorFn: (row) => calcYearVolume(row),
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.calcVolume}>
                            Розрах. обсяг
                        </SortableHeader>
                    ),
                    cell: ({getValue}) => {
                        const val = getValue() as number;
                        return (
                            <div className="text-right font-semibold px-2 py-1 whitespace-nowrap text-sm">
                                {val.toLocaleString("uk-UA", {
                                    maximumFractionDigits: 9,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 120,
                },
                {
                    // Розрах. залишок = «Сума за договором» − «Розрах. сума».
                    // ≠ 0 — сигнал, что месячные планы разошлись с договором
                    id: "calcBalance",
                    accessorFn: (row) =>
                        row.plannedAmount != null
                            ? row.plannedAmount - calcYearAmount(row)
                            : 0,
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.calcBalance}>
                            Розрах. залишок
                        </SortableHeader>
                    ),
                    cell: ({row, getValue}) => {
                        // Без ручного плана остаток посчитать не от чего
                        if (row.original.plannedAmount == null)
                            return (
                                <div className="text-right px-2 py-1 text-sm text-muted-foreground">
                                    —
                                </div>
                            );
                        const val = getValue() as number;
                        return (
                            <div
                                className={cn(
                                    "text-right font-semibold px-2 py-1 whitespace-nowrap text-sm",
                                    val > 0 && "text-green-600",
                                    val < 0 && "text-red-600",
                                    val === 0 && "text-muted-foreground",
                                )}>
                                {val.toLocaleString("uk-UA", {
                                    minimumFractionDigits: 2,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 130,
                },
                {
                    // Объёмный залишок = «Обсяг за договором» − «Розрах. обсяг»
                    id: "calcBalanceVolume",
                    accessorFn: (row) =>
                        row.plannedVolume != null
                            ? row.plannedVolume - calcYearVolume(row)
                            : 0,
                    header: ({column}) => (
                        <SortableHeader
                            column={column}
                            hint={TOTALS_HINTS.calcBalanceVolume}>
                            Розрах. зал. обсяг
                        </SortableHeader>
                    ),
                    cell: ({row, getValue}) => {
                        if (row.original.plannedVolume == null)
                            return (
                                <div className="text-right px-2 py-1 text-sm text-muted-foreground">
                                    —
                                </div>
                            );
                        const val = getValue() as number;
                        return (
                            <div
                                className={cn(
                                    "text-right font-semibold px-2 py-1 whitespace-nowrap text-sm",
                                    val > 0 && "text-green-600",
                                    val < 0 && "text-red-600",
                                    val === 0 && "text-muted-foreground",
                                )}>
                                {val.toLocaleString("uk-UA", {
                                    maximumFractionDigits: 9,
                                })}
                            </div>
                        );
                    },
                    enableSorting: true,
                    size: 135,
                },
            ],
        };

        return [tenantGroup, ...monthGroups, totalsGroup];
    }, [
        onUpdateCell,
        onResetAccrual,
        unit,
        isAccountant,
        handleVerify,
        getMonthState,
        onUpdatePlanned,
        isCountedMonth,
    ]);

    const table = useReactTable({
        data,
        columns,
        // Видимость — вычисленная (типы ∩ месяцы), поэтому без
        // onColumnVisibilityChange: менять её можно только через два своих
        // состояния, иначе скрытые месяцы «впеклись» бы в выбор типов
        state: {
            sorting,
            columnFilters,
            columnVisibility: effectiveVisibility,
            columnSizing,
            globalFilter,
        },
        onColumnSizingChange: setColumnSizing,
        // Уже этой ширины колонка становится нечитаемой
        defaultColumn: {minSize: 40},
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        // Поиск — по тексту строки целиком (matchesBillingSearch), а не по
        // каждой колонке отдельно. Одна «поисковая» колонка: иначе функция
        // вызывалась бы на каждую колонку с тем же результатом
        globalFilterFn: (row, _columnId, value) =>
            matchesBillingSearch(row.original, String(value ?? "")),
        getColumnCanGlobalFilter: (column) => column.id === "tenantName",
        enableColumnResizing: true,
        columnResizeMode: "onChange",
    });

    useEffect(() => {
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore)
                    onLoadMore();
            },
            {threshold: 0.1},
        );
        if (loadMoreRef.current)
            observerRef.current.observe(loadMoreRef.current);
        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
    }, [hasMore, isLoadingMore, onLoadMore]);

    const handleExport = async (format: "csv" | "xlsx" | "pdf") => {
        setIsExporting(true);
        try {
            await onExport(format);
        } finally {
            setIsExporting(false);
        }
    };

    // Разбиение видимых строк (уже отсортированы и отфильтрованы TanStack)
    // на основную таблицу и секции відшкодувань. Считаем прямо в рендере без
    // memo: identity `table` стабильна при смене row model, memo протухал бы
    const rowModelRows = table.getRowModel().rows;
    const leafColumns = table.getVisibleLeafColumns();
    const {main: mainRows, sections} = partitionReimbursementSections(
        rowModelRows,
        (r) => r.original,
    );

    // Сетка ключей редактируемых ячеек орендарів для клавиатурной навигации
    // (Enter — вниз по колонке, Tab — вправо). Строится в визуальном порядке:
    // редактируемые колонки из leafColumns (учитывает видимость/порядок),
    // строки — mainRows + строки секцій відшкодувань (порядок рендера).
    // null — ячейки нет (нет Bill за месяц / нет плана) → навигация её проскакивает.
    // Считаем в рендере (как mainRows/sections) — table стабильна, memo протухал бы.
    const editableColIds = leafColumns
        .map((c) => c.id)
        .filter(
            (id) =>
                id.endsWith("_consumption") ||
                id.endsWith("_rate") ||
                id.endsWith("_charged") ||
                id.endsWith("_paid") ||
                id.endsWith("_correction") ||
                id === "contractAmount" ||
                id === "plannedVolume",
        );
    const navRows = [...mainRows, ...sections.flatMap((s) => s.rows)];
    const navGrid: (string | null)[][] = navRows.map((row) =>
        editableColIds.map((colId) => {
            const mKey = colId.split("_")[0] as (typeof MONTH_KEYS)[number];
            if (MONTH_KEYS.indexOf(mKey) >= 0) {
                // Месячная ячейка редактируема, только если за месяц есть Bill
                return row.original.months[mKey] ? `${row.id}::${colId}` : null;
            }
            // Плановые колонки — только при наличии зв'язку договір↔послуга
            return row.original.contractServiceId
                ? `${row.id}::${colId}`
                : null;
        }),
    );

    // Строка данных — общая для основной таблицы и секций відшкодувань.
    // inSection — фиолетовая подкраска, чтобы группу нельзя было спутать
    // с обычными орендарями (виден на колонках без своего фона)
    const renderDataRow = (row: Row<MonthlyBillData>, inSection = false) => (
        <TableRow
            key={row.id}
            className={cn("hover:bg-muted/50", inSection && SECTION_ROW_CN)}>
            {row.getVisibleCells().map((cell) => {
                const colId = cell.column.id;
                const mKey = colId.split("_")[0] as (typeof MONTH_KEYS)[number];
                const mIdx = MONTH_KEYS.indexOf(mKey);
                const isMonthCell = mIdx >= 0;
                const hasData = isMonthCell && !!row.original.months[mKey];
                // border-l на первой подколонке месяца и перед блоком "Підсумок"
                const isBlockStart =
                    colId.endsWith("_consumption") || colId === "totalCharged";
                // Закреплённая колонка: sticky + непрозрачный фон,
                // чтобы месяцы уезжали под неё
                const isPinnedCell = colId === pinnedCol;
                return (
                    <TableCell
                        key={cell.id}
                        style={{
                            width: cell.column.getSize(),
                            left: isPinnedCell ? 0 : undefined,
                        }}
                        className={cn(
                            "py-1.5 px-2 text-sm overflow-hidden",
                            isPinnedCell && PINNED_CELL_CN,
                            isMonthCell &&
                                monthCellBg(getMonthState(mIdx), hasData),
                            EDITABLE_TOTAL_IDS.has(colId) &&
                                EDITABLE_TOTAL_CELL_BG,
                            isBlockStart && "border-l border-border",
                        )}>
                        {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                        )}
                    </TableCell>
                );
            })}
        </TableRow>
    );

    // Рядок постачальника — вручну поверх leafColumns (без TanStack):
    // ті самі ширини/видимість/пін колонок, що й у орендарів, тому
    // місяці вирівняні піксель-у-піксель. Комірки — копії орендарських
    const renderSupplierRow = (row: SupplierMonthlyData) => {
        // Підсумок рядка: Виставлено/обсяг/Сплачено — вікно, Заг. борг — рік
        let winCharged = 0;
        let winConsumption = 0;
        let winPaid = 0;
        let yearDebt = 0;
        MONTH_KEYS.forEach((mk, i) => {
            const m = row.months[mk];
            if (!m) return;
            yearDebt += m.charged + m.correction - m.paid;
            if (isCountedMonth(i)) {
                winCharged += m.charged;
                winConsumption += m.consumption;
                winPaid += m.paid;
            }
        });
        const fmt2 = (v: number) =>
            v.toLocaleString("uk-UA", {minimumFractionDigits: 2});
        // План фонда на год: остатки считаются по тем же формулам, что у
        // арендаторов (calcYearAmount/calcYearVolume). Нет плана — «—»
        const planA = row.plannedAmount;
        const planV = row.plannedVolume;
        const supplierDebts = runningDebts(row.months);
        const yearAmount = calcYearAmount(row);
        const yearVolume = calcYearVolume(row);
        const dash = (
            <div className="text-right text-muted-foreground text-xs">—</div>
        );
        // Окраска остатков — как в арендаторских колонках: по знаку, без «+»
        const signed = (v: number) => (
            <div
                className={cn(
                    "text-right whitespace-nowrap",
                    v > 0 && "text-green-600",
                    v < 0 && "text-red-600",
                    v === 0 && "text-muted-foreground",
                )}>
                {fmt2(v)}
            </div>
        );

        // Имя и номер договора — одна ячейка на обе строки фондов (rowSpan).
        // groupSupplierBills отдаёт строки фондов договора ПОДРЯД в порядке
        // SUPPLIER_FUNDS: объединённую ячейку рисует первая, вторая пропускает
        const isFirstFundRow = row.fund === SUPPLIER_FUNDS[0];

        return (
            <TableRow
                key={`supplier-${row.supplierContractId}-${row.fund}`}
                className={cn("hover:bg-muted/50", SUPPLIER_ROW_CN)}>
                {leafColumns.map((col) => {
                    const colId = col.id;
                    const isMergedCol =
                        colId === "tenantName" || colId === "contractNumber";
                    if (isMergedCol && !isFirstFundRow) return null;
                    const mKey = colId.split(
                        "_",
                    )[0] as (typeof MONTH_KEYS)[number];
                    const mIdx = MONTH_KEYS.indexOf(mKey);
                    const isMonthCell = mIdx >= 0;
                    const m = isMonthCell ? row.months[mKey] : undefined;
                    const isBlockStart =
                        colId.endsWith("_consumption") ||
                        colId === "totalCharged";
                    const isPinnedCell = colId === pinnedCol;

                    let content: React.ReactNode = null;
                    if (colId === "tenantName") {
                        content = (
                            <div
                                className="truncate font-medium"
                                title={row.supplierName}>
                                {row.supplierName}
                            </div>
                        );
                    } else if (colId === "contractNumber") {
                        content = row.contractNumber;
                    } else if (colId === "reimbursementNumber") {
                        // Подпись фонда — в колонке, закреплённой по умолчанию:
                        // остаётся видна при прокрутке по месяцам, когда имя
                        // уже уехало за край. У поставщика колонка иначе пустая
                        content = (
                            <span className="text-xs font-medium text-teal-800 dark:text-teal-300 whitespace-nowrap">
                                {FUND_LABELS[row.fund]}
                            </span>
                        );
                    } else if (isMonthCell && !m) {
                        // Запису за місяць немає — створить «Згенерувати»
                        content = (
                            <div className="text-right text-muted-foreground text-xs">
                                —
                            </div>
                        );
                    } else if (isMonthCell && m) {
                        if (colId.endsWith("_consumption")) {
                            content = (
                                <EditableCell
                                    value={m.consumption}
                                    type="quantity"
                                    onSave={(v) =>
                                        onUpdateSupplierCell!(
                                            m.billId,
                                            "consumption",
                                            v,
                                        )
                                    }
                                />
                            );
                        } else if (colId.endsWith("_rate")) {
                            content = (
                                <EditableCell
                                    value={m.rate}
                                    type="quantity"
                                    onSave={(v) =>
                                        onUpdateSupplierCell!(
                                            m.billId,
                                            "rate",
                                            v,
                                        )
                                    }
                                />
                            );
                        } else if (colId.endsWith("_consumed")) {
                            content = (
                                <div className="text-right px-2 py-1 text-sm select-none text-muted-foreground">
                                    {consumedAmount(m.consumption, m.rate)}
                                </div>
                            );
                        } else if (colId.endsWith("_charged")) {
                            content = (
                                <div className="flex items-center justify-end gap-1 px-2 py-1">
                                    <EditableCell
                                        value={m.charged}
                                        type="currency"
                                        onSave={(v) =>
                                            onUpdateSupplierCell!(
                                                m.billId,
                                                "charged",
                                                v,
                                            )
                                        }
                                        className={
                                            m.isManualAccrual
                                                ? MANUAL_ACCRUAL_CELL
                                                : undefined
                                        }
                                    />
                                    {m.isManualAccrual && (
                                        <button
                                            onClick={() =>
                                                onResetSupplierAccrual?.(
                                                    m.billId,
                                                )
                                            }
                                            title="Нарах. введено вручну — скинути до споживання × тариф"
                                            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
                                            <RotateCcw className="h-3 w-3 text-amber-600" />
                                        </button>
                                    )}
                                </div>
                            );
                        } else if (colId.endsWith("_paid")) {
                            content = (
                                <EditableCell
                                    value={m.paid}
                                    type="currency"
                                    onSave={(v) =>
                                        onUpdateSupplierCell!(
                                            m.billId,
                                            "paid",
                                            v,
                                        )
                                    }
                                    className={cn(
                                        m.paid >= m.charged && "text-green-600",
                                        m.paid > 0 &&
                                            m.paid < m.charged &&
                                            "text-amber-600",
                                        m.paid === 0 &&
                                            m.charged > 0 &&
                                            "text-red-600",
                                    )}
                                />
                            );
                        } else if (colId.endsWith("_correction")) {
                            content = (
                                <EditableCell
                                    value={m.correction}
                                    type="currency"
                                    onSave={(v) =>
                                        onUpdateSupplierCell!(
                                            m.billId,
                                            "correction",
                                            v,
                                        )
                                    }
                                />
                            );
                        } else if (colId.endsWith("_debt")) {
                            // Нарастающий долг — как у арендаторов
                            const debt = supplierDebts[mIdx];
                            content = (
                                <div className="text-right px-2 py-1">
                                    <span
                                        className={cn(
                                            "text-sm",
                                            debt > 0 &&
                                                "text-red-600 font-medium",
                                            debt < 0 && "text-green-600",
                                            debt === 0 &&
                                                "text-muted-foreground",
                                        )}>
                                        {fmt2(debt)}
                                    </span>
                                </div>
                            );
                        }
                    } else if (colId === "totalCharged") {
                        content = (
                            <div className="text-right whitespace-nowrap">
                                {fmt2(winCharged)}
                            </div>
                        );
                    } else if (colId === "totalConsumption") {
                        content = (
                            <div className="text-right whitespace-nowrap">
                                {fmt2(winConsumption)}
                            </div>
                        );
                    } else if (colId === "totalPaid") {
                        content = (
                            <div className="text-right whitespace-nowrap">
                                {fmt2(winPaid)}
                            </div>
                        );
                    } else if (colId === "totalDebt") {
                        content = (
                            <div
                                className={cn(
                                    "text-right whitespace-nowrap",
                                    yearDebt > 0 && "text-red-600 font-medium",
                                )}>
                                {fmt2(yearDebt)}
                            </div>
                        );
                    } else if (colId === "contractAmount") {
                        content = onUpdateSupplierPlan ? (
                            <EditableCell
                                value={planA ?? 0}
                                type="currency"
                                className={cn(
                                    "font-semibold text-sm whitespace-nowrap",
                                    planA == null && "text-muted-foreground",
                                )}
                                onSave={(v) =>
                                    onUpdateSupplierPlan(
                                        row.supplierContractId,
                                        row.fund,
                                        "planned_amount",
                                        v,
                                    )
                                }
                            />
                        ) : null;
                    } else if (colId === "plannedVolume") {
                        content = onUpdateSupplierPlan ? (
                            <EditableCell
                                value={planV ?? 0}
                                type="quantity"
                                className={cn(
                                    "font-semibold text-sm whitespace-nowrap",
                                    planV == null && "text-muted-foreground",
                                )}
                                onSave={(v) =>
                                    onUpdateSupplierPlan(
                                        row.supplierContractId,
                                        row.fund,
                                        "planned_volume",
                                        v,
                                    )
                                }
                            />
                        ) : null;
                    } else if (colId === "balanceVolume") {
                        content =
                            planV == null ? dash : signed(planV - winConsumption);
                    } else if (colId === "calcAmount") {
                        content = (
                            <div className="text-right whitespace-nowrap">
                                {fmt2(yearAmount)}
                            </div>
                        );
                    } else if (colId === "calcVolume") {
                        content = (
                            <div className="text-right whitespace-nowrap">
                                {fmt2(yearVolume)}
                            </div>
                        );
                    } else if (colId === "calcBalance") {
                        // «Сходятся ли суммы» — то, что просил клиент
                        content =
                            planA == null ? dash : signed(planA - yearAmount);
                    } else if (colId === "calcBalanceVolume") {
                        content =
                            planV == null ? dash : signed(planV - yearVolume);
                    }
                    // area/address і «Залишок» (сплач. − нарах.) — порожні:
                    // у постачальника їх немає

                    return (
                        <TableCell
                            key={colId}
                            rowSpan={
                                isMergedCol ? SUPPLIER_FUNDS.length : undefined
                            }
                            style={{
                                width: col.getSize(),
                                left: isPinnedCell ? 0 : undefined,
                            }}
                            className={cn(
                                "py-1.5 px-2 text-sm overflow-hidden",
                                // Боковые границы — как у объединённой ячейки
                                // в Excel: видно, что это одна ячейка на две строки
                                isMergedCol && "align-middle border-x border-border",
                                isPinnedCell && PINNED_CELL_CN,
                                isMonthCell &&
                                    monthCellBg(
                                        getSupplierMonthState(mIdx),
                                        !!m,
                                    ),
                                isBlockStart && "border-l border-border",
                            )}>
                            {content}
                        </TableCell>
                    );
                })}
            </TableRow>
        );
    };

    // Рядок «Різниця» = постачальник − Σ орендарі: об'єм у колонці об'єму,
    // гроші — у «Нарах.»; річні підсумки — під «Виставлено»/«Вист. обсяг»
    const renderSupplierDiffRow = () => (
        <TableRow key="supplier-diff" className={SUPPLIER_DIFF_CN}>
            {leafColumns.map((col, idx) => {
                const colId = col.id;
                if (idx === 0) {
                    return (
                        <TableCell
                            key={colId}
                            style={{width: col.getSize()}}
                            className={cn(
                                "py-1.5 px-2 text-sm overflow-hidden",
                                SUPPLIER_DIFF_LABEL_CN,
                            )}>
                            <div
                                className="truncate"
                                title="Різниця (постачальник − орендарі)">
                                Різниця (пост. − орендарі)
                            </div>
                        </TableCell>
                    );
                }
                const mKey = colId.split("_")[0] as (typeof MONTH_KEYS)[number];
                const mIdx = MONTH_KEYS.indexOf(mKey);
                const isBlockStart =
                    colId.endsWith("_consumption") || colId === "totalCharged";

                let content: React.ReactNode = null;
                if (mIdx >= 0) {
                    const s = supplierMonthTotals[mIdx];
                    if (colId.endsWith("_consumption")) {
                        content = s.hasData ? (
                            <DiffValue
                                value={
                                    s.consumption - (columnTotals[colId] ?? 0)
                                }
                            />
                        ) : (
                            <div className="text-right text-muted-foreground text-xs">
                                —
                            </div>
                        );
                    } else if (colId.endsWith("_charged") && s.hasData) {
                        content = (
                            <DiffValue
                                value={s.charged - (columnTotals[colId] ?? 0)}
                            />
                        );
                    }
                } else if (colId === "totalCharged") {
                    content = <DiffValue value={supplierDiffTotals.money} />;
                } else if (colId === "totalConsumption") {
                    content = <DiffValue value={supplierDiffTotals.volume} />;
                }

                return (
                    <TableCell
                        key={colId}
                        style={{width: col.getSize()}}
                        className={cn(
                            "py-1.5 px-2 text-sm overflow-hidden",
                            isBlockStart && "border-l border-border",
                        )}>
                        {content}
                    </TableCell>
                );
            })}
        </TableRow>
    );

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <aside
                className={cn(
                    "border-r border-border bg-card flex flex-col shrink-0 transition-[width] duration-200",
                    sidebarOpen ? "w-56" : "w-11",
                )}>
                <div
                    className={cn(
                        "p-4 border-b border-border flex items-center",
                        sidebarOpen ? "justify-between" : "justify-center p-2",
                    )}>
                    {sidebarOpen && (
                        <h2 className="font-semibold text-base">Послуги</h2>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title={
                            sidebarOpen
                                ? "Згорнути панель"
                                : "Розгорнути панель"
                        }
                        onClick={toggleSidebar}>
                        {sidebarOpen ? (
                            <PanelLeftClose className="h-4 w-4" />
                        ) : (
                            <PanelLeftOpen className="h-4 w-4" />
                        )}
                    </Button>
                </div>
                {sidebarOpen && (
                    <nav className="flex-1 overflow-y-auto p-2">
                        {services.map((service) => (
                            <button
                                key={service.id}
                                onClick={() => onServiceChange(service.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors text-sm",
                                    service.id === activeServiceId
                                        ? "bg-primary text-primary-foreground"
                                        : "hover:bg-muted",
                                )}>
                                <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor:
                                            service.color || "#3b82f6",
                                    }}
                                />
                                <span className="flex-1 truncate">
                                    {service.name}
                                </span>
                                {service.id === activeServiceId && (
                                    <Check className="h-3.5 w-3.5 shrink-0" />
                                )}
                            </button>
                        ))}
                    </nav>
                )}
            </aside>

            {/* Main content */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* Toolbar */}
                <div className="border-b border-border bg-card px-4 py-3 shrink-0">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[16rem]">
                            <h1
                                className="text-lg font-semibold truncate"
                                title={activeService?.name}>
                                {activeService?.name || "Оберіть послугу"}
                            </h1>
                            <Badge
                                variant="secondary"
                                className="font-mono text-xs shrink-0">
                                {totalCount} записів
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                <Input
                                    placeholder="Пошук..."
                                    value={globalFilter}
                                    onChange={(e) =>
                                        setGlobalFilter(e.target.value)
                                    }
                                    className="w-52 pl-9 h-9"
                                />
                            </div>

                            {/* Year selector */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-24 h-9">
                                        {year}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuLabel>Рік</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {years.map((y) => (
                                        <DropdownMenuCheckboxItem
                                            key={y}
                                            checked={y === year}
                                            onCheckedChange={() =>
                                                onYearChange(y)
                                            }>
                                            {y}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Закрепление левых колонок — набор настраиваемый */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9"
                                        title="Закріпити колонки">
                                        <Pin className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-56">
                                    <DropdownMenuLabel>
                                        Закріплена колонка
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuRadioGroup
                                        value={pinnedCol}
                                        onValueChange={setPinned}>
                                        <DropdownMenuRadioItem value="">
                                            Не закріплювати
                                        </DropdownMenuRadioItem>
                                        {PINNABLE_COLS.map(({id, label}) => (
                                            <DropdownMenuRadioItem
                                                key={id}
                                                value={id}>
                                                {label}
                                            </DropdownMenuRadioItem>
                                        ))}
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Тогл режима "рука": тянуть таблицу мышью vs обычный курсор */}
                            <Button
                                variant={panEnabled ? "secondary" : "outline"}
                                size="icon"
                                className="h-9 w-9"
                                onClick={togglePan}
                                title={
                                    panEnabled
                                        ? "Режим «рука»: тягніть таблицю мишею (натисніть, щоб вимкнути)"
                                        : "Звичайний курсор (натисніть, щоб увімкнути перетягування)"
                                }>
                                {panEnabled ? (
                                    <Hand className="h-4 w-4" />
                                ) : (
                                    <MousePointer2 className="h-4 w-4" />
                                )}
                            </Button>

                            {/* Column visibility — 4 column types in Ukrainian */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 relative"
                                        title={
                                            hiddenMonths.size > 0
                                                ? `Колонки і місяці (приховано місяців: ${hiddenMonths.size})`
                                                : "Колонки і місяці"
                                        }>
                                        <Columns3 className="h-4 w-4" />
                                        {/* Точка: часть месяцев скрыта — выбор
                                        запоминается, легко забыть, куда делся март */}
                                        {hiddenMonths.size > 0 && (
                                            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
                                        )}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-52 max-h-[75vh] overflow-y-auto">
                                    <DropdownMenuLabel>
                                        Показати колонки
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {COL_TYPES.map(({key, label}) => {
                                        // По СВОЕМУ состоянию типов, не по таблице:
                                        // скрытый месяц не должен сбрасывать галочку
                                        const allVisible = MONTH_KEYS.every(
                                            (mk) =>
                                                columnVisibility[
                                                    `${mk}_${key}`
                                                ] !== false,
                                        );
                                        return (
                                            <DropdownMenuCheckboxItem
                                                key={key}
                                                checked={allVisible}
                                                onCheckedChange={(checked) =>
                                                    setColumnVisibility((prev) => {
                                                        const next = {...prev};
                                                        MONTH_KEYS.forEach((mk) => {
                                                            next[`${mk}_${key}`] =
                                                                !!checked;
                                                        });
                                                        return next;
                                                    })
                                                }>
                                                {label}
                                            </DropdownMenuCheckboxItem>
                                        );
                                    })}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel>Місяці</DropdownMenuLabel>
                                    {MONTH_KEYS.map((mk, i) => (
                                        <DropdownMenuCheckboxItem
                                            key={mk}
                                            checked={!hiddenMonths.has(mk)}
                                            // Меню не закрывается — удобно
                                            // скрыть несколько месяцев подряд
                                            onSelect={(e) => e.preventDefault()}
                                            onCheckedChange={(checked) =>
                                                updateHiddenMonths((prev) => {
                                                    const next = new Set(prev);
                                                    if (checked) next.delete(mk);
                                                    else next.add(mk);
                                                    return next;
                                                })
                                            }>
                                            {MONTHS[i]}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                    {hiddenMonths.size > 0 && (
                                        <DropdownMenuItem
                                            onSelect={(e) => {
                                                e.preventDefault();
                                                updateHiddenMonths(() => new Set());
                                            }}>
                                            Показати всі місяці
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {(isManager || isAccountant) && (
                                <Button
                                    variant="outline"
                                    onClick={onGenerateClick}
                                    className="h-9">
                                    <Calendar className="h-4 w-4 mr-2" />
                                    Згенерувати
                                </Button>
                            )}
                            {(isManager || isAccountant) && (
                                <Button
                                    variant="outline"
                                    onClick={onMarkAccruedClick}
                                    className="h-9">
                                    <Calculator className="h-4 w-4 mr-2" />
                                    Нарахування
                                </Button>
                            )}
                            {(isManager || isAccountant) && (
                                <Button
                                    variant="outline"
                                    onClick={onMarkPaidClick}
                                    className="h-9">
                                    <Banknote className="h-4 w-4 mr-2" />
                                    Сплачено
                                </Button>
                            )}
                            {isAccountant && (
                                <Button
                                    variant="outline"
                                    onClick={onClosePeriodClick}
                                    className="h-9">
                                    <Lock className="h-4 w-4 mr-2" />
                                    Закрити/Відкрити
                                </Button>
                            )}

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        disabled={isExporting}
                                        className="h-9">
                                        {isExporting ? (
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        ) : (
                                            <Download className="h-4 w-4 mr-2" />
                                        )}
                                        Експорт
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        onClick={() => handleExport("xlsx")}>
                                        Excel (XLSX) — всі послуги
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => handleExport("csv")}
                                        className="text-muted-foreground">
                                        CSV (незабаром)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => handleExport("pdf")}
                                        className="text-muted-foreground">
                                        PDF (незабаром)
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>

                {/* Table */}
                {/* Внутренняя обёртка shadcn-Table не должна скроллить сама —
                    иначе горизонтальная полоса оказывается под последней строкой */}
                <div
                    ref={tableContainerRef}
                    onMouseDown={handlePanStart}
                    className={cn(
                        "flex-1 min-h-0 overflow-auto",
                        "**:data-[slot=table-container]:overflow-visible",
                        panEnabled && "cursor-grab",
                        isPanning && "cursor-grabbing select-none",
                    )}>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Spinner className="h-8 w-8" />
                        </div>
                    ) : (
                        <BillingNavProvider grid={navGrid}>
                            {/* table-layout: fixed — ширина колонки становится
                            законом, а не пожеланием: иначе браузер не даёт
                            сузить колонку уже содержимого. Ширины — из
                            <colgroup>: первая строка заголовка групповая
                            (colSpan), из неё ширины отдельных колонок не взять */}
                            <Table
                                style={{
                                    tableLayout: "fixed",
                                    width: table.getTotalSize(),
                                }}>
                                <colgroup>
                                    {leafColumns.map((col) => (
                                        <col
                                            key={col.id}
                                            style={{width: col.getSize()}}
                                        />
                                    ))}
                                </colgroup>
                                <TableHeader className="sticky top-0 bg-background z-10">
                                    {table
                                        .getHeaderGroups()
                                        .map((headerGroup, depth) => (
                                            <TableRow key={headerGroup.id}>
                                                {headerGroup.headers.map(
                                                    (header) => {
                                                        const isGroup =
                                                            !header.isPlaceholder &&
                                                            header.subHeaders
                                                                .length > 0;
                                                        const isGroupRow =
                                                            depth === 0;
                                                        // Тинт заголовка месяца по состоянию периода
                                                        const headerId =
                                                            header.column.id;
                                                        const hIdx =
                                                            headerId.startsWith(
                                                                "month_",
                                                            )
                                                                ? MONTH_KEYS.indexOf(
                                                                      headerId.slice(
                                                                          6,
                                                                      ) as (typeof MONTH_KEYS)[number],
                                                                  )
                                                                : -1;
                                                        const hState =
                                                            hIdx >= 0
                                                                ? getMonthState(
                                                                      hIdx,
                                                                  )
                                                                : null;
                                                        // Sticky слева — только листовые заголовки
                                                        // (групповой «Орендар» перекрыл бы месяцы)
                                                        const isPinnedHead =
                                                            !isGroupRow &&
                                                            headerId ===
                                                                pinnedCol;
                                                        return (
                                                            <TableHead
                                                                key={header.id}
                                                                colSpan={
                                                                    header.colSpan
                                                                }
                                                                style={{
                                                                    width: isGroup
                                                                        ? undefined
                                                                        : header.getSize(),
                                                                    left: isPinnedHead
                                                                        ? 0
                                                                        : undefined,
                                                                }}
                                                                className={cn(
                                                                    // relative — для ручки ширины; у
                                                                    // закреплённой колонки sticky ниже
                                                                    // его перекрывает (тоже позиционирует)
                                                                    "relative whitespace-nowrap text-xs",
                                                                    isPinnedHead &&
                                                                        cn(
                                                                            PINNED_CELL_CN,
                                                                            "z-20",
                                                                        ),
                                                                    isGroupRow &&
                                                                        "text-center border-l border-border bg-muted/60 font-semibold py-1.5",
                                                                    !isGroupRow &&
                                                                        "border-l border-border py-1 text-center",
                                                                    hState ===
                                                                        "closed" &&
                                                                        "bg-red-100 dark:bg-red-950/40",
                                                                    hState ===
                                                                        "past" &&
                                                                        "bg-green-100 dark:bg-green-950/40",
                                                                    hState ===
                                                                        "future" &&
                                                                        "bg-blue-100 dark:bg-blue-950/40",
                                                                    EDITABLE_TOTAL_IDS.has(
                                                                        headerId,
                                                                    ) &&
                                                                        EDITABLE_TOTAL_HEADER_BG,
                                                                )}>
                                                                {header.isPlaceholder
                                                                    ? null
                                                                    : flexRender(
                                                                          header
                                                                              .column
                                                                              .columnDef
                                                                              .header,
                                                                          header.getContext(),
                                                                      )}
                                                                {/* Ручка ширины — только у листовых
                                                                колонок: тянуть, двойной клик — сброс */}
                                                                {!isGroup &&
                                                                    !header.isPlaceholder &&
                                                                    header.column.getCanResize() && (
                                                                        <div
                                                                            data-col-resizer
                                                                            onMouseDown={header.getResizeHandler()}
                                                                            onTouchStart={header.getResizeHandler()}
                                                                            onDoubleClick={() =>
                                                                                header.column.resetSize()
                                                                            }
                                                                            title="Потягніть, щоб змінити ширину. Подвійний клік — скинути"
                                                                            className={cn(
                                                                                "absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary/40",
                                                                                header.column.getIsResizing() &&
                                                                                    "bg-primary",
                                                                            )}
                                                                        />
                                                                    )}
                                                            </TableHead>
                                                        );
                                                    },
                                                )}
                                            </TableRow>
                                        ))}
                                </TableHeader>
                                <TableBody>
                                    {rowModelRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={columns.length}
                                                className="h-24 text-center text-muted-foreground">
                                                Немає даних
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {mainRows.map((row) =>
                                                renderDataRow(row),
                                            )}

                                            {/* Секції відшкодувань (документ на 2+ договорів):
                                            банер + рядки + підсумок групи */}
                                            {sections.map((sec) => (
                                                <React.Fragment key={sec.id}>
                                                    <SectionHeaderRow
                                                        label={`Договір відшкодування «${sec.number}»`}
                                                        colSpan={
                                                            leafColumns.length
                                                        }
                                                    />
                                                    {sec.rows.map((row) =>
                                                        renderDataRow(
                                                            row,
                                                            true,
                                                        ),
                                                    )}
                                                    <TotalsRow
                                                        label={`Разом «${sec.number}»`}
                                                        totals={computeTotals(
                                                            sec.rows.map(
                                                                (r) =>
                                                                    r.original,
                                                            ),
                                                            isCountedMonth,
                                                        )}
                                                        leafColumns={
                                                            leafColumns
                                                        }
                                                        labelClassName={
                                                            SECTION_TOTAL_LABEL_CN
                                                        }
                                                        className={
                                                            SECTION_TOTAL_CN
                                                        }
                                                    />
                                                </React.Fragment>
                                            ))}

                                            {/* Общий «Разом» — сумма по всем строкам
                                            (основная таблица + все секции) */}
                                            {data.length > 0 && (
                                                <TotalsRow
                                                    label="Разом"
                                                    totals={columnTotals}
                                                    leafColumns={leafColumns}
                                                    labelClassName={
                                                        GRAND_TOTAL_LABEL_CN
                                                    }
                                                    className="bg-muted/50 border-t-2 border-border font-bold"
                                                />
                                            )}
                                        </>
                                    )}

                                    {/* Блок «Постачальник» — у ТІЙ ЖЕ таблиці:
                                    колонки/ширини/видимість спільні з орендарями */}
                                    {supplierRows &&
                                        supplierRows.length > 0 &&
                                        onUpdateSupplierCell && (
                                            <>
                                                <SectionHeaderRow
                                                    label="Постачальник"
                                                    colSpan={leafColumns.length}
                                                    icon={
                                                        <Truck className="h-4 w-4 shrink-0" />
                                                    }
                                                    className={
                                                        SUPPLIER_HEADER_CN
                                                    }
                                                    textClassName={
                                                        SUPPLIER_HEADER_TEXT_CN
                                                    }
                                                />
                                                {supplierRows.map(
                                                    renderSupplierRow,
                                                )}
                                                {supplierFundTotals.map(
                                                    ({fund, totals}) => (
                                                        <TotalsRow
                                                            key={`supplier-total-${fund}`}
                                                            label={`Разом ${FUND_LABELS[fund].toLowerCase()}`}
                                                            totals={totals}
                                                            leafColumns={
                                                                leafColumns
                                                            }
                                                            className={
                                                                SUPPLIER_SUBTOTAL_CN
                                                            }
                                                            labelClassName={
                                                                SUPPLIER_TOTAL_LABEL_CN
                                                            }
                                                        />
                                                    ),
                                                )}
                                                <TotalsRow
                                                    label="Підсумок"
                                                    totals={supplierGrandTotals}
                                                    leafColumns={leafColumns}
                                                    className={
                                                        SUPPLIER_GRAND_CN
                                                    }
                                                    labelClassName={
                                                        SUPPLIER_GRAND_LABEL_CN
                                                    }
                                                />
                                                {renderSupplierDiffRow()}
                                            </>
                                        )}
                                </TableBody>
                            </Table>
                        </BillingNavProvider>
                    )}
                    {/* Тригер для infinite scroll + індикатор підвантаження */}
                    <div
                        ref={loadMoreRef}
                        className="py-4 flex items-center justify-center">
                        {isLoadingMore && (
                            <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                <Spinner className="h-4 w-4" />
                                <span>Завантаження...</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Завжди внизу контентної зони, поза скролом */}
                {!hasMore && data.length > 0 && (
                    <div className="border-t border-border py-1.5 text-center text-xs text-muted-foreground shrink-0">
                        Всі дані завантажено
                    </div>
                )}
            </div>
        </div>
    );
}

export default BillingTable;
