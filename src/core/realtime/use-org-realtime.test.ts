import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { AccessContext, type AccessContextValue } from '@/core/access/access-context'
import { testAccess } from '@/test/contexts'
import { useOrgRealtime } from './use-org-realtime'

type Listener = (message: { payload?: unknown }) => void
const mocks = vi.hoisted(() => {
  const state: { listener: Listener | null; status: ((s: string) => void) | null; topic: string | null; options: unknown } = {
    listener: null,
    status: null,
    topic: null,
    options: null,
  }
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, listener: Listener) => {
      state.listener = listener
      return channel
    }),
    subscribe: vi.fn((callback: (s: string) => void) => {
      state.status = callback
      return channel
    }),
  }
  return {
    state,
    channel,
    supabase: {
      channel: vi.fn((topic: string, options: unknown) => {
        state.topic = topic
        state.options = options
        return channel
      }),
      removeChannel: vi.fn(() => Promise.resolve('ok')),
      realtime: { setAuth: vi.fn(() => Promise.resolve()) },
    },
  }
})
vi.mock('@/core/supabase/client', () => ({ supabase: mocks.supabase }))

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(AccessContext.Provider, { value: { status: 'ready', access: testAccess, problem: null } as unknown as AccessContextValue }, children)

afterEach(() => vi.clearAllMocks())

describe('useOrgRealtime', () => {
  it('joins the clinic\'s private channel of the module, passes ids on, resyncs after a cut, leaves on unmount', async () => {
    const onChange = vi.fn()
    const onResync = vi.fn()
    const { unmount } = renderHook(() => useOrgRealtime('demandes', { onChange, onResync }), { wrapper })
    await waitFor(() => expect(mocks.channel.subscribe).toHaveBeenCalled())
    expect(mocks.state.topic).toBe(`org:${testAccess.org_id}:demandes`)
    expect(mocks.state.options).toEqual({ config: { private: true } })
    expect(mocks.supabase.realtime.setAuth).toHaveBeenCalled()

    mocks.state.status!('SUBSCRIBED')
    expect(onResync).not.toHaveBeenCalled()
    mocks.state.listener!({ payload: { module: 'demandes', table: 'demandes', record_id: 'r1', op: 'update', id: 'x' } })
    expect(onChange).toHaveBeenCalledWith({ module: 'demandes', table: 'demandes', recordId: 'r1', op: 'update' })
    // Another module's or a malformed message is ignored.
    mocks.state.listener!({ payload: { module: 'billing', table: 'x', record_id: 'r', op: 'insert' } })
    mocks.state.listener!({ payload: { nope: true } })
    expect(onChange).toHaveBeenCalledTimes(1)
    // Back after a cut: read everything again.
    mocks.state.status!('CHANNEL_ERROR')
    mocks.state.status!('SUBSCRIBED')
    expect(onResync).toHaveBeenCalledTimes(1)

    unmount()
    expect(mocks.supabase.removeChannel).toHaveBeenCalledWith(mocks.channel)
  })

  it('joins nothing without a module', () => {
    renderHook(() => useOrgRealtime(null, { onChange: vi.fn(), onResync: vi.fn() }), { wrapper })
    expect(mocks.supabase.channel).not.toHaveBeenCalled()
  })
})
