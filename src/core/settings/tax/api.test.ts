import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTaxRate, deleteTaxRate, fetchTaxRates, TAX_RATE_COLUMNS, taxRateOn } from './api'

const mocks = vi.hoisted(() => {
  const secondOrder = vi.fn()
  const firstOrder = vi.fn(() => ({ order: secondOrder }))
  const select = vi.fn(() => ({ order: firstOrder }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  return { from, select, firstOrder, secondOrder, rpc }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const ROW = {
  id: 'r1',
  tax: 'qst',
  rate: 0.09975,
  effective_from: '2013-01-01',
  effective_to: null,
  created_at: '2026-10-07T12:00:00+00:00',
}

describe('fetchTaxRates', () => {
  it('reads the rates by tax, newest first', async () => {
    mocks.secondOrder.mockResolvedValue({ data: [ROW], error: null })
    await expect(fetchTaxRates()).resolves.toEqual([ROW])
    expect(mocks.from).toHaveBeenCalledWith('tax_rates')
    expect(mocks.select).toHaveBeenCalledWith(TAX_RATE_COLUMNS)
    expect(mocks.firstOrder).toHaveBeenCalledWith('tax')
    expect(mocks.secondOrder).toHaveBeenCalledWith('effective_from', { ascending: false })
  })

  it('reads a numeric sent as a string as a number', async () => {
    mocks.secondOrder.mockResolvedValue({ data: [{ ...ROW, rate: '0.099750' }], error: null })
    await expect(fetchTaxRates()).resolves.toEqual([ROW])
  })

  it('refuses a tax other than gst or qst', async () => {
    mocks.secondOrder.mockResolvedValue({ data: [{ ...ROW, tax: 'hst' }], error: null })
    await expect(fetchTaxRates()).rejects.toThrow()
  })

  it('throws the query error', async () => {
    const error = { code: '42501', message: 'permission denied' }
    mocks.secondOrder.mockResolvedValue({ data: null, error })
    await expect(fetchTaxRates()).rejects.toBe(error)
  })
})

describe('addTaxRate', () => {
  it('calls add_tax_rate with the fraction and the date as typed, and returns the new id', async () => {
    mocks.rpc.mockResolvedValue({ data: 'new-id', error: null })
    await expect(addTaxRate('qst', 0.1, '2027-01-01')).resolves.toBe('new-id')
    expect(mocks.rpc).toHaveBeenCalledWith('add_tax_rate', { p_tax: 'qst', p_rate: 0.1, p_effective_from: '2027-01-01' })
  })

  it('throws the RPC error (French P0001 message)', async () => {
    const error = { code: 'P0001', message: 'Le nouveau taux doit commencer après le 2013-01-01.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(addTaxRate('qst', 0.1, '2012-01-01')).rejects.toBe(error)
  })
})

describe('deleteTaxRate', () => {
  it('calls delete_tax_rate with the id', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(deleteTaxRate('r1')).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('delete_tax_rate', { p_id: 'r1' })
  })

  it('throws the RPC error', async () => {
    const error = { code: 'P0001', message: 'Un taux déjà en vigueur ne peut pas être supprimé.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(deleteTaxRate('r1')).rejects.toBe(error)
  })
})

describe('taxRateOn', () => {
  it('returns the rate in force on the date', async () => {
    mocks.rpc.mockResolvedValue({ data: 0.09975, error: null })
    await expect(taxRateOn('qst', '2020-06-01')).resolves.toBe(0.09975)
    expect(mocks.rpc).toHaveBeenCalledWith('tax_rate_on', { p_tax: 'qst', p_date: '2020-06-01' })
  })

  it('returns null when no rate applies on the date', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(taxRateOn('gst', '2007-12-31')).resolves.toBeNull()
  })

  it('throws the RPC error', async () => {
    const error = { code: '57014', message: 'canceling statement due to statement timeout' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(taxRateOn('gst', '2020-01-01')).rejects.toBe(error)
  })
})
