import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { FullPageMessage } from './FullPageMessage'

interface Props {
  children: ReactNode
  /** Tag sent to Sentry, e.g. the module key. */
  scope?: string
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { tags: { scope: this.props.scope ?? 'app' }, extra: { componentStack: info.componentStack } })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <FullPageMessage
        title={t('common.moduleError.title')}
        body={t('common.moduleError.body')}
        action={<Button onClick={() => this.setState({ hasError: false })}>{t('common.retry')}</Button>}
      />
    )
  }
}
