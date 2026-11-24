import {useEffect, useMemo, useRef} from "react";
import {useForm, useWatch} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {toast} from "sonner";
import {useSWRConfig} from "swr";

import {useAuthContext} from "@/context/auth-provider";
import {
    useSuppliers,
    useServices,
    useSupplierFundPlans,
} from "@/hooks/use-billing-data";
import type {SupplierContract} from "@/types/billing";
import {getApiError} from "@/lib/api-error";
import {FUND_LABELS, SUPPLIER_FUNDS, roundMoney} from "@/lib/billing-utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {SearchableSelect} from "@/components/ui/searchable-select";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Spinner} from "@/components/ui/spinner";

// Число плана: пусто — плана нет; разделитель — запятая или точка,
// пробелы-разделители тысяч допускаются («42 198,13»)
const planNumber = z
    .string()
    .trim()
    .optional()
    .refine(
        (v) => !v || /^\d+([.,]\d+)?$/.test(v.replace(/\s/g, "")),
        "Число ≥ 0, наприклад 42198,13",
    );

// Пустая строка → null (плана нет), иначе число. Конвенция: запятая → точка
function parsePlanNumber(v?: string): number | null {
    const t = (v ?? "").replace(/\s/g, "").replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

const supplierContractSchema = z.object({
    supplier_id: z.string().min(1, "Виберіть постачальника"),
    service_id: z.string().min(1, "Виберіть послугу"),
    number: z.string().trim().min(1, "Номер обов'язковий").max(50),
    date_start: z.string().min(1, "Дата початку обов'язкова"),
    date_end: z.string().optional().or(z.literal("")),
    note: z.string().trim().max(200).optional().or(z.literal("")),
    // Годовой план по фондам (SupplierFundPlan) — за выбранный год
    plan_year: z.string(),
    spec_amount: planNumber,
    spec_volume: planNumber,
    general_amount: planNumber,
    general_volume: planNumber,
});

type SupplierContractFormValues = z.infer<typeof supplierContractSchema>;

interface SupplierContractFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contract?: SupplierContract | null;
}

// Год, на который по умолчанию вводится план: договор поставщика обычно
// годовой — берём год начала; без даты — текущий
function defaultPlanYear(dateStart?: string | null): string {
    return dateStart
        ? dateStart.slice(0, 4)
        : String(new Date().getFullYear());
}

