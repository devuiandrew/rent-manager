import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { Plus, Pencil, Trash2, Search, Wrench, History } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'

import { useServices } from '@/hooks/use-billing-data'
import { useAuthContext } from '@/context/auth-provider'
import { formatDate } from '@/lib/billing-utils'
import type { Service } from '@/types/billing'
import { ServiceFormDialog } from '@/components/service-form-dialog'
import { ServiceRateHistoryDialog } from '@/components/service-rate-history-dialog'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function ServicesPage() {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()
  const { data: services, error, isLoading } = useServices()

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Service | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Колонки для спільного DataTable (сортування + пошук)
  const columns = useMemo<ColumnDef<Service>[]>(() => [
    {
      accessorKey: 'id',
      header: '#',
      enableGlobalFilter: false,
      meta: { headClassName: 'w-12', cellClassName: 'text-muted-foreground font-mono text-xs' },
    },
    {
      id: 'color',
      header: 'Колір',
      enableSorting: false,
      enableGlobalFilter: false,
      meta: { headClassName: 'w-16' },
      cell: ({ row }) => (
        <div
          className="w-5 h-5 rounded-full border border-border"
          style={{ backgroundColor: row.original.color || '#94a3b8' }}
          title={row.original.color}
        />
      ),
    },
    {
      accessorKey: 'name',
      header: 'Назва',
      meta: { cellClassName: 'font-medium' },
    },
    {
      accessorKey: 'unit_name',
      header: 'Одиниця',
      meta: { headClassName: 'w-32', cellClassName: 'text-muted-foreground' },
    },
    {
      // Актуальний тариф (з історії, на сьогодні). Decimal рядком → Number() для сортування
      id: 'current_rate',
      accessorFn: (s) => Number(s.current_rate),
      header: 'Тариф',
      enableGlobalFilter: false,
      meta: { align: 'right', headClassName: 'w-56', cellClassName: 'font-mono' },
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className="flex items-center justify-end gap-2">
            {/* Бейдж майбутньої зміни тарифу — щоб бачити заплановане подорожчання */}
            {s.upcoming_change && (
              <Badge
                className="bg-amber-100 text-amber-700 hover:bg-amber-100 font-normal text-xs"
                title="Запланована зміна тарифу"
              >
                ↑ з {formatDate(s.upcoming_change.effective_from)}:{' '}
                {Number(s.upcoming_change.rate).toLocaleString('uk-UA', { minimumFractionDigits: 2 })}
              </Badge>
            )}
            <span>{Number(s.current_rate).toLocaleString('uk-UA', { minimumFractionDigits: 2 })}</span>
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: 'Дії',
      enableSorting: false,
      enableGlobalFilter: false,
      meta: { align: 'right', headClassName: 'w-24' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setHistoryTarget(row.original)}
            title="Історія тарифів"
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { setEditingService(row.original); setFormOpen(true) }}
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
  ], [])

  const handleCreate = () => {
    setEditingService(null)
    setFormOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await apiService.deleteService(deleteTarget.id)
      toast.success(`Послугу "${deleteTarget.name}" видалено`)
      await mutate('/services')
      setDeleteTarget(null)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Помилка видалення'
      toast.error(msg)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Toolbar */}
      <div className="border-b border-border bg-card px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Послуги</h1>
            {services && (
              <span className="text-sm text-muted-foreground">({services.length})</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Пошук..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 pl-9 h-9"
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
            data={services ?? []}
            globalFilter={search}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyMessage={search
              ? `Нічого не знайдено за запитом "${search}"`
              : 'Послуг ще немає. Натисніть "Додати" щоб створити першу.'}
          />
        )}
      </div>

      {/* Create/Edit dialog */}
      <ServiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        service={editingService}
      />

      {/* Історія тарифів послуги */}
      <ServiceRateHistoryDialog
        open={!!historyTarget}
        onOpenChange={(o) => !o && setHistoryTarget(null)}
        service={historyTarget}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити послугу?</AlertDialogTitle>
            <AlertDialogDescription>
              Послугу <span className="font-semibold">{deleteTarget?.name}</span> буде видалено
              разом з усіма пов'язаними тарифами на договорах. Рахунки за цю послугу можуть стати
              недоступними. Цю дію не можна скасувати.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Скасувати</AlertDialogCancel>
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
  )
}
