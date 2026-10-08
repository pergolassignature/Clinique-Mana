import { useAccess } from '@/core/access/access-context'
import { MatchingDigest } from '../MatchingDigest'
import { NextActionCard } from '../NextActionCard'
import { ReadinessCard } from '../ReadinessCard'
import { WatchCard } from '../WatchCard'
import { useRecordData } from '../record-context'

/**
 * « Aperçu » (design system §5): the matching digest on the left, the file's state on the right
 * (`minmax(0,2fr) minmax(240px,1fr)`, gap 20), one column under 1100px like every two-column
 * screen of the design system. Everything comes from the record bundle: no request of its own.
 */
export function OverviewTab() {
  const { record, catalog } = useRecordData()
  const { can } = useAccess()
  return (
    <div className="grid gap-5 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
      <MatchingDigest record={record} catalog={catalog} canEdit={can('professionals.matching')} />
      <div className="flex min-w-0 flex-col gap-5">
        <ReadinessCard record={record} />
        <WatchCard record={record} />
        <NextActionCard />
      </div>
    </div>
  )
}
