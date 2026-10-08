import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleAlert, CircleCheck, MessageSquareText } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { formatClinicDateFull } from '@/shared/lib/timezone'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import type { MyProfessionalPrivate, MySubmission } from '../../api/self'
import { AutosaveStatus } from '../../components/questionnaire/AutosaveStatus'
import { AvailabilityStep } from '../../components/questionnaire/AvailabilityStep'
import { ConsentStep } from '../../components/questionnaire/ConsentStep'
import { InsuranceStep, PhotoStep } from '../../components/questionnaire/FileSteps'
import { PersonalStep } from '../../components/questionnaire/PersonalStep'
import { PortraitStep } from '../../components/questionnaire/PortraitStep'
import { ProfessionalStep } from '../../components/questionnaire/ProfessionalStep'
import { QuestionnaireNav } from '../../components/questionnaire/QuestionnaireNav'
import { ReviewStep, SubmissionSections } from '../../components/questionnaire/ReviewStep'
import { ClientelesStep, LanguagesStep, MotifsStep } from '../../components/questionnaire/SetSteps'
import { TaxBankStep } from '../../components/questionnaire/TaxBankStep'
import type { StepContext } from '../../components/questionnaire/use-step-form'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { useMyProfessionalPrivate, useMySubmission, useQuestionnaireAutosave } from '../../hooks/use-my-submission'
import type { CatalogView } from '../../lib/catalog-view'
import {
  effectiveSection,
  incompleteSections,
  STEP_SLUGS,
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
  const data = submission.data
  usePageTitle(
    data?.status === 'submitted' ? t(`${Q}.states.submitted.pageTitle`) : data?.kind === 'update' ? t(`${Q}.title.update`) : t(`${Q}.title.onboarding`),
  )

  if (submission.isPending || (data && catalog.isPending)) return <Loading />
  if (submission.isError || catalog.isError) {
    return (
      <LoadError
        message={moduleErrorMessage(submission.error ?? catalog.error, t(`${Q}.states.loadError`))}
        retrying={submission.isFetching || catalog.isFetching}
        onRetry={() => void Promise.all([submission.refetch(), catalog.refetch()])}
      />
    )
  }
  if (!data) return <NothingToComplete />
  // The catalogue is loaded once a submission exists (checked above).
  const view = catalog.data as CatalogView
  if (data.status === 'submitted') return <SentProfile submission={data} catalog={view} />
  // A new submission (another invitation, an update) starts a fresh questionnaire.
  return <Questionnaire key={data.id} submission={data} catalog={view} />
}

function NothingToComplete() {
  return (
    <div className="mx-auto max-w-form space-y-2">
      <PageHeader level={1} title={t(`${Q}.states.none.pageTitle`)} />
      <EmptyState
        title={t(`${Q}.states.none.title`)}
        body={t(`${Q}.states.none.body`)}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/accueil">{t(`${Q}.states.none.home`)}</Link>
          </Button>
        }
      />
    </div>
  )
}

/** The private data on file, read only when the private step is requested (else null). */
function useOnFilePrivate(submission: MySubmission) {
  const requested = submission.requestedSections.includes('tax_bank')
  const query = useMyProfessionalPrivate(requested)
  return { onFilePrivate: (query.data ?? null) as MyProfessionalPrivate | null, loading: requested && query.isPending }
}

/** « Profil envoyé le … »: the thanks, and the answers as sent (read-only). */
function SentProfile({ submission, catalog }: { submission: MySubmission; catalog: CatalogView }) {
  const { onFilePrivate } = useOnFilePrivate(submission)
  return (
    <div className="mx-auto max-w-form space-y-5">
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
          onFilePrivate={onFilePrivate}
        />
      </section>
      <Button asChild variant="outline" size="sm">
        <Link to="/accueil">{t(`${Q}.states.none.home`)}</Link>
      </Button>
    </div>
  )
}

/**
 * The steps: the list (left from `md`, folded on a phone), the current step with its title,
 * « Étape 3 sur 12 » and the autosave's state, its form and « Retour » / « Continuer ». The step is
 * in the URL (`?etape=`), so the browser's back button and a reload keep it; without one the
 * questionnaire opens on the first step to complete. Pending autosaves are sent when the page is
 * hidden (a phone switching apps) or left; a failed save keeps the leave guard armed.
 */
