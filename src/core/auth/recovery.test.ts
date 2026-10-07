import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { fakeAccessToken } from '@/test/jwt'

vi.mock('@/core/supabase/client', () => ({ AUTH_STORAGE_KEY: 'test-auth-key' }))

const { RECOVERY_STORAGE_KEY, isRecoverySession, sessionIdOf, setRecoveryMarker } = await import('./recovery')

const sessionFor = (sessionId: string) => ({ access_token: fakeAccessToken(sessionId), user: { id: 'u1' } }) as Session

afterEach(() => {
  vi.unstubAllGlobals()
  setRecoveryMarker(null)
  localStorage.clear()
})

describe('sessionIdOf', () => {
  it('reads session_id from a real-shaped access token', () => {
    expect(sessionIdOf(fakeAccessToken('9b2f0c4e-1d7a-4c55-8e3f-2a6b9d1c0e7f'))).toBe('9b2f0c4e-1d7a-4c55-8e3f-2a6b9d1c0e7f')
  })

  // Every base64url length remainder, and the url-safe alphabet ('-' and '_' in the payload).
  it.each(['a', 'ab', 'abc', 'abcd', '???>>>'])('decodes unpadded base64url (%s)', (id) => {
    expect(sessionIdOf(fakeAccessToken(id, { pad: '~~~???>>>' }))).toBe(id)
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['an opaque token', 'opaque-token'],
    ['a non-JSON payload', 'a.!!!.c'],
  ])('returns null for %s', (_label, token) => {
    expect(sessionIdOf(token)).toBeNull()
  })

  it('returns null without a string session_id', () => {
    const token = fakeAccessToken('x').split('.')
    token[1] = btoa(JSON.stringify({ session_id: 42 })).replace(/=+$/, '')
    expect(sessionIdOf(token.join('.'))).toBeNull()
  })
})

describe('recovery marker', () => {
  it('stores the recovery session id under its own key', () => {
    setRecoveryMarker('s1')
    expect(RECOVERY_STORAGE_KEY).toBe('test-auth-key-recovery')
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBe('s1')
  })

  it('matches only the session it was set for', () => {
    setRecoveryMarker('s1')
    expect(isRecoverySession(sessionFor('s1'))).toBe(true)
    expect(isRecoverySession(sessionFor('s2'))).toBe(false)
    expect(isRecoverySession(null)).toBe(false)
  })

  it('is shared through storage (other tabs, reloads)', () => {
    localStorage.setItem(RECOVERY_STORAGE_KEY, 's1')
    expect(isRecoverySession(sessionFor('s1'))).toBe(true)
  })

  it('is cleared', () => {
    setRecoveryMarker('s1')
    setRecoveryMarker(null)
    expect(localStorage.getItem(RECOVERY_STORAGE_KEY)).toBeNull()
    expect(isRecoverySession(sessionFor('s1'))).toBe(false)
  })

  it('never matches a session without an id', () => {
    setRecoveryMarker('s1')
    expect(isRecoverySession({ access_token: 'opaque', user: { id: 'u1' } } as Session)).toBe(false)
  })

  it('falls back to memory when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    setRecoveryMarker('s1')
    expect(isRecoverySession(sessionFor('s1'))).toBe(true)
    expect(isRecoverySession(sessionFor('s2'))).toBe(false)
    setRecoveryMarker(null)
    expect(isRecoverySession(sessionFor('s1'))).toBe(false)
  })
})
