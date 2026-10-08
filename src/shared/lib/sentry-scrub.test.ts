import { describe, expect, it } from 'vitest'
import { redactDigitRuns, scrubSentryEvent, scrubUrl } from './sentry-scrub'

type Event = Parameters<typeof scrubSentryEvent>[0]

describe('redactDigitRuns', () => {
  it('redacts runs of 7 digits or more, and keeps shorter ones', () => {
    expect(redactDigitRuns('compte 1234567 et 123456789012')).toBe('compte [redacted] et [redacted]')
    expect(redactDigitRuns('transit 30000, institution 815, code 23514, 123456')).toBe('transit 30000, institution 815, code 23514, 123456')
  })
})

describe('scrubSentryEvent', () => {
  it('drops details and hint from a serialized object, keeping the rest', () => {
    const event = {
      type: undefined,
      extra: { __serialized__: { code: '23502', message: 'null value', details: 'Failing row contains (815, null, 1234567).', hint: 'h' } },
    } as Event
    expect(scrubSentryEvent(event)?.extra?.__serialized__).toEqual({ code: '23502', message: 'null value' })
  })

  it('redacts long digit runs in exception values and breadcrumb messages', () => {
    const event = {
      type: undefined,
      exception: { values: [{ type: 'RpcError 23505', value: 'duplicate 1234567' }, { type: 'Error' }] },
      breadcrumbs: [{ message: 'fetch 7654321' }, { category: 'ui.click' }],
    } as Event
    const scrubbed = scrubSentryEvent(event)!
    expect(scrubbed.exception?.values).toEqual([{ type: 'RpcError 23505', value: 'duplicate [redacted]' }, { type: 'Error' }])
    expect(scrubbed.breadcrumbs).toEqual([{ message: 'fetch [redacted]' }, { category: 'ui.click' }])
  })

  it('redacts long digit runs in the event message', () => {
    const event = { type: undefined, message: 'compte 1234567' } as Event
    expect(scrubSentryEvent(event)?.message).toBe('compte [redacted]')
  })

  it('drops the logged arguments of console breadcrumbs only', () => {
    const event = {
      type: undefined,
      breadcrumbs: [
        { category: 'console', message: 'log', data: { arguments: [{ account: '1234567' }], logger: 'console' } },
        { category: 'fetch', data: { arguments: ['kept'], url: '/rest/v1/rpc/x' } },
      ],
    } as Event
    expect(scrubSentryEvent(event)?.breadcrumbs).toEqual([
      { category: 'console', message: 'log', data: { logger: 'console' } },
      { category: 'fetch', data: { arguments: ['kept'], url: '/rest/v1/rpc/x' } },
    ])
  })

  it('ignores values that are not strings', () => {
    const event = {
      type: undefined,
      message: 42,
      exception: { values: [{ value: { n: 1234567 } }] },
      breadcrumbs: [{ message: null }],
    } as unknown as Event
    expect(() => scrubSentryEvent(event)).not.toThrow()
    expect(scrubSentryEvent(event)).toBe(event)
  })

  it('drops the event (null) rather than send it unscrubbed when scrubbing fails', () => {
    const event = { type: undefined, message: 'compte 1234567' } as Event
    Object.defineProperty(event, 'breadcrumbs', {
      get() {
        throw new Error('boom')
      },
    })
    expect(scrubSentryEvent(event)).toBeNull()
  })

  it('leaves an event without those parts as is', () => {
    const event = { type: undefined, message: 'hello' } as Event
    expect(scrubSentryEvent(event)).toEqual({ type: undefined, message: 'hello' })
  })
})

describe('scrubUrl', () => {
  it('drops the fragment, where the implicit flow puts the tokens', () => {
    expect(scrubUrl('https://app.test/reinitialiser#access_token=eyJ.a.b&refresh_token=r1&type=recovery')).toBe(
      'https://app.test/reinitialiser',
    )
  })

  it('drops the auth query params and keeps the others as written', () => {
    expect(scrubUrl('https://app.test/auth/callback?code=abc&next=%2Fparametres&token_hash=t&type=invite')).toBe(
      'https://app.test/auth/callback?next=%2Fparametres',
    )
    expect(scrubUrl('/verifier?token=t1&access_token=a&refresh_token=r')).toBe('/verifier')
  })

  it('matches encoded param names', () => {
    expect(scrubUrl('/x?acc%65ss_token=a&page=2')).toBe('/x?page=2')
  })

  it('leaves a URL without fragment or auth params as is', () => {
    expect(scrubUrl('/rest/v1/rpc/list_users?select=*&order=name')).toBe('/rest/v1/rpc/list_users?select=*&order=name')
    expect(scrubUrl('/parametres')).toBe('/parametres')
  })
})

