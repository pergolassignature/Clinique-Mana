import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * Rapports « Demandes » (Demandes D6): `report_demandes(from, to)` (reports.view; Demandes
 * enabled), the intake indicators of the workbook (§8.3), the sources of D3c, the waiting list and
 * D5's photos. One answer for the whole page; each tab shows part of it.
 */

const count = z.number().int()
const decimal = z.number().nullable()
const name = z.string().nullable()
const stat = z.object({ count, median: decimal, average: decimal })
const sourceRow = { received: count, matched: count }

const schema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    received: count,
    matched_activity: count,
    activity_rate: decimal,
    matched_cohort: count,
    cohort_rate: decimal,
    contacted_on_time: count,
    contacted_late: count,
    not_contacted: count,
    waitlisted: count,
  }),
  weeks: z.array(z.object({ week_start: z.string(), received: count, matched: count })),
  by_channel: z.array(z.object({ channel: z.string(), ...sourceRow })),
  by_counselor: z.array(z.object({ name, received: count })),
  outcomes: z.array(z.object({ state: z.string(), closed_reason: name, count })),
  by_professional: z.array(z.object({ name, matched: count })),
  by_clientele: z.array(z.object({ name, matched: count })),
  by_source: z.array(z.object({ name, ...sourceRow })),
  by_campaign: z.array(z.object({ name: z.string(), ...sourceRow })),
  by_utm: z.array(z.object({ source: name, medium: name, ...sourceRow })),
  by_referrer: z.array(z.object({ host: z.string(), ...sourceRow })),
  delays: z.object({ first_contact_hours: stat, proposal_days: stat, match_days: stat }),
  first_appointments: z.object({
    matched: count,
    cancelled: count,
    rate: decimal,
    notice_hours: z.object({ average: decimal, min: decimal, max: decimal }),
    by_reason: z.array(z.object({ name, count })),
    by_professional: z.array(z.object({ name, count })),
  }),
  waitlist: z.object({
    open: z.array(z.object({ target_kind: z.enum(['title', 'professional']), name, count, priority: count })),
    open_total: count,
    registered: count,
    exits: z.array(z.object({ reason: name, count })),
    wait_days: stat,
  }),
  places: z.object({
    snapshot_on: z.string().nullable(),
    total_left: count,
    tracked: count,
    by_professional: z.array(z.object({ name, declared: count, left: count, accepting: z.boolean() })),
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
