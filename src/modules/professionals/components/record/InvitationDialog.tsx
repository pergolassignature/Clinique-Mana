import { useState } from 'react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { useProfessionalsSettings } from '../../hooks/use-professionals-settings'
import { useRevokeInvitation, useSendInvitation } from '../../hooks/use-invitations'
import { fullName } from '../../lib/display'
import { onboardingActionLabel, shortDate, type InviteAction } from '../../lib/onboarding'
import { useRecordData } from './record-context'
import type { StatusDialogProps } from './status-dialog'
import { DialogCancel, DialogRefusal } from './StatusDialogParts'

const D = 'modules.professionals.onboarding.dialog'

interface InvitationDialogProps extends StatusDialogProps {
  action: InviteAction | 'revoke'
}

/**
 * The confirmation of an invitation action (Task 4b.3): who, which address, what happens to the
 * link already sent. « Envoyer l'invitation », « Renvoyer l'invitation » and « Envoyer un nouveau
 * lien » email a new link to the file's address and revoke the previous one (P4-260: the link is
 * never shown); « Révoquer l'invitation » stops the link and closes the questionnaire in progress
 * (P4-301), destructive here only. The outcome is a toast; a refusal (the file changed meanwhile, a
 * double click) stays in the dialog, the record refetched.
 */
export function InvitationDialog({ action, onClose, onCloseAutoFocus }: InvitationDialogProps) {
  const { record, onboarding } = useRecordData()
  const { professional } = record
  const [refusal, setRefusal] = useState<string | null>(null)
  const feedback = { onErrorMessage: (message: string) => setRefusal(message) }
  const send = useSendInvitation(feedback)
  const revoke = useRevokeInvitation(feedback)
  // The lifetime for « Le lien sera valide 7 jours. » (any professionals permission reads it).
  const settings = useProfessionalsSettings(action !== 'revoke')
  const pending = send.isPending || revoke.isPending
  const now = Date.now()
  const invitation = onboarding?.invitation ?? null
  const values = {
    name: fullName(professional),
    firstName: professional.firstName,
    email: professional.email,
    sent: invitation ? shortDate(invitation.sentAt, now) : '',
    expires: invitation ? shortDate(invitation.expiresAt, now) : '',
  }
  const days = settings.data?.invitationExpiryDays

  const confirm = () => {
    setRefusal(null)
    if (action === 'revoke') revoke.mutate({ id: professional.id }, { onSuccess: onClose })
    else send.mutate({ id: professional.id, action, email: professional.email }, { onSuccess: onClose })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent aria-busy={pending || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${D}.${action}.title`, values)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${D}.${action}.body`, values)}
            {action === 'revoke' && professional.status === 'invited' && ` ${t(`${D}.revoke.backToDraft`)}`}
            {action !== 'revoke' && days !== undefined && ` ${t(days > 1 ? `${D}.validForOther` : `${D}.validForOne`, { count: String(days) })}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DialogRefusal message={refusal ?? undefined} />
        <AlertDialogFooter>
          <DialogCancel saving={pending} nothingToConfirm={false} />
          <Button
            type="button"
            variant={action === 'revoke' ? 'destructive' : 'default'}
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, confirm)}
            className={cn(softDisabledClasses, action === 'revoke' ? 'aria-disabled:hover:bg-destructive' : 'aria-disabled:hover:bg-primary')}
          >
            {pending ? t(action === 'revoke' ? `${D}.revoking` : `${D}.sending`) : onboardingActionLabel(action)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
