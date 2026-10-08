import type { ProfessionalCompensation } from '../api/compensation'
import type { ProfessionalPrivate } from '../api/private'
import { IDS } from './fixtures'

/**
 * Retention and private-data payloads (the RPCs and tables of 20261008170703), as JSON and as the
 * parsed domain values the cards read. Fake values only. Test-only.
 */

export const COMP_IDS = {
  rate: '00000000-0000-4000-8000-000000003001',
  previousRate: '00000000-0000-4000-8000-000000003002',
  month: '00000000-0000-4000-8000-000000003101',
  previousMonth: '00000000-0000-4000-8000-000000003102',
  agreement: '00000000-0000-4000-8000-000000003201',
  grid: '00000000-0000-4000-8000-000000003301',
  title: '00000000-0000-4000-8000-000000003401',
} as const

/** The month rows as `professional_session_counts` returns them (newest first). */
export const SESSION_ROW_JSON = {
  id: COMP_IDS.month,
  month: '2026-09-01',
  sessions_50_60: 20,
  sessions_30: 4,
  adjustment: 0,
  note: null,
  updated_at: '2026-10-02T14:00:00.123456+00:00',
}

/** `get_professional_compensation(P)` on 2026-10-08: 55,5 sessions, 28 % applied, 27,5 % suggested. */
export const COMPENSATION_JSON = {
  on: '2026-10-08',
  title: { id: COMP_IDS.title, name: 'Psychologue' },
  grid: {
    id: COMP_IDS.grid,
    effective_from: '2026-07-01',
    floor_pct: 25,
    tiers: [
      { threshold_sessions: 0, retention_pct: 28 },
      { threshold_sessions: 51, retention_pct: 27.5 },
      { threshold_sessions: 101, retention_pct: 27 },
    ],
  },
  sessions_total: 55.5,
  applied: { id: COMP_IDS.rate, retention_pct: 28, decision: 'initial', effective_from: '2026-07-01', tier_threshold: 0, note: null },
  previous_pct: null,
  in_force_pct: 28,
  suggested: { threshold_sessions: 51, retention_pct: 27.5 },
  next: { threshold_sessions: 101, retention_pct: 27 },
  status: 'gap',
  pay: [
    { duration: 60, client_price_cents: 20000, applied_cents: 14400, suggested_cents: 14500 },
    { duration: 50, client_price_cents: 17500, applied_cents: 12600, suggested_cents: 12688 },
    { duration: 30, client_price_cents: 13000, applied_cents: 9360, suggested_cents: 9425 },
  ],
  agreements: [],
  other_rates: [
    { kind: 'workshop', name: 'Ateliers et conférences', retention_pct: 25, effective_from: '2026-07-01' },
    { kind: 'late_cancellation', name: 'Annulation tardive', retention_pct: 30, effective_from: '2026-07-01' },
  ],
}

/**
 * On 2026-10-08 (the tests' clinic date): a psychologist with 55,5 sessions (July's opening
 * balance and September's sessions), 28 % applied since 2026-07-01 (entered long ago, not
 * deletable), 27,5 % suggested: « Écart à valider ». One client agreement, created today.
 */
export function compensationFixture(overrides: Partial<ProfessionalCompensation> = {}): ProfessionalCompensation {
  return {
    on: '2026-10-08',
    title: { id: COMP_IDS.title, name: 'Psychologue' },
    grid: {
      id: COMP_IDS.grid,
      effectiveFrom: '2026-07-01',
      floorPct: 25,
      tiers: [
        { threshold: 0, pct: 28 },
        { threshold: 51, pct: 27.5 },
        { threshold: 101, pct: 27 },
      ],
    },
    sessionsTotal: 55.5,
    applied: { id: COMP_IDS.rate, pct: 28, decision: 'initial', effectiveFrom: '2026-07-01', tierThreshold: 0, note: null },
    previousPct: null,
    inForcePct: 28,
    suggested: { threshold: 51, pct: 27.5 },
    next: { threshold: 101, pct: 27 },
    status: 'gap',
    pay: [
      { duration: 60, clientPriceCents: 20000, appliedCents: 14400, suggestedCents: 14500 },
      { duration: 50, clientPriceCents: 17500, appliedCents: 12600, suggestedCents: 12688 },
      { duration: 30, clientPriceCents: 13000, appliedCents: 9360, suggestedCents: 9425 },
    ],
    otherRates: [
      { kind: 'workshop', name: 'Ateliers et conférences', pct: 25, effectiveFrom: '2026-07-01' },
      { kind: 'late_cancellation', name: 'Annulation tardive', pct: 30, effectiveFrom: '2026-07-01' },
    ],
    rateRows: [
      {
        id: COMP_IDS.rate,
        pct: 28,
        decision: 'initial',
        tierThreshold: 0,
        suggestedPct: 28,
        sessionsTotal: 31.5,
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
        createdAt: '2026-07-01T12:00:00Z',
        note: null,
      },
    ],
    sessionRows: [
      { id: COMP_IDS.month, month: '2026-09-01', long: 20, short: 4, adjustment: 0, note: null, updatedAt: '2026-10-02T14:00:00.123456+00:00' },
      { id: COMP_IDS.previousMonth, month: '2026-07-01', long: 0, short: 0, adjustment: 33.5, note: 'Solde importé', updatedAt: '2026-07-01T12:00:00+00:00' },
    ],
    agreementRows: [
      {
        id: COMP_IDS.agreement,
        clientLabel: 'D-1042',
        duration: 50,
        professionalAmountCents: 8500,
        clientPriceCents: 12000,
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        createdAt: '2026-10-08T13:00:00Z',
        note: null,
      },
    ],
    ...overrides,
  }
}

export const PRIVATE_UPDATED_AT = '2026-10-08T17:07:03.123456+00:00'

/** Numbers, a SIN and an account stored. */
export function privateFixture(overrides: Partial<ProfessionalPrivate> = {}): ProfessionalPrivate {
  return {
    sinLast3: '286',
    businessNumber: '123456789',
    gstNumber: '123456789RT0001',
    qstNumber: '1234567890TQ0001',
    bankInstitution: '815',
    bankTransit: '30000',
    bankAccountLast4: '4567',
    updatedAt: PRIVATE_UPDATED_AT,
    updatedByName: 'Marie Tremblay',
    ...overrides,
  }
}

/** Nothing stored yet (the one row of nulls, P4-140). */
export const EMPTY_PRIVATE: ProfessionalPrivate = {
  sinLast3: null,
  businessNumber: null,
  gstNumber: null,
  qstNumber: null,
  bankInstitution: null,
  bankTransit: null,
  bankAccountLast4: null,
  updatedAt: null,
  updatedByName: null,
}

export { IDS }
