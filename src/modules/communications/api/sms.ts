import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'
import { threadLinkSchema, type ThreadLink } from './client-links'

/**
 * « Textos » (batch SM; *_communications_sms.sql): the threads (`sms_threads`, one row per number),
 * a thread's texts (`sms_messages`, RLS `communications.sms`), the staff's consent entry
 * (`set_sms_consent`) and a reply (`sms-send`, which sends it through the clinic's PBX at once).
 * Every payload is parsed here; a mismatch throws UNEXPECTED_SHAPE (never Zod's issues, which
 * quote values: numbers and bodies are personal data).
 */

export const UNEXPECTED_SHAPE = 'communications: unexpected SMS shape'

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

export const SMS_STATUSES = ['queued', 'sending', 'sent', 'failed', 'received'] as const
export type SmsStatus = (typeof SMS_STATUSES)[number]
export const SMS_KINDS = ['inbound', 'reply', 'reminder', 'confirmation', 'changed', 'consent_notice', 'opt_out_ack', 'test', 'other'] as const
export type SmsKind = (typeof SMS_KINDS)[number]
export type SmsConsentStatus = 'opted_in' | 'opted_out'

/** The most threads the list loads (newest first). */
export const THREADS_LIMIT = 200
/** The most texts a thread loads (its latest). */
export const THREAD_LIMIT = 200

const consentStatus = z.enum(['opted_in', 'opted_out']).nullable()

const threadSchema = z
  .object({
    peer_e164: z.string(),
    last_message_at: z.string(),
    last_direction: z.enum(['in', 'out']),
    last_status: z.enum(SMS_STATUSES),
    last_body: z.string().nullable(),
    last_body_purged: z.boolean(),
    last_has_media: z.boolean(),
    message_count: z.number().int(),
    last_inbound_at: z.string().nullable(),
    consent_status: consentStatus,
    // SM-15: the thread's file (null without one, or without clients.view).
    link_status: z.enum(['unlinked', 'needs_review', 'linked']).default('unlinked'),
    client_id: z.string().nullable().default(null),
    client_number: z.number().int().nullable().default(null),
    client_name: z.string().nullable().default(null),
  })
  .transform((r) => ({
    phone: r.peer_e164,
    lastMessageAt: r.last_message_at,
    lastDirection: r.last_direction,
    lastStatus: r.last_status,
    lastBody: r.last_body,
    lastBodyPurged: r.last_body_purged,
    lastHasMedia: r.last_has_media,
    messageCount: r.message_count,
    lastInboundAt: r.last_inbound_at,
    consent: r.consent_status,
    linkStatus: r.link_status,
    client: r.client_id && r.client_name !== null ? { id: r.client_id, clientNumber: r.client_number, name: r.client_name } : null,
  }))
export type SmsThread = z.output<typeof threadSchema>

const mediaSchema = z.array(
  z.object({ name: z.string().nullable().optional(), type: z.string().nullable().optional(), size: z.number().nullable().optional() }),
)

const messageSchema = z
  .object({
    id: z.string(),
    direction: z.enum(['in', 'out']),
    peer_e164: z.string().nullable(),
    kind: z.enum(SMS_KINDS),
    body: z.string().nullable(),
    body_purged_at: z.string().nullable(),
    media: mediaSchema,
    status: z.enum(SMS_STATUSES),
    error_code: z.string().nullable(),
    send_after: z.string().nullable(),
    created_at: z.string(),
    sent_at: z.string().nullable(),
  })
  .transform((r) => ({
    id: r.id,
    direction: r.direction,
    phone: r.peer_e164,
    kind: r.kind,
    body: r.body,
    purged: r.body_purged_at !== null,
    media: r.media.map((m) => ({ name: m.name ?? null, type: m.type ?? null })),
    status: r.status,
    errorCode: r.error_code,
    sendAfter: r.send_after,
    createdAt: r.created_at,
    sentAt: r.sent_at,
  }))
export type SmsMessage = z.output<typeof messageSchema>

/** « Toutes » or « À rattacher » (SM-15: not linked, never unlinked by a person). */
export const SMS_VIEWS = ['all', 'to_link'] as const
export type SmsView = (typeof SMS_VIEWS)[number]

/**
 * The clinic's threads, the latest first (200 at most), with their file (`list_sms_conversations`,
 * invoker: the caller's clinic and `communications.sms`; a file's name only with `clients.view`).
 * `search`: a file's name, or 3 digits or more of the number. An RPC, so neither the search nor a
 * number ever goes in a URL.
 */
export async function listSmsThreads(view: SmsView = 'all', search = ''): Promise<SmsThread[]> {
  const { data, error } = await supabase.rpc('list_sms_conversations', { p_view: view, p_search: search.trim() || undefined })
  if (error) throw error
  // The RPC names the number `phone`; the thread's schema reads it as the view did (`peer_e164`).
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]).map(({ phone, ...r }) => ({ ...r, peer_e164: phone })) : data
  return parse(z.array(threadSchema), rows)
}

