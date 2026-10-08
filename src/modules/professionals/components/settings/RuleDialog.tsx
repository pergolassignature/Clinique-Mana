import { forwardRef, useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { CAP_BASES, type RecognitionRuleInput, type RecognitionRuleRow } from '../../api/compensation'
import { useSetRecognitionRule } from '../../hooks/use-compensation'
import { earliestStart, formatCents, formatPercent } from '../../lib/compensation'
import { ruleSchema, type RuleFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const R = 'modules.professionals.settings.compensation.rules'
const W = 'modules.professionals.compensation'

/** The open rule's terms as a starting point: a new rule usually changes one number. */
function startingValues(open: RecognitionRuleRow | undefined): RuleFormValues {
  const amount = (cents: number) => formatCents(cents).replace(/\u00A0\$$/, '')
  return {
    stepSessions: open ? String(open.stepSessions) : '',
    bonusPer50Min: open ? amount(open.bonusPer50MinCents) : '',
    bonusPer30Min: open ? amount(open.bonusPer30MinCents) : '',
    capPct: open ? formatPercent(open.capPct).replace(/\u00A0%$/, '') : '',
    capBasis: open?.capBasis ?? 'unconfirmed',
    effectiveFrom: '',
    note: '',
  }
}

/**
 * « Nouvelle règle »: the palier, the two bonuses (dollars, stored in cents), the cap and its basis
 * (« À confirmer » until the clinic confirms how the contract reads, P4-8), « À partir du », Note.
 * It starts from the rule in force, so changing one number does not mean typing them all.
 */
export const RuleDialog = forwardRef<HTMLButtonElement, { rows: readonly RecognitionRuleRow[] }>(function RuleDialog({ rows }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetRecognitionRule(feedback)
  const firstField = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (save.isPending) return
    if (!next) {
      save.reset()
      clear()
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={ref} type="button" variant="outline">
          <Plus aria-hidden />
          {t(`${R}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${R}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${R}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <RuleForm
          rows={rows}
          firstFieldRef={firstField}
          pending={save.isPending}
          refusal={refusal}
          dateError={dateError}
          onSubmit={(input) => {
            clear()
            save.mutate(input, { onSuccess: () => setOpen(false) })
          }}
        />
      </DialogContent>
    </Dialog>
  )
})

interface RuleFormProps {
  rows: readonly RecognitionRuleRow[]
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: RecognitionRuleInput) => void
}

function RuleForm({ rows, firstFieldRef, pending, refusal, dateError, onSubmit }: RuleFormProps) {
  const minDate = earliestStart(rows)
  // Rebuilt when the open rule changes (a refetch while the dialog is open).
  const resolver = useMemo(() => zodResolver(ruleSchema(minDate)), [minDate])
  const form = useForm<RuleFormValues, unknown, RecognitionRuleInput>({
    resolver,
    defaultValues: startingValues(rows.find((row) => row.effectiveTo === null)),
  })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const effectiveFrom = useWatch({ control: form.control, name: 'effectiveFrom' })
  const { ref: registerStepRef, ...stepField } = form.register('stepSessions')

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${R}.dialog.step`)} required error={errors.stepSessions?.message}>
          {(field) => (
            <Input
              {...field}
              {...stepField}
              ref={(element) => {
                registerStepRef(element)
                firstFieldRef.current = element
              }}
              inputMode="numeric"
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField label={t(`${R}.dialog.cap`)} required error={errors.capPct?.message}>
          {(field) => <Input {...field} {...form.register('capPct')} inputMode="decimal" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${R}.dialog.bonus50`)} required error={errors.bonusPer50Min?.message}>
          {(field) => <Input {...field} {...form.register('bonusPer50Min')} inputMode="decimal" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${R}.dialog.bonus30`)} required error={errors.bonusPer30Min?.message}>
          {(field) => <Input {...field} {...form.register('bonusPer30Min')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </div>
      <FormField label={t(`${R}.dialog.basis`)} help={t(`${R}.dialog.basisHelp`)} required error={errors.capBasis?.message}>
        {(field) => (
          <Select {...field} {...form.register('capBasis')}>
            {CAP_BASES.map((basis) => (
              <option key={basis} value={basis}>
                {t(`${R}.bases.${basis}`)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <EffectiveFromField
        registration={form.register('effectiveFrom')}
        value={effectiveFrom}
        error={errors.effectiveFrom?.message}
        min={minDate}
        help={t(`${R}.dialog.fromHelp`)}
      />
      <FormField label={t(`${W}.note`)} help={t(`${W}.noteHelp`)} error={errors.note?.message}>
        {(field) => <Input {...field} {...form.register('note')} autoComplete="off" maxLength={500} />}
      </FormField>
    </DialogForm>
  )
}
