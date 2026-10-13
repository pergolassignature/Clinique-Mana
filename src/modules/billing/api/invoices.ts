import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { Database } from '@/core/supabase/database.types'

/**
 * Facturation F1 and F2: every write is an RPC (the database computes every amount and number); reads are
 * `list_invoices`, `get_invoice`, `get_client_billing`, and the other modules' published views for
 * names (`professionals_directory`, `services_catalog`). A payload that does not match throws
 * UNEXPECTED_SHAPE, never Zod's issues (they could quote a name).
 */
export const UNEXPECTED_SHAPE = 'billing: unexpected RPC shape'

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

type Functions = Database['public']['Functions']
type RpcArgs<F extends keyof Functions> = Functions[F]['Args']
/** The generator types optional parameters as non-null; the RPCs take null where SQL allows it. */
export function sqlArgs<F extends keyof Functions>(args: { [K in keyof RpcArgs<F>]-?: RpcArgs<F>[K] | null }): RpcArgs<F> {
  return args as RpcArgs<F>
}

export const INVOICE_STATUSES = ['draft', 'issued', 'credited'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export const LINE_TYPES = ['service', 'cancellation_fee', 'file_opening', 'adjustment', 'ivac_gap', 'payer_share', 'payer_claim'] as const
export type LineType = (typeof LINE_TYPES)[number]

const person = z.object({ id: z.string(), name: z.string(), client_number: z.number().int().nullable() })
const option = z.object({ id: z.string(), name: z.string(), is_self: z.boolean(), relation: z.string().nullable() })

export const HOLD_REASONS = ['special_agreement', 'client_agreement', 'manual', 'price_missing', 'payer_missing', 'payer_incomplete'] as const
export type HoldReason = (typeof HOLD_REASONS)[number]
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const
/** Who an invoice is billed to: the client, a relation, or a payer organisation (FP: IVAC, a PAE). */
export const PAYER_KINDS = ['client', 'relation', 'organisation'] as const
export type InvoicePayerKind = (typeof PAYER_KINDS)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** A document's deliveries, newest first (`billing_deliveries`): what the screens say of its PDF and email. */
const deliveryPayload = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'sending', 'done', 'failed']),
    send_email: z.boolean(),
    email_status: z.enum(['sent', 'skipped', 'failed']).nullable(),
    skip_reason: z.enum(['not_requested', 'no_email', 'reserved', 'module_disabled']).nullable(),
    created_at: z.string(),
    finished_at: z.string().nullable(),
  })
  .transform((d) => ({
    id: d.id,
    status: d.status,
    sendEmail: d.send_email,
    emailStatus: d.email_status,
    skipReason: d.skip_reason,
    createdAt: d.created_at,
    finishedAt: d.finished_at,
  }))
export type Delivery = z.output<typeof deliveryPayload>

const invoicePayload = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.enum(INVOICE_STATUSES),
  client_id: z.string(),
  payer_client_id: z.string(),
  issued_on: z.string().nullable(),
  due_on: z.string().nullable(),
  gst_rate: z.coerce.number(),
  qst_rate: z.coerce.number(),
  tax_exempt: z.boolean(),
  subtotal_cents: z.number().int(),
  gst_cents: z.number().int(),
  qst_cents: z.number().int(),
  total_cents: z.number().int(),
  notes_client: z.string().nullable(),
  notes_internal: z.string().nullable(),
  created_at: z.string(),
  queue_day: z.string().nullable().default(null),
  hold_reason: z.enum(HOLD_REASONS).nullable().default(null),
  hold_now: z.enum(HOLD_REASONS).nullable().default(null),
  hold_note: z.string().nullable().default(null),
  paid_cents: z.number().int().default(0),
  payment_status: z.enum(PAYMENT_STATUSES).default('unpaid'),
  pdf_file_id: z.string().nullable().default(null),
  payer_has_email: z.boolean().default(true),
  payer_kind: z.enum(PAYER_KINDS).default('client'),
  payer_reference: z.string().nullable().default(null),
})

