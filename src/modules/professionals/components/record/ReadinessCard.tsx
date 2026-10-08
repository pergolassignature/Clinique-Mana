import { Fragment } from 'react'
import { t } from '@/i18n'
import { StatusIndicator } from '@/shared/components/StatusIndicator'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import type { ProfessionalRecord, ReadinessItem } from '../../api/parse'
import { MISSING_TAB, missingLabel, readinessItemLabel } from '../../lib/readiness'
import { TabLink } from './TabLink'

const R = 'modules.professionals.record.overview.readiness'

/**
 * Aperçu « Dossier »: each readiness item with what it lacks, every gap a link to the tab that
 * fixes it. An active file shows one line: « Dossier complet », or the override reason when it
 * was activated incomplete (and the gaps, while there are any).
 */
export function ReadinessCard({ record }: { record: Pick<ProfessionalRecord, 'professional' | 'readiness'> }) {
  const { professional, readiness } = record
  const active = professional.status === 'active'
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t(`${R}.title`)}</CardTitle>
      </CardHeader>
      <CardContent className="[&>*:last-child]:border-b-0">
        {active && readiness.complete ? (
          <StatusIndicator status="complete" label={t(`${R}.complete`)} />
        ) : (
          <>
            {active && professional.activationOverrideReason && (
              <p className="pb-1.5 text-sm text-muted-foreground">{t(`${R}.override`, { reason: professional.activationOverrideReason })}</p>
            )}
            {readiness.items.map((item) => (
              <StatusIndicator
                key={item.key}
                status={item.done ? 'complete' : 'pending'}
                label={readinessItemLabel(item.key)}
                description={item.done || item.missing.length === 0 ? undefined : <Missing id={professional.id} item={item} />}
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** « Il manque : une clientèle, un motif », each part a link to its tab. */
function Missing({ id, item }: { id: string; item: ReadinessItem }) {
  return (
    <>
      {t(`${R}.missing`)}{' '}
      {item.missing.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && ', '}
          <TabLink id={id} tab={MISSING_TAB[key]}>
            {missingLabel(key)}
          </TabLink>
        </Fragment>
      ))}
    </>
  )
}
