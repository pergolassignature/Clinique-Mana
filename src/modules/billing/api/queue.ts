import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'
import { HOLD_REASONS, sqlArgs, UNEXPECTED_SHAPE } from './invoices'

/**
 * Facturation F2: the morning queue (`list_morning_queue`, « Mettre en attente », « Envoyer »),
 * payments and receipts, statements, the dossier's « entente particulière », the queue's start
 * date, and `billing-documents` (« deliver » right after a send; « preview » of a PDF). Payloads
 * that do not match throw UNEXPECTED_SHAPE, never Zod's issues.
 */
function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

const queueRow = z
  .object({
    id: z.string(),
    queue_day: z.string(),
    service_date: z.string().nullable(),
    client_id: z.string(),
    client_name: z.string().nullable(),
    client_number: z.number().int().nullable(),
    payer_client_id: z.string(),
    payer_name: z.string().nullable(),
    payer_has_email: z.boolean(),
    hold_reason: z.enum(HOLD_REASONS).nullable(),
    hold_note: z.string().nullable(),
    total_cents: z.number().int(),
    lines: z
      .array(
        z.object({
          id: z.string(),
          line_type: z.string(),
          description: z.string(),
          professional_id: z.string().nullable(),
          unit_price_cents: z.number().int().nullable(),
          total_cents: z.number().int(),
        }),
      )
      .nullable(),
  })
  .transform((r) => ({
    id: r.id,
    queueDay: r.queue_day,
    serviceDate: r.service_date,
    clientId: r.client_id,
    clientName: r.client_name ?? '',
    clientNumber: r.client_number,
    payerId: r.payer_client_id,
    payerName: r.payer_name ?? '',
    payerHasEmail: r.payer_has_email,
    holdReason: r.hold_reason,
    holdNote: r.hold_note,
    totalCents: r.total_cents,
    lines: (r.lines ?? []).map((l) => ({
      id: l.id,
      lineType: l.line_type,
      description: l.description,
      professionalId: l.professional_id,
      unitPriceCents: l.unit_price_cents,
      totalCents: l.total_cents,
    })),
  }))
export type QueueRow = z.output<typeof queueRow>

export async function fetchMorningQueue(): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc('list_morning_queue')
  if (error) throw error
  return parse(z.array(queueRow), data)
}

export async function holdDraft(invoiceId: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('hold_invoice_draft', sqlArgs<'hold_invoice_draft'>({ p_invoice_id: invoiceId, p_note: note }))
  if (error) throw error
}

export async function releaseDraft(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('release_invoice_draft', { p_invoice_id: invoiceId })
  if (error) throw error
}

const sendRow = z
  .object({ invoice_id: z.string(), number: z.string().nullable(), error: z.string().nullable() })
  .transform((r) => ({ invoiceId: r.invoice_id, number: r.number, error: r.error }))
export type SendResult = z.output<typeof sendRow>

/** « Envoyer » / « Tout envoyer »: each draft finalised and sent, a refusal answered for that one. */
export async function sendInvoices(invoiceIds: string[]): Promise<SendResult[]> {
  const { data, error } = await supabase.rpc('send_invoices', { p_invoice_ids: invoiceIds })
  if (error) throw error
  return parse(z.array(sendRow), data)
}

export type DocumentKind = 'invoice' | 'credit_note' | 'receipt' | 'statement'

/** « Renvoyer » an issued document to its payer. */
export async function resendDocument(kind: DocumentKind, id: string): Promise<void> {
  const { error } = await supabase.rpc('send_billing_document', { p_kind: kind, p_id: id })
  if (error) throw error
}

export interface PaymentInput {
  invoiceId: string
  modeCode: string
  amountCents: number
  paidOn: string
  reference: string | null
  /** FP-14: optional, 500 characters (« Payé par le conjoint »…). */
  note: string | null
}

/** A payment, its receipt sent to the payer at once. Returns the receipt's id. */
export async function recordPayment(input: PaymentInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'record_payment',
    sqlArgs<'record_payment'>({
      p_invoice_id: input.invoiceId,
      p_mode_code: input.modeCode,
      p_amount_cents: input.amountCents,
      p_paid_on: input.paidOn,
      p_reference: input.reference,
      p_note: input.note,
    }),
  )
  if (error) throw error
  return parse(z.string(), data)
}

export interface StatementInput {
  clientId: string
  year: number
  payerId: string | null
  send: boolean
}

export async function createStatement(input: StatementInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'create_statement',
    sqlArgs<'create_statement'>({ p_client_id: input.clientId, p_year: input.year, p_payer_client_id: input.payerId, p_send: input.send }),
  )
  if (error) throw error
  return parse(z.string(), data)
}

/** The dossier's « entente particulière » (null or blank ends it). */
export async function setSpecialAgreement(clientId: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_special_agreement', sqlArgs<'set_special_agreement'>({ p_client_id: clientId, p_note: note }))
  if (error) throw error
}

const settingsPayload = z
  .object({
    queue_from: z.string().nullable(),
    dunning_from: z.string().nullable().default(null),
    dunning_days: z.array(z.number().int()).default([3, 5, 7, 10]),
    block_after_days: z.number().int().default(10),
    invoice_note_fr: z.string().default(''),
    invoice_note_en: z.string().default(''),
    invoice_note_fr_default: z.boolean().default(true),
    invoice_note_en_default: z.boolean().default(true),
    etransfer_email: z.string().nullable().default(null),
  })
  .transform((r) => ({
    queueFrom: r.queue_from,
    dunningFrom: r.dunning_from,
    dunningDays: r.dunning_days,
    blockAfterDays: r.block_after_days,
    invoiceNote: { fr: r.invoice_note_fr, en: r.invoice_note_en, frDefault: r.invoice_note_fr_default, enDefault: r.invoice_note_en_default },
    etransferEmail: r.etransfer_email,
  }))
export type BillingSettings = z.output<typeof settingsPayload>

export async function fetchBillingSettings(): Promise<BillingSettings> {
  const { data, error } = await supabase.rpc('get_billing_settings')
  if (error) throw error
  return parse(settingsPayload, data)
}

/** BI-21: the standing invoice note per language (null: the default text; '' : none). */
export async function setInvoiceNote(fr: string | null, en: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_billing_invoice_note', sqlArgs<'set_billing_invoice_note'>({ p_fr: fr, p_en: en }))
  if (error) throw error
}

/** The first day whose sessions the morning queue invoices (null: off). */
export async function setQueueFrom(day: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_billing_queue_from', sqlArgs<'set_billing_queue_from'>({ p_queue_from: day }))
  if (error) throw error
}

// --- billing-documents ---------------------------------------------------------------------------

const delivered = z.object({ done: z.number().int(), failed: z.number().int() })

/** Renders and sends what is due now (after a send); the job does the rest every 5 minutes. */
export async function deliverNow(): Promise<{ done: number; failed: number }> {
  return parse(delivered, await invokeFunction('billing-documents', { action: 'deliver' }))
}

const previewPayload = z.object({ pdf: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/), filename: z.string().min(1).max(120) })

/** A document's PDF, rendered now (a draft too), never stored. */
export async function previewDocument(kind: DocumentKind, id: string): Promise<{ blob: Blob; filename: string }> {
  const p = parse(previewPayload, await invokeFunction('billing-documents', { action: 'preview', kind, id }))
  const bytes = Uint8Array.from(atob(p.pdf), (c) => c.charCodeAt(0))
  return { blob: new Blob([bytes], { type: 'application/pdf' }), filename: p.filename }
}
