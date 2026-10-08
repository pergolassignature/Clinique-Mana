import { forwardRef, useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { LevelInput } from '../../api/compensation'
import { useSetProfessionalRecognition } from '../../hooks/use-compensation'
import { levelSchema, type LevelFormValues } from '../../schemas/compensation'
import { DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const R = 'modules.professionals.record.compensation.recognition'
const W = 'modules.professionals.compensation'

interface LevelDialogProps {
  professionalId: string
  /** The earliest start (the day after the open level's), or null. */
  minDate: string | null
}

/**
 * « Mettre à jour »: a new recognition level, entered by hand (P4-8: nothing is computed): Niveau,
 * Séances comptées, « À partir du », Note. Each opening starts empty; while saving the dialog
 * cannot close.
 */
export const LevelDialog = forwardRef<HTMLButtonElement, LevelDialogProps>(function LevelDialog({ professionalId, minDate }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetProfessionalRecognition(professionalId, feedback)
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
          <Pencil aria-hidden />
          {t(`${R}.update`)}
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
        <LevelForm
          minDate={minDate}
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

interface LevelFormProps {
  minDate: string | null
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: LevelInput) => void
}

function LevelForm({ minDate, firstFieldRef, pending, refusal, dateError, onSubmit }: LevelFormProps) {
  // Rebuilt when the open level changes (a refetch while the dialog is open).
  const resolver = useMemo(() => zodResolver(levelSchema(minDate)), [minDate])
  const form = useForm<LevelFormValues, unknown, LevelInput>({ resolver, defaultValues: { level: '', sessions: '', effectiveFrom: '', note: '' } })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const effectiveFrom = useWatch({ control: form.control, name: 'effectiveFrom' })
  const { ref: registerLevelRef, ...levelField } = form.register('level')

  return (
    <DialogForm
      onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      pending={pending}
      dirty={isDirty}
      refusal={refusal}
      submitLabel={t('common.save')}
      pendingLabel={t('common.saving')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${R}.level`)} required error={errors.level?.message}>
          {(field) => (
            <Input
              {...field}
              {...levelField}
              ref={(element) => {
                registerLevelRef(element)
                firstFieldRef.current = element
              }}
              inputMode="numeric"
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField label={t(`${R}.sessions`)} required error={errors.sessions?.message}>
          {(field) => <Input {...field} {...form.register('sessions')} inputMode="numeric" autoComplete="off" />}
        </FormField>
      </div>
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
