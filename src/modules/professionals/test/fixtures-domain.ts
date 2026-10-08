import { catalogPayload, listRowPayload, parseRpc, recordPayload, type ProfessionalListRow, type ProfessionalRecord } from '../api/parse'
import { buildCatalogView, type CatalogView } from '../lib/catalog-view'
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

/**
 * The legacy motif list's shape: 8 categories of 9 motifs, 72 active (`m-<c>-<m>`, « Motif 1.1 »),
 * plus one archived motif (`m-archived`, « Ancien motif »). For the « everything held » cases.
 */
export function seventyTwoMotifsCatalog(): CatalogView {
  const categories = Array.from({ length: 8 }, (_, c) => ({
    id: `cat-${c}`,
    key: `cat_${c}`,
    name: `Catégorie ${c + 1}`,
    isSystem: false,
    sortOrder: c,
    isActive: true,
    description: null,
    icon: 'Brain' as const,
  }))
  const motifs = categories.flatMap((category, c) =>
    Array.from({ length: 9 }, (_, m) => ({
      id: `m-${c}-${m}`,
      key: `m_${c}_${m}`,
      name: `Motif ${c + 1}.${m + 1}`,
      isSystem: false,
      sortOrder: c * 10 + m,
      isActive: true,
      categoryId: category.id,
      isRestricted: false,
    })),
  )
  const archived = { id: 'm-archived', key: 'm_archived', name: 'Ancien motif', isSystem: false, sortOrder: 0, isActive: false, categoryId: 'cat-0', isRestricted: false }
  return buildCatalogView({ ...CATALOG, motifCategories: categories, motifs: [...motifs, archived] })
}
