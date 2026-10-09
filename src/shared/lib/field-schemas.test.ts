import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  optionalEmail,
  optionalPattern,
  optionalPhone,
  optionalPostalCode,
  optionalProvince,
  optionalText,
  PROVINCES,
  requiredText,
  withoutControlChars,
} from './field-schemas'

/** The French message of the first issue, or undefined when the value parses. */
function errorOf(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value)
  return result.success ? undefined : result.error.issues[0]?.message
}

describe('requiredText', () => {
  const schema = requiredText(200, 'Le nom est requis.')

  it('trims', () => {
    expect(schema.parse('  Clinique MANA ')).toBe('Clinique MANA')
  })

  it('refuses an empty or blank value with the given message', () => {
    expect(errorOf(schema, '')).toBe('Le nom est requis.')
    expect(errorOf(schema, '   ')).toBe('Le nom est requis.')
  })

  it('caps the length', () => {
    expect(errorOf(schema, 'a'.repeat(200))).toBeUndefined()
    expect(errorOf(schema, 'a'.repeat(201))).toBe('200 caractères maximum.')
  })
})

describe('optionalText', () => {
  it('trims and turns an empty or blank value into null', () => {
    expect(optionalText(200).parse(' 9999-9999 Québec inc. ')).toBe('9999-9999 Québec inc.')
    expect(optionalText(200).parse('')).toBeNull()
    expect(optionalText(200).parse(' \t\n')).toBeNull()
  })

  it('caps the length', () => {
    expect(errorOf(optionalText(100), 'a'.repeat(100))).toBeUndefined()
    expect(errorOf(optionalText(100), 'a'.repeat(101))).toBe('100 caractères maximum.')
  })
})

describe('optionalPattern', () => {
  const schema = optionalPattern(/^[0-9]{10}$/, 'Le NEQ compte 10 chiffres.', (v) => v.replace(/[\s-]/g, ''))

  it('normalises, then checks the pattern', () => {
    expect(schema.parse(' 1234 567-890 ')).toBe('1234567890')
    expect(errorOf(schema, '123')).toBe('Le NEQ compte 10 chiffres.')
  })

  it('turns an empty value into null', () => {
    expect(schema.parse(' ')).toBeNull()
  })
})

describe('optionalEmail', () => {
  it('trims and turns an empty value into null', () => {
    expect(optionalEmail().parse(' info@cliniquemana.com ')).toBe('info@cliniquemana.com')
    expect(optionalEmail().parse('')).toBeNull()
  })

  it.each(['pas-un-courriel', 'a@b@c.ca'])('refuses %s', (email) => {
    expect(errorOf(optionalEmail(), email)).toBe('Courriel invalide.')
  })

  it('trims a pasted tab or line break instead of refusing it', () => {
    expect(optionalEmail().parse('info@cliniquemana.com\t')).toBe('info@cliniquemana.com')
    expect(optionalEmail().parse('\ninfo@cliniquemana.com\r\n')).toBe('info@cliniquemana.com')
  })

  // JS \s misses these, but the database (ICU) treats them as whitespace: they would only fail later, as a 23514.
  it.each([
    ['chr(31)', '\u001f'],
    ['U+0085', '\u0085'],
    ['DEL', '\u007f'],
  ])('refuses a control character (%s), inside or at the end', (_name, char) => {
    expect(errorOf(optionalEmail(), `info${char}@cliniquemana.com`)).toBe('Caractère invalide.')
    expect(errorOf(optionalEmail(), `info@cliniquemana.com${char}`)).toBe('Caractère invalide.')
  })
})

describe('withoutControlChars', () => {
  it('runs the wrapped schema on the trimmed value', () => {
    expect(withoutControlChars(z.string().min(3)).parse(' abc ')).toBe('abc')
  })

  it('refuses a control character with its own message only (abort)', () => {
    const result = withoutControlChars(z.string().min(10, { error: 'trop court' })).safeParse('a\u0085b')
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['Caractère invalide.'])
  })
})

describe('optionalPhone', () => {
  it.each([
    ['514 555-1234', '+15145551234'],
    ['(514) 555-1234', '+15145551234'],
    ['1-514-555-1234', '+15145551234'],
  ])('turns %s into E.164', (phone, expected) => {
    expect(optionalPhone().parse(phone)).toBe(expected)
  })

  it('turns an empty or blank value into null', () => {
    expect(optionalPhone().parse('')).toBeNull()
    expect(optionalPhone().parse(' ')).toBeNull()
  })

  it.each(['555-1234', '514 555-1234 poste 2', '+33 1 23 45 67 89'])('refuses %s', (phone) => {
    expect(errorOf(optionalPhone(), phone)).toBe('Numéro à 10 chiffres.')
  })
})

describe('optionalPostalCode', () => {
  it.each([' h2x1y4 ', 'h2x 1y4', 'H2X-1Y4', 'h2x–1y4', 'H2X — 1Y4'])('normalises %s to H2X 1Y4', (postalCode) => {
    expect(optionalPostalCode().parse(postalCode)).toBe('H2X 1Y4')
  })

  it('turns an empty value into null', () => {
    expect(optionalPostalCode().parse('')).toBeNull()
  })

  it.each(['H2X1Y', 'H2X_1Y4', '22X 1Y4', 'H2X 1Y４'])('refuses %s', (postalCode) => {
    expect(errorOf(optionalPostalCode(), postalCode)).toBe('Code postal invalide (ex. : H2X 1Y4).')
  })
})

describe('optionalProvince', () => {
  it('accepts the 13 province and territory codes', () => {
    expect(PROVINCES).toHaveLength(13)
    for (const province of PROVINCES) expect(optionalProvince().parse(province)).toBe(province)
  })

  it('turns « no province » into null', () => {
    expect(optionalProvince().parse('')).toBeNull()
  })

  it('refuses an unknown province', () => {
    expect(errorOf(optionalProvince(), 'XX')).toBe('Province invalide.')
  })
})
