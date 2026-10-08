import { catalogPayload, listRowPayload, parseRpc, recordPayload, type ProfessionalListRow, type ProfessionalRecord } from '../api/parse'
import { buildCatalogView } from '../lib/catalog-view'
import { CATALOG_JSON, LIST_ROW_JSON, RECORD_JSON } from './fixtures'

/** The fixtures as the pages see them (parsed, camelCase). Test-only. */
export const CATALOG = parseRpc(catalogPayload, CATALOG_JSON)
export const CATALOG_VIEW = buildCatalogView(CATALOG)

export function recordFixture(): ProfessionalRecord {
  const record = parseRpc(recordPayload, RECORD_JSON)
  if (!record) throw new Error('fixture')
  return record
}

export function listRowFixture(overrides: Partial<ProfessionalListRow> = {}): ProfessionalListRow {
  return { ...parseRpc(listRowPayload, LIST_ROW_JSON), ...overrides }
}
