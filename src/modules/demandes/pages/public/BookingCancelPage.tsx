import { useEffect, useLayoutEffect, useState } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { Button } from '@/shared/ui/button'
import { formatInClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { cancelCall, resolveCancelLink } from '../../api/booking'
import { PublicFrame } from './PublicFrame'

const C = 'modules.demandes.booking.cancel'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const GONE = ['link_invalid', 'link_expired', 'link_used']

/** Each opening is its own query: the key never holds the token. */
let openings = 0

function report(error: unknown) {
  const code = error instanceof FunctionCallError ? error.code : 'internal'
  if (code === 'network' || GONE.includes(code)) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : 'Error')
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'demandes', code } })
}

/**
 * `/appel-decouverte/annuler#t=…` (Demandes D3c): the confirmation email's cancel link. The token
 * leaves the address bar before any request (never in a log, the history or a query key);
 * `resolve-link` shows the call, « Annuler l'appel » cancels it once. Never indexed.
 */
export function BookingCancelPage() {
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
    queryKey: ['public-booking-cancel', opening],
    queryFn: () => resolveCancelLink(token!),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')

  const ended = (text: string) => (
    <PublicFrame title={t(`${C}.title`)}>
      <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        {text}
      </p>
    </PublicFrame>
  )
  if (state === 'done') {
    return (
      <PublicFrame title={t(`${C}.doneTitle`)}>
        <p className="flex items-start gap-2 text-sm text-foreground">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          {t(`${C}.doneBody`)}
        </p>
      </PublicFrame>
    )
  }
  if (token === null) return ended(t(`${C}.invalid`))
  if (link.isPending) {
    return (
      <PublicFrame title={t(`${C}.title`)}>
        <Loading />
      </PublicFrame>
    )
  }
  if (link.isError) return ended(link.error instanceof FunctionCallError && GONE.includes(link.error.code) ? t(`${C}.invalid`) : t(`${C}.error`))
  setClinicTimezone(link.data.timezone)
  const when = t('modules.demandes.booking.page.slotLabel', {
    day: formatInClinicTimezone(link.data.starts_at, 'EEEE d MMMM'),
    time: formatInClinicTimezone(link.data.starts_at, "H 'h' mm"),
  })

  const cancel = async () => {
    if (state === 'pending') return
    setState('pending')
    try {
      await cancelCall(token)
      setState('done')
    } catch (error) {
      report(error)
      setState('error')
    }
  }
  return (
    <PublicFrame title={t(`${C}.title`)}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">{t(`${C}.body`, { clinic: link.data.clinic_name, when })}</p>
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {t(`${C}.error`)}
          </p>
        )}
        <Button type="button" onClick={() => void cancel()} aria-disabled={state === 'pending' || undefined}>
          {state === 'pending' ? t(`${C}.cancelling`) : t(`${C}.confirm`)}
        </Button>
      </div>
    </PublicFrame>
  )
}
