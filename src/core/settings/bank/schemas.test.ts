import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import type { BankDetails } from './api'
import { bankDetailsSchema, toBankFormValues, type BankFormValues } from './schemas'

const VALID: BankFormValues = { institution: '815', transit: '30000', account: '1234567', etransferEmail: 'paiement@cliniquemana.test' }

/** The messages of a failed parse, by field. */
function errorsOf(values: Partial<BankFormValues>, hasStoredAccount = true) {
  const result = bankDetailsSchema(hasStoredAccount).safeParse({ ...VALID, ...values })
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

const parse = (values: Partial<BankFormValues>, hasStoredAccount = true) => bankDetailsSchema(hasStoredAccount).parse({ ...VALID, ...values })

// The messages are the French P0001 messages of set_bank_details (20261007205802_core_bank_details.sql).
describe('bankDetailsSchema', () => {
  it('uses the database messages', () => {
    expect(t('settings.bank.validation.institution')).toBe("Le numéro d'institution compte 3 chiffres.")
    expect(t('settings.bank.validation.transit')).toBe('Le numéro de transit compte 5 chiffres.')
    expect(t('settings.bank.validation.account')).toBe('Le numéro de compte compte de 7 à 12 chiffres.')
    expect(t('settings.bank.validation.accountRequired')).toBe('Le numéro de compte est requis.')
    expect(t('settings.bank.validation.email')).toBe('Courriel Interac invalide.')
  })

  it('passes valid values through, as the API input', () => {
    expect(parse({})).toEqual({ institution: '815', transit: '30000', account: '1234567', etransferEmail: 'paiement@cliniquemana.test' })
  })

  it('trims the institution and transit numbers, and wants exactly 3 and 5 ASCII digits', () => {
    expect(parse({ institution: ' 815 ', transit: '\t30000\n' })).toMatchObject({ institution: '815', transit: '30000' })
    for (const institution of ['', '81', '8150', '81a', '８１５', '8 15']) {
      expect(errorsOf({ institution })).toEqual({ institution: t('settings.bank.validation.institution') })
    }
    for (const transit of ['', '3000', '300000', '3000a', '３００００', '300-00']) {
      expect(errorsOf({ transit })).toEqual({ transit: t('settings.bank.validation.transit') })
    }
  })

  it('strips spaces, tabs, line breaks and hyphens from the account number', () => {
    expect(parse({ account: ' 765-4321 ' }).account).toBe('7654321')
    expect(parse({ account: '12 34\t56\r\n7' }).account).toBe('1234567')
    expect(parse({ account: '123456789012' }).account).toBe('123456789012')
  })

  it('refuses any other character in the account number rather than removing it', () => {
    for (const account of ['abc', '123456a', '1234.567', '1234_567', '1234567–', '１２３４５６７', '1234567 ', '123456', '1234567890123']) {
      expect(errorsOf({ account })).toEqual({ account: t('settings.bank.validation.account') })
    }
  })

  it('keeps the stored account when the field is left empty (null), but requires one when none is stored', () => {
    expect(parse({ account: '' }).account).toBeNull()
    expect(parse({ account: ' - ' }).account).toBeNull()
    expect(errorsOf({ account: '' }, false)).toEqual({ account: t('settings.bank.validation.accountRequired') })
    expect(errorsOf({ account: '  ' }, false)).toEqual({ account: t('settings.bank.validation.accountRequired') })
    expect(parse({ account: '1234567' }, false).account).toBe('1234567')
  })

  it('trims and lowercases the Interac email, and sends none as null', () => {
    expect(parse({ etransferEmail: '  Paiement@CliniqueMana.TEST ' }).etransferEmail).toBe('paiement@cliniquemana.test')
    expect(parse({ etransferEmail: '' }).etransferEmail).toBeNull()
    expect(parse({ etransferEmail: '   ' }).etransferEmail).toBeNull()
  })

  it('refuses an invalid Interac email', () => {
    for (const etransferEmail of ['paiement', 'paiement@clinique', 'a b@c.ca', 'a@@c.ca']) {
      expect(errorsOf({ etransferEmail })).toEqual({ etransferEmail: t('settings.bank.validation.email') })
    }
    // A control character the database treats as whitespace (JS \s does not).
    expect(errorsOf({ etransferEmail: 'a\u001fb@c.ca' })).toEqual({ etransferEmail: t('settings.validation.controlChar') })
  })
})

describe('toBankFormValues', () => {
  const DETAILS: BankDetails = {
    institution_number: '815',
    transit_number: '30000',
    account_last4: '4567',
    etransfer_email: 'paiement@cliniquemana.test',
    updated_at: '2026-10-07T18:30:00Z',
    updated_by_name: 'Marie Tremblay',
  }

  it('fills the stored values, never the account (left empty: « Inchangé »)', () => {
    expect(toBankFormValues(DETAILS)).toEqual({ institution: '815', transit: '30000', account: '', etransferEmail: 'paiement@cliniquemana.test' })
  })

  it('starts empty when nothing is stored, or with no email', () => {
    expect(toBankFormValues(null)).toEqual({ institution: '', transit: '', account: '', etransferEmail: '' })
    expect(toBankFormValues({ ...DETAILS, etransfer_email: null }).etransferEmail).toBe('')
  })
})
