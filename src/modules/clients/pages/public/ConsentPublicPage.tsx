import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import { EmbeddedSigning, type EmbeddedSigningLink } from '@/core/signing/components/EmbeddedSigning'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { SaveButton } from '@/shared/components/SaveButton'
import { retryInText } from '@/shared/lib/retry-after'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Checkbox } from '@/shared/ui/checkbox'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { openConsent, resolveConsentLink, startConsentSigning, type ConsentPage, type Identity } from '../../api/public-consent'

/** 32 random bytes, base64url without padding (`_shared/links.ts`): anything else is not a link. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const ENDINGS = ['link_invalid', 'link_expired', 'link_used'] as const
type Ending = (typeof ENDINGS)[number]

type Lang = 'fr' | 'en'
const P = (lang: Lang) => (lang === 'en' ? 'modules.clients.consents.page.en' : 'modules.clients.consents.page.fr') as 'modules.clients.consents.page.fr'

const codeOf = (error: unknown) => (error instanceof FunctionCallError ? error.code : 'internal')

/** Codes the page explains itself: never reported. */
const EXPECTED = new Set<string>(['network', 'rate_limited', 'conflict', ...ENDINGS])

/**
 * Reports a failure the page does not expect, from an effect or a handler (never during render):
 * its code only, never a name, a year, an answer or a token. A refusal is the page's own answer.
 */
function report(error: unknown) {
  const code = codeOf(error)
  if (EXPECTED.has(code) || (error instanceof FunctionCallError && refusalMessage(error) !== null)) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : error instanceof Error ? error.name : typeof error)
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'clients', code } })
}

/**
 * The French or English text of a failure (pure: reporting is the caller's): a link that ended, a
 * limit with its delay, a refusal (the server's French sentence on a French page; in English, the
 * page's own text), else the fallback.
 */
function failureText(error: unknown, lang: Lang, fallback: 'error' | 'signingError'): string {
  if (error instanceof FunctionCallError) {
    const refusal = refusalMessage(error)
    if (refusal) return lang === 'fr' ? refusal : t(`${P(lang)}.states.${fallback}`)
    if ((ENDINGS as readonly string[]).includes(error.code)) return t(`${P(lang)}.states.${error.code as Ending}`)
    if (error.code === 'rate_limited') return `${t(`${P(lang)}.states.rate_limited`)} ${retryInText(error.retryAfter)}`
  }
  return t(`${P(lang)}.states.${fallback}`)
}

/** Each opening of the page is its own query (the key never holds the token). */
let openings = 0

/**
 * `/consentement#t=…` (Clients C5a): where a consent request email lands. Public, outside
 * RequireAuth, code-split, never indexed. The token is read from the fragment once, kept in memory
 * and removed from the URL before anything is asked (it never reaches a server log or the
 * history, nor a query key). `resolve-link` names the clinic and the consent; then the client's
 * first name and birth year (the identity check; the fifth miss revokes the link), the « Oui / Non »
 * clauses (answered once, by the first person who answers), and Documenso's signing page inside this
 * one. Back from Documenso's own page: `?signe=1` (`&lang=en` for an English request), « Merci ».
 * French or English: the request's language.
 */
export function ConsentPublicPage() {
  useNoIndex()
  const { hash, search } = useLocation()
  const params = new URLSearchParams(search)
  if (params.get('signe') === '1' && !hash) return <Thanks lang={params.get('lang') === 'en' ? 'en' : 'fr'} />
  return <ConsentLink key={hash} hash={hash} />
}

function Thanks({ lang }: { lang: Lang }) {
  usePageTitle(t(`${P(lang)}.title`))
  return (
    <PublicCard title={t(`${P(lang)}.done.title`)}>
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        {t(`${P(lang)}.done.body`)}
      </p>
    </PublicCard>
  )
}

