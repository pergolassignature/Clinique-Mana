import { describe, expect, it } from 'vitest'
import { FEW_EXCEPTIONS, summarizeMotifs, type MotifSummaryGroup } from './motif-summary'
import { buildCatalogView, OTHER_MOTIF_GROUP } from './catalog-view'
import { CATALOG, CATALOG_VIEW, motifsCatalog, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

const BIG = seventyTwoMotifsCatalog()
const motifs = BIG.motifs.filter((m) => m.isActive)
const ALL = motifs.map((m) => m.id)
const except = (...ids: string[]) => ALL.filter((id) => !ids.includes(id))
const names = (c: number, ...ms: number[]) => ms.map((m) => `Motif ${c}.${m}`)
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
const brief = (g: MotifSummaryGroup) => ({ key: g.key, name: g.name, summary: g.summary })

describe('summarizeMotifs — 72 motifs', () => {
  it('says « Tous » once for a professional holding every motif, the full list behind it', () => {
    const summary = summarizeMotifs(ALL, BIG)
    expect(summary).toMatchObject({ selected: 72, total: 72, overall: { kind: 'all' }, archived: [] })
    expect(summary.groups.every((g) => g.summary.kind === 'all' && g.summary.names.length === 9)).toBe(true)
    // What « Tous les motifs (72) » unfolds to: eight categories (« 9 / 9 »), each unfolding to its names.
    expect(summary.groups.map((g) => [g.selected, g.total, g.icon])).toEqual(Array.from({ length: 8 }, () => [9, 9, 'Brain']))
    expect(summary.groups.flatMap((g) => g.motifs.map((m) => m.name))).toEqual(motifs.map((m) => m.name))
  })

  it('reads « Tous sauf … » when a few motifs are missing overall', () => {
    const summary = summarizeMotifs(except('m-0-0', 'm-3-4'), BIG)
    expect(summary.overall).toEqual({ kind: 'allBut', missing: ['Motif 1.1', 'Motif 4.5'] })
    expect(summary.groups[0]?.summary).toEqual({ kind: 'allBut', missing: ['Motif 1.1'], names: names(1, 2, 3, 4, 5, 6, 7, 8, 9) })
    expect(summary.groups[1]?.summary).toEqual({ kind: 'all', names: names(2, ...range(9)) })
  })

  it(`keeps one overall line up to ${FEW_EXCEPTIONS} missing, one line per category from ${FEW_EXCEPTIONS + 1}`, () => {
    const five = ['m-0-0', 'm-1-0', 'm-2-0', 'm-3-0', 'm-4-0']
    expect(summarizeMotifs(except(...five), BIG).overall).toEqual({ kind: 'allBut', missing: ['Motif 1.1', 'Motif 2.1', 'Motif 3.1', 'Motif 4.1', 'Motif 5.1'] })
    const six = summarizeMotifs(except(...five, 'm-5-0'), BIG)
    expect(six.overall).toBeNull()
    expect(six.groups.map((g) => g.summary.kind)).toEqual(['allBut', 'allBut', 'allBut', 'allBut', 'allBut', 'allBut', 'all', 'all'])
  })

  it('summarises each category when too many are missing for one line', () => {
    // Category 1: all; 2: four of nine; 3: two; 4: seven of nine; others: none.
    const ids = [...ALL.slice(0, 9), 'm-1-0', 'm-1-1', 'm-1-2', 'm-1-3', 'm-2-5', 'm-2-6', ...ALL.slice(27, 34)]
    const summary = summarizeMotifs(ids, BIG)
    expect(summary.overall).toBeNull()
    expect(summary.groups.map((g) => [g.name, g.summary])).toEqual([
      ['Catégorie 1', { kind: 'all', names: names(1, ...range(9)) }],
      ['Catégorie 2', { kind: 'count', selected: 4, total: 9, names: names(2, 1, 2, 3, 4) }],
      ['Catégorie 3', { kind: 'names', names: names(3, 6, 7) }],
      ['Catégorie 4', { kind: 'allBut', missing: names(4, 8, 9), names: names(4, ...range(7)) }],
    ])
    expect(summary).toMatchObject({ selected: 22, total: 72 })
  })

  it('keeps archived motifs out of the counts, names them apart and marks them last in their category', () => {
    const summary = summarizeMotifs([...ALL, 'm-archived'], BIG)
    expect(summary).toMatchObject({ selected: 72, total: 72, overall: { kind: 'all' }, archived: ['Ancien motif'] })
    expect(summary.groups[0]?.motifs.at(-1)).toEqual({ name: 'Ancien motif', archived: true })
    expect(summary.groups[0]?.motifs[0]).toEqual({ name: 'Motif 1.1', archived: false })
    expect(summary.groups[0]).toMatchObject({ selected: 9, total: 9 })
  })
})

describe('summarizeMotifs — small categories and thresholds', () => {
  it('names the motif of a one-motif category, never « Tous »', () => {
    const summary = summarizeMotifs(['m-0-0'], motifsCatalog([1, 9]))
    expect(summary.groups.map(brief)).toEqual([{ key: 'cat_0', name: 'Catégorie 1', summary: { kind: 'names', names: ['Motif 1.1'] } }])
    expect(summary.overall).toBeNull()
  })

  it('names both motifs of a two-motif category held entirely (« Changements de vie »)', () => {
    const summary = summarizeMotifs(['m-0-0', 'm-0-1', 'm-1-0'], motifsCatalog([2, 9]))
    expect(summary.groups.map((g) => g.summary)).toEqual([
      { kind: 'names', names: ['Motif 1.1', 'Motif 1.2'] },
      { kind: 'names', names: ['Motif 2.1'] },
    ])
  })

  it('names a single custom motif under « Autres », never « Tous »', () => {
    const catalog = buildCatalogView({ ...CATALOG, motifs: CATALOG.motifs.filter((m) => m.id !== IDS.deuil) })
    const summary = summarizeMotifs([IDS.orphan], catalog)
    expect(summary.groups.map(brief)).toEqual([{ key: OTHER_MOTIF_GROUP, name: 'Autres', summary: { kind: 'names', names: ['Sans catégorie'] } }])
  })

  it('fills « Autres » from an archived category', () => {
    const summary = summarizeMotifs([IDS.deuil, IDS.orphan], CATALOG_VIEW)
    expect(summary.groups.map(brief)).toEqual([{ key: OTHER_MOTIF_GROUP, name: 'Autres', summary: { kind: 'names', names: ['Deuil', 'Sans catégorie'] } }])
    expect(summary.groups[0]?.icon).toBeNull()
    expect(summary.archived).toEqual([])
  })

  it('names 3 held of 6 (rather than « Tous sauf » 3), then reads « Tous sauf » from 4 held', () => {
    const catalog = motifsCatalog([6, 9, 9])
    expect(summarizeMotifs(['m-0-0', 'm-0-1', 'm-0-2'], catalog).groups[0]?.summary).toEqual({ kind: 'names', names: names(1, 1, 2, 3) })
    expect(summarizeMotifs(['m-0-0', 'm-0-1', 'm-0-2', 'm-0-3'], catalog).groups[0]?.summary).toEqual({
      kind: 'allBut',
      missing: names(1, 5, 6),
      names: names(1, 1, 2, 3, 4),
    })
  })

  it('has no overall line while every held motif is named anyway', () => {
    // Every motif of a two-motif clinic: its two names, not « Tous les motifs (2) ».
    const summary = summarizeMotifs(['m-0-0', 'm-0-1'], motifsCatalog([2]))
    expect(summary.overall).toBeNull()
    expect(summary.groups[0]?.summary).toEqual({ kind: 'names', names: ['Motif 1.1', 'Motif 1.2'] })
  })
})

describe('summarizeMotifs — a few motifs', () => {
  it('names them', () => {
    const summary = summarizeMotifs([IDS.anxiete, IDS.orphan], CATALOG_VIEW)
    expect(summary.overall).toBeNull()
    expect(summary.groups.map((g) => [g.name, g.summary])).toEqual([
      ['Vie intérieure', { kind: 'names', names: ['Anxiété'] }],
      ['Autres', { kind: 'names', names: ['Sans catégorie'] }],
    ])
  })

  it('is empty without motifs', () => {
    expect(summarizeMotifs([], CATALOG_VIEW)).toMatchObject({ selected: 0, overall: null, groups: [], archived: [] })
  })
})
