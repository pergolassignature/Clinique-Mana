import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { useNow } from '@/shared/lib/use-now'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { useProfessionalContract } from '../../hooks/use-contracts'
import { contractProgress } from '../../lib/contract'
import { nextAction, type NextActionButton } from '../../lib/readiness'
import type { InviteAction } from '../../lib/onboarding'
import { ActivateDialog } from './ActivateDialog'
import { CopyInvitationLinkDialog } from './CopyInvitationLinkDialog'
import { InvitationDialog } from './InvitationDialog'
import { useRecordData } from './record-context'
import { focusAfterClose } from './status-dialog'
import { TabLink } from './TabLink'

/**
 * The rail's « Prochaine action »: one sentence and at most one outline button (`nextAction`):
 * a link to the tab that fixes the first gap, « Activer » / « Réactiver » (the header's dialog,
 * P4-74), « Envoyer l'invitation » / « Envoyer un nouveau lien » / « Renvoyer l'invitation » (the
 * invitation's confirmation), or « Réviser le profil » (a link to `REVIEW_TAB`, « Documents »,
 * where the review sheet opens); beside it, when the email did not leave, « Copier le lien
 * d'invitation » (P4-490, P4-491).
 */
export function NextActionCard() {
  const { record, onboarding, focusHeading } = useRecordData()
  const { can } = useAccess()
  const { user_id } = useReadyAccess()
  // A minute is enough: the sentences name days (« expiré le 15 oct. »).
  const now = useNow(60_000)
  // The contract card only when the contract is the last gap (one read then, none otherwise).
  const { readiness } = record
  const contractItem = readiness.items.find((i) => i.key === 'contract_signed')
  const contractLast = !readiness.complete && contractItem !== undefined && !contractItem.done && readiness.items.every((i) => i === contractItem || i.done)
  const contract = useProfessionalContract(record.professional.id, contractLast)
  const { message, action, secondary } = nextAction(record, onboarding, can, now, user_id, contractLast ? contractProgress(contract.data, now) : null)
  const [dialog, setDialog] = useState<'activate' | 'copyLink' | InviteAction | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const secondaryButton = useRef<HTMLButtonElement>(null)
  const opener = dialog === 'copyLink' ? [secondaryButton, button] : [button, secondaryButton]
  const restoreFocus = (event: Event) => focusAfterClose(event, opener.map((b) => b.current), focusHeading)
  const open = (b: NextActionButton) => setDialog(b.kind === 'invite' ? b.action : b.kind === 'copyLink' ? 'copyLink' : 'activate')
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('modules.professionals.record.overview.nextAction.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
        {action?.kind === 'tab' && (
          <Button asChild variant="outline" className="mt-3">
            <TabLink id={record.professional.id} tab={action.tab} unstyled>
              {action.label}
            </TabLink>
          </Button>
        )}
        {(action?.kind === 'activate' || action?.kind === 'invite' || action?.kind === 'copyLink' || secondary?.kind === 'copyLink') && (
          <div className="mt-3 flex flex-wrap gap-2">
            {action && action.kind !== 'tab' && (
              <Button ref={button} type="button" variant="outline" onClick={() => open(action)}>
                {action.label}
              </Button>
            )}
            {secondary && secondary.kind !== 'tab' && (
              <Button ref={secondaryButton} type="button" variant="outline" onClick={() => open(secondary)}>
                {secondary.label}
              </Button>
            )}
          </div>
        )}
        {dialog === 'activate' && <ActivateDialog onClose={() => setDialog(null)} onCloseAutoFocus={restoreFocus} />}
        {dialog === 'copyLink' && <CopyInvitationLinkDialog onClose={() => setDialog(null)} onCloseAutoFocus={restoreFocus} />}
        {dialog !== null && dialog !== 'activate' && dialog !== 'copyLink' && (
          <InvitationDialog action={dialog} onClose={() => setDialog(null)} onCloseAutoFocus={restoreFocus} />
        )}
      </CardContent>
    </Card>
  )
}
