import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError, invokeFunction } from './functions'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }))

afterEach(() => vi.clearAllMocks())

const httpError = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))

describe('invokeFunction', () => {
  it('posts the body to the function and returns its data', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: 1 }, error: null })
    await expect(invokeFunction('resolve-link', { token: 't' })).resolves.toEqual({ ok: 1 })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('resolve-link', { body: { token: 't' } })
  })

  it("passes the caller's signal on", async () => {
    mocks.invoke.mockResolvedValue({ data: {}, error: null })
    const signal = new AbortController().signal
    await invokeFunction('email-preview', { template_key: 'k' }, { signal })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('email-preview', { body: { template_key: 'k' }, signal })
  })

  it("throws the function's code, status and message, and keeps the answer's other fields", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: { code: 'provider_error', message: 'Invitation created, email not sent' }, invitation_id: 'i1' }),
    })
    const error = await invokeFunction('staff-invite', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FunctionCallError)
    expect(error).toMatchObject({
      code: 'provider_error',
      status: 502,
      message: 'Invitation created, email not sent',
      extra: { invitation_id: 'i1' },
      retryAfter: null,
    })
  })

  it("keeps the error's own extra fields (field, variable) next to the answer's", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: { code: 'invalid_request', message: 'Invitation created, email not sent', field: 'email' }, invitation_id: 'i1' }),
    })
    const error = (await invokeFunction('staff-invite', {}).catch((e: unknown) => e)) as FunctionCallError
    expect(error.extra).toEqual({ field: 'email', invitation_id: 'i1' })
    expect(error.field).toBe('email')
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(400, { error: { code: 'invalid_request', message: 'Unknown variable', variable: 'client.x' } }) })
    await expect(invokeFunction('email-preview', {})).rejects.toMatchObject({ extra: { variable: 'client.x' }, field: undefined })
  })

  it("keeps a 429's Retry-After, in seconds", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(429, { error: { code: 'rate_limited', message: 'Too many' } }, { 'Retry-After': '2700' }) })
    await expect(invokeFunction('accept-invite', {})).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 2700 })
  })

  it('reads an answer that is not the function JSON as internal, and an unreachable function as network', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response('<html>', { status: 504 })) })
    await expect(invokeFunction('x', {})).rejects.toMatchObject({ code: 'internal', status: 504 })
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsFetchError(new TypeError('offline')) })
    await expect(invokeFunction('x', {})).rejects.toMatchObject({ code: 'network', status: 0 })
  })
})
