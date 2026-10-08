import { describe, expect, it } from 'vitest'
import { IDS } from '../test/fixtures'
import { CATALOG_VIEW, GENDERED_CATALOG_VIEW, recordFixture, socialWorkerRecord } from '../test/fixtures-domain'
import { ficheFileName as serverFicheFileName } from '../../../../supabase/functions/professionals-fiche/file-name'
import { ficheFileName, ficheTitles } from './fiche'

describe('ficheTitles', () => {
  it('lists the titles the fiche can carry, the primary first, named from the catalogue', () => {
    const professions = [
      { id: 'r2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: false },
      { id: 'r1', titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true },
    ]
    expect(ficheTitles({ ...recordFixture(), professions }, CATALOG_VIEW)).toEqual([
      { titleId: IDS.psychologue, name: 'Psychologue' },
      { titleId: IDS.naturopathe, name: 'Naturopathe' },
    ])
  })

  it('keeps an archived title (still theirs) and skips one the catalogue does not know', () => {
    const professions = [
      { id: 'r1', titleId: IDS.archivedTitle, licenceNumber: null, isPrimary: true },
      { id: 'r2', titleId: 'unknown', licenceNumber: null, isPrimary: false },
    ]
    expect(ficheTitles({ ...recordFixture(), professions }, CATALOG_VIEW)).toEqual([{ titleId: IDS.archivedTitle, name: 'Ancien titre' }])
    expect(ficheTitles({ ...recordFixture(), professions: [] }, CATALOG_VIEW)).toEqual([])
  })

  it('names each title in the professional\'s form (P4-342)', () => {
    expect(ficheTitles(socialWorkerRecord('female'), GENDERED_CATALOG_VIEW)).toEqual([{ titleId: IDS.travailleurSocial, name: 'Travailleuse sociale' }])
    expect(ficheTitles(socialWorkerRecord('male'), GENDERED_CATALOG_VIEW)).toEqual([{ titleId: IDS.travailleurSocial, name: 'Travailleur social' }])
    expect(ficheTitles(socialWorkerRecord(null), GENDERED_CATALOG_VIEW)).toEqual([
      { titleId: IDS.travailleurSocial, name: 'Travailleuse sociale ou travailleur social' },
    ])
  })
})

describe('ficheFileName', () => {
  it.each([
    [{ firstName: 'Geneviève', lastName: 'Tremblay' }, 'Fiche - Geneviève Tremblay.pdf'],
    [{ firstName: 'Marc-André', lastName: "O'Neil" }, "Fiche - Marc-André O'Neil.pdf"],
    [{ firstName: 'Łukasz', lastName: 'Dvořák' }, 'Fiche - Łukasz Dvořák.pdf'],
    // Decomposed accents are composed first, so they stay letters.
    [{ firstName: 'Ge\u0301raldine', lastName: 'Roy' }, 'Fiche - Géraldine Roy.pdf'],
    // A path, a quote, a control or bidirectional character: never in a file name.
    [{ firstName: 'Anne/Marie', lastName: 'Roy\u202e"\t<b>' }, 'Fiche - Anne Marie Roy b.pdf'],
    [{ firstName: '***', lastName: '' }, 'Fiche.pdf'],
  ])('%j → %s', (person, expected) => {
    expect(ficheFileName(person)).toBe(expected)
  })

  it('stays within the 100 characters an attachment name may have, the extension kept', () => {
    const name = ficheFileName({ firstName: 'Anne'.repeat(30), lastName: 'Roy' })
    expect(Array.from(name)).toHaveLength(100)
    expect(name.endsWith('.pdf')).toBe(true)
    // The email path's own rule (SAFE_FILENAME, _shared/email/send.ts).
    expect(name).toMatch(/^[\p{L}\p{N}][\p{L}\p{N} '’()._-]{0,95}\.pdf$/iu)
  })
})

describe('ficheFileName parity', () => {
  it.each([
    ['Geneviève', 'Tremblay'],
    ['Marc-André', "O'Neil"],
    ['Łukasz', 'Dvořák'],
    ['Ge\u0301raldine', 'Roy'],
    ['Anne/Marie', 'Roy\u202e"\t<b>'],
    ['***', ''],
    ['Anne'.repeat(30), 'Roy'],
  ])('the download and the emailed attachment are named alike (%s %s)', (firstName, lastName) => {
    expect(serverFicheFileName({ firstName, lastName })).toBe(ficheFileName({ firstName, lastName }))
  })
})
