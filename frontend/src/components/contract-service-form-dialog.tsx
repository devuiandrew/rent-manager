import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'

import { useAuthContext } from '@/context/auth-provider'
import { useContracts, useServices, useContractServices } from '@/hooks/use-billing-data'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'

interface ContractServiceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Діалог масового підключення послуг до договору.
// Персональний тариф прибрано: для орендаря діє тариф за замовчуванням з послуги
// (змінюється для всіх через історію тарифів). Поле personal_rate лишилось у БД
// під майбутніх постачальників, але тут не редагується.
export function ContractServiceFormDialog({
  open, onOpenChange,
}: ContractServiceFormDialogProps) {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()

  const { data: contracts, isLoading: contractsLoading } = useContracts()
  const { data: services, isLoading: servicesLoading } = useServices()

  const [contractId, setContractId] = useState('')
  // Набір id обраних послуг (Set — швидке toggle/has)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Послуги, вже підключені до обраного договору — щоб не пропонувати дублі
  const { data: existing } = useContractServices(
    contractId ? { contract_id: Number(contractId) } : undefined,
  )

  // Скидання стану при кожному відкритті
  useEffect(() => {
    if (open) {
      setContractId('')
      setSelectedIds(new Set())
    }
  }, [open])

  // При зміні договору — скидаємо вибір (інший набір вже підключених)
  useEffect(() => {
    setSelectedIds(new Set())
  }, [contractId])

  const linkedIds = useMemo(
    () => new Set((existing ?? []).map(cs => cs.service_id)),
    [existing],
  )
  // Доступні = всі послуги мінус вже підключені до цього договору
  const availableServices = useMemo(
    () => (services ?? []).filter(s => !linkedIds.has(s.id)),
    [services, linkedIds],
  )

  const allSelected = availableServices.length > 0
    && availableServices.every(s => selectedIds.has(s.id))

  const toggleService = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // "Додати всі послуги" — вибір/зняття всіх доступних
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(availableServices.map(s => s.id)))
  }

  const handleSubmit = async () => {
    if (!contractId || selectedIds.size === 0) return
    setIsSubmitting(true)
    let added = 0
    let failed = 0
    // Створюємо зв'язки паралельно. personal_rate=null → тариф за замовчуванням з послуги
    await Promise.all(
      [...selectedIds].map(async serviceId => {
        try {
          await apiService.createContractService({
            contract_id: Number(contractId),
            service_id: serviceId,
            personal_rate: null,
            is_active: true,
          })
          added++
        } catch {
          failed++
        }
      }),
    )
    // Оновлюємо і загальний список, і список конкретного договору
    await mutate('/contract-services')
    await mutate(`/contract-services?contract_id=${contractId}`)
    setIsSubmitting(false)

    if (added > 0) {
      toast.success(`Додано послуг: ${added}${failed ? `, пропущено: ${failed}` : ''}`)
      onOpenChange(false)
    } else {
      toast.error('Не вдалося додати послуги')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Додати тарифи</DialogTitle>
          <DialogDescription>
            Виберіть договір і послуги, які треба підключити. Діятиме тариф за
            замовчуванням з кожної послуги.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Договір */}
          <div className="space-y-1.5 shrink-0">
            <p className="text-sm font-medium">Договір *</p>
            <SearchableSelect
              value={contractId}
              onValueChange={setContractId}
              disabled={contractsLoading}
              placeholder={contractsLoading ? 'Завантаження...' : 'Виберіть договір'}
              searchPlaceholder="Пошук за відшкодуванням, договором або орендарем..."
              emptyText="Договір не знайдено"
              options={contracts?.map(c => ({
                value: String(c.id),
                // Порядок відображення: договір відшкодування → договір оренди → орендар.
                // Пусті значення (напр. немає відшкодування) пропускаємо
                label: [c.reimbursement_number, c.contract_number, c.tenant_name]
                  .filter(Boolean).join(' — '),
              })) ?? []}
            />
          </div>

          {/* Послуги (мульти-вибір) */}
          <div className="space-y-1.5 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <p className="text-sm font-medium">Послуги *</p>
              {contractId && availableServices.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-primary hover:underline"
                >
                  {allSelected ? 'Зняти всі' : 'Додати всі послуги'}
                </button>
              )}
            </div>

            {!contractId ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border rounded-md">
                Спочатку виберіть договір
              </div>
            ) : servicesLoading ? (
              <div className="flex items-center justify-center h-32 border rounded-md">
                <Spinner className="h-5 w-5" />
              </div>
            ) : availableServices.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground text-center border rounded-md px-4">
                {(services?.length ?? 0) === 0
                  ? 'Спочатку додайте послуги'
                  : 'Усі послуги вже підключено до цього договору'}
              </div>
            ) : (
              <div className="border rounded-md overflow-auto flex-1 min-h-0 divide-y">
                {availableServices.map(s => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(s.id)}
                      onCheckedChange={() => toggleService(s.id)}
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.color || '#94a3b8' }}
                    />
                    <span className="flex-1 min-w-0 truncate text-sm">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{s.unit_name}</span>
                    <span className="font-mono text-sm w-24 text-right">
                      {Number(s.current_rate).toLocaleString('uk-UA', { minimumFractionDigits: 2 })}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Скасувати
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !contractId || selectedIds.size === 0}
          >
            {isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
            Додати{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
