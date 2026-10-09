import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusDot } from '@/shared/ui/status-dot'
import type { Onboarding, ProfessionalRecord } from '../../api/parse'
import { recordWatchSubject, WATCH_TAB, watchFlags } from '../../lib/watch'
import { TabLink } from './TabLink'

const W = 'modules.professionals.record.overview.watch'

interface WatchCardProps {
  record: Pick<ProfessionalRecord, 'professional' | 'readiness'>
  onboarding: Onboarding | null
  now: number
}

/**
 * Aperçu « À surveiller »: the list's flags (`watchFlags`), each a link to the tab that settles it;
 * a flag settled on Aperçu itself (the invitation, « Prochaine action ») is plain text.
 */
export function WatchCard({ record, onboarding, now }: WatchCardProps) {
  const flags = watchFlags(recordWatchSubject(record, onboarding), now)
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
            {flags.map((flag) => {
              const tab = WATCH_TAB[flag.key]
              const tone = cn(flag.tone === 'danger' && 'text-destructive')
              return (
                <li key={flag.key} className="flex items-center gap-2 text-sm">
                  <StatusDot tone={flag.tone === 'danger' ? 'error' : 'neutral'} />
                  {tab ? (
                    <TabLink id={record.professional.id} tab={tab} className={tone}>
                      {flag.label}
                    </TabLink>
                  ) : (
                    <span className={tone}>{flag.label}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
