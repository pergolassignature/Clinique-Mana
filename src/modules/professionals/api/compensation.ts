import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { parseRpc } from './parse'
import { sqlArgs } from './sql-args'

/**
 * Compensation terms (4a.17, `professionals.compensation`): what is in force for a professional
 * (`get_professional_compensation`, the read model 4d and Facturation share), the dated rows
 * behind it (read from the tables, RLS-scoped to the clinic), and the clinic's defaults and
 * recognition rules. Percents are `numeric(5, 2)` (JSON numbers), bonuses are cents, dates are
 * date-only `yyyy-MM-dd` strings (shown with `formatDateOnly*`, never through a timezone).
 */

/** Rows read per series. A professional has a handful; the cap only bounds the payload. */
export const COMPENSATION_ROWS_MAX = 200

export const CAP_BASES = ['unconfirmed', 'margin_reduction', 'fee_increase'] as const
export type CapBasis = (typeof CAP_BASES)[number]

const marginInForcePayload = z
  .object({
    kind: z.string(),
    name: z.string(),
    source: z.enum(['professional', 'default', 'none']),
    margin_pct: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    effective_from: z.string().nullable(),
    id: z.string().nullable(),
    note: z.string().nullable(),
  })
  .transform((m) => ({
    kind: m.kind,
    name: m.name,
    /** `professional`: the professional's margin; `default`: the clinic's range applies; `none`: neither. */
    source: m.source,
    marginPct: m.margin_pct,
    /** The default range in force, given even when the professional has a margin. */
    min: m.min,
    max: m.max,
    effectiveFrom: m.effective_from,
    note: m.note,
  }))
export type MarginInForce = z.output<typeof marginInForcePayload>

const rulePayload = z
  .object({
    id: z.string(),
    step_sessions: z.number(),
    bonus_per_50min_cents: z.number(),
    bonus_per_30min_cents: z.number(),
    cap_pct: z.number(),
    cap_basis: z.enum(CAP_BASES),
    effective_from: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    stepSessions: r.step_sessions,
    bonusPer50MinCents: r.bonus_per_50min_cents,
    bonusPer30MinCents: r.bonus_per_30min_cents,
    capPct: r.cap_pct,
    capBasis: r.cap_basis,
    effectiveFrom: r.effective_from,
  }))
export type RecognitionRuleInForce = z.output<typeof rulePayload>

const compensationPayload = z
  .object({
    on: z.string(),
    margins: z.array(marginInForcePayload),
    recognition: z.object({
      id: z.string().nullable(),
      level: z.number().nullable(),
      sessions_counted: z.number().nullable(),
      effective_from: z.string().nullable(),
      note: z.string().nullable(),
      rule: rulePayload.nullable(),
    }),
  })
  .transform(({ on, margins, recognition: r }) => ({
    on,
    margins,
    recognition: { level: r.level, sessionsCounted: r.sessions_counted, effectiveFrom: r.effective_from, note: r.note, rule: r.rule },
  }))

const datedColumns = { id: z.string(), effective_from: z.string(), effective_to: z.string().nullable(), created_at: z.string() }
const dated = (r: { id: string; effective_from: string; effective_to: string | null; created_at: string }) => ({
  id: r.id,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  createdAt: r.created_at,
})

const marginRowsPayload = z.array(
  z
    .object({ ...datedColumns, kind: z.string(), margin_pct: z.number(), note: z.string().nullable() })
    .transform((r) => ({ ...dated(r), kind: r.kind, marginPct: r.margin_pct, note: r.note })),
)
export type MarginRow = z.output<typeof marginRowsPayload>[number]

const levelRowsPayload = z.array(
  z
    .object({ ...datedColumns, level: z.number(), sessions_counted: z.number(), note: z.string().nullable() })
    .transform((r) => ({ ...dated(r), level: r.level, sessionsCounted: r.sessions_counted, note: r.note })),
)
export type LevelRow = z.output<typeof levelRowsPayload>[number]

const DATED = 'id, effective_from, effective_to, created_at'

/**
 * The « Rémunération » cards of a record in one cache entry: the terms in force on the clinic's
 * today and the professional's dated margins and levels, read in parallel.
 */
export async function fetchProfessionalCompensation(id: string) {
  const [inForce, margins, levels] = await Promise.all([
    supabase.rpc('get_professional_compensation', { p_id: id }),
    supabase
      .from('professional_compensation')
      .select(`${DATED}, kind, margin_pct, note`)
      .eq('professional_id', id)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
    supabase
      .from('professional_recognition')
      .select(`${DATED}, level, sessions_counted, note`)
      .eq('professional_id', id)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
  ])
  if (inForce.error) throw inForce.error
  if (margins.error) throw margins.error
  if (levels.error) throw levels.error
  return {
    ...parseRpc(compensationPayload, inForce.data),
    marginRows: parseRpc(marginRowsPayload, margins.data),
    levelRows: parseRpc(levelRowsPayload, levels.data),
  }
}
export type ProfessionalCompensation = Awaited<ReturnType<typeof fetchProfessionalCompensation>>

export interface MarginInput {
  kind: string
  marginPct: number
  /** `yyyy-MM-dd`, sent as typed. */
  effectiveFrom: string
  note: string | null
}