const linePayload = z.object({
  id: z.string(),
  position: z.number().int(),
  line_type: z.enum(LINE_TYPES),
  appointment_id: z.string().nullable(),
  professional_id: z.string().nullable(),
  service_id: z.string().nullable(),
  service_code: z.number().int().nullable(),
  description: z.string(),
  quantity: z.coerce.number(),
  unit_price_cents: z.number().int().nullable(),
  price_source: z.string().nullable(),
  tax_rule: z.enum(['exempt', 'taxable']),
  subtotal_cents: z.number().int(),
  gst_cents: z.number().int(),
  qst_cents: z.number().int(),
  total_cents: z.number().int(),
})

const creditNotePayload = z.object({
  id: z.string(),
  number: z.string(),
  reason: z.string(),
  issued_on: z.string(),
  total_cents: z.number().int(),
  pdf_file_id: z.string().nullable().default(null),
  deliveries: z.array(deliveryPayload).default([]),
})

const paymentPayload = z
  .object({
    id: z.string(),
    mode_code: z.string(),
    mode: z.string(),
    amount_cents: z.number().int(),
    paid_on: z.string(),
    reference: z.string().nullable(),
    receipt_id: z.string().nullable(),
    receipt_number: z.string().nullable(),
    receipt_file_id: z.string().nullable(),
    receipt_deliveries: z.array(deliveryPayload),
    refunds: z
      .array(
        z.object({
          id: z.string(),
          amount_cents: z.number().int(),
          reason: z.string(),
          status: z.enum(['recorded', 'pending_provider', 'failed']),
          created_at: z.string(),
        }),
      )
      .default([]),
    refundable_cents: z.number().int().optional(),
  })
  .transform((p) => ({
    id: p.id,
    modeCode: p.mode_code,
    mode: p.mode,
    amountCents: p.amount_cents,
    paidOn: p.paid_on,
    reference: p.reference,
    receiptId: p.receipt_id,
    receiptNumber: p.receipt_number,
    receiptFileId: p.receipt_file_id,
    receiptDeliveries: p.receipt_deliveries,
    refunds: p.refunds.map((r) => ({ id: r.id, amountCents: r.amount_cents, reason: r.reason, status: r.status, createdAt: r.created_at })),
    refundableCents: p.refundable_cents ?? p.amount_cents,
  }))
export type Payment = z.output<typeof paymentPayload>

