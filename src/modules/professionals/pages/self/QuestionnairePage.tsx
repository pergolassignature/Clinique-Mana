import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleAlert, CircleCheck, MessageSquareText } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { UnsavedChangesContext, useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { formatClinicDateFull } from '@/shared/lib/timezone'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import type { MySubmission } from '../../api/self'
import { AutosaveStatus } from '../../components/questionnaire/AutosaveStatus'
import { AvailabilityStep } from '../../components/questionnaire/AvailabilityStep'
import { ConsentStep } from '../../components/questionnaire/ConsentStep'
import { DraftActionContext } from '../../components/questionnaire/draft-action'
import { InsuranceStep, PhotoStep } from '../../components/questionnaire/FileSteps'
import { PersonalStep } from '../../components/questionnaire/PersonalStep'
import { PortraitStep } from '../../components/questionnaire/PortraitStep'
import { ProfessionalStep } from '../../components/questionnaire/ProfessionalStep'
import { QuestionnaireNav } from '../../components/questionnaire/QuestionnaireNav'
import { ReviewStep, SubmissionSections } from '../../components/questionnaire/ReviewStep'
import { ClientelesStep, LanguagesStep, MotifsStep } from '../../components/questionnaire/SetSteps'
import { TaxBankStep } from '../../components/questionnaire/TaxBankStep'
import type { OnFilePrivate, StepContext } from '../../components/questionnaire/use-step-form'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { useMyProfessionalPrivate, useMySubmission, useQuestionnaireAutosave } from '../../hooks/use-my-submission'
import type { CatalogView } from '../../lib/catalog-view'
import { MY_PROFILE_PATH } from '../../lib/my-profile'
import {
  effectiveSection,
  incompleteSections,
  sectionsToConfirm,
  STEP_SLUGS,
  SUBMISSION_SECTIONS,
  stepFromSlug,
  stepsFor,
  type QuestionnaireStep,
  type SubmissionSection,
} from '../../lib/questionnaire'

const Q = 'modules.professionals.questionnaire'
const STEP_PARAM = 'etape'

/**
 * « Compléter mon profil » / « Mettre mon profil à jour » (`/mon-profil/questionnaire`,
 * `professionals.self`, 4b.4): where a newly accepted professional lands (P4-266) and where an
 * update request leads. One request for the submission and the cached catalogue, in the same tick.
 * Three states (A3.2): nothing to complete; sent (read-only, « Profil envoyé le … »); a draft (the
 * steps, the clinic's note on top when it sent the profile back, P4-170).
 */
export function QuestionnairePage() {
  const submission = useMySubmission()
  const catalog = useProfessionalsCatalog()
  // Why the questionnaire disappeared while open (closed by the clinic): said on « Rien à compléter ».
  const [closed, setClosed] = useState<string | null>(null)
  const data = submission.data
  usePageTitle(
    data?.status === 'submitted' ? t(`${Q}.states.submitted.pageTitle`) : data?.kind === 'update' ? t(`${Q}.title.update`) : t(`${Q}.title.onboarding`),
  )

  if (submission.isPending) return <Loading />
  // A failed background refetch keeps what is shown (and the steps' edits): only a first load fails the page.
  if (submission.isError && data === undefined) {
    return (
      <LoadError
        message={moduleErrorMessage(submission.error, t(`${Q}.states.loadError`))}
        retrying={submission.isFetching}
        onRetry={() => void submission.refetch()}
      />
    )
  }
  if (!data) return <NothingToComplete closed={closed} />
  if (catalog.isPending) return <Loading />
  if (catalog.isError && !catalog.data) {
    return (
      <LoadError
        message={moduleErrorMessage(catalog.error, t(`${Q}.states.loadError`))}
        retrying={catalog.isFetching}
        onRetry={() => void catalog.refetch()}
      />
    )
  }
  const view = catalog.data as CatalogView
  if (data.status === 'submitted') return <SentProfile submission={data} catalog={view} />
  // A new submission (another invitation, an update) starts a fresh questionnaire.
  return <Questionnaire key={data.id} submission={data} catalog={view} onClosed={setClosed} />
}

function NothingToComplete({ closed }: { closed: string | null }) {
  return (
    <div className="w-full max-w-form space-y-2">
      <PageHeader level={1} title={t(`${Q}.states.none.pageTitle`)} />
      {closed && (
        <Alert variant="warning" role="status">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{closed}</AlertDescription>
        </Alert>
      )}
      <EmptyState
        title={t(`${Q}.states.none.title`)}
        body={t(`${Q}.states.none.body`)}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={MY_PROFILE_PATH}>{t(`${Q}.states.none.myProfile`)}</Link>
          </Button>
        }
      />
    </div>
  )
}

