import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/*
 * Rapports (RP1): the three report RPCs, each checking its permission first (`report_revenue`:
 * reports.finance; `report_cancellations`, `report_clients_to_follow_up`: reports.view). A period
 * goes from a clinic date to another, a year at most; at most 5 000 rows come back (`truncated`),
 * the totals count everything.
 */

export const REVENUE_VIEWS = ['invoice', 'service', 'payment'] as const
export type RevenueView = (typeof REVENUE_VIEWS)[number]

const cents = z.number().int()
const count = z.number().int()
const option = z.object({ id: z.string(), name: z.string() })
const serviceOption = z.object({ id: z.string(), code: z.number().int().nullable(), name: z.string() })
const modeOption = z.object({ code: z.string(), name: z.string() })
const options = z.object({
  professionals: z.array(option),
  services: z.array(serviceOption),
  modes: z.array(modeOption),
})
const client = { client_id: z.string(), client_name: z.string().nullable(), client_number: z.number().int().nullable() }
const credited = z.object({ count, total_cents: cents })

const invoiceRow = z.object({
  invoice_id: z.string(),
  number: z.string(),
  issued_on: z.string(),
  ...client,
  payer_name: z.string().nullable(),
  professional_names: z.string().nullable(),
  subtotal_cents: cents,
  gst_cents: cents,
  qst_cents: cents,
  total_cents: cents,
  paid_cents: cents,
  balance_cents: cents,
})
export type RevenueInvoiceRow = z.infer<typeof invoiceRow>

const lineRow = z.object({
  line_id: z.string(),
  invoice_id: z.string(),
  number: z.string(),
  issued_on: z.string(),
  ...client,
  professional_name: z.string().nullable(),
  line_type: z.string(),
  service_code: z.number().int().nullable(),
  service_name: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  unit_price_cents: z.number().int().nullable(),
  subtotal_cents: cents,
  gst_cents: cents,
  qst_cents: cents,
  total_cents: cents,
})
export type RevenueLineRow = z.infer<typeof lineRow>

/** A payment, or a refund recorded in the period (L6: negative, under its payment's mode). */
const paymentRow = z.object({
  kind: z.enum(['payment', 'refund']).default('payment'),
  row_id: z.string().optional(),
  payment_id: z.string(),
  paid_on: z.string(),
  invoice_id: z.string(),
  number: z.string(),
  ...client,
  payer_name: z.string().nullable(),
  mode_code: z.string(),
  mode_name: z.string(),
  amount_cents: cents,
  reference: z.string().nullable(),
})
export type RevenuePaymentRow = z.infer<typeof paymentRow>

const revenueSchema = z.discriminatedUnion('view', [
  z.object({
    view: z.literal('invoice'),
    rows: z.array(invoiceRow),
    totals: z.object({
      count,
      subtotal_cents: cents,
      gst_cents: cents,
      qst_cents: cents,
      total_cents: cents,
      paid_cents: cents,
      balance_cents: cents,
    }),
    truncated: z.boolean(),
    credited,
    options,
  }),
  z.object({
    view: z.literal('service'),
    rows: z.array(lineRow),
    by_service: z.array(
      z.object({
        service_id: z.string().nullable(),
        service_code: z.number().int().nullable(),
        service_name: z.string().nullable(),
        line_type: z.string().nullable(),
        lines: count,
        quantity: z.number(),
        total_cents: cents,
      }),
    ),
    totals: z.object({ count, quantity: z.number(), subtotal_cents: cents, gst_cents: cents, qst_cents: cents, total_cents: cents }),
    truncated: z.boolean(),
    credited,
    options,
  }),
  z.object({
    view: z.literal('payment'),
    rows: z.array(paymentRow),
    by_mode: z.array(
      z.object({
        mode_code: z.string(),
        mode_name: z.string(),
        count,
        amount_cents: cents,
        refunds_count: count.default(0),
        refunds_cents: cents.default(0),
        net_cents: cents.optional(),
      }),
    ),
    totals: z.object({ count, amount_cents: cents, refunds_count: count.default(0), refunds_cents: cents.default(0), net_cents: cents.optional() }),
    truncated: z.boolean(),
    options,
  }),
])
export type RevenueReport = z.infer<typeof revenueSchema>

export interface RevenueFilters {
  view: RevenueView
  from: string
  to: string
  professionalId: string | null
  serviceId: string | null
  modeCode: string | null
}

export async function fetchRevenue(f: RevenueFilters): Promise<RevenueReport> {
  const { data, error } = await supabase.rpc('report_revenue', {
    p_view: f.view,
    p_from: f.from,
    p_to: f.to,
    p_professional_id: f.professionalId ?? undefined,
    p_service_id: f.serviceId ?? undefined,
    p_mode_code: f.view === 'payment' ? (f.modeCode ?? undefined) : undefined,
  })
  if (error) throw error
  return revenueSchema.parse(data)
}

