import { Fragment, type ReactNode } from 'react'
import { t } from '@/i18n'
import { StatusIndicator } from '@/shared/components/StatusIndicator'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import type { Onboarding, ProfessionalRecord, ReadinessItem } from '../../api/parse'
import { invitationLine, questionnaireLine } from '../../lib/onboarding'
import { MISSING_TAB, missingLabel, readinessItemLabel } from '../../lib/readiness'
import { TabLink } from './TabLink'

const R = 'modules.professionals.record.overview.readiness'

interface ReadinessCardProps {
  record: Pick<ProfessionalRecord, 'professional' | 'readiness'>
  onboarding: Onboarding | null
  now: number
}

/**
 * Aperçu « Dossier »: each readiness item with what it lacks, every gap a link to the tab that
 * fixes it; the account's line says where the invitation stands (« Invitation envoyée le 8 oct. ·
 * expire le 15 oct. », A2.5) and the questionnaire's where it is (Task 4b.3). An active file shows
 * one line: « Dossier complet », or the override reason when it was activated incomplete (and the
 * gaps, while there are any).
 */
export function ReadinessCard({ record, onboarding, now }: ReadinessCardProps) {
  const { professional, readiness } = record
  const active = professional.status === 'active'
  const describe = (item: ReadinessItem): ReactNode => {
    if (item.key === 'account_created') return professional.profileId === null || onboarding?.invitation?.state === 'used' ? invitationLine(onboarding?.invitation ?? null, now) : undefined
    if (item.key === 'submission_approved') return item.done ? undefined : (questionnaireLine(professional, onboarding, now) ?? undefined)
    return item.done || item.missing.length === 0 ? undefined : <Missing id={professional.id} item={item} />
  }
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
              <StatusIndicator key={item.key} status={item.done ? 'complete' : 'pending'} label={readinessItemLabel(item.key, item.done)} description={describe(item)} />
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
