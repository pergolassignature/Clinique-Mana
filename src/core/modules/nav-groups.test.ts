import { describe, expect, it } from 'vitest'
import { groupNavItems, NAV_GROUPS, type NavGroupId } from './nav-groups'

const item = (path: string, group?: NavGroupId, order?: number) => ({ path, group, order })
const shape = (groups: ReturnType<typeof groupNavItems<ReturnType<typeof item>>>) =>
  groups.map((g) => [g.id, g.items.map((i) => i.path)])

describe('groupNavItems (decision NAV-1)', () => {
  it('orders the sections as NAV_GROUPS and the items by order within each', () => {
    const groups = groupNavItems([
      item('/parametres', 'settings'),
      item('/professionnels', 'team', 10),
      item('/clients', 'followUp', 15),
      item('/agenda', 'followUp', 12),
      item('/liste-attente', 'intake', 13),
      item('/demandes', 'intake', 12),
      item('/accueil', 'main', 0),
      item('/mon-profil', 'main', 5),
    ])
    expect(shape(groups)).toEqual([
      ['main', ['/accueil', '/mon-profil']],
      ['intake', ['/demandes', '/liste-attente']],
      ['followUp', ['/agenda', '/clients']],
      ['team', ['/professionnels']],
      ['settings', ['/parametres']],
    ])
  })

  it('leaves out a section with no item for the user: no heading without an item', () => {
    const groups = groupNavItems([item('/accueil', 'main', 0), item('/professionnels', 'team', 10)])
    expect(groups.map((g) => g.id)).toEqual(['main', 'team'])
    expect(groupNavItems([])).toEqual([])
  })

  it('puts an item that names no section under « Autres », before Paramètres', () => {
    const groups = groupNavItems([item('/parametres', 'settings'), item('/nouveau', undefined, 1), item('/textos', 'communications', 21)])
    expect(shape(groups)).toEqual([
      ['communications', ['/textos']],
      ['other', ['/nouveau']],
      ['settings', ['/parametres']],
    ])
    expect(groups[1]?.labelKey).toBe('nav.groups.other')
  })

  it('keeps the given order for equal or missing orders, and never changes its input', () => {
    const input = [item('/b', 'main'), item('/a', 'main'), item('/c', 'main', -1)]
    expect(shape(groupNavItems(input))).toEqual([['main', ['/c', '/b', '/a']]])
    expect(input.map((i) => i.path)).toEqual(['/b', '/a', '/c'])
  })

  it('labels every section but Accueil\'s and Paramètres\'', () => {
    expect(NAV_GROUPS.filter((g) => g.labelKey === null).map((g) => g.id)).toEqual(['main', 'settings'])
    expect(NAV_GROUPS[0].id).toBe('main')
    expect(NAV_GROUPS.at(-1)?.id).toBe('settings')
  })
})