/** A number's file (SM-15): linked, to review with its candidates, or none. */
export async function getSmsThreadLink(phone: string): Promise<ThreadLink> {
  const { data, error } = await supabase.rpc('get_sms_thread_link', { p_phone: phone })
  if (error) throw error
  return parse(threadLinkSchema, data)
}

/** « Rattacher » (a file's id) or « Détacher » (null): a person's choice, never undone by a later text. */
export async function setSmsThreadLink(phone: string, clientId: string | null): Promise<void> {
  const { error } = clientId
    ? await supabase.rpc('link_sms_thread', { p_phone: phone, p_client_id: clientId })
    : await supabase.rpc('unlink_sms_thread', { p_phone: phone })
  if (error) throw error
}

export const CLIENT_NUMBER_KINDS = ['mobile', 'home', 'work', 'linked'] as const
export type ClientNumberKind = (typeof CLIENT_NUMBER_KINDS)[number]

const clientNumberSchema = z
  .object({
    phone: z.string(),
    kind: z.enum(CLIENT_NUMBER_KINDS),
    consent_status: consentStatus,
    message_count: z.number().int(),
    last_message_at: z.string().nullable(),
    link_status: z.enum(['unlinked', 'needs_review', 'linked']),
  })
  .transform((r) => ({
    phone: r.phone,
    kind: r.kind,
    consent: r.consent_status,
    messageCount: r.message_count,
    lastMessageAt: r.last_message_at,
    linkStatus: r.link_status,
  }))
export type ClientNumber = z.output<typeof clientNumberSchema>

/** A file's numbers and threads (SM-16, `list_client_sms`: communications.sms and clients.view). */
export async function listClientSms(clientId: string): Promise<ClientNumber[]> {
  const { data, error } = await supabase.rpc('list_client_sms', { p_client_id: clientId })
  if (error) throw error
  return parse(z.array(clientNumberSchema), data)
}

/**
 * A thread's latest texts, oldest first (what the conversation shows); `truncated` when older ones
 * exist. Through `list_sms_thread` (RLS, communications.sms): the number travels in the RPC's body,
 * never in a request URL (a filtered table read would put it in the query string, which gateways log).
 */
export async function listSmsThread(phone: string): Promise<{ messages: SmsMessage[]; truncated: boolean }> {
  const { data, error } = await supabase.rpc('list_sms_thread', { p_phone: phone, p_limit: THREAD_LIMIT + 1 })
  if (error) throw error
  const rows = parse(z.array(messageSchema), data)
  return { messages: rows.slice(0, THREAD_LIMIT).reverse(), truncated: rows.length > THREAD_LIMIT }
}

/** The number of the thread a text belongs to (a notice's `/textos?message=<id>`), or null when it is gone or purged. */
export async function findSmsMessagePhone(id: string): Promise<string | null> {
  const { data, error } = await supabase.from('sms_messages').select('peer_e164').eq('id', id).maybeSingle()
  if (error) throw error
  return parse(z.object({ peer_e164: z.string().nullable() }).nullable(), data)?.peer_e164 ?? null
}

export interface SmsConsentInput {
  /** As typed: the database stores E.164. */
  phone: string
  status: SmsConsentStatus
  note?: string | null
}

/**
 * Records a consent given or withdrawn (`set_sms_consent`, communications.sms). A new consent also
 * queues the clinic's consent text, at once. Resolves with the number as stored (E.164); a refusal
 * is a French `P0001`.
 */
export async function setSmsConsent({ phone, status, note }: SmsConsentInput): Promise<{ phone: string; status: SmsConsentStatus }> {
  const { data, error } = await supabase.rpc('set_sms_consent', { p_phone: phone, p_status: status, ...(note ? { p_note: note } : {}) })
  if (error) throw error
  const row = parse(z.object({ phone_e164: z.string(), status: z.enum(['opted_in', 'opted_out']) }), data)
  return { phone: row.phone_e164, status: row.status }
}

/**
 * A reply (`sms-send`), sent through the PBX at once. Throws a `FunctionCallError`: a refusal
 * (no consent, a number that cannot be read) is a 400 `refusal`; a PBX failure a 502
 * `provider_error` and a setup gap a 503 `not_configured`, both with `extra.extra.code`.
 */
export async function sendSms(input: { to: string; body: string }): Promise<{ id: string }> {
  const data = await invokeFunction('sms-send', { to: input.to, body: input.body })
  const row = parse(z.object({ sms_message_id: z.string() }), data)
  return { id: row.sms_message_id }
}

/** « Envoyer un texto de test » (`sms-send` with `test`, communications.sms_manage): the clinic's consent text to `to`. */
export async function sendSmsTest(to: string): Promise<{ id: string }> {
  const data = await invokeFunction('sms-send', { test: true, to })
  const row = parse(z.object({ sms_message_id: z.string() }), data)
  return { id: row.sms_message_id }
}