describe('scrubSentryEvent: URLs', () => {
  it('scrubs request.url', () => {
    const event = { type: undefined, request: { url: 'https://app.test/connexion?code=abc&x=1#access_token=a' } } as Event
    expect(scrubSentryEvent(event)?.request?.url).toBe('https://app.test/connexion?x=1')
  })

  it('scrubs request.query_string in each of its shapes', () => {
    const asString = { type: undefined, request: { query_string: 'token_hash=t&type=recovery&x=1' } } as Event
    expect(scrubSentryEvent(asString)?.request?.query_string).toBe('x=1')
    const asPairs = { type: undefined, request: { query_string: [['code', 'c'], ['x', '1']] } } as Event
    expect(scrubSentryEvent(asPairs)?.request?.query_string).toEqual([['x', '1']])
    const asRecord = { type: undefined, request: { query_string: { refresh_token: 'r', x: '1' } } } as Event
    expect(scrubSentryEvent(asRecord)?.request?.query_string).toEqual({ x: '1' })
  })

  it('scrubs the Referer header and keeps the other headers', () => {
    const event = {
      type: undefined,
      request: { headers: { Referer: 'https://app.test/#access_token=a&type=invite', 'User-Agent': 'UA' } },
    } as Event
    expect(scrubSentryEvent(event)?.request?.headers).toEqual({ Referer: 'https://app.test/', 'User-Agent': 'UA' })
  })

  it('scrubs navigation breadcrumbs from / to', () => {
    const event = {
      type: undefined,
      breadcrumbs: [{ category: 'navigation', data: { from: '/#access_token=a&refresh_token=r', to: '/accueil?code=c' } }],
    } as Event
    expect(scrubSentryEvent(event)?.breadcrumbs?.[0]?.data).toEqual({ from: '/', to: '/accueil' })
  })

  // The email links of Phase 3 land on /connexion/confirmer?token_hash=…&type=…: an error on that
  // page, or a navigation from it (the page strips the query at once), must not carry the token.
  it('scrubs the token of a /connexion/confirmer link everywhere a URL is reported', () => {
    const link = 'https://app.test/connexion/confirmer?token_hash=pkce_0123456789abcdef&type=email&next=https%3A%2F%2Fapp.test%2Fparametres'
    const event = {
      type: undefined,
      request: { url: link, query_string: link.split('?')[1], headers: { Referer: link } },
      breadcrumbs: [{ category: 'navigation', data: { from: link, to: '/connexion/confirmer' } }],
    } as Event
    const scrubbed = scrubSentryEvent(event)
    const kept = 'https://app.test/connexion/confirmer?next=https%3A%2F%2Fapp.test%2Fparametres'
    expect(scrubbed?.request?.url).toBe(kept)
    expect(scrubbed?.request?.query_string).toBe('next=https%3A%2F%2Fapp.test%2Fparametres')
    expect(scrubbed?.request?.headers).toEqual({ Referer: kept })
    expect(scrubbed?.breadcrumbs?.[0]?.data).toEqual({ from: kept, to: '/connexion/confirmer' })
    expect(JSON.stringify(scrubbed)).not.toContain('pkce_0123456789abcdef')
  })

  // A staff invitation lands on /invitation#t=<token> (Task 3.21): the page strips the fragment at
  // once, but the page load and that navigation are reported with the full URL.
  it('scrubs the token of an /invitation link everywhere a URL is reported', () => {
    const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
    const link = `https://app.test/invitation#t=${token}`
    const event = {
      type: undefined,
      request: { url: link, headers: { Referer: link } },
      breadcrumbs: [
        { category: 'navigation', data: { from: link, to: '/invitation' } },
        { category: 'navigation', data: { from: '/invitation', to: '/accueil' } },
      ],
    } as Event
    const scrubbed = scrubSentryEvent(event)
    expect(scrubbed?.request?.url).toBe('https://app.test/invitation')
    expect(scrubbed?.request?.headers).toEqual({ Referer: 'https://app.test/invitation' })
    expect(scrubbed?.breadcrumbs?.[0]?.data).toEqual({ from: 'https://app.test/invitation', to: '/invitation' })
    expect(JSON.stringify(scrubbed)).not.toContain(token)
  })

  it('scrubs fetch and xhr breadcrumb urls', () => {
    const event = {
      type: undefined,
      breadcrumbs: [
        { category: 'fetch', data: { method: 'GET', url: 'https://x.supabase.co/auth/v1/verify?token=t&type=signup&redirect_to=y' } },
        { category: 'xhr', data: { method: 'POST', url: '/auth/v1/token?grant_type=pkce#frag' } },
      ],
    } as Event
    expect(scrubSentryEvent(event)?.breadcrumbs?.map((b) => b.data?.url)).toEqual([
      'https://x.supabase.co/auth/v1/verify?redirect_to=y',
      '/auth/v1/token?grant_type=pkce',
    ])
  })
})
