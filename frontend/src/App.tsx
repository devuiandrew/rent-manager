import { useEffect, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuthContext } from '@/context/auth-provider'
import { LoginForm } from '@/components/login-form'
import { Layout } from '@/components/layout'
import { Spinner } from '@/components/ui/spinner'
import { hasActiveEdits } from '@/lib/unsaved-tracker'
import { ErrorBoundary } from '@/components/error-boundary'

// Ленивые страницы: каждая — отдельный чанк, грузится при первом открытии
// вкладки (главный выигрыш — recharts уходит в чанк дашборда и не тормозит
// старт). Страницы экспортируются именованно, а React.lazy ждёт default —
// поэтому переупаковка через .then()
const lazyPage = <T,>(
  loader: () => Promise<T>,
  pick: (m: T) => React.ComponentType,
) => lazy(() => loader().then((m) => ({ default: pick(m) })))

const BillingPage = lazyPage(
  () => import('@/components/billing-page'),
  (m) => m.BillingPage,
)
const TenantsPage = lazyPage(
  () => import('@/pages/tenants-page'),
  (m) => m.TenantsPage,
)
const ContractsPage = lazyPage(
  () => import('@/pages/contracts-page'),
  (m) => m.ContractsPage,
)
const ReimbursementsPage = lazyPage(
  () => import('@/pages/reimbursements-page'),
  (m) => m.ReimbursementsPage,
)
const SuppliersPage = lazyPage(
  () => import('@/pages/suppliers-page'),
  (m) => m.SuppliersPage,
)
const ServicesPage = lazyPage(
  () => import('@/pages/services-page'),
  (m) => m.ServicesPage,
)
const ContractServicesPage = lazyPage(
  () => import('@/pages/contract-services-page'),
  (m) => m.ContractServicesPage,
)
const DashboardPage = lazyPage(
  () => import('@/pages/dashboard-page'),
  (m) => m.DashboardPage,
)

function FullscreenLoader({ text = 'Завантаження...' }: { text?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="w-12 h-12" />
        <p className="text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

function ProtectedLayout() {
  const { isAuthenticated, isLoading } = useAuthContext()
  if (isLoading) return <FullscreenLoader />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Layout />
}

function LoginRoute() {
  const { isAuthenticated, isLoading } = useAuthContext()
  if (isLoading) return <FullscreenLoader />
  if (isAuthenticated) return <Navigate to="/" replace />
  return <LoginForm />
}

export default function App() {
  // Попередження при закритті вікна коли є відкрита (незбережена) комірка
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasActiveEdits()) {
        e.preventDefault()
        // Рядок ігнорується сучасними браузерами/Electron — показується стандартне повідомлення
        e.returnValue = 'Є незбережені зміни. Закрити додаток?'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return (
    <ErrorBoundary>
    <AuthProvider>
      <HashRouter>
        {/* Suspense показывает лоадер, пока грузится чанк ленивой страницы */}
        <Suspense fallback={<FullscreenLoader />}>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route element={<ProtectedLayout />}>
              <Route index element={<BillingPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="tenants" element={<TenantsPage />} />
              <Route path="contracts" element={<ContractsPage />} />
              <Route path="reimbursements" element={<ReimbursementsPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="contract-services" element={<ContractServicesPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
    </ErrorBoundary>
  )
}
