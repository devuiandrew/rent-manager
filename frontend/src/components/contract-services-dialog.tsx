import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { Trash2, Plus, Settings2 } from 'lucide-react'

import { useContractServices, useServices } from '@/hooks/use-billing-data'
import { useAuthContext } from '@/context/auth-provider'
import type { Contract, ContractService } from '@/types/billing'
import { getApiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/billing-utils'
import { EditableCell } from '@/components/billing-cells'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  contract: Contract | null
}

// Швидке підключення/відключення послуг до конкретного договору.
// Персональний тариф прибрано: діє тариф за замовчуванням з послуги
// (змінюється для всіх через історію тарифів послуги).
export function ContractServicesDialog({ open, onOpenChange, contract }: Props) {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()

  const cid = contract?.id ?? null
  // SWR-ключ для послуг цього договору
  const csKey = cid ? `/contract-services?contract_id=${cid}` : null

  const { data: contractServices, isLoading } = useContractServices(
    cid ? { contract_id: cid } : undefined,
  )
  const { data: allServices } = useServices()

  // Послуги, яких ще немає в цьому договорі
  const availableServices = useMemo(() => {
    if (!allServices) return []
    if (!contractServices) return allServices
    const linked = new Set(contractServices.map(cs => cs.service_id))
    return allServices.filter(s => !linked.has(s.id))
  }, [allServices, contractServices])

  // --- Стан форми додавання ---
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [isAdding, setIsAdding] = useState(false)

  const revalidate = () => mutate(csKey)

  // Підключити нову послугу (тариф за замовчуванням)
  const handleAdd = async () => {
    if (!cid || !selectedServiceId) return
    setIsAdding(true)
    try {
      await apiService.createContractService({
        contract_id: cid,
        service_id: Number(selectedServiceId),
        personal_rate: null,
        is_active: true,
      })
      toast.success('Послугу підключено')
      setSelectedServiceId('')
      await revalidate()
    } catch (e) {
      toast.error(getApiError(e, 'Помилка підключення послуги'))
    } finally {
      setIsAdding(false)
    }
  }

  // Відключити послугу від договору
  const handleDelete = async (cs: ContractService) => {
    try {
      await apiService.deleteContractService(cs.id)
      toast.success(`${cs.service_name} відключено від договору`)
      await revalidate()
    } catch (e) {
      toast.error(getApiError(e, 'Помилка видалення'))
    }
  }

  // Годовой план по услуге («Сума/Обсяг за договором») — те же поля, что
  // правятся в «Рахунках». Тот, кто вносит оплаты, видит план по всем
  // услугам договора в одном месте
  const handleUpdatePlan = async (
    cs: ContractService,
    field: 'planned_amount' | 'planned_volume',
    value: number,
  ) => {
    try {
      await apiService.updateContractService(cs.id, {
        // Деньги — только half-up (roundMoney), объём — как есть
        [field]: field === 'planned_amount' ? roundMoney(value) : String(value),
      })
      // Префикс: и этот диалог, и ключи «Рахунків» (?service_id=…)
      await mutate(key => typeof key === 'string' && key.startsWith('/contract-services'))
    } catch (e) {
      toast.error(getApiError(e, 'Помилка збереження плану'))
    }
  }

  // Перемикач активності
  const handleToggleActive = async (cs: ContractService) => {
    try {
      await apiService.updateContractService(cs.id, { is_active: !cs.is_active })
      await revalidate()
    } catch (e) {
      toast.error(getApiError(e, 'Помилка оновлення'))
    }
  }

  if (!contract) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            Послуги договору: {contract.contract_number}
          </DialogTitle>
          <DialogDescription>
            {contract.tenant_name} • {contract.address}
          </DialogDescription>
        </DialogHeader>

        {/* Таблиця підключених послуг — flex-1 щоб займала вільний простір діалогу */}
        <div className="border rounded-md overflow-auto flex-1 min-h-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Послуга</TableHead>
                <TableHead className="w-32 text-right">Тариф</TableHead>
                <TableHead className="w-40 text-right">Сума за договором, грн</TableHead>
                <TableHead className="w-40 text-right">Обсяг за договором</TableHead>
                <TableHead className="w-20 text-center">Активна</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Spinner className="inline h-5 w-5" />
                  </TableCell>
                </TableRow>
              ) : !contractServices?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                    Послуг ще немає. Підключіть нижче.
                  </TableCell>
                </TableRow>
              ) : (
                contractServices.map(cs => (
                  <TableRow key={cs.id} className={!cs.is_active ? 'opacity-50' : ''}>
                    {/* Назва з кольоровою крапкою */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cs.service_color }}
                        />
                        <span className="font-medium">{cs.service_name}</span>
                        <span className="text-xs text-muted-foreground">{cs.service_unit_name}</span>
                      </div>
                    </TableCell>

                    {/* Тариф (за замовчуванням, на сьогодні) */}
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {Number(cs.effective_rate).toFixed(4)}
                    </TableCell>

                    {/* План на рік — клик для правки, как в «Рахунках»;
                    пустой план — серым нулём */}
                    <TableCell className="text-right">
                      <EditableCell
                        value={cs.planned_amount != null ? Number(cs.planned_amount) : 0}
                        type="currency"
                        className={cs.planned_amount == null ? 'text-muted-foreground' : 'font-semibold'}
                        onSave={v => handleUpdatePlan(cs, 'planned_amount', v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <EditableCell
                          value={cs.planned_volume != null ? Number(cs.planned_volume) : 0}
                          type="quantity"
                          className={cs.planned_volume == null ? 'text-muted-foreground' : 'font-semibold'}
                          onSave={v => handleUpdatePlan(cs, 'planned_volume', v)}
                        />
                        <span className="text-xs text-muted-foreground shrink-0">{cs.service_unit_name}</span>
                      </div>
                    </TableCell>

                    {/* Активна — клікабельний бейдж */}
                    <TableCell className="text-center">
                      <button onClick={() => handleToggleActive(cs)}>
                        <Badge
                          variant={cs.is_active ? 'default' : 'secondary'}
                          className={
                            cs.is_active
                              ? 'bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer'
                              : 'cursor-pointer hover:bg-muted'
                          }
                        >
                          {cs.is_active ? 'Так' : 'Ні'}
                        </Badge>
                      </button>
                    </TableCell>

                    {/* Кнопка відключення */}
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(cs)}
                        title="Відключити послугу"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Форма підключення нової послуги — shrink-0 щоб не стискалась */}
        {availableServices.length > 0 ? (
          <div className="flex items-end gap-2 pt-1 border-t shrink-0">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground mb-1.5">Послуга</p>
              <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Виберіть послугу..." />
                </SelectTrigger>
                <SelectContent>
                  {availableServices.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                        <span className="text-xs text-muted-foreground ml-1">{s.unit_name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="h-9 shrink-0"
              onClick={handleAdd}
              disabled={!selectedServiceId || isAdding}
            >
              {isAdding
                ? <Spinner className="h-4 w-4 mr-2" />
                : <Plus className="h-4 w-4 mr-2" />
              }
              Підключити
            </Button>
          </div>
        ) : (
          !isLoading && allServices && allServices.length > 0 && (
            <p className="text-sm text-muted-foreground text-center pt-2 border-t">
              Всі доступні послуги вже підключено до цього договору.
            </p>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
