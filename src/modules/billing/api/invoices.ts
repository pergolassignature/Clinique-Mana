import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { Database } from '@/core/supabase/database.types'

/**
 * Facturation F1: every write is an RPC (the database computes every amount and number); reads are
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
function sqlArgs<F extends keyof Functions>(args: { [K in keyof RpcArgs<F>]-?: RpcArgs<F>[K] | null }): RpcArgs<F> {
  return args as RpcArgs<F>
}

export const INVOICE_STATUSES = ['draft', 'issued', 'credited'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
export const LINE_TYPES = ['service', 'cancellation_fee', 'file_opening', 'adjustment', 'ivac_gap'] as const
export type LineType = (typeof LINE_TYPES)[number]

const person = z.object({ id: z.string(), name: z.string(), client_number: z.number().int().nullable() })
const option = z.object({ id: z.string(), name: z.string(), is_self: z.boolean(), relation: z.string().nullable() })

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

const creditNotePayload = z.object({ id: z.string(), number: z.string(), reason: z.string(), issued_on: z.string(), total_cents: z.number().int() })

const invoiceBundle = z
  .object({
    invoice: invoicePayload,
    client: person,
    payer: person,
    payer_options: z.array(option),
    lines: z.array(linePayload),
    credit_note: creditNotePayload.nullable(),
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
    creditNote: r.credit_note ? { number: r.credit_note.number, reason: r.credit_note.reason, issuedOn: r.credit_note.issued_on, totalCents: r.credit_note.total_cents } : null,
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
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
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
    invoices: z.array(
      z.object({
        id: z.string(),
        number: z.string().nullable(),
        status: z.enum(INVOICE_STATUSES),
        issued_on: z.string().nullable(),
        total_cents: z.number().int(),
        payer_client_id: z.string(),
        created_at: z.string(),
      }),
    ),
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
    invoices: r.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      issuedOn: i.issued_on,
      totalCents: i.total_cents,
      payerId: i.payer_client_id,
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
