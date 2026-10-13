import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { clientFixture } from '../test/fixtures'
import { ALL_CLIENT_FIELDS, clientCardSchema, clientFormValues, emptyClientForm, fieldOfHint, toClientFields } from './client'

describe('the client form', () => {
  it('normalises a new file: trimmed names, E.164 phones, postal code, empty → null', () => {
    const output = clientCardSchema(ALL_CLIENT_FIELDS).parse({
      ...emptyClientForm(),
      firstName: '  Alice ',
      lastName: 'Tremblay',
      email: ' Alice@Exemple.test ',
      mobile: '514 555-0101',
      postalCode: 'h2x1a1',
      birthday: '1990-03-04',
    })
    expect(output).toMatchObject({
      firstName: 'Alice',
      email: 'Alice@Exemple.test',
      mobile: '+15145550101',
      home: null,
      postalCode: 'H2X 1A1',
      province: 'QC',
      country: 'CA',
      birthday: '1990-03-04',
      sex: null,
    })
    expect(toClientFields(output)).toMatchObject({ first_name: 'Alice', mobile_e164: '+15145550101', postal_code: 'H2X 1A1', reminders_by_sms: true })
  })

  it('refuses a missing name, a phone it cannot read and a Canadian postal code in another shape', () => {
    const result = clientCardSchema(ALL_CLIENT_FIELDS).safeParse({ ...emptyClientForm(), lastName: 'X', mobile: '555-12' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(expect.arrayContaining(['firstName', 'mobile']))
    expect(result.error?.issues.find((issue) => issue.path[0] === 'firstName')?.message).toBe(t('modules.clients.validation.firstName'))
    const postal = clientCardSchema(['province', 'postalCode', 'country']).safeParse({ ...emptyClientForm(), postalCode: '12345' })
    expect(postal.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['postalCode'])
  })

  it('takes a province and postal code as written abroad', () => {
    const output = clientCardSchema(['province', 'postalCode', 'country']).parse({ ...emptyClientForm(), country: 'FR', province: 'Île-de-France', postalCode: '75001' })
    expect(output).toEqual({ province: 'Île-de-France', postalCode: '75001', country: 'FR' })
  })

  it('a card sends its own fields only (update_client keeps the others, the time zone included)', () => {
    const output = clientCardSchema(['email', 'mobile']).parse(clientFormValues(clientFixture({ email: 'nouveau@exemple.test' })))
    expect(toClientFields(output)).toEqual({ email: 'nouveau@exemple.test', mobile_e164: '+15145550101' })
  })

  it('reads a stored file as form values (phones regrouped) and maps a refusal HINT to its field', () => {
    expect(clientFormValues(clientFixture())).toMatchObject({ mobile: '514 555-0101', home: '', sex: 'female', rateVariant: 'student' })
    expect(fieldOfHint('mobile_e164')).toBe('mobile')
    expect(fieldOfHint('duplicate')).toBeNull()
  })
})
