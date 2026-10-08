import { forwardRef, useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { MarginInForce, MarginInput, MarginRow } from '../../api/compensation'
import { useSetProfessionalMargin } from '../../hooks/use-compensation'
import { earliestStart, isOutsideRange, parsePercent, rangeLabel, rowsOfKind } from '../../lib/compensation'
import { marginSchema, type MarginFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const M = 'modules.professionals.record.compensation.margin'
const W = 'modules.professionals.compensation'

interface MarginDialogProps {
  professionalId: string
  /** The kinds in their order, with the default range in force (for the live warning). */
  kinds: readonly MarginInForce[]
  rows: readonly MarginRow[]
}

/**
 * « Nouvelle marge »: Type, Marge (%), « À partir du », Note. A margin outside the kind's default
 * range is allowed and said at once (« Hors de la fourchette par défaut (25–30 %). »). The form
 * lives in the content, so each opening starts empty; while saving the dialog cannot close.
 */
export const MarginDialog = forwardRef<HTMLButtonElement, MarginDialogProps>(function MarginDialog({ professionalId, kinds, rows }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetProfessionalMargin(professionalId, feedback)
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
          {t(`${M}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${M}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${M}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <MarginForm
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

interface MarginFormProps extends Omit<MarginDialogProps, 'professionalId'> {
  firstFieldRef: RefObject<HTMLSelectElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: MarginInput) => void
}

function MarginForm({ kinds, rows, firstFieldRef, pending, refusal, dateError, onSubmit }: MarginFormProps) {
  const minDateFor = useMemo(() => (kind: string) => earliestStart(rowsOfKind(rows, kind)), [rows])
  const [resolver] = useState(() => zodResolver(marginSchema(minDateFor)))
  const form = useForm<MarginFormValues, unknown, MarginInput>({
    resolver,
    defaultValues: { kind: kinds[0]?.kind ?? '', marginPct: '', effectiveFrom: '', note: '' },
  })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const [kind, marginText, effectiveFrom] = useWatch({ control: form.control, name: ['kind', 'marginPct', 'effectiveFrom'] })
  // The kind's default range in force today: the RPC's own warning is against the range on the
  // chosen date, and the toast after the save says it.
  const current = kinds.find((k) => k.kind === kind)
  const range = current && current.min !== null && current.max !== null ? rangeLabel(current.min, current.max) : null
  const margin = parsePercent(marginText)
  const outside = range !== null && margin !== null && isOutsideRange(margin, current?.min ?? null, current?.max ?? null)
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
                <option key={k.kind} value={k.kind}>
                  {k.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${M}.dialog.margin`)} required error={errors.marginPct?.message}>
          {(field) => <Input {...field} {...form.register('marginPct')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </div>
      <div role="status" className="empty:hidden">
        {outside && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-foreground">{t(`${M}.outside`, { range })}</AlertDescription>
          </Alert>
        )}
      </div>
      <EffectiveFromField
        registration={form.register('effectiveFrom')}
        value={effectiveFrom}
        error={errors.effectiveFrom?.message}
        min={minDateFor(kind)}
        help={t(`${M}.dialog.fromHelp`)}
      />
      <FormField label={t(`${W}.note`)} help={t(`${W}.noteHelp`)} error={errors.note?.message}>
        {(field) => <Input {...field} {...form.register('note')} autoComplete="off" maxLength={500} />}
      </FormField>
    </DialogForm>
  )
}
