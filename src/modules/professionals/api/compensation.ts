import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { parseRpc } from './parse'
import { sqlArgs } from './sql-args'

/**
 * The retention program (P4-180…P4-194, `professionals.compensation`): what a professional has
 * (`get_professional_compensation`, the read model 4d and Facturation share), the dated rows behind
 * it (read from the tables, RLS-scoped to the clinic), the monthly review
 * (`list_retention_review`) and the clinic's grids and other rates. Percents are `numeric(5, 2)`
 * and session counts `numeric` (JSON numbers), money is cents, dates are date-only `yyyy-MM-dd`
 * strings (shown with `formatDateOnly*`, never through a timezone). Every amount is computed by the
 * database: the page only shows it.
 */

/** Rows read per series. A professional has a handful; the cap only bounds the payload. */
export const COMPENSATION_ROWS_MAX = 200

/** The grid's services: « 60 min / couple », « 50 min », « 30 min ». */
export const DURATIONS = [60, 50, 30] as const
export type Duration = (typeof DURATIONS)[number]
const duration = z.union([z.literal(60), z.literal(50), z.literal(30)])

/** How the applied rate was set (P4-187). */
export const DECISIONS = ['initial', 'suggested', 'maintained', 'custom'] as const
export type Decision = (typeof DECISIONS)[number]

/** P4-188: computed by `private.retention_overview`. */
export const RETENTION_STATUSES = ['gap', 'conforme', 'floor', 'maintained', 'custom', 'profession_unconfirmed'] as const
export type RetentionStatus = (typeof RETENTION_STATUSES)[number]

const tierPayload = z
  .object({ threshold_sessions: z.number(), retention_pct: z.number() })
  .transform((t) => ({ threshold: t.threshold_sessions, pct: t.retention_pct }))
export type Tier = z.output<typeof tierPayload>

const appliedPayload = z
  .object({
    id: z.string(),
    retention_pct: z.number(),
    decision: z.enum(DECISIONS),
    effective_from: z.string(),
    tier_threshold: z.number().nullable(),
    note: z.string().nullable(),
  })
  .transform((a) => ({ id: a.id, pct: a.retention_pct, decision: a.decision, effectiveFrom: a.effective_from, tierThreshold: a.tier_threshold, note: a.note }))
export type AppliedRate = z.output<typeof appliedPayload>

/**
 * Pay per session for one duration (P4-189): `appliedCents` at the rate in force on the read's
 * date (what Facturation pays that day, P4-151), `upcomingCents` at the latest decision when it
 * starts later (null otherwise), `suggestedCents` at the grid's suggestion.
 */
const payPayload = z
  .object({
    duration,
    client_price_cents: z.number(),
    applied_cents: z.number().nullable(),
    suggested_cents: z.number().nullable(),
    upcoming_cents: z.number().nullable(),
  })
  .transform((p) => ({
    duration: p.duration,
    clientPriceCents: p.client_price_cents,
    appliedCents: p.applied_cents,
    suggestedCents: p.suggested_cents,
    upcomingCents: p.upcoming_cents,
  }))
export type PayLine = z.output<typeof payPayload>

/** What both read models say about one professional's retention. */
const stateColumns = {
  sessions_total: z.number(),
  applied: appliedPayload.nullable(),
  previous_pct: z.number().nullable(),
  in_force_pct: z.number().nullable(),
  suggested: tierPayload.nullable(),
  next: tierPayload.nullable(),
  status: z.enum(RETENTION_STATUSES),
  pay: z.array(payPayload),
}
const state = (s: {
  sessions_total: number
  applied: AppliedRate | null
  previous_pct: number | null
  in_force_pct: number | null
  suggested: Tier | null
  next: Tier | null
  status: RetentionStatus
  pay: PayLine[]
}) => ({
  sessionsTotal: s.sessions_total,
  applied: s.applied,
  previousPct: s.previous_pct,
  inForcePct: s.in_force_pct,
  suggested: s.suggested,
  next: s.next,
  status: s.status,
  pay: s.pay,
})
export type RetentionState = ReturnType<typeof state>

