import type { ReactNode } from 'react'
import { RecordContext } from '../components/record/record-context'
import { useProfessionalRecord } from '../hooks/use-professional-record'
import type { CatalogView } from '../lib/catalog-view'
import { IDS } from './fixtures'

/** The record page's heading, focused by `focusHeading` (`RecordData`). Test-only. */
export const HARNESS_HEADING = 'Fiche du professionnel'

/**
 * Reads the record from the cache, as the record page does, so saves and refetches reach the tab,
 * under a focusable h1 standing for the record's heading. Test-only.
 */
export function RecordHarness({ catalog, children }: { catalog: CatalogView; children: ReactNode }) {
  const { data } = useProfessionalRecord(IDS.professional)
  const focusHeading = () => document.getElementById(HEADING_ID)?.focus()
  if (!data) return null
  return (
    <RecordContext.Provider value={{ record: data, catalog, focusHeading }}>
      <h1 id={HEADING_ID} tabIndex={-1}>
        {HARNESS_HEADING}
      </h1>
      {children}
    </RecordContext.Provider>
  )
}

const HEADING_ID = 'record-harness-heading'
