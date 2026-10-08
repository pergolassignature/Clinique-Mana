import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useAuth } from '@/core/auth/auth-context'
import { AuthCard, StatusNotice } from '@/core/auth/pages/AuthCard'
import { newPasswordSchema, type NewPasswordValues } from '@/core/auth/password-schema'
import { FunctionCallError } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'
import { usePageTitle, useNoIndex } from '@/shared/lib/use-page-title'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { acceptInvite, resolveLink, type InvitationDisplay } from '../api'

/** 32 random bytes, base64url without padding (`_shared/links.ts`): anything else is not a link. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The answers that end the page: the link can no longer be used, whatever is retried. */
const ENDINGS = ['link_invalid', 'link_expired', 'link_used', 'conflict'] as const
type Ending = (typeof ENDINGS)[number]
const isEnding = (code: string): code is Ending => (ENDINGS as readonly string[]).includes(code)

const codeOf = (error: unknown) => (error instanceof FunctionCallError ? error.code : 'internal')

/** « Trop de tentatives. Réessayez dans environ 45 minutes. » (`Retry-After` when the function sent it). */
const rateLimitedText = (error: unknown) =>
  `${t('invitation.states.rate_limited')} ${retryInText(error instanceof FunctionCallError ? error.retryAfter : null)}`

/**
 * Reports a failure the page does not expect: its code and the function's own message only (the
 * functions' messages never carry a token, a password or an address). Any other error sends its
 * class name, never its text, which could quote a value.
 */
function report(error: unknown) {
  const code = codeOf(error)
  if (code === 'network') return
  const failure = new Error(error instanceof FunctionCallError ? error.message : error instanceof Error ? error.name : typeof error)
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'auth', code } })
}

/**
 * `/invitation#t=…`: where a staff invitation email lands (design §4, Task 3.21). Public, outside
 * RequireAuth, code-split.
 *
 * The token travels in the fragment, so it never reaches a server log. It is read once, kept in
 * memory, and removed from the URL before anything is requested (a layout effect runs before the
 * query's), so it stays out of history, and Sentry drops fragments anyway. `resolve-link` shows
 * whom the invitation is for; the invitee then chooses a password, `accept-invite` creates the
 * account, and the page signs her in and opens Accueil. Someone else signed in on this browser (a
 * shared reception PC) is signed out locally first, once the account exists (decisions #10, #13).
 */
export function InvitationPage() {
  usePageTitle(t('invitation.title'))
  useNoIndex()
  const { hash } = useLocation()
  // Another link opened in this tab changes only the fragment (no page load): it starts afresh.
  // Stripping the fragment goes around the router, so its location keeps the hash it read.
  return <InvitationLink key={hash} hash={hash} />
}

/** Each opening of a link, so a new one never shares the previous one's query. */
let openings = 0

