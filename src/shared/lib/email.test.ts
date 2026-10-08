import { describe, expect, it } from 'vitest'
import { EMAIL_PATTERN, emailSchema } from './email'

describe('EMAIL_PATTERN', () => {
  it.each(['info@cliniquemana.com', 'a.b+c@x.qc.ca', 'É@x.ca'])('accepts %s', (email) => {
    expect(EMAIL_PATTERN.test(email)).toBe(true)
  })

  it.each(['', 'pas-un-courriel', 'a@b', 'a@b@c.ca', 'a b@c.ca', '@x.ca', 'a@.'])('refuses « %s »', (email) => {
    expect(EMAIL_PATTERN.test(email)).toBe(false)
  })
})

describe('emailSchema', () => {
  const schema = emailSchema('Courriel invalide.')

  it('trims, then accepts a valid email', () => {
    expect(schema.parse('  info@cliniquemana.com ')).toBe('info@cliniquemana.com')
  })

  it('refuses an invalid or empty one with the given message', () => {
    for (const value of ['pas-un-courriel', '', '   ']) {
      const result = schema.safeParse(value)
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('Courriel invalide.')
    }
  })
})
