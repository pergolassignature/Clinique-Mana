import { describe, expect, it } from 'vitest'
import { IDS } from '../test/fixtures'
import { recordFixture } from '../test/fixtures-domain'
import { profileAction, recordSectionValues } from './my-profile'

describe('recordSectionValues', () => {
  it('writes the record as the questionnaire’s sections hold it (the snapshot’s keys and shapes)', () => {
    const values = recordSectionValues(recordFixture())
    expect(values.personal).toEqual({
      personal_phone: '+15145551234',
      address_line1: '123, rue Saint-Denis',
      address_line2: null,
      city: 'Montréal',
      province: 'QC',
      postal_code: 'H2X 1Y4',
    })
    expect(values.professional).toEqual({ professions: [{ title_id: IDS.psychologue, licence_number: '12345', is_primary: true }], years_experience: 12 })
    expect(values.clienteles).toEqual({ clienteles: [{ id: IDS.couples, specialized: true }], min_client_age: null, women_only: false })
    expect(values.motifs).toEqual({ motif_ids: [IDS.anxiete] })
    expect(values.languages).toEqual({ language_ids: [IDS.fr] })
    expect(values.availability).toEqual({ accepting_new_clients: true, availability_periods: ['am', 'evening'], availability_note: null })
  })
})

describe('profileAction', () => {
  it.each([
    ['active', null, 'update'],
    ['in_review', null, 'update'],
    ['active', { status: 'draft' }, 'continue'],
    ['active', { status: 'submitted' }, 'sent'],
    ['inactive', null, 'inactive'],
    ['inactive', { status: 'draft' }, 'inactive'],
    // A profile sent before the deactivation is still with the clinic.
    ['inactive', { status: 'submitted' }, 'sent'],
  ] as const)('%s with %o offers %s', (status, open, action) => {
    expect(profileAction(status, open)).toBe(action)
  })
})
