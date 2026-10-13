import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { sqlArgs, UNEXPECTED_SHAPE } from './invoices'

/**
 * Facturation FP: the payer organisations (the clinic's IVAC, the PAE providers), IVAC's dated
 * rate, a client's payers as Facturation sees them, « Payeurs » (what is to claim, the drafts, the
 * unpaid) and its two actions. Every amount is the database's. Payloads that do not match throw
 * UNEXPECTED_SHAPE, never Zod's issues.
 */
function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

export const ORGANISATION_KINDS = ['ivac', 'pae'] as const
export type OrganisationKind = (typeof ORGANISATION_KINDS)[number]
/** When a PAE is invoiced: each month, by thirds of its maximum (FP-3), or at its year's end. */
export const CADENCES = ['monthly', 'threshold', 'closing'] as const
export type Cadence = (typeof CADENCES)[number]
export const LANGUAGES = ['fr', 'en'] as const
export type DocumentLanguage = (typeof LANGUAGES)[number]

const organisationPayload = z
  .object({
    id: z.string(),
    kind: z.enum(ORGANISATION_KINDS),
    name: z.string(),
    billing_email: z.string().nullable(),
    contact_name: z.string().nullable(),
    language: z.enum(LANGUAGES),
    provider_number: z.string().nullable(),
    cadence: z.enum(CADENCES),
    due_days: z.number().int(),
    reminders_enabled: z.boolean(),
    is_active: z.boolean(),
    note: z.string().nullable(),
  })
  .transform((o) => ({
    id: o.id,
    kind: o.kind,
    name: o.name,
    billingEmail: o.billing_email,
    contactName: o.contact_name,
    language: o.language,
    providerNumber: o.provider_number,
    cadence: o.cadence,
    dueDays: o.due_days,
    remindersEnabled: o.reminders_enabled,
    isActive: o.is_active,
    note: o.note,
  }))
export type PayerOrganisation = z.output<typeof organisationPayload>

export async function fetchPayerOrganisations(): Promise<PayerOrganisation[]> {
  const { data, error } = await supabase.rpc('list_payer_organisations')
  if (error) throw error
  return parse(z.array(organisationPayload), data)
}

export interface OrganisationInput {
  id: string | null
  name: string
  billingEmail: string | null
  contactName: string | null
  language: DocumentLanguage
  providerNumber: string | null
  cadence: Cadence
  dueDays: number
  remindersEnabled: boolean
  isActive: boolean
  note: string | null
}

/** A PAE provider added, or an organisation (IVAC too) changed. Returns its id. */
export async function savePayerOrganisation(input: OrganisationInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'save_payer_organisation',
    sqlArgs<'save_payer_organisation'>({
      p_id: input.id,
      // Only PAE providers are added; an existing organisation keeps its kind.
      p_kind: input.id === null ? 'pae' : null,
      p_name: input.name,
      p_billing_email: input.billingEmail,
      p_contact_name: input.contactName,
      p_language: input.language,
      p_provider_number: input.providerNumber,
      p_cadence: input.cadence,
      p_due_days: input.dueDays,
      p_reminders_enabled: input.remindersEnabled,
      p_is_active: input.isActive,
      p_note: input.note,
    }),
  )
  if (error) throw error
  return parse(z.string(), data)
}

const settingsPayload = z
  .object({
    ivac_rate_cents: z.number().int().nullable(),
    ivac_rates: z.array(z.object({ effective_from: z.string(), session_cents: z.number().int() })),
  })
  .transform((r) => ({
    ivacRateCents: r.ivac_rate_cents,
    ivacRates: r.ivac_rates.map((x) => ({ effectiveFrom: x.effective_from, sessionCents: x.session_cents })),
  }))
export type PayerSettings = z.output<typeof settingsPayload>

export async function fetchPayerSettings(): Promise<PayerSettings> {
  const { data, error } = await supabase.rpc('get_payer_settings')
  if (error) throw error
  return parse(settingsPayload, data)
}

/** What IVAC pays per session from a day (FP-10): a new rate never rewrites issued invoices. */
export async function setIvacRate(effectiveFrom: string, sessionCents: number): Promise<void> {
  const { error } = await supabase.rpc('set_ivac_rate', { p_effective_from: effectiveFrom, p_session_cents: sessionCents })
  if (error) throw error
}

