import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { t } from '@/i18n'
import { newPasswordRule, newPasswordSchema, passwordsMatch } from './password-schema'

const messages = (result: z.ZodSafeParseResult<unknown>) => (result.success ? [] : result.error.issues.map((i) => i.message))

describe('newPasswordRule', () => {
  it('accepts 10 characters', () => {
    expect(newPasswordRule.safeParse('a'.repeat(10)).success).toBe(true)
  })

  it('refuses fewer than 10 characters (minimum_password_length)', () => {
    expect(messages(newPasswordRule.safeParse('a'.repeat(9)))).toEqual([t('auth.reset.tooShort')])
  })

  // bcrypt (GoTrue) reads only the first 72 bytes; an accented letter takes two.
  it('accepts 72 bytes and refuses 73', () => {
    expect(newPasswordRule.safeParse('a'.repeat(72)).success).toBe(true)
    expect(messages(newPasswordRule.safeParse('a'.repeat(73)))).toEqual([t('auth.reset.tooLong')])
    expect(messages(newPasswordRule.safeParse('é'.repeat(37)))).toEqual([t('auth.reset.tooLong')])
  })
})

describe('newPasswordSchema', () => {
  it('accepts a matching confirmation', () => {
    expect(newPasswordSchema.safeParse({ password: 'un-long-mot-de-passe', confirm: 'un-long-mot-de-passe' }).success).toBe(true)
  })

  it('reports a mismatch on the confirmation field', () => {
    const result = newPasswordSchema.safeParse({ password: 'un-long-mot-de-passe', confirm: 'autre-chose-encore' })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['confirm'], message: t('auth.reset.mismatch') })])
  })
})

describe('passwordsMatch', () => {
  it('compares the password and its confirmation', () => {
    expect(passwordsMatch({ password: 'a', confirm: 'a' })).toBe(true)
    expect(passwordsMatch({ password: 'a', confirm: 'b' })).toBe(false)
  })
})
