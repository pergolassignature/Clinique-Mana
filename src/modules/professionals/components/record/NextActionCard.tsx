import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import type { ProfessionalRecord } from '../../api/parse'
import { nextAction } from '../../lib/readiness'
import { TabLink } from './TabLink'

interface NextActionCardProps {
  record: Pick<ProfessionalRecord, 'professional' | 'readiness'>
  can: (permission: string) => boolean
}

/** Aperçu « Prochaine action »: one sentence and at most one small outline button (`nextAction`). */
export function NextActionCard({ record, can }: NextActionCardProps) {
  const { message, action } = nextAction(record, can)
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t('modules.professionals.record.overview.nextAction.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
        {action && (
          <Button asChild variant="outline" size="sm" className="mt-3">
            <TabLink id={record.professional.id} tab={action.tab} unstyled>
              {action.label}
            </TabLink>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