function ConsentLink({ hash }: { hash: string }) {
  const [token] = useState(() => {
    const value = new URLSearchParams(hash.slice(1)).get('t')
    return value !== null && TOKEN_SHAPE.test(value) ? value : null
  })
  // The fragment leaves the address bar before the first request (a layout effect runs first).
  useLayoutEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])
  const [opening] = useState(() => ++openings)
  const link = useQuery({
    queryKey: ['public-consent', 'resolve', opening],
    queryFn: () => resolveConsentLink(token!),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const lang: Lang = link.data?.language ?? 'fr'
  usePageTitle(t(`${P(lang)}.title`))
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])

  if (token === null) return <Ended text={t(`${P('fr')}.states.link_invalid`)} lang="fr" />
  if (link.isPending) {
    return (
      <PublicCard title={t(`${P(lang)}.title`)}>
        <Loading />
      </PublicCard>
    )
  }
  if (link.isError) return <Ended text={failureText(link.error, lang, 'error')} lang={lang} />
  return <ConsentFlow token={token} lang={lang} clinic={link.data.clinic_name} consent={link.data.consent_name} />
}

function Ended({ text, lang }: { text: string; lang: Lang }) {
  return (
    <PublicCard title={t(`${P(lang)}.title`)}>
      <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        {text}
      </p>
    </PublicCard>
  )
}

type Step =
  | { kind: 'identity' }
  | { kind: 'answers'; identity: Identity; page: ConsentPage }
  | { kind: 'signing'; identity: Identity; page: ConsentPage; link: EmbeddedSigningLink }
  | { kind: 'done' }

function ConsentFlow({ token, lang, clinic, consent }: { token: string; lang: Lang; clinic: string; consent: string }) {
  const [step, setStep] = useState<Step>({ kind: 'identity' })
  const T = P(lang)
  if (step.kind === 'done') return <Thanks lang={lang} />
  return (
    <PublicCard title={consent} wide={step.kind === 'signing'}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(`${T}.intro`, { clinic, consent })}</p>
        {step.kind === 'identity' && <IdentityForm token={token} lang={lang} onOpened={(identity, page) => setStep({ kind: 'answers', identity, page })} />}
        {step.kind === 'answers' && (
          <AnswersForm
            token={token}
            lang={lang}
            identity={step.identity}
            page={step.page}
            onStarted={(link) => setStep({ kind: 'signing', identity: step.identity, page: step.page, link })}
          />
        )}
        {step.kind === 'signing' && (
          <div className="space-y-2">
            <p className="text-sm text-foreground">{t(`${T}.signerFor`, { client: step.page.client_first_name })}</p>
            <EmbeddedSigning link={step.link} title={t(`${T}.frameTitle`)} language={lang} onCompleted={() => setStep({ kind: 'done' })} />
          </div>
        )}
      </div>
    </PublicCard>
  )
}

function IdentityForm({ token, lang, onOpened }: { token: string; lang: Lang; onOpened: (identity: Identity, page: ConsentPage) => void }) {
  const T = P(lang)
  const [firstName, setFirstName] = useState('')
  const [year, setYear] = useState('')
  const [unknownYear, setUnknownYear] = useState(false)
  const [errors, setErrors] = useState<{ firstName?: string; year?: string; server?: string }>({})
  const [pending, setPending] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const next: typeof errors = {}
    if (firstName.trim() === '') next.firstName = t(`${T}.identity.firstNameRequired`)
    if (!unknownYear) {
      if (year.trim() === '') next.year = t(`${T}.identity.birthYearRequired`)
      else if (!/^(19|20)[0-9]{2}$/.test(year.trim())) next.year = t(`${T}.identity.birthYearInvalid`)
    }
    setErrors(next)
    if (next.firstName || next.year) return
    const identity: Identity = { firstName: firstName.trim(), birthYear: unknownYear ? null : Number(year.trim()) }
    setPending(true)
    try {
      onOpened(identity, await openConsent(token, identity))
    } catch (error) {
      // The only refusal of « open » is the identity that does not match: said in the page's language.
      const mismatch = error instanceof FunctionCallError && refusalMessage(error) !== null
      if (!mismatch) report(error)
      setErrors({ server: mismatch ? t(`${T}.identity.mismatch`) : failureText(error, lang, 'error') })
    } finally {
      setPending(false)
    }
  }
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-3" aria-busy={pending || undefined}>
      <div>
        <h2 className="text-base font-semibold text-foreground">{t(`${T}.identity.title`)}</h2>
        <p className="text-sm text-muted-foreground">{t(`${T}.identity.help`)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(`${T}.identity.attempts`)}</p>
      </div>
      <FormField label={t(`${T}.identity.firstName`)} required error={errors.firstName}>
        {(field) => <Input {...field} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" autoFocus />}
      </FormField>
      <FormField label={t(`${T}.identity.birthYear`)} required={!unknownYear} help={t(`${T}.identity.birthYearHelp`)} error={errors.year}>
        {(field) => (
          <Input
            {...field}
            value={unknownYear ? '' : year}
            onChange={(e) => setYear(e.target.value)}
            readOnly={unknownYear}
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            className="tabular w-28"
          />
        )}
      </FormField>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={unknownYear}
          onCheckedChange={(checked) => {
            setUnknownYear(checked === true)
            setErrors((e) => ({ ...e, year: undefined }))
          }}
        />
        {t(`${T}.identity.birthYearUnknown`)}
      </label>
      {errors.server && <ServerAlert text={errors.server} />}
      <SaveButton pending={pending} label={t(`${T}.identity.submit`)} pendingLabel={t(`${T}.identity.checking`)} />
    </form>
  )
}

