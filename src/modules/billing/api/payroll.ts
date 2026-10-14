import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'
import { uploadFile } from '@/core/storage/api'
import type { UploadStep } from '@/shared/lib/files'

/*
 * « Paie des professionnels » (FPay): a month's summaries for the administration
 * (`billing.payroll`), the professional's own in « Ma paie » (`billing.self`), the rules per
 * service (`billing.settings`), and « Générer ma facture » (`billing-payout-invoice`). Every
 * amount is computed in the database: the client only shows cents.
 */

export const PAYOUT_STATES = ['draft', 'to_validate', 'correction_requested', 'validated', 'paid'] as const
export type PayoutState = (typeof PAYOUT_STATES)[number]
export const LINE_KINDS = ['session', 'late_cancellation', 'other_fees', 'workshop', 'adjustment'] as const
export type LineKind = (typeof LINE_KINDS)[number]
export const PRICINGS = ['grid', 'agreement', 'rate', 'manual', 'no_title', 'no_price', 'no_rate'] as const
export type Pricing = (typeof PRICINGS)[number]
export const PAYOUT_RULES = ['session', 'late_cancellation', 'other_fees', 'workshop', 'none'] as const
export type PayoutRule = (typeof PAYOUT_RULES)[number]

/** The professional's invoice: PDF, JPEG or PNG, 10 Mo (`upload_purposes.billing_professional_invoice`). */
export const INVOICE_PURPOSE = 'billing_professional_invoice'
export const INVOICE_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const
export const INVOICE_MAX_BYTES = 10_485_760

const periodRowSchema = z.object({
  id: z.string(),
  professional_id: z.string(),
  professional_name: z.string().nullable(),
  title_name: z.string().nullable(),
  state: z.enum(PAYOUT_STATES),
  lines_count: z.number().int(),
  unpriced_count: z.number().int(),
  total_cents: z.number().int(),
  built_at: z.string(),
  sent_at: z.string().nullable(),
  correction_note: z.string().nullable(),
  validated_at: z.string().nullable(),
  paid_on: z.string().nullable(),
  invoice_number: z.string().nullable(),
  invoice_source: z.enum(['uploaded', 'generated']).nullable(),
  invoice_file_id: z.string().nullable(),
})
export type PayoutPeriodRow = z.infer<typeof periodRowSchema>

/** A month's periods (`billing.payroll`); `month` is its 1st (`2026-11-01`). */
export async function listPayoutPeriods(month: string): Promise<PayoutPeriodRow[]> {
  const { data, error } = await supabase.rpc('list_payout_periods', { p_month: month })
  if (error) throw error
  return z.array(periodRowSchema).parse(data)
}

const buildSchema = z.object({ created: z.number(), rebuilt: z.number(), removed: z.number(), locked: z.number() })
export type BuildResult = z.infer<typeof buildSchema>

/** « Calculer le mois »: builds or rebuilds a finished month. */
export async function buildPayoutMonth(month: string): Promise<BuildResult> {
  const { data, error } = await supabase.rpc('build_payout_month', { p_month: month })
  if (error) throw error
  return buildSchema.parse(data)
}

/** « Recalculer » one open period (a sent one goes back to « Brouillon »). */
export async function rebuildPayoutPeriod(id: string): Promise<BuildResult> {
  const { data, error } = await supabase.rpc('rebuild_payout_period', { p_id: id })
  if (error) throw error
  return buildSchema.parse(data)
}

const sendSchema = z.object({ sent: z.number(), unpriced: z.number() })
export type SendResult = z.infer<typeof sendSchema>

/** « Envoyer »: drafts and corrected periods to their professionals (those with a line to complete wait). */
export async function sendPayoutPeriods(ids: readonly string[]): Promise<SendResult> {
  const { data, error } = await supabase.rpc('send_payout_periods', { p_ids: [...ids] })
  if (error) throw error
  return sendSchema.parse(data)
}

