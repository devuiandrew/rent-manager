import {useState, useMemo} from "react";
import {toast} from "sonner";
import {useSWRConfig} from "swr";
import {Plus, Pencil, Trash2, Search, Truck} from "lucide-react";
import type {ColumnDef} from "@tanstack/react-table";

import {useSuppliers, useSupplierContracts} from "@/hooks/use-billing-data";
import {useAuthContext} from "@/context/auth-provider";
import type {Supplier, SupplierContract} from "@/types/billing";
import {getApiError} from "@/lib/api-error";
import {formatDate, todayIso} from "@/lib/billing-utils";
import {SupplierFormDialog} from "@/components/supplier-form-dialog";
import {SupplierContractFormDialog} from "@/components/supplier-contract-form-dialog";
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

// Статус договора выводится из дат; date_end = null → бессрочный (не бывает «минулим»)
type DocStatus = "active" | "future" | "past";

function contractStatus(doc: SupplierContract): DocStatus {
    const today = todayIso();
    if (doc.date_start > today) return "future";
    if (doc.date_end && doc.date_end < today) return "past";
    return "active";
}

const STATUS_BADGE: Record<DocStatus, {label: string; className: string}> = {
    active: {
        label: "Діючий",
        className: "bg-green-100 text-green-700 hover:bg-green-100",
    },
    future: {
        label: "Майбутній",
        className: "bg-blue-100 text-blue-700 hover:bg-blue-100",
    },
    past: {
        label: "Минулий",
        className: "bg-muted text-muted-foreground hover:bg-muted",
    },
};

const STATUS_RANK: Record<DocStatus, number> = {active: 0, future: 1, past: 2};

