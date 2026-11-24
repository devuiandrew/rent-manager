import {useState, useMemo} from "react";
import {toast} from "sonner";
import {useSWRConfig} from "swr";
import {Plus, Pencil, Trash2, Search, FileText, Settings2} from "lucide-react";
import type {ColumnDef} from "@tanstack/react-table";

import {useContracts} from "@/hooks/use-billing-data";
import {useAuthContext} from "@/context/auth-provider";
import type {Contract} from "@/types/billing";
import {ContractFormDialog} from "@/components/contract-form-dialog";
import {ContractServicesDialog} from "@/components/contract-services-dialog";
import {DataTable} from "@/components/data-table";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Badge} from "@/components/ui/badge";
import {Spinner} from "@/components/ui/spinner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Маленький хелпер: '2024-01-15' → '15.01.2024'
// Якщо передали null/пустий — повертає null (показуємо як '—')
function formatDate(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString("uk-UA");
}

export function ContractsPage() {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const {data: contracts, error, isLoading} = useContracts();

    const [search, setSearch] = useState("");
    const [formOpen, setFormOpen] = useState(false);
    const [editingContract, setEditingContract] = useState<Contract | null>(
        null,
    );
    const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    // Стан діалогу послуг договору
    const [servicesTarget, setServicesTarget] = useState<Contract | null>(null);

    // Колонки для спільного DataTable (сортування + пошук)
    const columns = useMemo<ColumnDef<Contract>[]>(
        () => [
            {
                accessorKey: "id",
                header: "#",
                enableGlobalFilter: false,
                meta: {
                    headClassName: "w-12",
                    cellClassName: "text-muted-foreground font-mono text-xs",
                },
            },
            {
                accessorKey: "contract_number",
                header: "Номер",
                meta: {
                    headClassName: "w-28",
                    cellClassName: "font-mono text-sm",
                },
            },
            {
                // Номер договору відшкодування — пошук по ньому теж працює (enableGlobalFilter за замовч.)
                accessorKey: "reimbursement_number",
                header: "Відшкодування",
                meta: {
                    headClassName: "w-32",
                    cellClassName: "font-mono text-sm",
                },
                cell: ({row}) =>
                    row.original.reimbursement_number || (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                accessorKey: "tenant_name",
                header: "Орендар",
                meta: {cellClassName: "font-medium max-w-55 truncate"},
                // Довге ім'я орендаря обрізаємо трьома крапками, повний текст — у title (hover)
                cell: ({row}) => (
                    <span
                        title={row.original.tenant_name}
                        className="block truncate">
                        {row.original.tenant_name}
                    </span>
                ),
            },
            {
                accessorKey: "address",
                header: "Адреса",
                meta: {cellClassName: "text-sm max-w-65 truncate"},
                cell: ({row}) => (
                    <span
                        title={row.original.address}
                        className="block truncate">
                        {row.original.address}
                    </span>
                ),
            },
            {
                // Decimal рядком → Number() для числового сортування
                id: "area_size",
                accessorFn: (c) => Number(c.area_size),
                header: "Площа, м²",
                enableGlobalFilter: false,
                meta: {
                    align: "right",
                    headClassName: "w-24",
                    cellClassName: "font-mono",
                },
                cell: ({row}) =>
                    Number(row.original.area_size).toLocaleString("uk-UA", {
                        minimumFractionDigits: 2,
                    }),
            },
            {
                // ISO-рядок 'YYYY-MM-DD' сортується лексикографічно як дата — accessorKey ок
                accessorKey: "date_start",
                header: "З",
                enableGlobalFilter: false,
                meta: {headClassName: "w-28", cellClassName: "text-sm"},
                cell: ({row}) => formatDate(row.original.date_start) ?? "—",
            },
            {
                accessorKey: "date_end",
                header: "По",
                enableGlobalFilter: false,
                meta: {headClassName: "w-28", cellClassName: "text-sm"},
                cell: ({row}) =>
                    formatDate(row.original.date_end) ?? (
                        <span className="text-muted-foreground italic">
                            безстроковий
                        </span>
                    ),
            },
            {
                accessorKey: "is_active",
                header: "Статус",
                enableGlobalFilter: false,
                meta: {headClassName: "w-24"},
                cell: ({row}) =>
                    row.original.is_active ? (
                        <Badge
                            variant="default"
                            className="bg-green-100 text-green-700 hover:bg-green-100">
                            Активний
                        </Badge>
                    ) : (
                        <Badge
                            variant="secondary"
                            className="text-muted-foreground">
                            Не активний
                        </Badge>
                    ),
            },
            {
                id: "actions",
                header: "Дії",
                enableSorting: false,
                enableGlobalFilter: false,
                meta: {align: "right", headClassName: "w-32"},
                cell: ({row}) => (
                    <div className="flex items-center justify-end gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => setServicesTarget(row.original)}
                            title="Послуги договору">
                            <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                                setEditingContract(row.original);
                                setFormOpen(true);
                            }}
                            title="Редагувати">
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(row.original)}
                            title="Видалити">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            },
        ],
        [],
    );

    const handleCreate = () => {
        setEditingContract(null);
        setFormOpen(true);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            await apiService.deleteContract(deleteTarget.id);
            toast.success(`Договір ${deleteTarget.contract_number} видалено`);
            await mutate("/contracts");
            setDeleteTarget(null);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Помилка видалення";
            toast.error(msg);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* Шапка */}
            <div className="border-b border-border bg-card px-4 py-3 shrink-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <h1 className="text-lg font-semibold">Договори</h1>
                        {contracts && (
                            <span className="text-sm text-muted-foreground">
                                ({contracts.length})
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <Input
                                placeholder="Пошук по номеру, відшкодуванню, орендарю, адресі..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-80 pl-9 h-9"
                            />
                        </div>
                        <Button onClick={handleCreate} className="h-9">
                            <Plus className="h-4 w-4 mr-2" />
                            Додати
                        </Button>
                    </div>
                </div>
            </div>

            {/* Таблиця */}
            <div className="flex-1 min-h-0 overflow-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40">
                        <Spinner className="h-8 w-8" />
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-40 text-destructive">
                        Помилка завантаження: {String(error)}
                    </div>
                ) : (
                    <DataTable
                        columns={columns}
                        data={contracts ?? []}
                        globalFilter={search}
                        initialSorting={[{id: "contract_number", desc: false}]}
                        emptyMessage={
                            search
                                ? `Нічого не знайдено за запитом "${search}"`
                                : 'Договорів ще немає. Натисніть "Додати" щоб створити перший.'
                        }
                    />
                )}
            </div>

            {/* Створення / редагування */}
            <ContractFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                contract={editingContract}
            />

            {/* Діалог управління послугами договору */}
            <ContractServicesDialog
                open={!!servicesTarget}
                onOpenChange={(open) => !open && setServicesTarget(null)}
                contract={servicesTarget}
            />

            {/* Підтвердження видалення */}
            <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Видалити договір?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Договір{" "}
                            <span className="font-mono font-semibold">
                                {deleteTarget?.contract_number}
                            </span>{" "}
                            ({deleteTarget?.tenant_name}) буде видалений разом з
                            усіма рахунками за ним. Цю дію не можна скасувати.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>
                            Скасувати
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {isDeleting && <Spinner className="mr-2 h-4 w-4" />}
                            Видалити
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
