import { createContext, useContext } from 'react'
import type { Onboarding, ProfessionalRecord } from '../../api/parse'
import type { CatalogView } from '../../lib/catalog-view'

/**
 * What every record tab reads: the record (one `get_professional_record` payload), its onboarding
 * line and the cached catalogue that names its ids. The page provides it once both have loaded, so the tabs (lazyPage
 * components: no props) never fetch the record again nor render half-loaded.
 */
export interface RecordData {
  record: ProfessionalRecord
  catalog: CatalogView
  /**
   * The invitation and the open submission (`get_professional_onboarding`, P4-270), loaded in the
   * same tick as the record; null for a file with neither.
   */
  onboarding: Onboarding | null
  /**
   * Moves focus to the record's heading (the h1, focusable but not tabbable): where a closed
   * dialog sends focus when the button that opened it is gone (« Activer » once active).
   */
  focusHeading: () => void
}

export const RecordContext = createContext<RecordData | null>(null)

/** The open record; only inside `ProfessionalRecordPage`'s panels. */
export function useRecordData(): RecordData {
  const value = useContext(RecordContext)
  if (!value) throw new Error('useRecordData: outside a professional record')
  return value
}
