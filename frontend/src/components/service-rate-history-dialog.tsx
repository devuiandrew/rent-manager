import { useState } from 'react'
import { toast } from 'sonner'
import { useSWRConfig } from 'swr'
import { Trash2, Plus, History } from 'lucide-react'

import { useServiceRates } from '@/hooks/use-billing-data'
import { useAuthContext } from '@/context/auth-provider'
import type { Service } from '@/types/billing'
import { getApiError } from '@/lib/api-error'
import { formatDate, todayIso } from '@/lib/billing-utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  service: Service | null
}

export function ServiceRateHistoryDialog({ open, onOpenChange, service }: Props) {
  const { apiService } = useAuthContext()
  const { mutate } = useSWRConfig()

  const sid = service?.id ?? null
  const { data: rates, isLoading } = useServiceRates(sid)

  // Форма добавления нового тарифа
  const [rate, setRate] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso())
  const [note, setNote] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const today = todayIso()
  // API отдаёт записи по убыванию даты → первая с effective_from <= today и есть активная
  const activeId = rates?.find(r => r.effective_from <= today)?.id ?? null

  // Обновить и историю, и список услуг (там пересчитываются current_rate/upcoming_change)
  const revalidate = async () => {
    await Promise.all([
      mutate(sid ? `/service-rates?service_id=${sid}` : null),
      mutate('/services'),
    ])
  }

  const handleAdd = async () => {
    if (!sid) return
    const normalized = rate.replace(',', '.')
    if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
      toast.error('Невірний формат тарифу')
      return
    }
    if (!effectiveFrom) {
      toast.error('Вкажіть дату початку дії')
      return
    }
    setIsAdding(true)
    try {
      await apiService.createServiceRate({
        service_id: sid,
        rate: normalized,
        effective_from: effectiveFrom,
        note: note.trim(),
      })
      toast.success('Тариф додано в історію')
      setRate('')
      setNote('')
      setEffectiveFrom(todayIso())
      await revalidate()
    } catch (e) {
      // 400 если на эту дату уже есть тариф (unique_together)
      toast.error(getApiError(e, 'Помилка додавання тарифу'))
    } finally {
      setIsAdding(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await apiService.deleteServiceRate(id)
      toast.success('Запис видалено')
      await revalidate()
    } catch (e) {
      toast.error(getApiError(e, 'Помилка видалення'))
    }
  }

  if (!service) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            Історія тарифів: {service.name}
          </DialogTitle>
          <DialogDescription>
            Зміна тарифу діє з вказаної дати і застосовується до всіх договорів за
            тарифом за замовчуванням. Старі рахунки не зачіпаються.
          </DialogDescription>
        </DialogHeader>

        {/* Таблиця історії */}
        <div className="border rounded-md overflow-auto flex-1 min-h-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Діє з</TableHead>
                <TableHead className="w-32 text-right">Тариф</TableHead>
                <TableHead>Примітка</TableHead>
                <TableHead className="w-28 text-center">Статус</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    <Spinner className="inline h-5 w-5" />
                  </TableCell>
                </TableRow>
              ) : !rates?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-sm">
                    Історії ще немає. Додайте перший тариф нижче.
                  </TableCell>
                </TableRow>
              ) : (
                rates.map(r => {
                  const isFuture = r.effective_from > today
                  const isActive = r.id === activeId
                  return (
                    <TableRow key={r.id} className={isFuture ? 'opacity-70' : ''}>
                      <TableCell className="font-mono text-sm">{formatDate(r.effective_from)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {Number(r.rate).toLocaleString('uk-UA', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.note || <span className="italic">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {isActive ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Активний</Badge>
                        ) : isFuture ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Майбутній</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Минулий</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(r.id)}
                          title="Видалити запис"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Форма додавання нового тарифу */}
        <div className="flex items-end gap-2 pt-1 border-t shrink-0">
          <div className="w-32">
            <p className="text-xs text-muted-foreground mb-1.5">Тариф *</p>
            <Input
              className="h-9 font-mono"
              placeholder="0.00"
              value={rate}
              onChange={e => setRate(e.target.value)}
            />
          </div>
          <div className="w-40">
            <p className="text-xs text-muted-foreground mb-1.5">Діє з *</p>
            <Input
              type="date"
              className="h-9"
              value={effectiveFrom}
              onChange={e => setEffectiveFrom(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground mb-1.5">Примітка</p>
            <Input
              className="h-9"
              placeholder="напр. подорожчання"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
          <Button className="h-9 shrink-0" onClick={handleAdd} disabled={isAdding || !rate}>
            {isAdding ? <Spinner className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Додати
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