/**
 * The private data on file, read only when the private step is requested (else null). A failed read
 * is said where the masks would be (« Impossible d'afficher les renseignements déjà fournis »), with
 * « Réessayer », never hidden.
 */
function useOnFilePrivate(submission: MySubmission): OnFilePrivate & { loading: boolean } {
  const requested = submission.requestedSections.includes('tax_bank')
  const query = useMyProfessionalPrivate(requested)
  return {
    data: query.data ?? null,
    loading: requested && query.isPending && query.fetchStatus !== 'idle',
    failed: requested && query.isError && !query.data,
    retry: () => void query.refetch(),
    retrying: query.isFetching,
  }
}

/** « Profil envoyé le … »: the thanks, and the answers as sent (read-only). */
function SentProfile({ submission, catalog }: { submission: MySubmission; catalog: CatalogView }) {
  const onFile = useOnFilePrivate(submission)
  return (
    <div className="w-full max-w-form space-y-5">
      <PageHeader
        level={1}
        title={t(`${Q}.states.submitted.pageTitle`)}
        description={submission.submittedAt ? t(`${Q}.states.submitted.sentOn`, { date: formatClinicDateFull(submission.submittedAt) }) : undefined}
      />
      <Alert variant="success" role="status">
        <CircleCheck aria-hidden />
        <AlertDescription className="text-foreground">{t(`${Q}.states.submitted.thanks`)}</AlertDescription>
      </Alert>
      <section aria-labelledby="questionnaire-sent" className="space-y-2">
        <h2 id="questionnaire-sent" className="text-base font-semibold text-foreground">
          {t(`${Q}.states.submitted.summary`)}
        </h2>
        <SubmissionSections
          submission={submission}
          catalog={catalog}
          valuesOf={(section) => effectiveSection(submission.prefill, submission.values, section)}
          sections={submission.requestedSections}
          onFile={onFile}
        />
      </section>
      <Button asChild variant="outline" size="sm">
        <Link to={MY_PROFILE_PATH}>{t(`${Q}.states.none.myProfile`)}</Link>
      </Button>
    </div>
  )
}

/**
 * The questionnaire's widths, the same on every step. Below `lg`: one column of the form's width
 * (`max-w-form`), the steps folded above the step. From `lg`: the steps in a 15rem column (« Renseignements
 * personnels » on one line), 2rem apart from the form column (`--form-max` at most, narrower only when
 * the window is), and the header and the alerts above as wide as both. Every width is fixed, none
 * follows the step's content: `w-full` keeps the page from shrinking to it.
 */
const QUESTIONNAIRE_LAYOUT = {
  page: 'w-full max-w-form space-y-5 lg:max-w-[calc(15rem+2rem+var(--form-max))]',
  columns: 'grid gap-5 lg:grid-cols-[15rem_minmax(0,var(--form-max))] lg:gap-8',
} as const

/** The steps saved only on « Continuer »: leaving them with typed values asks first (P4-332). */
const GUARDED: ReadonlySet<QuestionnaireStep> = new Set(['tax_bank', 'consent'])

/**
 * The steps: the list (left from `lg`, folded above the step below it), the current step with its title,
 * « Étape 3 sur 12 » and the autosave's state, its form and « Retour » / « Continuer ». The step is
 * in the URL (`?etape=`), so the browser's back button and a reload keep it; without one the
 * questionnaire opens on the first step to complete. Pending autosaves are sent when the page is
 * hidden (a phone switching apps) or left (`pagehide`); a failed save keeps the leave guard armed.
 * A change refused (whatever sent it) is named on top, with a link to its step, until it is fixed.
 *
 * One layout for every step (`QUESTIONNAIRE_LAYOUT`): the page is left-aligned in the shell's content
 * column like every signed-in page, never centred, and its columns have fixed widths, so the
 * header, the list and the form column never move nor resize from one step to the next.
 */
