import { useId, useRef, useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError, refusalMessage } from '@/core/supabase/functions'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import type { MySubmission, SectionValues } from '../../api/self'
import type { CatalogView } from '../../lib/catalog-view'
import { functionErrorMessage } from '../../hooks/mutation-feedback'
import { useSubmitMyProfile } from '../../hooks/use-my-submission'
import { sectionKeys, type SubmissionSection } from '../../lib/questionnaire'
import { SectionSummary } from './SectionSummary'
import { StepActions, StepAlert, StepForm } from './StepParts'
import { saveFailedText, type OnFilePrivate, type StepContext } from './use-step-form'

const R = 'modules.professionals.questionnaire.review'
const S = 'modules.professionals.questionnaire.steps'

interface SubmissionSectionsProps {
  submission: MySubmission
  catalog: CatalogView
  /** What each section holds now (prefill and answers). */
  valuesOf: (section: SubmissionSection) => SectionValues
  sections: readonly SubmissionSection[]
  onFile: OnFilePrivate
  /**
   * With it, each section says whether it is complete (« Complète »), only prefilled and not
   * confirmed yet (« À confirmer », P4-330) or to complete, and offers « Modifier »; without, read-only.
   */
  edit?: { incomplete: readonly SubmissionSection[]; toConfirm: readonly SubmissionSection[]; goTo: (section: SubmissionSection) => void }
}

type SectionStatus = 'complete' | 'toConfirm' | 'incomplete'
const STATUS = {
  complete: { tone: 'success', label: 'complete', action: 'edit' },
  toConfirm: { tone: 'warning', label: 'toConfirm', action: 'confirmAction' },
  incomplete: { tone: 'warning', label: 'incomplete', action: 'completeAction' },
} as const

/** The answers, section by section (the review, and the profile once sent). */
export function SubmissionSections({ submission, catalog, valuesOf, sections, onFile, edit }: SubmissionSectionsProps) {
  return (
    <div className="divide-y divide-border border-y border-border">
      {sections.map((section) => {
        const status: SectionStatus = !edit?.incomplete.includes(section) ? 'complete' : edit.toConfirm.includes(section) ? 'toConfirm' : 'incomplete'
        const { tone, label, action } = STATUS[status]
        const title = t(`${S}.${section}.title`)
        return (
          <section key={section} aria-label={title} className="space-y-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              {edit && (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot tone={tone} />
                    {t(`${R}.${label}`)}
                  </span>
                  <Button type="button" variant="outline" size="sm" aria-label={t(`${R}.${action}Label`, { step: title })} onClick={() => edit.goTo(section)}>
                    {t(`${R}.${action}`)}
                  </Button>
                </div>
              )}
            </div>
            <SectionSummary section={section} values={valuesOf(section)} submission={submission} catalog={catalog} onFile={onFile} />
          </section>
        )
      })}
    </div>
  )
}

/**
 * The French text of a failed « Envoyer mon profil » that is not a list of steps: a refusal as
 * written, the connection, an expired session, a permission or the module switched off in plain
 * words; anything else « n'a pas pu être envoyé » (reported, code only).
 */
function submitErrorText(error: unknown): string {
  if (error instanceof FunctionCallError) {
    const refusal = refusalMessage(error)
    if (refusal) return refusal
    if (error.code === 'network') return t(`${R}.errors.network`)
    if (error.code === 'forbidden') return t('common.errors.forbidden')
    const known = functionErrorMessage(error)
    if (known) return known
  }
  return moduleErrorMessage(error, t(`${R}.errors.submitFailed`), 'professionals')
}

/**
 * « Révision et envoi »: every requested section in words with « Modifier », the steps still to
 * complete named first (P4-173, checked here before anything is sent: the function's limit counts
 * successes only, P4-261, and its refusal stays the backstop), then « Envoyer mon profil »: what is
 * pending is saved first, then `professionals-submit`. A change refused on a step (whatever sent it)
 * stops the sending and names the step to fix; a save failed in transit says to check the
 * connection. A refusal that lists steps names them.
 */
