import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_ERROR_PATTERNS, isChunkLoadError, recoverFromStaleChunk } from './app-update'
import { registerUnsavedChangesCheck } from './unsaved-changes-registry'

const CHUNK_MESSAGES = [
  ['Chromium', 'Failed to fetch dynamically imported module: https://app.test/assets/X-abc.js'],
  ['Firefox', 'error loading dynamically imported module: https://app.test/assets/X-abc.js'],
  ['Safari', 'Importing a module script failed.'],
  ['webpack-style', 'Loading chunk 42 failed.'],
  ['webpack-style CSS', 'Loading CSS chunk 7 failed.'],
  ["Vite's CSS preload", 'Unable to preload CSS for /assets/X-abc.css'],
  ['HTML served for a chunk', "'text/html' is not a valid JavaScript MIME type."],
  ['other casing', 'loading CHUNK 42 failed'],
] as const

describe('isChunkLoadError', () => {
  it.each(CHUNK_MESSAGES)('recognises a failed chunk (%s)', (_source, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('recognises a ChunkLoadError by name', () => {
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true)
  })

  it.each([
    ['an ordinary bug', new TypeError("Cannot read properties of undefined (reading 'id')")],
    // PS Hub's TDZ heuristic is left out: here a missing chunk is a 404, never index.html (vercel.json),
    // and a real initialisation bug must not be hidden as « nouvelle version ».
    ['a TDZ error', new ReferenceError("Cannot access 'x' before initialization")],
    ['a string', 'Failed to fetch dynamically imported module'],
    ['null', null],
  ])('is false for %s', (_case, error) => {
    expect(isChunkLoadError(error)).toBe(false)
  })

  it("matches every pattern Sentry is told to ignore, and only those (main.tsx's ignoreErrors)", () => {
    for (const [, message] of CHUNK_MESSAGES) expect(CHUNK_ERROR_PATTERNS.some((p) => p.test(message))).toBe(true)
    expect(CHUNK_ERROR_PATTERNS.some((p) => p.test('Network request failed'))).toBe(false)
  })
})

describe('recoverFromStaleChunk', () => {
  let reload: ReturnType<typeof vi.fn<() => void>>
  const cleanups: (() => void)[] = []

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    reload = vi.fn<() => void>()
    vi.spyOn(window.location, 'reload').mockImplementation(reload)
  })
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reloads the page', () => {
    expect(recoverFromStaleChunk()).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('stops after 3 reloads within 60 s, then allows them again', () => {
    for (let i = 0; i < 3; i++) {
      expect(recoverFromStaleChunk()).toBe(true)
      vi.advanceTimersByTime(1_000)
    }
    vi.advanceTimersByTime(56_000)
    expect(recoverFromStaleChunk()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(3)
    // A rolling window: 60 s after the first reload, one more is allowed.
    vi.advanceTimersByTime(1_000)
    expect(recoverFromStaleChunk()).toBe(true)
    expect(recoverFromStaleChunk()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(4)
  })

  it('never reloads over unsaved edits, and does not spend an attempt', () => {
    let dirty = true
    cleanups.push(registerUnsavedChangesCheck(() => dirty))
    expect(recoverFromStaleChunk()).toBe(false)
    expect(recoverFromStaleChunk()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    dirty = false
    expect([recoverFromStaleChunk(), recoverFromStaleChunk(), recoverFromStaleChunk()]).toEqual([true, true, true])
  })

  it('does not reload when sessionStorage is blocked (it could not stop a loop)', () => {
    // The test runtime's sessionStorage may not be happy-dom's Storage: spy on its own prototype.
    vi.spyOn(Object.getPrototypeOf(window.sessionStorage) as Storage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(recoverFromStaleChunk()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('starts over from an unreadable count', () => {
    sessionStorage.setItem('mana:stale-chunk-reloads', '{not json')
    expect(recoverFromStaleChunk()).toBe(true)
    sessionStorage.setItem('mana:stale-chunk-reloads', '{"count":9}')
    expect(recoverFromStaleChunk()).toBe(true)
  })
})