export function SuppliersPage() {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const {
        data: suppliers,
        error: suppliersError,
        isLoading: suppliersLoading,
    } = useSuppliers();
    const {
        data: contracts,
        error: contractsError,
        isLoading: contractsLoading,
    } = useSupplierContracts();

    const [search, setSearch] = useState("");
    // Диалоги организаций
    const [supplierFormOpen, setSupplierFormOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(
        null,
    );
    const [deleteSupplierTarget, setDeleteSupplierTarget] =
        useState<Supplier | null>(null);
    // Диалоги договоров
    const [contractFormOpen, setContractFormOpen] = useState(false);
    const [editingContract, setEditingContract] =
        useState<SupplierContract | null>(null);
    const [deleteContractTarget, setDeleteContractTarget] =
        useState<SupplierContract | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const supplierColumns = useMemo<ColumnDef<Supplier>[]>(
        () => [
            {
                accessorKey: "name",
                header: "Назва",
                meta: {cellClassName: "font-medium"},
                cell: ({row}) => (
                    <span
                        className="block truncate max-w-80"
                        title={row.original.name}>
                        {row.original.name}
                    </span>
                ),
            },
            {
                accessorKey: "tax_id",
                header: "ЄДРПОУ/ІПН",
                meta: {
                    headClassName: "w-32",
                    cellClassName: "font-mono text-sm",
                },
                cell: ({row}) =>
                    row.original.tax_id || (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                accessorKey: "contact_person",
                header: "Контактна особа",
                meta: {headClassName: "w-44", cellClassName: "text-sm"},
                cell: ({row}) =>
                    row.original.contact_person || (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                accessorKey: "phone",
                header: "Телефон",
                enableSorting: false,
                meta: {headClassName: "w-36", cellClassName: "text-sm"},
                cell: ({row}) =>
                    row.original.phone || (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                accessorKey: "email",
                header: "Email",
                enableSorting: false,
                meta: {headClassName: "w-48", cellClassName: "text-sm"},
                cell: ({row}) =>
                    row.original.email || (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                id: "actions",
                header: "Дії",
                enableSorting: false,
                enableGlobalFilter: false,
                meta: {align: "right", headClassName: "w-20"},
                cell: ({row}) => (
                    <div className="flex items-center justify-end gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                                setEditingSupplier(row.original);
                                setSupplierFormOpen(true);
                            }}
                            title="Редагувати">
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteSupplierTarget(row.original)}
                            title="Видалити">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            },
        ],
        [],
    );

    const contractColumns = useMemo<ColumnDef<SupplierContract>[]>(
        () => [
            {
                accessorKey: "number",
                header: "Номер",
                meta: {headClassName: "w-28", cellClassName: "font-mono text-sm"},
            },
            {
                accessorKey: "supplier_name",
                header: "Постачальник",
                meta: {cellClassName: "text-sm font-medium"},
                cell: ({row}) => (
                    <span
                        className="block truncate max-w-64"
                        title={row.original.supplier_name}>
                        {row.original.supplier_name}
                    </span>
                ),
            },
            {
                accessorKey: "service_name",
                header: "Послуга",
                meta: {headClassName: "w-44", cellClassName: "text-sm"},
            },
            {
                // ISO-строка сортируется как дата
                id: "period",
                accessorFn: (r) => r.date_start,
                header: "Період дії",
                enableGlobalFilter: false,
                meta: {headClassName: "w-52", cellClassName: "text-sm"},
                cell: ({row}) => {
                    const {date_start, date_end} = row.original;
                    return `${formatDate(date_start)} — ${date_end ? formatDate(date_end) : "безстроково"}`;
                },
            },
            {
                id: "status",
                accessorFn: (r) => STATUS_RANK[contractStatus(r)],
                header: "Статус",
                enableGlobalFilter: false,
                meta: {headClassName: "w-28"},
                cell: ({row}) => {
                    const s = STATUS_BADGE[contractStatus(row.original)];
                    return (
                        <Badge className={`${s.className} font-normal`}>
                            {s.label}
                        </Badge>
                    );
                },
            },
            {
                accessorKey: "note",
                header: "Примітка",
                enableSorting: false,
                meta: {
                    cellClassName: "text-sm text-muted-foreground max-w-50",
                },
                cell: ({row}) =>
                    row.original.note ? (
                        <span
                            className="block truncate"
                            title={row.original.note}>
                            {row.original.note}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                id: "actions",
                header: "Дії",
                enableSorting: false,
                enableGlobalFilter: false,
                meta: {align: "right", headClassName: "w-20"},
                cell: ({row}) => (
                    <div className="flex items-center justify-end gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                                setEditingContract(row.original);
                                setContractFormOpen(true);
                            }}
                            title="Редагувати">
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteContractTarget(row.original)}
                            title="Видалити">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            },
        ],
        [],
    );

    const handleDeleteSupplier = async () => {
        if (!deleteSupplierTarget) return;
        setIsDeleting(true);
        try {
            await apiService.deleteSupplier(deleteSupplierTarget.id);
            toast.success(
                `Постачальника «${deleteSupplierTarget.name}» видалено`,
            );
            // Каскад: удалились и договоры, и месячные записи поставщика
            await Promise.all([
                mutate("/suppliers"),
                mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-contracts"),
                ),
                mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-bills"),
                ),
            ]);
            setDeleteSupplierTarget(null);
        } catch (e: unknown) {
            toast.error(getApiError(e, "Помилка видалення"));
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteContract = async () => {
        if (!deleteContractTarget) return;
        setIsDeleting(true);
        try {
            await apiService.deleteSupplierContract(deleteContractTarget.id);
            toast.success(
                `Договір «${deleteContractTarget.number}» видалено`,
            );
            await Promise.all([
                mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-contracts"),
                ),
                mutate(
                    (key) =>
                        typeof key === "string" &&
                        key.startsWith("/supplier-bills"),
                ),
            ]);
            setDeleteContractTarget(null);
        } catch (e: unknown) {
            toast.error(getApiError(e, "Помилка видалення"));
        } finally {
            setIsDeleting(false);
        }
    };

    const isLoading = suppliersLoading || contractsLoading;
    const error = suppliersError || contractsError;

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* Toolbar */}
            <div className="border-b border-border bg-card px-4 py-3 shrink-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <Truck className="h-5 w-5 text-muted-foreground" />
                        <h1 className="text-lg font-semibold">Постачальники</h1>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            placeholder="Пошук за назвою, номером, послугою..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-72 pl-9 h-9"
                        />
                    </div>
                </div>
            </div>

            {/* Две секции: организации + договоры */}
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
                    <div className="space-y-6 p-4">
                        <section>
                            <div className="flex items-center justify-between mb-2">
                                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                                    Організації
                                    {suppliers && (
                                        <span className="ml-2 font-normal normal-case">
                                            ({suppliers.length})
                                        </span>
                                    )}
                                </h2>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        setEditingSupplier(null);
                                        setSupplierFormOpen(true);
                                    }}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Додати
                                </Button>
                            </div>
                            <div className="border border-border rounded-md bg-card">
                                <DataTable
                                    columns={supplierColumns}
                                    data={suppliers ?? []}
                                    globalFilter={search}
                                    initialSorting={[{id: "name", desc: false}]}
                                    emptyMessage={
                                        search
                                            ? `Нічого не знайдено за запитом "${search}"`
                                            : 'Постачальників ще немає. Натисніть "Додати" щоб створити першого.'
                                    }
                                />
                            </div>
                        </section>

                        <section>
                            <div className="flex items-center justify-between mb-2">
                                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                                    Договори постачальників
                                    {contracts && (
                                        <span className="ml-2 font-normal normal-case">
                                            ({contracts.length})
                                        </span>
                                    )}
                                </h2>
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        setEditingContract(null);
                                        setContractFormOpen(true);
                                    }}
                                    disabled={!suppliers?.length}
                                    title={
                                        suppliers?.length
                                            ? undefined
                                            : "Спочатку додайте постачальника"
                                    }>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Додати
                                </Button>
                            </div>
                            <div className="border border-border rounded-md bg-card">
                                <DataTable
                                    columns={contractColumns}
                                    data={contracts ?? []}
                                    globalFilter={search}
                                    initialSorting={[{id: "period", desc: true}]}
                                    emptyMessage={
                                        search
                                            ? `Нічого не знайдено за запитом "${search}"`
                                            : "Договорів ще немає. Договір прив'язує постачальника до послуги на період дат."
                                    }
                                />
                            </div>
                        </section>
                    </div>
                )}
            </div>

            {/* Диалоги создания/редактирования */}
            <SupplierFormDialog
                open={supplierFormOpen}
                onOpenChange={setSupplierFormOpen}
                supplier={editingSupplier}
            />
            <SupplierContractFormDialog
                open={contractFormOpen}
                onOpenChange={setContractFormOpen}
                contract={editingContract}
            />

            {/* Подтверждение удаления организации */}
            <AlertDialog
                open={!!deleteSupplierTarget}
                onOpenChange={(open) => !open && setDeleteSupplierTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Видалити постачальника?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Постачальника{" "}
                            <span className="font-semibold">
                                «{deleteSupplierTarget?.name}»
                            </span>{" "}
                            буде видалено разом з усіма його договорами та
                            місячними записами в «Рахунках». Цю дію не можна
                            скасувати.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>
                            Скасувати
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteSupplier}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {isDeleting && <Spinner className="mr-2 h-4 w-4" />}
                            Видалити
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Подтверждение удаления договора */}
            <AlertDialog
                open={!!deleteContractTarget}
                onOpenChange={(open) => !open && setDeleteContractTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Видалити договір постачальника?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Договір{" "}
                            <span className="font-semibold">
                                «{deleteContractTarget?.number}»
                            </span>{" "}
                            ({deleteContractTarget?.supplier_name}) буде
                            видалено разом з усіма місячними записами за ним.
                            Цю дію не можна скасувати.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>
                            Скасувати
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteContract}
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
