import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { Button } from '@/shared/ui/button'
import { asPublicLanguage, usePageLanguage, type PublicLanguage } from '@/shared/lib/public-language'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { manageByLink, resolveManageLink, type ManageLinkDisplay } from '../../api/messages'

/** The page's text in the recipient's language (the message's: the moment comes written in it). */
const TEXT = (lang: PublicLanguage) => (lang === 'en' ? 'modules.appointments.manageEn' : 'modules.appointments.manage') as 'modules.appointments.manage'
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

/** The notice under the moment: late now (may be charged), or the clinic's notice; nothing without a policy. */
function NoticeLine({ d, C }: { d: ManageLinkDisplay; C: ReturnType<typeof TEXT> }) {
  if (d.late === null || d.notice_hours === null) return null
  const unit = d.business_hours ? 'Business' : 'Calendar'
  if (d.late) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        {t(`${C}.late${unit}`, { hours: String(d.notice_hours) })}
      </p>
    )
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {t(`${C}.onTime${unit}`, { hours: String(d.notice_hours) })}
    </p>
  )
}

type Step = 'choose' | 'cancel' | 'change'
type Outcome = 'cancelled' | 'cancelledLate' | 'requested' | 'error' | 'gone' | null

/**
 * `/rendez-vous/gerer#t=…` (Rendez-vous L16, AP-50): the « Annuler ou demander un changement » link
 * of a confirmation, reminder or change email, when Paramètres → Agenda turns it on. The token leaves
 * the address bar before any request (never in a log, the history or a query key); `resolve-link`
 * shows the moment, the professional, the mode and whether cancelling now is late (it may be
 * charged). « Annuler le rendez-vous » and « Demander un changement » each ask once more, then act
 * once (`appointments-manage`): the link is single-use. In the recipient's language (French or
 * English). Never indexed.
 */
export function ManageAppointmentPage() {
  useNoIndex()
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
    queryKey: ['public-appointment-manage', opening],
    queryFn: () => resolveManageLink(token ?? ''),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])
  const lang = asPublicLanguage(link.data?.language)
  const C = TEXT(lang)
  usePageTitle(t(`${C}.title`))
  usePageLanguage(lang)
  const [step, setStep] = useState<Step>('choose')
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const stepRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (step !== 'choose') stepRef.current?.focus()
  }, [step])

  const notice = (text: string, done = false) => (
    <Frame title={t(`${C}.title`)}>
      <p role={done ? 'status' : 'alert'} className="flex items-start gap-2 text-sm text-foreground">
        {done ? (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        )}
        {text}
      </p>
    </Frame>
  )
  if (outcome === 'cancelled' || outcome === 'cancelledLate' || outcome === 'requested') return notice(t(`${C}.${outcome}`), true)
  if (token === null || outcome === 'gone') return notice(t(`${C}.invalid`))
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

  const act = async (action: 'cancel' | 'change_request') => {
    if (pending) return
    setPending(true)
    try {
      const result = await manageByLink(token, action)
      setOutcome(result.state === 'requested' ? 'requested' : result.late ? 'cancelledLate' : 'cancelled')
    } catch (error) {
      report(error)
      setOutcome(error instanceof FunctionCallError && GONE.includes(error.code) ? 'gone' : 'error')
    } finally {
      setPending(false)
    }
  }
  const back = () => {
    setStep('choose')
    setOutcome(null)
  }
  return (
    <Frame title={t(`${C}.title`)}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {t(d.mode === 'phone' ? `${C}.bodyPhone` : `${C}.bodyVideo`, { clinic: d.clinic_name, when: d.when, professional: d.professional_name })}
        </p>
        <NoticeLine d={d} C={C} />
        {step !== 'choose' && (
          <p ref={stepRef} tabIndex={-1} className="text-sm font-medium text-foreground outline-none">
            {t(step === 'cancel' ? `${C}.cancelConfirm` : `${C}.changeConfirm`)}
          </p>
        )}
        {outcome === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {t(`${C}.error`)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {step === 'choose' && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('cancel')}>
                {t(`${C}.cancel`)}
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep('change')}>
                {t(`${C}.change`)}
              </Button>
            </>
          )}
          {step !== 'choose' && (
            <>
              <Button
                type="button"
                variant={step === 'cancel' ? 'destructive' : 'default'}
                onClick={() => void act(step === 'cancel' ? 'cancel' : 'change_request')}
                aria-disabled={pending || undefined}
              >
                {t(step === 'cancel' ? `${C}.cancelYes` : `${C}.changeYes`)}
              </Button>
              <Button type="button" variant="ghost" onClick={back} aria-disabled={pending || undefined}>
                {t(`${C}.back`)}
              </Button>
            </>
          )}
        </div>
      </div>
    </Frame>
  )
}
