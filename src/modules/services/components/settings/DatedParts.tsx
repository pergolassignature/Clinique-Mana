import type { FormEvent, ReactNode, RefObject } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { DateField, type DateFieldBinding } from '@/shared/ui/date-field'
import { DialogClose, DialogFooter } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import type { DatedStatus } from '../../lib/dated'
import { FIRST_DATE, LAST_DATE } from '../../schemas/dated'

/**
 * Pieces the module's dated cards share (rates, policy): a row's status, a refusal where the user
 * acts, a dialog's form footer, the start-date field and the « Supprimer » confirmation
 * (the routing of a refusal to its field: `hooks/use-dialog-refusal.ts`).
 */

const D = 'modules.services.dated'

/** « En vigueur » / « À venir »; nothing for an ended row (its period says it). */
export function DatedStatusBadge({ status }: { status: DatedStatus }) {
  if (status === 'ended') return null
  return <Badge variant={status === 'current' ? 'success' : 'info'}>{t(`${D}.statuses.${status}`)}</Badge>
}

/** A refusal shown where the user acted. */
export function RefusalAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
    </Alert>
  )
}

interface DialogFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pending: boolean
  dirty: boolean
  /** A refusal that belongs to no field, above the buttons. */
  refusal: string | null
  submitLabel?: string
  pendingLabel?: string
  children: ReactNode
}

/**
 * A dialog's form: the fields, a refusal above the buttons, « Annuler » (inactive while saving)
 * and the submit button, outline until something is typed. The form stops its submit event:
 * React would bubble it through the portal into a card's form.
 */
export function DialogForm({ onSubmit, pending, dirty, refusal, submitLabel, pendingLabel, children }: DialogFormProps) {
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.stopPropagation()
        onSubmit(event)
      }}
      className="grid gap-3.5"
    >
      {children}
      {refusal && <RefusalAlert message={refusal} />}
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
          disabled={!dirty}
          variant={dirty || pending ? 'default' : 'outline'}
          label={submitLabel ?? t(`${D}.add`)}
          pendingLabel={pendingLabel ?? t(`${D}.adding`)}
        />
      </DialogFooter>
    </form>
  )
}

interface EffectiveFromFieldProps {
  /** The form's field (`useController`), its `ref` merged with the dialog's first-field ref when needed. */
  input: DateFieldBinding
  error?: string
  /** The earliest start the RPC accepts (the day after the open row's), or null. */
  min: string | null
  help: string
  label?: string
}

/**
 * « À partir du »: a DateField (a `yyyy-MM-dd` string, sent as typed), within the RPCs'
 * 2000–2100 and from the day after the open row's start. A date already past in the clinic is
 * allowed (corrections) but said first, in a polite status.
 */
export function EffectiveFromField({ input, error, min, help, label }: EffectiveFromFieldProps) {
  const today = useClinicDate()
  const value = input.value ?? ''
  const backdated = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value < today
  return (
    <>
      <FormField label={label ?? t(`${D}.from`)} width="sm" help={help} required error={error}>
        {(field) => <DateField {...field} {...input} min={min ?? FIRST_DATE} max={LAST_DATE} />}
      </FormField>
      <div role="status" className="empty:hidden">
        {backdated && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-foreground">{t(`${D}.backdated`)}</AlertDescription>
          </Alert>
        )}
      </div>
    </>
  )
}

interface ConfirmDeleteDialogProps {
  open: boolean
  title: string
  body: string
  pending: boolean
  refusal: string | null
  onConfirm: () => void
  /** Closing is ignored while the deletion runs. */
  onOpenChange: (open: boolean) => void
  /** Where focus goes once closed: the row's button when still there, else this. */
  triggerRef: RefObject<HTMLButtonElement | null>
  fallbackRef: RefObject<HTMLElement | null>
  confirmLabel?: string
  pendingLabel?: string
}

/** The confirmation of a « Supprimer » (destructive). Radix focuses « Annuler » first. A refusal stays inside. */
export function ConfirmDeleteDialog({
  open,
  title,
  body,
  pending,
  refusal,
  onConfirm,
  onOpenChange,
  triggerRef,
  fallbackRef,
  confirmLabel = t(`${D}.delete`),
  pendingLabel = t(`${D}.deleting`),
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const trigger = triggerRef.current
          ;(trigger?.isConnected ? trigger : fallbackRef.current)?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal !== null && <RefusalAlert message={refusal} />}
        <AlertDialogFooter>
          <AlertDialogCancel
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, onConfirm)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
