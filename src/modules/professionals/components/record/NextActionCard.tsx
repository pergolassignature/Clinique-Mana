import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { nextAction } from '../../lib/readiness'
import { ActivateDialog } from './ActivateDialog'
import { useRecordData } from './record-context'
import { focusAfterClose } from './status-dialog'
import { TabLink } from './TabLink'

/**
 * Aperçu « Prochaine action »: one sentence and at most one small outline button (`nextAction`):
 * a link to the tab that fixes the first gap, or « Activer » / « Réactiver », which opens the same
 * dialog as the header's teal button (P4-74 closed by 4a.14).
 */
export function NextActionCard() {
  const { record, focusHeading } = useRecordData()
  const { can } = useAccess()
  const { message, action } = nextAction(record, can)
  const [activating, setActivating] = useState(false)
  const activateButton = useRef<HTMLButtonElement>(null)
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
        {action?.kind === 'activate' && (
          <Button ref={activateButton} type="button" variant="outline" size="sm" className="mt-3" onClick={() => setActivating(true)}>
            {action.label}
          </Button>
        )}
        {activating && (
          <ActivateDialog
            onClose={() => setActivating(false)}
            onCloseAutoFocus={(event) => focusAfterClose(event, [activateButton.current], focusHeading)}
          />
        )}
      </CardContent>
    </Card>
  )
}
