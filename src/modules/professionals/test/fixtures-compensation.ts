import type { ProfessionalCompensation } from '../api/compensation'
import type { ProfessionalPrivate } from '../api/private'
import { IDS } from './fixtures'

/**
 * Compensation and private-data payloads (4a.17's RPCs and tables), as JSON and as the parsed
 * domain values the cards read. Test-only.
 */

export const COMP_IDS = {
  margin: '00000000-0000-4000-8000-000000003001',
  previousMargin: '00000000-0000-4000-8000-000000003002',
  level: '00000000-0000-4000-8000-000000003101',
  rule: '00000000-0000-4000-8000-000000003201',
} as const

export const MARGIN_ROW_JSON = {
  id: COMP_IDS.margin,
  kind: 'consultation',
  margin_pct: 28,
  effective_from: '2026-11-01',
  effective_to: null,
  created_at: '2026-10-08T15:00:00+00:00',
  note: null,
}

/** `get_professional_compensation(P, '2026-12-01')`: a margin for Consultation, defaults elsewhere. */
export const COMPENSATION_JSON = {
  on: '2026-12-01',
  margins: [
    { kind: 'consultation', name: 'Consultation', source: 'professional', margin_pct: 28, min: 25, max: 30, effective_from: '2026-11-01', id: COMP_IDS.margin, note: null },
    { kind: 'workshop', name: 'Atelier', source: 'default', margin_pct: null, min: 25, max: 25, effective_from: '2017-01-01', id: null, note: null },
  ],
  recognition: {
    id: COMP_IDS.level,
    level: 2,
    sessions_counted: 117,
    effective_from: '2026-10-01',
    note: 'Compté dans GOrendezvous',
    rule: {
      id: COMP_IDS.rule,
      step_sessions: 50,
      bonus_per_50min_cents: 50,
      bonus_per_30min_cents: 25,
      cap_pct: 25,
      cap_basis: 'unconfirmed',
      effective_from: '2017-01-01',
    },
  },
}

const RULE = {
  id: COMP_IDS.rule,
  stepSessions: 50,
  bonusPer50MinCents: 50,
  bonusPer30MinCents: 25,
  capPct: 25,
  capBasis: 'unconfirmed' as const,
  effectiveFrom: '2017-01-01',
}

/**
 * On 2026-10-08 (the tests' clinic date): Consultation at the default range, a margin of 28 %
 * coming on 2026-11-01 (created today, so deletable); Atelier at its default; level 2 since
 * 2026-10-01, entered long ago (not deletable).
 */
export function compensationFixture(overrides: Partial<ProfessionalCompensation> = {}): ProfessionalCompensation {
  return {
    on: '2026-10-08',
    margins: [
      { kind: 'consultation', name: 'Consultation', source: 'default', marginPct: null, min: 25, max: 30, effectiveFrom: '2017-01-01', note: null },
      { kind: 'workshop', name: 'Atelier', source: 'default', marginPct: null, min: 25, max: 25, effectiveFrom: '2017-01-01', note: null },
    ],
    recognition: { level: 2, sessionsCounted: 117, effectiveFrom: '2026-10-01', note: 'Compté dans GOrendezvous', rule: RULE },
    marginRows: [
      { id: COMP_IDS.margin, kind: 'consultation', marginPct: 28, effectiveFrom: '2026-11-01', effectiveTo: null, createdAt: '2026-10-08T15:00:00Z', note: null },
    ],
    levelRows: [
      { id: COMP_IDS.level, level: 2, sessionsCounted: 117, effectiveFrom: '2026-10-01', effectiveTo: null, createdAt: '2026-01-01T00:00:00Z', note: 'Compté dans GOrendezvous' },
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
