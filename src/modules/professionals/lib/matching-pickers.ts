import { t } from '@/i18n'
import type { ProfessionalRecord, SpecializedRef } from '../api/parse'
import type { CatalogView } from './catalog-view'
import { clienteleLabel } from './display'
import { pickerItems, type PickerGroup, type PickerSelection } from './set-picker'

/**
 * What each Jumelage picker lists, from the cached catalogue and the record: one flat group for
 * clientèles and languages; the motif categories in their order (« Sans catégorie » last,
 * empty categories left out) for motifs.
 */

const FLAT = 'all'

export const starredSelection = (refs: readonly SpecializedRef[]): PickerSelection => new Map(refs.map((r) => [r.id, { specialized: r.specialized }]))
export const plainSelection = (ids: readonly string[]): PickerSelection => new Map(ids.map((id) => [id, { specialized: false }]))

export function clienteleGroups(catalog: CatalogView, held: PickerSelection): PickerGroup[] {
  return [{ key: FLAT, label: '', items: pickerItems(catalog.clienteles, held, (c) => ({ label: clienteleLabel(c) })) }]
}

export function languageGroups(catalog: CatalogView, held: PickerSelection): PickerGroup[] {
  return [{ key: FLAT, label: '', items: pickerItems(catalog.languages, held) }]
}

/**
 * Motifs by category. A restricted motif reads « Réservé »; without a title from a professional
 * order it cannot be added, and says why (P4-16, P4-55: one already held can still be removed).
 */
export function motifGroups(catalog: CatalogView, held: PickerSelection, hasRegulatedTitle: boolean): PickerGroup[] {
  const blocked = t('modules.professionals.record.matching.motifs.blocked')
  return catalog.motifGroups
    .map((group) => ({
      key: group.key,
      label: group.name,
      icon: group.icon,
      items: pickerItems(group.motifs, held, (m) => ({
        restricted: m.isRestricted,
        ...(m.isRestricted && !hasRegulatedTitle && { blockedReason: blocked }),
      })),
    }))
    .filter((group) => group.items.length > 0)
}

/** The record's sets as picker selections. */
export function recordSelections(record: ProfessionalRecord) {
  return {
    clienteles: starredSelection(record.clienteles),
    motifs: plainSelection(record.motifIds),
    languages: plainSelection(record.languageIds),
  }
}
