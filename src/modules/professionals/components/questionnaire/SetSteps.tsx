import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Controller } from 'react-hook-form'
import type { z } from 'zod'
import { t } from '@/i18n'
import { SwitchField } from '@/shared/components/SwitchField'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { fullName } from '../../lib/display'
import { held, starredFirst } from '../../lib/matching-digest'
import { clienteleGroups, languageGroups, motifGroups, plainSelection, starredSelection } from '../../lib/matching-pickers'
import { summarizeMotifs } from '../../lib/motif-summary'
import { confirmPayload, type SubmissionSection } from '../../lib/questionnaire'
import { clientLimitsSchema, submittedProfessions, toClientLimitsValues, type ClientLimitsValues } from '../../schemas/questionnaire'
import { clienteleItemsSchema, holdsRegulatedTitle, languageIdsSchema, motifIdsSchema } from '../../schemas/matching'
import { clienteleLabel } from '../../lib/display'
import { HeldChips } from '../record/Chips'
import { MotifsSummary } from '../record/MotifsSummary'
import { SetPickerSheet, type PickerDraft } from '../pickers/SetPickerSheet'
import { FieldGroup, StepActions, StepAlert, StepForm } from './StepParts'
import { refusalTarget, useStepForm, type StepContext } from './use-step-form'

const S = 'modules.professionals.questionnaire.sets'
const L = 'modules.professionals.questionnaire.limits'

/** The ids of a set field (`language_ids`, `motif_ids`), sorted as the database stores them. */
const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').sort() : [])

