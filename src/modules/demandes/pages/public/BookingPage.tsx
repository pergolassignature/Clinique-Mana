import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { SaveButton } from '@/shared/components/SaveButton'
import { retryInText } from '@/shared/lib/retry-after'
import { formatInClinicTimezone, getClinicDateString, setClinicTimezone } from '@/shared/lib/timezone'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { bookCall, fetchBookingPage, type BookingPage as Page } from '../../api/booking'
import { captureSource, solveCheck, toE164 } from '../../lib/booking'
import { PublicFrame } from './PublicFrame'

const P = 'modules.demandes.booking.page'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Days shown before « Voir d'autres jours ». */
const FIRST_DAYS = 7

const codeOf = (error: unknown) => (error instanceof FunctionCallError ? error.code : 'internal')

/** Reports what the page does not expect: its code only (never a name, an address, a phone or a source). */
function report(error: unknown) {
  const code = codeOf(error)
  if (['network', 'rate_limited', 'conflict'].includes(code) || (error instanceof FunctionCallError && refusalMessage(error))) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : error instanceof Error ? error.name : typeof error)
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'demandes', code } })
}

/**
 * `/appel-decouverte?clinique=<org>` (Demandes D3c, R-74): the public discovery-call booking page
 * that replaces Calendly. One screen, no account: choose a moment among the clinic's free slots
 * (its time zone), give a name, an email and a phone, the language, « Comment avez-vous entendu
 * parler de MANA ? » and, optionally, a few words. The page captures the source (utm_*, the
 * referrer, the landing page), solves the function's proof-of-work check (D-7), books, and says
 * when the counselor will call. Never indexed.
 */
export function BookingPage() {
  useNoIndex()
  usePageTitle(t(`${P}.title`))
  const { search } = useLocation()
  const org = new URLSearchParams(search).get('clinique') ?? ''
  const valid = UUID.test(org)
  const page = useQuery({
    queryKey: ['public-booking', org],
    queryFn: ({ signal }) => fetchBookingPage(org, signal),
    enabled: valid,
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  })
  useEffect(() => {
    if (page.error) report(page.error)
  }, [page.error])
  const [done, setDone] = useState<{ when: string; emailed: boolean } | null>(null)

  if (done) {
    return (
      <PublicFrame title={t(`${P}.doneTitle`)}>
        <p className="flex items-start gap-2 text-sm text-foreground">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          {t(done.emailed ? `${P}.doneBody` : `${P}.doneNoEmail`, { when: done.when })}
        </p>
      </PublicFrame>
    )
  }
  if (valid && page.isPending) {
    return (
      <PublicFrame title={t(`${P}.title`)}>
        <Loading />
      </PublicFrame>
    )
  }
  if (!valid || page.isError || !page.data?.open) {
    const text = page.isError ? t(`${P}.loadError`) : t(`${P}.closed`)
    return (
      <PublicFrame title={t(`${P}.title`)}>
        <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
          {text}
        </p>
      </PublicFrame>
    )
  }
  return <BookingForm org={org} page={page.data} onBooked={setDone} />
}

