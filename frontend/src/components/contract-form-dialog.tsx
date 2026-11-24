import {useEffect} from "react";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {toast} from "sonner";
import {useSWRConfig} from "swr";

import {useAuthContext} from "@/context/auth-provider";
import {useTenants} from "@/hooks/use-billing-data";
import type {Contract} from "@/types/billing";
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
import {SearchableSelect} from "@/components/ui/searchable-select";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Spinner} from "@/components/ui/spinner";

// Zod-схема: правила валідації для кожного поля
// .trim() — обріже пробіли по краях
// .regex(...) — перевіряє що рядок підходить під шаблон (тут: число з опц. дробовою частиною)
const contractSchema = z.object({
    tenant_id: z.string().min(1, "Виберіть орендаря"),
    contract_number: z.string().trim().min(1, "Номер обов'язковий").max(50),
    address: z.string().trim().min(1, "Адреса обов'язкова").max(300),
    area_size: z
        .string()
        .trim()
        .min(1, "Площа обов'язкова")
        .regex(/^\d+([.,]\d{1,2})?$/, "Невірний формат (приклад: 27.44)"),
    date_start: z.string().min(1, "Дата початку обов'язкова"),
    date_end: z.string().optional().or(z.literal("")),
    is_active: z.boolean(),
});

// TypeScript-тип витягується автоматично зі схеми — не треба дублювати
type ContractFormValues = z.infer<typeof contractSchema>;

interface ContractFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contract?: Contract | null;
}

export function ContractFormDialog({
    open,
    onOpenChange,
    contract,
}: ContractFormDialogProps) {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const isEdit = Boolean(contract);

    // Підвантажуємо список орендарів — для випадаючого списку
    // SWR кешує — якщо ми вже завантажували на сторінці Орендарі, нового запиту не буде
    const {data: tenants, isLoading: tenantsLoading} = useTenants();

    const form = useForm<ContractFormValues>({
        resolver: zodResolver(contractSchema),
        defaultValues: {
            tenant_id: "",
            contract_number: "",
            address: "",
            area_size: "",
            date_start: "",
            date_end: "",
            is_active: true,
        },
    });

    // Заповнюємо форму коли вона відкривається (новий або існуючий)
    useEffect(() => {
        if (open) {
            form.reset({
                tenant_id: contract ? String(contract.tenant_id) : "",
                contract_number: contract?.contract_number ?? "",
                address: contract?.address ?? "",
                area_size: contract?.area_size ?? "",
                date_start: contract?.date_start ?? "",
                date_end: contract?.date_end ?? "",
                is_active: contract?.is_active ?? true,
            });
        }
    }, [open, contract, form]);

    const onSubmit = async (values: ContractFormValues) => {
        // Перетворюємо поля у формат, який чекає бекенд:
        // - tenant_id з рядка в число
        // - area_size: кома → крапка (бекенд приймає тільки крапку як роздільник)
        // - date_end: порожній рядок → null (бекенд так зрозуміє "немає кінцевої дати")
        const payload = {
            tenant_id: parseInt(values.tenant_id, 10),
            contract_number: values.contract_number,
            address: values.address,
            area_size: values.area_size.replace(",", "."),
            date_start: values.date_start,
            date_end: values.date_end || null,
            is_active: values.is_active,
        };

        try {
            if (isEdit && contract) {
                await apiService.updateContract(contract.id, payload);
                toast.success(`Договір ${values.contract_number} оновлено`);
            } else {
                await apiService.createContract(payload);
                toast.success(`Договір ${values.contract_number} додано`);
            }
            // Просимо SWR перезавантажити список договорів (на сторінці Договори)
            await mutate("/contracts");
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Помилка збереження";
            toast.error(msg);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? "Редагування договору" : "Новий договір"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Зміни буде збережено після підтвердження."
                            : "Заповніть дані договору оренди."}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4">
                        {/* Випадаючий список орендарів */}
                        <FormField
                            control={form.control}
                            name="tenant_id"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Орендар *</FormLabel>
                                    <FormControl className="overflow-hidden">
                                        <SearchableSelect
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            disabled={tenantsLoading}
                                            placeholder={
                                                tenantsLoading
                                                    ? "Завантаження..."
                                                    : "Виберіть орендаря"
                                            }
                                            searchPlaceholder="Пошук орендаря..."
                                            emptyText="Орендаря не знайдено"
                                            options={
                                                tenants?.map((t) => ({
                                                    value: String(t.id),
                                                    label: t.name,
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
                                name="contract_number"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Номер договору *</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="№123/24"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="area_size"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Площа, м² *</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="27.44"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="address"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Адреса *</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="вул. Центральна, 1"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

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
                                        <FormLabel>Дата закінчення</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="date"
                                                placeholder="безстроковий"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="is_active"
                            render={({field}) => (
                                <FormItem className="flex items-center gap-2 space-y-0">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                    <FormLabel className="font-normal cursor-pointer">
                                        Договір активний
                                    </FormLabel>
                                </FormItem>
                            )}
                        />

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