const clientPayerPayload = z
  .object({
    client_payer_id: z.string(),
    kind: z.enum(ORGANISATION_KINDS),
    organisation_name: z.string().nullable(),
    file_number: z.string().nullable(),
    is_stub: z.boolean(),
    organisation: z.object({ id: z.string(), name: z.string(), chosen: z.boolean(), billing_email: z.string().nullable() }).nullable(),
    period_from: z.string().nullable(),
    period_to: z.string().nullable(),
    used_cents: z.number().int(),
    used_sessions: z.number().int(),
    max_amount_cents: z.number().int().nullable(),
    max_sessions: z.number().int().nullable(),
    expired: z.boolean(),
    pending_cents: z.number().int(),
    options: z.array(z.object({ id: z.string(), name: z.string() })),
    budget_low: z.boolean(),
  })
  .transform((p) => ({
    clientPayerId: p.client_payer_id,
    kind: p.kind,
    organisationName: p.organisation_name,
    fileNumber: p.file_number,
    isStub: p.is_stub,
    organisation: p.organisation ? { id: p.organisation.id, name: p.organisation.name, chosen: p.organisation.chosen, billingEmail: p.organisation.billing_email } : null,
    periodFrom: p.period_from,
    periodTo: p.period_to,
    usedCents: p.used_cents,
    usedSessions: p.used_sessions,
    maxAmountCents: p.max_amount_cents,
    maxSessions: p.max_sessions,
    expired: p.expired,
    pendingCents: p.pending_cents,
    options: p.options,
    budgetLow: p.budget_low,
  }))
export type ClientPayerBilling = z.output<typeof clientPayerPayload>

export async function fetchClientPayersBilling(clientId: string): Promise<ClientPayerBilling[]> {
  const { data, error } = await supabase.rpc('get_client_payers_billing', { p_client_id: clientId })
  if (error) throw error
  return parse(z.array(clientPayerPayload), data)
}

/** The organisation a client's payer is billed to (null: the one found by itself again). */
export async function setClientPayerOrganisation(clientPayerId: string, organisationId: string | null): Promise<void> {
  const { error } = await supabase.rpc(
    'set_client_payer_organisation',
    sqlArgs<'set_client_payer_organisation'>({ p_client_payer_id: clientPayerId, p_organisation_id: organisationId }),
  )
  if (error) throw error
}

const queuePayload = z
  .object({
    organisation: z.object({
      id: z.string(),
      kind: z.enum(ORGANISATION_KINDS),
      name: z.string(),
      cadence: z.enum(CADENCES),
      billing_email: z.string().nullable(),
      is_active: z.boolean(),
    }),
    pending: z.array(
      z.object({
        client_payer_id: z.string(),
        client_id: z.string(),
        client_name: z.string().nullable(),
        client_number: z.number().int().nullable(),
        file_number: z.string().nullable(),
        sessions: z.number().int(),
        amount_cents: z.number().int(),
        oldest: z.string().nullable(),
        due: z.boolean(),
      }),
    ),
    drafts: z.array(
      z.object({
        id: z.string(),
        client_id: z.string(),
        client_name: z.string().nullable(),
        payer_reference: z.string().nullable(),
        total_cents: z.number().int(),
        lines: z.number().int(),
        created_at: z.string(),
      }),
    ),
    unpaid: z.object({ count: z.number().int(), balance_cents: z.number().int() }),
  })
  .transform((g) => ({
    organisation: {
      id: g.organisation.id,
      kind: g.organisation.kind,
      name: g.organisation.name,
      cadence: g.organisation.cadence,
      billingEmail: g.organisation.billing_email,
      isActive: g.organisation.is_active,
    },
    pending: g.pending.map((p) => ({
      clientPayerId: p.client_payer_id,
      clientId: p.client_id,
      clientName: p.client_name ?? '',
      clientNumber: p.client_number,
      fileNumber: p.file_number,
      sessions: p.sessions,
      amountCents: p.amount_cents,
      oldest: p.oldest,
      due: p.due,
    })),
    drafts: g.drafts.map((d) => ({
      id: d.id,
      clientId: d.client_id,
      clientName: d.client_name ?? '',
      payerReference: d.payer_reference,
      totalCents: d.total_cents,
      lines: d.lines,
      createdAt: d.created_at,
    })),
    unpaid: { count: g.unpaid.count, balanceCents: g.unpaid.balance_cents },
  }))
export type PayerQueueGroup = z.output<typeof queuePayload>

export async function fetchPayerQueue(): Promise<PayerQueueGroup[]> {
  const { data, error } = await supabase.rpc('list_payer_queue')
  if (error) throw error
  return parse(z.array(queuePayload), data)
}

/**
 * « Préparer les factures » (what is due by each organisation's cadence) or, with `closing`,
 * « Facturer les PAE » (every share left). Returns the drafts made.
 */
export async function preparePayerInvoices(organisationId: string | null, closing: boolean): Promise<string[]> {
  const { data, error } = await supabase.rpc(
    'prepare_payer_invoices',
    sqlArgs<'prepare_payer_invoices'>({ p_organisation_id: organisationId, p_closing: closing }),
  )
  if (error) throw error
  return parse(z.array(z.string()).nullable(), data) ?? []
}

/** A payer invoice by hand (a report billed to IVAC): the client's payer's draft. */
export async function createPayerInvoice(clientPayerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_payer_invoice', { p_client_payer_id: clientPayerId })
  if (error) throw error
  return parse(z.string(), data)
}
