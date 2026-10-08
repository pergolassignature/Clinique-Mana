import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type { Organization } from './api'
import {
  addressSchema,
  clinicSchema,
  contactSchema,
  PROVINCES,
  privacyOfficerSchema,
  privacyPolicySchema,
  regionSchema,
  signatorySchema,
  taxNumbersSchema,
  toAddressFormValues,
  toClinicFormValues,
  toContactFormValues,
  toPrivacyOfficerFormValues,
  toPrivacyPolicyFormValues,
  toRegionFormValues,
  toSignatoryFormValues,
  toTaxNumbersFormValues,
} from './schemas'

/** The French message of the first issue on `field`, or undefined when the value parses. */
function errorOf(schema: z.ZodType, values: unknown, field: string): string | undefined {
  const result = schema.safeParse(values)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path[0] === field)?.message
}

const ORG: Organization = {
  id: 'o1',
  name: 'Clinique MANA',
  timezone: 'America/Toronto',
  default_locale: 'fr-CA',
  currency: 'CAD',
  legal_name: '9999-9999 Québec inc.',
  neq: '1234567890',
  address_line1: '123, rue Saint-Denis',
  address_line2: 'Bureau 200',
  city: 'Montréal',
  province: 'QC',
  postal_code: 'H2X 1Y4',
  country: 'CA',
  phone: '+15145551234',
  email: 'info@cliniquemana.com',
  website: 'https://cliniquemana.com',
  gst_number: '123456789RT0001',
  qst_number: '1234567890TQ0001',
  signatory_name: 'Marie Tremblay',
  signatory_title: 'Directrice',
  privacy_officer_name: 'Julie Roy',
  privacy_officer_email: 'vie-privee@cliniquemana.com',
  privacy_policy_url: 'https://cliniquemana.com/confidentialite',
  record_retention_years: 7,
  updated_at: '2026-10-07T12:00:00Z',
}

const EMPTY_ORG: Organization = {
  ...ORG,
  legal_name: null,
  neq: null,
  address_line1: null,
  address_line2: null,
  city: null,
  province: null,
  postal_code: null,
  phone: null,
  email: null,
  website: null,
  gst_number: null,
  qst_number: null,
  signatory_name: null,
  signatory_title: null,
  privacy_officer_name: null,
  privacy_officer_email: null,
  privacy_policy_url: null,
  record_retention_years: null,
}

describe('clinicSchema', () => {
  const valid = { name: 'Clinique MANA', legal_name: '9999-9999 Québec inc.', neq: '1234567890' }

  it('trims and normalises the NEQ (spaces and dashes removed)', () => {
    expect(clinicSchema.parse({ name: '  Clinique MANA ', legal_name: ' 9999-9999 Québec inc. ', neq: ' 1234 567-890 ' })).toEqual({
      name: 'Clinique MANA',
      legal_name: '9999-9999 Québec inc.',
      neq: '1234567890',
    })
  })

  it('also strips en and em dashes from the NEQ (pasted from a document)', () => {
    expect(clinicSchema.parse({ ...valid, neq: '1234\u2013567\u2014890' }).neq).toBe('1234567890')
  })

  it('turns empty or blank optional values into null', () => {
    expect(clinicSchema.parse({ name: 'Clinique MANA', legal_name: ' \t\n', neq: '' })).toEqual({
      name: 'Clinique MANA',
      legal_name: null,
      neq: null,
    })
  })

  it('requires the display name', () => {
    expect(errorOf(clinicSchema, { ...valid, name: '   ' }, 'name')).toBe('Le nom est requis.')
  })

  it('caps the lengths like the database (200)', () => {
    expect(errorOf(clinicSchema, { ...valid, legal_name: 'a'.repeat(200) }, 'legal_name')).toBeUndefined()
    expect(errorOf(clinicSchema, { ...valid, legal_name: 'a'.repeat(201) }, 'legal_name')).toBe('200 caractères maximum.')
    expect(errorOf(clinicSchema, { ...valid, name: 'a'.repeat(201) }, 'name')).toBe('200 caractères maximum.')
  })

  it.each(['123', '12345678901', '123456789A', '１２３４５６７８９０'])('refuses the NEQ %s', (neq) => {
    expect(errorOf(clinicSchema, { ...valid, neq }, 'neq')).toBe('Le NEQ compte 10 chiffres.')
  })
})

