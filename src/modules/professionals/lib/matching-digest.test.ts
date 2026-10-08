import { describe, expect, it } from 'vitest'
import { matchingDigest } from './matching-digest'
import { CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import type { ProfessionalRecord } from '../api/parse'

function record(overrides: Partial<ProfessionalRecord> = {}): ProfessionalRecord {
  return { ...recordFixture(), ...overrides }
}

describe('matchingDigest', () => {
  it('puts specialised clientèles and approaches first, then the catalogue order', () => {
    const digest = matchingDigest(
      record({
        clienteles: [
          { id: IDS.children, specialized: false },
          { id: IDS.couples, specialized: true },
          { id: IDS.seniors, specialized: false },
        ],
        specialties: [{ id: IDS.cbt, specialized: true }],
      }),
      CATALOG_VIEW,
    )
    expect(digest.clienteles.map((c) => [c.label, c.specialized])).toEqual([
      ['Couples', true],
      ['Enfants (0 à 12 ans)', false],
      ['Aînés (65 ans et plus)', false],
    ])
    expect(digest.approaches).toEqual([{ id: IDS.cbt, label: 'Thérapie cognitivo-comportementale (TCC)', specialized: true, archived: false }])
  })

  it('summarises the motifs (summarizeMotifs)', () => {
    const digest = matchingDigest(record({ motifIds: [IDS.orphan, IDS.anxiete] }), CATALOG_VIEW)
    expect(digest.motifs.groups.map((g) => g.name)).toEqual(['Vie intérieure', 'Autres'])
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
      record({ clienteles: [], specialties: [], motifIds: [], languageIds: [], matchingProfile: { ...base.matchingProfile, availabilityPeriods: [], availabilityNote: ' Pas le vendredi. ' } }),
      CATALOG_VIEW,
    )
    expect(digest).toMatchObject({ clienteles: [], approaches: [], languages: [], periods: '', note: 'Pas le vendredi.' })
  })
})
