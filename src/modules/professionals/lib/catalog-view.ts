import { t } from '@/i18n'
import type { MotifCategoryIcon } from './constants'
import type {
  Clientele,
  DeactivationReason,
  Language,
  Motif,
  MotifCategory,
  ProfessionalOrder,
  ProfessionalsCatalog,
  ProfessionCategory,
  ProfessionTitle,
  Specialty,
} from '../api/parse'

/** The key of the « Autres » motif group (as `get_professional_public_profile` names it). */
export const OTHER_MOTIF_GROUP = 'autres'

/** Motifs of one active category, or of « Autres » (no category, or an archived one). */
export interface MotifGroup {
  key: string
  categoryId: string | null
  name: string
  icon: MotifCategoryIcon | null
  /** In the catalogue's order, archived motifs included (`isActive`). */
  motifs: Motif[]
}

/**
 * The catalogue with lookups built once per fetch (`useProfessionalsCatalog`'s `select`), so pages
 * resolve ids without rebuilding maps on each render.
 */
export interface CatalogView extends ProfessionalsCatalog {
  byId: {
    orders: ReadonlyMap<string, ProfessionalOrder>
    categories: ReadonlyMap<string, ProfessionCategory>
    titles: ReadonlyMap<string, ProfessionTitle>
    clienteles: ReadonlyMap<string, Clientele>
    specialties: ReadonlyMap<string, Specialty>
    motifCategories: ReadonlyMap<string, MotifCategory>
    motifs: ReadonlyMap<string, Motif>
    languages: ReadonlyMap<string, Language>
    deactivationReasons: ReadonlyMap<string, DeactivationReason>
  }
  /** Active categories in their order (empty ones included), then « Autres » when it has motifs. */
  motifGroups: MotifGroup[]
}

const byId = <T extends { id: string }>(rows: T[]): ReadonlyMap<string, T> => new Map(rows.map((r) => [r.id, r]))

function groupMotifs(catalog: ProfessionalsCatalog): MotifGroup[] {
  const groups = new Map<string, MotifGroup>(
    catalog.motifCategories
      .filter((c) => c.isActive)
      .map((c) => [c.id, { key: c.key, categoryId: c.id, name: c.name, icon: c.icon, motifs: [] }]),
  )
  const other: MotifGroup = { key: OTHER_MOTIF_GROUP, categoryId: null, name: t('modules.professionals.otherCategory'), icon: null, motifs: [] }
  for (const motif of catalog.motifs) {
    const group = motif.categoryId !== null ? groups.get(motif.categoryId) : undefined
    ;(group ?? other).motifs.push(motif)
  }
  return other.motifs.length > 0 ? [...groups.values(), other] : [...groups.values()]
}

/** Pure: the same catalogue gives an equal view. */
export function buildCatalogView(catalog: ProfessionalsCatalog): CatalogView {
  return {
    ...catalog,
    byId: {
      orders: byId(catalog.orders),
      categories: byId(catalog.categories),
      titles: byId(catalog.titles),
      clienteles: byId(catalog.clienteles),
      specialties: byId(catalog.specialties),
      motifCategories: byId(catalog.motifCategories),
      motifs: byId(catalog.motifs),
      languages: byId(catalog.languages),
      deactivationReasons: byId(catalog.deactivationReasons),
    },
    motifGroups: groupMotifs(catalog),
  }
}

/** The order of a title, or null for an unknown title or one without an order (not regulated). */
export function titleOrder(catalog: CatalogView, titleId: string | null): ProfessionalOrder | null {
  const orderId = titleId !== null ? catalog.byId.titles.get(titleId)?.orderId : null
  return orderId ? (catalog.byId.orders.get(orderId) ?? null) : null
}
