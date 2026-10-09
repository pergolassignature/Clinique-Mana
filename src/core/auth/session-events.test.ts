import { afterEach, describe, expect, it, vi } from 'vitest'
import { onSessionUserChange } from './session-events'

const mocks = vi.hoisted(() => {
  const unsubscribe = vi.fn()
  const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe } } }))
  return { onAuthStateChange, unsubscribe }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { auth: { onAuthStateChange: mocks.onAuthStateChange } } }))

afterEach(() => vi.clearAllMocks())

describe('onSessionUserChange', () => {
  it('reports the session’s user at each auth event (null once signed out), until unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = onSessionUserChange(listener)
    const [[callback]] = mocks.onAuthStateChange.mock.calls as unknown as [[(event: string, session: { user: { id: string } } | null) => void]]
    // The first report is not a change, even without a session (auth-js could not read it).
    callback('INITIAL_SESSION', null)
    callback('SIGNED_IN', { user: { id: 'u2' } })
    callback('SIGNED_OUT', null)
    expect(listener.mock.calls).toEqual([['u2'], [null]])
    unsubscribe()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })
})
