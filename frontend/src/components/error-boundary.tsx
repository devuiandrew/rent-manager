import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Error Boundary — перехоплює помилки в дочірніх компонентах.
 *
 * Без нього: будь-яка необроблена помилка → білий екран.
 * З ним: показується зручне повідомлення + кнопка оновити.
 *
 * Тільки класовий компонент може бути Error Boundary (обмеження React).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // В майбутньому тут можна відправляти помилку на сервер
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </div>

          <div>
            <h1 className="text-xl font-semibold">Щось пішло не так</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Виникла неочікувана помилка. Спробуйте оновити сторінку.
            </p>
          </div>

          {/* Технічні деталі — для розробника */}
          {this.state.error && (
            <details className="text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Технічні деталі
              </summary>
              <pre className="mt-2 text-xs bg-muted rounded p-3 overflow-auto max-h-40 text-destructive">
                {this.state.error.message}
              </pre>
            </details>
          )}

          <Button onClick={this.handleReload} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Оновити сторінку
          </Button>
        </div>
      </div>
    )
  }
}
