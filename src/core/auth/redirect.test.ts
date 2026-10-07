import { describe, expect, it } from 'vitest'
import { safeRedirect } from './redirect'

describe('safeRedirect', () => {
  it('keeps internal paths', () => {
    expect(safeRedirect('/professionnels?x=1')).toBe('/professionnels?x=1')
  })

  it.each([null, '', 'https://evil.test', '//evil.test', 'javascript:alert(1)'])('falls back to /accueil for %s', (value) => {
    expect(safeRedirect(value)).toBe('/accueil')
  })
})
