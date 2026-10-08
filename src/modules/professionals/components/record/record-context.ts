import { createContext, useContext } from 'react'
import type { ProfessionalRecord } from '../../api/parse'
import type { CatalogView } from '../../lib/catalog-view'

/**
 * What every record tab reads: the record (one `get_professional_record` payload) and the cached
 * catalogue that names its ids. The page provides it once both have loaded, so the tabs (lazyPage
 * components: no props) never fetch the record again nor render half-loaded.
 */
export interface RecordData {
  record: ProfessionalRecord
  catalog: CatalogView
}

export const RecordContext = createContext<RecordData | null>(null)

/** The open record; only inside `ProfessionalRecordPage`'s panels. */
export function useRecordData(): RecordData {
  const value = useContext(RecordContext)
  if (!value) throw new Error('useRecordData: outside a professional record')
  return value
}
