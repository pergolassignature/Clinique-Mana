import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { CATALOG_VIEW } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import {
  availabilitySchema,
  insuranceSchema,
  parseValidFields,
  personalSchema,
  professionalSchema,
  taxBankSchema,
  toAvailabilityValues,
  toPersonalValues,
  toTaxBankValues,
} from './questionnaire'

const V = 'modules.professionals.questionnaire.validation'

describe('personalSchema', () => {
  const filled = { personal_phone: '514 555-1234', address_line1: ' 1  rue A ', address_line2: '', city: 'Laval', province: 'QC', postal_code: 'h7a1a1' }

  it('parses into what the database stores', () => {
    expect(personalSchema.parse(filled)).toEqual({
      personal_phone: '+15145551234',
      address_line1: '1 rue A',
      address_line2: null,
      city: 'Laval',
      province: 'QC',
      postal_code: 'H7A 1A1',
    })
  })

  it('requires what the contract needs (P4-173)', () => {
    const result = personalSchema.safeParse({ ...filled, personal_phone: '', city: ' ', postal_code: '' })
    expect(result.success).toBe(false)
    const messages = result.error?.issues.map((i) => [i.path[0], i.message])
    expect(messages).toContainEqual(['personal_phone', t(`${V}.phoneRequired`)])
    expect(messages).toContainEqual(['city', t(`${V}.cityRequired`)])
    expect(messages).toContainEqual(['postal_code', t(`${V}.postalCodeRequired`)])
  })

  it('shows the stored phone as typed in Québec, and defaults the province', () => {
    expect(toPersonalValues({ personal_phone: '+15145551234', province: null })).toMatchObject({ personal_phone: '514 555-1234', province: 'QC' })
  })
})

describe('parseValidFields (the autosave)', () => {
  it('keeps the fields that parse and leaves out the ones still being typed', () => {
    expect(parseValidFields(personalSchema, { personal_phone: '514', city: 'Laval', province: 'QC', postal_code: 'H7A' })).toEqual({ city: 'Laval', province: 'QC' })
  })
})

describe('professionalSchema', () => {
  const schema = professionalSchema(CATALOG_VIEW, { heldTitleIds: [], heldMotifIds: [] })

  it('needs a title, and the licence of a regulated one', () => {
    expect(schema.safeParse({ professions: [], years_experience: '' }).error?.issues[0]?.message).toBe(t(`${V}.titleRequired`))
    expect(schema.safeParse({ professions: [{ titleId: IDS.psychologue, licenceNumber: '', isPrimary: true }], years_experience: '' }).success).toBe(false)
  })

  it('parses titles into the section’s shape, years 0–60', () => {
    expect(schema.parse({ professions: [{ titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true }], years_experience: '12' })).toEqual({
      professions: [{ title_id: IDS.psychologue, licence_number: '12345', is_primary: true }],
      years_experience: 12,
    })
    expect(schema.shape.years_experience.safeParse('61').success).toBe(false)
  })
})

describe('availabilitySchema', () => {
  it('orders the periods as the database does, « Fin de journée » included', () => {
    expect(availabilitySchema.parse({ availability_periods: ['weekend', 'end_of_day', 'am'], accepting_new_clients: true, availability_note: '' })).toEqual({
      availability_periods: ['am', 'end_of_day', 'weekend'],
      accepting_new_clients: true,
      availability_note: null,
    })
  })

  it('treats a missing matching profile as accepting new clients', () => {
    expect(toAvailabilityValues({ accepting_new_clients: null }).accepting_new_clients).toBe(true)
  })
})

describe('insuranceSchema', () => {
  const schema = insuranceSchema('2026-10-08')
  const message = (value: string) => schema.safeParse({ expires_on: value }).error?.issues[0]?.message

  it('takes a real date from the clinic’s today to 2100', () => {
    expect(schema.safeParse({ expires_on: '2026-10-08' }).success).toBe(true)
    expect(message('2026-10-07')).toBe(t(`${V}.expiryPast`))
    expect(message('2026-02-30')).toBe(t(`${V}.dateInvalid`))
    expect(message('2101-01-01')).toBe(t(`${V}.expiryTooFar`))
    expect(message('')).toBe(t(`${V}.expiryRequired`))
  })
})

describe('taxBankSchema', () => {
  const blank = toTaxBankValues(null)

  it('requires institution, transit and an account while none is on file', () => {
    const result = taxBankSchema({ accountOnFile: false, sinOnFile: false, collectSin: false }).safeParse(blank)
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(['bank_institution', 'bank_transit', 'bank_account'])
  })

  it('keeps an account on file when left blank, and strips separators', () => {
    const schema = taxBankSchema({ accountOnFile: true, sinOnFile: false, collectSin: false })
    expect(schema.parse({ ...blank, bank_institution: '815', bank_transit: '30-000', gst_number: '123456789 rt 0001' })).toEqual({
      business_number: null,
      gst_number: '123456789RT0001',
      qst_number: null,
      bank_institution: '815',
      bank_transit: '30000',
      bank_account: null,
      sin: null,
    })
  })

  it('asks the SIN only while the clinic collects it, with the Luhn check', () => {
    const values = { ...blank, bank_institution: '815', bank_transit: '30000', bank_account: '1234567', sin: '046 454 287' }
    expect(taxBankSchema({ accountOnFile: false, sinOnFile: false, collectSin: false }).parse(values).sin).toBeNull()
    const collecting = taxBankSchema({ accountOnFile: false, sinOnFile: false, collectSin: true })
    expect(collecting.safeParse(values).error?.issues[0]?.path).toEqual(['sin'])
    expect(collecting.parse({ ...values, sin: '046 454 286' }).sin).toBe('046454286')
  })

  it('never prefills the account or the SIN', () => {
    expect(toTaxBankValues({ businessNumber: null, gstNumber: '123456789RT0001', qstNumber: null, bankInstitution: '815', bankTransit: '30000' })).toEqual({
      business_number: '',
      gst_number: '123456789 RT 0001',
      qst_number: '',
      bank_institution: '815',
      bank_transit: '30000',
      bank_account: '',
      sin: '',
    })
  })
})