const compensationPayload = z
  .object({
    on: z.string(),
    title: z.object({ id: z.string(), name: z.string() }).nullable(),
    grid: z
      .object({ id: z.string(), effective_from: z.string(), floor_pct: z.number().nullable(), tiers: z.array(tierPayload) })
      .transform((g) => ({ id: g.id, effectiveFrom: g.effective_from, floorPct: g.floor_pct, tiers: g.tiers }))
      .nullable(),
    ...stateColumns,
    other_rates: z.array(
      z
        .object({ kind: z.string(), name: z.string(), retention_pct: z.number().nullable(), effective_from: z.string().nullable() })
        .transform((r) => ({ kind: r.kind, name: r.name, pct: r.retention_pct, effectiveFrom: r.effective_from })),
    ),
  })
  .transform(({ on, title, grid, other_rates, ...rest }) => ({ on, title, grid, otherRates: other_rates, ...state(rest) }))

const datedColumns = { id: z.string(), effective_from: z.string(), effective_to: z.string().nullable(), created_at: z.string() }
const dated = (r: { id: string; effective_from: string; effective_to: string | null; created_at: string }) => ({
  id: r.id,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  createdAt: r.created_at,
})

const retentionRowsPayload = z.array(
  z
    .object({
      ...datedColumns,
      retention_pct: z.number(),
      decision: z.enum(DECISIONS),
      tier_threshold: z.number().nullable(),
      suggested_pct: z.number().nullable(),
      sessions_total: z.number().nullable(),
      note: z.string().nullable(),
    })
    .transform((r) => ({
      ...dated(r),
      pct: r.retention_pct,
      decision: r.decision,
      tierThreshold: r.tier_threshold,
      suggestedPct: r.suggested_pct,
      sessionsTotal: r.sessions_total,
      note: r.note,
    })),
)
export type RetentionRow = z.output<typeof retentionRowsPayload>[number]

const sessionRowsPayload = z.array(
  z
    .object({
      id: z.string(),
      month: z.string(),
      sessions_50_60: z.number(),
      sessions_30: z.number(),
      adjustment: z.number(),
      note: z.string().nullable(),
      updated_at: z.string(),
    })
    .transform((r) => ({
      id: r.id,
      month: r.month,
      long: r.sessions_50_60,
      short: r.sessions_30,
      adjustment: r.adjustment,
      note: r.note,
      updatedAt: r.updated_at,
    })),
)
export type SessionRow = z.output<typeof sessionRowsPayload>[number]

const agreementRowsPayload = z.array(
  z
    .object({
      ...datedColumns,
      client_label: z.string(),
      duration,
      professional_amount_cents: z.number(),
      client_price_cents: z.number(),
      note: z.string().nullable(),
    })
    .transform((r) => ({
      ...dated(r),
      clientLabel: r.client_label,
      duration: r.duration,
      professionalAmountCents: r.professional_amount_cents,
      clientPriceCents: r.client_price_cents,
      note: r.note,
    })),
)
export type AgreementRow = z.output<typeof agreementRowsPayload>[number]

const DATED = 'id, effective_from, effective_to, created_at'

/**
 * The « Rétention » card of a record in one cache entry: the state on the clinic's today and the
 * professional's dated rates, months and client agreements, read in parallel.
 */
