import {useEffect} from "react";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {toast} from "sonner";
import {useSWRConfig} from "swr";

import {useAuthContext} from "@/context/auth-provider";
import type {Supplier} from "@/types/billing";
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
import {Spinner} from "@/components/ui/spinner";

// Та же схема, что у орендаря — модели зеркальны
const supplierSchema = z.object({
    name: z.string().trim().min(1, "Назва обов'язкова").max(200),
    tax_id: z.string().trim().max(20).optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    email: z
        .string()
        .trim()
        .email("Невірний email")
        .optional()
        .or(z.literal("")),
    contact_person: z.string().trim().max(100).optional().or(z.literal("")),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;

interface SupplierFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    supplier?: Supplier | null; // null/undefined = create mode
}

export function SupplierFormDialog({
    open,
    onOpenChange,
    supplier,
}: SupplierFormDialogProps) {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const isEdit = Boolean(supplier);

    const form = useForm<SupplierFormValues>({
        resolver: zodResolver(supplierSchema),
        defaultValues: {
            name: "",
            tax_id: "",
            phone: "",
            email: "",
            contact_person: "",
        },
    });

    // Заполняем форму при открытии (создание или редактирование)
    useEffect(() => {
        if (open) {
            form.reset({
                name: supplier?.name ?? "",
                tax_id: supplier?.tax_id ?? "",
                phone: supplier?.phone ?? "",
                email: supplier?.email ?? "",
                contact_person: supplier?.contact_person ?? "",
            });
        }
    }, [open, supplier, form]);

    const onSubmit = async (values: SupplierFormValues) => {
        try {
            if (isEdit && supplier) {
                await apiService.updateSupplier(supplier.id, values);
                toast.success(`Постачальника "${values.name}" оновлено`);
            } else {
                await apiService.createSupplier(values);
                toast.success(`Постачальника "${values.name}" додано`);
            }
            // Имя поставщика показывается и в таблице договоров (supplier_name)
            await Promise.all([
                mutate("/suppliers"),
                mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-contracts"),
                ),
            ]);
            onOpenChange(false);
        } catch (e: unknown) {
            toast.error(getApiError(e, "Помилка збереження"));
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit
                            ? "Редагування постачальника"
                            : "Новий постачальник"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? "Зміни буде збережено після підтвердження."
                            : "Заповніть основні дані постачальника послуг."}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Назва *</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder='КП "Водоканал"'
                                            autoFocus
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="tax_id"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>ЄДРПОУ / ІПН</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="12345678"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="contact_person"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel>Контактна особа</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Іваненко І.І."
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
                                name="phone"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Телефон</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="+380..."
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="email"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel>Email</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="email"
                                                placeholder="office@example.com"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
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
