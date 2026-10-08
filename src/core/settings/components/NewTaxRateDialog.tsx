import { forwardRef, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { CircleAlert, Plus, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import type { Tax } from '@/core/settings/tax/api'
import { useAddTaxRate } from '@/core/settings/tax/hooks'
import { lastDayOf } from '@/core/settings/tax/rates'
import { isCalendarDate, newTaxRateSchema } from '@/core/settings/tax/schemas'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'

type FormValues = z.input<typeof newTaxRateSchema>

interface NewTaxRateDialogProps {
  tax: Tax
  /** « TPS » / « TVQ », for the title. */
  taxLabel: string
  /**
   * The earliest start `add_tax_rate` accepts (the day after the open rate's start), or null when
   * unknown: the date picker starts there, and an earlier date is refused before any request.
   */
  minDate: string | null
}

/**
 * « Nouveau taux »: the card's outline button and its dialog. The form lives inside the dialog's
 * content, so each opening starts empty. While the rate is being added the dialog cannot be
 * closed, so its outcome is always seen: success closes it (with a toast), a refusal stays in it.
 */
export const NewTaxRateDialog = forwardRef<HTMLButtonElement, NewTaxRateDialogProps>(function NewTaxRateDialog({ tax, taxLabel, minDate }, ref) {
  const [open, setOpen] = useState(false)
  const add = useAddTaxRate()
  const rateRef = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (add.isPending) return
    if (!next) add.reset()
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={ref} type="button" variant="outline">
          <Plus aria-hidden />
          {t('settings.tax.rates.add')}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // The rate first, whatever Radix would pick.
          event.preventDefault()
          rateRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('settings.tax.dialog.title', { tax: taxLabel })}</DialogTitle>
          <DialogDescription>{t('settings.tax.dialog.description')}</DialogDescription>
        </DialogHeader>
        <NewTaxRateForm
          tax={tax}
          minDate={minDate}
          rateRef={rateRef}
          pending={add.isPending}
          error={add.isError ? moduleErrorMessage(add.error, t('common.errors.generic'), 'settings') : null}
          onSubmit={({ rate, effective_from }) =>
            add.mutate({ tax, rate, effectiveFrom: effective_from }, { onSuccess: () => setOpen(false) })
          }
        />
      </DialogContent>
    </Dialog>
  )
})

interface NewTaxRateFormProps {
  tax: Tax
  minDate: string | null
  rateRef: RefObject<HTMLInputElement | null>
  pending: boolean
  /** The refusal to show (already through `moduleErrorMessage`), or null. */
  error: string | null
  onSubmit: (values: z.output<typeof newTaxRateSchema>) => void
}

function NewTaxRateForm({ tax, minDate, rateRef, pending, error, onSubmit }: NewTaxRateFormProps) {
  const form = useForm<FormValues, unknown, z.output<typeof newTaxRateSchema>>({
    resolver: zodResolver(newTaxRateSchema),
    defaultValues: { tax, rate: '', effective_from: '' },
  })
  const { errors, isDirty } = form.formState
  const { ref: registerRateRef, ...rateField } = form.register('rate')
  const effectiveFrom = useWatch({ control: form.control, name: 'effective_from' })
  // A start date already past in the clinic: allowed on purpose (corrections), but said first.
  const backdated = isCalendarDate(effectiveFrom) && effectiveFrom < getClinicDateString(new Date())

  const submit = form.handleSubmit((values) => {
    // The obvious refusal of add_tax_rate, caught here; the database still decides (another admin
    // may have added a rate since the page loaded).
    if (minDate !== null && values.effective_from < minDate) {
      // The open rate's start is the day before minDate.
      const openStart = formatDateOnlyShort(lastDayOf(minDate))
      form.setError('effective_from', { message: t('settings.tax.validation.afterOpen', { date: openStart }) }, { shouldFocus: true })
      return
    }
    onSubmit(values)
  })

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('settings.tax.dialog.rate')} required error={errors.rate?.message}>
          {(field) => (
            <Input
              {...field}
              {...rateField}
              ref={(element) => {
                registerRateRef(element)
                rateRef.current = element
              }}
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField
          label={t('settings.tax.dialog.from')}
          help={t('settings.tax.dialog.fromHelp')}
          required
          error={errors.effective_from?.message}
        >
          {(field) => <Input {...field} {...form.register('effective_from')} type="date" min={minDate ?? undefined} />}
        </FormField>
      </div>
      {/* Always rendered, so screen readers announce the warning when it appears. */}
      <div role="status" className="empty:hidden">
        {backdated && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-foreground">{t('settings.tax.dialog.backdated')}</AlertDescription>
          </Alert>
        )}
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{error}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            // While adding, the press is cancelled (Radix then does not close the dialog).
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
        </DialogClose>
        {/* Outline until something is typed (brand rule), like the cards' « Enregistrer ». */}
        <SaveButton
          pending={pending}
          disabled={!isDirty}
          variant={isDirty || pending ? 'default' : 'outline'}
          label={t('settings.tax.dialog.submit')}
          pendingLabel={t('settings.tax.dialog.submitting')}
        />
      </DialogFooter>
    </form>
  )
}
