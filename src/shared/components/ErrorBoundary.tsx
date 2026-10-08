import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { t } from '@/i18n'
import { isChunkLoadError, recoverFromStaleChunk } from '@/shared/lib/app-update'
import { Button } from '@/shared/ui/button'
import { FullPageMessage } from './FullPageMessage'

interface Props {
  children: ReactNode
  /** Tag sent to Sentry, e.g. the module key. */
  scope?: string
  /** When this value changes while in error (e.g. the pathname), the boundary recovers. */
  resetKey?: unknown
  /** Called on Retry, e.g. React Query's QueryErrorResetBoundary reset. */
  onReset?: () => void
  /** Pane-sized fallback with a level-2 heading, for boundaries under an existing page title. */
  compact?: boolean
  /** The boundary around the whole app: its fallback replaces everything, so its text says so. */
  root?: boolean
}

interface State {
  error: Error | null
  /** A stale chunk: the page is reloading to the new version. */
  reloading: boolean
}

/**
 * Catches render errors in its subtree and reports them to Sentry. A chunk that fails to load
 * (usually a deploy since the tab opened) is not a bug: the page reloads to the new version
 * (`recoverFromStaleChunk`), or, when that would lose unsaved edits or has already been tried,
 * offers « Recharger ».
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Not reported (Sentry ignores these too, main.tsx): expected after every deploy.
      if (recoverFromStaleChunk()) this.setState({ reloading: true })
      return
    }
    Sentry.captureException(error, {
      tags: { scope: this.props.scope ?? 'app' },
      contexts: { react: { componentStack: info.componentStack } },
    })
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && !Object.is(prevProps.resetKey, this.props.resetKey)) {
      this.props.onReset?.()
      this.setState({ error: null, reloading: false })
    }
  }

  private handleRetry = () => {
    this.props.onReset?.()
    this.setState({ error: null, reloading: false })
  }

  // A deliberate reload: the unsaved-changes guard's beforeunload prompt still asks first.
  private handleReload = () => window.location.reload()

  render() {
    const { error, reloading } = this.state
    if (!error) return this.props.children
    const headingLevel = this.props.compact ? 2 : 1
    const compact = this.props.compact
    if (isChunkLoadError(error)) {
      if (reloading) return <FullPageMessage role="status" headingLevel={headingLevel} compact={compact} title={t('common.loading')} />
      return (
        <FullPageMessage
          role="alert"
          headingLevel={headingLevel}
          compact={compact}
          title={t('common.appUpdate.title')}
          action={<Button onClick={this.handleReload}>{t('common.appUpdate.reload')}</Button>}
        />
      )
    }
    const copy = this.props.root ? 'appError' : 'moduleError'
    return (
      <FullPageMessage
        role="alert"
        headingLevel={headingLevel}
        compact={compact}
        title={t(`common.${copy}.title`)}
        body={t(`common.${copy}.body`)}
        action={<Button onClick={this.handleRetry}>{t('common.retry')}</Button>}
      />
    )
  }
}
