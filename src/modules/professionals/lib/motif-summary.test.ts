import { describe, expect, it } from 'vitest'
import { summarizeMotifs } from './motif-summary'
import { buildCatalogView, OTHER_MOTIF_GROUP } from './catalog-view'
import { CATALOG, CATALOG_VIEW, motifsCatalog, websiteSizedCatalog } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

const BIG = websiteSizedCatalog()
const motifs = BIG.motifs.filter((m) => m.isActive)
const ALL = motifs.map((m) => m.id)
const namesOf = (summary: ReturnType<typeof summarizeMotifs>) => summary.groups.map((g) => g.motifs.map((m) => m.name))

describe('summarizeMotifs — every name, always (P4-249)', () => {
  it('lists every held motif by name, category by category, for a professional holding all 124', () => {
    const summary = summarizeMotifs(ALL, BIG)
    expect(summary).toMatchObject({ selected: 124, total: 124, archived: [] })
    expect(summary.groups).toHaveLength(13)
    expect(summary.groups.flatMap((g) => g.motifs.map((m) => m.name))).toEqual(motifs.map((m) => m.name))
    expect(summary.groups.map((g) => [g.selected, g.total])).toEqual(summary.groups.map((g) => [g.motifs.length, g.motifs.length]))
    expect(summary).not.toHaveProperty('overall')
    expect(summary.groups[0]).not.toHaveProperty('summary')
  })

  it('names what is held when nearly everything is, never « Tous sauf »', () => {
    const summary = summarizeMotifs(
      ALL.filter((id) => id !== 'm-0-0' && id !== 'm-3-4'),
      BIG,
    )
    expect(summary).toMatchObject({ selected: 122, total: 124 })
    expect(summary.groups[0]).toMatchObject({ selected: summary.groups[0]!.total - 1 })
    expect(namesOf(summary)[0]).not.toContain('Motif 1.1')
    expect(namesOf(summary)[0]).toContain('Motif 1.2')
  })

  it('leaves out the categories holding nothing and keeps the catalogue order', () => {
    const catalog = motifsCatalog([3, 9, 2])
    const summary = summarizeMotifs(['m-2-1', 'm-0-2', 'm-0-0'], catalog)
    expect(summary.groups.map((g) => [g.name, g.selected, g.total])).toEqual([
      ['Catégorie 1', 2, 3],
      ['Catégorie 3', 1, 2],
    ])
    expect(namesOf(summary)).toEqual([['Motif 1.1', 'Motif 1.3'], ['Motif 3.2']])
  })

  it('keeps archived motifs out of the counts, marked last in their category', () => {
    const summary = summarizeMotifs([...ALL, 'm-archived'], BIG)
    expect(summary).toMatchObject({ selected: 124, total: 124, archived: ['Ancien motif'] })
    expect(summary.groups[0]?.motifs.at(-1)).toEqual({ id: 'm-archived', name: 'Ancien motif', archived: true })
    expect(summary.groups[0]?.motifs[0]).toEqual({ id: 'm-0-0', name: 'Motif 1.1', archived: false })
  })

  it('lists a category holding only an archived motif, with its count at 0', () => {
    const summary = summarizeMotifs(['m-archived'], motifsCatalog([2]))
    expect(summary.groups.map((g) => [g.name, g.selected, g.total, g.motifs.map((m) => m.archived)])).toEqual([['Catégorie 1', 0, 2, [true]]])
  })
})

describe('summarizeMotifs — « Sans catégorie »', () => {
  it('lists a motif without a category under « Sans catégorie », last', () => {
    const summary = summarizeMotifs([IDS.orphan, IDS.anxiete], CATALOG_VIEW)
    expect(summary.groups.map((g) => [g.key, g.name])).toEqual([
      ['inner_life', 'Vie intérieure'],
      [OTHER_MOTIF_GROUP, 'Sans catégorie'],
    ])
  })

  it('fills « Sans catégorie » from an archived category', () => {
    const catalog = buildCatalogView({ ...CATALOG })
    const summary = summarizeMotifs([IDS.deuil, IDS.orphan], catalog)
    expect(summary.groups.map((g) => [g.key, g.icon, g.motifs.map((m) => m.name)])).toEqual([[OTHER_MOTIF_GROUP, null, ['Deuil', 'Sans catégorie']]])
  })

  it('is empty without motifs', () => {
    expect(summarizeMotifs([], CATALOG_VIEW)).toMatchObject({ selected: 0, groups: [], archived: [] })
  })
})
