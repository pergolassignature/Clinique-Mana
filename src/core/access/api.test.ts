import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { fetchMyAccess } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), captureException: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => {
  mocks.rpc.mockReset()
  mocks.captureException.mockReset()
})

describe('fetchMyAccess', () => {
  it('reports an unexpected payload to Sentry and rethrows it', async () => {
    mocks.rpc.mockResolvedValue({ data: { hello: 'world' }, error: null })
    await expect(fetchMyAccess()).rejects.toBeInstanceOf(ZodError)
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(ZodError), expect.anything())
  })

  it('throws RPC errors without reporting them as payload bugs', async () => {
    const error = { message: 'network', code: '' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchMyAccess()).rejects.toBe(error)
    expect(mocks.captureException).not.toHaveBeenCalled()
  })
})
