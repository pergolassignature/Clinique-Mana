import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * Rapports RP2: « IVAC » (`report_ivac`, reports.finance; RP-8) and « Paie » (`report_payouts`,
 * reports.payroll; RP-9). A period goes from a clinic date to another, a year at most; at most
 * 5 000 rows come back (`truncated`), the totals count everything.
 */

const cents = z.number().int()
const count = z.number().int()
const option = z.object({ id: z.string(), name: z.string() })

/** Where IVAC's share of a session stands. */
export const IVAC_STATES = ['to_claim', 'draft', 'claimed', 'partial', 'paid'] as const
export type IvacState = (typeof IVAC_STATES)[number]

const ivacRow = z.object({
  line_id: z.string(),
  service_on: z.string(),
  by_hand: z.boolean(),
  client_id: z.string(),
  client_name: z.string().nullable(),
  client_number: z.number().int().nullable(),
  file_number: z.string().nullable(),
  professional_id: z.string().nullable(),
  professional_name: z.string().nullable(),
  professional_ivac_number: z.string().nullable(),
  service_code: z.number().int().nullable(),
  service_name: z.string().nullable(),
  amount_cents: cents,
  state: z.enum(IVAC_STATES),
  client_invoice_id: z.string().nullable(),
  client_invoice_number: z.string().nullable(),
  payer_invoice_id: z.string().nullable(),
  payer_invoice_number: z.string().nullable(),
  payer_issued_on: z.string().nullable(),
})
export type IvacRow = z.infer<typeof ivacRow>

const stateTotal = z.object({ count, amount_cents: cents })
const ivacSchema = z.object({
  rows: z.array(ivacRow),
  by_state: z.object({ to_claim: stateTotal, draft: stateTotal, claimed: stateTotal, partial: stateTotal, paid: stateTotal }),
  totals: stateTotal,
  truncated: z.boolean(),
  options: z.object({ professionals: z.array(option) }),
})
export type IvacReport = z.infer<typeof ivacSchema>

export interface IvacFilters {
  from: string
  to: string
  state: IvacState | null
  professionalId: string | null
}

export async function fetchIvacReport(f: IvacFilters): Promise<IvacReport> {
  const { data, error } = await supabase.rpc('report_ivac', {
    p_from: f.from,
    p_to: f.to,
    p_state: f.state ?? undefined,
    p_professional_id: f.professionalId ?? undefined,
  })
  if (error) throw error
  return ivacSchema.parse(data)
}

/** A payroll summary's state (FPay). */
export const PAYOUT_STATES = ['draft', 'to_validate', 'correction_requested', 'validated', 'paid'] as const
export type PayoutState = (typeof PAYOUT_STATES)[number]

const payoutRow = z.object({
  period_id: z.string(),
  month: z.string(),
  professional_id: z.string(),
  professional_name: z.string().nullable(),
  title_name: z.string().nullable(),
  state: z.enum(PAYOUT_STATES),
  sessions: count,
  session_cents: cents,
  late_cancellations: count,
  late_cancellation_cents: cents,
  other_cents: cents,
  adjustment_cents: cents,
  total_cents: cents,
  unpriced_count: count,
  paid_on: z.string().nullable(),
})
export type PayoutRow = z.infer<typeof payoutRow>

const payoutsSchema = z.object({
  rows: z.array(payoutRow),
  by_month: z.array(
    z.object({
      month: z.string(),
      professionals: count,
      sessions: count,
      total_cents: cents,
      paid_cents: cents,
      to_pay_cents: cents,
      not_validated: count,
    }),
  ),
  by_professional: z.array(
    z.object({
      professional_id: z.string(),
      professional_name: z.string().nullable(),
      months: count,
      sessions: count,
      total_cents: cents,
      paid_cents: cents,
    }),
  ),
  totals: z.object({ periods: count, sessions: count, total_cents: cents, paid_cents: cents, to_pay_cents: cents, not_validated: count }),
  truncated: z.boolean(),
  options: z.object({ professionals: z.array(option) }),
})
export type PayoutsReport = z.infer<typeof payoutsSchema>

export interface PayoutsFilters {
  from: string
  to: string
  professionalId: string | null
}

export async function fetchPayoutsReport(f: PayoutsFilters): Promise<PayoutsReport> {
  const { data, error } = await supabase.rpc('report_payouts', { p_from: f.from, p_to: f.to, p_professional_id: f.professionalId ?? undefined })
  if (error) throw error
  return payoutsSchema.parse(data)
}
