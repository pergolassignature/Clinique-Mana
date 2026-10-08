import { afterEach, describe, expect, it } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import { pauseFor, pauseSuggestions, resetSuggestionsPause, suggestionsPaused } from './availability'

const error = (code: string, status: number, retryAfter: number | null = null) => new FunctionCallError(code, status, 'x', {}, retryAfter)

afterEach(() => resetSuggestionsPause())

describe('address suggestions availability', () => {
  it('pauses 10 minutes when not configured or not allowed, the Retry-After when limited, 1 minute otherwise', () => {
    expect(pauseFor(error('not_configured', 503))).toBe(600_000)
    expect(pauseFor(error('unauthenticated', 401))).toBe(600_000)
    expect(pauseFor(error('forbidden', 403))).toBe(600_000)
    expect(pauseFor(error('rate_limited', 429, 120))).toBe(120_000)
    expect(pauseFor(error('rate_limited', 429))).toBe(60_000)
    expect(pauseFor(error('provider_error', 502))).toBe(60_000)
    expect(pauseFor(error('network', 0))).toBe(60_000)
    expect(pauseFor(new Error('zod'))).toBe(60_000)
    // A stale place id says nothing about the service.
    expect(pauseFor(error('not_found', 404))).toBe(0)
  })

  it('is paused until the pause ends, and a shorter failure never shortens a longer pause', () => {
    const now = 1_000_000
    expect(suggestionsPaused(now)).toBe(false)
    pauseSuggestions(error('not_configured', 503), now)
    pauseSuggestions(error('network', 0), now)
    expect(suggestionsPaused(now + 599_999)).toBe(true)
    expect(suggestionsPaused(now + 600_000)).toBe(false)
    pauseSuggestions(error('not_found', 404), now + 600_000)
    expect(suggestionsPaused(now + 600_000)).toBe(false)
  })
})
