import { type FormEvent, type ReactNode, type RefObject } from 'react'
import type { UseFormRegisterReturn } from 'react-hook-form'
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
import { DialogClose, DialogFooter } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { DatedStatus } from '../../lib/compensation'
import { FIRST_DATE, LAST_DATE } from '../../schemas/compensation'

/**
 * Pieces shared by the compensation cards of the record and of « Paramètres → Rémunération »:
 * a row's status, the « Supprimer » confirmation, a dialog's form footer, the start-date field and
 * the refusal shown in a card or a dialog.
 */

const W = 'modules.professionals.compensation'

/** « En vigueur » / « À venir »; nothing for an ended row (its period says it). */
export function DatedStatusBadge({ status }: { status: DatedStatus }) {
  if (status === 'ended') return null
  return <Badge variant={status === 'current' ? 'success' : 'info'}>{t(`${W}.statuses.${status}`)}</Badge>
}

/** A refusal shown where the user acted: the message, and the readable HINT under it. */
export function RefusalAlert({ message, detail }: { message: string; detail?: string | null }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">
        {message}
        {detail && <span className="mt-0.5 block text-muted-foreground">{detail}</span>}
      </AlertDescription>
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
 * A dialog's form: the fields, a refusal above the buttons, « Annuler » (inactive while saving:
 * the outcome is always seen) and the submit button, outline until something is typed. The form
 * stops its submit event: React would bubble it through the portal into a card's form.
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
          label={submitLabel ?? t(`${W}.add`)}
          pendingLabel={pendingLabel ?? t(`${W}.adding`)}
        />
      </DialogFooter>
    </form>
  )
}

interface EffectiveFromFieldProps {
  registration: UseFormRegisterReturn
  /** The typed value (`useWatch`), for the backdated warning. */
  value: string
  error?: string
  /** The earliest start the RPC accepts (the day after the open row's), or null. */
  min: string | null
  help: string
}

/**
 * « À partir du »: a native date input (a `yyyy-MM-dd` string, sent as typed), within the
 * RPCs' 2000–2100 and from the day after the open row's start. A date already past in the clinic is allowed (corrections, P4-151)
 * but said first, in a polite status.
 */
export function EffectiveFromField({ registration, value, error, min, help }: EffectiveFromFieldProps) {
  const today = useClinicDate()
  const backdated = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value < today
  return (
    <>
      <FormField label={t(`${W}.from`)} help={help} required error={error}>
        {(field) => <Input {...field} {...registration} type="date" min={min ?? FIRST_DATE} max={LAST_DATE} />}
      </FormField>
      <div role="status" className="empty:hidden">
        {backdated && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-foreground">{t(`${W}.backdated`)}</AlertDescription>
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
  /** The refusal's readable HINT (an unreadable kept value says how to fix it, P4-142). */
  refusalDetail?: string | null
  onConfirm: () => void
  /** Closing is ignored while the deletion runs. */
  onOpenChange: (open: boolean) => void
  /** Where focus goes once closed: the row's « Supprimer » when still there, else this. */
  triggerRef: RefObject<HTMLButtonElement | null>
  fallbackRef: RefObject<HTMLElement | null>
  confirmLabel?: string
  pendingLabel?: string
}

/**
 * The confirmation of a « Supprimer » or « Retirer » (destructive only here, design system).
 * Radix focuses « Annuler » first: keeping the row is the safe default. A refusal stays inside.
 */
export function ConfirmDeleteDialog({
  open,
  title,
  body,
  pending,
  refusal,
  refusalDetail,
  onConfirm,
  onOpenChange,
  triggerRef,
  fallbackRef,
  confirmLabel = t(`${W}.delete`),
  pendingLabel = t(`${W}.deleting`),
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
        {refusal !== null && <RefusalAlert message={refusal} detail={refusalDetail} />}
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