function Questionnaire({ submission, catalog, onClosed }: { submission: MySubmission; catalog: CatalogView; onClosed: (reason: string) => void }) {
  const autosave = useQuestionnaireAutosave(submission, {
    // The questionnaire was closed under the page: « Rien à compléter » says why once reloaded.
    onPageRefusal: (hint) => {
      if (hint === 'submission') onClosed(t(`${Q}.states.none.closed`))
    },
  })
  const today = useClinicDate()
  const onFile = useOnFilePrivate(submission)
  const [params, setParams] = useSearchParams()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const steps = useMemo(() => stepsFor(submission.requestedSections), [submission.requestedSections])
  const completeness = {
    answered: autosave.answered,
    privateRow: submission.private,
    onFilePrivate: onFile.data,
    onFile: submission.onFile,
    collectSin: submission.collectSin,
    consentId: submission.consent?.id ?? null,
    today,
  }
  const incomplete = incompleteSections(submission.requestedSections, completeness)
  const toConfirm = sectionsToConfirm(submission.requestedSections, submission.prefill, completeness)
  // Without a step in the URL: the first one to complete, chosen once (it must not jump as steps complete).
  const [landing] = useState<QuestionnaireStep>(() => incomplete[0] ?? 'review')
  const urlStep = stepFromSlug(params.get(STEP_PARAM), steps) ?? landing
  // The step shown follows the URL, except when the browser's back or forward button leaves a step
  // saved on « Continuer » with typed values: the URL is put back, and leaving asks first.
  const [step, setStep] = useState<QuestionnaireStep>(urlStep)
  const navigating = useRef(false)
  const index = steps.indexOf(step)
  const { flushAll, retry } = autosave
  // « Enregistrer le brouillon »: one function for the page's life, so the steps' actions do not
  // re-render after every save.
  const draftAction = useCallback(() => void flushAll(), [flushAll])
  const confirmLeave = useConfirmLeave()
  const isDirty = useContext(UnsavedChangesContext)?.isDirty
  useUnsavedChanges(autosave.state.failed)
  // An edit not sent yet (its 2.5 s delay, or a save in flight): closing or reloading the tab asks
  // first, since the pagehide flush is best effort. In-app links need no question: the pending save
  // still goes once the page is left.
  const unsent = autosave.state.scheduled || autosave.state.saving
  useEffect(() => {
    if (!unsent) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsent])

  const goTo = (next: QuestionnaireStep) => {
    if (next === step) return
    navigating.current = true
    setParams((prev) => {
      const out = new URLSearchParams(prev)
      out.set(STEP_PARAM, STEP_SLUGS[next])
      return out
    })
  }
  // The autosaved steps keep their edits when left (memory, then the server); the private step and
  // the consent hold typed values only until « Continuer »: leaving them asks first.
  const leaveTo = (next: QuestionnaireStep) => (GUARDED.has(step) ? confirmLeave(() => goTo(next)) : goTo(next))

  useEffect(() => {
    if (urlStep === step) return
    const ours = navigating.current
    navigating.current = false
    if (ours || !GUARDED.has(step) || !isDirty?.()) {
      setStep(urlStep)
      return
    }
    // The browser's back or forward button: stay on the step (its URL pushed again, so the entry the
    // browser went to stays behind it), then ask; « Quitter » goes there.
    setParams((prev) => {
      const out = new URLSearchParams(prev)
      out.set(STEP_PARAM, STEP_SLUGS[step])
      return out
    })
    confirmLeave(() => goTo(urlStep))
    // Only a change of the URL's step is handled here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStep])

  // A new step: back to its top, focus on its title (keyboard and screen reader users start there).
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 })
    headingRef.current?.focus({ preventScroll: true })
  }, [step])

  // A phone switching apps, a tab hidden, closed or left for another site: what is pending goes now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAll()
    }
    const onPageHide = () => void flushAll()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flushAll])

  const ctx: StepContext = {
    submission,
    autosave,
    catalog,
    today,
    onFile,
    next: () => {
      const next = steps[index + 1]
      if (next) goTo(next)
    },
    back: index > 0 ? () => leaveTo(steps[index - 1] as QuestionnaireStep) : null,
  }
  const requested = submission.requestedSections
  const kind = submission.kind
  const refused = SUBMISSION_SECTIONS.filter((section) => autosave.state.refused[section] !== undefined)
  const savesOnContinue = GUARDED.has(step)

  return (
    <div className={QUESTIONNAIRE_LAYOUT.page}>
      <PageHeader
        level={1}
        fullWidthDescription
        title={t(`${Q}.title.${kind}`)}
        description={
          kind === 'onboarding'
            ? t(`${Q}.intro.onboarding`)
            : // Who asked (P4-375): « La clinique vous demande de revoir … », or « Vous avez choisi de revoir … ».
              requested.length === 1
              ? t(submission.startedByMe ? `${Q}.intro.selfOne` : `${Q}.intro.updateOne`)
              : t(submission.startedByMe ? `${Q}.intro.selfMany` : `${Q}.intro.updateMany`, { count: String(requested.length) })
        }
      />
      {submission.decisionNote && (
        <Alert variant="warning">
          <MessageSquareText aria-hidden />
          <AlertTitle>{t(`${Q}.states.returned.title`)}</AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-line text-foreground">{submission.decisionNote}</p>
            <p className="mt-1">{t(`${Q}.states.returned.body`)}</p>
          </AlertDescription>
        </Alert>
      )}
      {autosave.state.pageRefusal && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{autosave.state.pageRefusal}</AlertDescription>
        </Alert>
      )}
      {refused.length > 0 && <RefusedAlert refused={refused} messages={autosave.state.refused} onSelect={leaveTo} />}
      <div className={QUESTIONNAIRE_LAYOUT.columns}>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <QuestionnaireNav steps={steps} current={step} incomplete={incomplete} refused={refused} onSelect={leaveTo} />
        </div>
        <section aria-labelledby="questionnaire-step-title" className="min-w-0">
          <header className="mb-5 space-y-1">
            <p className="hidden text-xs text-muted-foreground lg:block">
              {t(`${Q}.stepOf`, { current: String(index + 1), total: String(steps.length) })}
            </p>
            <h2 id="questionnaire-step-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight text-foreground outline-none">
              {t(`${Q}.steps.${step}.title`)}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`${Q}.steps.${step}.description`)}</p>
            {step !== 'review' && (
              <div className="pt-1">
                <AutosaveStatus state={autosave.state} onRetry={retry} savesOnContinue={savesOnContinue} />
              </div>
            )}
          </header>
          <DraftActionContext.Provider value={step === 'review' || savesOnContinue ? null : draftAction}>
            {onFile.loading && step === 'tax_bank' ? (
              <Loading />
            ) : (
              <StepBody key={step} step={step} ctx={ctx} incomplete={incomplete} toConfirm={toConfirm} goTo={goTo} />
            )}
          </DraftActionContext.Provider>
        </section>
      </div>
    </div>
  )
}

