import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { clienteleLabel, fullName, genderLabel, languagesLabel, periodsLabel, primaryProfession, professionLine, statusLabel } from './display'
import { CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

describe('fullName', () => {
  it('is « Prénom Nom »', () => {
    expect(fullName({ firstName: 'Marie', lastName: 'Tremblay' })).toBe('Marie Tremblay')
  })
})

describe('clienteleLabel', () => {
  it.each([
    [{ name: 'Enfants', minAge: 0, maxAge: 12 }, 'Enfants (0–12 ans)'],
    [{ name: 'Aînés', minAge: 65, maxAge: null }, 'Aînés (65 ans et plus)'],
    [{ name: 'Couples', minAge: null, maxAge: null }, 'Couples'],
  ])('%o → %s', (clientele, label) => {
    expect(clienteleLabel(clientele)).toBe(label)
  })
})

describe('languagesLabel', () => {
  it('lists the codes in the catalogue order, upper-cased', () => {
    expect(languagesLabel([IDS.en, IDS.fr], CATALOG_VIEW)).toBe('FR · EN')
  })

  it('skips unknown ids and is empty without languages', () => {
    expect(languagesLabel(['unknown', IDS.en], CATALOG_VIEW)).toBe('EN')
    expect(languagesLabel([], CATALOG_VIEW)).toBe('')
  })
})

describe('professionLine', () => {
  it('is « Titre · SIGLE permis » for a regulated title', () => {
    expect(professionLine({ titleId: IDS.psychologue, licenceNumber: '12345' }, CATALOG_VIEW)).toBe('Psychologue · OPQ 12345')
  })

  it('is the title alone without an order or a licence', () => {
    expect(professionLine({ titleId: IDS.naturopathe, licenceNumber: null }, CATALOG_VIEW)).toBe('Naturopathe')
    expect(professionLine({ titleId: IDS.psychologue, licenceNumber: null }, CATALOG_VIEW)).toBe('Psychologue · OPQ')
  })

  it('shows a licence held under a title without an order', () => {
    expect(professionLine({ titleId: IDS.naturopathe, licenceNumber: 'N-1' }, CATALOG_VIEW)).toBe('Naturopathe · N-1')
  })

  it('is empty without a title, or for an unknown one', () => {
    expect(professionLine(null, CATALOG_VIEW)).toBe('')
    expect(professionLine({ titleId: 'unknown', licenceNumber: '1' }, CATALOG_VIEW)).toBe('')
  })
})

describe('primaryProfession', () => {
  it('is the primary title row', () => {
    expect(primaryProfession(recordFixture())?.titleId).toBe(IDS.psychologue)
    expect(primaryProfession({ ...recordFixture(), professions: [] })).toBeNull()
  })
})

describe('labels', () => {
  it('status, gender and periods in French', () => {
    expect(statusLabel('draft')).toBe(t('modules.professionals.status.draft'))
    expect(statusLabel('in_review')).toBe('À réviser')
    expect(genderLabel('unspecified')).toBe('Autre / non précisé')
    expect(periodsLabel(['evening', 'am'])).toBe('Matin · Soir')
    expect(periodsLabel([])).toBe('')
  })
})
