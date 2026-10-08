import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import {
  experienceSchema,
  identitySchema,
  payerNumbersSchema,
  toExperienceFormValues,
  toIdentityFormValues,
  toPayerNumbersFormValues,
} from './identity'
import { recordFixture } from '../test/fixtures-domain'
import { errorAt } from '../test/schema-helpers'

const record = recordFixture()

describe('identitySchema', () => {
  it('round-trips the record; empty gender → null', () => {
    const values = toIdentityFormValues(record.professional)
    expect(values).toEqual({ firstName: 'Marie', lastName: 'Tremblay', gender: '' })
    expect(identitySchema.parse(values)).toEqual({ firstName: 'Marie', lastName: 'Tremblay', gender: null })
  })

  it('keeps a gender of the list, refuses others', () => {
    expect(identitySchema.parse({ firstName: 'M', lastName: 'T', gender: 'female' }).gender).toBe('female')
    expect(identitySchema.safeParse({ firstName: 'M', lastName: 'T', gender: 'other' }).success).toBe(false)
  })

  it('requires both names', () => {
    expect(errorAt(identitySchema, { firstName: '', lastName: 'T', gender: '' }, 'firstName')).toBe('Prénom requis.')
    expect(errorAt(identitySchema, { firstName: 'M', lastName: '  ', gender: '' }, 'lastName')).toBe('Nom requis.')
  })
})

describe('experienceSchema', () => {
  it('reads whole years from 0 to 60, empty → null', () => {
    expect(toExperienceFormValues(record.professional)).toEqual({ yearsExperience: '12' })
    expect(experienceSchema.parse({ yearsExperience: ' 0 ' })).toEqual({ yearsExperience: 0 })
    expect(experienceSchema.parse({ yearsExperience: '60' })).toEqual({ yearsExperience: 60 })
    expect(experienceSchema.parse({ yearsExperience: '' })).toEqual({ yearsExperience: null })
  })

  it.each(['61', '-1', '2.5', 'dix'])('refuses %s', (value) => {
    expect(errorAt(experienceSchema, { yearsExperience: value }, 'yearsExperience')).toBe('Entre 0 et 60 ans.')
  })
})

describe('payerNumbersSchema', () => {
  it('reads the IVAC number; empty deletes it', () => {
    expect(toPayerNumbersFormValues(record.payerNumbers)).toEqual({ ivac: '123456' })
    expect(toPayerNumbersFormValues([])).toEqual({ ivac: '' })
    expect(payerNumbersSchema.parse({ ivac: ' AB-12 ' })).toEqual({ ivac: 'AB-12' })
    expect(payerNumbersSchema.parse({ ivac: '' })).toEqual({ ivac: null })
  })

  it.each(['12', '12 34', 'é123', 'x'.repeat(31)])('refuses %s', (value) => {
    expect(errorAt(payerNumbersSchema, { ivac: value }, 'ivac')).toBe(t('modules.professionals.validation.ivac'))
  })
})
