import { describe, expect, it } from 'vitest'
import { summarizeMotifs } from './motif-summary'
import { CATALOG_VIEW, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

const BIG = seventyTwoMotifsCatalog()
const motifs = BIG.motifs.filter((m) => m.isActive)
const ALL = motifs.map((m) => m.id)
const except = (...ids: string[]) => ALL.filter((id) => !ids.includes(id))

describe('summarizeMotifs — 72 motifs', () => {
  it('says « Tous » once for a professional holding every motif', () => {
    const summary = summarizeMotifs(ALL, BIG)
    expect(summary).toMatchObject({ selected: 72, total: 72, overall: { kind: 'all' }, condensed: true, archived: [] })
    expect(summary.groups.every((g) => g.summary.kind === 'all')).toBe(true)
    // The full list waits behind « Voir les 72 motifs ».
    expect(summary.full.flatMap((g) => g.names)).toHaveLength(72)
  })

  it('reads « Tous sauf … » when a few motifs are missing overall', () => {
    const summary = summarizeMotifs(except('m-0-0', 'm-3-4'), BIG)
    expect(summary.overall).toEqual({ kind: 'allBut', missing: ['Motif 1.1', 'Motif 4.5'] })
    expect(summary.groups[0]?.summary).toEqual({ kind: 'allBut', missing: ['Motif 1.1'] })
    expect(summary.groups[1]?.summary).toEqual({ kind: 'all' })
  })

  it('summarises each category when too many are missing for one line', () => {
    // Category 1: all; 2: four of nine; 3: two; 4: seven of nine; others: none.
    const ids = [...ALL.slice(0, 9), 'm-1-0', 'm-1-1', 'm-1-2', 'm-1-3', 'm-2-5', 'm-2-6', ...ALL.slice(27, 34)]
    const summary = summarizeMotifs(ids, BIG)
    expect(summary.overall).toBeNull()
    expect(summary.groups.map((g) => [g.name, g.summary])).toEqual([
      ['Catégorie 1', { kind: 'all' }],
      ['Catégorie 2', { kind: 'count', selected: 4, total: 9, names: ['Motif 2.1', 'Motif 2.2', 'Motif 2.3', 'Motif 2.4'] }],
      ['Catégorie 3', { kind: 'names', names: ['Motif 3.6', 'Motif 3.7'] }],
      ['Catégorie 4', { kind: 'allBut', missing: ['Motif 4.8', 'Motif 4.9'] }],
    ])
    expect(summary).toMatchObject({ selected: 22, total: 72, condensed: true })
  })

  it('keeps archived motifs out of the counts and names them apart', () => {
    const summary = summarizeMotifs([...ALL, 'm-archived'], BIG)
    expect(summary).toMatchObject({ selected: 72, total: 72, overall: { kind: 'all' }, archived: ['Ancien motif'] })
    expect(summary.full[0]?.names.at(-1)).toBe('Ancien motif')
  })
})

describe('summarizeMotifs — a few motifs', () => {
  it('names them, with nothing to unfold', () => {
    const summary = summarizeMotifs([IDS.anxiete, IDS.orphan], CATALOG_VIEW)
    expect(summary.overall).toBeNull()
    expect(summary.groups.map((g) => [g.name, g.summary])).toEqual([
      ['Vie intérieure', { kind: 'names', names: ['Anxiété'] }],
      ['Autres', { kind: 'names', names: ['Sans catégorie'] }],
    ])
    expect(summary.condensed).toBe(false)
  })

  it('is empty without motifs', () => {
    expect(summarizeMotifs([], CATALOG_VIEW)).toMatchObject({ selected: 0, overall: null, groups: [], full: [], condensed: false })
  })
})
