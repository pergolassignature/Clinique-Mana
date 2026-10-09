import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPENSATION_ROWS_MAX,
  decideRetention,
  fetchCompensationTerms,
  fetchProfessionalCompensation,
  fetchRetentionReview,
  recordMonthlySessions,
  setClientAgreement,
  setRetentionGrid,
} from './compensation'
import { UNEXPECTED_SHAPE } from './parse'
import { IDS } from '../test/fixtures'
import { COMPENSATION_JSON, SESSION_ROW_JSON } from '../test/fixtures-compensation'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))

afterEach(() => vi.clearAllMocks())

/** A PostgREST query builder that records its calls and resolves with `result`. */
function builder(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, args])
      return chain
    }
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(result)
  return { chain, calls }
}

describe('fetchProfessionalCompensation', () => {
  it('reads the state and the three series in parallel, scoped to the professional', async () => {
    mocks.rpc.mockResolvedValue({ data: COMPENSATION_JSON, error: null })
    const tables: Record<string, ReturnType<typeof builder>> = {
      professional_retention: builder({ data: [], error: null }),
      professional_session_counts: builder({ data: [SESSION_ROW_JSON], error: null }),
      professional_client_agreements: builder({ data: [], error: null }),
    }
    mocks.from.mockImplementation((table: string) => tables[table]?.chain)

    const data = await fetchProfessionalCompensation(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledWith('get_professional_compensation', { p_id: IDS.professional })
    for (const table of Object.values(tables)) {
      expect(table.calls).toContainEqual(['eq', ['professional_id', IDS.professional]])
      expect(table.calls).toContainEqual(['limit', [COMPENSATION_ROWS_MAX]])
    }
    expect(data).toMatchObject({
      status: 'gap',
      sessionsTotal: 55.5,
      applied: { pct: 28, decision: 'initial', effectiveFrom: '2026-07-01' },
      suggested: { threshold: 51, pct: 27.5 },
      next: { threshold: 101, pct: 27 },
      grid: { floorPct: 25, tiers: [{ threshold: 0, pct: 28 }, { threshold: 51, pct: 27.5 }, { threshold: 101, pct: 27 }] },
    })
    expect(data.pay[1]).toEqual({ duration: 50, clientPriceCents: 17500, appliedCents: 12600, suggestedCents: 12688, upcomingCents: null })
    expect(data.sessionRows).toEqual([
      { id: SESSION_ROW_JSON.id, month: '2026-09-01', long: 20, short: 4, adjustment: 0, note: null, updatedAt: SESSION_ROW_JSON.updated_at },
    ])
  })

  it('throws the first refusal (a 42501 without professionals.compensation)', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.compensation' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    mocks.from.mockImplementation(() => builder({ data: [], error: null }).chain)
    await expect(fetchProfessionalCompensation(IDS.professional)).rejects.toBe(error)
  })

  it('refuses an unknown status without quoting the payload', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...COMPENSATION_JSON, status: 'secret' }, error: null })
    mocks.from.mockImplementation(() => builder({ data: [], error: null }).chain)
    await expect(fetchProfessionalCompensation(IDS.professional)).rejects.toThrow(UNEXPECTED_SHAPE)
  })

  it('reads « no_rate », a starting rate to fix (P4-197)', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...COMPENSATION_JSON, applied: null, status: 'no_rate' }, error: null })
    mocks.from.mockImplementation(() => builder({ data: [], error: null }).chain)
    await expect(fetchProfessionalCompensation(IDS.professional)).resolves.toMatchObject({ status: 'no_rate', applied: null })
  })
})

