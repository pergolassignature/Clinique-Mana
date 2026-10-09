import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { useCancelSubmission } from '../../hooks/use-submissions'
import { fullName } from '../../lib/display'
import { useRecordData } from './record-context'
import type { StatusDialogProps } from './status-dialog'
import { DialogCancel, DialogRefusal } from './StatusDialogParts'

const D = 'modules.professionals.submission.cancelDialog'

/**
 * « Fermer la demande » (P4-421): closes an open update without applying it, so a new one can be
 * asked for. A refusal (closed or decided meanwhile) stays in the dialog with « Fermer » only; the
 * record and its submissions are refetched either way. One call at a time.
 */
export function CancelSubmissionDialog({ submissionId, onClose, onCloseAutoFocus }: StatusDialogProps & { submissionId: string }) {
  const { record } = useRecordData()
  const { professional } = record
  const [refusal, setRefusal] = useState<string | null>(null)
  const calling = useRef(false)
  const cancel = useCancelSubmission({ onErrorMessage: (message) => setRefusal(message) })
  const pending = cancel.isPending
  const values = { name: fullName(professional), firstName: professional.firstName }

  const confirm = () => {
    if (calling.current || refusal) return
    calling.current = true
    cancel.mutate(
      { professionalId: professional.id, submissionId, firstName: professional.firstName },
      {
        onSuccess: onClose,
        onSettled: () => {
          calling.current = false
        },
      },
    )
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent aria-busy={pending || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${D}.title`, values)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${D}.body`, values)}</AlertDialogDescription>
        </AlertDialogHeader>
        <DialogRefusal message={refusal ?? undefined} />
        <AlertDialogFooter>
          <DialogCancel saving={pending} nothingToConfirm={refusal !== null} />
          {refusal === null && (
            <Button
              type="button"
              variant="destructive"
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending, confirm)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
            >
              {pending ? t(`${D}.closing`) : t(`${D}.confirm`)}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