describe('addressSchema', () => {
  const valid = { address_line1: '123, rue Saint-Denis', address_line2: '', city: 'Montréal', province: 'QC', postal_code: 'H2X 1Y4' }

  it('uppercases the postal code and inserts its space', () => {
    expect(addressSchema.parse({ ...valid, postal_code: ' h2x1y4 ' }).postal_code).toBe('H2X 1Y4')
    expect(addressSchema.parse({ ...valid, postal_code: 'h2x 1y4' }).postal_code).toBe('H2X 1Y4')
  })

  it.each(['H2X-1Y4', 'h2x\u20131y4', 'H2X \u2014 1Y4'])('strips the dash from the postal code %s', (postal_code) => {
    expect(addressSchema.parse({ ...valid, postal_code }).postal_code).toBe('H2X 1Y4')
  })

  it('trims text and turns empty values into null, including « no province »', () => {
    expect(addressSchema.parse({ address_line1: ' 123, rue Saint-Denis ', address_line2: ' ', city: '', province: '', postal_code: '' })).toEqual({
      address_line1: '123, rue Saint-Denis',
      address_line2: null,
      city: null,
      province: null,
      postal_code: null,
    })
  })

  it('accepts the 13 province and territory codes', () => {
    expect(PROVINCES).toHaveLength(13)
    for (const province of PROVINCES) expect(addressSchema.parse({ ...valid, province }).province).toBe(province)
  })

  it('refuses an unknown province', () => {
    expect(errorOf(addressSchema, { ...valid, province: 'XX' }, 'province')).toBe('Province invalide.')
  })

  it.each(['H2X1Y', 'H2X_1Y4', '22X 1Y4', 'H2X 1Y４'])('refuses the postal code %s', (postal_code) => {
    expect(errorOf(addressSchema, { ...valid, postal_code }, 'postal_code')).toBe('Code postal invalide (ex. : H2X 1Y4).')
  })

  it('caps the city at 100 characters', () => {
    expect(errorOf(addressSchema, { ...valid, city: 'a'.repeat(101) }, 'city')).toBe('100 caractères maximum.')
  })
})

