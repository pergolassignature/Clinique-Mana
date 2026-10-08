import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { confirmNext, parseConfirmType } from '@/core/auth/confirm'
import { sessionIdOf, setRecoveryMarker } from '@/core/auth/recovery'
import { Button } from '@/shared/ui/button'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { AuthCard, StatusNotice } from './AuthCard'

/**
 * `/connexion/confirmer?token_hash=…&type=…[&next=…]`: where the recovery, magic-link and
 * email-change emails land (design §5, ADR 0006). Public, outside RequireAuth.
 *
 * The token is verified only when « Continuer » is clicked: a mail scanner that prefetches the
 * link burns nothing. The query is read once, then removed from the URL, so the token does not
 * stay in history. A signed-in session (a shared reception PC) is left alone on error; on success
 * verifyOtp replaces it and AuthProvider's user-change rules apply (decisions #10, #14).
 */
export function ConfirmPage() {
  usePageTitle(t('auth.confirm.title'))
  const { session, verifyEmailLink } = useAuth()
  const { status, access } = useAccess()
  const location = useLocation()
  const navigate = useNavigate()
  const [link] = useState(() => {
    const params = new URLSearchParams(location.search)
    return { tokenHash: params.get('token_hash'), type: parseConfirmType(params.get('type')), next: params.get('next') }
  })
  const [error, setError] = useState<AuthErrorCode | null>(link.tokenHash && link.type ? null : 'link_invalid')
  const [verifying, setVerifying] = useState(false)
  // A ref, not the state: a double click lands before the next render.
  const busy = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const expired = error === 'link_invalid'

  useEffect(() => {
    if (location.search) navigate(location.pathname, { replace: true })
  }, [location.search, location.pathname, navigate])

  // The button disappears: keep focus on the card instead of losing it. The live region announces.
  useEffect(() => {
    if (expired) headingRef.current?.focus()
  }, [expired])

  const onContinue = async () => {
    const { tokenHash, type, next } = link
    if (!tokenHash || !type || busy.current) return
    busy.current = true
    setVerifying(true)
    setError(null)
    const result = await verifyEmailLink(tokenHash, type)
    const sessionId = result.ok && type === 'recovery' ? sessionIdOf(result.sessionAccessToken) : null
    if (!result.ok || (type === 'recovery' && !sessionId)) {
      // A recovery session is never opened without its marker (GoTrue always sends a session id).
      setError(result.ok ? 'unknown' : result.code)
      setVerifying(false)
      busy.current = false
      return
    }
    if (type === 'recovery') {
      // Before navigating: the guard must already see this session as a recovery (ADR 0006).
      setRecoveryMarker(sessionId)
      navigate('/reinitialiser-mot-de-passe', { replace: true })
    } else if (type === 'email_change') {
      navigate('/mon-compte', { replace: true, state: { emailChangeConfirmed: true } })
    } else {
      navigate(confirmNext(next, window.location.origin), { replace: true })
    }
  }

  const signedInAs = session ? (status === 'ready' && access?.display_name) || session.user.email : null

  return (
    <AuthCard
      title={t('auth.confirm.title')}
      headingRef={headingRef}
      subtitle={expired ? undefined : t('auth.confirm.subtitle')}
      status={expired ? <StatusNotice>{t('auth.confirm.invalid')}</StatusNotice> : null}
    >
      {expired ? (
        <p className="text-center text-sm">
          <Link
            to={link.type === 'recovery' ? '/mot-de-passe-oublie' : '/connexion'}
            className="text-link underline-offset-[3px] hover:underline"
          >
            {t('auth.confirm.requestNew')}
          </Link>
        </p>
      ) : (
        <div className="space-y-4">
          {signedInAs && (
            <p className="rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground">
              {t('auth.confirm.otherUser', { name: signedInAs })}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(`auth.errors.${error}`)}
            </p>
          )}
          <Button type="button" className="w-full" onClick={onContinue} disabled={verifying}>
            {verifying ? t('auth.confirm.verifying') : t('auth.confirm.continue')}
          </Button>
        </div>
      )}
    </AuthCard>
  )
}
