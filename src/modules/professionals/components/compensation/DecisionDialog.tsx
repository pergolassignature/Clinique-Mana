import { useMemo, useRef, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { t } from '@/i18n'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { Decision, DecisionInput } from '../../api/compensation'
import { useDecideRetention } from '../../hooks/use-compensation'
import { formatPercent, formatSessions } from '../../lib/compensation'
import { decisionSchema, type DecisionFormOutput, type DecisionFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from './DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from './dialog-state'

const D = 'modules.professionals.compensation.decision'
const W = 'modules.professionals.compensation'

/** What a decision is about, read from the record or the review row. */
export interface DecisionTarget {
  professionalId: string
  /** « Paul Un », for the review's dialog title. */
  name: string | null
  decision: Decision
  appliedPct: number | null
  suggestedPct: number | null
  suggestedThreshold: number | null
  /** The earliest start the RPC accepts (the day after the open rate's), or null. */
  minDate: string | null
  /** Prefilled « À partir du » (the first day of the month the decision is for). */
  defaultFrom: string
}

interface DecisionDialogProps {
  target: DecisionTarget | null
  onClose: () => void
}

/**
 * The four decisions on the applied rate (P4-187), from the record or « Révision mensuelle »:
 * « Appliquer la suggestion » and « Maintenir » take only a date (the rate is the database's),
 * « Taux particulier » a rate and its reason, « Taux de départ » a rate. Controlled: open while
 * `target` is set; closing is ignored while saving.
 */
export function DecisionDialog({ target, onClose }: DecisionDialogProps) {
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useDecideRetention(target?.professionalId ?? '', feedback)
  const firstField = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (next || save.isPending) return
    save.reset()
    clear()
    onClose()
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{target.name ? t(`${D}.titleFor.${target.decision}`, { name: target.name }) : t(`${D}.title.${target.decision}`)}</DialogTitle>
              <DialogDescription>{describe(target)}</DialogDescription>
            </DialogHeader>
            <DecisionForm
              key={`${target.professionalId}-${target.decision}`}
              target={target}
              firstFieldRef={firstField}
              pending={save.isPending}
              refusal={refusal}
              dateError={dateError}
              onSubmit={(values) => {
                clear()
                const input: DecisionInput = { decision: target.decision, pct: values.pct, effectiveFrom: values.effectiveFrom, note: values.note }
                save.mutate(input, { onSuccess: () => onClose() })
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The sentence under the title: what the decision will do. */
function describe(target: DecisionTarget): string {
  const applied = target.appliedPct === null ? null : formatPercent(target.appliedPct)
  const suggested = target.suggestedPct === null ? null : formatPercent(target.suggestedPct)
  const tier = target.suggestedThreshold === null ? '' : formatSessions(target.suggestedThreshold)
  switch (target.decision) {
    case 'suggested':
      return applied ? t(`${D}.describe.suggested`, { from: applied, to: suggested ?? '—', tier }) : t(`${D}.describe.suggestedFirst`, { to: suggested ?? '—', tier })
    case 'maintained':
      return t(`${D}.describe.maintained`, { rate: applied ?? '—', tier })
    case 'custom':
      return t(`${D}.describe.custom`)
    case 'initial':
      return t(`${D}.describe.initial`)
  }
}

interface DecisionFormProps {
  target: DecisionTarget
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (values: DecisionFormOutput) => void
}

function DecisionForm({ target, firstFieldRef, pending, refusal, dateError, onSubmit }: DecisionFormProps) {
  const typed = target.decision === 'initial' || target.decision === 'custom'
  const resolver = useMemo(() => zodResolver(decisionSchema(target.decision, target.minDate)), [target.decision, target.minDate])
  const form = useForm<DecisionFormValues, unknown, DecisionFormOutput>({
    resolver,
    defaultValues: { pct: '', effectiveFrom: target.defaultFrom, note: '' },
  })
  const { errors } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const effectiveFrom = useWatch({ control: form.control, name: 'effectiveFrom' })
  const { ref: pctRef, ...pctField } = form.register('pct')
  const { ref: fromRef, ...fromField } = form.register('effectiveFrom')

  return (
    <DialogForm
      onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      pending={pending}
      // The date is prefilled: « Confirmer » is ready at once.
      dirty
      refusal={refusal}
      submitLabel={t(`${D}.confirm`)}
      pendingLabel={t(`${D}.confirming`)}
    >
      {typed && (
        <FormField label={t(`${D}.rate`)} required error={errors.pct?.message}>
          {(field) => (
            <Input
              {...field}
              {...pctField}
              ref={(element) => {
                pctRef(element)
                firstFieldRef.current = element
              }}
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </FormField>
      )}
      <EffectiveFromField
        registration={{
          ...fromField,
          ref: (element: HTMLInputElement | null) => {
            fromRef(element)
            if (!typed) firstFieldRef.current = element
          },
        }}
        value={effectiveFrom}
        error={errors.effectiveFrom?.message}
        min={target.minDate}
        help={t(`${D}.fromHelp`)}
      />
      <FormField
        label={t(`${W}.note`)}
        required={target.decision === 'custom'}
        help={target.decision === 'custom' ? t(`${D}.customNoteHelp`) : t(`${W}.noteHelp`)}
        error={errors.note?.message}
      >
        {(field) => <Input {...field} {...form.register('note')} autoComplete="off" maxLength={500} />}
      </FormField>
    </DialogForm>
  )
}
