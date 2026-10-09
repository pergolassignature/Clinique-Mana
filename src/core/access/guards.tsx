import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import type { AccessProblem } from './access'
import { useAccess } from './access-context'

// Each guard screen titles the browser tab, so it never shows the previous page's title.
/** The loading screen while access (or the signed-in app's code) loads. */
export function Loading() {
  usePageTitle(t('pageTitles.loading'))
  return <FullPageMessage role="status" title={t('common.loading')} />
}

function AccessError({ reload, isReloading }: { reload: () => void; isReloading: boolean }) {
  usePageTitle(t('pageTitles.accessError'))
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

function AccessDenied({ problem, signOut }: { problem: AccessProblem; signOut: () => Promise<void> }) {
  usePageTitle(t('pageTitles.accessDenied'))
  return (
    <FullPageMessage
      title={t(`access.denied.${problem}`)}
      action={<Button variant="outline" onClick={() => void signOut()}>{t('access.denied.signOut')}</Button>}
    />
  )
}

interface PageMessageProps {
  /** Inside a page that already has its title (the settings pane): pane-sized, under an h2. */
  compact?: boolean
}

/** The way back from a page the user cannot open: Accueil, which every signed-in role has. */
function BackHome() {
  return (
    <Button asChild variant="outline">
      <Link to="/accueil">{t('common.backHome')}</Link>
    </Button>
  )
}

/**
 * « Accès refusé »: every page that exists but that this user may not open reads the same (a
 * module route without its permission, « Paramètres » without any section, a settings section
 * the user does not see), with the same explanation and the way back to Accueil. A disabled
 * module's pages and unknown URLs are `NotFound` instead.
 */
export function Forbidden({ compact = false }: PageMessageProps) {
  usePageTitle(t('pageTitles.forbidden'))
  return (
    <FullPageMessage
      title={t('access.forbidden.title')}
      body={t('access.forbidden.body')}
      action={<BackHome />}
      headingLevel={compact ? 2 : 1}
      compact={compact}
    />
  )
}

/** « Page introuvable »: a URL that names no page of this app (or of an enabled module). */
export function NotFound({ compact = false }: PageMessageProps) {
  usePageTitle(t('pageTitles.notFound'))
  return (
    <FullPageMessage
      title={t('common.notFound.title')}
      body={t('common.notFound.body')}
      action={<BackHome />}
      headingLevel={compact ? 2 : 1}
      compact={compact}
    />
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, isLoading, isRecovery, signedOutHere, signOut } = useAuth()
  const { status, problem, reload, isReloading } = useAccess()
  const location = useLocation()

  if (isLoading) return <Loading />
  // A recovery link signs the user in: they must choose a new password before using the app.
  if (isRecovery) return <Navigate to="/reinitialiser-mot-de-passe" replace />
  if (!session) {
    // An explicit sign-out must not offer the next person a way back to the last page (shared PCs).
    if (signedOutHere) return <Navigate to="/connexion" replace />
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/connexion?redirect=${redirect}`} replace />
  }
  if (status === 'error') return <AccessError reload={reload} isReloading={isReloading} />
  if (status === 'denied' && problem) return <AccessDenied problem={problem} signOut={signOut} />
  if (status !== 'ready') return <Loading />
  return <>{children}</>
}

export function RequireAccess({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAccess()
  if (!can(permission)) return <Forbidden />
  return <>{children}</>
}
