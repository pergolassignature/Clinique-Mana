import { useRef, useState } from 'react'
import { MoreHorizontal, PowerOff } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { activationLabel, statusActions } from '../../lib/status-actions'
import { ActivateDialog } from './ActivateDialog'
import { DeactivateDialog } from './DeactivateDialog'
import { FicheMenu } from './FicheMenu'
import { useRecordData } from './record-context'
import { focusAfterClose } from './status-dialog'

const R = 'modules.professionals.record.actions'

/**
 * The record header's actions (design §5.3): « Fiche PDF » (every reader of the record, Task 4c.5),
 * the screen's one teal button, « Activer » (« Réactiver » for an inactive file, P4-110) when
 * `statusActions` allows it, and the « … » menu, which holds « Désactiver » for now (4b adds
 * « Renvoyer l'invitation », « Demander une mise à jour »). A dialog
 * is mounted while open; once it closes, focus goes back to its button, or to the other action
 * when the status change took that button away, else to the record's heading.
 */
export function RecordActions() {
  const { record, focusHeading } = useRecordData()
  const { can } = useAccess()
  const { activate, deactivate } = statusActions(record, can)
  const [dialog, setDialog] = useState<'activate' | 'deactivate' | null>(null)
  const activateButton = useRef<HTMLButtonElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  // The menu item only asks; the dialog opens once the menu has closed (its focus handling done).
  // Cleared each time the menu opens: a request whose close has not come through (the menu reopened
  // first) can never open the dialog later.
  const deactivateAsked = useRef(false)

  const close = () => setDialog(null)
  const openers = dialog === 'deactivate' ? [menuButton, activateButton] : [activateButton, menuButton]
  const restoreFocus = (event: Event) => focusAfterClose(event, openers.map((opener) => opener.current), focusHeading)

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <FicheMenu />
        {activate && (
          <Button ref={activateButton} type="button" onClick={() => setDialog('activate')}>
            {activationLabel(activate)}
          </Button>
        )}
        {deactivate && (
          <DropdownMenu onOpenChange={(open) => open && (deactivateAsked.current = false)}>
            <DropdownMenuTrigger asChild>
              <Button ref={menuButton} type="button" variant="outline" size="icon" aria-label={t(`${R}.more`)}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (!deactivateAsked.current) return
                deactivateAsked.current = false
                event.preventDefault()
                setDialog('deactivate')
              }}
            >
              {/* Not red: destructive only inside the confirmation (design system). */}
              <DropdownMenuItem onSelect={() => (deactivateAsked.current = true)}>
                <PowerOff className="text-subtle" aria-hidden />
                {t(`${R}.deactivate`)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {dialog === 'activate' && <ActivateDialog onClose={close} onCloseAutoFocus={restoreFocus} />}
      {dialog === 'deactivate' && <DeactivateDialog onClose={close} onCloseAutoFocus={restoreFocus} />}
    </>
  )
}
