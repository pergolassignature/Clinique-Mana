import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { asPublicLanguage, formatDateOnlyIn, formatMoneyIn, usePageLanguage } from './public-language'
import { retryInText } from './retry-after'

describe('public-language (EN-1)', () => {
  it('anything but en is French', () => {
    expect([asPublicLanguage('en'), asPublicLanguage('fr'), asPublicLanguage(null), asPublicLanguage('EN')]).toEqual(['en', 'fr', 'fr', 'fr'])
  })

  it('amounts and calendar dates in each language (a date never shifts a day)', () => {
    expect(formatMoneyIn('en', 20000)).toBe('$200.00')
    expect(formatMoneyIn('fr', 20000).replace(/\s/g, ' ')).toBe('200,00 $')
    expect(formatDateOnlyIn('en', '2026-01-01')).toBe('January 1, 2026')
    expect(formatDateOnlyIn('fr', '2026-01-01')).toBe('1 janvier 2026')
    expect(formatDateOnlyIn('en', 'nope')).toBe('')
  })

  it('<html lang> while the page shows, back after', () => {
    document.documentElement.lang = 'fr-CA'
    const { unmount } = renderHook(() => usePageLanguage('en'))
    expect(document.documentElement.lang).toBe('en-CA')
    unmount()
    expect(document.documentElement.lang).toBe('fr-CA')
  })

  it('« Please try again in about 5 minutes. » on an English page', () => {
    expect(retryInText(300, 'en')).toBe('Please try again in about 5 minutes.')
    expect(retryInText(300)).toBe('Réessayez dans environ 5 minutes.')
  })
})
