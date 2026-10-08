import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useNow } from '@/shared/lib/use-now'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { nextAction } from '../../lib/readiness'
import type { InviteAction } from '../../lib/onboarding'
import { ActivateDialog } from './ActivateDialog'
import { InvitationDialog } from './InvitationDialog'
import { useRecordData } from './record-context'
import { focusAfterClose } from './status-dialog'
import { TabLink } from './TabLink'

/**
 * Aperçu « Prochaine action »: one sentence and at most one small outline button (`nextAction`):
 * a link to the tab that fixes the first gap, « Activer » / « Réactiver » (the header's dialog,
 * P4-74), « Envoyer l'invitation » / « Envoyer un nouveau lien » (the invitation's confirmation),
 * or « Réviser le profil » (a link to `REVIEW_TAB` once 4b.5 sets it).
 */
export function NextActionCard() {
  const { record, onboarding, focusHeading } = useRecordData()
  const { can } = useAccess()
  // A minute is enough: the sentences name days (« expiré le 15 oct. »).
  const now = useNow(60_000)
  const { message, action } = nextAction(record, onboarding, can, now)
  const [dialog, setDialog] = useState<'activate' | InviteAction | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const restoreFocus = (event: Event) => focusAfterClose(event, [button.current], focusHeading)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('modules.professionals.record.overview.nextAction.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
        {action?.kind === 'tab' && (
          <Button asChild variant="outline" size="sm" className="mt-3">
            <TabLink id={record.professional.id} tab={action.tab} unstyled>
              {action.label}
            </TabLink>
          </Button>
        )}
        {(action?.kind === 'activate' || action?.kind === 'invite') && (
          <Button
            ref={button}
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setDialog(action.kind === 'invite' ? action.action : 'activate')}
          >
            {action.label}
          </Button>
        )}
        {dialog === 'activate' && <ActivateDialog onClose={() => setDialog(null)} onCloseAutoFocus={restoreFocus} />}
        {dialog !== null && dialog !== 'activate' && <InvitationDialog action={dialog} onClose={() => setDialog(null)} onCloseAutoFocus={restoreFocus} />}
      </CardContent>
    </Card>
  )
}
