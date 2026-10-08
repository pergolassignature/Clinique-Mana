import { useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { confirmNext, parseConfirmType, type ConfirmType } from '@/core/auth/confirm'
import { sessionIdOf, setRecoveryMarker } from '@/core/auth/recovery'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { AuthCard, StatusNotice } from './AuthCard'

/** Where « Demander un nouveau lien » leads: an email change is asked again from « Mon compte ». */
const REQUEST_NEW: Record<ConfirmType, string> = {
  recovery: '/mot-de-passe-oublie',
  email: '/connexion',
  email_change: '/mon-compte',
}

/**
 * `/connexion/confirmer?token_hash=…&type=…[&next=…]`: where the recovery, magic-link and
 * email-change emails land (design §5, ADR 0006). Public, outside RequireAuth.
 *
 * The token is verified only when « Continuer » is clicked: a mail scanner that prefetches the
 * link burns nothing. The query is read once, then removed from the URL, so the token does not
 * stay in history. A signed-in session (a shared reception PC) is left alone on error; on success
 * verifyOtp replaces it and AuthProvider's user-change rules apply (decisions #10, #14). The first
 * of the two email-change links opens no session: the page then shows the confirmation itself.
 */
export function ConfirmPage() {
  usePageTitle(t('auth.confirm.title'))
  const { session, verifyEmailLink, signOut } = useAuth()
  const { status, access } = useAccess()
  const location = useLocation()
  const navigate = useNavigate()
  const [link] = useState(() => {
    const params = new URLSearchParams(location.search)
    return { tokenHash: params.get('token_hash'), type: parseConfirmType(params.get('type')), next: params.get('next') }
  })
  const [error, setError] = useState<AuthErrorCode | null>(link.tokenHash && link.type ? null : 'link_invalid')
  const [verifying, setVerifying] = useState(false)
  // An email-change link confirmed without a session (the first of the two links).
  const [emailChangeConfirmed, setEmailChangeConfirmed] = useState(false)
  // A ref, not the state: a double click lands before the next render.
  const busy = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const expired = error === 'link_invalid'
  // Either way, the button disappears.
  const done = expired || emailChangeConfirmed

  useEffect(() => {
    if (location.search) navigate(location.pathname, { replace: true })
  }, [location.search, location.pathname, navigate])

  // The button disappears: keep focus on the card instead of losing it. The live region announces.
  useEffect(() => {
    if (done) headingRef.current?.focus()
  }, [done])

  const onContinue = async () => {
    const { tokenHash, type, next } = link
    if (!tokenHash || !type || busy.current) return
    busy.current = true
    setVerifying(true)
    setError(null)
    // Set once the link is used and the page has moved on: the button then stays inactive, so a
    // second click landing before the next render can't verify the spent token again.
    let used = false
    try {
      const result = await verifyEmailLink(tokenHash, type)
      if (!result.ok) {
        setError(result.code)
        return
      }
      if (type === 'recovery') {
        const sessionId = sessionIdOf(result.sessionAccessToken)
        if (!sessionId) {
          // The link was used, but its session can't be bound to a marker (no JWT `session_id`):
          // it must not stay open as an ordinary, fully usable session. auth-js has already saved
          // it, so forget it on this device; with no session at all, nothing was replaced.
          if (result.sessionAccessToken) await signOut({ reload: false })
          setError('link_invalid')
          return
        }
        // Before navigating: the guard must already see this session as a recovery (ADR 0006).
        setRecoveryMarker(sessionId)
        navigate('/reinitialiser-mot-de-passe', { replace: true })
      } else if (type === 'email_change') {
        // The first of the two links confirms without a session: say so here, neutrally (decision
        // #38), whoever is signed in on this device. « Mon compte » only with the session it opens.
        if (result.sessionAccessToken) navigate('/mon-compte', { replace: true, state: { emailChangeConfirmed: true } })
        else setEmailChangeConfirmed(true)
      } else {
        navigate(confirmNext(next, window.location.origin), { replace: true })
      }
      used = true
    } catch (failure) {
      Sentry.captureException(failure, { tags: { area: 'auth' } })
      setError('unknown')
    } finally {
      // Every other way out (refusal, thrown error) gives the button back.
      if (!used) {
        busy.current = false
        setVerifying(false)
      }
    }
  }

  const signedInAs = session ? (status === 'ready' && access?.display_name) || session.user.email : null

  return (
    <AuthCard
      title={emailChangeConfirmed ? t('auth.confirm.emailChangeTitle') : t('auth.confirm.title')}
      headingRef={headingRef}
      subtitle={done ? undefined : t('auth.confirm.subtitle')}
      status={
        emailChangeConfirmed ? (
          <StatusNotice>{t('auth.confirm.emailChangeBody')}</StatusNotice>
        ) : expired ? (
          <StatusNotice>{t('auth.confirm.invalid')}</StatusNotice>
        ) : null
      }
    >
      {emailChangeConfirmed ? null : expired ? (
        <p className="text-center text-sm">
          <Link
            to={REQUEST_NEW[link.type ?? 'email']}
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
          {/* Soft-disabled while verifying: a `disabled` button would drop focus to <body>. */}
          <Button
            type="button"
            className={cn('w-full', softDisabledClasses, 'aria-disabled:hover:bg-primary aria-disabled:active:bg-primary')}
            aria-disabled={verifying || undefined}
            onClick={ignoreWhenInactive(verifying, () => void onContinue())}
          >
            {verifying ? t('auth.confirm.verifying') : t('auth.confirm.continue')}
          </Button>
        </div>
      )}
    </AuthCard>
  )
}
