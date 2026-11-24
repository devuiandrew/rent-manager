import {useMemo, useState} from "react";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {toast} from "sonner";
import {useSWRConfig} from "swr";
import {Search} from "lucide-react";

import {useAuthContext} from "@/context/auth-provider";
import {useContracts} from "@/hooks/use-billing-data";
import type {Contract, ReimbursementContract} from "@/types/billing";
import {getApiError} from "@/lib/api-error";
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
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Spinner} from "@/components/ui/spinner";

// Схема полей документа. Договоры выбираются отдельно (Set вне формы) —
// zod валидирует только простые поля
const reimbursementSchema = z
    .object({
        number: z.string().trim().min(1, "Номер обов'язковий").max(50),
        date_start: z.string().min(1, "Дата початку обов'язкова"),
        date_end: z.string().min(1, "Дата закінчення обов'язкова"),
        note: z.string().trim().max(200).optional().or(z.literal("")),
    })
    // ISO-даты YYYY-MM-DD сравниваются как строки корректно
    .refine((v) => !v.date_start || !v.date_end || v.date_end >= v.date_start, {
        message: "Дата закінчення не може бути раніше дати початку",
        path: ["date_end"],
    });

type ReimbursementFormValues = z.infer<typeof reimbursementSchema>;

interface ReimbursementFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // null = создание нового документа
    reimbursement?: ReimbursementContract | null;
}

export function ReimbursementFormDialog({
    open,
    onOpenChange,
    reimbursement,
}: ReimbursementFormDialogProps) {
    const isEdit = Boolean(reimbursement);
    // Список договоров грузим во внешнем компоненте (он живёт постоянно) —
    // иначе каждое открытие диалога дёргало бы /contracts заново
    const {data: contracts, isLoading: contractsLoading} = useContracts();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit
                            ? "Редагувати відшкодування"
                            : "Новий договір відшкодування"}
                    </DialogTitle>
                    <DialogDescription>
                        Документ діє протягом періоду і може покривати кілька
                        договорів оренди (навіть різних орендарів).
                    </DialogDescription>
                </DialogHeader>

                {/* Radix монтирует содержимое DialogContent только пока диалог
                    открыт, поэтому стейт формы и выбора договоров получает
                    начальные значения при каждом открытии сам — ручной сброс
                    не нужен */}
                <ReimbursementFormBody
                    reimbursement={reimbursement ?? null}
                    contracts={contracts}
                    contractsLoading={contractsLoading}
                    onOpenChange={onOpenChange}
                />
            </DialogContent>
        </Dialog>
    );
}

function ReimbursementFormBody({
    reimbursement,
    contracts,
    contractsLoading,
    onOpenChange,
}: {
    reimbursement: ReimbursementContract | null;
    contracts: Contract[] | undefined;
    contractsLoading: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const isEdit = Boolean(reimbursement);

    // Выбранные договоры аренды — вне zod (Set удобнее для toggle)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(
        () => new Set(reimbursement?.contract_ids ?? []),
    );
    const [contractSearch, setContractSearch] = useState("");

    const form = useForm<ReimbursementFormValues>({
        resolver: zodResolver(reimbursementSchema),
        defaultValues: {
            number: reimbursement?.number ?? "",
            date_start: reimbursement?.date_start ?? "",
            date_end: reimbursement?.date_end ?? "",
            note: reimbursement?.note ?? "",
        },
    });

    // Показываем активные договоры + неактивные, но уже привязанные к документу
    // (чтобы при редактировании старого документа его договоры не "исчезали")
    const visibleContracts = useMemo(() => {
        const linked = new Set(reimbursement?.contract_ids ?? []);
        const list = (contracts ?? []).filter(
            (c) => c.is_active || linked.has(c.id),
        );
        const q = contractSearch.trim().toLowerCase();
        if (!q) return list;
        return list.filter((c) =>
            [c.contract_number, c.tenant_name, c.address].some((v) =>
                v.toLowerCase().includes(q),
            ),
        );
    }, [contracts, reimbursement, contractSearch]);

    const toggleContract = (id: number) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const onSubmit = async (values: ReimbursementFormValues) => {
        const payload = {
            number: values.number,
            date_start: values.date_start,
            date_end: values.date_end,
            note: values.note ?? "",
            contract_ids: [...selectedIds],
        };
        try {
            if (isEdit && reimbursement) {
                await apiService.updateReimbursement(reimbursement.id, payload);
                toast.success(`Відшкодування «${values.number}» оновлено`);
            } else {
                await apiService.createReimbursement(payload);
                toast.success(`Відшкодування «${values.number}» додано`);
            }
            // Обновляем список документов и договоры (у них меняется вычисляемый
            // номер відшкодування) — параллельно, запросы независимы
            await Promise.all([
                mutate("/reimbursement-contracts"),
                mutate("/contracts"),
            ]);
            onOpenChange(false);
        } catch (e: unknown) {
            // getApiError достаёт текст валидации с бэка (напр. пересечение периодов)
            toast.error(getApiError(e, "Помилка збереження"));
        }
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4 flex-1 min-h-0 flex flex-col overflow-hidden"
            >
                <div className="grid grid-cols-3 gap-3 shrink-0">
                    <FormField
                        control={form.control}
                        name="number"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel>Номер *</FormLabel>
                                <FormControl>
                                    <Input placeholder="№232" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="date_start"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel>Діє з *</FormLabel>
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
                                <FormLabel>Діє по *</FormLabel>
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
                        <FormItem className="shrink-0">
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

                {/* Мультивибір договорів оренди */}
                <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between shrink-0">
                        <p className="text-sm font-medium">
                            Договори оренди *
                        </p>
                        <span className="text-xs text-muted-foreground">
                            обрано: {selectedIds.size}
                        </span>
                    </div>
                    <div className="relative shrink-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            placeholder="Пошук за номером, орендарем або адресою..."
                            value={contractSearch}
                            onChange={(e) => setContractSearch(e.target.value)}
                            className="pl-9 h-9"
                        />
                    </div>

                    {contractsLoading ? (
                        <div className="flex items-center justify-center h-32 border rounded-md">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : visibleContracts.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border rounded-md">
                            {contractSearch
                                ? "Нічого не знайдено"
                                : "Немає активних договорів"}
                        </div>
                    ) : (
                        <div className="border rounded-md overflow-auto flex-1 min-h-0 max-h-56 divide-y">
                            {visibleContracts.map((c) => (
                                <label
                                    key={c.id}
                                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                                >
                                    <Checkbox
                                        checked={selectedIds.has(c.id)}
                                        onCheckedChange={() =>
                                            toggleContract(c.id)
                                        }
                                    />
                                    <span className="font-mono text-sm shrink-0">
                                        {c.contract_number}
                                    </span>
                                    <span
                                        className="flex-1 min-w-0 truncate text-sm"
                                        title={c.tenant_name}
                                    >
                                        {c.tenant_name}
                                    </span>
                                    <span
                                        className="text-xs text-muted-foreground max-w-40 truncate"
                                        title={c.address}
                                    >
                                        {c.address}
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                    {selectedIds.size === 0 && (
                        <p className="text-xs text-destructive shrink-0">
                            Оберіть хоча б один договір
                        </p>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0 shrink-0">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={form.formState.isSubmitting}
                    >
                        Скасувати
                    </Button>
                    <Button
                        type="submit"
                        disabled={
                            form.formState.isSubmitting ||
                            selectedIds.size === 0
                        }
                    >
                        {form.formState.isSubmitting && (
                            <Spinner className="mr-2 h-4 w-4" />
                        )}
                        {isEdit ? "Зберегти" : "Додати"}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
}