function InvitationLink({ hash }: { hash: string }) {
  const [opening] = useState(() => ++openings)
  const [token] = useState(() => {
    const value = new URLSearchParams(hash.slice(1)).get('t')
    return value !== null && TOKEN_SHAPE.test(value) ? value : null
  })
  // Set by the form: the link is refused, or spent (the account exists), so it is never looked up
  // again. The invitation shown is kept from then on: signing out someone else clears the query
  // cache (decision #10), and the form must stay while the sign-in runs.
  const [ending, setEnding] = useState<Ending | 'activated' | null>(token ? null : 'link_invalid')
  const [accepted, setAccepted] = useState<InvitationDisplay | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [])

  const resolved = useQuery({
    // No token in the key; dropped once the page is left.
    queryKey: ['invitation', 'resolve', opening],
    queryFn: () => resolveLink(token ?? ''),
    enabled: token !== null && ending === null && accepted === null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const resolveCode = resolved.isError ? codeOf(resolved.error) : null
  useEffect(() => {
    if (resolveCode && !isEnding(resolveCode) && resolveCode !== 'rate_limited') report(resolved.error)
  }, [resolveCode, resolved.error])

  const shown = ending ?? (resolveCode && isEnding(resolveCode) ? resolveCode : null)
  // The form is replaced by a message (an ending, or a failed check with « Réessayer »): focus
  // goes to its heading. The live region announces it.
  const replaced = shown ?? (resolved.isError ? 'error' : null)
  useEffect(() => {
    if (replaced) headingRef.current?.focus()
  }, [replaced])

  if (shown === 'activated') {
    return (
      <AuthCard title={t('invitation.title')} headingRef={headingRef} status={<StatusNotice>{t('invitation.activated')}</StatusNotice>}>
        <SignInLink />
      </AuthCard>
    )
  }
  if (shown) {
    return (
      <AuthCard title={t('invitation.title')} headingRef={headingRef} status={<StatusNotice>{t(`invitation.states.${shown}`)}</StatusNotice>}>
        {shown === 'link_invalid' && <p className="text-sm text-muted-foreground">{t('invitation.latestEmailHint')}</p>}
        {shown === 'link_used' && <SignInLink />}
      </AuthCard>
    )
  }
  if (resolved.isError) {
    return (
      <AuthCard
        title={t('invitation.title')}
        headingRef={headingRef}
        status={<StatusNotice>{resolveCode === 'rate_limited' ? rateLimitedText(resolved.error) : t('invitation.states.error')}</StatusNotice>}
      >
        <Button type="button" variant="outline" className="w-full" disabled={resolved.isFetching} onClick={() => void resolved.refetch()}>
          {t('common.retry')}
        </Button>
      </AuthCard>
    )
  }
  const invitation = accepted ?? resolved.data
  if (!invitation || token === null) {
    return <AuthCard title={t('invitation.title')} status={<StatusNotice muted>{t('invitation.checking')}</StatusNotice>} />
  }
  return <AcceptForm token={token} invitation={invitation} onAccepted={() => setAccepted(invitation)} onEnding={setEnding} />
}

function SignInLink() {
  return (
    <p className="text-center text-sm">
      <Link to="/connexion" className="text-link underline-offset-[3px] hover:underline">
        {t('invitation.signIn')}
      </Link>
    </p>
  )
}

interface AcceptFormProps {
  token: string
  invitation: InvitationDisplay
  /** The account exists: the link is spent. */
  onAccepted: () => void
  onEnding: (ending: Ending | 'activated') => void
}

/**
 * Bienvenue chez {clinique}: the invitee's name and address (read-only; the address names the
 * account for password managers), the expiry, and the password pair (`password-schema.ts`, the
 * rule `accept-invite` and GoTrue apply). A refusal that ends the link replaces the form; any other
 * failure stays on it, with its message, and the button retries.
 */
function AcceptForm({ token, invitation, onAccepted, onEnding }: AcceptFormProps) {
  const { session, signInWithPassword, signOut } = useAuth()
  const { status, access } = useAccess()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState } = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema) })
  // Someone else signed in on this browser: named by their display name only, never their address.
  const otherUser = session ? (status === 'ready' && access?.display_name) || '' : null

  const onSubmit = async ({ password }: NewPasswordValues) => {
    setError(null)
    let email: string
    try {
      ;({ email } = await acceptInvite(token, password))
    } catch (failure) {
      const code = codeOf(failure)
      if (isEnding(code)) return onEnding(code)
      if (code === 'rate_limited') setError(rateLimitedText(failure))
      else if (code === 'weak_password') setError(t('auth.errors.weak_password'))
      else {
        report(failure)
        setError(t('invitation.errors.generic'))
      }
      return
    }
    onAccepted()
    if (session) await signOut({ reload: false })
    const signInError = await signInWithPassword(email, password)
    if (signInError) return onEnding('activated')
    navigate('/accueil', { replace: true })
  }

  return (
    <AuthCard title={t('invitation.welcome', { clinic: invitation.clinic_name })} subtitle={t('invitation.subtitle')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {otherUser !== null && (
          <p className="rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground">
            {otherUser ? t('invitation.otherUser', { name: otherUser }) : t('invitation.otherUserUnnamed')}
          </p>
        )}
        <FormField label={t('invitation.name')} readOnly>
          {(field) => <Input {...field} value={invitation.display_name} />}
        </FormField>
        <FormField label={t('invitation.email')} readOnly>
          {(field) => <Input {...field} type="email" autoComplete="username" value={invitation.email} />}
        </FormField>
        <p className="text-xs text-muted-foreground">{t('invitation.expires', { date: formatClinicDateTime(invitation.expires_at) })}</p>
        <FormField label={t('invitation.password')} required error={formState.errors.password?.message}>
          {(field) => <Input {...field} type="password" autoComplete="new-password" {...register('password')} />}
        </FormField>
        <FormField label={t('invitation.confirm')} required error={formState.errors.confirm?.message}>
          {(field) => <Input {...field} type="password" autoComplete="new-password" {...register('confirm')} />}
        </FormField>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t('invitation.submitting') : t('invitation.submit')}
        </Button>
      </form>
    </AuthCard>
  )
}
