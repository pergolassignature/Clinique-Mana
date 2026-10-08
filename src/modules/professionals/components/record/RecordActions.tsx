import { useRef, useState } from 'react'
import { Ban, MailPlus, MoreHorizontal, PowerOff, Send } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { onboardingActionLabel, onboardingActions, type InviteAction } from '../../lib/onboarding'
import { activationLabel, statusActions } from '../../lib/status-actions'
import { ActivateDialog } from './ActivateDialog'
import { DeactivateDialog } from './DeactivateDialog'
import { FicheMenu } from './FicheMenu'
import { InvitationDialog } from './InvitationDialog'
import { useRecordData } from './record-context'
import { RequestUpdateDialog } from './RequestUpdateDialog'
import { focusAfterClose } from './status-dialog'

const R = 'modules.professionals.record.actions'

type MenuDialog = InviteAction | 'revoke' | 'requestUpdate' | 'deactivate'
type OpenDialog = MenuDialog | 'activate'

/**
 * The record header's actions (design §5.3): « Fiche PDF » (every reader of the record, Task 4c.5),
 * the screen's one teal button, « Activer » (« Réactiver » for an inactive file, P4-110) when
 * `statusActions` allows it, and the « … » menu when it holds an item: the invitation (« Envoyer
 * l'invitation », « Renvoyer l'invitation » or « Envoyer un nouveau lien », and « Révoquer
 * l'invitation » while the link works) or « Demander une mise à jour » once there is an account
 * (`onboardingActions`, Task 4b.3), then « Désactiver ». Each item opens its confirmation. A dialog
 * is mounted while open; once it closes, focus goes back to its button, or to the other action
 * when the change took that button away, else to the record's heading.
 */
export function RecordActions() {
  const { record, onboarding, focusHeading } = useRecordData()
  const { can } = useAccess()
  const { activate, deactivate } = statusActions(record, can)
  const { invite, revoke, requestUpdate } = onboardingActions(record.professional, onboarding, can)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const activateButton = useRef<HTMLButtonElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  // The menu item only asks; the dialog opens once the menu has closed (its focus handling done).
  // Cleared each time the menu opens: a request whose close has not come through (the menu reopened
  // first) can never open the dialog later.
  const asked = useRef<MenuDialog | null>(null)

  const close = () => setDialog(null)
  const openers = dialog === 'activate' ? [activateButton, menuButton] : [menuButton, activateButton]
  const restoreFocus = (event: Event) => focusAfterClose(event, openers.map((opener) => opener.current), focusHeading)
  const hasMenu = deactivate || invite !== null || revoke || requestUpdate
  const onboardingItems = invite !== null || revoke || requestUpdate

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <FicheMenu />
        {activate && (
          <Button ref={activateButton} type="button" onClick={() => setDialog('activate')}>
            {activationLabel(activate)}
          </Button>
        )}
        {hasMenu && (
          <DropdownMenu onOpenChange={(open) => open && (asked.current = null)}>
            <DropdownMenuTrigger asChild>
              <Button ref={menuButton} type="button" variant="outline" size="icon" aria-label={t(`${R}.more`)}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                const next = asked.current
                if (!next) return
                asked.current = null
                event.preventDefault()
                setDialog(next)
              }}
            >
              {invite && (
                <DropdownMenuItem onSelect={() => (asked.current = invite)}>
                  <Send className="text-subtle" aria-hidden />
                  {onboardingActionLabel(invite)}
                </DropdownMenuItem>
              )}
              {revoke && (
                <DropdownMenuItem onSelect={() => (asked.current = 'revoke')}>
                  <Ban className="text-subtle" aria-hidden />
                  {onboardingActionLabel('revoke')}
                </DropdownMenuItem>
              )}
              {requestUpdate && (
                <DropdownMenuItem onSelect={() => (asked.current = 'requestUpdate')}>
                  <MailPlus className="text-subtle" aria-hidden />
                  {onboardingActionLabel('requestUpdate')}
                </DropdownMenuItem>
              )}
              {onboardingItems && deactivate && <DropdownMenuSeparator />}
              {/* Not red: destructive only inside the confirmation (design system). */}
              {deactivate && (
                <DropdownMenuItem onSelect={() => (asked.current = 'deactivate')}>
                  <PowerOff className="text-subtle" aria-hidden />
                  {t(`${R}.deactivate`)}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {dialog === 'activate' && <ActivateDialog onClose={close} onCloseAutoFocus={restoreFocus} />}
      {dialog === 'deactivate' && <DeactivateDialog onClose={close} onCloseAutoFocus={restoreFocus} />}
      {dialog === 'requestUpdate' && <RequestUpdateDialog onClose={close} onCloseAutoFocus={restoreFocus} />}
      {(dialog === 'send' || dialog === 'resend' || dialog === 'new_link' || dialog === 'revoke') && (
        <InvitationDialog action={dialog} onClose={close} onCloseAutoFocus={restoreFocus} />
      )}
    </>
  )
}
