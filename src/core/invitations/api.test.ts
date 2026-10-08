import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import { acceptInvite, resolveLink } from './api'

const mocks = vi.hoisted(() => ({ invokeFunction: vi.fn() }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const DISPLAY = { clinic_name: 'Clinique MANA', display_name: 'Nouvelle Personne', email: 'nouvelle@mana.test', expires_at: '2026-10-15T16:00:00+00:00' }

describe('resolveLink', () => {
  it("asks resolve-link what the token opens and returns the staff invitation's display", async () => {
    mocks.invokeFunction.mockResolvedValue({ purpose: 'staff_invite', display: DISPLAY })
    await expect(resolveLink(TOKEN)).resolves.toEqual(DISPLAY)
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('resolve-link', { token: TOKEN })
  })

  it('reads a link of another purpose as invalid here', async () => {
    mocks.invokeFunction.mockResolvedValue({ purpose: 'professional_onboarding', display: { name: 'x' } })
    await expect(resolveLink(TOKEN)).rejects.toMatchObject({ code: 'link_invalid' })
  })

  it("passes the function's refusal on", async () => {
    const refusal = new FunctionCallError('link_expired', 410, 'Link expired')
    mocks.invokeFunction.mockRejectedValue(refusal)
    await expect(resolveLink(TOKEN)).rejects.toBe(refusal)
  })
})

describe('acceptInvite', () => {
  it('sends the token and password to accept-invite and returns the account address', async () => {
    mocks.invokeFunction.mockResolvedValue({ status: 'accepted', email: 'nouvelle@mana.test' })
    await expect(acceptInvite(TOKEN, 'un mot de passe')).resolves.toEqual({ email: 'nouvelle@mana.test' })
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('accept-invite', { token: TOKEN, password: 'un mot de passe' })
  })

  it("passes the function's refusal on", async () => {
    const refusal = new FunctionCallError('conflict', 409, 'Ce lien ne peut plus être utilisé.')
    mocks.invokeFunction.mockRejectedValue(refusal)
    await expect(acceptInvite(TOKEN, 'un mot de passe')).rejects.toBe(refusal)
  })

  it('reads an unexpected answer as internal', async () => {
    mocks.invokeFunction.mockResolvedValue({ status: 'pending' })
    await expect(acceptInvite(TOKEN, 'un mot de passe')).rejects.toMatchObject({ code: 'internal' })
  })
})
