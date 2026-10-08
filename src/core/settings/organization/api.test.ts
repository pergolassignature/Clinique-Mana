import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOrganization, ORGANIZATION_COLUMNS, setOrgAsset, updateOrganization, type OrganizationUpdate } from './api'

const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const updateSelect = vi.fn()
  const eq = vi.fn(() => ({ select: updateSelect }))
  const select = vi.fn(() => ({ single }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select, update }))
  const rpc = vi.fn()
  return { from, select, single, update, eq, updateSelect, rpc }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const ROW = { id: 'o1', name: 'Clinique MANA', neq: '1234567890' }

describe('ORGANIZATION_COLUMNS', () => {
  it('reads the profile columns, never created_at', () => {
    expect(ORGANIZATION_COLUMNS.split(', ')).toEqual([
      'id', 'name', 'timezone', 'default_locale', 'currency', 'legal_name', 'neq', 'address_line1', 'address_line2',
      'city', 'province', 'postal_code', 'country', 'phone', 'email', 'website', 'gst_number', 'qst_number',
      'signatory_name', 'signatory_title', 'signatory_email', 'logo_file_id', 'signature_file_id', 'privacy_officer_name', 'privacy_officer_email', 'privacy_policy_url',
      'record_retention_years', 'updated_at',
    ])
  })
})

describe('fetchOrganization', () => {
  it("selects the caller's organization as a single row", async () => {
    mocks.single.mockResolvedValue({ data: ROW, error: null })
    await expect(fetchOrganization()).resolves.toBe(ROW)
    expect(mocks.from).toHaveBeenCalledWith('organizations')
    expect(mocks.select).toHaveBeenCalledWith(ORGANIZATION_COLUMNS)
    expect(mocks.single).toHaveBeenCalled()
  })

  it('throws the query error', async () => {
    const error = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
    mocks.single.mockResolvedValue({ data: null, error })
    await expect(fetchOrganization()).rejects.toBe(error)
  })
})

describe('updateOrganization', () => {
  it('updates the row by id and returns the saved organization', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [ROW], error: null })
    await expect(updateOrganization('o1', { neq: '1234567890' })).resolves.toBe(ROW)
    expect(mocks.from).toHaveBeenCalledWith('organizations')
    expect(mocks.update).toHaveBeenCalledWith({ neq: '1234567890' })
    expect(mocks.eq).toHaveBeenCalledWith('id', 'o1')
    expect(mocks.updateSelect).toHaveBeenCalledWith(ORGANIZATION_COLUMNS)
  })

  it('throws the database error (check violation)', async () => {
    const error = { code: '23514', message: 'new row for relation "organizations" violates check constraint "organizations_neq_check"' }
    mocks.updateSelect.mockResolvedValue({ data: null, error })
    await expect(updateOrganization('o1', { neq: '123' })).rejects.toBe(error)
  })

  it('throws a permission error (42501) when RLS updated no row', async () => {
    // Without settings.manage the update policy filters the row out: no error, zero rows.
    mocks.updateSelect.mockResolvedValue({ data: [], error: null })
    const result = updateOrganization('o1', { name: 'X' })
    await expect(result).rejects.toBeInstanceOf(Error)
    await expect(result).rejects.toMatchObject({ code: '42501', message: 'no row updated' })
  })

  it('only accepts the columns a card may write (type-level)', () => {
    const refused: OrganizationUpdate[] = [
      // @ts-expect-error country has no update grant: sending it raises 42501.
      { country: 'US' },
      // @ts-expect-error default_locale stays read-only until a second locale exists.
      { default_locale: 'en-CA' },
      // @ts-expect-error currency stays read-only until a second currency exists.
      { currency: 'USD' },
      // @ts-expect-error the primary key is never written.
      { id: 'o2' },
      // @ts-expect-error updated_at is set by the database.
      { updated_at: '2026-10-07T12:00:00Z' },
      // @ts-expect-error the logo changes only through set_org_asset.
      { logo_file_id: 'f1' },
      // @ts-expect-error the signature image changes only through set_org_asset.
      { signature_file_id: 'f1' },
    ]
    expect(refused).toHaveLength(7)
  })
})

describe('setOrgAsset', () => {
  it('sets the logo or the signature image through set_org_asset', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await setOrgAsset('logo', 'f1')
    expect(mocks.rpc).toHaveBeenCalledWith('set_org_asset', { p_kind: 'logo', p_file_id: 'f1' })
  })

  it('« Retirer » sends a null file', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await setOrgAsset('signature', null)
    expect(mocks.rpc).toHaveBeenCalledWith('set_org_asset', { p_kind: 'signature', p_file_id: null })
  })

  it('throws the RPC error', async () => {
    const error = { code: 'P0001', message: 'Fichier introuvable.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setOrgAsset('logo', 'f1')).rejects.toBe(error)
  })
})