/**
 * The changes not saved because the database refused them (or for another reason than the
 * network), whatever sent them: each step named, a link to it, and the reason. It stays until a
 * save of that step lands (or the step shows what it holds again).
 */
function RefusedAlert({
  refused,
  messages,
  onSelect,
}: {
  refused: readonly SubmissionSection[]
  messages: Readonly<Partial<Record<SubmissionSection, string>>>
  onSelect: (step: QuestionnaireStep) => void
}) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertTitle>{t(refused.length === 1 ? `${Q}.refused.titleOne` : `${Q}.refused.titleMany`)}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 space-y-1">
          {refused.map((section) => (
            <li key={section} className="text-foreground">
              <button type="button" onClick={() => onSelect(section)} className="text-link underline underline-offset-2">
                {t(`${Q}.steps.${section}.title`)}
              </button>
              {messages[section] && <span> : {messages[section]}</span>}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function StepBody({
  step,
  ctx,
  incomplete,
  toConfirm,
  goTo,
}: {
  step: QuestionnaireStep
  ctx: StepContext
  incomplete: readonly SubmissionSection[]
  toConfirm: readonly SubmissionSection[]
  goTo: (step: QuestionnaireStep) => void
}) {
  switch (step) {
    case 'personal':
      return <PersonalStep ctx={ctx} />
    case 'professional':
      return <ProfessionalStep ctx={ctx} />
    case 'portrait':
      return <PortraitStep ctx={ctx} />
    case 'languages':
      return <LanguagesStep ctx={ctx} />
    case 'clienteles':
      return <ClientelesStep ctx={ctx} />
    case 'motifs':
      return <MotifsStep ctx={ctx} />
    case 'availability':
      return <AvailabilityStep ctx={ctx} />
    case 'photo':
      return <PhotoStep ctx={ctx} />
    case 'insurance':
      return <InsuranceStep ctx={ctx} />
    case 'tax_bank':
      return <TaxBankStep ctx={ctx} />
    case 'consent':
      return <ConsentStep ctx={ctx} />
    case 'review':
      return <ReviewStep ctx={ctx} incomplete={incomplete} toConfirm={toConfirm} goTo={goTo} />
  }
}
