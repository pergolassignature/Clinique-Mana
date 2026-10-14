import { describe, expect, it } from 'vitest'
import type { CatalogueMotif } from '../api/mine'
import { mainPerson, motifGroups } from './mine'

const motif = (id: string, name: string, category: string | null, categoryOrder: number | null, order: number): CatalogueMotif => ({
  id,
  name,
  sort_order: order,
  category_name: category,
  category_sort_order: categoryOrder,
})

const CATALOGUE = [
  motif('m1', 'Stress', 'Anxiété', 1, 2),
  motif('m2', 'Anxiété', 'Anxiété', 1, 1),
  motif('m3', 'Communication', 'Couple', 2, 1),
  motif('m4', 'Deuil', null, null, 1),
  motif('m5', 'Sommeil', 'Anxiété', 1, 3),
]

describe('motifGroups (R-80)', () => {
  it('writes the held motifs out by name, by category in the catalogue order, « Sans catégorie » last', () => {
    expect(motifGroups(['m4', 'm3', 'm1', 'm2'], CATALOGUE)).toEqual([
      { category: 'Anxiété', names: ['Anxiété', 'Stress'] },
      { category: 'Couple', names: ['Communication'] },
      { category: null, names: ['Deuil'] },
    ])
  })

  it('leaves out a motif no longer in the catalogue, and gives nothing for none', () => {
    expect(motifGroups(['retired', 'm3'], CATALOGUE)).toEqual([{ category: 'Couple', names: ['Communication'] }])
    expect(motifGroups([], CATALOGUE)).toEqual([])
  })
})

describe('mainPerson', () => {
  it('names the main participant, else the first, else nobody', () => {
    const p = (display_name: string | null, is_primary: boolean) => ({ client_id: null, display_name, relationship: null, is_primary })
    expect(mainPerson({ participants: [p('Léa', false), p('Alice', true)] })).toBe('Alice')
    expect(mainPerson({ participants: [p('Léa', false)] })).toBe('Léa')
    expect(mainPerson({ participants: [p('  ', true)] })).toBeNull()
    expect(mainPerson({ participants: [] })).toBeNull()
  })
})
