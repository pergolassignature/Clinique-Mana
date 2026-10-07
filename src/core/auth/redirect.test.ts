import { describe, expect, it } from 'vitest'
import { safeRedirect } from './redirect'

describe('safeRedirect', () => {
  it('keeps internal paths', () => {
    expect(safeRedirect('/professionnels?x=1')).toBe('/professionnels?x=1')
  })

  it('keeps the query string and hash', () => {
    expect(safeRedirect('/professionnels?x=1#y')).toBe('/professionnels?x=1#y')
  })

  it.each([null, '', 'https://evil.test', '//evil.test', 'javascript:alert(1)'])('falls back to /accueil for %s', (value) => {
    expect(safeRedirect(value)).toBe('/accueil')
  })

  // The URL parser treats "\" as "/" and strips tab/CR/LF: each of these would resolve to https://evil.test/.
  it.each(['/\\evil.test', '/\\/evil.test', '/\t/evil.test', '/\n/evil.test', '/\r/evil.test'])(
    'falls back to /accueil for the parser bypass %j',
    (value) => {
      expect(safeRedirect(value)).toBe('/accueil')
    },
  )
})
