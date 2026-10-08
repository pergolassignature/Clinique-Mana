import { useId, useRef, useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import type { MyProfessionalPrivate, MySubmission, SectionValues } from '../../api/self'
import type { CatalogView } from '../../lib/catalog-view'
import { useSubmitMyProfile } from '../../hooks/use-my-submission'
import { sectionKeys, type SubmissionSection } from '../../lib/questionnaire'
import { SectionSummary } from './SectionSummary'
import { StepActions, StepAlert, StepForm } from './StepParts'
import { saveFailedText, type StepContext } from './use-step-form'

const R = 'modules.professionals.questionnaire.review'
const S = 'modules.professionals.questionnaire.steps'

interface SubmissionSectionsProps {
  submission: MySubmission
  catalog: CatalogView
  /** What each section holds now (prefill and answers). */
  valuesOf: (section: SubmissionSection) => SectionValues
  sections: readonly SubmissionSection[]
  onFilePrivate: MyProfessionalPrivate | null
  /** With it, each section says whether it is complete and offers « Modifier »; without, read-only. */
  edit?: { incomplete: readonly SubmissionSection[]; goTo: (section: SubmissionSection) => void }
}

/** The answers, section by section (the review, and the profile once sent). */
export function SubmissionSections({ submission, catalog, valuesOf, sections, onFilePrivate, edit }: SubmissionSectionsProps) {
  return (
    <div className="divide-y divide-border border-y border-border">
      {sections.map((section) => {
        const complete = !edit?.incomplete.includes(section)
        const title = t(`${S}.${section}.title`)
        return (
          <section key={section} aria-label={title} className="space-y-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              {edit && (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot tone={complete ? 'success' : 'warning'} />
                    {t(complete ? `${R}.complete` : `${R}.incomplete`)}
                  </span>
                  <Button type="button" variant="outline" size="sm" aria-label={t(`${R}.editLabel`, { step: title })} onClick={() => edit.goTo(section)}>
                    {t(complete ? `${R}.edit` : `${R}.completeAction`)}
                  </Button>
                </div>
              )}
            </div>
            <SectionSummary section={section} values={valuesOf(section)} submission={submission} catalog={catalog} onFilePrivate={onFilePrivate} />
          </section>
        )
      })}
    </div>
  )
}

/** The French text of a failed « Envoyer mon profil » that is not a list of steps. */
function submitErrorText(error: unknown): string {
  if (error instanceof FunctionCallError) {
    const refusal = refusalMessage(error)
    if (refusal) return refusal
    if (error.code === 'network') return t(`${R}.errors.network`)
  }
  return t(`${R}.errors.submitFailed`)
}

/**
 * « Révision et envoi »: every requested section in words with « Modifier », the steps still to
 * complete named first (P4-173, checked here before anything is sent: the function's limit counts
 * successes only, P4-261, and its refusal stays the backstop), then « Envoyer mon profil »: what is
 * pending is saved first, then `professionals-submit`. A refusal that lists steps names them.
 */
export function ReviewStep({
  ctx,
  incomplete,
  goTo,
  onFilePrivate,
}: {
  ctx: StepContext
  incomplete: readonly SubmissionSection[]
  goTo: (section: SubmissionSection) => void
  onFilePrivate: MyProfessionalPrivate | null
}) {
  const submit = useSubmitMyProfile()
  const [alert, setAlert] = useState<string | null>(null)
  const [serverGaps, setServerGaps] = useState<SubmissionSection[]>([])
  const missingRef = useRef<HTMLDivElement>(null)
  const missingId = useId()
  const missing = serverGaps.length > 0 ? serverGaps : incomplete
  const sections = ctx.submission.requestedSections

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submit.isPending) return
    if (incomplete.length > 0) {
      missingRef.current?.focus()
      return
    }
    setAlert(null)
    setServerGaps([])
    // What is still pending is saved first: the database checks what it holds.
    if (!(await ctx.autosave.flushAll())) {
      setAlert(saveFailedText())
      return
    }
    try {
      await submit.mutateAsync()
    } catch (error) {
      const gaps = error instanceof FunctionCallError && error.field === 'sections' ? sectionKeys(error.extra.sections) : []
      if (gaps.length > 0) {
        setServerGaps(gaps)
        // Focus once the list is drawn.
        requestAnimationFrame(() => missingRef.current?.focus())
      } else setAlert(submitErrorText(error))
    }
  }

  return (
    <StepForm onSubmit={(event) => void onSubmit(event)} busy={submit.isPending} className="space-y-5">
      {missing.length > 0 ? (
        <Alert ref={missingRef} id={missingId} variant="warning" tabIndex={-1} role={serverGaps.length > 0 ? 'alert' : undefined} className="outline-none">
          <CircleAlert aria-hidden />
          <AlertTitle>
            {serverGaps.length > 0
              ? t(`${R}.serverMissing`)
              : missing.length === 1
                ? t(`${R}.missingOne`)
                : t(`${R}.missingMany`, { count: String(missing.length) })}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {missing.map((section) => (
                <li key={section}>
                  <button type="button" onClick={() => goTo(section)} className="text-link underline underline-offset-2">
                    {t(`${S}.${section}.title`)}
                  </button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-foreground">{t(`${R}.ready`)}</p>
      )}
      <SubmissionSections
        submission={ctx.submission}
        catalog={ctx.catalog}
        valuesOf={ctx.autosave.current}
        sections={sections}
        onFilePrivate={onFilePrivate}
        edit={{ incomplete: missing, goTo }}
      />
      <StepAlert message={alert} />
      <StepActions
        back={ctx.back}
        pending={submit.isPending}
        label={t(`${R}.submit`)}
        pendingLabel={t(`${R}.submitting`)}
        inactive={incomplete.length > 0}
        describedBy={incomplete.length > 0 ? missingId : undefined}
        onSubmitClick={() => missingRef.current?.focus()}
      />
    </StepForm>
  )
}
