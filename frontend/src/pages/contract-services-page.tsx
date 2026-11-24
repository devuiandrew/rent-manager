import { useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { Plus, Trash2, Search, Tags } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'

import { useContractServices, useContracts } from '@/hooks/use-billing-data'
import { useAuthContext } from '@/context/auth-provider'
import type { ContractService, Contract } from '@/types/billing'
import { getApiError } from '@/lib/api-error'
import { ContractServiceFormDialog } from '@/components/contract-service-form-dialog'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Хелпер: будує Map<id, item> для швидкого пошуку імен
// Дані договору (номер/орендар) не приходять у ContractService — дістаємо їх звідси
function indexById<T extends { id: number }>(items: T[] | undefined): Map<number, T> {
  return new Map((items ?? []).map(item => [item.id, item]))
}

export function ContractServicesPage() {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()

  // Тарифи + договори (для назви договору/орендаря). Дані послуги вже є в самому
  // ContractService (service_name/unit/color), тому окремий запит послуг не потрібен
  const { data: contractServices, error, isLoading } = useContractServices()
  const { data: contracts } = useContracts()

  // Індекс для O(1) пошуку договору (інакше для кожного рядка робили б .find())
  const contractMap = useMemo(() => indexById<Contract>(contracts), [contracts])

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ContractService | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Перемикач активності зв'язку (клік по бейджу статусу).
  // useCallback — щоб посилання було стабільним для useMemo колонок
  const handleToggleActive = useCallback(async (cs: ContractService) => {
    try {
      await apiService.updateContractService(cs.id, { is_active: !cs.is_active })
      await mutate('/contract-services')
    } catch (e) {
      toast.error(getApiError(e, 'Помилка оновлення статусу'))
    }
  }, [apiService, mutate])

  // Колонки для спільного DataTable (сортування + пошук).
  // Залежить від contractMap — назву/орендаря беремо звідти
  const columns = useMemo<ColumnDef<ContractService>[]>(() => [
    {
      accessorKey: 'id',
      header: '#',
      enableGlobalFilter: false,
      meta: { headClassName: 'w-12', cellClassName: 'text-muted-foreground font-mono text-xs' },
    },
    {
      // Номер договору — для сортування/пошуку дістаємо рядок із contractMap
      id: 'contract_number',
      accessorFn: (cs) => contractMap.get(cs.contract_id)?.contract_number ?? '',
      header: 'Договір',
      meta: { headClassName: 'w-32', cellClassName: 'font-mono text-sm' },
      cell: ({ row }) => {
        const contract = contractMap.get(row.original.contract_id)
        return contract?.contract_number ?? <span className="text-muted-foreground">—</span>
      },
    },
    {
      // Номер договору відшкодування (з contractMap) — щоб шукати і по ньому
      id: 'reimbursement_number',
      accessorFn: (cs) => contractMap.get(cs.contract_id)?.reimbursement_number ?? '',
      header: 'Відшкодування',
      meta: { headClassName: 'w-32', cellClassName: 'font-mono text-sm' },
      cell: ({ row }) => {
        const num = contractMap.get(row.original.contract_id)?.reimbursement_number
        return num || <span className="text-muted-foreground">—</span>
      },
    },
    {
      id: 'tenant_name',
      accessorFn: (cs) => contractMap.get(cs.contract_id)?.tenant_name ?? '',
      header: 'Орендар',
      meta: { cellClassName: 'text-sm' },
      cell: ({ row }) => contractMap.get(row.original.contract_id)?.tenant_name ?? '—',
    },
    {
      // Сортуємо/шукаємо за назвою послуги; у комірці — колір + назва + одиниця
      accessorKey: 'service_name',
      header: 'Послуга',
      cell: ({ row }) => {
        const cs = row.original
        return (
          <span className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: cs.service_color || '#94a3b8' }}
            />
            <span>{cs.service_name}</span>
            <span className="text-xs text-muted-foreground">({cs.service_unit_name})</span>
          </span>
        )
      },
    },
    {
      // Decimal рядком → Number() для числового сортування
      id: 'effective_rate',
      accessorFn: (cs) => Number(cs.effective_rate),
      header: 'Тариф',
      enableGlobalFilter: false,
      meta: { align: 'right', headClassName: 'w-32', cellClassName: 'font-mono' },
      cell: ({ row }) =>
        Number(row.original.effective_rate).toLocaleString('uk-UA', { minimumFractionDigits: 2 }),
    },
    {
      // Клік по бейджу перемикає активність зв'язку
      accessorKey: 'is_active',
      header: 'Статус',
      enableGlobalFilter: false,
      meta: { headClassName: 'w-24' },
      cell: ({ row }) => (
        <button onClick={() => handleToggleActive(row.original)} title="Натисніть щоб змінити">
          {row.original.is_active ? (
            <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer">
              Активний
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground cursor-pointer hover:bg-muted">
              Не активний
            </Badge>
          )}
        </button>
      ),
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
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(row.original)}
            title="Видалити"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ], [contractMap, handleToggleActive])

  const handleCreate = () => {
    setFormOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await apiService.deleteContractService(deleteTarget.id)
      toast.success('Тариф видалено')
      await mutate('/contract-services')
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
      {/* Шапка */}
      <div className="border-b border-border bg-card px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Тарифи договорів</h1>
            {contractServices && (
              <span className="text-sm text-muted-foreground">({contractServices.length})</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Пошук по договору, відшкодуванню, орендарю, послузі..."
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
            data={contractServices ?? []}
            globalFilter={search}
            initialSorting={[{ id: 'contract_number', desc: false }]}
            emptyMessage={search
              ? `Нічого не знайдено за запитом "${search}"`
              : 'Тарифів ще немає. Спочатку додайте Орендарів, Договори і Послуги, потім зв\'яжіть їх тут.'}
          />
        )}
      </div>

      {/* Масове додавання тарифів */}
      <ContractServiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      {/* Підтвердження видалення */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити тариф?</AlertDialogTitle>
            <AlertDialogDescription>
              Зв'язок договору з послугою буде видалено. Існуючі рахунки за цією
              комбінацією залишаться (вони зберігають свою копію тарифу), але нові
              рахунки створити не можна буде поки не додасте тариф знову.
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
