import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { longText, tidy, tidyText } from './text'

const issue = (result: { success: boolean; error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message

describe('tidy', () => {
  it('strips Unicode spaces at the ends and folds inner runs, like reference_text', () => {
    expect(tidy('\u00A0 Proche\t\taidance\u0085')).toBe('Proche aidance')
    expect(tidy(' ^[0-9]  [A-Z]$ ', false)).toBe('^[0-9]  [A-Z]$')
  })
})

describe('tidyText', () => {
  const required = tidyText({ max: 5, requiredMessage: 'Requis.' })
  const optional = tidyText({ max: 5 })

  it('returns the stored value', () => {
    expect(required.parse('  ab  c ')).toBe('ab c')
    expect(optional.parse('   ')).toBeNull()
  })

  it('refuses empty when required, too long, invisible characters', () => {
    expect(issue(required.safeParse(' '))).toBe('Requis.')
    expect(issue(required.safeParse('abcdef'))).toBe(t('modules.professionals.validation.maxChars', { max: '5' }))
    expect(issue(required.safeParse('a\u200Bb'))).toBe(t('modules.professionals.validation.invisibleChars'))
    expect(issue(required.safeParse('a\u0007b'))).toBe(t('modules.professionals.validation.invisibleChars'))
  })

  it('counts characters as the database does (code points)', () => {
    expect(required.parse('😀😀😀😀😀')).toBe('😀😀😀😀😀')
  })

  it('uses the given too-long message', () => {
    expect(issue(tidyText({ max: 1, tooLongMessage: 'Trop long.' }).safeParse('ab'))).toBe('Trop long.')
  })
})

describe('longText', () => {
  it('keeps line breaks, trims, empty → null', () => {
    expect(longText(10).parse(' a\nb ')).toBe('a\nb')
    expect(longText(10).parse('  ')).toBeNull()
    expect(issue(longText(3).safeParse('abcd'))).toBe(t('modules.professionals.validation.maxChars', { max: '3' }))
  })
})
