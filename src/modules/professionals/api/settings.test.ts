import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProfessionalsSettings, saveProfessionalsSettings } from './settings'
import { UNEXPECTED_SHAPE } from './parse'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

const FICHE_JSON = { fiche_show_pro_contact: true, fiche_show_clinic_footer: true, fiche_show_closing: true }
const FICHE = { ficheShowProContact: true, ficheShowClinicFooter: true, ficheShowClosing: true }
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('fetchProfessionalsSettings', () => {
  it('reads the effective settings (defaults merged in SQL)', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: false, ...FICHE_JSON }, error: null })
    await expect(fetchProfessionalsSettings()).resolves.toEqual({ collectSin: false, ...FICHE })
    expect(mocks.rpc).toHaveBeenCalledWith('get_professionals_settings')
  })

  it('throws the shape error on an unexpected value', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: 'yes', ...FICHE_JSON }, error: null })
    await expect(fetchProfessionalsSettings()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('saveProfessionalsSettings', () => {
  it('sends only the changed keys, in SQL names, and returns the effective settings', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: true, ...FICHE_JSON }, error: null })
    await expect(saveProfessionalsSettings({ collectSin: true })).resolves.toEqual({ collectSin: true, ...FICHE })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_settings', { p_patch: { collect_sin: true } })
  })

  it('names the fiche options in SQL (P4-353)', async () => {
    mocks.rpc.mockResolvedValue({ data: { collect_sin: false, ...FICHE_JSON, fiche_show_closing: false }, error: null })
    await expect(saveProfessionalsSettings({ ficheShowClosing: false })).resolves.toMatchObject({ ficheShowClosing: false })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_settings', { p_patch: { fiche_show_closing: false } })
  })

  it('throws the refusal unchanged (collect_sin needs professionals.private)', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.private' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveProfessionalsSettings({ collectSin: true })).rejects.toBe(error)
  })
})
