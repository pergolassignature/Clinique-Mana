import { catalogPayload, listRowPayload, parseRpc, recordPayload, type ProfessionalListRow, type ProfessionalRecord } from '../api/parse'
import { buildCatalogView, type CatalogView } from '../lib/catalog-view'
import type { Gender, ProfessionalStatus } from '../lib/constants'
import { CATALOG_JSON, IDS, LIST_ROW_JSON, RECORD_JSON } from './fixtures'

/** The fixtures as the pages see them (parsed, camelCase). Test-only. */
export const CATALOG = parseRpc(catalogPayload, CATALOG_JSON)
export const CATALOG_VIEW = buildCatalogView(CATALOG)

/**
 * The catalogue with a gendered title (P4-340): « Travailleuse sociale ou travailleur social »,
 * « Travailleuse sociale », « Travailleur social », in the Psychologie category for brevity.
 */
export const GENDERED_CATALOG = {
  ...CATALOG,
  titles: [
    ...CATALOG.titles,
    {
      id: IDS.travailleurSocial,
      key: 'travailleur_social',
      name: 'Travailleuse sociale ou travailleur social',
      nameFeminine: 'Travailleuse sociale',
      nameMasculine: 'Travailleur social',
      isSystem: false,
      sortOrder: 30,
      isActive: true,
      categoryId: IDS.psychologie,
      orderId: IDS.opq,
    },
  ],
}
export const GENDERED_CATALOG_VIEW = buildCatalogView(GENDERED_CATALOG)

/** The record fixture holding the gendered title alone (primary), with `gender`. */
export function socialWorkerRecord(gender: Gender | null): ProfessionalRecord {
  const record = recordFixture()
  return {
    ...record,
    professional: { ...record.professional, gender },
    professions: [{ id: 'row-ts', titleId: IDS.travailleurSocial, licenceNumber: 'TS04518', isPrimary: true }],
  }
}

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

/** The website catalogue's shape (P4-241): 13 categories, 124 motifs. For the « everything held » cases. */
export function websiteSizedCatalog(): CatalogView {
  return motifsCatalog([19, 7, 5, 11, 8, 18, 10, 6, 4, 8, 6, 12, 10])
}

/** The legacy motif list's shape: 8 categories of 9 motifs, 72 active. A large catalogue for the history and picker cases. */
export function seventyTwoMotifsCatalog(): CatalogView {
  return motifsCatalog(Array.from({ length: 8 }, () => 9))
}
