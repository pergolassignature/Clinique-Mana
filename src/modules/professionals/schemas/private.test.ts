import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { bankSchema, isValidSin, sinSchema, taxNumbersSchema, toBankFormValues, toTaxNumbersFormValues } from './private'
import { EMPTY_PRIVATE, privateFixture } from '../test/fixtures-compensation'
import { issuesOf } from '../test/schema-helpers'

describe('isValidSin (the Luhn check of private.is_valid_sin)', () => {
  it('accepts a valid SIN, including one starting with 0', () => {
    expect(isValidSin('046454286')).toBe(true)
    expect(isValidSin('130692544')).toBe(true)
  })

  it('refuses a wrong check digit or length', () => {
    expect(isValidSin('123456789')).toBe(false)
    expect(isValidSin('04645428')).toBe(false)
    expect(isValidSin('0464542860')).toBe(false)
  })
})

describe('sinSchema', () => {
  it('strips spaces, tabs and hyphens only', () => {
    expect(sinSchema.parse({ sin: ' 046 454-286 ' })).toEqual({ sin: '046454286' })
  })

  it('requires the whole SIN and refuses anything else, never quoting it', () => {
    expect(issuesOf(sinSchema, { sin: '' })).toEqual({ sin: t('modules.professionals.validation.sinRequired') })
    expect(issuesOf(sinSchema, { sin: '123 456 789' })).toEqual({ sin: t('modules.professionals.validation.sinInvalid') })
    expect(issuesOf(sinSchema, { sin: '046.454.286' })).toEqual({ sin: t('modules.professionals.validation.sinInvalid') })
  })
})

describe('taxNumbersSchema', () => {
  it('compacts the numbers and clears an empty one', () => {
    expect(taxNumbersSchema.parse({ businessNumber: '123 456 789', gstNumber: '123456789 rt 0001', qstNumber: '' })).toEqual({
      businessNumber: '123456789',
      gstNumber: '123456789RT0001',
      qstNumber: null,
    })
  })

  it('names the expected format of each number', () => {
    expect(issuesOf(taxNumbersSchema, { businessNumber: '12345678', gstNumber: '123456789TQ0001', qstNumber: '123456789RT0001' })).toEqual({
      businessNumber: t('modules.professionals.validation.businessNumber'),
      gstNumber: t('modules.professionals.validation.gstNumber'),
      qstNumber: t('modules.professionals.validation.qstNumber'),
    })
  })

  it('shows the stored numbers grouped', () => {
    expect(toTaxNumbersFormValues(privateFixture())).toEqual({ businessNumber: '123456789', gstNumber: '123456789 RT 0001', qstNumber: '1234567890 TQ 0001' })
    expect(toTaxNumbersFormValues(EMPTY_PRIVATE)).toEqual({ businessNumber: '', gstNumber: '', qstNumber: '' })
  })
})

describe('bankSchema', () => {
  it('keeps the stored account when the field is empty, clears empty numbers', () => {
    expect(bankSchema.parse({ institution: '', transit: ' 30000 ', account: '' })).toEqual({ institution: null, transit: '30000', account: null })
  })

  it('strips only spaces, tabs, line breaks and hyphens from the account', () => {
    expect(bankSchema.parse({ institution: '815', transit: '30000', account: '765-4321' })).toEqual({ institution: '815', transit: '30000', account: '7654321' })
    expect(issuesOf(bankSchema, { institution: '815', transit: '30000', account: '12a4567' })).toEqual({ account: t('settings.bank.validation.account') })
  })

  it('checks the institution and transit lengths', () => {
    expect(issuesOf(bankSchema, { institution: '81', transit: '3000', account: '' })).toEqual({
      institution: t('settings.bank.validation.institution'),
      transit: t('settings.bank.validation.transit'),
    })
  })

  it('never prefills the account', () => {
    expect(toBankFormValues(privateFixture())).toEqual({ institution: '815', transit: '30000', account: '' })
  })
})
