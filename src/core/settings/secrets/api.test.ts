import { afterEach, describe, expect, it, vi } from 'vitest'
import { listOrgSecretKeys, setOrgSecret } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('listOrgSecretKeys', () => {
  it('lists the names and dates of the configured secrets, never a value', async () => {
    const rows = [{ key: 'resend_api_key', updated_at: '2026-10-08T12:00:00+00:00' }]
    mocks.rpc.mockResolvedValue({ data: rows, error: null })
    await expect(listOrgSecretKeys()).resolves.toEqual(rows)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_org_secret_keys')
  })
})

describe('setOrgSecret', () => {
  it('writes the value through the RPC (Vault), and throws its error', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    await setOrgSecret('resend_api_key', 'local-dev-key')
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('set_org_secret', { p_key: 'resend_api_key', p_value: 'local-dev-key' })
    const error = { code: '42501', message: 'Permission refusée : settings.integrations_manage' }
    mocks.rpc.mockResolvedValueOnce({ data: null, error })
    await expect(setOrgSecret('resend_api_key', 'x')).rejects.toBe(error)
  })
})
