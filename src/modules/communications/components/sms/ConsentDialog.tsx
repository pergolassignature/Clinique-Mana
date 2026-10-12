import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import type { SmsConsentStatus } from '../../api/sms'
import { useSetSmsConsent } from '../../hooks/use-sms'
import { formatPhone } from '../../lib/phone'
import { consentSchema, type ConsentValues } from '../../schemas/sms'

const C = 'modules.communications.sms.consent'

interface ConsentDialogProps {
  /** `opted_in`: « Enregistrer le consentement »; `opted_out`: « Retirer le consentement ». */
  status: SmsConsentStatus
  /** The thread's number (E.164); omitted for « Nouveau numéro », where it is typed. */
  phone?: string
  /** The consent in force before (an `opted_in` over an existing one sends no new consent text). */
  current?: SmsConsentStatus | null
  trigger: ReactNode
  /** Once saved: the number as stored (E.164), so a new number's thread opens. */
  onSaved?: (phone: string) => void
}

/**
 * The staff's consent entry (`set_sms_consent`, communications.sms): a consent given (by phone, in
 * person; the note says how) queues the clinic's consent text, which says how to withdraw; a
 * withdrawal stops every text to the number. While saving the dialog stays open; a refusal shows
 * under the number or above the buttons.
 */
export function ConsentDialog({ status, phone, current = null, trigger, onSaved }: ConsentDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const grant = status === 'opted_in'
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(grant ? `${C}.dialogTitle` : `${C}.withdrawTitle`)}</DialogTitle>
          <DialogDescription>{t(grant ? `${C}.dialogDescription` : `${C}.withdrawDescription`)}</DialogDescription>
        </DialogHeader>
        <ConsentForm
          status={status}
          phone={phone}
          current={current}
          onPendingChange={setPending}
          onSaved={(saved) => {
            setOpen(false)
            onSaved?.(saved)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConsentForm({
  status,
  phone,
  current,
  onPendingChange,
  onSaved,
}: Pick<ConsentDialogProps, 'status' | 'phone' | 'current'> & { onPendingChange: (pending: boolean) => void; onSaved: (phone: string) => void }) {
  const grant = status === 'opted_in'
  const form = useForm<ConsentValues, unknown, { phone: string; note: string }>({
    resolver: zodResolver(consentSchema),
    defaultValues: { phone: phone ? formatPhone(phone) : '', note: '' },
  })
  const mutation = useSetSmsConsent()
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !mutation.isPending)

  const submit = form.handleSubmit(async (values) => {
    onPendingChange(true)
    try {
      const saved = await mutation.mutateAsync({ phone: values.phone, status, note: values.note || null })
      toast.success(t(!grant ? `${C}.withdrawn` : current === 'opted_in' ? `${C}.savedAgain` : `${C}.saved`))
      onSaved(saved.phone)
    } catch (error) {
      form.setError(phone ? 'root.server' : 'phone', { message: moduleErrorMessage(error, t(`${C}.error`), 'communications') }, { shouldFocus: !phone })
    } finally {
      onPendingChange(false)
    }
  })

  const pending = mutation.isPending
  const alert = errors.root?.server?.message
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-3.5" aria-busy={pending || undefined}>
      {phone ? (
        <p className="text-sm text-foreground">
          <span className="text-muted-foreground">{t(`${C}.phone`)} : </span>
          <span className="tabular font-medium">{formatPhone(phone)}</span>
        </p>
      ) : (
        <FormField label={t(`${C}.phone`)} required error={errors.phone?.message}>
          {(field) => <Input {...field} {...form.register('phone')} type="tel" inputMode="tel" autoComplete="off" autoFocus className="tabular w-48 max-w-full" />}
        </FormField>
      )}
      <FormField label={t(grant ? `${C}.note` : `${C}.withdrawNote`)} help={t(`${C}.noteHelp`)} error={errors.note?.message}>
        {(field) => <Textarea {...field} {...form.register('note')} rows={2} className="min-h-16" />}
      </FormField>
      {alert && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{alert}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <SaveButton
          pending={pending}
          label={t(grant ? `${C}.submit` : `${C}.withdrawSubmit`)}
          pendingLabel={t(grant ? `${C}.submitting` : `${C}.withdrawing`)}
        />
      </DialogFooter>
    </form>
  )
}