describe('contactSchema', () => {
  const valid = { phone: '514 555-1234', email: 'info@cliniquemana.com', website: 'https://cliniquemana.com' }

  it('turns the phone into E.164', () => {
    expect(contactSchema.parse({ ...valid, phone: '(514) 555-1234' }).phone).toBe('+15145551234')
    expect(contactSchema.parse({ ...valid, phone: '1-514-555-1234' }).phone).toBe('+15145551234')
  })

  it('turns empty values into null', () => {
    expect(contactSchema.parse({ phone: ' ', email: '', website: '  ' })).toEqual({ phone: null, email: null, website: null })
  })

  it.each(['555-1234', '514 555-1234 poste 2', '+33 1 23 45 67 89'])('refuses the phone %s', (phone) => {
    expect(errorOf(contactSchema, { ...valid, phone }, 'phone')).toBe('Numéro à 10 chiffres.')
  })

  it('trims the email and refuses an invalid one', () => {
    expect(contactSchema.parse({ ...valid, email: ' info@cliniquemana.com ' }).email).toBe('info@cliniquemana.com')
    expect(errorOf(contactSchema, { ...valid, email: 'pas-un-courriel' }, 'email')).toBe('Courriel invalide.')
    expect(errorOf(contactSchema, { ...valid, email: 'a@b@c.ca' }, 'email')).toBe('Courriel invalide.')
  })

  it.each([
    ['www.cliniquemana.com', 'https://www.cliniquemana.com'],
    ['cliniquemana.com/equipe', 'https://cliniquemana.com/equipe'],
    ['HTTPS://CliniqueMana.com', 'https://CliniqueMana.com'],
    [' https://cliniquemana.com ', 'https://cliniquemana.com'],
  ])('normalises the website %s', (website, expected) => {
    expect(contactSchema.parse({ ...valid, website }).website).toBe(expected)
  })

  it.each(['http://x.ca', 'HTTP://x.ca', 'ftp://x.ca', 'https://x .ca'])('refuses the website %s', (website) => {
    expect(errorOf(contactSchema, { ...valid, website }, 'website')).toBe("L'adresse doit commencer par https://")
  })

  it.each([
    ['a scheme without //', 'mailto:info@cliniquemana.com'],
    ['a scheme with one slash', 'https:/cliniquemana.com'],
    ['a scheme typed with no slash', 'https:cliniquemana.com'],
    ['a host without a dot', 'cliniquemana'],
    ['a host without a dot, after the scheme', 'https://localhost/x'],
    ['a host ending with a dot', 'cliniquemana.'],
    ['an unparsable address', 'https://clinique[mana.com'],
  ])('refuses %s as a web address', (_case, website) => {
    expect(errorOf(contactSchema, { ...valid, website }, 'website')).toBe('Adresse web invalide.')
  })

  it.each(['cliniquemana.com:8443/rendez-vous', 'https://www.cliniquemana.com/?lang=fr#equipe', 'https://192.168.0.10'])(
    'accepts the web address %s',
    (website) => {
      expect(errorOf(contactSchema, { ...valid, website }, 'website')).toBeUndefined()
    },
  )

  it('trims a pasted tab or line break instead of refusing it', () => {
    expect(contactSchema.parse({ ...valid, email: 'info@cliniquemana.com\t', website: '\nhttps://cliniquemana.com\r\n' })).toMatchObject({
      email: 'info@cliniquemana.com',
      website: 'https://cliniquemana.com',
    })
  })

  // JS \s misses these, but the database (ICU) treats them as whitespace: they would only fail later, as a 23514.
  it.each([
    ['chr(31)', '\u001f'],
    ['U+0085', '\u0085'],
    ['DEL', '\u007f'],
  ])('refuses a control character (%s) in the email and the website', (_name, char) => {
    expect(errorOf(contactSchema, { ...valid, email: `info${char}@cliniquemana.com` }, 'email')).toBe('Caractère invalide.')
    expect(errorOf(contactSchema, { ...valid, email: `info@cliniquemana.com${char}` }, 'email')).toBe('Caractère invalide.')
    expect(errorOf(contactSchema, { ...valid, website: `https://clinique${char}mana.com` }, 'website')).toBe('Caractère invalide.')
  })
})

describe('taxNumbersSchema', () => {
  it('strips spaces and dashes and uppercases', () => {
    expect(taxNumbersSchema.parse({ gst_number: ' 123456789 rt 0001 ', qst_number: '1234567890-tq-0001' })).toEqual({
      gst_number: '123456789RT0001',
      qst_number: '1234567890TQ0001',
    })
  })

  it('also strips en and em dashes', () => {
    expect(taxNumbersSchema.parse({ gst_number: '123456789\u2013RT\u20130001', qst_number: '1234567890\u2014TQ\u20140001' })).toEqual({
      gst_number: '123456789RT0001',
      qst_number: '1234567890TQ0001',
    })
  })

  it('turns empty values into null', () => {
    expect(taxNumbersSchema.parse({ gst_number: '', qst_number: ' ' })).toEqual({ gst_number: null, qst_number: null })
  })

  it.each(['123456789', '12345678RT0001', '123456789TQ0001'])('refuses the GST number %s', (gst_number) => {
    expect(errorOf(taxNumbersSchema, { gst_number, qst_number: '' }, 'gst_number')).toBe('Format attendu : 123456789 RT 0001.')
  })

  it.each(['1234567890', '1234567890RT0001', '123456789TQ0001'])('refuses the QST number %s', (qst_number) => {
    expect(errorOf(taxNumbersSchema, { gst_number: '', qst_number }, 'qst_number')).toBe('Format attendu : 1234567890 TQ 0001.')
  })
})

