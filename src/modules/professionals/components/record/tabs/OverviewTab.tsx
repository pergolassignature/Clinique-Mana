import { useAccess } from '@/core/access/access-context'
import { MatchingDigest } from '../MatchingDigest'
import { useRecordData } from '../record-context'

/**
 * « Aperçu »: the matching digest. The file's state (« Dossier », « À surveiller », « Prochaine
 * action ») is the record's rail, shown on every tab (`RecordRail`). Everything comes from the
 * record bundle: no request of its own.
 */
export function OverviewTab() {
  const { record, catalog } = useRecordData()
  const { can } = useAccess()
  return <MatchingDigest record={record} catalog={catalog} canEdit={can('professionals.matching')} />
}
