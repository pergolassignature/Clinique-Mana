import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { Button } from '@/shared/ui/button'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { confirmByLink, resolveConfirmLink } from '../../api/messages'

const C = 'modules.appointments.confirm'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const GONE = ['link_invalid', 'link_expired', 'link_used']

/** Each opening is its own query: the key never holds the token. */
let openings = 0

function report(error: unknown) {
  const code = error instanceof FunctionCallError ? error.code : 'internal'
  if (code === 'network' || GONE.includes(code)) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : 'Error')
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'appointments', code } })
}

/** The public page's frame: the clinic's logo and the title, on the auth pages' surface. */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="h-fit w-full max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-7">
        <img src={logoUrl} alt={t('app.name')} width={99} height={44} className="mb-5 block h-11 w-auto" />
        <h1 tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          {title}
        </h1>
        <div className="mt-5">{children}</div>
      </div>
    </main>
  )
}

/**
 * `/rendez-vous/confirmer#t=…` (Rendez-vous R4, R-39): the link of a confirmation, reminder or
 * change email. The token leaves the address bar before any request (never in a log, the history
 * or a query key); `resolve-link` shows the moment, the professional and the mode; « Confirmer ma
 * présence » confirms once (`appointments-confirm`). To cancel or change, the client calls the
 * clinic (R-39: no cancellation link). Never indexed.
 */
export function ConfirmAppointmentPage() {
  useNoIndex()
  usePageTitle(t(`${C}.title`))
  const { hash } = useLocation()
  const [token] = useState(() => {
    const value = new URLSearchParams(hash.slice(1)).get('t')
    return value !== null && TOKEN_SHAPE.test(value) ? value : null
  })
  useLayoutEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])
  const [opening] = useState(() => ++openings)
  const link = useQuery({
    queryKey: ['public-appointment-confirm', opening],
    queryFn: () => resolveConfirmLink(token ?? ''),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])
  const [state, setState] = useState<'idle' | 'pending' | 'confirmed' | 'error' | 'gone'>('idle')

  const notice = (text: string, done = false) => (
    <Frame title={t(`${C}.title`)}>
      <p role={done ? undefined : 'alert'} className="flex items-start gap-2 text-sm text-foreground">
        {done ? (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        )}
        {text}
      </p>
    </Frame>
  )
  if (state === 'confirmed') return notice(t(`${C}.done`), true)
  if (token === null || state === 'gone') return notice(t(`${C}.invalid`))
  if (link.isPending) {
    return (
      <Frame title={t(`${C}.title`)}>
        <Loading />
      </Frame>
    )
  }
  if (link.isError) {
    return notice(link.error instanceof FunctionCallError && GONE.includes(link.error.code) ? t(`${C}.invalid`) : t(`${C}.error`))
  }
  const d = link.data
  if (d.confirmed) return notice(t(`${C}.already`), true)

  const confirm = async () => {
    if (state === 'pending') return
    setState('pending')
    try {
      await confirmByLink(token)
      setState('confirmed')
    } catch (error) {
      report(error)
      setState(error instanceof FunctionCallError && GONE.includes(error.code) ? 'gone' : 'error')
    }
  }
  return (
    <Frame title={t(`${C}.title`)}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {t(d.mode === 'phone' ? `${C}.bodyPhone` : `${C}.bodyVideo`, { clinic: d.clinic_name, when: d.when, professional: d.professional_name })}
        </p>
        <p className="text-sm text-muted-foreground">{t(`${C}.call`)}</p>
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {t(`${C}.error`)}
          </p>
        )}
        <Button type="button" onClick={() => void confirm()} aria-disabled={state === 'pending' || undefined}>
          {t(`${C}.button`)}
        </Button>
      </div>
    </Frame>
  )
}
