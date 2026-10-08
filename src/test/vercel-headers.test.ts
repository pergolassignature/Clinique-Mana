import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * vercel.json's header rule for the two public token pages (`/invitation`, `/connexion/confirmer`):
 * `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, with or without a trailing slash
 * (the SPA serves both). Vercel matches a `source` in strict mode (path-to-regexp, no implicit
 * trailing slash), so the optional slash is in the pattern; it is read here as the anchored regex
 * Vercel builds from it. The deployed answer is checked with curl at Mise en service.
 */
const config = JSON.parse(readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

const rule = config.headers.find((h) => h.headers.some((x) => x.key === 'X-Robots-Tag'))
const matches = (pathname: string) => new RegExp(`^${rule?.source ?? '$^'}$`).test(pathname)

describe('vercel.json: the public token pages', () => {
  it('send no referrer and ask not to be indexed', () => {
    expect(rule?.headers).toEqual([
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex' },
    ])
  })

  it.each(['/invitation', '/invitation/', '/connexion/confirmer', '/connexion/confirmer/'])('covers %s', (pathname) => {
    expect(matches(pathname)).toBe(true)
  })

  it.each(['/invitations', '/invitation/x', '/connexion', '/connexion/confirmerx', '/accueil', '/'])('leaves %s alone', (pathname) => {
    expect(matches(pathname)).toBe(false)
  })

  it('comes after the general rule, so its Referrer-Policy wins', () => {
    const general = config.headers.findIndex((h) => h.source === '/(.*)')
    expect(general).toBeGreaterThanOrEqual(0)
    expect(config.headers.indexOf(rule!)).toBeGreaterThan(general)
  })
})
