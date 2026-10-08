import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useForm, type DefaultValues, type FieldValues, type Path, type Resolver, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { t } from '@/i18n'
import { rpcErrorDetail, rpcErrorHint } from '@/core/modules/errors'
import type { MyProfessionalPrivate, MySubmission } from '../../api/self'
import type { CatalogView } from '../../lib/catalog-view'
import { changedFields, confirmPayload, type SubmissionSection } from '../../lib/questionnaire'
import { isRefusal, saveErrorText, type QuestionnaireAutosave, type SaveOutcome } from '../../hooks/use-my-submission'
import { parseValidFields } from '../../schemas/questionnaire'

/**
 * The private data the record already holds (`get_my_professional_private`, read only when the
 * private step is requested): plain numbers and masks, or why they cannot be shown.
 */
export interface OnFilePrivate {
  data: MyProfessionalPrivate | null
  /** The read failed: « Impossible d'afficher les renseignements déjà fournis » with « Réessayer ». */
  failed: boolean
  retry: () => void
  retrying: boolean
}

/** What every step gets from the page. */
export interface StepContext {
  submission: MySubmission
  autosave: QuestionnaireAutosave
  catalog: CatalogView
  /** The clinic's today (`yyyy-MM-dd`). */
  today: string
  onFile: OnFilePrivate
  /** Goes to the next step (once « Continuer » has saved). */
  next: () => void
  /** Goes to the previous step; null on the first one. */
  back: (() => void) | null
}

/** The connection text of a save that failed in transit (the banner also says it). */
export const saveFailedText = () => t('modules.professionals.questionnaire.autosave.failed')

/**
 * Where a failed save goes: a P0001 whose HINT names a field of the step goes under it; any other
 * failure above the step's buttons, in words that fit it (`saveErrorText`: the refusal's message,
 * the connection text only for a failure in transit).
 */
export function refusalTarget(error: unknown, fields: readonly string[], hintField?: (hint: string, detail: string | undefined) => string | null) {
  const message = saveErrorText(error)
  if (!isRefusal(error)) return { field: null, message }
  const hint = rpcErrorHint(error)
  if (!hint) return { field: null, message }
  const field = hintField?.(hint, rpcErrorDetail(error)) ?? (fields.includes(hint) ? hint : null)
  return { field, message }
}

interface StepFormOptions<TValues extends FieldValues> {
  section: SubmissionSection
  /** A z.object of the step's fields (keys = the section's keys), each parsing on its own. */
  schema: z.ZodObject
  /** The form's values from what the section holds (prefill and answers). */
  initial: (section: Readonly<Record<string, unknown>>) => TValues
  /** Section values the form does not hold but « Continuer » confirms (a set saved by its picker). */
  extra?: () => Record<string, unknown>
  /** A rule outside the form checked on « Continuer » (a set that needs one item): its message, or null. */
  check?: () => string | null
  /** Maps a HINT (and DETAIL) to a form field, for fields whose name is not the HINT. */
  hintField?: (hint: string, detail: string | undefined, values: TValues) => Path<TValues> | null
}

export interface StepForm<TValues extends FieldValues> {
  form: UseFormReturn<TValues>
  /** The step form's submit (« Continuer »): validates, saves, then goes on. */
  onSubmit: (event: FormEvent) => void
  /** « Continuer » is saving. */
  pending: boolean
  /** A refusal that names no field of the step, shown above the buttons. */
  alert: string | null
  /** Shows a save's refusal (a picker's or an upload's caller may route its own instead). */
  showRefusal: (error: unknown, focus: boolean) => void
}

/**
 * A step built on a form: its values start from the draft kept while moving between steps, else
 * from what the section holds; every change is kept and autosaved (the fields that parse and
 * changed, 2.5 s after the last edit); leaving the step sends what is pending, and a refusal met
 * while it was closed is shown again when it opens. « Continuer »
 * validates the whole step, sends the changes and the required fields not answered yet
 * (`confirmPayload`, P4-330), then goes to the next step. A refusal lands under the field its HINT
 * names (focused on « Continuer », not while the provider types elsewhere).
 */
export function useStepForm<TValues extends FieldValues>(ctx: StepContext, options: StepFormOptions<TValues>): StepForm<TValues> {
  const { autosave, submission } = ctx
  // Stable functions only in the effect below (the autosave object changes after each save).
  const { schedule, flush, setDraft, onRefusal, current, refusalOf } = autosave
  const { section, schema } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  const form = useForm<TValues>({
    resolver: zodResolver(schema as never) as unknown as Resolver<TValues>,
    defaultValues: (autosave.draft<TValues>(section) ?? options.initial(autosave.current(section))) as DefaultValues<TValues>,
    mode: 'onTouched',
  })
  const latest = useRef<Readonly<Record<string, unknown>>>(form.getValues())
  const [alert, setAlert] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const fields = Object.keys(schema.shape)

  const showRefusal = useCallback(
    (error: unknown, focus: boolean) => {
      const { field, message } = refusalTarget(error, fields, (hint, detail) => optionsRef.current.hintField?.(hint, detail, form.getValues()) ?? null)
      if (field) form.setError(field as Path<TValues>, { message }, { shouldFocus: focus })
      else setAlert(message)
    },
    // `fields` follows the schema, which is stable for the step's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form],
  )

  useEffect(() => {
    const collect = () => {
      const changed = changedFields(parseValidFields(schema, latest.current), current(section))
      return Object.keys(changed).length > 0 ? changed : null
    }
    const subscription = form.watch((values) => {
      latest.current = values
      setDraft(section, values)
      setAlert(null)
      schedule(section, collect)
    })
    const stopListening = onRefusal(section, (error) => showRefusal(error, false))
    // A save of this step refused while it was closed (it left before the answer): shown again.
    const standing = refusalOf(section)
    if (standing) showRefusal(standing.error, false)
    return () => {
      subscription.unsubscribe()
      stopListening()
      // Leaving the step sends what is pending.
      void flush(section)
    }
  }, [current, flush, form, onRefusal, refusalOf, schedule, schema, section, setDraft, showRefusal])

  const submit = form.handleSubmit(async (parsed) => {
    const problem = optionsRef.current.check?.() ?? null
    if (problem) {
      setAlert(problem)
      return
    }
    setPending(true)
    setAlert(null)
    // One request: the pending autosave is replaced by the confirmation, computed once the saves in
    // flight have landed (so it holds only what the section does not hold yet).
    const fields = { ...(parsed as Record<string, unknown>), ...(optionsRef.current.extra?.() ?? {}) }
    const outcome: SaveOutcome = await autosave.confirm(section, () =>
      confirmPayload(section, fields, submission.prefill[section], autosave.answeredOf(section)),
    )
    setPending(false)
    if (outcome.ok) ctx.next()
    else showRefusal(outcome.error, true)
  })

  return { form, onSubmit: (event) => void submit(event), pending, alert, showRefusal }
}