function BookingForm({ org, page, onBooked }: { org: string; page: Extract<Page, { open: true }>; onBooked: (done: { when: string; emailed: boolean }) => void }) {
  const queryClient = useQueryClient()
  // The page's clinic: its slots are shown, and said, in its time zone.
  setClinicTimezone(page.timezone)
  const source = useRef(captureSource(window.location.href, document.referrer))
  const [slot, setSlot] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [allDays, setAllDays] = useState(false)
  const [values, setValues] = useState({ firstName: '', lastName: '', email: '', phone: '', language: 'fr' as 'fr' | 'en', heard: '', message: '' })
  const [errors, setErrors] = useState<Partial<Record<'slot' | 'firstName' | 'lastName' | 'email' | 'phone' | 'server', string>>>({})
  const [step, setStep] = useState<'idle' | 'checking' | 'booking'>('idle')
  const set = (key: keyof typeof values) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  const days = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const s of page.slots) {
      const day = getClinicDateString(s)
      if (!groups.has(day)) groups.set(day, [])
      groups.get(day)!.push(s)
    }
    return [...groups]
  }, [page.slots])
  const shown = allDays ? days : days.slice(0, FIRST_DAYS)
  // The day chosen (the first with free slots by default), then its times: one screen, as Calendly.
  const current = days.find(([d]) => d === day) ?? days[0]
  const when = (s: string) => t(`${P}.slotLabel`, { day: formatInClinicTimezone(s, 'EEEE d MMMM'), time: formatInClinicTimezone(s, "H 'h' mm") })

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (step !== 'idle') return
    const next: typeof errors = {}
    if (!slot) next.slot = t(`${P}.chooseSlotFirst`)
    if (!values.firstName.trim()) next.firstName = t(`${P}.required`)
    if (!values.lastName.trim()) next.lastName = t(`${P}.required`)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) next.email = t(`${P}.invalidEmail`)
    const phone = toE164(values.phone)
    if (!phone) next.phone = t(`${P}.invalidPhone`)
    setErrors(next)
    if (Object.keys(next).length > 0 || !slot || !phone) return
    try {
      setStep('checking')
      const nonce = await solveCheck(page.check.ticket, page.check.bits)
      setStep('booking')
      const booked = await bookCall({
        org,
        ticket: page.check.ticket,
        nonce,
        startsAt: slot,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
        phoneE164: phone,
        language: values.language,
        message: values.message.trim() || null,
        referralSourceId: values.heard || null,
        source: source.current,
      })
      onBooked({ when: when(booked.starts_at), emailed: booked.emailed })
    } catch (error) {
      report(error)
      let text = t(`${P}.error`)
      if (error instanceof FunctionCallError) {
        text = refusalMessage(error) ?? (error.code === 'rate_limited' ? `${t(`${P}.tooMany`)} ${retryInText(error.retryAfter)}` : text)
      }
      setErrors({ server: text })
      // A check is used once and the slots may have moved: a fresh page (new slots, new check).
      setSlot(null)
      void queryClient.invalidateQueries({ queryKey: ['public-booking', org] })
    } finally {
      setStep('idle')
    }
  }

  return (
    <PublicFrame title={t(`${P}.title`)}>
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-6" aria-busy={step !== 'idle' || undefined}>
        <p className="text-sm text-muted-foreground">{t(`${P}.intro`, { clinic: page.clinic_name, minutes: String(page.slot_minutes) })}</p>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-foreground">{t(`${P}.chooseSlot`)}</legend>
          <p className="text-xs text-muted-foreground">{t(`${P}.slotsHelp`, { timezone: formatInClinicTimezone(new Date(), 'zzzz') })}</p>
          {days.length === 0 && <p className="text-sm text-foreground">{t(`${P}.noSlot`)}</p>}
          {days.length > 0 && (
            <div role="group" aria-label={t(`${P}.chooseDay`)} className="flex flex-wrap gap-2">
              {shown.map(([d, slots]) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={current?.[0] === d}
                  onClick={() => {
                    setDay(d)
                    setSlot(null)
                  }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-left text-sm first-letter:uppercase',
                    current?.[0] === d ? 'border-primary bg-primary-soft text-foreground' : 'border-border bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {formatInClinicTimezone(slots[0]!, 'EEE d MMM')}
                </button>
              ))}
              {!allDays && days.length > FIRST_DAYS && (
                <button type="button" className="text-sm text-link underline-offset-[3px] hover:underline" onClick={() => setAllDays(true)}>
                  {t(`${P}.more`)}
                </button>
              )}
            </div>
          )}
          {current && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground first-letter:uppercase">{formatInClinicTimezone(current[1][0]!, 'EEEE d MMMM')}</p>
              <div className="flex flex-wrap gap-2">
                {current[1].map((s) => (
                  <label
                    key={s}
                    className={cn(
                      'tabular inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      slot === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted',
                    )}
                  >
                    <input type="radio" name="slot" value={s} checked={slot === s} onChange={() => setSlot(s)} className="sr-only" aria-label={when(s)} />
                    {formatInClinicTimezone(s, "H 'h' mm")}
                  </label>
                ))}
              </div>
            </div>
          )}
          {errors.slot && (
            <p role="alert" className="text-sm text-destructive">
              {errors.slot}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-foreground">{t(`${P}.you`)}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t(`${P}.firstName`)} required error={errors.firstName}>
              {(field) => <Input {...field} value={values.firstName} onChange={(e) => set('firstName')(e.target.value)} autoComplete="given-name" maxLength={100} />}
            </FormField>
            <FormField label={t(`${P}.lastName`)} required error={errors.lastName}>
              {(field) => <Input {...field} value={values.lastName} onChange={(e) => set('lastName')(e.target.value)} autoComplete="family-name" maxLength={100} />}
            </FormField>
          </div>
          <FormField label={t(`${P}.email`)} required help={t(`${P}.emailHelp`)} error={errors.email}>
            {(field) => <Input {...field} type="email" value={values.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" maxLength={254} />}
          </FormField>
          <FormField label={t(`${P}.phone`)} required help={t(`${P}.phoneHelp`)} error={errors.phone}>
            {(field) => <Input {...field} type="tel" value={values.phone} onChange={(e) => set('phone')(e.target.value)} autoComplete="tel" maxLength={20} className="w-48" />}
          </FormField>
          <FormField label={t(`${P}.language`)}>
            {(field) => (
              <div className="w-48">
                <Select {...field} value={values.language} onChange={(e) => set('language')(e.target.value)}>
                  <option value="fr">{t(`${P}.french`)}</option>
                  <option value="en">{t(`${P}.english`)}</option>
                </Select>
              </div>
            )}
          </FormField>
          {page.referral_sources.length > 0 && (
            <FormField label={t(`${P}.heard`)}>
              {(field) => (
                <Select {...field} value={values.heard} onChange={(e) => set('heard')(e.target.value)}>
                  <option value="">{t(`${P}.heardNone`)}</option>
                  {page.referral_sources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          <FormField label={t(`${P}.message`)} help={t(`${P}.messageHelp`)}>
            {(field) => <Textarea {...field} value={values.message} onChange={(e) => set('message')(e.target.value)} rows={3} maxLength={1000} />}
          </FormField>
        </fieldset>

        {errors.server && (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden />
            <AlertDescription className="text-foreground">{errors.server}</AlertDescription>
          </Alert>
        )}
        <SaveButton pending={step !== 'idle'} label={t(`${P}.submit`)} pendingLabel={t(step === 'checking' ? `${P}.checking` : `${P}.booking`)} />
      </form>
    </PublicFrame>
  )
}
