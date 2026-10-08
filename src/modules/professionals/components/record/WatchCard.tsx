import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusDot } from '@/shared/ui/status-dot'
import type { ProfessionalRecord } from '../../api/parse'
import { recordWatchSubject, WATCH_TAB, watchFlags } from '../../lib/watch'
import { TabLink } from './TabLink'

const W = 'modules.professionals.record.overview.watch'

/** Aperçu « À surveiller »: the list's flags (`watchFlags`), each a link to the tab that settles it. */
export function WatchCard({ record }: { record: Pick<ProfessionalRecord, 'professional' | 'readiness'> }) {
  const flags = watchFlags(recordWatchSubject(record))
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t(`${W}.title`)}</CardTitle>
      </CardHeader>
      <CardContent>
        {flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${W}.nothing`)}</p>
        ) : (
          <ul className="space-y-1.5">
            {flags.map((flag) => (
              <li key={flag.key} className="flex items-center gap-2 text-sm">
                <StatusDot tone={flag.tone === 'danger' ? 'error' : 'neutral'} />
                <TabLink id={record.professional.id} tab={WATCH_TAB[flag.key]} className={cn(flag.tone === 'danger' && 'text-destructive')}>
                  {flag.label}
                </TabLink>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
