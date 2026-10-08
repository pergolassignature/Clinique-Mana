import { describe, expect, it } from 'vitest'
import { confirmNext, parseConfirmType } from './confirm'

describe('parseConfirmType', () => {
  it.each(['recovery', 'email', 'email_change'] as const)('accepts %s', (type) => {
    expect(parseConfirmType(type)).toBe(type)
  })

  it.each(['signup', 'invite', 'magiclink', '', 'RECOVERY', null])('refuses %j', (value) => {
    expect(parseConfirmType(value)).toBeNull()
  })
})

describe('confirmNext', () => {
  const origin = 'http://localhost:5173'

  it('reduces a same-origin absolute URL ({{ .RedirectTo }}) to its path', () => {
    expect(confirmNext('http://localhost:5173/accueil?x=1', origin)).toBe('/accueil?x=1')
  })

  it('keeps a path', () => {
    expect(confirmNext('/parametres/identite', origin)).toBe('/parametres/identite')
  })

  it.each(['https://evil.test/accueil', '//evil.test', 'javascript:alert(1)', 'http://localhost:5174/parametres', null, ''])(
    'falls back to /accueil for %j',
    (value) => {
      expect(confirmNext(value, origin)).toBe('/accueil')
    },
  )

  it('reads a ? and & inside next once the magic-link template URL-encodes it', () => {
    // The template writes `&next={{ .RedirectTo | urlquery }}` last (Task 3.15): Go's QueryEscape.
    const queryEscape = (value: string) =>
      encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+')
    const redirectTo = 'http://localhost:5173/parametres/identite?onglet=adresse&mode=edition#haut'
    const search = `?token_hash=abc&type=email&next=${queryEscape(redirectTo)}`
    const params = new URLSearchParams(search)
    expect(params.get('type')).toBe('email')
    expect(confirmNext(params.get('next'), origin)).toBe('/parametres/identite?onglet=adresse&mode=edition#haut')
  })

  it('still applies safeRedirect to the path of a same-origin URL', () => {
    expect(confirmNext('http://localhost:5173/\\evil.test', origin)).toBe('/accueil')
  })
})
