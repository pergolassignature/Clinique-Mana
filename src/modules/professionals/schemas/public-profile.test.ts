import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { publicProfileSchema, toPublicProfileFormValues } from './public-profile'
import { recordFixture } from '../test/fixtures-domain'
import { errorAt } from '../test/schema-helpers'

const empty = toPublicProfileFormValues(recordFixture().publicProfile)

describe('publicProfileSchema', () => {
  it('reads an empty profile as empty fields, and stores them as null', () => {
    expect(empty).toEqual({ bio: '', approach: '', publicEmail: '', publicPhone: '' })
    expect(publicProfileSchema.parse(empty)).toEqual({ bio: null, approach: null, publicEmail: null, publicPhone: null })
  })

  it('keeps line breaks in the texts, lower-cases the email, formats the phone', () => {
    expect(publicProfileSchema.parse({ bio: ' Ligne 1\nLigne 2 ', approach: 'TCC', publicEmail: ' Marie@Exemple.CA', publicPhone: '(514) 555-1234' })).toEqual({
      bio: 'Ligne 1\nLigne 2',
      approach: 'TCC',
      publicEmail: 'marie@exemple.ca',
      publicPhone: '+15145551234',
    })
  })

  it('caps the texts at 4000 characters', () => {
    expect(errorAt(publicProfileSchema, { ...empty, bio: 'x'.repeat(4001) }, 'bio')).toBe(t('modules.professionals.validation.maxChars', { max: '4000' }))
    expect(publicProfileSchema.safeParse({ ...empty, approach: 'x'.repeat(4000) }).success).toBe(true)
  })

  it('refuses an invalid email', () => {
    expect(errorAt(publicProfileSchema, { ...empty, publicEmail: 'x@y' }, 'publicEmail')).toBe(t('auth.errors.invalidEmail'))
  })

  it('caps the email at 254 characters, as the column check does', () => {
    const at254 = `${'a'.repeat(249)}@x.ca`
    expect(publicProfileSchema.parse({ ...empty, publicEmail: at254 }).publicEmail).toBe(at254)
    expect(errorAt(publicProfileSchema, { ...empty, publicEmail: `a${at254}` }, 'publicEmail')).toBe(t('auth.errors.invalidEmail'))
  })
})