export const ABSENCE_KINDS = ['cancelled', 'absent'] as const
export type AbsenceKind = (typeof ABSENCE_KINDS)[number]

const cancellationRow = z.object({
  appointment_id: z.string(),
  starts_at: z.string(),
  kind: z.enum(ABSENCE_KINDS),
  ...client,
  professional_name: z.string().nullable(),
  service_code: z.number().int().nullable(),
  service_name: z.string().nullable(),
  reason_name: z.string().nullable(),
  late: z.boolean(),
  kept_on_schedule: z.boolean(),
  cancelled_at: z.string().nullable(),
  later_starts_at: z.string().nullable(),
})
export type CancellationRow = z.infer<typeof cancellationRow>

const cancellationsSchema = z.object({
  rows: z.array(cancellationRow),
  by_reason: z.array(
    z.object({ kind: z.enum(ABSENCE_KINDS), reason_id: z.string().nullable(), reason_name: z.string().nullable(), count, late: count }),
  ),
  totals: z.object({ cancelled: count, late: count, absent: count }),
  truncated: z.boolean(),
  options: z.object({ professionals: z.array(option), reasons: z.array(option) }),
})
export type CancellationsReport = z.infer<typeof cancellationsSchema>

export interface CancellationFilters {
  from: string
  to: string
  professionalId: string | null
  reasonId: string | null
  kind: AbsenceKind | null
}

export async function fetchCancellations(f: CancellationFilters): Promise<CancellationsReport> {
  const { data, error } = await supabase.rpc('report_cancellations', {
    p_from: f.from,
    p_to: f.to,
    p_professional_id: f.professionalId ?? undefined,
    p_reason_id: f.kind === 'absent' ? undefined : (f.reasonId ?? undefined),
    p_kind: f.kind ?? undefined,
  })
  if (error) throw error
  return cancellationsSchema.parse(data)
}

const followUpRow = z.object({
  ...client,
  starts_at: z.string(),
  kind: z.enum(ABSENCE_KINDS),
  reason_name: z.string().nullable(),
  late: z.boolean(),
  professional_name: z.string().nullable(),
  service_code: z.number().int().nullable(),
  service_name: z.string().nullable(),
  events: count,
})
export type FollowUpRow = z.infer<typeof followUpRow>

const followUpSchema = z.object({
  rows: z.array(followUpRow),
  total: count,
  truncated: z.boolean(),
  options: z.object({ professionals: z.array(option) }),
})
export type FollowUpReport = z.infer<typeof followUpSchema>

export interface FollowUpFilters {
  from: string
  to: string
  professionalId: string | null
}

export async function fetchFollowUp(f: FollowUpFilters): Promise<FollowUpReport> {
  const { data, error } = await supabase.rpc('report_clients_to_follow_up', {
    p_from: f.from,
    p_to: f.to,
    p_professional_id: f.professionalId ?? undefined,
  })
  if (error) throw error
  return followUpSchema.parse(data)
}

// --- « Consentements » (Clients C5b, CC-19) -----------------------------------------------------

const consentGap = z.object({
  consent_key: z.string(),
  consent_name: z.string(),
  signed: count,
  resign: count,
  pending: count,
  overdue: count,
  withdrawn: count,
  none: count,
})
export type ConsentGap = z.infer<typeof consentGap>

const consentsSchema = z.object({
  gaps: z.array(consentGap),
  by_professional: z.array(
    z.object({
      professional_id: z.string().nullable(),
      professional_name: z.string().nullable(),
      consent_key: z.string(),
      consent_name: z.string(),
      signed: count,
      to_obtain: count,
    }),
  ),
  months: z.array(z.object({ month: z.string(), signed: count, imported: count, withdrawn: count })),
  delays: z.array(z.object({ consent_key: z.string(), consent_name: z.string(), count, average_days: z.number(), median_days: z.number() })),
  totals: z.object({ clients: count, signed: count, withdrawn: count }),
  options: z.object({ professionals: z.array(option) }),
})
export type ConsentsReport = z.infer<typeof consentsSchema>

export interface ConsentsFilters {
  from: string
  to: string
  professionalId: string | null
}

/** `report_consents` (reports.view): the states today per consent, per professional; per month; the send → sign delay. */
export async function fetchConsentsReport(f: ConsentsFilters): Promise<ConsentsReport> {
  const { data, error } = await supabase.rpc('report_consents', { p_from: f.from, p_to: f.to, p_professional_id: f.professionalId ?? undefined })
  if (error) throw error
  return consentsSchema.parse(data)
}
