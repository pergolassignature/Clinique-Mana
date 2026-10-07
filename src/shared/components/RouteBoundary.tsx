import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Error boundary for a routed area (a module, a settings section): a crash or failed chunk stays
 * inside it, it recovers on navigation, and Retry also resets failed React Query queries.
 */
interface RouteBoundaryProps {
  /** Sentry scope tag, e.g. the module key or `settings:<id>`. */
  scope: string
  /** Pane-sized fallback with a level-2 heading (see ErrorBoundary). */
  compact?: boolean
  children: ReactNode
}

export function RouteBoundary({ scope, compact, children }: RouteBoundaryProps) {
  const { pathname } = useLocation()
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary scope={scope} resetKey={pathname} onReset={reset} compact={compact}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
