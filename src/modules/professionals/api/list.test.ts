import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProfessionalsList, fetchProfessionalsPage, LIST_COLUMNS, PROFESSIONALS_LIST_MAX, PROFESSIONALS_PAGE_SIZE } from './list'
import { listRowPayload, parseRpc, UNEXPECTED_SHAPE } from './parse'
import { IDS, LIST_ROW_JSON } from '../test/fixtures'

const mocks = vi.hoisted(() => {
  const limit = vi.fn()
  const order = vi.fn()
  const chain = { order, limit }
  order.mockReturnValue(chain)
  const select = vi.fn(() => chain)
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  return { from, select, order, limit, rpc }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const row = (n: number) => ({ ...LIST_ROW_JSON, id: `id-${n}`, last_name: `Nom ${String(n).padStart(3, '0')}` })

describe('fetchProfessionalsList', () => {
  it('reads the view sorted by name, one row past the cap', async () => {
    mocks.limit.mockResolvedValue({ data: [LIST_ROW_JSON], error: null })
    const result = await fetchProfessionalsList()
    expect(mocks.from).toHaveBeenCalledWith('professionals_list')
    expect(mocks.select).toHaveBeenCalledWith(LIST_COLUMNS)
    expect(mocks.order.mock.calls).toEqual([['last_name'], ['first_name'], ['id']])
    expect(mocks.limit).toHaveBeenCalledWith(PROFESSIONALS_LIST_MAX + 1)
    expect(result).toEqual({ rows: [parseRpc(listRowPayload, LIST_ROW_JSON)], truncated: false })
  })

  it('selects no org_id: rows carry ids and flags only', () => {
    expect(LIST_COLUMNS).not.toContain('org_id')
  })

  it('keeps 500 rows and says the list is truncated at 501', async () => {
    mocks.limit.mockResolvedValue({ data: Array.from({ length: 501 }, (_, i) => row(i)), error: null })
    const result = await fetchProfessionalsList()
    expect(result.rows).toHaveLength(PROFESSIONALS_LIST_MAX)
    expect(result.truncated).toBe(true)
  })

  it('throws the query error unchanged', async () => {
    const error = { code: '42501', message: 'permission denied' }
    mocks.limit.mockResolvedValue({ data: null, error })
    await expect(fetchProfessionalsList()).rejects.toBe(error)
  })

  it('throws the shape error on an unexpected row', async () => {
    mocks.limit.mockResolvedValue({ data: [{ ...LIST_ROW_JSON, status: 'pending' }], error: null })
    await expect(fetchProfessionalsList()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('fetchProfessionalsPage', () => {
  const last = parseRpc(listRowPayload, LIST_ROW_JSON)

  it('reads the first page by name, without filters', async () => {
    mocks.rpc.mockResolvedValue({ data: [LIST_ROW_JSON], error: null })
    await expect(fetchProfessionalsPage({ sort: 'name' }, null)).resolves.toEqual([last])
    expect(mocks.rpc).toHaveBeenCalledWith('list_professionals', { p_sort: 'name', p_limit: PROFESSIONALS_PAGE_SIZE })
  })

  it('sends the filters that are set, and the name cursor of the last row', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await fetchProfessionalsPage(
      { sort: 'name', statuses: ['active'], titleIds: [IDS.psychologue], languageIds: [], motifIds: [IDS.anxiete], acceptingNewClients: true },
      last,
    )
    expect(mocks.rpc).toHaveBeenCalledWith('list_professionals', {
      p_sort: 'name',
      p_limit: PROFESSIONALS_PAGE_SIZE,
      p_statuses: ['active'],
      p_title_ids: [IDS.psychologue],
      p_motif_ids: [IDS.anxiete],
      p_accepting_new_clients: true,
      p_after_last_name: 'Tremblay',
      p_after_first_name: 'Marie',
      p_after_id: IDS.professional,
    })
  })

  it('uses the status-change cursor for the recent sort', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await fetchProfessionalsPage({ sort: 'recent', clienteleIds: [IDS.couples], acceptingNewClients: null }, last)
    expect(mocks.rpc).toHaveBeenCalledWith('list_professionals', {
      p_sort: 'recent',
      p_limit: PROFESSIONALS_PAGE_SIZE,
      p_clientele_ids: [IDS.couples],
      p_after_status_changed_at: '2026-10-08T12:00:00+00:00',
      p_after_id: IDS.professional,
    })
  })

  it('throws the RPC error unchanged', async () => {
    const error = { code: '22023', message: 'Statut inconnu.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchProfessionalsPage({ sort: 'name' }, null)).rejects.toBe(error)
  })
})