const invoiceBundle = z
  .object({
    invoice: invoicePayload,
    client: person,
    payer: person,
    payer_options: z.array(option),
    lines: z.array(linePayload),
    credit_note: creditNotePayload.nullable(),
    payments: z.array(paymentPayload).default([]),
    deliveries: z.array(deliveryPayload).default([]),
    payment_modes: z.array(z.object({ code: z.string(), name: z.string() })).default([]),
    reminders: z
      .array(z.object({ step: z.number().int(), run_on: z.string(), sent: z.boolean(), email_status: z.string().nullable() }))
      .default([]),
  })
  .transform((r) => ({
    invoice: {
      id: r.invoice.id,
      number: r.invoice.number,
      status: r.invoice.status,
      clientId: r.invoice.client_id,
      payerId: r.invoice.payer_client_id,
      issuedOn: r.invoice.issued_on,
      taxExempt: r.invoice.tax_exempt,
      gstRate: r.invoice.gst_rate,
      qstRate: r.invoice.qst_rate,
      subtotalCents: r.invoice.subtotal_cents,
      gstCents: r.invoice.gst_cents,
      qstCents: r.invoice.qst_cents,
      totalCents: r.invoice.total_cents,
      notesClient: r.invoice.notes_client,
      notesInternal: r.invoice.notes_internal,
      queueDay: r.invoice.queue_day,
      holdReason: r.invoice.hold_reason,
      holdNow: r.invoice.hold_now,
      holdNote: r.invoice.hold_note,
      paidCents: r.invoice.paid_cents,
      paymentStatus: r.invoice.payment_status,
      pdfFileId: r.invoice.pdf_file_id,
      payerHasEmail: r.invoice.payer_has_email,
      payerKind: r.invoice.payer_kind,
      payerReference: r.invoice.payer_reference,
    },
    client: { id: r.client.id, name: r.client.name, clientNumber: r.client.client_number },
    payer: { id: r.payer.id, name: r.payer.name },
    payerOptions: r.payer_options.map((o) => ({ id: o.id, name: o.name, isSelf: o.is_self, relation: o.relation })),
    lines: r.lines.map((l) => ({
      id: l.id,
      lineType: l.line_type,
      appointmentId: l.appointment_id,
      professionalId: l.professional_id,
      serviceCode: l.service_code,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unit_price_cents,
      priceSource: l.price_source,
      taxRule: l.tax_rule,
      subtotalCents: l.subtotal_cents,
      gstCents: l.gst_cents,
      qstCents: l.qst_cents,
      totalCents: l.total_cents,
    })),
    creditNote: r.credit_note
      ? {
          id: r.credit_note.id,
          number: r.credit_note.number,
          reason: r.credit_note.reason,
          issuedOn: r.credit_note.issued_on,
          totalCents: r.credit_note.total_cents,
          pdfFileId: r.credit_note.pdf_file_id,
          deliveries: r.credit_note.deliveries,
        }
      : null,
    payments: r.payments,
    deliveries: r.deliveries,
    paymentModes: r.payment_modes,
    reminders: r.reminders.map((m) => ({ step: m.step, runOn: m.run_on, sent: m.sent, emailStatus: m.email_status })),
  }))
export type InvoiceBundle = z.output<typeof invoiceBundle>
export type InvoiceLine = InvoiceBundle['lines'][number]
export type PayerOption = InvoiceBundle['payerOptions'][number]

const listRow = z
  .object({
    id: z.string(),
    number: z.string().nullable(),
    status: z.enum(INVOICE_STATUSES),
    client_id: z.string(),
    client_name: z.string().nullable(),
    client_number: z.number().int().nullable(),
    payer_client_id: z.string(),
    payer_name: z.string().nullable(),
    issued_on: z.string().nullable(),
    total_cents: z.number().int(),
    paid_cents: z.number().int().default(0),
    payment_status: z.enum(PAYMENT_STATUSES).default('unpaid'),
    created_at: z.string(),
    payer_kind: z.enum(PAYER_KINDS).default('client'),
  })
  .transform((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    payerKind: r.payer_kind,
    paidCents: r.paid_cents,
    paymentStatus: r.payment_status,
    clientId: r.client_id,
    clientName: r.client_name ?? '',
    clientNumber: r.client_number,
    payerId: r.payer_client_id,
    payerName: r.payer_name ?? '',
    issuedOn: r.issued_on,
    totalCents: r.total_cents,
    createdAt: r.created_at,
  }))
export type InvoiceRow = z.output<typeof listRow>

export const INVOICES_PAGE = 50

export async function fetchInvoices(status: InvoiceStatus | null, before: string | null): Promise<InvoiceRow[]> {
  const { data, error } = await supabase.rpc(
    'list_invoices',
    sqlArgs<'list_invoices'>({ p_status: status, p_client_id: null, p_before: before, p_limit: INVOICES_PAGE }),
  )
  if (error) throw error
  return parse(z.array(listRow), data)
}

export async function fetchInvoice(id: string): Promise<InvoiceBundle | null> {
  const { data, error } = await supabase.rpc('get_invoice', { p_invoice_id: id })
  if (error) throw error
  return data === null ? null : parse(invoiceBundle, data)
}

