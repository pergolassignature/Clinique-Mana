import { catalogPayload, listRowPayload, parseRpc, recordPayload, type ProfessionalListRow, type ProfessionalRecord } from '../api/parse'
import { buildCatalogView, type CatalogView } from '../lib/catalog-view'
import type { ProfessionalStatus } from '../lib/constants'
import { CATALOG_JSON, LIST_ROW_JSON, RECORD_JSON } from './fixtures'

/** The fixtures as the pages see them (parsed, camelCase). Test-only. */
export const CATALOG = parseRpc(catalogPayload, CATALOG_JSON)
export const CATALOG_VIEW = buildCatalogView(CATALOG)

export function recordFixture(): ProfessionalRecord {
  const record = parseRpc(recordPayload, RECORD_JSON)
  if (!record) throw new Error('fixture')
  return record
}

/**
 * The record fixture with another status, its file complete (readiness done) or not (the
 * fixture's gaps: a clientèle and a motif).
 */
export function recordWithStatus(status: ProfessionalStatus, complete: boolean): ProfessionalRecord {
  const record = recordFixture()
  return {
    ...record,
    professional: { ...record.professional, status },
    readiness: complete ? { ...record.readiness, complete, done: 1, items: [{ key: 'matching_profile', done: true, missing: [] }] } : record.readiness,
  }
}

export function listRowFixture(overrides: Partial<ProfessionalListRow> = {}): ProfessionalListRow {
  return { ...parseRpc(listRowPayload, LIST_ROW_JSON), ...overrides }
}

/**
 * Categories of the given sizes (`m-<c>-<m>`, « Motif 1.1 », « Catégorie 1 »), all active, plus
 * one archived motif (`m-archived`, « Ancien motif ») in the first category.
 */
export function motifsCatalog(sizes: readonly number[]): CatalogView {
  const categories = sizes.map((_, c) => ({
    id: `cat-${c}`,
    key: `cat_${c}`,
    name: `Catégorie ${c + 1}`,
    isSystem: false,
    sortOrder: c,
    isActive: true,
    description: null,
    icon: 'Brain' as const,
  }))
  const motifs = sizes.flatMap((size, c) =>
    Array.from({ length: size }, (_, m) => ({
      id: `m-${c}-${m}`,
      key: `m_${c}_${m}`,
      name: `Motif ${c + 1}.${m + 1}`,
      isSystem: false,
      sortOrder: c * 100 + m,
      isActive: true,
      categoryId: `cat-${c}`,
      isRestricted: false,
    })),
  )
  const archived = { id: 'm-archived', key: 'm_archived', name: 'Ancien motif', isSystem: false, sortOrder: 0, isActive: false, categoryId: 'cat-0', isRestricted: false }
  return buildCatalogView({ ...CATALOG, motifCategories: categories, motifs: [...motifs, archived] })
}

/** The legacy motif list's shape: 8 categories of 9 motifs, 72 active. For the « everything held » cases. */
export function seventyTwoMotifsCatalog(): CatalogView {
  return motifsCatalog(Array.from({ length: 8 }, () => 9))
}
