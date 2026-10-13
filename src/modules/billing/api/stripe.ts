import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'

/*
 * Stripe and Interac (FS): a dossier's payers and their card on file (`get_client_stripe`), the
 * staff's Stripe actions (`billing-stripe`: the card link, « Prélever maintenant », « Retirer la
 * carte »), « À rapprocher » (`list_interac_notices`, `add_interac_notice`, `match_interac_notice`,
 * `ignore_interac_notice`), and the public pages' calls (`resolve-link`, `billing-stripe-checkout`).
 * A card's number never reaches the clinic: only its brand, last four digits and expiry.
 */

const chargeSchema = z.object({
  id: z.string(),
  invoice_id: z.string(),
  invoice_number: z.string().nullable(),
  kind: z.enum(['auto', 'manual']),
  amount_cents: z.number().int(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  failure_code: z.string().nullable(),
  created_at: z.string(),
})
export type StripeCharge = z.infer<typeof chargeSchema>

const payerSchema = z.object({
  payer_client_id: z.string(),
  name: z.string(),
  is_self: z.boolean(),
  card: z
    .object({
      brand: z.string().nullable(),
      last4: z.string(),
      exp_month: z.number().int().nullable(),
      exp_year: z.number().int().nullable(),
      consent_at: z.string().nullable(),
    })
    .nullable(),
  link_sent_at: z.string().nullable(),
  charges: z.array(chargeSchema),
})
export type StripePayer = z.infer<typeof payerSchema>

const clientStripeSchema = z.object({ configured: z.boolean(), payers: z.array(payerSchema) })
export type ClientStripe = z.infer<typeof clientStripeSchema>

/** A dossier's payers (the client, her default payer) with their card on file (billing.view). */
export async function fetchClientStripe(clientId: string): Promise<ClientStripe> {
  const { data, error } = await supabase.rpc('get_client_stripe', { p_client_id: clientId })
  if (error) throw error
  return clientStripeSchema.parse(data)
}

/** « Envoyer le lien pour enregistrer une carte » (billing.manage). */
export async function sendCardLink(payerClientId: string): Promise<void> {
  await invokeFunction('billing-stripe', { action: 'card_link', payer_client_id: payerClientId })
}

const chargeNowSchema = z.object({ status: z.enum(['succeeded', 'failed', 'pending']), failure_code: z.string().nullable() })

/** « Prélever maintenant » (billing.manage): the charge's outcome. */
export async function chargeNow(invoiceId: string): Promise<z.infer<typeof chargeNowSchema>> {
  return chargeNowSchema.parse(await invokeFunction('billing-stripe', { action: 'charge_now', invoice_id: invoiceId }))
}

/** « Retirer la carte » (billing.manage). */
export async function removeCard(payerClientId: string): Promise<void> {
  await invokeFunction('billing-stripe', { action: 'remove_card', payer_client_id: payerClientId })
}

// --- Interac « À rapprocher » ----------------------------------------------------------------------

export const NOTICE_STATES = ['to_match', 'matched', 'ignored'] as const
export type NoticeState = (typeof NOTICE_STATES)[number]

const suggestionSchema = z.object({
  invoice_id: z.string(),
  number: z.string().nullable(),
  issued_on: z.string().nullable(),
  balance_cents: z.number().int(),
  payer_name: z.string().nullable(),
  client_name: z.string().nullable(),
  amount_matches: z.boolean(),
  name_score: z.number().int(),
})
export type NoticeSuggestion = z.infer<typeof suggestionSchema>

const noticeSchema = z.object({
  id: z.string(),
  source: z.enum(['manual', 'gmail']),
  received_on: z.string(),
  amount_cents: z.number().int(),
  sender_name: z.string(),
  message: z.string().nullable(),
  reference: z.string().nullable(),
  status: z.enum(NOTICE_STATES),
  invoice_id: z.string().nullable(),
  invoice_number: z.string().nullable(),
  matched_at: z.string().nullable(),
  ignored_reason: z.string().nullable(),
  suggestions: z.array(suggestionSchema).nullable(),
})
export type InteracNotice = z.infer<typeof noticeSchema>

export async function listInteracNotices(status: NoticeState): Promise<InteracNotice[]> {
  const { data, error } = await supabase.rpc('list_interac_notices', { p_status: status })
  if (error) throw error
  return z.array(noticeSchema).parse(data)
}

export interface NewNotice {
  receivedOn: string
  amountCents: number
  senderName: string
  message: string
  reference: string
}

export async function addInteracNotice(input: NewNotice): Promise<void> {
  const { error } = await supabase.rpc('add_interac_notice', {
    p_received_on: input.receivedOn,
    p_amount_cents: input.amountCents,
    p_sender_name: input.senderName.trim(),
    p_message: input.message.trim() === '' ? undefined : input.message.trim(),
    p_reference: input.reference.trim() === '' ? undefined : input.reference.trim(),
  })
  if (error) throw error
}

export async function matchInteracNotice(noticeId: string, invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('match_interac_notice', { p_notice_id: noticeId, p_invoice_id: invoiceId })
  if (error) throw error
}

export async function ignoreInteracNotice(noticeId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('ignore_interac_notice', { p_notice_id: noticeId, p_reason: reason })
  if (error) throw error
}

// --- Public pages (/carte, /payer) ------------------------------------------------------------------

const cardLinkSchema = z.object({
  purpose: z.literal('billing_card_setup'),
  display: z.object({ clinic_name: z.string(), language: z.string(), first_name: z.string(), has_card: z.boolean() }),
})
export type CardLinkDisplay = z.infer<typeof cardLinkSchema>['display']

const payLinkSchema = z.object({
  purpose: z.literal('billing_pay'),
  display: z.object({
    clinic_name: z.string(),
    language: z.string(),
    invoice_number: z.string().nullable(),
    issued_on: z.string().nullable(),
    total_cents: z.number().int(),
    balance_cents: z.number().int(),
    available: z.boolean(),
  }),
})
export type PayLinkDisplay = z.infer<typeof payLinkSchema>['display']

/** What a card link opens; another purpose reads as `link_invalid`. */
export async function resolveCardLink(token: string): Promise<CardLinkDisplay> {
  const answer = cardLinkSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a card link')
  return answer.data.display
}

/** What a pay link opens; another purpose reads as `link_invalid`. */
export async function resolvePayLink(token: string): Promise<PayLinkDisplay> {
  const answer = payLinkSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a pay link')
  return answer.data.display
}

const checkoutSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('valid'), url: z.string() }),
  z.object({ state: z.literal('paid') }),
])

/** Opens Stripe Checkout for the link: its URL, or `paid` when the invoice is paid meanwhile. */
export async function openCheckout(token: string): Promise<z.infer<typeof checkoutSchema>> {
  return checkoutSchema.parse(await invokeFunction('billing-stripe-checkout', { token }))
}
