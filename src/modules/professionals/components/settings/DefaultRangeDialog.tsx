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
import type { CompensationKind, DefaultRangeInput, DefaultRangeRow } from '../../api/compensation'
import { useSetCompensationDefault } from '../../hooks/use-compensation'
import { earliestStart, rowsOfKind } from '../../lib/compensation'
import { defaultRangeSchema, type DefaultRangeFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const D = 'modules.professionals.settings.compensation.defaults'
const W = 'modules.professionals.compensation'

interface DefaultRangeDialogProps {
  kinds: readonly CompensationKind[]
  rows: readonly DefaultRangeRow[]
}

/** « Nouvelle fourchette »: Type, minimum and maximum (%), « À partir du ». */
export const DefaultRangeDialog = forwardRef<HTMLButtonElement, DefaultRangeDialogProps>(function DefaultRangeDialog({ kinds, rows }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetCompensationDefault(feedback)
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
          {t(`${D}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${D}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${D}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <DefaultRangeForm
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

interface DefaultRangeFormProps extends DefaultRangeDialogProps {
  firstFieldRef: RefObject<HTMLSelectElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: DefaultRangeInput) => void
}

function DefaultRangeForm({ kinds, rows, firstFieldRef, pending, refusal, dateError, onSubmit }: DefaultRangeFormProps) {
  const minDateFor = useMemo(() => (kind: string) => earliestStart(rowsOfKind(rows, kind)), [rows])
  const [resolver] = useState(() => zodResolver(defaultRangeSchema(minDateFor)))
  const form = useForm<DefaultRangeFormValues, unknown, DefaultRangeInput>({
    resolver,
    defaultValues: { kind: kinds[0]?.key ?? '', min: '', max: '', effectiveFrom: '' },
  })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const [kind, effectiveFrom] = useWatch({ control: form.control, name: ['kind', 'effectiveFrom'] })
  const { ref: registerKindRef, ...kindField } = form.register('kind')

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
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
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${D}.dialog.min`)} required error={errors.min?.message}>
          {(field) => <Input {...field} {...form.register('min')} inputMode="decimal" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${D}.dialog.max`)} required error={errors.max?.message}>
          {(field) => <Input {...field} {...form.register('max')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </div>
      <EffectiveFromField
        registration={form.register('effectiveFrom')}
        value={effectiveFrom}
        error={errors.effectiveFrom?.message}
        min={minDateFor(kind)}
        help={t(`${D}.dialog.fromHelp`)}
      />
    </DialogForm>
  )
}
