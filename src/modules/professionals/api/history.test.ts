import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProfessionalHistory, PROFESSIONAL_HISTORY_PAGE_SIZE } from './history'
import { HISTORY_ROW_JSON, IDS } from '../test/fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

describe('fetchProfessionalHistory', () => {
  it('reads the newest page without a cursor', async () => {
    mocks.rpc.mockResolvedValue({ data: [HISTORY_ROW_JSON], error: null })
    const entries = await fetchProfessionalHistory(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledWith('list_professional_history', { p_id: IDS.professional, p_limit: PROFESSIONAL_HISTORY_PAGE_SIZE })
    expect(entries[0]).toMatchObject({ id: 4012, tableName: 'professional_motifs', action: 'insert' })
  })

  it('pages before the last id', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await fetchProfessionalHistory(IDS.professional, 4012)
    expect(mocks.rpc).toHaveBeenCalledWith('list_professional_history', { p_id: IDS.professional, p_before_id: 4012, p_limit: 50 })
  })

  it('throws the refusal unchanged (a provider has no professionals.view)', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchProfessionalHistory(IDS.professional)).rejects.toBe(error)
  })
})