describe('signatorySchema', () => {
  it('trims and turns empty values into null', () => {
    expect(signatorySchema.parse({ signatory_name: ' Marie Tremblay ', signatory_title: '' })).toEqual({
      signatory_name: 'Marie Tremblay',
      signatory_title: null,
    })
  })

  it('caps the lengths at 120 characters', () => {
    expect(errorOf(signatorySchema, { signatory_name: 'a'.repeat(121), signatory_title: '' }, 'signatory_name')).toBe('120 caractères maximum.')
    expect(errorOf(signatorySchema, { signatory_name: '', signatory_title: 'a'.repeat(121) }, 'signatory_title')).toBe('120 caractères maximum.')
  })
})

describe('privacy schemas (the two Confidentialité cards)', () => {
  const officer = { privacy_officer_name: 'Julie Roy', privacy_officer_email: 'vie-privee@cliniquemana.com' }
  const policy = { privacy_policy_url: 'https://cliniquemana.com/confidentialite', record_retention_years: '7' }

  it.each([
    [
      'privacyOfficerSchema',
      privacyOfficerSchema,
      { ...officer, privacy_officer_name: ' Julie Roy ', privacy_officer_email: ' vie-privee@cliniquemana.com ' },
      { privacy_officer_name: 'Julie Roy', privacy_officer_email: 'vie-privee@cliniquemana.com' },
    ],
    [
      'privacyPolicySchema',
      privacyPolicySchema,
      { privacy_policy_url: 'cliniquemana.com/confidentialite', record_retention_years: ' 10 ' },
      { privacy_policy_url: 'https://cliniquemana.com/confidentialite', record_retention_years: 10 },
    ],
  ] as const)('%s normalises its own fields and drops the other card’s', (_name, schema, values, expected) => {
    expect((schema as z.ZodType).parse({ ...officer, ...policy, ...values })).toEqual(expected)
  })

  it.each([
    ['privacyOfficerSchema', privacyOfficerSchema, { privacy_officer_name: '', privacy_officer_email: '' }],
    ['privacyPolicySchema', privacyPolicySchema, { privacy_policy_url: '', record_retention_years: '' }],
  ] as const)('%s turns empty values into null', (_name, schema, values) => {
    const parsed = (schema as z.ZodType).parse(values) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(values).sort())
    for (const value of Object.values(parsed)) expect(value).toBeNull()
  })

  it('refuses an invalid email or policy URL', () => {
    expect(errorOf(privacyOfficerSchema, { ...officer, privacy_officer_email: 'julie' }, 'privacy_officer_email')).toBe('Courriel invalide.')
    expect(errorOf(privacyPolicySchema, { ...policy, privacy_policy_url: 'http://x.ca' }, 'privacy_policy_url')).toBe("L'adresse doit commencer par https://")
    expect(errorOf(privacyPolicySchema, { ...policy, privacy_policy_url: 'mailto:julie@x.ca' }, 'privacy_policy_url')).toBe('Adresse web invalide.')
  })

  it.each([
    ['chr(31)', '\u001f'],
    ['U+0085', '\u0085'],
  ])('refuses a control character (%s) in the email and the policy URL', (_name, char) => {
    expect(errorOf(privacyOfficerSchema, { ...officer, privacy_officer_email: `julie${char}@x.ca` }, 'privacy_officer_email')).toBe('Caractère invalide.')
    expect(errorOf(privacyPolicySchema, { ...policy, privacy_policy_url: `https://x.ca/${char}` }, 'privacy_policy_url')).toBe('Caractère invalide.')
  })

  it('caps the officer name at 120 characters', () => {
    expect(errorOf(privacyOfficerSchema, { ...officer, privacy_officer_name: 'a'.repeat(121) }, 'privacy_officer_name')).toBe('120 caractères maximum.')
  })

  it.each(['1', '50'])('accepts a retention of %s years', (years) => {
    expect(privacyPolicySchema.parse({ ...policy, record_retention_years: years }).record_retention_years).toBe(Number(years))
  })

  it.each(['0', '51', '7.5', '-3', 'sept', '1e1', '７'])('refuses a retention of %s', (years) => {
    expect(errorOf(privacyPolicySchema, { ...policy, record_retention_years: years }, 'record_retention_years')).toBe('Entre 1 et 50 ans.')
  })
})