/** « Supprimer les brouillons »: the month's drafts never sent. Returns how many. */
export async function discardPayoutDrafts(month: string): Promise<number> {
  const { data, error } = await supabase.rpc('discard_payout_drafts', { p_month: month })
  if (error) throw error
  return z.number().int().parse(data)
}

export async function addPayoutAdjustment(periodId: string, amountCents: number, note: string): Promise<void> {
  const { error } = await supabase.rpc('add_payout_adjustment', { p_period_id: periodId, p_amount_cents: amountCents, p_note: note })
  if (error) throw error
}

export async function removePayoutAdjustment(lineId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_payout_adjustment', { p_line_id: lineId })
  if (error) throw error
}

export async function reopenPayoutPeriod(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_payout_period', { p_id: id, p_reason: reason })
  if (error) throw error
}

const billClearedSchema = z.object({ status: z.literal('cleared'), qbo: z.enum(['deleted', 'voided']) })
export type BillCleared = z.infer<typeof billClearedSchema>

/**
 * « Bill annulé dans QuickBooks » (BI-27, `billing.payroll`): `qbo-bill-check` asks QuickBooks for
 * the period's Bill and forgets it only when QuickBooks no longer has it (deleted, or voided).
 */
export async function checkQboBillVoided(periodId: string): Promise<BillCleared> {
  return billClearedSchema.parse(await invokeFunction('qbo-bill-check', { period_id: periodId }))
}

/** « Forcer le retrait » (BI-27, `billing.payroll` and `billing.settings`): forgets the Bill without asking QuickBooks. */
export async function forceClearQboBill(periodId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('force_clear_qbo_bill', { p_period_id: periodId, p_reason: reason })
  if (error) throw error
}

export async function markPeriodPaid(id: string, paidOn: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('mark_period_paid', { p_id: id, p_paid_on: paidOn, p_note: note.trim() === '' ? undefined : note })
  if (error) throw error
}

const exportSchema = z.object({
  period_id: z.string(),
  professional_name: z.string().nullable(),
  specialty: z.string(),
  invoice_number: z.string(),
  issued_on: z.string(),
  amount_cents: z.number().int(),
  state: z.enum(PAYOUT_STATES),
  paid_on: z.string().nullable(),
})
export type PayoutExportRow = z.infer<typeof exportSchema>

/** The month's professional invoices for QuickBooks, by specialty. */
export async function listPayoutExport(month: string): Promise<PayoutExportRow[]> {
  const { data, error } = await supabase.rpc('list_payout_export', { p_month: month })
  if (error) throw error
  return z.array(exportSchema).parse(data)
}

const myPeriodSchema = z.object({
  id: z.string(),
  month: z.string(),
  state: z.enum(PAYOUT_STATES),
  lines_count: z.number().int(),
  total_cents: z.number().int(),
  sent_at: z.string().nullable(),
  validated_at: z.string().nullable(),
  paid_on: z.string().nullable(),
  has_invoice: z.boolean(),
})
export type MyPayoutPeriod = z.infer<typeof myPeriodSchema>

/** « Ma paie »: her periods once sent, newest first. */
export async function listMyPayoutPeriods(): Promise<MyPayoutPeriod[]> {
  const { data, error } = await supabase.rpc('list_my_payout_periods')
  if (error) throw error
  return z.array(myPeriodSchema).parse(data)
}

const lineSchema = z.object({
  id: z.string(),
  kind: z.enum(LINE_KINDS),
  occurred_on: z.string(),
  paid_on: z.string().nullable(),
  client_id: z.string().nullable(),
  client_name: z.string().nullable(),
  client_number: z.number().int().nullable(),
  service_code: z.number().int().nullable(),
  service_name: z.string().nullable(),
  duration: z.number().int().nullable(),
  base_cents: z.number().int().nullable(),
  retention_pct: z.number().nullable(),
  amount_cents: z.number().int().nullable(),
  pricing: z.enum(PRICINGS),
  note: z.string().nullable(),
  late: z.boolean(),
})
export type PayoutLine = z.infer<typeof lineSchema>

