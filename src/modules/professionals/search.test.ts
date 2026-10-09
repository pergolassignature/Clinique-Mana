import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { PROFESSIONALS_SEARCH_LIMIT } from './api/search'
import { UNEXPECTED_SHAPE } from './api/parse'
import { professionalsManifest } from './manifest'
import { searchProfessionals, toSearchResult } from './search'

const mocks = vi.hoisted(() => {
  const abortSignal = vi.fn()
  const rpc = vi.fn(() => ({ abortSignal }))
  return { rpc, abortSignal }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const ROW = {
  id: 'p1',
  first_name: 'Geneviève',
  last_name: 'Tremblay',
  status: 'active',
  display_status: 'active',
  title_label: 'Psychologue',
  order_acronym: 'OPQ',
  licence_number: '12345-08',
}

describe('searchProfessionals', () => {
  it('asks search_professionals for at most 8, with the abort signal, and maps each row', async () => {
    mocks.abortSignal.mockResolvedValue({ data: [ROW], error: null })
    const signal = new AbortController().signal
    const results = await searchProfessionals('genevieve', signal)
    expect(mocks.rpc).toHaveBeenCalledWith('search_professionals', { p_query: 'genevieve', p_limit: PROFESSIONALS_SEARCH_LIMIT })
    expect(PROFESSIONALS_SEARCH_LIMIT).toBe(8)
    expect(mocks.abortSignal).toHaveBeenCalledWith(signal)
    expect(results).toEqual([
      {
        id: 'p1',
        title: 'Geneviève Tremblay',
        subtitle: 'Psychologue · OPQ 12345-08',
        href: '/professionnels/p1/apercu',
        badge: { label: t('modules.professionals.status.active'), tone: 'success' },
      },
    ])
  })

  it('throws the RPC error (a refusal included)', async () => {
    const error = { code: '42501', message: 'Permission refusée' }
    mocks.abortSignal.mockResolvedValue({ data: null, error })
    await expect(searchProfessionals('gen', new AbortController().signal)).rejects.toBe(error)
  })

  it('refuses an unexpected shape', async () => {
    mocks.abortSignal.mockResolvedValue({ data: [{ ...ROW, display_status: 'archived' }], error: null })
    await expect(searchProfessionals('gen', new AbortController().signal)).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('toSearchResult', () => {
  const row = {
    id: 'p9',
    firstName: 'Olivier',
    lastName: 'Bergeron',
    displayStatus: 'preparing' as const,
    titleLabel: null,
    orderAcronym: null,
    licenceNumber: null,
  }

  it('uses the list’s status wording (« En préparation », P4-43)', () => {
    expect(toSearchResult(row).badge?.label).toBe(t('modules.professionals.status.preparing'))
  })

  it('has no subtitle without a profession, and the licence alone without an order', () => {
    expect(toSearchResult(row)).not.toHaveProperty('subtitle')
    expect(toSearchResult({ ...row, titleLabel: 'Naturopathe', licenceNumber: 'N-1' }).subtitle).toBe('Naturopathe · N-1')
  })
})

describe('the manifest’s search provider', () => {
  it('is gated by professionals.view and loads the search code lazily', async () => {
    const [provider] = professionalsManifest.search ?? []
    expect(provider).toMatchObject({ id: 'professionals', labelKey: 'modules.professionals.name', permission: 'professionals.view', minChars: 2 })
    await expect(provider?.load()).resolves.toBe(searchProfessionals)
  })
})
