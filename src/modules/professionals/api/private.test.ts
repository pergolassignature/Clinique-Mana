import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearProfessionalPrivateField,
  fetchProfessionalPrivate,
  revealProfessionalPrivate,
  setProfessionalBank,
  setProfessionalSin,
  setProfessionalTaxNumbers,
} from './private'
import { UNEXPECTED_SHAPE } from './parse'
import { IDS } from '../test/fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const UPDATED_AT = '2026-10-08T17:07:03.123456+00:00'
const ROW = {
  sin_last3: '286',
  business_number: '123456789',
  gst_number: '123456789RT0001',
  qst_number: null,
  bank_institution: '815',
  bank_transit: '30000',
  bank_account_last4: '4567',
  updated_at: UPDATED_AT,
  updated_by_name: 'Marie Tremblay',
}

describe('fetchProfessionalPrivate', () => {
  it('reads the one row of masks, the updated_at string unchanged', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null })
    const data = await fetchProfessionalPrivate(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledWith('get_professional_private', { p_id: IDS.professional })
    expect(data).toEqual({
      sinLast3: '286',
      businessNumber: '123456789',
      gstNumber: '123456789RT0001',
      qstNumber: null,
      bankInstitution: '815',
      bankTransit: '30000',
      bankAccountLast4: '4567',
      updatedAt: UPDATED_AT,
      updatedByName: 'Marie Tremblay',
    })
  })

  it('refuses another shape without quoting it', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchProfessionalPrivate(IDS.professional)).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('reveal and saves', () => {
  it('reveals one field, null when nothing is stored', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: '046454286', error: null }).mockResolvedValueOnce({ data: null, error: null })
    expect(await revealProfessionalPrivate(IDS.professional, 'sin')).toBe('046454286')
    expect(await revealProfessionalPrivate(IDS.professional, 'bank_account')).toBeNull()
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'reveal_professional_private', { p_id: IDS.professional, p_field: 'sin' })
  })

  it('sends each card’s own arguments and the expected updated_at, and returns the new one', async () => {
    mocks.rpc.mockResolvedValue({ data: '2026-10-08T18:00:00+00:00', error: null })
    await expect(
      setProfessionalTaxNumbers(IDS.professional, { businessNumber: '123456789', gstNumber: null, qstNumber: '1234567890TQ0001' }, UPDATED_AT),
    ).resolves.toBe('2026-10-08T18:00:00+00:00')
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_professional_tax_numbers', {
      p_id: IDS.professional,
      p_business_number: '123456789',
      p_gst_number: null,
      p_qst_number: '1234567890TQ0001',
      p_expected_updated_at: UPDATED_AT,
    })
    await setProfessionalBank(IDS.professional, { institution: '815', transit: '30000', account: null }, null)
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_professional_bank', {
      p_id: IDS.professional,
      p_institution: '815',
      p_transit: '30000',
      p_account: null,
      p_expected_updated_at: null,
    })
    await setProfessionalSin(IDS.professional, '046454286', UPDATED_AT)
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_professional_sin', { p_id: IDS.professional, p_sin: '046454286', p_expected_updated_at: UPDATED_AT })
  })

  it('throws a refusal unchanged (the stale HINT reaches the card)', async () => {
    const error = { code: 'P0001', message: 'Ces renseignements ont été modifiés depuis leur affichage.', hint: 'stale' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setProfessionalSin(IDS.professional, '046454286', UPDATED_AT)).rejects.toBe(error)
  })

  it('clears one field', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await clearProfessionalPrivateField(IDS.professional, 'bank_account')
    expect(mocks.rpc).toHaveBeenCalledWith('clear_professional_private_field', { p_id: IDS.professional, p_field: 'bank_account' })
  })
})
