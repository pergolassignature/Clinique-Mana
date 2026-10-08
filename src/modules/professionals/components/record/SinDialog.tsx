import { forwardRef, useRef, useState, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { useExpectedVersion, useSaveSin, type Refusal } from '../../hooks/use-private'
import { sinSchema, type SinFormValues } from '../../schemas/private'
import { DialogForm, RefusalAlert } from '../compensation/DatedRowParts'

const N = 'modules.professionals.record.compensation.sin'

interface SinDialogProps {
  professionalId: string
  /** A SIN is stored: « Remplacer », else « Saisir le NAS ». */
  replacing: boolean
  /** The row's version from `get_professional_private`, sent unchanged (P4-148). */
  updatedAt: string | null
}

/**
 * « Saisir le NAS » / « Remplacer »: one field, never prefilled, never autofilled, saved alone
 * with `set_professional_sin` and the version read when the dialog opened. The typed SIN lives in
 * the form inside the dialog's content, so it is gone once the dialog closes; the mutation keeps
 * no variables (`gcTime: 0`). A stale refusal keeps it and says so; the next save goes through.
 */
export const SinDialog = forwardRef<HTMLButtonElement, SinDialogProps>(function SinDialog({ professionalId, replacing, updatedAt }, ref) {
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const version = useExpectedVersion(updatedAt, open)
  const save = useSaveSin(professionalId, (next) => {
    if (next.stale) version.acceptLatest(next.refetched)
    setRefusal(next)
  })
  const field = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (save.isPending) return
    if (!next) {
      save.reset()
      setRefusal(null)
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={ref} type="button" variant="outline" aria-label={replacing ? t(`${N}.replaceLabel`) : undefined}>
          {replacing ? t(`${N}.replace`) : t(`${N}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          field.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{replacing ? t(`${N}.dialog.replaceTitle`) : t(`${N}.dialog.addTitle`)}</DialogTitle>
          <DialogDescription>{t(`${N}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <SinForm
          fieldRef={field}
          pending={save.isPending}
          refusal={refusal}
          onSubmit={({ sin }) => {
            setRefusal(null)
            save.mutate(
              { sin, expectedUpdatedAt: version.expected() },
              {
                onSuccess: (savedAt) => {
                  version.saved(savedAt)
                  setOpen(false)
                  // This component stays mounted (it holds the trigger): let go of the settled
                  // mutation, so the typed SIN leaves React Query now (`gcTime: 0`).
                  save.reset()
                },
              },
            )
          }}
        />
      </DialogContent>
    </Dialog>
  )
})

interface SinFormProps {
  fieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: Refusal | null
  onSubmit: (values: { sin: string }) => void
}

function SinForm({ fieldRef, pending, refusal, onSubmit }: SinFormProps) {
  const form = useForm<SinFormValues, unknown, { sin: string }>({ resolver: zodResolver(sinSchema), defaultValues: { sin: '' } })
  const { errors, isDirty } = form.formState
  const { ref: registerRef, ...sinField } = form.register('sin')
  return (
    <DialogForm
      onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      pending={pending}
      dirty={isDirty}
      refusal={null}
      submitLabel={t('common.save')}
      pendingLabel={t('common.saving')}
    >
      <FormField label={t(`${N}.dialog.field`)} help={t(`${N}.dialog.help`)} required error={errors.sin?.message}>
        {(props) => (
          <Input
            {...props}
            {...sinField}
            ref={(element) => {
              registerRef(element)
              fieldRef.current = element
            }}
            inputMode="numeric"
            autoComplete="off"
            // Password managers ignore autocomplete="off": keep them from saving or filling it.
            data-1p-ignore
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            spellCheck={false}
            translate="no"
            maxLength={20}
          />
        )}
      </FormField>
      {refusal && <RefusalAlert message={refusal.message} detail={refusal.detail} />}
    </DialogForm>
  )
}