describe('regionSchema', () => {
  it('requires a timezone', () => {
    expect(regionSchema.parse({ timezone: 'America/Toronto' })).toEqual({ timezone: 'America/Toronto' })
    expect(errorOf(regionSchema, { timezone: '' }, 'timezone')).toBe('Choisissez un fuseau horaire.')
    expect(errorOf(regionSchema, { timezone: ' ' }, 'timezone')).toBe('Choisissez un fuseau horaire.')
  })
})

describe('toFormValues', () => {
  it('gives each card its own fields, as strings', () => {
    expect(toClinicFormValues(ORG)).toEqual({ name: 'Clinique MANA', legal_name: '9999-9999 Québec inc.', neq: '1234567890' })
    expect(toAddressFormValues(ORG)).toEqual({
      address_line1: '123, rue Saint-Denis',
      address_line2: 'Bureau 200',
      city: 'Montréal',
      province: 'QC',
      postal_code: 'H2X 1Y4',
    })
    expect(toContactFormValues(ORG)).toEqual({ phone: '514 555-1234', email: 'info@cliniquemana.com', website: 'https://cliniquemana.com' })
    expect(toTaxNumbersFormValues(ORG)).toEqual({ gst_number: '123456789 RT 0001', qst_number: '1234567890 TQ 0001' })
    expect(toSignatoryFormValues(ORG)).toEqual({ signatory_name: 'Marie Tremblay', signatory_title: 'Directrice' })
    expect(toPrivacyOfficerFormValues(ORG)).toEqual({ privacy_officer_name: 'Julie Roy', privacy_officer_email: 'vie-privee@cliniquemana.com' })
    expect(toPrivacyPolicyFormValues(ORG)).toEqual({ privacy_policy_url: 'https://cliniquemana.com/confidentialite', record_retention_years: '7' })
    expect(toRegionFormValues(ORG)).toEqual({ timezone: 'America/Toronto' })
  })

  it('turns null into an empty string', () => {
    expect(toClinicFormValues(EMPTY_ORG)).toEqual({ name: 'Clinique MANA', legal_name: '', neq: '' })
    expect(toAddressFormValues(EMPTY_ORG)).toEqual({ address_line1: '', address_line2: '', city: '', province: '', postal_code: '' })
    expect(toContactFormValues(EMPTY_ORG)).toEqual({ phone: '', email: '', website: '' })
    expect(toTaxNumbersFormValues(EMPTY_ORG)).toEqual({ gst_number: '', qst_number: '' })
    expect(toSignatoryFormValues(EMPTY_ORG)).toEqual({ signatory_name: '', signatory_title: '' })
    expect(toPrivacyOfficerFormValues(EMPTY_ORG)).toEqual({ privacy_officer_name: '', privacy_officer_email: '' })
    expect(toPrivacyPolicyFormValues(EMPTY_ORG)).toEqual({ privacy_policy_url: '', record_retention_years: '' })
  })

  it.each([
    ['clinic', clinicSchema, toClinicFormValues],
    ['address', addressSchema, toAddressFormValues],
    ['contact', contactSchema, toContactFormValues],
    ['tax numbers', taxNumbersSchema, toTaxNumbersFormValues],
    ['signatory', signatorySchema, toSignatoryFormValues],
    ['privacy officer', privacyOfficerSchema, toPrivacyOfficerFormValues],
    ['privacy policy', privacyPolicySchema, toPrivacyPolicyFormValues],
    ['region', regionSchema, toRegionFormValues],
  ] as const)('round-trips the stored values through the %s schema', (_card, schema, toFormValues) => {
    for (const org of [ORG, EMPTY_ORG]) {
      const values = toFormValues(org)
      const parsed = (schema as z.ZodType).parse(values) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed)) expect(value).toBe(org[key as keyof Organization])
    }
  })
})