describe('writes', () => {
  it('sends a month’s sessions with the version read; absent adjustment and note stay absent', async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null })
    await recordMonthlySessions('2026-09-01', [{ professionalId: IDS.professional, long: 12, short: 2, expectedUpdatedAt: null }])
    expect(mocks.rpc).toHaveBeenCalledWith('record_monthly_sessions', {
      p_month: '2026-09-01',
      p_entries: [{ professional_id: IDS.professional, sessions_50_60: 12, sessions_30: 2, expected_updated_at: null }],
    })
  })

  it('sends a decision and reads whether the rate went down', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'r1', retention_pct: 27.5, decreased: true }, error: null })
    const result = await decideRetention(IDS.professional, {
      decision: 'suggested',
      pct: null,
      effectiveFrom: '2026-11-01',
      note: null,
      countMonth: '2026-10-01',
      expectedOpenId: 'r0',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('decide_retention', {
      p_id: IDS.professional,
      p_decision: 'suggested',
      p_retention_pct: null,
      p_effective_from: '2026-11-01',
      p_note: null,
      p_count_month: '2026-10-01',
      p_expected_open_id: 'r0',
    })
    expect(result).toEqual({ id: 'r1', pct: 27.5, decreased: true })
  })

  it('sends an agreement in cents', async () => {
    mocks.rpc.mockResolvedValue({ data: 'a1', error: null })
    await setClientAgreement(IDS.professional, { clientLabel: 'D-1042', duration: 50, professionalAmountCents: 8500, clientPriceCents: 12000, effectiveFrom: '2026-10-01', note: null })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_client_agreement', {
      p_id: IDS.professional,
      p_client_label: 'D-1042',
      p_duration: 50,
      p_professional_amount_cents: 8500,
      p_client_price_cents: 12000,
      p_effective_from: '2026-10-01',
      p_note: null,
    })
  })

  it('sends a grid version with the RPC’s keys', async () => {
    mocks.rpc.mockResolvedValue({ data: 'g1', error: null })
    await setRetentionGrid({
      titleId: 't1',
      effectiveFrom: '2027-01-01',
      tiers: [
        { threshold: 0, pct: 28 },
        { threshold: 51, pct: 27.5 },
      ],
      prices: [{ duration: 50, clientPriceCents: 17500 }],
      note: null,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('set_retention_grid', {
      p_title_id: 't1',
      p_effective_from: '2027-01-01',
      p_tiers: [
        { threshold_sessions: 0, retention_pct: 28 },
        { threshold_sessions: 51, retention_pct: 27.5 },
      ],
      p_prices: [{ duration: 50, client_price_cents: 17500 }],
      p_note: null,
    })
  })
})

describe('fetchCompensationTerms', () => {
  it('reads the grids with their tiers and prices (sorted) and the other rates', async () => {
    const grids = builder({
      data: [
        {
          id: 'g1',
          title_id: 't1',
          effective_from: '2026-07-01',
          effective_to: null,
          created_at: '2026-07-01T00:00:00Z',
          note: null,
          retention_grid_tiers: [
            { threshold_sessions: 51, retention_pct: 27.5 },
            { threshold_sessions: 0, retention_pct: 28 },
          ],
          retention_grid_prices: [
            { duration: 30, client_price_cents: 13000 },
            { duration: 60, client_price_cents: 20000 },
          ],
        },
      ],
      error: null,
    })
    const rates = builder({ data: [{ id: 'c1', kind: 'workshop', retention_pct: 25, effective_from: '2026-07-01', effective_to: null, created_at: '2026-07-01T00:00:00Z' }], error: null })
    mocks.from.mockImplementation((table: string) => (table === 'retention_grids' ? grids.chain : rates.chain))
    const terms = await fetchCompensationTerms()
    expect(terms.grids[0]).toMatchObject({
      titleId: 't1',
      tiers: [
        { threshold: 0, pct: 28 },
        { threshold: 51, pct: 27.5 },
      ],
      prices: [
        { duration: 60, clientPriceCents: 20000 },
        { duration: 30, clientPriceCents: 13000 },
      ],
    })
    expect(terms.rates).toEqual([{ id: 'c1', kind: 'workshop', pct: 25, effectiveFrom: '2026-07-01', effectiveTo: null, createdAt: '2026-07-01T00:00:00Z' }])
  })
})

describe('fetchRetentionReview', () => {
  it('reads one month in one call', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        month: '2026-09-01',
        on: '2026-10-01',
        rows: [
          {
            id: IDS.professional,
            first_name: 'Paul',
            last_name: 'Un',
            title_name: 'Travailleuse sociale ou travailleur social',
            title_label: 'Travailleuse sociale',
            entry: { sessions_50_60: 20, sessions_30: 4, adjustment: 0, note: null, updated_at: '2026-10-02T14:00:00Z' },
            sessions_before: 33.5,
            floor_pct: 25,
            increase_decided: false,
            agreements: 1,
            ...Object.fromEntries(['sessions_total', 'applied', 'previous_pct', 'in_force_pct', 'suggested', 'next', 'status', 'pay'].map((k) => [k, COMPENSATION_JSON[k as keyof typeof COMPENSATION_JSON]])),
          },
        ],
      },
      error: null,
    })
    const review = await fetchRetentionReview('2026-09-01')
    expect(mocks.rpc).toHaveBeenCalledWith('list_retention_review', { p_month: '2026-09-01' })
    expect(review.rows[0]).toMatchObject({ firstName: 'Paul', titleLabel: 'Travailleuse sociale', sessionsBefore: 33.5, entry: { long: 20, short: 4 }, agreements: 1, status: 'gap' })
  })
})
