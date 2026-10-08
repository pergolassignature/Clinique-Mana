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
import type { CompensationKind, RateInput, RateRow } from '../../api/compensation'
import { useSetCompensationRate } from '../../hooks/use-compensation'
import { earliestStart, rowsOf } from '../../lib/compensation'
import { rateSchema, type RateFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const O = 'modules.professionals.settings.compensation.rates'
const W = 'modules.professionals.compensation'

interface RateDialogProps {
  kinds: readonly CompensationKind[]
  rows: readonly RateRow[]
}

/** « Nouveau taux » for one of the other kinds: Type, Taux (%), « À partir du ». */
export const RateDialog = forwardRef<HTMLButtonElement, RateDialogProps>(function RateDialog({ kinds, rows }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetCompensationRate(feedback)
  const firstField = useRef<HTMLSelectElement | null>(null)

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
          {t(`${O}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${O}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${O}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <RateForm
          kinds={kinds}
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

interface RateFormProps extends RateDialogProps {
  firstFieldRef: RefObject<HTMLSelectElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: RateInput) => void
}

function RateForm({ kinds, rows, firstFieldRef, pending, refusal, dateError, onSubmit }: RateFormProps) {
  const minDateFor = useMemo(() => (kind: string) => earliestStart(rowsOf(rows, (row) => row.kind === kind)), [rows])
  // Rebuilt when the rows change (a refetch while the dialog is open): the date rule follows the open row.
  const resolver = useMemo(() => zodResolver(rateSchema(minDateFor)), [minDateFor])
  const form = useForm<RateFormValues, unknown, RateInput>({ resolver, defaultValues: { kind: kinds[0]?.key ?? '', pct: '', effectiveFrom: '' } })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const [kind, effectiveFrom] = useWatch({ control: form.control, name: ['kind', 'effectiveFrom'] })
  const { ref: registerKindRef, ...kindField } = form.register('kind')

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${W}.kind`)} required error={errors.kind?.message}>
          {(field) => (
            <Select
              {...field}
              {...kindField}
              ref={(element) => {
                registerKindRef(element)
                firstFieldRef.current = element
              }}
            >
              {kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${O}.dialog.rate`)} required error={errors.pct?.message}>
          {(field) => <Input {...field} {...form.register('pct')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </div>
      <EffectiveFromField registration={form.register('effectiveFrom')} value={effectiveFrom} error={errors.effectiveFrom?.message} min={minDateFor(kind)} help={t(`${O}.dialog.fromHelp`)} />
    </DialogForm>
  )
}