export function SupplierContractFormDialog({
    open,
    onOpenChange,
    contract,
}: SupplierContractFormDialogProps) {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const isEdit = Boolean(contract);

    const {data: suppliers, isLoading: suppliersLoading} = useSuppliers();
    const {data: services, isLoading: servicesLoading} = useServices();
    // Все планы этого договора (по всем годам) — выбор года без запросов
    const {data: contractPlans} = useSupplierFundPlans(
        contract ? {supplier_contract_id: contract.id} : undefined,
    );

    const form = useForm<SupplierContractFormValues>({
        resolver: zodResolver(supplierContractSchema),
        defaultValues: {
            supplier_id: "",
            service_id: "",
            number: "",
            date_start: "",
            date_end: "",
            note: "",
            plan_year: defaultPlanYear(),
            spec_amount: "",
            spec_volume: "",
            general_amount: "",
            general_volume: "",
        },
    });

    // Поля плана заполняются из базы ОДИН раз на (договор, год) — см. ниже
    const populatedFor = useRef<string | null>(null);

    // Заполняем форму при открытии (создание или редактирование)
    useEffect(() => {
        if (open) {
            form.reset({
                supplier_id: contract ? String(contract.supplier_id) : "",
                service_id: contract ? String(contract.service_id) : "",
                number: contract?.number ?? "",
                date_start: contract?.date_start ?? "",
                date_end: contract?.date_end ?? "",
                note: contract?.note ?? "",
                plan_year: defaultPlanYear(contract?.date_start),
                spec_amount: "",
                spec_volume: "",
                general_amount: "",
                general_volume: "",
            });
            populatedFor.current = null;
        }
    }, [open, contract, form]);

    // useWatch, а не form.watch: совместим с компилятором React
    const [planYear, dateStart, dateEnd, serviceId] = useWatch({
        control: form.control,
        name: ["plan_year", "date_start", "date_end", "service_id"],
    });

    // Поля плана заполняются из базы ОДИН раз на (договор, год): при открытии
    // и при смене года. Планы приходят с автообновлением каждые 30 с —
    // заполняй мы поля на каждый ответ, введённое число затиралось бы
    useEffect(() => {
        if (!open) return;
        // Существующий договор — ждём загрузки планов, иначе поля станут пустыми
        if (contract && !contractPlans) return;
        const key = `${contract?.id ?? "new"}:${planYear}`;
        if (populatedFor.current === key) return;
        populatedFor.current = key;
        for (const fund of SUPPLIER_FUNDS) {
            const plan = contractPlans?.find(
                (p) => p.year === Number(planYear) && p.fund === fund,
            );
            form.setValue(`${fund}_amount`, plan?.planned_amount ?? "");
            form.setValue(`${fund}_volume`, plan?.planned_volume ?? "");
        }
    }, [open, contract, contractPlans, planYear, form]);

    // Годы для плана — годы действия договора. Бессрочный — до следующего
    // года. Один год — показываем текстом, без выбора
    const yearOptions = useMemo(() => {
        const current = new Date().getFullYear();
        const start = dateStart ? Number(dateStart.slice(0, 4)) : current;
        const end = dateEnd
            ? Number(dateEnd.slice(0, 4))
            : Math.max(start, current) + 1;
        const years: string[] = [];
        for (let y = start; y <= Math.max(start, end); y++) years.push(String(y));
        // Уже выбранный год не должен пропасть из списка при правке дат
        if (!years.includes(planYear)) years.push(planYear);
        return years.sort();
    }, [dateStart, dateEnd, planYear]);

    const unitName = services?.find(
        (s) => String(s.id) === serviceId,
    )?.unit_name;

    const onSubmit = async (values: SupplierContractFormValues) => {
        // Конвенции проекта: id из строки в число, пустая дата → null (безстроковий)
        const payload = {
            supplier_id: parseInt(values.supplier_id, 10),
            service_id: parseInt(values.service_id, 10),
            number: values.number,
            date_start: values.date_start,
            date_end: values.date_end || null,
            note: values.note ?? "",
        };

        let contractId: number;
        try {
            if (isEdit && contract) {
                await apiService.updateSupplierContract(contract.id, payload);
                contractId = contract.id;
                toast.success(`Договір ${values.number} оновлено`);
            } else {
                const created =
                    await apiService.createSupplierContract(payload);
                contractId = created.id;
                toast.success(`Договір ${values.number} додано`);
            }
            // Точный префикс: обновляет и список на этой странице,
            // и отфильтрованные ключи секции в «Рахунках»
            await mutate(
                (key) =>
                    typeof key === "string" &&
                    key.startsWith("/supplier-contracts"),
            );
        } catch (e: unknown) {
            // 400 от overlap-валидации бэка покажется человекочитаемым текстом
            toast.error(getApiError(e, "Помилка збереження"));
            return;
        }

        // План — после договора: у нового договора id появляется только сейчас
        try {
            const year = Number(values.plan_year);
            for (const fund of SUPPLIER_FUNDS) {
                const amount = parsePlanNumber(values[`${fund}_amount`]);
                const volume = parsePlanNumber(values[`${fund}_volume`]);
                const existing = contractPlans?.find(
                    (p) => p.year === year && p.fund === fund,
                );
                const planPayload = {
                    // Деньги — только half-up (roundMoney)
                    planned_amount: amount == null ? null : roundMoney(amount),
                    planned_volume: volume == null ? null : String(volume),
                };
                if (existing) {
                    await apiService.updateSupplierFundPlan(
                        existing.id,
                        planPayload,
                    );
                } else if (amount != null || volume != null) {
                    // Пустой план не создаём — «нет записи» и значит «плана нет»
                    await apiService.createSupplierFundPlan({
                        supplier_contract_id: contractId,
                        year,
                        fund,
                        ...planPayload,
                    });
                }
            }
            await mutate(
                (key) =>
                    typeof key === "string" &&
                    key.startsWith("/supplier-fund-plans"),
            );
            onOpenChange(false);
        } catch (e: unknown) {
            // Договор уже сохранён: повторный «Додати» создал бы дубль.
            // Поэтому закрываем и говорим, где дописать план
            toast.error(
                getApiError(
                    e,
                    "Договір збережено, але план не збережено — внесіть його ще раз у договорі або в «Рахунках»",
                ),
            );
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit
                            ? "Редагування договору постачальника"
                            : "Новий договір постачальника"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Зміни буде збережено після підтвердження."
                            : "Договір діє на одну послугу. Періоди договорів однієї послуги не можуть перетинатися."}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4">
                        <FormField
                            control={form.control}
                            name="supplier_id"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Постачальник *</FormLabel>
                                    <FormControl className="overflow-hidden">
                                        <SearchableSelect
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            disabled={suppliersLoading}
                                            placeholder={
                                                suppliersLoading
                                                    ? "Завантаження..."
                                                    : "Виберіть постачальника"
                                            }
                                            searchPlaceholder="Пошук постачальника..."
                                            emptyText="Постачальника не знайдено"
                                            options={
                                                suppliers?.map((s) => ({
                                                    value: String(s.id),
                                                    label: s.name,
                                                })) ?? []
                                            }
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <FormField
                                control={form.control}
                                name="service_id"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Послуга *</FormLabel>
                                        <FormControl className="overflow-hidden">
                                            <SearchableSelect
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                disabled={servicesLoading}
                                                placeholder={
                                                    servicesLoading
                                                        ? "Завантаження..."
                                                        : "Виберіть послугу"
                                                }
                                                searchPlaceholder="Пошук послуги..."
                                                emptyText="Послугу не знайдено"
                                                options={
                                                    services?.map((s) => ({
                                                        value: String(s.id),
                                                        label: s.name,
                                                    })) ?? []
                                                }
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="number"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Номер договору *</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="№45/26"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <FormField
                                control={form.control}
                                name="date_start"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Дата початку *</FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="date_end"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>
                                            Дата закінчення
                                            <span className="text-muted-foreground font-normal">
                                                {" "}
                                                (порожньо = безстроковий)
                                            </span>
                                        </FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="note"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Примітка</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Необов'язково"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Годовой план по фондам — те же SupplierFundPlan, что
                        правятся в «Рахунках» (колонки «Сума/Обсяг за договором») */}
                        <div className="rounded-md border p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium">
                                    План на рік
                                </span>
                                {yearOptions.length > 1 ? (
                                    <FormField
                                        control={form.control}
                                        name="plan_year"
                                        render={({field}) => (
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}>
                                                <SelectTrigger className="h-8 w-24">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {yearOptions.map((y) => (
                                                        <SelectItem
                                                            key={y}
                                                            value={y}>
                                                            {y}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                ) : (
                                    <span className="text-sm text-muted-foreground">
                                        {planYear}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-2 text-xs text-muted-foreground">
                                <span />
                                <span>Сума, грн</span>
                                <span>Обсяг{unitName ? `, ${unitName}` : ""}</span>
                            </div>
                            {SUPPLIER_FUNDS.map((fund) => (
                                <div
                                    key={fund}
                                    className="grid grid-cols-[6.5rem_1fr_1fr] gap-2 items-start">
                                    <span className="text-sm pt-2">
                                        {FUND_LABELS[fund]}
                                    </span>
                                    <FormField
                                        control={form.control}
                                        name={`${fund}_amount`}
                                        render={({field}) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input
                                                        inputMode="decimal"
                                                        placeholder="—"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name={`${fund}_volume`}
                                        render={({field}) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input
                                                        inputMode="decimal"
                                                        placeholder="—"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            ))}
                        </div>

                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                disabled={form.formState.isSubmitting}>
                                Скасувати
                            </Button>
                            <Button
                                type="submit"
                                disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting && (
                                    <Spinner className="mr-2 h-4 w-4" />
                                )}
                                {isEdit ? "Зберегти" : "Додати"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