function Questionnaire({ submission, catalog }: { submission: MySubmission; catalog: CatalogView }) {
  const autosave = useQuestionnaireAutosave(submission)
  const today = useClinicDate()
  const { onFilePrivate, loading: privateLoading } = useOnFilePrivate(submission)
  const [params, setParams] = useSearchParams()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const steps = useMemo(() => stepsFor(submission.requestedSections), [submission.requestedSections])
  const incomplete = incompleteSections(submission.requestedSections, {
    answered: autosave.answered,
    privateRow: submission.private,
    onFilePrivate,
    onFile: submission.onFile,
    collectSin: submission.collectSin,
    consentId: submission.consent?.id ?? null,
    today,
  })
  // Without a step in the URL: the first one to complete, chosen once (it must not jump as steps complete).
  const [landing] = useState<QuestionnaireStep>(() => incomplete[0] ?? 'review')
  const step = stepFromSlug(params.get(STEP_PARAM), steps) ?? landing
  const index = steps.indexOf(step)
  const { flushAll, retry } = autosave
  const confirmLeave = useConfirmLeave()
  useUnsavedChanges(autosave.state.failed)

  const goTo = (next: QuestionnaireStep) => {
    if (next === step) return
    setParams((prev) => {
      const out = new URLSearchParams(prev)
      out.set(STEP_PARAM, STEP_SLUGS[next])
      return out
    })
  }
  // The autosaved steps keep their edits when left (memory, then the server); the private step and
  // the consent hold typed values only until « Continuer »: leaving them asks first.
  const leaveTo = (next: QuestionnaireStep) => (step === 'tax_bank' || step === 'consent' ? confirmLeave(() => goTo(next)) : goTo(next))

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

  // A phone switching apps, a tab hidden or closed: what is pending goes now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushAll()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flushAll])

  const ctx: StepContext = {
    submission,
    autosave,
    catalog,
    today,
    next: () => {
      const next = steps[index + 1]
      if (next) goTo(next)
    },
    back: index > 0 ? () => leaveTo(steps[index - 1] as QuestionnaireStep) : null,
  }
  const requested = submission.requestedSections
  const kind = submission.kind

  return (
    <div className="mx-auto max-w-[960px] space-y-5">
      <PageHeader
        level={1}
        title={t(`${Q}.title.${kind}`)}
        description={
          kind === 'onboarding'
            ? t(`${Q}.intro.onboarding`)
            : requested.length === 1
              ? t(`${Q}.intro.updateOne`)
              : t(`${Q}.intro.updateMany`, { count: String(requested.length) })
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
      <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <div className="md:sticky md:top-4 md:self-start">
          <QuestionnaireNav steps={steps} current={step} incomplete={incomplete} onSelect={leaveTo} />
        </div>
        <section aria-labelledby="questionnaire-step-title" className="min-w-0 max-w-form">
          <header className="mb-5 space-y-1">
            <p className="hidden text-xs text-muted-foreground md:block">
              {t(`${Q}.stepOf`, { current: String(index + 1), total: String(steps.length) })}
            </p>
            <h2 id="questionnaire-step-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight text-foreground outline-none">
              {t(`${Q}.steps.${step}.title`)}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`${Q}.steps.${step}.description`)}</p>
            {step !== 'review' && (
              <div className="pt-1">
                <AutosaveStatus
                  state={autosave.state}
                  onSaveNow={() => void flushAll()}
                  onRetry={retry}
                  savesOnContinue={step === 'tax_bank' || step === 'consent'}
                />
              </div>
            )}
          </header>
          {privateLoading && step === 'tax_bank' ? <Loading /> : <StepBody key={step} step={step} ctx={ctx} incomplete={incomplete} goTo={goTo} onFilePrivate={onFilePrivate} />}
        </section>
      </div>
    </div>
  )
}

function StepBody({
  step,
  ctx,
  incomplete,
  goTo,
  onFilePrivate,
}: {
  step: QuestionnaireStep
  ctx: StepContext
  incomplete: readonly SubmissionSection[]
  goTo: (step: QuestionnaireStep) => void
  onFilePrivate: MyProfessionalPrivate | null
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
      return <TaxBankStep ctx={ctx} onFilePrivate={onFilePrivate} />
    case 'consent':
      return <ConsentStep ctx={ctx} />
    case 'review':
      return <ReviewStep ctx={ctx} incomplete={incomplete} goTo={goTo} onFilePrivate={onFilePrivate} />
  }
}
