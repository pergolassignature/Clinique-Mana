import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBankDetails, revealAccountNumber, setBankDetails } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const ROW = {
  institution_number: '815',
  transit_number: '30000',
  account_last4: '4567',
  etransfer_email: 'paiement@cliniquemana.test',
  updated_at: '2026-10-07T18:30:00+00:00',
  updated_by_name: 'Marie Tremblay',
}

describe('fetchBankDetails', () => {
  it('reads the masked row through get_bank_details', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null })
    await expect(fetchBankDetails()).resolves.toEqual(ROW)
    expect(mocks.rpc).toHaveBeenCalledWith('get_bank_details')
  })

  it('resolves null when nothing is stored', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchBankDetails()).resolves.toBeNull()
  })

  it('accepts a row with no Interac email and no author name', async () => {
    const row = { ...ROW, etransfer_email: null, updated_by_name: null }
    mocks.rpc.mockResolvedValue({ data: [row], error: null })
    await expect(fetchBankDetails()).resolves.toEqual(row)
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : settings.bank_manage' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchBankDetails()).rejects.toBe(error)
  })
})

describe('revealAccountNumber', () => {
  it('returns the full number from reveal_bank_account_number', async () => {
    mocks.rpc.mockResolvedValue({ data: '1234567', error: null })
    await expect(revealAccountNumber()).resolves.toBe('1234567')
    expect(mocks.rpc).toHaveBeenCalledWith('reveal_bank_account_number')
  })

  it('returns null when nothing is stored', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(revealAccountNumber()).resolves.toBeNull()
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : settings.bank_manage' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(revealAccountNumber()).rejects.toBe(error)
  })
})

describe('setBankDetails', () => {
  it('calls set_bank_details with every value', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(
      setBankDetails({ institution: '815', transit: '30000', account: '1234567', etransferEmail: 'paiement@cliniquemana.test' }),
    ).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('set_bank_details', {
      p_institution_number: '815',
      p_transit_number: '30000',
      p_account_number: '1234567',
      p_etransfer_email: 'paiement@cliniquemana.test',
    })
  })

  it('sends a null account (keep the stored one) and a null email as null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await setBankDetails({ institution: '815', transit: '30001', account: null, etransferEmail: null })
    expect(mocks.rpc).toHaveBeenCalledWith('set_bank_details', {
      p_institution_number: '815',
      p_transit_number: '30001',
      p_account_number: null,
      p_etransfer_email: null,
    })
  })

  it('throws the RPC error (French P0001 message)', async () => {
    const error = { code: 'P0001', message: 'Le numéro de compte est requis.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setBankDetails({ institution: '815', transit: '30000', account: null, etransferEmail: null })).rejects.toBe(error)
  })
})
