import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { Plus, Pencil, Trash2, Search, Users } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'

// SWR-хук — автоматично робить GET /api/tenants/ і кешує результат
import { useTenants } from '@/hooks/use-billing-data'
// Доступ до apiService — об'єкт з усіма методами API (createTenant, deleteTenant, ...)
import { useAuthContext } from '@/context/auth-provider'
import type { Tenant } from '@/types/billing'
// Окремий компонент модального вікна з формою (вже написаний)
import { TenantFormDialog } from '@/components/tenant-form-dialog'
// Спільна таблиця: сортування по заголовку + global filter (пошук)
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function TenantsPage() {
  const { apiService } = useAuthContext()
  // mutate('/tenants') — скаже SWR перезавантажити список після створення/видалення
  const { mutate } = useSWRConfig()

  // Завантаження списку. data = масив, error = помилка, isLoading = поки чекаємо відповідь
  const { data: tenants, error, isLoading } = useTenants()

  // ─── Стани компонента ─────────────────────────────────────────
  // Текст у полі пошуку
  const [search, setSearch] = useState('')
  // Чи відкритий діалог форми (true = видимий)
  const [formOpen, setFormOpen] = useState(false)
  // Який орендар редагуємо. null = режим створення нового
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  // Який орендар на черзі на видалення. null = діалог підтвердження прихований
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null)
  // Прапорець "зараз відбувається запит на видалення" — щоб заблокувати кнопку
  const [isDeleting, setIsDeleting] = useState(false)

  // ─── Колонки таблиці ──────────────────────────────────────────
  // accessorKey → значення для сортування/пошуку; cell → як показати.
  // meta.align/headClassName/cellClassName читає спільний DataTable.
  // useMemo з [] — у клітинках лише стабільні set-функції стану, тож деп не треба
  const columns = useMemo<ColumnDef<Tenant>[]>(() => [
    {
      accessorKey: 'id',
      header: '#',
      enableGlobalFilter: false,
      meta: { headClassName: 'w-12', cellClassName: 'text-muted-foreground font-mono text-xs' },
    },
    {
      accessorKey: 'name',
      header: 'Назва',
      meta: { cellClassName: 'font-medium' },
    },
    {
      accessorKey: 'tax_id',
      header: 'ЄДРПОУ / ІПН',
      cell: ({ row }) => row.original.tax_id || '—',
      meta: { headClassName: 'w-32', cellClassName: 'font-mono text-sm' },
    },
    {
      accessorKey: 'contact_person',
      header: 'Контактна особа',
      cell: ({ row }) => row.original.contact_person || '—',
      meta: { headClassName: 'w-40' },
    },
    {
      accessorKey: 'phone',
      header: 'Телефон',
      cell: ({ row }) => row.original.phone || '—',
      meta: { headClassName: 'w-36', cellClassName: 'font-mono text-sm' },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => row.original.email || '—',
      meta: { headClassName: 'w-48', cellClassName: 'text-sm' },
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
            onClick={() => { setEditingTenant(row.original); setFormOpen(true) }}
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

  // ─── Обробники подій ──────────────────────────────────────────
  const handleCreate = () => {
    setEditingTenant(null)  // null = новий орендар
    setFormOpen(true)        // показати діалог
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      // DELETE /api/tenants/{id}/
      await apiService.deleteTenant(deleteTarget.id)
      toast.success(`Орендаря "${deleteTarget.name}" видалено`)
      // Просимо SWR перезавантажити список — таблиця оновиться сама
      await mutate('/tenants')
      setDeleteTarget(null) // ховаємо діалог підтвердження
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Помилка видалення'
      toast.error(msg)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ─── 1. Шапка (toolbar) ─── */}
      <div className="border-b border-border bg-card px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Орендарі</h1>
            {tenants && (
              <span className="text-sm text-muted-foreground">({tenants.length})</span>
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

      {/* ─── 2. Таблиця ─── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          // Поки чекаємо відповідь від сервера — крутимо спіннер
          <div className="flex items-center justify-center h-40">
            <Spinner className="h-8 w-8" />
          </div>
        ) : error ? (
          // Якщо запит провалився
          <div className="flex items-center justify-center h-40 text-destructive">
            Помилка завантаження: {String(error)}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={tenants ?? []}
            globalFilter={search}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyMessage={search
              ? `Нічого не знайдено за запитом "${search}"`
              : 'Орендарів ще немає. Натисніть "Додати" щоб створити першого.'}
          />
        )}
      </div>

      {/* ─── 3. Діалог створення/редагування ─── */}
      {/* Сам компонент відповідає за форму, валідацію і запит на сервер */}
      <TenantFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        tenant={editingTenant}
      />

      {/* ─── 4. Підтвердження видалення ─── */}
      {/* AlertDialog показується коли deleteTarget не null */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити орендаря?</AlertDialogTitle>
            <AlertDialogDescription>
              Орендар <span className="font-semibold">{deleteTarget?.name}</span> буде видалений
              разом з усіма його договорами та рахунками. Цю дію не можна скасувати.
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
