import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined })
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-wine-100">
            <AlertTriangle className="h-8 w-8 text-wine-500" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            {t('errors.somethingWrong')}
          </h2>
          <p className="mt-2 max-w-md text-sm text-foreground-secondary">
            {t('errors.tryAgain')}
          </p>
          <Button onClick={this.handleRetry} className="mt-6">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common.retry')}
          </Button>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-4 max-w-lg overflow-auto rounded-lg bg-background-secondary p-4 text-left text-xs text-wine-600">
              {this.state.error.message}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