export function ReviewStep({
  ctx,
  incomplete,
  toConfirm,
  goTo,
}: {
  ctx: StepContext
  incomplete: readonly SubmissionSection[]
  toConfirm: readonly SubmissionSection[]
  goTo: (section: SubmissionSection) => void
}) {
  const submit = useSubmitMyProfile()
  const [alert, setAlert] = useState<string | null>(null)
  const [refusedSteps, setRefusedSteps] = useState<SubmissionSection[]>([])
  const [serverGaps, setServerGaps] = useState<SubmissionSection[]>([])
  const missingRef = useRef<HTMLDivElement>(null)
  const missingId = useId()
  const missing = serverGaps.length > 0 ? serverGaps : incomplete
  const sections = ctx.submission.requestedSections
  const { autosave } = ctx

  /** A change refused on these steps: sending waits until they are fixed. */
  const stopForRefusals = (refused: SubmissionSection[]) => {
    if (refused.length === 0) return false
    setRefusedSteps(refused)
    setAlert(refused.length === 1 ? t(`${R}.errors.refusedOne`, { step: t(`${S}.${refused[0] as SubmissionSection}.title`) }) : t(`${R}.errors.refusedMany`))
    return true
  }

  // One sending at a time, from the press on: the pending saves go first, and a second press while
  // they do must not start a second sending (it would be refused as already sent).
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (sendingRef.current || submit.isPending) return
    if (incomplete.length > 0) {
      missingRef.current?.focus()
      return
    }
    sendingRef.current = true
    setSending(true)
    try {
      await send()
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const send = async () => {
    setAlert(null)
    setRefusedSteps([])
    setServerGaps([])
    // What is still pending is saved first (it may fix a refused change): the database checks what it holds.
    const saved = await autosave.flushAll()
    const problems = autosave.problems()
    if (problems.closed || stopForRefusals(problems.refused)) return
    if (!saved || problems.failed) {
      setAlert(saveFailedText())
      return
    }
    try {
      await submit.mutateAsync()
    } catch (error) {
      if (error instanceof FunctionCallError && error.field && autosave.pageRefusal(error.field, refusalMessage(error) ?? '')) return
      const gaps = error instanceof FunctionCallError && error.field === 'sections' ? sectionKeys(error.extra.sections) : []
      if (gaps.length > 0) {
        setServerGaps(gaps)
        // Focus once the list is drawn.
        requestAnimationFrame(() => missingRef.current?.focus())
      } else setAlert(submitErrorText(error))
    }
  }

  return (
    <StepForm onSubmit={(event) => void onSubmit(event)} busy={sending || submit.isPending} className="space-y-5">
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
        valuesOf={autosave.current}
        sections={sections}
        onFile={ctx.onFile}
        edit={{ incomplete: missing, toConfirm, goTo }}
      />
      <StepAlert message={alert}>
        {refusedSteps.length > 1 && (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {refusedSteps.map((section) => (
              <li key={section}>
                <button type="button" onClick={() => goTo(section)} className="text-link underline underline-offset-2">
                  {t(`${S}.${section}.title`)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {refusedSteps.length === 1 && (
          <button type="button" onClick={() => goTo(refusedSteps[0] as SubmissionSection)} className="ml-1 text-link underline underline-offset-2">
            {t(`${R}.errors.goToStep`)}
          </button>
        )}
      </StepAlert>
      <StepActions
        back={ctx.back}
        pending={sending || submit.isPending}
        label={t(`${R}.submit`)}
        pendingLabel={t(`${R}.submitting`)}
        inactive={incomplete.length > 0}
        describedBy={incomplete.length > 0 ? missingId : undefined}
        onSubmitClick={() => missingRef.current?.focus()}
      />
    </StepForm>
  )
}
