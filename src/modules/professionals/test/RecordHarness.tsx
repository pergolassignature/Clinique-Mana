import type { ReactNode } from 'react'
import { RecordContext } from '../components/record/record-context'
import { useProfessionalRecord } from '../hooks/use-professional-record'
import type { CatalogView } from '../lib/catalog-view'
import { IDS } from './fixtures'

/** Reads the record from the cache, as the record page does, so saves and refetches reach the tab. Test-only. */
export function RecordHarness({ catalog, children }: { catalog: CatalogView; children: ReactNode }) {
  const { data } = useProfessionalRecord(IDS.professional)
  return data ? <RecordContext.Provider value={{ record: data, catalog }}>{children}</RecordContext.Provider> : null
}
