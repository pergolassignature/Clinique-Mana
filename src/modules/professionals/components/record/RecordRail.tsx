import { useMemo, type ReactNode } from 'react'
import { t } from '@/i18n'
import { useNow } from '@/shared/lib/use-now'
import { cn } from '@/shared/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import type { RecordTab } from '../../lib/constants'
import { placesLabel } from '../../lib/display'
import { matchingDigest } from '../../lib/matching-digest'
import { NextActionCard } from './NextActionCard'
import { ReadinessCard } from './ReadinessCard'
import { WatchCard } from './WatchCard'
import { useRecordData } from './record-context'

const B = 'modules.professionals.record.rail'
const M = 'modules.professionals.record.overview.matching'

/**
 * How the rail is laid out: `column` beside the tab from `xl` (sticky, « En bref » too on the tabs
 * that do not already show it), `tiles` three in a row above the tab from `md`, `stack` under
 * Aperçu's digest on a phone.
 */
export type RailLayout = 'column' | 'tiles' | 'stack'

interface RecordRailProps {
  tab: RecordTab
  layout: RailLayout
}

/**
 * The record's summary (audit 2026-10-09 §2.7), on every tab: « Dossier », « À surveiller » and
 * « Prochaine action », so the conseillère sees what is missing and what comes next while she
 * edits; « En bref » adds the places and the availability where Aperçu's digest and Jumelage do
 * not show them. Everything comes from the record bundle (`useRecordData`, no request of its own;
 * « Prochaine action » reads the contract only when it is the last gap).
 */
export function RecordRail({ tab, layout }: RecordRailProps) {
  const { record, onboarding, catalog } = useRecordData()
  // The invitation's lines name days (« sans réponse depuis 4 jours »): a minute is enough.
  const now = useNow(60_000)
  const brief = layout === 'column' && tab !== 'apercu' && tab !== 'jumelage'
  return (
    <section
      aria-label={t(`${B}.label`)}
      className={cn(
        'min-w-0',
        layout === 'column' && 'flex flex-col gap-4',
        layout === 'tiles' && 'grid grid-cols-3 items-start gap-4',
        layout === 'stack' && 'flex flex-col gap-5',
      )}
    >
      <ReadinessCard record={record} onboarding={onboarding} now={now} catalog={catalog} />
      <WatchCard record={record} onboarding={onboarding} now={now} />
      <NextActionCard />
      {brief && <BriefCard />}
    </section>
  )
}

/** « En bref »: the places offered, new clients, the availability (the digest's lines, P4-382). */
function BriefCard() {
  const { record, catalog } = useRecordData()
  const digest = useMemo(() => matchingDigest(record, catalog), [record, catalog])
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{t(`${B}.brief`)}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border-light">
          <Row label={t(`${M}.places`)}>
            <Muted when={digest.newClientPlaces === null}>{placesLabel(digest.newClientPlaces, digest.newClientPlacesSetAt, Date.now())}</Muted>
          </Row>
          <Row label={t(`${B}.accepting`)}>{t(digest.acceptingNewClients ? `${M}.yes` : `${M}.no`)}</Row>
          <Row label={t(`${B}.availability`)}>
            <Muted when={!digest.periods}>{digest.periods || t(`${M}.empty.availability`)}</Muted>
          </Row>
        </dl>
      </CardContent>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 py-1.5 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

function Muted({ when, children }: { when: boolean; children: ReactNode }) {
  return when ? <span className="text-muted-foreground">{children}</span> : children
}
