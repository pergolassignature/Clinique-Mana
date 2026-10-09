import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { MOTIF_CATEGORY_ICONS, PROFESSIONAL_STATUSES } from './constants'
import {
  agesLabel,
  clienteleLabel,
  minAgeClienteleLabel,
  minClientAgeLabel,
  fullName,
  genderLabel,
  languagesLabel,
  listLabel,
  motifIconLabel,
  periodsLabel,
  placesLabel,
  primaryProfession,
  professionLine,
  statusLabel,
  statusTone,
} from './display'
import { CATALOG_VIEW, GENDERED_CATALOG_VIEW, recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

describe('fullName', () => {
  it('is « Prénom Nom »', () => {
    expect(fullName({ firstName: 'Marie', lastName: 'Tremblay' })).toBe('Marie Tremblay')
  })
})

describe('motifIconLabel', () => {
  it('names each of the 20 icons in French, each differently', () => {
    const labels = MOTIF_CATEGORY_ICONS.map(motifIconLabel)
    for (const [i, icon] of MOTIF_CATEGORY_ICONS.entries()) expect(labels[i]).not.toContain(icon)
    expect(new Set(labels).size).toBe(MOTIF_CATEGORY_ICONS.length)
    expect(motifIconLabel('Heart')).toBe('Cœur')
  })
})

describe('agesLabel', () => {
  it.each([
    [{ minAge: 6, maxAge: 12 }, '6 à 12 ans'],
    [{ minAge: 0, maxAge: 1 }, '0 à 1 an'],
    // The unit follows the maximum: « an » under 2, « ans » from 2.
    [{ minAge: 0, maxAge: 2 }, '0 à 2 ans'],
    [{ minAge: 1, maxAge: 2 }, '1 à 2 ans'],
    [{ minAge: 18, maxAge: null }, '18 ans et plus'],
    [{ minAge: 1, maxAge: null }, '1 an et plus'],
    [{ minAge: 2, maxAge: null }, '2 ans et plus'],
    [{ minAge: 12, maxAge: 12 }, '12 ans'],
    [{ minAge: 1, maxAge: 1 }, '1 an'],
    [{ minAge: 2, maxAge: 2 }, '2 ans'],
    // « 0 an » is not French: a group of babies under their first birthday.
    [{ minAge: 0, maxAge: 0 }, 'Moins de 1 an'],
    [{ minAge: 0, maxAge: null }, 'Tous les âges'],
    [{ minAge: 120, maxAge: 120 }, '120 ans'],
    // Not an age group (couples, familles, groupes); P4-52: not « Sans limite d'âge », which reads like « Tous les âges ».
    [{ minAge: null, maxAge: null }, 'Sans âge'],
    // A maximum without a minimum cannot be saved (schema and database); the minimum decides.
    [{ minAge: null, maxAge: 12 }, 'Sans âge'],
  ])('%o → %s', (bounds, label) => {
    expect(agesLabel(bounds)).toBe(label)
  })
})

describe('minAgeClienteleLabel and minClientAgeLabel (P4-245)', () => {
  it('say the youngest client age in the website’s words', () => {
    expect(minAgeClienteleLabel('Adolescents', 14)).toBe('Adolescents (14 ans et plus)')
    expect(minAgeClienteleLabel('Enfants', 1)).toBe('Enfants (1 an et plus)')
    expect(minClientAgeLabel(8)).toBe('Âge minimum\u00a0: 8 ans')
  })
})

describe('clienteleLabel', () => {
  it.each([
    [{ name: 'Enfants', minAge: 0, maxAge: 12 }, 'Enfants (0 à 12 ans)'],
    [{ name: 'Aînés', minAge: 65, maxAge: null }, 'Aînés (65 ans et plus)'],
    // The ages run on from the name: lower-case inside the brackets (agesLabel alone stays capitalised).
    [{ name: 'Nourrissons', minAge: 0, maxAge: 0 }, 'Nourrissons (moins de 1 an)'],
    [{ name: 'Individus', minAge: 0, maxAge: null }, 'Individus (tous les âges)'],
    // Not an age group: its name says it all.
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
    expect(professionLine({ titleId: IDS.psychologue, licenceNumber: '12345' }, CATALOG_VIEW, null)).toBe('Psychologue · OPQ 12345')
  })

  it('is the title alone without an order or a licence', () => {
    expect(professionLine({ titleId: IDS.naturopathe, licenceNumber: null }, CATALOG_VIEW, null)).toBe('Naturopathe')
    expect(professionLine({ titleId: IDS.psychologue, licenceNumber: null }, CATALOG_VIEW, 'female')).toBe('Psychologue · OPQ')
  })

  it('shows a licence held under a title without an order', () => {
    expect(professionLine({ titleId: IDS.naturopathe, licenceNumber: 'N-1' }, CATALOG_VIEW, 'male')).toBe('Naturopathe · N-1')
  })

  it('names the title in the professional\'s form (P4-342)', () => {
    const row = { titleId: IDS.travailleurSocial, licenceNumber: 'TS04518' }
    expect(professionLine(row, GENDERED_CATALOG_VIEW, 'female')).toBe('Travailleuse sociale · OPQ TS04518')
    expect(professionLine(row, GENDERED_CATALOG_VIEW, 'male')).toBe('Travailleur social · OPQ TS04518')
    expect(professionLine(row, GENDERED_CATALOG_VIEW, 'unspecified')).toBe('Travailleuse sociale ou travailleur social · OPQ TS04518')
    expect(professionLine(row, GENDERED_CATALOG_VIEW, null)).toBe('Travailleuse sociale ou travailleur social · OPQ TS04518')
  })

  it('is empty without a title, or for an unknown one', () => {
    expect(professionLine(null, CATALOG_VIEW, null)).toBe('')
    expect(professionLine({ titleId: 'unknown', licenceNumber: '1' }, CATALOG_VIEW, null)).toBe('')
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
    // « Fin de journée » (P4-250) sits between the afternoon and the evening.
    expect(periodsLabel(['weekend', 'evening', 'end_of_day', 'pm', 'am'])).toBe('Matin · Après-midi · Fin de journée · Soir · Fin de semaine')
    expect(periodsLabel(['end_of_day', 'am'])).toBe('Matin · Fin de journée')
    expect(periodsLabel([])).toBe('')
  })
})

describe('statusTone', () => {
  it('colours the dot by status (P4-43: « À réviser » yellow)', () => {
    expect(PROFESSIONAL_STATUSES.map(statusTone)).toEqual(['secondary', 'secondary', 'warning', 'success', 'error'])
  })
})

describe('listLabel', () => {
  it('joins names the French way', () => {
    expect(listLabel(['Anxiété'])).toBe('Anxiété')
    expect(listLabel(['Anxiété', 'Deuil'])).toBe('Anxiété et Deuil')
    expect(listLabel(['Anxiété', 'Deuil', 'Psychose'])).toBe('Anxiété, Deuil et Psychose')
  })
})

describe('placesLabel (P4-382)', () => {
  const now = Date.parse('2026-10-08T16:00:00Z')
  it('says the number and since when, the year only when it is not this one', () => {
    expect(placesLabel(4, '2026-10-08T14:00:00Z', now)).toBe('4 places offertes · depuis le 8 oct.')
    expect(placesLabel(1, '2026-10-01T14:00:00Z', now)).toBe('1 place offerte · depuis le 1 oct.')
    expect(placesLabel(0, '2025-12-15T14:00:00Z', now)).toBe('Aucune place offerte · depuis le 15 déc. 2025')
  })

  it('reads « Non suivies » without a number, the date in the clinic’s time zone', () => {
    expect(placesLabel(null, null, now)).toBe(t('modules.professionals.record.overview.matching.placesNotTracked'))
    // 02:00 UTC on the 9th is still the 8th in Toronto.
    expect(placesLabel(2, '2026-10-09T02:00:00Z', now)).toBe('2 places offertes · depuis le 8 oct.')
  })
})
