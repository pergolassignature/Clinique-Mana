import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { buildCatalogView, OTHER_MOTIF_GROUP, titleOrder } from './catalog-view'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

describe('buildCatalogView', () => {
  const view = buildCatalogView(CATALOG)

  it('keeps the lists and indexes every row by id, archived ones included', () => {
    expect(view.motifs).toBe(CATALOG.motifs)
    expect(view.byId.motifs.get(IDS.archivedMotif)?.isActive).toBe(false)
    expect(view.byId.titles.get(IDS.psychologue)?.name).toBe('Psychologue')
    expect(view.byId.languages.get(IDS.fr)?.code).toBe('fr')
    expect(view.byId.deactivationReasons.size).toBe(3)
  })

  it('groups motifs by active category in order, « Autres » last for none or an archived category', () => {
    expect(view.motifGroups.map((g) => [g.key, g.name, g.motifs.map((m) => m.key)])).toEqual([
      ['inner_life', 'Vie intérieure', ['anxiete', 'psychose', 'ancien_motif']],
      [OTHER_MOTIF_GROUP, t('modules.professionals.otherCategory'), ['deuil', 'sans_categorie']],
    ])
    expect(view.motifGroups[0]?.icon).toBe('Brain')
    expect(view.motifGroups[1]).toMatchObject({ categoryId: null, icon: null })
  })

  it('leaves « Autres » out when every motif has an active category', () => {
    const tidy = buildCatalogView({ ...CATALOG, motifs: CATALOG.motifs.filter((m) => m.categoryId === IDS.innerLife) })
    expect(tidy.motifGroups.map((g) => g.key)).toEqual(['inner_life'])
  })
})

describe('titleOrder', () => {
  const view = buildCatalogView(CATALOG)

  it('is the order of a regulated title, null otherwise', () => {
    expect(titleOrder(view, IDS.psychologue)?.acronym).toBe('OPQ')
    expect(titleOrder(view, IDS.naturopathe)).toBeNull()
    expect(titleOrder(view, null)).toBeNull()
    expect(titleOrder(view, 'unknown')).toBeNull()
  })
})