const clientBilling = z
  .object({
    default_payer_id: z.string(),
    payer_options: z.array(option),
    special_agreement: z.object({ note: z.string(), created_at: z.string() }).nullable().default(null),
    balance_cents: z.number().int().default(0),
    invoices: z.array(
      z.object({
        id: z.string(),
        number: z.string().nullable(),
        status: z.enum(INVOICE_STATUSES),
        issued_on: z.string().nullable(),
        total_cents: z.number().int(),
        paid_cents: z.number().int().default(0),
        payment_status: z.enum(PAYMENT_STATUSES).default('unpaid'),
        payer_client_id: z.string(),
        created_at: z.string(),
        payer_kind: z.enum(PAYER_KINDS).default('client'),
        payer_organisation_name: z.string().nullable().default(null),
      }),
    ),
    payments: z
      .array(
        z.object({
          id: z.string(),
          invoice_id: z.string(),
          invoice_number: z.string().nullable(),
          mode: z.string(),
          amount_cents: z.number().int(),
          paid_on: z.string(),
          payer_client_id: z.string(),
          receipt_number: z.string().nullable(),
          receipt_file_id: z.string().nullable(),
        }),
      )
      .default([]),
    statements: z
      .array(
        z.object({
          id: z.string(),
          year: z.number().int(),
          payer_client_id: z.string(),
          pdf_file_id: z.string().nullable(),
          created_at: z.string(),
          deliveries: z.array(deliveryPayload),
        }),
      )
      .default([]),
    to_invoice: z.array(
      z.object({
        appointment_id: z.string(),
        starts_at: z.string(),
        state: z.string(),
        service_id: z.string().nullable(),
        professional_id: z.string(),
        first_client: z.boolean(),
      }),
    ),
  })
  .transform((r) => ({
    defaultPayerId: r.default_payer_id,
    payerOptions: r.payer_options.map((o) => ({ id: o.id, name: o.name, isSelf: o.is_self, relation: o.relation })),
    specialAgreement: r.special_agreement ? { note: r.special_agreement.note, createdAt: r.special_agreement.created_at } : null,
    balanceCents: r.balance_cents,
    payments: r.payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoice_id,
      invoiceNumber: p.invoice_number,
      mode: p.mode,
      amountCents: p.amount_cents,
      paidOn: p.paid_on,
      payerId: p.payer_client_id,
      receiptNumber: p.receipt_number,
      receiptFileId: p.receipt_file_id,
    })),
    statements: r.statements.map((st) => ({
      id: st.id,
      year: st.year,
      payerId: st.payer_client_id,
      pdfFileId: st.pdf_file_id,
      createdAt: st.created_at,
      deliveries: st.deliveries,
    })),
    invoices: r.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      issuedOn: i.issued_on,
      totalCents: i.total_cents,
      paidCents: i.paid_cents,
      paymentStatus: i.payment_status,
      payerId: i.payer_client_id,
      payerKind: i.payer_kind,
      payerOrganisationName: i.payer_organisation_name,
      createdAt: i.created_at,
    })),
    toInvoice: r.to_invoice.map((a) => ({
      appointmentId: a.appointment_id,
      startsAt: a.starts_at,
      state: a.state,
      serviceId: a.service_id,
      professionalId: a.professional_id,
      firstClient: a.first_client,
    })),
  }))
export type ClientBilling = z.output<typeof clientBilling>

export async function fetchClientBilling(clientId: string): Promise<ClientBilling> {
  const { data, error } = await supabase.rpc('get_client_billing', { p_client_id: clientId })
  if (error) throw error
  return parse(clientBilling, data)
}

