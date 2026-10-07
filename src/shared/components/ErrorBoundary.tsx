import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { FullPageMessage } from './FullPageMessage'

/** lazy() caches a failed chunk import, so only a full reload can recover. */
const CHUNK_LOAD_ERROR = /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/

interface Props {
  children: ReactNode
  /** Tag sent to Sentry, e.g. the module key. */
  scope?: string
  /** When this value changes while in error (e.g. the pathname), the boundary recovers. */
  resetKey?: unknown
  /** Called on Retry, e.g. React Query's QueryErrorResetBoundary reset. */
  onReset?: () => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, {
      tags: { scope: this.props.scope ?? 'app' },
      contexts: { react: { componentStack: info.componentStack } },
    })
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.setState({ error: null })
    }
  }

  private handleRetry = () => {
    if (CHUNK_LOAD_ERROR.test(this.state.error?.message ?? '')) {
      window.location.reload()
      return
    }
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <FullPageMessage
        role="alert"
        title={t('common.moduleError.title')}
        body={t('common.moduleError.body')}
        action={<Button onClick={this.handleRetry}>{t('common.retry')}</Button>}
      />
    )
  }
}
