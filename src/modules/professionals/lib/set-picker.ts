import { matchesSearch } from '@/shared/lib/list-search'
import type { MotifCategoryIcon } from './constants'

/**
 * The pure part of the Jumelage pickers (`SetPickerSheet`): which items show, how many are held,
 * what « Tout sélectionner » adds. The sheet edits a draft (`PickerSelection`) and saves it whole.
 */

/** One choice of a picker. */
export interface PickerItem {
  id: string
  label: string
  /** Archived by the clinic: listed only while held, and may be removed (the set RPCs keep it otherwise). */
  archived: boolean
  /** Shows « Réservé » (a motif reserved for regulated professions). */
  restricted?: boolean
  /** Why it cannot be added (shown under the label); one already held can still be removed. */
  blockedReason?: string
}

/** A category of items. A picker with one group is a flat list (no group header). */
export interface PickerGroup {
  key: string
  label: string
  icon?: MotifCategoryIcon | null
  items: PickerItem[]
}

/** The held items, by id, with the « spécialisé » star (always false where the list has no star). */
export type PickerSelection = ReadonlyMap<string, { specialized: boolean }>

/** The catalogue rows a picker lists: the active ones, and the archived ones still held. */
export function pickerItems<T extends { id: string; name: string; isActive: boolean }>(
  rows: readonly T[],
  held: { has: (id: string) => boolean },
  extra: (row: T) => Partial<Omit<PickerItem, 'id' | 'archived'>> = () => ({}),
): PickerItem[] {
  return rows
    .filter((row) => row.isActive || held.has(row.id))
    .map((row) => ({ id: row.id, label: row.name, archived: !row.isActive, ...extra(row) }))
}

/**
 * ★ held first, then the other held items, then the rest, each in the catalogue's order (legacy
 * order of the starred pickers). Taken from the selection the sheet opened with, so a row never
 * moves under the pointer while one ticks or stars it.
 */
export function heldFirst(items: readonly PickerItem[], held: PickerSelection): PickerItem[] {
  const rank = (item: PickerItem) => {
    const entry = held.get(item.id)
    return entry ? (entry.specialized ? 0 : 1) : 2
  }
  return [...items].sort((a, b) => rank(a) - rank(b))
}

/** Held over listed, active items only (as the summaries and readiness count them). */
export function selectionCount(items: readonly PickerItem[], draft: PickerSelection): { selected: number; total: number } {
  const active = items.filter((item) => !item.archived)
  return { selected: active.filter((item) => draft.has(item.id)).length, total: active.length }
}

/** What « Tout sélectionner » may tick: active items that are not blocked. */
const addable = (items: readonly PickerItem[]) => items.filter((item) => !item.archived && !item.blockedReason)

/**
 * The group's bulk action: `select` while an addable item is unticked, `deselect` once all are
 * (or when only held blocked or archived items remain), none when there is nothing to do.
 */
export function groupAction(items: readonly PickerItem[], draft: PickerSelection): 'select' | 'deselect' | null {
  const candidates = addable(items)
  if (candidates.some((item) => !draft.has(item.id))) return 'select'
  return items.some((item) => draft.has(item.id)) ? 'deselect' : null
}

/** The draft after « Tout sélectionner » (ticks the addable items, unstarred) or « Tout désélectionner » (unticks every item of the group). */
export function applyGroupAction(draft: PickerSelection, items: readonly PickerItem[], action: 'select' | 'deselect'): Map<string, { specialized: boolean }> {
  const next = new Map(draft)
  if (action === 'select') {
    for (const item of addable(items)) if (!next.has(item.id)) next.set(item.id, { specialized: false })
  } else {
    for (const item of items) next.delete(item.id)
  }
  return next
}

/**
 * The groups as filtered: items matching every search word (in their label or their group's, so
 * « famille » lists a whole category) and, with « Sélectionnés seulement », in `only` (the items
 * held when it was turned on, so an item unticked meanwhile stays in view to be ticked again);
 * empty groups dropped.
 */
export function filterGroups(groups: readonly PickerGroup[], { words, only }: { words: readonly string[]; only: ReadonlySet<string> | null }): PickerGroup[] {
  if (words.length === 0 && !only) return [...groups]
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => (!only || only.has(item.id)) && matchesSearch([item.label, group.label], words)),
    }))
    .filter((group) => group.items.length > 0)
}

/** Same ids with the same stars. */
export function sameSelection(a: PickerSelection, b: PickerSelection): boolean {
  if (a.size !== b.size) return false
  for (const [id, entry] of a) if (b.get(id)?.specialized !== entry.specialized) return false
  return true
}