const periodSchema = z.object({
  id: z.string(),
  month: z.string(),
  state: z.enum(PAYOUT_STATES),
  professional: z.object({ professional_id: z.string(), display_name: z.string(), title_label: z.string().nullable() }).nullable(),
  title_name: z.string().nullable(),
  lines_count: z.number().int(),
  unpriced_count: z.number().int(),
  total_cents: z.number().int(),
  built_at: z.string(),
  sent_at: z.string().nullable(),
  correction_note: z.string().nullable(),
  correction_requested_at: z.string().nullable(),
  validated_at: z.string().nullable(),
  reopen_reason: z.string().nullable(),
  paid_on: z.string().nullable(),
  payment_note: z.string().nullable(),
  lines: z.array(lineSchema),
  invoice: z
    .object({
      id: z.string(),
      source: z.enum(['uploaded', 'generated']),
      file_id: z.string(),
      number: z.string(),
      issued_on: z.string(),
      amount_cents: z.number().int(),
      created_at: z.string(),
      /** Its Bill in QuickBooks (the administration only; BI-23, BI-27). */
      qbo_bill_id: z.string().nullable().optional(),
    })
    .nullable(),
})
export type PayoutPeriod = z.infer<typeof periodSchema>

/** One period with its lines and invoice (hers once sent, or any for the administration). */
export async function fetchPayoutPeriod(id: string): Promise<PayoutPeriod> {
  const { data, error } = await supabase.rpc('get_payout_period', { p_id: id })
  if (error) throw error
  return periodSchema.parse(data)
}

export async function requestPayoutCorrection(id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('request_payout_correction', { p_id: id, p_note: note })
  if (error) throw error
}

export async function validatePayoutPeriod(id: string): Promise<void> {
  const { error } = await supabase.rpc('validate_payout_period', { p_id: id })
  if (error) throw error
}

export interface UploadInvoiceInput {
  periodId: string
  file: File
  mimeType: string
  number: string
  issuedOn: string
  onStep: (step: UploadStep) => void
}

/** « Téléverser ma facture »: the file through the storage pipeline, then attached to the period. */
export async function uploadProfessionalInvoice({ periodId, file, mimeType, number, issuedOn, onStep }: UploadInvoiceInput): Promise<void> {
  const { fileId } = await uploadFile({ purpose: INVOICE_PURPOSE, subjectType: 'payout_period', subjectId: periodId, file, mimeType, onStep })
  const { error } = await supabase.rpc('attach_professional_invoice', {
    p_period_id: periodId,
    p_file_id: fileId,
    p_number: number.trim(),
    p_issued_on: issuedOn,
  })
  if (error) throw error
}

/** « Générer ma facture »: rendered and attached by `billing-payout-invoice`. */
export async function generateProfessionalInvoice(periodId: string, number: string, issuedOn: string): Promise<void> {
  await invokeFunction('billing-payout-invoice', { period_id: periodId, number: number.trim(), issued_on: issuedOn })
}

const ruleSchema = z.object({
  service_id: z.string(),
  code: z.number().int(),
  name: z.string(),
  kind: z.string(),
  is_active: z.boolean(),
  family_code: z.number().int(),
  family_name: z.string(),
  rule: z.enum(PAYOUT_RULES),
  is_default: z.boolean(),
})
export type PayoutRuleRow = z.infer<typeof ruleSchema>

/** Every service with its payroll rule (Paramètres → Paie). */
export async function listPayoutRules(): Promise<PayoutRuleRow[]> {
  const { data, error } = await supabase.rpc('list_payout_rules')
  if (error) throw error
  return z.array(ruleSchema).parse(data)
}

export async function setPayoutRule(serviceId: string, rule: PayoutRule): Promise<void> {
  const { error } = await supabase.rpc('set_payout_rule', { p_service_id: serviceId, p_rule: rule })
  if (error) throw error
}
