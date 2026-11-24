import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useBills, useContracts, useTenants, useServices } from '@/hooks/use-billing-data'
import type { Bill } from '@/types/billing'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem,
  DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAuthContext } from '@/context/auth-provider'
import { AlertTriangle, CheckCircle2, FileText, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

function fmt(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  variant?: 'default' | 'danger' | 'success' | 'warning'
}

function StatCard({ label, value, sub, icon, variant = 'default' }: StatCardProps) {
  return (
    <div className="border rounded-lg bg-card p-4 flex items-start gap-4">
      <div className={cn(
        'w-10 h-10 rounded-md flex items-center justify-center shrink-0',
        variant === 'danger'  && 'bg-red-100 text-red-600',
        variant === 'success' && 'bg-green-100 text-green-600',
        variant === 'warning' && 'bg-amber-100 text-amber-600',
        variant === 'default' && 'bg-primary/10 text-primary',
      )}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { isAccountant } = useAuthContext()
  const [year, setYear] = useState(new Date().getFullYear())
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i), [])

  const { data: bills,     isLoading: billsLoading }     = useBills({ year })
  const { data: contracts, isLoading: contractsLoading } = useContracts()
  const { data: tenants }                                = useTenants()
  const { data: services }                               = useServices()

  const isLoading = billsLoading || contractsLoading

  // ── Агрегати ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    if (!bills || !contracts) return null

    const activeContracts = contracts.filter(c => c.is_active).length
    const currentMonth = new Date().getMonth() + 1

    let totalDebt = 0
    let totalChargedYear = 0
    let totalPaidYear = 0
    let chargedThisMonth = 0
    let unverifiedCount = 0

    for (const b of bills) {
      const charged = Number(b.accrued_amount)
      const paid    = Number(b.paid_amount)
      const corr    = Number(b.correction)
      const debt    = charged + corr - paid

      totalChargedYear += charged
      totalPaidYear    += paid
      if (debt > 0) totalDebt += debt
      if (b.month === currentMonth) chargedThisMonth += charged
      if (!b.is_verified) unverifiedCount++
    }

    return { activeContracts, totalDebt, totalChargedYear, totalPaidYear, chargedThisMonth, unverifiedCount }
  }, [bills, contracts])

  // ── Дані для графіка по місяцях ───────────────────────────────────
  const chartData = useMemo(() => {
    if (!bills) return []
    return MONTHS_SHORT.map((name, i) => {
      const month = i + 1
      const monthBills = bills.filter((b: Bill) => b.month === month)
      return {
        name,
        Нараховано: Number(monthBills.reduce((s: number, b: Bill) => s + Number(b.accrued_amount), 0).toFixed(2)),
        Сплачено:   Number(monthBills.reduce((s: number, b: Bill) => s + Number(b.paid_amount),    0).toFixed(2)),
      }
    })
  }, [bills])

  // ── Топ боржників ─────────────────────────────────────────────────
  const debtors = useMemo(() => {
    if (!bills || !contracts || !tenants) return []

    const debtMap = new Map<number, number>()
    for (const b of bills) {
      const debt = Number(b.accrued_amount) + Number(b.correction) - Number(b.paid_amount)
      debtMap.set(b.contract_id, (debtMap.get(b.contract_id) ?? 0) + debt)
    }

    return Array.from(debtMap.entries())
      .filter(([, debt]) => debt > 0.005)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([contractId, debt]) => {
        const contract = contracts.find(c => c.id === contractId)
        const tenant   = tenants.find(t => t.id === contract?.tenant_id)
        return {
          contractId,
          contractNumber: contract?.contract_number ?? '—',
          tenantName:     tenant?.name ?? '—',
          address:        contract?.address ?? '—',
          debt,
        }
      })
  }, [bills, contracts, tenants])

  // ── Нарахування по послугах за рік ────────────────────────────────
  const byService = useMemo(() => {
    if (!bills || !services) return []
    return services.map(s => {
      const sBills = bills.filter((b: Bill) => b.service_id === s.id)
      const charged = sBills.reduce((sum: number, b: Bill) => sum + Number(b.accrued_amount), 0)
      const paid    = sBills.reduce((sum: number, b: Bill) => sum + Number(b.paid_amount),    0)
      return { service: s, charged, paid, debt: charged - paid }
    }).filter(r => r.charged > 0).sort((a, b) => b.charged - a.charged)
  }, [bills, services])

  // ── Рендер ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="w-10 h-10" />
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Заголовок + вибір року */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Дашборд</h1>
            <p className="text-sm text-muted-foreground">Зведення по рахунках за {year} рік</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-24">{year}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Рік</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {years.map(y => (
                <DropdownMenuCheckboxItem key={y} checked={y === year} onCheckedChange={() => setYear(y)}>
                  {y}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Картки метрик */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Загальний борг"
              value={`${fmt(stats.totalDebt)} ₴`}
              sub="сума невиплачених рахунків"
              icon={<AlertTriangle className="h-5 w-5" />}
              variant={stats.totalDebt > 0 ? 'danger' : 'success'}
            />
            <StatCard
              label="Активних договорів"
              value={stats.activeContracts}
              sub="чинних на сьогодні"
              icon={<FileText className="h-5 w-5" />}
              variant="default"
            />
            <StatCard
              label={`Нараховано за ${year} рік`}
              value={`${fmt(stats.totalChargedYear)} ₴`}
              sub={`Сплачено: ${fmt(stats.totalPaidYear)} ₴`}
              icon={<TrendingUp className="h-5 w-5" />}
              variant="default"
            />
            {isAccountant && (
              <StatCard
                label="Не перевірено"
                value={stats.unverifiedCount}
                sub="рахунків очікують перевірки"
                icon={<CheckCircle2 className="h-5 w-5" />}
                variant={stats.unverifiedCount > 0 ? 'warning' : 'success'}
              />
            )}
          </div>
        )}

        {/* Графік: нараховано vs сплачено по місяцях */}
        <div className="border rounded-lg bg-card p-4">
          <h2 className="font-semibold mb-4">Нараховано / Сплачено по місяцях</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} width={80} tickFormatter={v => fmt(v)} />
              <Tooltip
                formatter={(value: number) => [`${fmt(value)} ₴`]}
                labelStyle={{ fontWeight: 600 }}
              />
              <Legend />
              <Bar dataKey="Нараховано" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Сплачено"   fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Нижній ряд: боржники + розбивка по послугах */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Топ-10 боржників */}
          <div className="border rounded-lg bg-card p-4">
            <h2 className="font-semibold mb-3">Топ боржників</h2>
            {debtors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Боргів немає 🎉</p>
            ) : (
              <div className="space-y-2">
                {debtors.map((d, i) => (
                  <div key={d.contractId} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{d.tenantName}</p>
                      <p className="text-xs text-muted-foreground truncate">{d.contractNumber} · {d.address}</p>
                    </div>
                    <span className="text-sm font-bold text-red-600 shrink-0">{fmt(d.debt)} ₴</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Розбивка по послугах */}
          <div className="border rounded-lg bg-card p-4">
            <h2 className="font-semibold mb-3">По послугах за {year} рік</h2>
            {byService.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Немає даних</p>
            ) : (
              <div className="space-y-3">
                {byService.map(({ service, charged, paid, debt }) => {
                  const paidPct = charged > 0 ? Math.min(100, (paid / charged) * 100) : 0
                  return (
                    <div key={service.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: service.color }}
                          />
                          <span className="text-sm font-medium">{service.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-muted-foreground">нарах: {fmt(charged)} ₴</span>
                          {debt > 0.005 && (
                            <Badge variant="destructive" className="text-xs py-0">
                              борг {fmt(debt)} ₴
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Прогрес-бар: зелений = сплачено, сірий = залишок */}
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${paidPct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Сплачено {fmt(paid)} ₴ · {paidPct.toFixed(0)}%
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