/** The clientèles of the section (`[{id, specialized}]`), sorted by id as stored. */
function clienteleRefs(value: unknown): { id: string; specialized: boolean }[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item: unknown) => {
      const row = item as { id?: unknown; specialized?: unknown } | null
      return row && typeof row.id === 'string' ? [{ id: row.id, specialized: row.specialized === true }] : []
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

const refsFromKey = (key: string) =>
  key === '' ? [] : key.split(',').map((part) => ({ id: part.replace('*', ''), specialized: part.endsWith('*') }))

/** The picker's selection of a set of ids, the same object while the ids are the same. */
function usePlainSelection(ids: readonly string[]) {
  const key = ids.join(',')
  return useMemo(() => plainSelection(key === '' ? [] : key.split(',')), [key])
}

/** The schema's first message for a refused draft, else null. */
function draftProblem<T>(schema: z.ZodType<T>, value: T): string | null {
  const result = schema.safeParse(value)
  return result.success ? null : (result.error.issues[0]?.message ?? t('modules.professionals.errors.saveFailed'))
}

/**
 * A set saved by its picker (languages, motifs): the picker's « Enregistrer » saves at once through
 * the autosave chain (a refusal stays in the sheet); « Continuer » needs one item and confirms the
 * set when it was only prefilled (P4-330).
 */
function useSetStep(ctx: StepContext, section: SubmissionSection, key: string, requiredMessage: string) {
  const { autosave, submission } = ctx
  const [pending, setPending] = useState(false)
  const [alert, setAlert] = useState<string | null>(null)
  const current = autosave.current(section)

  const saveSet = async (values: Record<string, unknown>): Promise<string | null> => {
    const outcome = await autosave.save(section, values)
    if (outcome.ok) setAlert(null)
    return outcome.ok ? null : refusalTarget(outcome.error, []).message
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const value = autosave.current(section)[key]
    if (!Array.isArray(value) || value.length === 0) {
      setAlert(requiredMessage)
      return
    }
    setPending(true)
    setAlert(null)
    const outcome = await autosave.confirm(section, () => confirmPayload(section, { [key]: value }, submission.prefill[section], autosave.answeredOf(section)))
    setPending(false)
    if (outcome.ok) ctx.next()
    else setAlert(refusalTarget(outcome.error, []).message)
  }
  return { current, saveSet, onSubmit: (event: FormEvent) => void onSubmit(event), pending, alert }
}

/**
 * The step's picker trigger: « Choisir mes … » while empty, « Modifier mes … » once something is
 * held. An element, not a component: `SheetTrigger asChild` puts its handlers and ARIA on it.
 */
const pickerTrigger = (list: 'languages' | 'clienteles' | 'motifs', empty: boolean) => (
  <Button type="button" variant="outline" size="sm">
    {t(empty ? `${S}.${list}.choose` : `${S}.${list}.change`)}
  </Button>
)

function SetStepForm({ ctx, onSubmit, pending, alert, children }: { ctx: StepContext; onSubmit: (event: FormEvent) => void; pending: boolean; alert: string | null; children: ReactNode }) {
  return (
    <StepForm onSubmit={onSubmit} busy={pending} className="space-y-4">
      {children}
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}

/** « Langues »: at least one (the picker keeps the last one). */
export function LanguagesStep({ ctx }: { ctx: StepContext }) {
  const { catalog, submission } = ctx
  const required = t('modules.professionals.validation.languagesRequired')
  const step = useSetStep(ctx, 'languages', 'language_ids', required)
  const ids = idList(step.current.language_ids)
  const selection = usePlainSelection(ids)
  const heldAtOpen = idList(submission.prefill.languages?.language_ids)
  return (
    <SetStepForm ctx={ctx} {...step}>
      <HeldChips items={held(catalog.languages, new Map(ids.map((id) => [id, false])))} empty={t(`${S}.languages.empty`)} />
      <SetPickerSheet
        title={t('modules.professionals.questionnaire.steps.languages.title')}
        subject={fullName(submission.professional)}
        trigger={pickerTrigger('languages', ids.length === 0)}
        groups={languageGroups(catalog, selection)}
        selected={selection}
        searchPlaceholder={t(`${S}.languages.search`)}
        requiredMessage={required}
        onSave={(draft) => {
          const next = [...draft.keys()].sort()
          const problem = draftProblem(languageIdsSchema(catalog, { heldIds: heldAtOpen }), next)
          return problem ? Promise.resolve(problem) : step.saveSet({ language_ids: next })
        }}
      />
    </SetStepForm>
  )
}

/**
 * « Motifs », always written by name, by category (P4-249); the picker searches, folds categories
 * and selects a whole category. A motif reserved to regulated titles needs one of those titles
 * among the questionnaire's (or the record's, when the titles are not asked).
 */
export function MotifsStep({ ctx }: { ctx: StepContext }) {
  const { catalog, submission, autosave } = ctx
  const step = useSetStep(ctx, 'motifs', 'motif_ids', t(`${S}.motifs.required`))
  const ids = idList(step.current.motif_ids)
  const selection = usePlainSelection(ids)
  const heldAtOpen = idList(submission.prefill.motifs?.motif_ids)
  // Without the titles step, the record's titles are not known here: the database decides (P4-174).
  const regulated = submission.requestedSections.includes('professional')
    ? holdsRegulatedTitle(
        submittedProfessions(autosave.current('professional')).map((p) => ({ titleId: p.title_id })),
        catalog,
      )
    : true
  const summary = useMemo(() => summarizeMotifs([...selection.keys()], catalog), [selection, catalog])
  return (
    <SetStepForm ctx={ctx} {...step}>
      {summary.groups.length === 0 ? <p className="text-sm text-muted-foreground">{t(`${S}.motifs.empty`)}</p> : <MotifsSummary summary={summary} />}
      <SetPickerSheet
        title={t('modules.professionals.questionnaire.steps.motifs.title')}
        subject={fullName(submission.professional)}
        trigger={pickerTrigger('motifs', ids.length === 0)}
        groups={motifGroups(catalog, selection, regulated, t(`${S}.motifs.blocked`))}
        selected={selection}
        searchPlaceholder={t(`${S}.motifs.search`)}
        onSave={(draft) => {
          const next = [...draft.keys()].sort()
          const problem = draftProblem(motifIdsSchema(catalog, { heldIds: heldAtOpen, hasRegulatedTitle: regulated }), next)
          return problem ? Promise.resolve(problem) : step.saveSet({ motif_ids: next })
        }}
      />
    </SetStepForm>
  )
}

/**
 * « Clientèles » with the client limits (P4-245): the set is the picker's (★ specialised), the
 * youngest client age and « Femmes seulement » autosave like any form.
 */
export function ClientelesStep({ ctx }: { ctx: StepContext }) {
  const { catalog, submission, autosave } = ctx
  const refs = clienteleRefs(autosave.current('clienteles').clienteles)
  const { form, onSubmit, pending, alert, showRefusal } = useStepForm<ClientLimitsValues>(ctx, {
    section: 'clienteles',
    schema: clientLimitsSchema,
    initial: toClientLimitsValues,
    extra: () => ({ clienteles: clienteleRefs(autosave.current('clienteles').clienteles) }),
    check: () => (clienteleRefs(autosave.current('clienteles').clienteles).length === 0 ? t(`${S}.clienteles.required`) : null),
  })
  const refsKey = refs.map((r) => `${r.id}${r.specialized ? '*' : ''}`).join(',')
  const selection = useMemo(() => starredSelection(refsFromKey(refsKey)), [refsKey])
  const heldAtOpen = clienteleRefs(submission.prefill.clienteles?.clienteles).map((r) => r.id)
  const chips = starredFirst(catalog.clienteles, refs, clienteleLabel)
  const errors = form.formState.errors

  const saveClienteles = async (draft: PickerDraft): Promise<string | null> => {
    const items = [...draft].map(([id, { specialized }]) => ({ id, specialized })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const problem = draftProblem(clienteleItemsSchema(catalog, { heldIds: heldAtOpen }), items)
    if (problem) return problem
    const outcome = await autosave.save('clienteles', { clienteles: items })
    if (outcome.ok) return null
    // A limit refused alongside goes under its field; the sheet says the rest.
    showRefusal(outcome.error, false)
    return refusalTarget(outcome.error, []).message
  }

  return (
    <StepForm onSubmit={onSubmit} busy={pending} className="space-y-6">
      <div className="space-y-3">
        <HeldChips items={chips} empty={t(`${S}.clienteles.empty`)} />
        <SetPickerSheet
          title={t('modules.professionals.questionnaire.steps.clienteles.title')}
          subject={fullName(submission.professional)}
          trigger={pickerTrigger('clienteles', refs.length === 0)}
          groups={clienteleGroups(catalog, selection)}
          selected={selection}
          withStars
          searchPlaceholder={t(`${S}.clienteles.search`)}
          onSave={saveClienteles}
        />
      </div>
      <FieldGroup title={t(`${L}.title`)} description={t(`${L}.description`)}>
        <FormField label={t(`${L}.minAge`)} help={t(`${L}.minAgeHelp`)} error={errors.min_client_age?.message}>
          {(field) => <Input {...field} {...form.register('min_client_age')} inputMode="numeric" maxLength={3} autoComplete="off" className="tabular max-w-[6rem]" />}
        </FormField>
        <Controller
          control={form.control}
          name="women_only"
          render={({ field }) => (
            <SwitchField
              ref={field.ref}
              label={t(`${L}.womenOnly`)}
              help={t(`${L}.womenOnlyHelp`)}
              error={errors.women_only?.message}
              checked={field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
      </FieldGroup>
      <StepAlert message={alert} />
      <StepActions back={ctx.back} pending={pending} />
    </StepForm>
  )
}