/** Names for the client panel's appointments: the staff's published views (empty without their permissions). */
export async function fetchBillingNames(): Promise<{ professionals: Map<string, string>; services: Map<string, string> }> {
  const [pros, services] = await Promise.all([
    supabase.from('professionals_directory').select('id, display_name').limit(1000),
    supabase.from('services_catalog').select('id, code, name').limit(1000),
  ])
  if (pros.error) throw pros.error
  if (services.error) throw services.error
  const p = parse(z.array(z.object({ id: z.string(), display_name: z.string().nullable() })), pros.data)
  const s = parse(z.array(z.object({ id: z.string(), code: z.number().int(), name: z.string() })), services.data)
  return { professionals: new Map(p.map((x) => [x.id, x.display_name ?? ''])), services: new Map(s.map((x) => [x.id, x.name])) }
}

// --- Writes --------------------------------------------------------------------------------------

export async function createInvoice(appointmentIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc(
    'create_invoice',
    sqlArgs<'create_invoice'>({ p_appointment_ids: appointmentIds, p_payer_client_id: null, p_file_opening: null, p_notes_client: null, p_notes_internal: null }),
  )
  if (error) throw error
  return parse(z.string(), data)
}

export async function createManualInvoice(clientId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_manual_invoice', sqlArgs<'create_manual_invoice'>({ p_client_id: clientId, p_payer_client_id: null }))
  if (error) throw error
  return parse(z.string(), data)
}

export interface AdjustmentInput {
  invoiceId: string
  description: string
  quantity: number
  unitPriceCents: number
  taxable: boolean
}

export async function addAdjustment(input: AdjustmentInput): Promise<void> {
  const { error } = await supabase.rpc(
    'add_invoice_line',
    sqlArgs<'add_invoice_line'>({
      p_invoice_id: input.invoiceId,
      p_line_type: 'adjustment',
      p_service_id: null,
      p_description: input.description,
      p_quantity: input.quantity,
      p_unit_price_cents: input.unitPriceCents,
      p_taxable: input.taxable,
      p_professional_id: null,
    }),
  )
  if (error) throw error
}

export async function setLinePrice(lineId: string, cents: number): Promise<void> {
  const { error } = await supabase.rpc('set_invoice_line_price', { p_line_id: lineId, p_unit_price_cents: cents })
  if (error) throw error
}

export async function removeLine(lineId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_invoice_line', { p_line_id: lineId })
  if (error) throw error
}

export async function setInvoicePayer(invoiceId: string, payerId: string): Promise<void> {
  const { error } = await supabase.rpc('set_invoice_payer', { p_invoice_id: invoiceId, p_payer_client_id: payerId })
  if (error) throw error
}

export async function setInvoiceNotes(invoiceId: string, notesClient: string | null, notesInternal: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_invoice_notes', sqlArgs<'set_invoice_notes'>({ p_invoice_id: invoiceId, p_notes_client: notesClient, p_notes_internal: notesInternal }))
  if (error) throw error
}

export async function deleteDraft(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_invoice_draft', { p_invoice_id: invoiceId })
  if (error) throw error
}

export async function finalizeInvoice(invoiceId: string): Promise<string> {
  const { data, error } = await supabase.rpc('finalize_invoice', { p_invoice_id: invoiceId })
  if (error) throw error
  return parse(z.string(), data)
}

export async function issueCreditNote(invoiceId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('issue_credit_note', { p_invoice_id: invoiceId, p_reason: reason })
  if (error) throw error
}

export async function setDefaultPayer(clientId: string, payerId: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_payer', { p_client_id: clientId, p_payer_client_id: payerId })
  if (error) throw error
}

const sequenceRow = z.object({ year: z.number().int(), last_number: z.number().int() })

/** The invoice sequence of a year (none yet: 0). */
export async function fetchSequence(year: number): Promise<number> {
  const { data, error } = await supabase.from('invoice_sequences').select('year, last_number').eq('kind', 'invoice').eq('year', year).maybeSingle()
  if (error) throw error
  return data ? parse(sequenceRow, data).last_number : 0
}

export async function setSequence(year: number, lastNumber: number): Promise<void> {
  const { error } = await supabase.rpc('set_invoice_sequence', { p_year: year, p_last_number: lastNumber })
  if (error) throw error
}
