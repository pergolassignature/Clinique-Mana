import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoiceWaitlistFee } from './waitlist'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('invoiceWaitlistFee', () => {
  it('answers the number and the module holding its email (D-52)', async () => {
    mocks.rpc.mockResolvedValue({ data: { number: '2026-7', email_held_by: 'demandes' }, error: null })
    await expect(invoiceWaitlistFee('e1')).resolves.toEqual({ number: '2026-7', emailHeldBy: 'demandes' })
    expect(mocks.rpc).toHaveBeenCalledWith('invoice_waitlist_fee', { p_entry_id: 'e1' })
  })

  it('nothing held: null', async () => {
    mocks.rpc.mockResolvedValue({ data: { number: '2026-8', email_held_by: null }, error: null })
    await expect(invoiceWaitlistFee('e1')).resolves.toEqual({ number: '2026-8', emailHeldBy: null })
  })

  it('the earlier answer (the number only) still reads, for a deploy in between', async () => {
    mocks.rpc.mockResolvedValue({ data: '2026-9', error: null })
    await expect(invoiceWaitlistFee('e1')).resolves.toEqual({ number: '2026-9', emailHeldBy: null })
  })

  it('an unexpected shape throws; an RPC error is passed on', async () => {
    mocks.rpc.mockResolvedValue({ data: { number: 3 }, error: null })
    await expect(invoiceWaitlistFee('e1')).rejects.toThrow('demandes: unexpected RPC shape')
    const failure = { code: 'P0001', message: 'Liez d’abord l’inscription au dossier du client.' }
    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(invoiceWaitlistFee('e1')).rejects.toBe(failure)
  })
})
