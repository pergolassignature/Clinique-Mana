import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { sqlArgs, UNEXPECTED_SHAPE } from './invoices'

/**
 * Facturation F3: « Impayés » (`list_overdue_invoices`), the cancellation fees to decide
 * (`list_fee_decisions`, `decide_cancellation_fee`), refunds (`refund_payment`) and the reminders'
 * settings (`set_billing_dunning`). Payloads that do not match throw UNEXPECTED_SHAPE.
 */
function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

const overdueRow = z
  .object({
    id: z.string(),
    number: z.string().nullable(),
    client_id: z.string(),
    client_name: z.string().nullable(),
    payer_client_id: z.string(),
    payer_name: z.string().nullable(),
    due_on: z.string(),
    days: z.number().int(),
    balance_cents: z.number().int(),
    last_step: z.number().int().nullable(),
    blocking: z.boolean(),
    payer_has_email: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    number: r.number ?? '',
    clientId: r.client_id,
    clientName: r.client_name ?? '',
    payerId: r.payer_client_id,
    payerName: r.payer_name ?? '',
    dueOn: r.due_on,
    days: r.days,
    balanceCents: r.balance_cents,
    lastStep: r.last_step,
    blocking: r.blocking,
    payerHasEmail: r.payer_has_email,
  }))
export type OverdueRow = z.output<typeof overdueRow>

export async function fetchOverdueInvoices(): Promise<OverdueRow[]> {
  const { data, error } = await supabase.rpc('list_overdue_invoices')
  if (error) throw error
  return parse(z.array(overdueRow), data)
}

export const FEE_KINDS = ['late_cancellation', 'no_show'] as const
export const FEE_STATUSES = ['pending', 'applied', 'waived'] as const
export type FeeStatus = (typeof FEE_STATUSES)[number]

const feeRow = z
  .object({
    appointment_id: z.string(),
    kind: z.enum(FEE_KINDS),
    status: z.enum(FEE_STATUSES),
    starts_at: z.string().nullable(),
    client_id: z.string(),
    client_name: z.string().nullable(),
    professional_id: z.string(),
    professional_name: z.string().nullable(),
    fee_percent: z.coerce.number().nullable(),
    amount_cents: z.number().int().nullable(),
    invoice_id: z.string().nullable(),
    decided_as: z.enum(['professional', 'staff', 'automatic']).nullable(),
    decided_at: z.string().nullable(),
    note: z.string().nullable(),
  })
  .transform((r) => ({
    appointmentId: r.appointment_id,
    kind: r.kind,
    status: r.status,
    startsAt: r.starts_at,
    clientId: r.client_id,
    clientName: r.client_name ?? '',
    professionalId: r.professional_id,
    professionalName: r.professional_name ?? '',
    feePercent: r.fee_percent,
    amountCents: r.amount_cents,
    invoiceId: r.invoice_id,
    decidedAs: r.decided_as,
    decidedAt: r.decided_at,
    note: r.note,
  }))
export type FeeDecision = z.output<typeof feeRow>

/** The fees (null: every status, the pending first). */
export async function fetchFeeDecisions(status: FeeStatus | null): Promise<FeeDecision[]> {
  const { data, error } = await supabase.rpc('list_fee_decisions', sqlArgs<'list_fee_decisions'>({ p_status: status }))
  if (error) throw error
  return parse(z.array(feeRow), data)
}

/** « Appliquer les frais » (the draft's id) or « Ne pas facturer » (null). */
export async function decideFee(appointmentId: string, apply: boolean, note: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'decide_cancellation_fee',
    sqlArgs<'decide_cancellation_fee'>({ p_appointment_id: appointmentId, p_apply: apply, p_note: note }),
  )
  if (error) throw error
  return parse(z.string().nullable(), data)
}

export async function refundPayment(paymentId: string, amountCents: number, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('refund_payment', { p_payment_id: paymentId, p_amount_cents: amountCents, p_reason: reason })
  if (error) throw error
  return parse(z.string(), data)
}

export interface DunningInput {
  dunningFrom: string | null
  days: number[]
  blockAfterDays: number
}

export async function setDunning(input: DunningInput): Promise<void> {
  const { error } = await supabase.rpc(
    'set_billing_dunning',
    sqlArgs<'set_billing_dunning'>({ p_dunning_from: input.dunningFrom, p_days: input.days, p_block_after_days: input.blockAfterDays }),
  )
  if (error) throw error
}
