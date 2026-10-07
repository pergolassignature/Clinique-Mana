import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/AuthProvider'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { Button } from '@/shared/ui/button'
import { useAccess } from './AccessProvider'

function Loading() {
  return <FullPageMessage title={t('common.loading')} />
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, isLoading, isRecovery, signOut } = useAuth()
  const { status, problem, reload, isReloading } = useAccess()
  const location = useLocation()

  if (isLoading) return <Loading />
  // A recovery link signs the user in: they must choose a new password before using the app.
  if (isRecovery) return <Navigate to="/reinitialiser-mot-de-passe" replace />
  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/connexion?redirect=${redirect}`} replace />
  }
  if (status === 'error') {
    return (
      <FullPageMessage
        title={t('access.error.title')}
        body={t('access.error.body')}
        action={
          <Button onClick={reload} disabled={isReloading}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }
  if (status === 'denied' && problem) {
    return (
      <FullPageMessage
        title={t(`access.denied.${problem}`)}
        action={<Button variant="outline" onClick={() => void signOut()}>{t('access.denied.signOut')}</Button>}
      />
    )
  }
  if (status !== 'ready') return <Loading />
  return <>{children}</>
}

export function RequireAccess({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAccess()
  if (!can(permission)) return <FullPageMessage title={t('access.forbidden.title')} body={t('access.forbidden.body')} />
  return <>{children}</>
}
