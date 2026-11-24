/**
 * Excel-експорт білінгової таблиці.
 *
 * Структура файлу (дзеркало таблиці «Рахунки»):
 * - Кожен аркуш = одна послуга
 * - Колонки: Орендар (5) | Місяць×12 (7 підколонок) | Підсумок (12)
 * - Основні рядки → секції відшкодувань (заголовок + рядки + "Разом «№»")
 *   → загальний рядок "Разом" в кінці аркушу
 */
import * as XLSX from "xlsx";
import type {BillingApiService} from "./api-client";
import type {
    Service,
    Contract,
    Tenant,
    MonthlyBillData,
    SupplierMonthlyData,
} from "@/types/billing";
import {
    filterBillingContracts,
    groupBillsByContract,
    resolveReimbursements,
    partitionReimbursementSections,
    filterSupplierContracts,
    groupSupplierBills,
    consumedAmount,
    roundMoney,
    runningDebts,
    FUND_LABELS,
    SUPPLIER_FUNDS,
} from "./billing-utils";

const MONTHS_UA = [
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

// Кількість колонок фіксованої частини (орендар)
const FIXED = 5;
// Кількість підколонок на кожен місяць: обсяг, тариф, спожито, нарах., сплач., корекція, борг
const PER_MONTH = 7;
// Кількість підсумкових колонок
const SUMMARY = 12;

export async function exportBillingXlsx(
    apiService: BillingApiService,
    services: Service[],
    contracts: Contract[],
    tenants: Tenant[],
    year: number,
): Promise<void> {
    // Незалежні запити — паралельно (експорт чекає найповільніший, а не суму).
    // Рахунки — одним запитом за весь рік по всіх послугах
    const [
        allBills,
        allContractServices,
        reimbursements,
        allSupplierContracts,
        allSupplierBills,
        allSupplierPlans,
    ] = await Promise.all([
        apiService.getBills({year}),
        apiService.getContractServices(),
        // Документи відшкодування, чинні у вибраному році (як у таблиці)
        apiService.getReimbursements(),
        // Блок «Постачальник» — дзеркало секції під таблицею
        apiService.getSupplierContracts(),
        apiService.getSupplierBills({year}),
        // Годовые планы фондов — только за экспортируемый год
        apiService.getSupplierFundPlans({year}),
    ]);
    const reimbursementMap = resolveReimbursements(reimbursements, year);

    // Вікно підрахунку підсумків — те саме, що в таблиці (минулі місяці + поточний)
    const now = new Date();
    const isCountedMonth = (monthIndex: number): boolean => {
        if (year < now.getFullYear()) return true;
        if (year > now.getFullYear()) return false;
        return monthIndex + 1 <= now.getMonth() + 1;
    };

    // Приріст значення в акумуляторі підсумків
    const bump = (acc: Record<string, number>, key: string, v: number) => {
        acc[key] = (acc[key] ?? 0) + v;
    };

    // Рядок даних договору. Внесок рядка додається у ВСІ передані акумулятори:
    // загальний "Разом" аркуша і (для рядків секцій) підсумок групи відшкодування
    const makeDataRow = (
        row: MonthlyBillData,
        accs: Record<string, number>[],
    ): (string | number)[] => {
        const dataRow: (string | number)[] = [
            row.tenantName,
            row.area,
            row.address,
            row.contractNumber,
            row.reimbursement?.number ?? "",
        ];

        // Оконні суми (минулі + поточний місяць) — для Виставлено/Обсяг/Сплачено/Залишку;
        // повні (весь рік) — для «Заг. борг», як у таблиці
        let totalCharged = 0;
        let totalConsumption = 0;
        let totalPaid = 0;
        let totalDue = 0;
        let allDue = 0;
        let allPaid = 0;
        let allConsumption = 0;

        // Нарастающий долг (как в таблице). В итоги идёт за КАЖДЫЙ месяц,
        // даже без записи: долг переносится, и сумма нарастающих долгов строк
        // равна нарастающей сумме итогов — ровно так считает таблица
        const debts = runningDebts(row.months);
        MONTH_KEYS.forEach((mk, mIdx) => {
            const m = row.months[mk];
            const debt = debts[mIdx];
            for (const acc of accs) bump(acc, `m${mIdx}_d`, debt);
            if (m) {
                // Спожито = обсяг × тариф — довідкова величина за формулою,
                // на відміну від «Нарах.», яке може бути введене вручну
                const consumed = Number(consumedAmount(m.consumption, m.rate));
                dataRow.push(
                    m.consumption,
                    m.rate,
                    consumed,
                    m.charged,
                    m.paid,
                    m.correction,
                    debt,
                );
                // Суми по колонках місяця
                const base = `m${mIdx}`;
                for (const acc of accs) {
                    bump(acc, `${base}_c`, m.consumption);
                    bump(acc, `${base}_ch`, m.charged);
                    bump(acc, `${base}_p`, m.paid);
                    bump(acc, `${base}_co`, m.correction);
                }
                allDue += m.charged + m.correction;
                allPaid += m.paid;
                allConsumption += m.consumption;
                if (isCountedMonth(mIdx)) {
                    totalCharged += m.charged;
                    totalConsumption += m.consumption;
                    totalPaid += m.paid;
                    totalDue += m.charged + m.correction;
                }
            } else {
                // Місяць без рахунку — порожні комірки
                dataRow.push("", "", "", "", "", "", "");
            }
        });

        const balance = totalPaid - totalDue;
        const totalDebt = allDue - allPaid;
        // Розрах. сума/обсяг = факт прошлых + план будущих = весь год.
        // allDue уже содержит нарах.+корекція по всем месяцам
        const calcAmount = allDue;
        const calcVolume = allConsumption;

        dataRow.push(
            totalCharged,
            totalConsumption,
            totalPaid,
            row.plannedAmount ?? "", // план; '' = пустая ячейка Excel, а не фальшивый 0
            row.plannedVolume ?? "",
            balance,
            // Об'ємний залишок = план − виставлений обсяг (вікно); без плана — пусто
            row.plannedVolume != null
                ? row.plannedVolume - totalConsumption
                : "",
            totalDebt,
            calcAmount,
            calcVolume,
            // Розрах. залишок без плана посчитать не от чего
            row.plannedAmount != null ? row.plannedAmount - calcAmount : "",
            row.plannedVolume != null ? row.plannedVolume - calcVolume : "",
        );

        for (const acc of accs) {
            bump(acc, "s_ch", totalCharged);
            bump(acc, "s_cons", totalConsumption);
            bump(acc, "s_p", totalPaid);
            bump(acc, "s_ca", row.plannedAmount ?? 0);
            bump(acc, "s_pv", row.plannedVolume ?? 0);
            bump(acc, "s_due", totalDue);
            bump(acc, "s_calcA", calcAmount);
            bump(acc, "s_calcV", calcVolume);
            // «Заг. борг» — тільки додатні борги (як у таблиці)
            bump(acc, "s_d", Math.max(0, totalDebt));
        }

        return dataRow;
    };

    // Рядок підсумків з акумулятора: загальний "Разом" або "Разом «№…»" секції
    const makeTotalsRow = (
        label: string,
        t: Record<string, number>,
    ): (string | number)[] => {
        const totalRow: (string | number)[] = [label, "", "", "", ""];
        MONTH_KEYS.forEach((_, mIdx) => {
            const base = `m${mIdx}`;
            totalRow.push(
                t[`${base}_c`] ?? 0,
                "", // тариф не сумується
                "", // спожито не сумується (як тариф)
                t[`${base}_ch`] ?? 0,
                t[`${base}_p`] ?? 0,
                t[`${base}_co`] ?? 0,
                t[`${base}_d`] ?? 0,
            );
        });
        const sTotalPaid = t["s_p"] ?? 0;
        totalRow.push(
            t["s_ch"] ?? 0,
            t["s_cons"] ?? 0, // виставлений обсяг
            sTotalPaid,
            t["s_ca"] ?? 0, // план, грн
            t["s_pv"] ?? 0, // план, обсяг
            sTotalPaid - (t["s_due"] ?? 0), // залишок — від факту
            (t["s_pv"] ?? 0) - (t["s_cons"] ?? 0), // об'ємний залишок — від суми планів
            t["s_d"] ?? 0,
            t["s_calcA"] ?? 0, // розрах. сума за рік
            t["s_calcV"] ?? 0, // розрах. обсяг за рік
            // Розрах. залишки — от суммы планов (как в таблице)
            (t["s_ca"] ?? 0) - (t["s_calcA"] ?? 0),
            (t["s_pv"] ?? 0) - (t["s_calcV"] ?? 0),
        );
        return totalRow;
    };

    // Подытог блока поставщика — той же формы, что строки поставщика:
    // помесячно обсяг/нарах./сплач./корекція/борг (тариф и «Спожито» не
    // суммируются). makeTotalsRow не подходит — он считает «Залишок»
    // (сплач. − нарах.), которого в строках поставщика нет
    const makeSupplierTotalsRow = (
        label: string,
        subset: SupplierMonthlyData[],
    ): (string | number)[] => {
        const totalRow: (string | number)[] = [label, "", "", "", ""];
        let winCharged = 0;
        let winConsumption = 0;
        let winPaid = 0;
        let allDebt = 0;
        let debtAcc = 0;
        let yearAmount = 0;
        let yearVolume = 0;
        MONTH_KEYS.forEach((mk, mIdx) => {
            let c = 0;
            let ch = 0;
            let p = 0;
            let co = 0;
            for (const r of subset) {
                const m = r.months[mk];
                if (!m) continue;
                c += m.consumption;
                ch += m.charged;
                p += m.paid;
                co += m.correction;
            }
            const d = ch + co - p;
            allDebt += d;
            // Нарастающий долг — как в таблице; half-up на каждом шаге
            debtAcc = Number(roundMoney(debtAcc + d));
            totalRow.push(c, "", "", ch, p, co, debtAcc);
            yearAmount += ch + co;
            yearVolume += c;
            if (isCountedMonth(mIdx)) {
                winCharged += ch;
                winConsumption += c;
                winPaid += p;
            }
        });
        // Как computeTotals в таблице: план — сумма планов строк (нет плана = 0),
        // остатки — от суммы планов; «Залишок» (сплач. − нарах.) не выводим
        const planA = subset.reduce((sum, r) => sum + (r.plannedAmount ?? 0), 0);
        const planV = subset.reduce((sum, r) => sum + (r.plannedVolume ?? 0), 0);
        totalRow.push(
            winCharged,
            winConsumption,
            winPaid,
            planA,
            planV,
            "",
            planV - winConsumption,
            allDebt,
            yearAmount,
            yearVolume,
            planA - yearAmount,
            planV - yearVolume,
        );
        return totalRow;
    };

    const wb = XLSX.utils.book_new();

    for (const service of services) {
        // Рахунки тільки для цієї послуги
        const serviceBills = allBills.filter(
            (b) => b.service_id === service.id,
        );
        // Договори — ті самі, що бачить таблиця: активні, з підключеною
        // послугою, чинні у вибраному році (спільний хелпер)
        const serviceContracts = filterBillingContracts(
            contracts,
            allContractServices,
            service.id,
            year,
        );
        const tableData = groupBillsByContract(
            serviceBills,
            serviceContracts,
            tenants,
            service.id,
            allContractServices,
            reimbursementMap,
        );

        // Аркуш пустий — пропускаємо, щоб не захаращувати файл
        if (tableData.length === 0) continue;

        const totalCols = FIXED + 12 * PER_MONTH + SUMMARY;
        const rows: (string | number)[][] = [];

        // ── Рядок 0: заголовок ──────────────────────────────────────────
        rows.push([`${service.name} — ${year} рік`]);

        // ── Рядок 1: порожній ───────────────────────────────────────────
        rows.push([]);

        // ── Рядок 2: групові заголовки ──────────────────────────────────
        const groupRow: string[] = ["Орендар", "", "", "", ""];
        MONTHS_UA.forEach((m) => {
            groupRow.push(m);
            for (let i = 1; i < PER_MONTH; i++) groupRow.push("");
        });
        // Пустышки после «Підсумок» — под merge на всю ширину блока
        groupRow.push("Підсумок", ...Array(SUMMARY - 1).fill(""));
        rows.push(groupRow);

        // ── Рядок 3: підзаголовки ───────────────────────────────────────
        const subRow: string[] = [
            "Ім'я орендаря",
            "Площа, м²",
            "Адреса",
            "№ договору",
            "№ відшкодування",
        ];
        MONTHS_UA.forEach(() => {
            subRow.push(
                service.unit_name,
                "Тариф",
                "Спожито",
                "Нарах.",
                "Сплач.",
                "Корекція",
                "Борг",
            );
        });
        subRow.push(
            "Нараховано, грн",
            "Вист. обсяг",
            "Сплачено",
            "За договором",
            "Обсяг за дог.",
            "Залишок",
            "Залишок обсяг",
            "Заг. борг",
            "Розрах. сума",
            "Розрах. обсяг",
            "Розрах. залишок",
            "Розрах. зал. обсяг",
        );

        rows.push(subRow);

        // ── Рядки даних ─────────────────────────────────────────────────
        // Розбиття те саме, що в таблиці «Рахунки» (спільний хелпер)
        const {main: mainRows, sections} = partitionReimbursementSections(
            tableData,
            (row) => row,
        );

        // Загальний "Разом" аркуша накопичується по всіх рядках
        const grandTotals: Record<string, number> = {};

        for (const row of mainRows) {
            rows.push(makeDataRow(row, [grandTotals]));
        }

        // Секції: заголовок + рядки (внесок і в загальний, і в груповий
        // акумулятор) + підсумок групи
        for (const sec of sections) {
            rows.push([`Відшкодування «${sec.number}»`]);
            const secTotals: Record<string, number> = {};
            for (const row of sec.rows) {
                rows.push(makeDataRow(row, [grandTotals, secTotals]));
            }
            rows.push(makeTotalsRow(`Разом «${sec.number}»`, secTotals));
        }

        // ── Загальний рядок "Разом" ─────────────────────────────────────
        rows.push(makeTotalsRow("Разом", grandTotals));

        // ── Блок «Постачальник» (якщо для послуги є договори) ──────────
        // Дзеркало секції під таблицею: два рядки на договір (по фонду),
        // три підсумки (спец. / заг. / «Підсумок») + рядок «Різниця».
        // Немає договорів → аркуш не змінюється взагалі
        const supplierRows = groupSupplierBills(
            allSupplierBills.filter((b) => b.service_id === service.id),
            filterSupplierContracts(allSupplierContracts, service.id, year),
            allSupplierPlans.filter((pl) => pl.service_id === service.id),
        );
        if (supplierRows.length > 0) {
            rows.push([]);
            rows.push(["Постачальник"]);

            // Помісячні суми постачальників — для рядка «Різниця»
            const supMonth = MONTH_KEYS.map(() => ({
                c: 0,
                ch: 0,
                hasData: false,
            }));

            for (const row of supplierRows) {
                // Ліві колонки: ім'я в колонці «Ім'я», номер — під «№ договору».
                // Фонд — в имени: две строки на договор иначе неотличимы
                const dataRow: (string | number)[] = [
                    `${row.supplierName} — ${FUND_LABELS[row.fund]}`,
                    "",
                    "",
                    row.contractNumber,
                    "",
                ];
                let winCharged = 0;
                let winConsumption = 0;
                let winPaid = 0;
                let allDebt = 0;
                // За весь год — для «Розрах. сума/обсяг» и остатков плана
                let yearAmount = 0;
                let yearVolume = 0;
                // В ячейку месяца — нарастающий долг (как в таблице)
                const debts = runningDebts(row.months);
                MONTH_KEYS.forEach((mk, mIdx) => {
                    const m = row.months[mk];
                    if (m) {
                        yearAmount += m.charged + m.correction;
                        yearVolume += m.consumption;
                        const debt = debts[mIdx];
                        const consumed = Number(
                            consumedAmount(m.consumption, m.rate),
                        );
                        dataRow.push(
                            m.consumption,
                            m.rate,
                            consumed,
                            m.charged,
                            m.paid,
                            m.correction,
                            debt,
                        );
                        supMonth[mIdx].c += m.consumption;
                        supMonth[mIdx].ch += m.charged;
                        supMonth[mIdx].hasData = true;
                        // Годовой «Заг. борг» — сумма долгов месяцев,
                        // не сумма нарастающих (та была бы завышена)
                        allDebt += m.charged + m.correction - m.paid;
                        if (isCountedMonth(mIdx)) {
                            winCharged += m.charged;
                            winConsumption += m.consumption;
                            winPaid += m.paid;
                        }
                    } else {
                        dataRow.push("", "", "", "", "", "", "");
                    }
                });
                // «Підсумок» — как в таблице: без «Залишку» (сплач. − нарах.);
                // колонки от плана пустые, если плана фонда на год нет
                const planA = row.plannedAmount;
                const planV = row.plannedVolume;
                dataRow.push(
                    winCharged,
                    winConsumption,
                    winPaid,
                    planA ?? "",
                    planV ?? "",
                    "",
                    planV != null ? planV - winConsumption : "",
                    allDebt,
                    yearAmount,
                    yearVolume,
                    planA != null ? planA - yearAmount : "",
                    planV != null ? planV - yearVolume : "",
                );
                rows.push(dataRow);
            }

            // Подытоги — как в таблице: по каждому фонду + общий «Підсумок»
            for (const fund of SUPPLIER_FUNDS) {
                rows.push(
                    makeSupplierTotalsRow(
                        `Разом ${FUND_LABELS[fund].toLowerCase()}`,
                        supplierRows.filter((r) => r.fund === fund),
                    ),
                );
            }
            rows.push(makeSupplierTotalsRow("Підсумок", supplierRows));

            // Рядок «Різниця» = постачальник − Σ орендарі, тільки за місяці
            // із записом постачальника (як у таблиці). Об'єм — у колонці
            // об'єму, гроші — у колонці «Нарах.»
            const diffRow: (string | number)[] = [
                "Різниця (пост. − орендарі)",
                "",
                "",
                "",
                "",
            ];
            let diffMoney = 0;
            let diffVolume = 0;
            MONTH_KEYS.forEach((_, mIdx) => {
                const s = supMonth[mIdx];
                if (!s.hasData) {
                    diffRow.push("", "", "", "", "", "", "");
                    return;
                }
                const dVol = s.c - (grandTotals[`m${mIdx}_c`] ?? 0);
                const dMoney = s.ch - (grandTotals[`m${mIdx}_ch`] ?? 0);
                diffRow.push(dVol, "", "", dMoney, "", "", "");
                if (isCountedMonth(mIdx)) {
                    diffVolume += dVol;
                    diffMoney += dMoney;
                }
            });
            // Річні підсумки різниці: гроші під «Нараховано, грн», об'єм під «Вист. обсяг»
            diffRow.push(
                diffMoney,
                diffVolume,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            );
            rows.push(diffRow);
        }

        // ── Створення аркушу ────────────────────────────────────────────
        const ws = XLSX.utils.aoa_to_sheet(rows);

        // Злиття комірок (merges)
        ws["!merges"] = [
            // Рядок 0 — заголовок на всю ширину
            {s: {r: 0, c: 0}, e: {r: 0, c: totalCols - 1}},
            // Рядок 2 — "Орендар"
            {s: {r: 2, c: 0}, e: {r: 2, c: FIXED - 1}},
        ];
        // Рядок 2 — місяці
        MONTHS_UA.forEach((_, i) => {
            ws["!merges"]!.push({
                s: {r: 2, c: FIXED + i * PER_MONTH},
                e: {r: 2, c: FIXED + i * PER_MONTH + PER_MONTH - 1},
            });
        });
        // Рядок 2 — "Підсумок"
        ws["!merges"]!.push({
            s: {r: 2, c: FIXED + 12 * PER_MONTH},
            e: {r: 2, c: totalCols - 1},
        });

        // Ширина колонок
        ws["!cols"] = [
            {wch: 28}, // ім'я
            {wch: 8}, // площа
            {wch: 22}, // адреса
            {wch: 13}, // договір
            {wch: 15}, // № відшкодування
            // Ширини підколонок місяця, у порядку [обсяг, тариф, спожито,
            // нарах., сплач., корекція, борг] — тариф і нарах. трохи ширші
            ...Array(12 * PER_MONTH)
                .fill(null)
                .map((_, i) => ({
                    wch: [9, 11, 10, 11, 10, 10, 10][i % PER_MONTH],
                })),
            {wch: 14}, // Нараховано, грн
            {wch: 13}, // Вист. обсяг
            {wch: 13}, // Сплачено
            {wch: 14}, // За договором
            {wch: 14}, // Обсяг за дог.
            {wch: 11}, // Залишок
            {wch: 13}, // Залишок обсяг
            {wch: 11}, // Заг. борг
            {wch: 13}, // Розрах. сума
            {wch: 13}, // Розрах. обсяг
            {wch: 15}, // Розрах. залишок
            {wch: 16}, // Розрах. зал. обсяг
        ];

        // Excel не дозволяє аркуш довший за 31 символ
        const sheetName = service.name.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    if (wb.SheetNames.length === 0) {
        throw new Error("Немає даних для експорту за вибраний рік");
    }

    // Зберігаємо файл
    XLSX.writeFile(wb, `billing_${year}.xlsx`);
}