/** A new margin for a kind (closes the open one). `warning`: outside the default range on that date. */
export async function setProfessionalMargin(id: string, input: MarginInput): Promise<{ id: string; warning: boolean }> {
  const { data, error } = await supabase.rpc(
    'set_professional_margin',
    sqlArgs<'set_professional_margin'>({
      p_id: id,
      p_kind: input.kind,
      p_margin_pct: input.marginPct,
      p_effective_from: input.effectiveFrom,
      p_note: input.note,
    }),
  )
  if (error) throw error
  return parseRpc(z.object({ id: z.string(), warning: z.boolean() }), data)
}

export async function deleteProfessionalMargin(rowId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_professional_margin', { p_row_id: rowId })
  if (error) throw error
}

export interface LevelInput {
  level: number
  sessions: number
  effectiveFrom: string
  note: string | null
}

/** A new recognition level, entered by hand (P4-8): closes the open one. */
export async function setProfessionalRecognition(id: string, input: LevelInput): Promise<void> {
  const { error } = await supabase.rpc(
    'set_professional_recognition',
    sqlArgs<'set_professional_recognition'>({
      p_id: id,
      p_level: input.level,
      p_sessions: input.sessions,
      p_effective_from: input.effectiveFrom,
      p_note: input.note,
    }),
  )
  if (error) throw error
}

export async function deleteProfessionalRecognition(rowId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_professional_recognition', { p_row_id: rowId })
  if (error) throw error
}

// --- The clinic's terms (Paramètres → Rémunération) ------------------------------------------------

const kindsPayload = z.array(
  z.object({ key: z.string(), name: z.string(), sort_order: z.number() }).transform((k) => ({ key: k.key, name: k.name })),
)
export type CompensationKind = z.output<typeof kindsPayload>[number]

/** The kinds (global, changed by migration), in their order. */
export async function fetchCompensationKinds(): Promise<CompensationKind[]> {
  const { data, error } = await supabase.from('compensation_kinds').select('key, name, sort_order').order('sort_order').order('key')
  if (error) throw error
  return parseRpc(kindsPayload, data)
}

const defaultRowsPayload = z.array(
  z
    .object({ ...datedColumns, kind: z.string(), margin_min_pct: z.number(), margin_max_pct: z.number() })
    .transform((r) => ({ ...dated(r), kind: r.kind, min: r.margin_min_pct, max: r.margin_max_pct })),
)
export type DefaultRangeRow = z.output<typeof defaultRowsPayload>[number]

const ruleRowsPayload = z.array(
  z
    .object({
      ...datedColumns,
      step_sessions: z.number(),
      bonus_per_50min_cents: z.number(),
      bonus_per_30min_cents: z.number(),
      cap_pct: z.number(),
      cap_basis: z.enum(CAP_BASES),
      note: z.string().nullable(),
    })
    .transform((r) => ({
      ...dated(r),
      stepSessions: r.step_sessions,
      bonusPer50MinCents: r.bonus_per_50min_cents,
      bonusPer30MinCents: r.bonus_per_30min_cents,
      capPct: r.cap_pct,
      capBasis: r.cap_basis,
      note: r.note,
    })),
)
export type RecognitionRuleRow = z.output<typeof ruleRowsPayload>[number]

/** The clinic's dated default ranges and recognition rules, newest start first, read in parallel. */
export async function fetchCompensationTerms(): Promise<{ defaults: DefaultRangeRow[]; rules: RecognitionRuleRow[] }> {
  const [defaults, rules] = await Promise.all([
    supabase
      .from('compensation_defaults')
      .select(`${DATED}, kind, margin_min_pct, margin_max_pct`)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
    supabase
      .from('recognition_rules')
      .select(`${DATED}, step_sessions, bonus_per_50min_cents, bonus_per_30min_cents, cap_pct, cap_basis, note`)
      .order('effective_from', { ascending: false })
      .limit(COMPENSATION_ROWS_MAX),
  ])
  if (defaults.error) throw defaults.error
  if (rules.error) throw rules.error
  return { defaults: parseRpc(defaultRowsPayload, defaults.data), rules: parseRpc(ruleRowsPayload, rules.data) }
}

export interface DefaultRangeInput {
  kind: string
  min: number
  max: number
  effectiveFrom: string
}

export async function setCompensationDefault(input: DefaultRangeInput): Promise<void> {
  const { error } = await supabase.rpc('set_compensation_default', {
    p_kind: input.kind,
    p_min: input.min,
    p_max: input.max,
    p_effective_from: input.effectiveFrom,
  })
  if (error) throw error
}

export async function deleteCompensationDefault(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_compensation_default', { p_id: id })
  if (error) throw error
}

export interface RecognitionRuleInput {
  stepSessions: number
  bonusPer50MinCents: number
  bonusPer30MinCents: number
  capPct: number
  capBasis: CapBasis
  effectiveFrom: string
  note: string | null
}

export async function setRecognitionRule(input: RecognitionRuleInput): Promise<void> {
  const { error } = await supabase.rpc(
    'set_recognition_rule',
    sqlArgs<'set_recognition_rule'>({
      p_step_sessions: input.stepSessions,
      p_bonus_per_50min_cents: input.bonusPer50MinCents,
      p_bonus_per_30min_cents: input.bonusPer30MinCents,
      p_cap_pct: input.capPct,
      p_cap_basis: input.capBasis,
      p_effective_from: input.effectiveFrom,
      p_note: input.note,
    }),
  )
  if (error) throw error
}

export async function deleteRecognitionRule(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_recognition_rule', { p_id: id })
  if (error) throw error
}
