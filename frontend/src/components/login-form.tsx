import { useState } from 'react'
import { useAuthContext } from '@/context/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Eye, EyeOff } from 'lucide-react'
import { APP_VERSION, COPYRIGHT_LINE } from '@/lib/version'

function AppLogo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <img src="./logo.png" alt="Логотип" className="w-full h-full object-contain" />
    </div>
  )
}

export function LoginForm() {
  const { login } = useAuthContext()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!username.trim() || !password) return

    setIsSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
    } catch {
      setError('Невірний логін або пароль')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <AppLogo className="w-28 h-28" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-foreground">
              Система обліку комунальних платежів
            </CardTitle>
            <CardDescription className="mt-2">
              Введіть дані для входу
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Логін</Label>
              <Input
                id="username"
                type="text"
                placeholder="Введіть логін"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Введіть пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting || !username || !password}>
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Вхід...
                </>
              ) : (
                'Увійти'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Копірайт + версія збірки — правова позначка, видима на екрані входу */}
      <p className="absolute bottom-4 inset-x-0 text-center text-xs text-muted-foreground px-4">
        {COPYRIGHT_LINE} · v{APP_VERSION}
      </p>
    </div>
  )
}
