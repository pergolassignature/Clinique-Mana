import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_PAGE_SIZE, fetchAuditActors, fetchAuditEntries, type AuditFilters } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const NO_FILTERS: AuditFilters = { table: null, actor: null, from: null }

const ROW = {
  id: 42,
  created_at: '2026-10-07T18:30:00+00:00',
  table_name: 'organizations',
  record_id: 'b0000000-0000-0000-0000-00000000000a',
  action: 'update',
  changed_fields: { neq: { before: null, after: '1234567890' } },
  actor_id: 'a0000000-0000-0000-0000-000000000001',
  actor_name: 'Marie Tremblay',
  actor_role: 'admin',
  source: 'app',
}

describe('fetchAuditEntries', () => {
  it('asks for the newest page with no filters', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW], error: null })
    await expect(fetchAuditEntries(NO_FILTERS, null)).resolves.toEqual([ROW])
    expect(AUDIT_PAGE_SIZE).toBe(50)
    expect(mocks.rpc).toHaveBeenCalledWith('list_audit_entries', { p_limit: 50 })
  })

  it('passes each filter, and the last id seen for the next page', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await fetchAuditEntries(
      { table: 'tax_rates', actor: 'a0000000-0000-0000-0000-000000000001', from: '2026-10-07T04:00:00.000Z' },
      42,
    )
    expect(mocks.rpc).toHaveBeenCalledWith('list_audit_entries', {
      p_table: 'tax_rates',
      p_actor: 'a0000000-0000-0000-0000-000000000001',
      p_from: '2026-10-07T04:00:00.000Z',
      p_before_id: 42,
      p_limit: 50,
    })
  })

  it('accepts rows written by the system: no actor, no name, no role, no fields', async () => {
    const row = { ...ROW, actor_id: null, actor_name: null, actor_role: null, changed_fields: null, source: 'seed' }
    mocks.rpc.mockResolvedValue({ data: [row], error: null })
    await expect(fetchAuditEntries(NO_FILTERS, null)).resolves.toEqual([row])
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : audit.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchAuditEntries(NO_FILTERS, null)).rejects.toBe(error)
  })
})

describe('fetchAuditActors', () => {
  it('lists the people who appear in the log', async () => {
    const actors = [{ actor_id: 'a1', actor_name: 'Marie Tremblay' }]
    mocks.rpc.mockResolvedValue({ data: actors, error: null })
    await expect(fetchAuditActors()).resolves.toEqual(actors)
    expect(mocks.rpc).toHaveBeenCalledWith('list_audit_actors')
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : audit.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchAuditActors()).rejects.toBe(error)
  })
})