export async function fetchProfessionalCompensation(id: string) {
  const [inForce, rates, months, agreements] = await Promise.all([
    supabase.rpc('get_professional_compensation', { p_id: id }),
    supabase
      .from('professional_retention')
      .select(`${DATED}, retention_pct, decision, tier_threshold, suggested_pct, sessions_total, note`)
      .eq('professional_id', id)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
    supabase
      .from('professional_session_counts')
      .select('id, month, sessions_50_60, sessions_30, adjustment, note, updated_at')
      .eq('professional_id', id)
      .order('month', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
    supabase
      .from('professional_client_agreements')
      .select(`${DATED}, client_label, duration, professional_amount_cents, client_price_cents, note`)
      .eq('professional_id', id)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
  ])
  if (inForce.error) throw inForce.error
  if (rates.error) throw rates.error
  if (months.error) throw months.error
  if (agreements.error) throw agreements.error
  return {
    ...parseRpc(compensationPayload, inForce.data),
    rateRows: parseRpc(retentionRowsPayload, rates.data),
    sessionRows: parseRpc(sessionRowsPayload, months.data),
    agreementRows: parseRpc(agreementRowsPayload, agreements.data),
  }
}
export type ProfessionalCompensation = Awaited<ReturnType<typeof fetchProfessionalCompensation>>

// --- Sessions -------------------------------------------------------------------------------------

export interface SessionEntryInput {
  professionalId: string
  long: number
  short: number
  /** Omitted: the month's stored adjustment is kept. */
  adjustment?: number
  /** Omitted: the month's stored note is kept. */
  note?: string | null
  /** The month's `updated_at` as read, or null when the month had no row (P4-186). */
  expectedUpdatedAt: string | null
}

/** One month's sessions for one professional or many, all or nothing. `month`: `yyyy-MM-01`. */
export async function recordMonthlySessions(month: string, entries: readonly SessionEntryInput[]): Promise<void> {
  const { error } = await supabase.rpc('record_monthly_sessions', {
    p_month: month,
    p_entries: entries.map((e) => ({
      professional_id: e.professionalId,
      sessions_50_60: e.long,
      sessions_30: e.short,
      ...(e.adjustment === undefined ? {} : { adjustment: e.adjustment }),
      ...(e.note === undefined ? {} : { note: e.note }),
      expected_updated_at: e.expectedUpdatedAt,
    })),
  })
  if (error) throw error
}

// --- Decisions --------------------------------------------------------------------------------------

export interface DecisionInput {
  decision: Decision
  /** For `initial` and `custom` only; the others are computed. */
  pct: number | null
  effectiveFrom: string
  note: string | null
  /**
   * The month the count runs through (`yyyy-MM-01`): the reviewed month from « Révision
   * mensuelle », the clinic's current month from the record. The suggestion is computed from it,
   * so what is applied is what the dialog showed (P4-187).
   */
  countMonth: string
  /** The open decision as read (null when there was none): another change since then is refused, HINT `stale`. */
  expectedOpenId: string | null
}

/** `decreased`: the rate went down (an « augmentation » for the professional). */
export async function decideRetention(id: string, input: DecisionInput): Promise<{ id: string; pct: number; decreased: boolean }> {
  const { data, error } = await supabase.rpc(
    'decide_retention',
    sqlArgs<'decide_retention'>({
      p_id: id,
      p_decision: input.decision,
      p_retention_pct: input.pct,
      p_effective_from: input.effectiveFrom,
      p_note: input.note,
      p_count_month: input.countMonth,
      p_expected_open_id: input.expectedOpenId,
    }),
  )
  if (error) throw error
  return parseRpc(
    z.object({ id: z.string(), retention_pct: z.number(), decreased: z.boolean() }).transform((r) => ({ id: r.id, pct: r.retention_pct, decreased: r.decreased })),
    data,
  )
}

export async function deleteProfessionalRetention(rowId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_professional_retention', { p_row_id: rowId })
  if (error) throw error
}

// --- Client agreements -----------------------------------------------------------------------------

export interface AgreementInput {
  clientLabel: string
  duration: Duration
  professionalAmountCents: number
  clientPriceCents: number
  effectiveFrom: string
  note: string | null
}

export async function setClientAgreement(id: string, input: AgreementInput): Promise<void> {
  const { error } = await supabase.rpc(
    'set_professional_client_agreement',
    sqlArgs<'set_professional_client_agreement'>({
      p_id: id,
      p_client_label: input.clientLabel,
      p_duration: input.duration,
      p_professional_amount_cents: input.professionalAmountCents,
      p_client_price_cents: input.clientPriceCents,
      p_effective_from: input.effectiveFrom,
      p_note: input.note,
    }),
  )
  if (error) throw error
}

/** Ends an agreement on `effectiveTo` (exclusive), or reopens it with null. */
export async function endClientAgreement(rowId: string, effectiveTo: string | null): Promise<void> {
  const { error } = await supabase.rpc('end_professional_client_agreement', sqlArgs<'end_professional_client_agreement'>({ p_row_id: rowId, p_effective_to: effectiveTo }))
  if (error) throw error
}

export async function deleteClientAgreement(rowId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_professional_client_agreement', { p_row_id: rowId })
  if (error) throw error
}

// --- « Révision mensuelle » ---------------------------------------------------------------------------

const reviewRowPayload = z
  .object({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    title_name: z.string().nullable(),
    entry: z
      .object({ sessions_50_60: z.number(), sessions_30: z.number(), adjustment: z.number(), note: z.string().nullable(), updated_at: z.string() })
      .transform((e) => ({ long: e.sessions_50_60, short: e.sessions_30, adjustment: e.adjustment, note: e.note, updatedAt: e.updated_at }))
      .nullable(),
    sessions_before: z.number(),
    floor_pct: z.number().nullable(),
    increase_decided: z.boolean(),
    agreements: z.number(),
    ...stateColumns,
  })
  .transform(({ id, first_name, last_name, title_name, entry, sessions_before, floor_pct, increase_decided, agreements, ...rest }) => ({
    id,
    firstName: first_name,
    lastName: last_name,
    titleName: title_name,
    entry,
    sessionsBefore: sessions_before,
    floorPct: floor_pct,
    increaseDecided: increase_decided,
    agreements,
    ...state(rest),
  }))
export type ReviewRow = z.output<typeof reviewRowPayload>

const reviewPayload = z.object({ month: z.string(), on: z.string(), rows: z.array(reviewRowPayload) })
export type RetentionReview = z.output<typeof reviewPayload>

/** Every active professional for one month (`yyyy-MM-01`), in one read. */
export async function fetchRetentionReview(month: string): Promise<RetentionReview> {
  const { data, error } = await supabase.rpc('list_retention_review', { p_month: month })
  if (error) throw error
  return parseRpc(reviewPayload, data)
}

// --- The clinic's terms (Paramètres → Rémunération) ------------------------------------------------

const kindsPayload = z.array(
  z.object({ key: z.string(), name: z.string(), sort_order: z.number() }).transform((k) => ({ key: k.key, name: k.name })),
)
export type CompensationKind = z.output<typeof kindsPayload>[number]

/** The other kinds (global, changed by migration), in their order. */
export async function fetchCompensationKinds(): Promise<CompensationKind[]> {
  const { data, error } = await supabase.from('compensation_kinds').select('key, name, sort_order').order('sort_order').order('key')
  if (error) throw error
  return parseRpc(kindsPayload, data)
}

const rateRowsPayload = z.array(
  z.object({ ...datedColumns, kind: z.string(), retention_pct: z.number() }).transform((r) => ({ ...dated(r), kind: r.kind, pct: r.retention_pct })),
)
export type RateRow = z.output<typeof rateRowsPayload>[number]

const gridRowsPayload = z.array(
  z
    .object({
      ...datedColumns,
      title_id: z.string(),
      note: z.string().nullable(),
      retention_grid_tiers: z.array(tierPayload),
      retention_grid_prices: z.array(
        z.object({ duration, client_price_cents: z.number() }).transform((p) => ({ duration: p.duration, clientPriceCents: p.client_price_cents })),
      ),
    })
    .transform((g) => ({
      ...dated(g),
      titleId: g.title_id,
      note: g.note,
      tiers: [...g.retention_grid_tiers].sort((a, b) => a.threshold - b.threshold),
      prices: [...g.retention_grid_prices].sort((a, b) => b.duration - a.duration),
    })),
)
export type GridRow = z.output<typeof gridRowsPayload>[number]

/** The clinic's dated grids (with their tiers and prices) and other rates, newest start first. */
export async function fetchCompensationTerms(): Promise<{ grids: GridRow[]; rates: RateRow[] }> {
  const [grids, rates] = await Promise.all([
    supabase
      .from('retention_grids')
      .select(`${DATED}, title_id, note, retention_grid_tiers(threshold_sessions, retention_pct), retention_grid_prices(duration, client_price_cents)`)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
    supabase
      .from('compensation_rates')
      .select(`${DATED}, kind, retention_pct`)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
  ])
  if (grids.error) throw grids.error
  if (rates.error) throw rates.error
  return { grids: parseRpc(gridRowsPayload, grids.data), rates: parseRpc(rateRowsPayload, rates.data) }
}

export interface RateInput {
  kind: string
  pct: number
  effectiveFrom: string
}

export async function setCompensationRate(input: RateInput): Promise<void> {
  const { error } = await supabase.rpc('set_compensation_rate', { p_kind: input.kind, p_retention_pct: input.pct, p_effective_from: input.effectiveFrom })
  if (error) throw error
}

export async function deleteCompensationRate(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_compensation_rate', { p_id: id })
  if (error) throw error
}

export interface GridInput {
  titleId: string
  effectiveFrom: string
  tiers: readonly Tier[]
  prices: readonly { duration: Duration; clientPriceCents: number }[]
  note: string | null
}

export async function setRetentionGrid(input: GridInput): Promise<void> {
  const { error } = await supabase.rpc(
    'set_retention_grid',
    sqlArgs<'set_retention_grid'>({
      p_title_id: input.titleId,
      p_effective_from: input.effectiveFrom,
      p_tiers: input.tiers.map((tier) => ({ threshold_sessions: tier.threshold, retention_pct: tier.pct })),
      p_prices: input.prices.map((price) => ({ duration: price.duration, client_price_cents: price.clientPriceCents })),
      p_note: input.note,
    }),
  )
  if (error) throw error
}

export async function deleteRetentionGrid(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_retention_grid', { p_id: id })
  if (error) throw error
}
