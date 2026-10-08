import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { CATALOG_VIEW, recordFixture, seventyTwoMotifsCatalog } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { clienteleGroups, languageGroups, motifGroups, plainSelection, recordSelections } from './matching-pickers'

describe('matching pickers', () => {
  it('lists clientèles flat, named with their ages', () => {
    const [group, ...rest] = clienteleGroups(CATALOG_VIEW, plainSelection([]))
    expect(rest).toEqual([])
    expect(group?.items.map((i) => i.label)).toEqual(['Enfants (0 à 12 ans)', 'Aînés (65 ans et plus)', 'Couples'])
  })

  it('groups motifs by active category, « Autres » last, archived ones only while held', () => {
    const groups = motifGroups(CATALOG_VIEW, plainSelection([]), true)
    expect(groups.map((g) => [g.label, g.items.map((i) => i.label)])).toEqual([
      ['Vie intérieure', ['Anxiété', 'Psychose']],
      ['Autres', ['Deuil', 'Sans catégorie']],
    ])
    const held = motifGroups(CATALOG_VIEW, plainSelection([IDS.archivedMotif]), true)
    expect(held[0]?.items.find((i) => i.id === IDS.archivedMotif)).toMatchObject({ archived: true })
  })

  it('marks a restricted motif, blocked with the reason without a regulated title', () => {
    const psychose = (regulated: boolean) => motifGroups(CATALOG_VIEW, plainSelection([]), regulated)[0]?.items.find((i) => i.id === IDS.psychose)
    expect(psychose(true)).toMatchObject({ restricted: true })
    expect(psychose(true)?.blockedReason).toBeUndefined()
    expect(psychose(false)).toMatchObject({ restricted: true, blockedReason: t('modules.professionals.record.matching.motifs.blocked') })
  })

  it('keeps every one of 72 motifs in its 8 categories of 9', () => {
    const groups = motifGroups(seventyTwoMotifsCatalog(), plainSelection([]), true)
    expect(groups.map((g) => g.items.length)).toEqual([9, 9, 9, 9, 9, 9, 9, 9])
  })

  it('reads the record’s sets as selections, stars included', () => {
    const selections = recordSelections(recordFixture())
    expect([...selections.clienteles]).toEqual([[IDS.couples, { specialized: true }]])
    expect([...selections.motifs]).toEqual([[IDS.anxiete, { specialized: false }]])
    expect(languageGroups(CATALOG_VIEW, selections.languages)[0]?.items.map((i) => i.label)).toEqual(['Français', 'Anglais'])
  })
})
