import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * Rapports « Indicateurs des demandes » (Demandes D6): `report_demandes(from, to)` (reports.view;
 * Demandes enabled), the intake indicators of the workbook (§8.3), the sources of D3c, the
 * waiting list and D5's photos. One answer for the whole page; each tab shows part of it.
 */

const count = z.number().int()
const decimal = z.number().nullable()
const name = z.string().nullable()
const id = z.string().nullable()
const stat = z.object({ count, median: decimal, average: decimal })
const range = z.object({ average: decimal, min: decimal, max: decimal })
const sourceRow = { received: count, matched: count }
const period = { received: count, matched: count, first_cancelled: count }

const schema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    received: count,
    duplicates: count,
    matched_activity: count,
    activity_rate: decimal,
    matched_cohort: count,
    cohort_rate: decimal,
    contacted_on_time: count,
    contacted_late: count,
    pending: count,
    overdue: count,
    no_attempt: count,
    waitlisted: count,
  }),
  weeks: z.array(z.object({ week_start: z.string(), ...period })),
  months: z.array(z.object({ month_start: z.string(), ...period })),
  by_channel: z.array(z.object({ channel: z.string(), ...sourceRow })),
  by_counselor: z.array(z.object({ id, name, received: count })),
  outcomes: z.array(z.object({ state: z.string(), closed_reason: name, count })),
  by_professional: z.array(z.object({ id, name, matched: count })),
  by_professional_week: z.array(z.object({ week_start: z.string(), id, name, matched: count })),
  by_clientele: z.array(z.object({ id, name, matched: count })),
  by_source: z.array(z.object({ id, name, ...sourceRow })),
  by_campaign: z.array(z.object({ name, other: z.boolean(), ...sourceRow })),
  by_utm: z.array(z.object({ source: name, medium: name, other: z.boolean(), ...sourceRow })),
  by_referrer: z.array(z.object({ host: name, other: z.boolean(), ...sourceRow })),
  delays: z.object({ first_contact_hours: stat, proposal_days: stat, match_days: stat }),
  first_appointments: z.object({
    matched: count,
    cancelled: count,
    rate: decimal,
    notice_hours: range,
    lead_days: range,
    by_reason: z.array(z.object({ name, count })),
    by_professional: z.array(z.object({ id, name, count })),
  }),
  waitlist: z.object({
    open: z.array(z.object({ target_kind: z.enum(['title', 'professional']), id, name, waiting: count, incomplete: count, priority: count })),
    waiting_total: count,
    incomplete_total: count,
    registered: count,
    exits: z.array(z.object({ reason: name, count })),
    wait_days: stat,
  }),
  places: z.object({
    snapshot_on: z.string().nullable(),
    total_left: count,
    tracked: count,
    by_professional: z.array(z.object({ id, name, declared: count, left: count, accepting: z.boolean() })),
    weeks: z.array(z.object({ week_start: z.string(), snapshot_on: z.string(), total_left: count })),
  }),
})
export type DemandesReport = z.infer<typeof schema>

export interface DemandesReportFilters {
  from: string
  to: string
}

export async function fetchDemandesReport(f: DemandesReportFilters): Promise<DemandesReport> {
  const { data, error } = await supabase.rpc('report_demandes', { p_from: f.from, p_to: f.to })
  if (error) throw error
  return schema.parse(data)
}
