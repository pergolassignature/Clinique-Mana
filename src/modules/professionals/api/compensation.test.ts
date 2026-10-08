import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPENSATION_ROWS_MAX, fetchCompensationTerms, fetchProfessionalCompensation, setProfessionalMargin, setRecognitionRule } from './compensation'
import { IDS } from '../test/fixtures'
import { COMPENSATION_JSON, MARGIN_ROW_JSON } from '../test/fixtures-compensation'

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
  it('reads the terms in force and both series in parallel, scoped to the professional', async () => {
    mocks.rpc.mockResolvedValue({ data: COMPENSATION_JSON, error: null })
    const margins = builder({ data: [MARGIN_ROW_JSON], error: null })
    const levels = builder({ data: [], error: null })
    mocks.from.mockImplementation((table: string) => (table === 'professional_compensation' ? margins.chain : levels.chain))

    const data = await fetchProfessionalCompensation(IDS.professional)
    expect(mocks.rpc).toHaveBeenCalledWith('get_professional_compensation', { p_id: IDS.professional })
    expect(margins.calls).toContainEqual(['eq', ['professional_id', IDS.professional]])
    expect(margins.calls).toContainEqual(['limit', [COMPENSATION_ROWS_MAX]])
    expect(levels.calls).toContainEqual(['eq', ['professional_id', IDS.professional]])
    expect(data.margins[0]).toMatchObject({ kind: 'consultation', source: 'professional', marginPct: 28, min: 25, max: 30, effectiveFrom: '2026-11-01' })
    expect(data.recognition).toMatchObject({ level: 2, sessionsCounted: 117, rule: { capBasis: 'unconfirmed', capPct: 25 } })
    expect(data.marginRows).toEqual([
      { id: MARGIN_ROW_JSON.id, kind: 'consultation', marginPct: 28, effectiveFrom: '2026-11-01', effectiveTo: null, createdAt: MARGIN_ROW_JSON.created_at, note: null },
    ])
  })

  it('throws the first refusal (a 42501 without professionals.compensation)', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.compensation' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    mocks.from.mockImplementation(() => builder({ data: [], error: null }).chain)
    await expect(fetchProfessionalCompensation(IDS.professional)).rejects.toBe(error)
  })
})

describe('writes', () => {
  it('sends the margin’s date string unchanged and returns the range warning', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'm1', warning: true }, error: null })
    const result = await setProfessionalMargin(IDS.professional, { kind: 'consultation', marginPct: 35, effectiveFrom: '2026-11-01', note: null })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_margin', {
      p_id: IDS.professional,
      p_kind: 'consultation',
      p_margin_pct: 35,
      p_effective_from: '2026-11-01',
      p_note: null,
    })
    expect(result).toEqual({ id: 'm1', warning: true })
  })

  it('sends a recognition rule in cents', async () => {
    mocks.rpc.mockResolvedValue({ data: 'r1', error: null })
    await setRecognitionRule({ stepSessions: 50, bonusPer50MinCents: 50, bonusPer30MinCents: 25, capPct: 25, capBasis: 'unconfirmed', effectiveFrom: '2027-01-01', note: null })
    expect(mocks.rpc).toHaveBeenCalledWith('set_recognition_rule', {
      p_step_sessions: 50,
      p_bonus_per_50min_cents: 50,
      p_bonus_per_30min_cents: 25,
      p_cap_pct: 25,
      p_cap_basis: 'unconfirmed',
      p_effective_from: '2027-01-01',
      p_note: null,
    })
  })
})

describe('fetchCompensationTerms', () => {
  it('reads the defaults and the rules', async () => {
    const defaults = builder({
      data: [{ id: 'd1', kind: 'consultation', margin_min_pct: 25, margin_max_pct: 30, effective_from: '2017-01-01', effective_to: null, created_at: '2026-01-01T00:00:00Z' }],
      error: null,
    })
    const rules = builder({ data: [], error: null })
    mocks.from.mockImplementation((table: string) => (table === 'compensation_defaults' ? defaults.chain : rules.chain))
    const terms = await fetchCompensationTerms()
    expect(terms.defaults).toEqual([{ id: 'd1', kind: 'consultation', min: 25, max: 30, effectiveFrom: '2017-01-01', effectiveTo: null, createdAt: '2026-01-01T00:00:00Z' }])
    expect(terms.rules).toEqual([])
  })
})
