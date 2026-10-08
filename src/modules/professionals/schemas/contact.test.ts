import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { contactSchema, loginEmailSchema, toContactFormValues } from './contact'
import { recordFixture } from '../test/fixtures-domain'
import { errorAt } from '../test/schema-helpers'

const professional = recordFixture().professional

describe('contactSchema', () => {
  it('round-trips the record', () => {
    const values = toContactFormValues(professional)
    expect(values).toEqual({
      personalPhone: '+15145551234',
      addressLine1: '123, rue Saint-Denis',
      addressLine2: '',
      city: 'Montréal',
      province: 'QC',
      postalCode: 'H2X 1Y4',
    })
    expect(contactSchema.parse(values)).toEqual({
      personalPhone: '+15145551234',
      addressLine1: '123, rue Saint-Denis',
      addressLine2: null,
      city: 'Montréal',
      province: 'QC',
      postalCode: 'H2X 1Y4',
    })
  })

  it('normalises the phone (E.164) and the postal code (A1A 1A1)', () => {
    expect(contactSchema.parse({ ...toContactFormValues(professional), personalPhone: '514 555-9876', postalCode: 'h2x1y4' })).toMatchObject({
      personalPhone: '+15145559876',
      postalCode: 'H2X 1Y4',
    })
  })

  it('refuses a bad phone, postal code or province', () => {
    const base = toContactFormValues(professional)
    expect(errorAt(contactSchema, { ...base, personalPhone: '555' }, 'personalPhone')).toBe(t('settings.validation.phone'))
    expect(errorAt(contactSchema, { ...base, postalCode: '12345' }, 'postalCode')).toBe(t('settings.validation.postalCode'))
    expect(errorAt(contactSchema, { ...base, province: '' }, 'province')).toBe(t('settings.validation.province'))
  })
})

describe('loginEmailSchema', () => {
  it('trims and lower-cases', () => {
    expect(loginEmailSchema.parse({ email: ' Nouveau@Exemple.CA ' })).toEqual({ email: 'nouveau@exemple.ca' })
  })

  it('refuses an invalid address or a control character', () => {
    expect(errorAt(loginEmailSchema, { email: 'nouveau@exemple' }, 'email')).toBe('Courriel invalide.')
    expect(errorAt(loginEmailSchema, { email: 'a\u0000b@x.ca' }, 'email')).toBe(t('settings.validation.controlChar'))
  })
})
