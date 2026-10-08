import { describe, expect, it } from 'vitest'
import { redactDigitRuns, scrubSentryEvent } from './sentry-scrub'

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
