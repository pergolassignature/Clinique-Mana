import { describe, expect, it } from 'vitest'
import { matchingDigest } from './matching-digest'
import { buildCatalogView } from './catalog-view'
import { CATALOG, CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import type { ProfessionalRecord } from '../api/parse'

function record(overrides: Partial<ProfessionalRecord> = {}): ProfessionalRecord {
  return { ...recordFixture(), ...overrides }
}

/** The fixture with the matching profile's client limits (P4-245). */
function limited(minClientAge: number | null, womenOnly: boolean, clienteles: ProfessionalRecord['clienteles']): ProfessionalRecord {
  const base = recordFixture()
  return { ...base, clienteles, matchingProfile: { ...base.matchingProfile, minClientAge, womenOnly } }
}

describe('matchingDigest', () => {
  it('puts specialised clientèles first, then the catalogue order', () => {
    const digest = matchingDigest(
      record({
        clienteles: [
          { id: IDS.children, specialized: false },
          { id: IDS.couples, specialized: true },
          { id: IDS.seniors, specialized: false },
        ],
      }),
      CATALOG_VIEW,
    )
    expect(digest.clienteles.map((c) => [c.label, c.specialized])).toEqual([
      ['Couples', true],
      ['Enfants (0 à 12 ans)', false],
      ['Aînés (65 ans et plus)', false],
    ])
    expect(digest).not.toHaveProperty('approaches')
  })

  it('keeps a held archived clientèle, marked « (archivé) », in its place', () => {
    const archive = <T extends { id: string; isActive: boolean }>(rows: T[], id: string) => rows.map((row) => (row.id === id ? { ...row, isActive: false } : row))
    const catalog = buildCatalogView({ ...CATALOG, clienteles: archive(CATALOG.clienteles, IDS.couples) })
    const digest = matchingDigest(
      record({
        clienteles: [
          { id: IDS.children, specialized: false },
          { id: IDS.couples, specialized: true },
        ],
      }),
      catalog,
    )
    expect(digest.clienteles.map((c) => [c.label, c.specialized, c.archived])).toEqual([
      ['Couples', true, true],
      ['Enfants (0 à 12 ans)', false, false],
    ])
  })

  it('reads the youngest client age on the youngest held age group: « Enfants (8 ans et plus) » (P4-245)', () => {
    const both = [
      { id: IDS.seniors, specialized: false },
      { id: IDS.children, specialized: true },
    ]
    const digest = matchingDigest(limited(8, true, both), CATALOG_VIEW)
    expect(digest.clienteles.map((c) => c.label)).toEqual(['Enfants (8 ans et plus)', 'Aînés (65 ans et plus)'])
    expect(digest).toMatchObject({ minClientAge: null, womenOnly: true })
    // An age the youngest group already starts at adds nothing.
    expect(matchingDigest(limited(0, false, both), CATALOG_VIEW).clienteles.map((c) => c.label)).toEqual(['Enfants (0 à 12 ans)', 'Aînés (65 ans et plus)'])
  })

  it('says the youngest client age apart when no age group is held', () => {
    const digest = matchingDigest(limited(14, false, [{ id: IDS.couples, specialized: false }]), CATALOG_VIEW)
    expect(digest.clienteles.map((c) => c.label)).toEqual(['Couples'])
    expect(digest).toMatchObject({ minClientAge: 14, womenOnly: false })
  })

  it('lists the motifs by category (summarizeMotifs)', () => {
    const digest = matchingDigest(record({ motifIds: [IDS.orphan, IDS.anxiete] }), CATALOG_VIEW)
    expect(digest.motifs.groups.map((g) => g.name)).toEqual(['Vie intérieure', 'Sans catégorie'])
  })

  it('names the languages and the availability, and skips ids the catalogue does not know', () => {
    const digest = matchingDigest(record({ languageIds: [IDS.en, IDS.fr, 'unknown'], motifIds: ['unknown'] }), CATALOG_VIEW)
    expect(digest.languages.map((l) => l.label)).toEqual(['Français', 'Anglais'])
    expect(digest.motifs.selected).toBe(0)
    expect(digest.periods).toBe('Matin · Soir')
    expect(digest.acceptingNewClients).toBe(true)
    expect(digest.note).toBeNull()
  })

  it('is empty without any choice', () => {
    const base = recordFixture()
    const digest = matchingDigest(
      record({ clienteles: [], motifIds: [], languageIds: [], matchingProfile: { ...base.matchingProfile, availabilityPeriods: [], availabilityNote: ' Pas le vendredi. ' } }),
      CATALOG_VIEW,
    )
    expect(digest).toMatchObject({ clienteles: [], minClientAge: null, womenOnly: false, languages: [], periods: '', note: 'Pas le vendredi.' })
  })
})
