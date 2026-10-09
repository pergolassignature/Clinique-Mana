import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
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
 * The refusals after which confirming again cannot work (the record refetched shows why): an
 * account exists (`account`), the file is inactive (`status`), or the link is already gone
 * (`invitation`, « Aucune invitation en cours. »). The dialog then offers « Fermer » only.
 */
const FINAL_REFUSALS: ReadonlySet<string> = new Set(['account', 'status', 'invitation'])

/**
 * The confirmation of an invitation action (Task 4b.3): who, which address, what happens to the
 * link already sent. « Envoyer l'invitation », « Renvoyer l'invitation » and « Envoyer un nouveau
 * lien » email a new link to the file's address and revoke the previous one (the link itself is
 * shown only by « Copier le lien d'invitation », P4-491); « Révoquer l'invitation » stops the link (and closes the questionnaire if one was
 * sent, P4-301), destructive here only. The outcome is a toast. A refusal stays in the dialog, the
 * record refetched; one that a retry cannot change (FINAL_REFUSALS, by HINT) leaves « Fermer »
 * only, as the activation does. One call at a time: a second press before the first one renders
 * as pending is ignored, so a refused double click never hides the first call's success.
 */
export function InvitationDialog({ action, onClose, onCloseAutoFocus }: InvitationDialogProps) {
  const { record, onboarding } = useRecordData()
  const { professional } = record
  const [refusal, setRefusal] = useState<string | null>(null)
  const [final, setFinal] = useState(false)
  const calling = useRef(false)
  const feedback = {
    onErrorMessage: (message: string, error: unknown) => {
      setRefusal(message)
      const hint = rpcErrorHint(error)
      if (hint && FINAL_REFUSALS.has(hint)) setFinal(true)
    },
  }
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
  // Without an account the questionnaire cannot be opened (it is behind the sign-in): revoking
  // closes a sent one only, which is then said.
  const closesQuestionnaire = onboarding?.submission?.status === 'submitted'

  const confirm = () => {
    if (calling.current || final) return
    calling.current = true
    setRefusal(null)
    const settle = {
      onSuccess: onClose,
      onSettled: () => {
        calling.current = false
      },
    }
    if (action === 'revoke') revoke.mutate({ id: professional.id }, settle)
    else send.mutate({ id: professional.id, action, email: professional.email }, settle)
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent aria-busy={pending || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${D}.${action}.title`, values)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(`${D}.${action}.body`, values)}
            {action === 'revoke' && closesQuestionnaire && ` ${t(`${D}.revoke.closesQuestionnaire`)}`}
            {action === 'revoke' && ` ${t(`${D}.revoke.inviteAgain`, values)}`}
            {action === 'revoke' && professional.status === 'invited' && ` ${t(`${D}.revoke.backToDraft`)}`}
            {action !== 'revoke' && days !== undefined && ` ${t(days > 1 ? `${D}.validForOther` : `${D}.validForOne`, { count: String(days) })}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DialogRefusal message={refusal ?? undefined} />
        <AlertDialogFooter>
          <DialogCancel saving={pending} nothingToConfirm={final} />
          {!final && (
            <Button
              type="button"
              variant={action === 'revoke' ? 'destructive' : 'default'}
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending, confirm)}
              className={cn(softDisabledClasses, action === 'revoke' ? 'aria-disabled:hover:bg-destructive' : 'aria-disabled:hover:bg-primary')}
            >
              {pending ? t(action === 'revoke' ? `${D}.revoking` : `${D}.sending`) : onboardingActionLabel(action)}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
