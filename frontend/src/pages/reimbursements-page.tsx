import {useState, useMemo} from "react";
import {toast} from "sonner";
import {useSWRConfig} from "swr";
import {Plus, Pencil, Trash2, Search, FileCheck} from "lucide-react";
import type {ColumnDef} from "@tanstack/react-table";

import {useReimbursements} from "@/hooks/use-billing-data";
import {useAuthContext} from "@/context/auth-provider";
import type {ReimbursementContract} from "@/types/billing";
import {getApiError} from "@/lib/api-error";
import {formatDate, todayIso} from "@/lib/billing-utils";
import {ReimbursementFormDialog} from "@/components/reimbursement-form-dialog";
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

// Статус документа выводится из дат: отдельного флага в модели нет
type DocStatus = "active" | "future" | "past";

function docStatus(doc: ReimbursementContract): DocStatus {
    const today = todayIso();
    if (doc.date_start > today) return "future";
    if (doc.date_end < today) return "past";
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

// Ранг для сортировки колонки статуса: действующие сверху
const STATUS_RANK: Record<DocStatus, number> = {active: 0, future: 1, past: 2};

export function ReimbursementsPage() {
    const {apiService} = useAuthContext();
    const {mutate} = useSWRConfig();
    const {data: reimbursements, error, isLoading} = useReimbursements();

    const [search, setSearch] = useState("");
    const [formOpen, setFormOpen] = useState(false);
    const [editingDoc, setEditingDoc] = useState<ReimbursementContract | null>(
        null,
    );
    const [deleteTarget, setDeleteTarget] =
        useState<ReimbursementContract | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const columns = useMemo<ColumnDef<ReimbursementContract>[]>(
        () => [
            {
                accessorKey: "number",
                header: "Номер",
                meta: {headClassName: "w-32", cellClassName: "font-mono text-sm"},
            },
            {
                // Сортируем по дате начала (ISO-строка сортируется как дата)
                id: "period",
                accessorFn: (r) => r.date_start,
                header: "Період дії",
                enableGlobalFilter: false,
                meta: {headClassName: "w-52", cellClassName: "text-sm"},
                cell: ({row}) =>
                    `${formatDate(row.original.date_start)} — ${formatDate(row.original.date_end)}`,
            },
            {
                id: "status",
                accessorFn: (r) => STATUS_RANK[docStatus(r)],
                header: "Статус",
                enableGlobalFilter: false,
                meta: {headClassName: "w-28"},
                cell: ({row}) => {
                    const s = STATUS_BADGE[docStatus(row.original)];
                    return (
                        <Badge className={`${s.className} font-normal`}>
                            {s.label}
                        </Badge>
                    );
                },
            },
            {
                // accessorFn отдаёт строку из номеров и орендарей —
                // глобальный поиск находит документ по договору/орендарю
                id: "contracts",
                accessorFn: (r) =>
                    r.contracts_info
                        .map((ci) => `${ci.contract_number} ${ci.tenant_name}`)
                        .join(" "),
                header: "Договори оренди",
                enableSorting: false,
                cell: ({row}) => {
                    const info = row.original.contracts_info;
                    if (info.length === 0) {
                        return (
                            <span className="text-muted-foreground">—</span>
                        );
                    }
                    const full = info
                        .map(
                            (ci) => `${ci.contract_number} — ${ci.tenant_name}`,
                        )
                        .join("\n");
                    return (
                        <div className="flex items-center gap-2 min-w-0">
                            <Badge
                                variant="secondary"
                                className="font-mono shrink-0"
                            >
                                {info.length}
                            </Badge>
                            <span
                                className="truncate text-sm max-w-105"
                                title={full}
                            >
                                {info
                                    .map((ci) => ci.contract_number)
                                    .join(", ")}
                            </span>
                        </div>
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
                            title={row.original.note}
                        >
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
                                setEditingDoc(row.original);
                                setFormOpen(true);
                            }}
                            title="Редагувати"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(row.original)}
                            title="Видалити"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ),
            },
        ],
        [],
    );

    const handleCreate = () => {
        setEditingDoc(null);
        setFormOpen(true);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            await apiService.deleteReimbursement(deleteTarget.id);
            toast.success(`Відшкодування «${deleteTarget.number}» видалено`);
            // Обновляем и договоры: их вычисляемый номер відшкодування изменился
            await Promise.all([
                mutate("/reimbursement-contracts"),
                mutate("/contracts"),
            ]);
            setDeleteTarget(null);
        } catch (e: unknown) {
            toast.error(getApiError(e, "Помилка видалення"));
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {/* Toolbar */}
            <div className="border-b border-border bg-card px-4 py-3 shrink-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <FileCheck className="h-5 w-5 text-muted-foreground" />
                        <h1 className="text-lg font-semibold">
                            Договори відшкодування
                        </h1>
                        {reimbursements && (
                            <span className="text-sm text-muted-foreground">
                                ({reimbursements.length})
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                            <Input
                                placeholder="Пошук за номером, договором, орендарем..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-72 pl-9 h-9"
                            />
                        </div>
                        <Button onClick={handleCreate} className="h-9">
                            <Plus className="h-4 w-4 mr-2" />
                            Додати
                        </Button>
                    </div>
                </div>
            </div>

            {/* Table */}
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
                        data={reimbursements ?? []}
                        globalFilter={search}
                        initialSorting={[{id: "period", desc: true}]}
                        emptyMessage={
                            search
                                ? `Нічого не знайдено за запитом "${search}"`
                                : 'Договорів відшкодування ще немає. Натисніть "Додати" щоб створити перший.'
                        }
                    />
                )}
            </div>

            {/* Create/Edit dialog */}
            <ReimbursementFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                reimbursement={editingDoc}
            />

            {/* Delete confirmation */}
            <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => !open && setDeleteTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Видалити договір відшкодування?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Документ{" "}
                            <span className="font-semibold">
                                «{deleteTarget?.number}»
                            </span>{" "}
                            буде видалено. Договори оренди та рахунки не
                            зачіпаються — зникне лише групування за цим
                            відшкодуванням. Цю дію не можна скасувати.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>
                            Скасувати
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting && <Spinner className="mr-2 h-4 w-4" />}
                            Видалити
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
