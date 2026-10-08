import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProfessionalsSettings, saveProfessionalsSettings } from './settings'
import { UNEXPECTED_SHAPE } from './parse'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

const INVITATION_JSON = { invitation_expiry_days: 7, invitation_reminder_after_days: 3 }
const INVITATION = { invitationExpiryDays: 7, invitationReminderAfterDays: 3 }
const FICHE_JSON = { fiche_show_pro_contact: true, fiche_show_clinic_footer: true, fiche_show_closing: true }
const FICHE = { ficheShowProContact: true, ficheShowClinicFooter: true, ficheShowClosing: true }
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('fetchProfessionalsSettings', () => {
  it('reads the effective settings (defaults merged in SQL)', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: false, ...INVITATION_JSON, ...FICHE_JSON }, error: null })
    await expect(fetchProfessionalsSettings()).resolves.toEqual({ collectSin: false, ...INVITATION, ...FICHE })
    expect(mocks.rpc).toHaveBeenCalledWith('get_professionals_settings')
  })

  it('throws the shape error on an unexpected value', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: 'yes', ...INVITATION_JSON, ...FICHE_JSON }, error: null })
    await expect(fetchProfessionalsSettings()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('saveProfessionalsSettings', () => {
  it('sends only the changed keys, in SQL names, and returns the effective settings', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: true, ...INVITATION_JSON, ...FICHE_JSON }, error: null })
    await expect(saveProfessionalsSettings({ collectSin: true })).resolves.toEqual({ collectSin: true, ...INVITATION, ...FICHE })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_settings', { p_patch: { collect_sin: true } })
  })

  it('sends the invitation keys, a reminder switched off as null (4b.3)', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: false, invitation_expiry_days: 10, invitation_reminder_after_days: null, ...FICHE_JSON }, error: null })
    await saveProfessionalsSettings({ invitationExpiryDays: 10, invitationReminderAfterDays: null })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_settings', { p_patch: { invitation_expiry_days: 10, invitation_reminder_after_days: null } })
  })

  it('names the fiche options in SQL (P4-353)', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: false, ...INVITATION_JSON, ...FICHE_JSON, fiche_show_closing: false }, error: null })
    await expect(saveProfessionalsSettings({ ficheShowClosing: false })).resolves.toMatchObject({ ficheShowClosing: false })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_settings', { p_patch: { fiche_show_closing: false } })
  })

  it('throws the refusal unchanged (collect_sin needs professionals.private)', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.private' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveProfessionalsSettings({ collectSin: true })).rejects.toBe(error)
  })
})
