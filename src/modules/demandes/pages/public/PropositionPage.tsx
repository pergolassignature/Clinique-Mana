import { useEffect, useLayoutEffect, useState } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { formatInClinicTimezone, setClinicTimezone } from '@/shared/lib/timezone'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import { answerProposition, DECLINE_REASONS, resolvePropositionLink, type DeclineReason } from '../../api/propositions'
import { PublicFrame } from './PublicFrame'

const A = 'modules.demandes.propositions.page'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const GONE = ['link_invalid', 'link_expired', 'link_used']
/** R1b's HINTs, in plain words (D-23). */
const REASONS = ['hold_gone', 'hold_expired', 'overlap', 'outside_availability', 'balance_due', 'starts_at'] as const

/** Each opening is its own query: the key never holds the token. */
let openings = 0

function report(error: unknown) {
  const code = error instanceof FunctionCallError ? error.code : 'internal'
  if (code === 'network' || GONE.includes(code)) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : 'Error')
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'demandes', code } })
}

const when = (iso: string) =>
  t(`${A}.when`, { day: formatInClinicTimezone(iso, 'EEEE d MMMM'), time: formatInClinicTimezone(iso, "H 'h' mm") })

/**
 * `/proposition#t=…` (Demandes D3b, D-22): the proposal's link. The token leaves the address bar
 * before any request (never in a log, the history or a query key); `resolve-link` shows the clinic,
 * the professional, the service, the mode and the slots held for the person; « Choisir cette
 * plage » books it once (Rendez-vous checks every rule again: a slot no longer possible says why
 * and the others stay); « Aucune ne me convient » declines, with an optional reason. Never indexed.
 */
export function PropositionPage() {
  useNoIndex()
  usePageTitle(t(`${A}.title`))
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
    queryKey: ['public-proposition', opening],
    queryFn: () => resolvePropositionLink(token!),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])
  const [choice, setChoice] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState<DeclineReason | ''>('')
  const [state, setState] = useState<'idle' | 'pending' | 'error' | 'gone'>('idle')
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [done, setDone] = useState<{ kind: 'accepted'; startsAt: string | null } | { kind: 'declined' } | null>(null)

  const notice = (title: string, text: string, ok = false) => (
    <PublicFrame title={title}>
      <p role={ok ? undefined : 'alert'} className="flex items-start gap-2 text-sm text-foreground">
        {ok ? (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        )}
        {text}
      </p>
    </PublicFrame>
  )
  if (done?.kind === 'accepted') {
    return notice(t(`${A}.acceptedTitle`), done.startsAt ? t(`${A}.acceptedBody`, { when: when(done.startsAt) }) : t(`${A}.acceptedPlain`), true)
  }
  if (done?.kind === 'declined') return notice(t(`${A}.declinedTitle`), t(`${A}.declinedBody`), true)
  if (token === null || state === 'gone') return notice(t(`${A}.title`), t(`${A}.invalid`))
  if (link.isPending) {
    return (
      <PublicFrame title={t(`${A}.title`)}>
        <Loading />
      </PublicFrame>
    )
  }
  if (link.isError) {
    return notice(t(`${A}.title`), link.error instanceof FunctionCallError && GONE.includes(link.error.code) ? t(`${A}.invalid`) : t(`${A}.error`))
  }
  const p = link.data
  setClinicTimezone(p.timezone)
  const slots = p.slots

  const send = async (body: { appointmentId: string } | { decline: DeclineReason | null }) => {
    if (state === 'pending') return
    setState('pending')
    setUnavailable(null)
    try {
      const answer = await answerProposition(token, body)
      if (answer.state === 'accepted') setDone({ kind: 'accepted', startsAt: answer.starts_at ?? null })
      else if (answer.state === 'declined') setDone({ kind: 'declined' })
      else {
        const known = (REASONS as readonly string[]).includes(answer.reason ?? '') ? (answer.reason as (typeof REASONS)[number]) : null
        setUnavailable(known ? t(`${A}.unavailable.${known}`) : t(`${A}.unavailable.other`))
        setChoice(null)
        setState('idle')
        void link.refetch()
        return
      }
      setState('idle')
    } catch (error) {
      report(error)
      setState(error instanceof FunctionCallError && GONE.includes(error.code) ? 'gone' : 'error')
    }
  }

  return (
    <PublicFrame title={t(`${A}.title`)}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {t(`${A}.body`, {
            clinic: p.clinic_name,
            professional: [p.professional_name, p.professional_title].filter(Boolean).join(', '),
            service: p.service_name ?? '',
            mode: p.mode === 'phone' ? t(`${A}.byPhone`) : t(`${A}.byVideo`),
          })}
        </p>
        <p className="text-sm text-muted-foreground">{t(`${A}.heldUntil`, { when: when(p.expires_at) })}</p>
        {unavailable && (
          <p role="alert" className="text-sm text-foreground">
            {unavailable}
          </p>
        )}
        {slots.length === 0 ? (
          <p className="text-sm text-foreground">{t(`${A}.noSlotLeft`)}</p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{t(`${A}.choose`)}</legend>
            {slots.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <input type="radio" name="slot" value={s.id} checked={choice === s.id} onChange={() => setChoice(s.id)} className="size-4" />
                <span className="first-letter:uppercase">{when(s.starts_at)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {t(`${A}.error`)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {slots.length > 0 && (
            <Button type="button" aria-disabled={!choice || state === 'pending' || undefined} onClick={() => choice && void send({ appointmentId: choice })}>
              {state === 'pending' ? t(`${A}.sending`) : t(`${A}.accept`)}
            </Button>
          )}
          {!declining && (
            <Button type="button" variant="outline" onClick={() => setDeclining(true)}>
              {t(`${A}.none`)}
            </Button>
          )}
        </div>
        {declining && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <label htmlFor="proposition-reason" className="text-sm font-medium text-foreground">
              {t(`${A}.reasonLabel`)}
            </label>
            <Select id="proposition-reason" value={reason} onChange={(e) => setReason(e.target.value as DeclineReason | '')}>
              <option value="">{t(`${A}.reasonNone`)}</option>
              {DECLINE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`modules.demandes.propositions.reasons.${r}`)}
                </option>
              ))}
            </Select>
            <Button type="button" variant="outline" aria-disabled={state === 'pending' || undefined} onClick={() => void send({ decline: reason || null })}>
              {t(`${A}.declineConfirm`)}
            </Button>
          </div>
        )}
      </div>
    </PublicFrame>
  )
}
