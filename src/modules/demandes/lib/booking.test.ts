import { describe, expect, it } from 'vitest'
import { captureSource, leadingZeroBits, solveCheck, toE164 } from './booking'

describe('captureSource (R-74)', () => {
  it('the utm_* parameters, the referrer, the landing page; never a fragment', () => {
    const source = captureSource(
      'https://app.test/appel-decouverte?clinique=x&utm_source=instagram&utm_campaign=automne&utm_evil=1#t=secret',
      'https://www.site.test/services?ref=1#top',
    )
    expect(source).toEqual({
      utm: { utm_source: 'instagram', utm_campaign: 'automne' },
      referrer: 'https://www.site.test/services?ref=1',
      landing: 'https://app.test/appel-decouverte?clinique=x&utm_source=instagram&utm_campaign=automne&utm_evil=1',
    })
  })

  it('the website may pass its own landing page; no referrer is null', () => {
    expect(captureSource('https://app.test/appel-decouverte?landing=https%3A%2F%2Fsite.test%2Fpromo', '')).toEqual({
      utm: {},
      referrer: null,
      landing: 'https://site.test/promo',
    })
  })
})

describe('the proof-of-work check (D-7)', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Uint8Array.from([0, 0x0f, 0xff]))).toBe(12)
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0)
  })

  it('finds a nonce whose hash starts with the bits asked', async () => {
    const nonce = await solveCheck('ticket.sig', 6)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ticket.sig:${nonce}`)))
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(6)
  })
})

describe('toE164', () => {
  it('a North American number typed any usual way', () => {
    expect(toE164('514 555-0101')).toBe('+15145550101')
    expect(toE164('1 (514) 555-0101')).toBe('+15145550101')
    expect(toE164('+33 1 23 45 67 89')).toBe('+33123456789')
    expect(toE164('555-0101')).toBeNull()
  })
})