function ServerAlert({ text }: { text: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{text}</AlertDescription>
    </Alert>
  )
}

function AnswersForm({
  token,
  lang,
  identity,
  page,
  onStarted,
}: {
  token: string
  lang: Lang
  identity: Identity
  page: ConsentPage
  onStarted: (link: EmbeddedSigningLink) => void
}) {
  const T = P(lang)
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no'>>(page.answers ?? {})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // One key per page: a double click or a retry answers the same signature request.
  const key = useRef(crypto.randomUUID().replaceAll('-', ''))
  const textOf = (c: ConsentPage['clauses'][number]) => (lang === 'en' ? c.text_en : c.text_fr)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    if (page.can_answer) {
      if (page.clauses.some((c) => !answers[c.key])) return setError(t(`${T}.clauses.missing`))
      if (page.clauses.some((c) => c.kind === 'agree' && answers[c.key] !== 'yes')) return setError(t(`${T}.clauses.mustAgree`))
    }
    setError(null)
    setPending(true)
    try {
      onStarted(await startConsentSigning(token, identity, page.can_answer ? answers : null, key.current))
    } catch (e) {
      report(e)
      setError(failureText(e, lang, 'signingError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4" aria-busy={pending || undefined}>
      {page.clauses.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-base font-semibold text-foreground">{t(`${T}.clauses.title`)}</legend>
          <p className="text-sm text-muted-foreground">{page.can_answer ? t(`${T}.clauses.help`) : t(`${T}.clauses.answeredBy`)}</p>
          {page.clauses.map((clause) => (
            <div key={clause.key} role="radiogroup" aria-labelledby={`clause-${clause.key}`} className="space-y-1.5 rounded-md border border-border p-3">
              <p id={`clause-${clause.key}`} className="text-sm text-foreground">
                {textOf(clause)}
                {clause.kind === 'agree' && <span className="ml-1.5 text-xs font-medium text-muted-foreground">({t(`${T}.clauses.required`)})</span>}
              </p>
              <div className="flex gap-4">
                {(['yes', 'no'] as const).map((value) => (
                  <label key={value} className={cn('inline-flex items-center gap-1.5 text-sm', !page.can_answer && 'text-muted-foreground')}>
                    <input
                      type="radio"
                      name={`clause-${clause.key}`}
                      value={value}
                      checked={answers[clause.key] === value}
                      disabled={!page.can_answer}
                      onChange={() => setAnswers((a) => ({ ...a, [clause.key]: value }))}
                      className="size-4 accent-primary"
                    />
                    {t(`${T}.clauses.${value}`)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}
      {error && <ServerAlert text={error} />}
      <SaveButton pending={pending} label={t(`${T}.sign`)} pendingLabel={t(`${T}.preparing`)} />
    </form>
  )
}

/**
 * The page's frame: the clinic's logo and the title, on the auth pages' surface, wider (a consent
 * is read) and wider still while Documenso's page is inside.
 */
function PublicCard({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className={cn('h-fit w-full rounded-lg border border-border bg-card p-6 sm:p-7', wide ? 'max-w-4xl' : 'max-w-xl')}>
        <img src={logoUrl} alt={t('app.name')} width={99} height={44} className="mb-5 block h-11 w-auto" />
        <h1 tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          {title}
        </h1>
        <div className="mt-5">{children}</div>
      </div>
    </main>
  )
}
