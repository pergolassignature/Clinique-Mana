import { describe, expect, it } from 'vitest'
import { searchWords } from '@/shared/lib/list-search'
import {
  applyGroupAction,
  filterGroups,
  groupAction,
  heldFirst,
  pickerItems,
  sameSelection,
  selectionCount,
  type PickerGroup,
  type PickerItem,
  type PickerSelection,
} from './set-picker'

const item = (id: string, extra: Partial<PickerItem> = {}): PickerItem => ({ id, label: id, archived: false, ...extra })
const sel = (...entries: (string | [string, boolean])[]): PickerSelection =>
  new Map(entries.map((e) => (typeof e === 'string' ? [e, { specialized: false }] : [e[0], { specialized: e[1] }])))

describe('pickerItems', () => {
  it('lists the active rows and the archived rows still held, marked', () => {
    const rows = [
      { id: 'a', name: 'A', isActive: true },
      { id: 'b', name: 'B', isActive: false },
      { id: 'c', name: 'C', isActive: false },
    ]
    expect(pickerItems(rows, new Set(['c']), (r) => ({ restricted: r.id === 'a' }))).toEqual([
      { id: 'a', label: 'A', archived: false, restricted: true },
      { id: 'c', label: 'C', archived: true, restricted: false },
    ])
  })
})

describe('heldFirst', () => {
  it('puts ★ held first, then held, then the rest, keeping the catalogue order in each block', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id))
    expect(heldFirst(items, sel('d', ['e', true], 'b')).map((i) => i.id)).toEqual(['e', 'b', 'd', 'a', 'c'])
  })
})

describe('selectionCount', () => {
  it('counts active items only, as the summaries do', () => {
    expect(selectionCount([item('a'), item('b'), item('old', { archived: true })], sel('a', 'old'))).toEqual({ selected: 1, total: 2 })
  })
})

describe('groupAction / applyGroupAction', () => {
  const items = [item('a'), item('b'), item('r', { blockedReason: 'Réservé' }), item('old', { archived: true })]

  it('selects the addable items only, unstarred, keeping existing stars', () => {
    const draft = sel(['a', true])
    expect(groupAction(items, draft)).toBe('select')
    const next = applyGroupAction(draft, items, 'select')
    expect([...next]).toEqual([
      ['a', { specialized: true }],
      ['b', { specialized: false }],
    ])
  })

  it('deselects everything of the group once every addable item is held, blocked and archived ones included', () => {
    const draft = sel('a', 'b', 'r', 'old', 'elsewhere')
    expect(groupAction(items, draft)).toBe('deselect')
    expect([...applyGroupAction(draft, items, 'deselect').keys()]).toEqual(['elsewhere'])
  })

  it('offers « Tout désélectionner » for held blocked items only, and nothing for an untouchable group', () => {
    const blocked = [item('r', { blockedReason: 'Réservé' })]
    expect(groupAction(blocked, sel('r'))).toBe('deselect')
    expect(groupAction(blocked, sel())).toBeNull()
  })
})

describe('filterGroups', () => {
  const groups: PickerGroup[] = [
    { key: 'g1', label: 'Vie intérieure', items: [item('anx', { label: 'Anxiété' }), item('deuil', { label: 'Deuil' })] },
    { key: 'g2', label: 'Relations et famille', items: [item('cpl', { label: 'Couple' }), item('adopt', { label: 'Adoption' })] },
  ]
  const ids = (result: PickerGroup[]) => result.map((g) => [g.key, g.items.map((i) => i.id)])

  it('returns every group untouched without a search or a filter', () => {
    expect(filterGroups(groups, { words: [], only: null })).toEqual(groups)
  })

  it('matches accent-insensitively on the item, or the whole group by its name', () => {
    expect(ids(filterGroups(groups, { words: searchWords('anxiete'), only: null }))).toEqual([['g1', ['anx']]])
    expect(ids(filterGroups(groups, { words: searchWords('famille'), only: null }))).toEqual([['g2', ['cpl', 'adopt']]])
  })

  it('keeps the items held when « Sélectionnés seulement » was turned on, dropping empty groups', () => {
    expect(ids(filterGroups(groups, { words: [], only: new Set(['deuil']) }))).toEqual([['g1', ['deuil']]])
  })
})

describe('sameSelection', () => {
  it('compares ids and stars', () => {
    expect(sameSelection(sel('a', ['b', true]), sel(['b', true], 'a'))).toBe(true)
    expect(sameSelection(sel('a'), sel(['a', true]))).toBe(false)
    expect(sameSelection(sel('a'), sel('b'))).toBe(false)
    expect(sameSelection(sel('a'), sel('a', 'b'))).toBe(false)
  })
})
