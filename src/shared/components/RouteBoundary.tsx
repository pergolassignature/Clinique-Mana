import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Error boundary for a routed area (a module, a settings section): a crash or failed chunk stays
 * inside it, it recovers on navigation, and Retry also resets failed React Query queries.
 */
export function RouteBoundary({ scope, children }: { scope: string; children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary scope={scope} resetKey={pathname} onReset={reset}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
