import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * The Gmail connection (CM1): the mailboxes and their sync state (`list_mail_connections`), the
 * module's settings (`get/set_communications_settings`: the Pub/Sub topic), and the four calls to
 * the functions: « Connecter une boîte » (`gmail-connect` start → Google's consent URL), the return
 * from Google (`gmail-callback`), « Synchroniser » (`gmail-sync`) and « Déconnecter »
 * (`gmail-connect` disconnect). Tokens never reach the browser: none of these answers carries one.
 */

const mailConnectionSchema = z.object({
  id: z.string(),
  email_address: z.string(),
  kind: z.enum(['shared', 'personal']),
  status: z.enum(['connected', 'needs_reconnect', 'disconnected']),
  /** A code (`invalid_grant`, `scope_missing`, `unauthorized`), never a text. */
  status_reason: z.string().nullable(),
  scopes: z.array(z.string()),
  connected_at: z.string(),
  connected_by_name: z.string().nullable(),
  disconnected_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  last_sync_status: z.enum(['ok', 'error']).nullable(),
  /** A code (`provider_error`, `history_unavailable`…), never a text. */
  last_error_code: z.string().nullable(),
  last_error_at: z.string().nullable(),
  sync_in_progress: z.boolean(),
  initial_sync_done: z.boolean(),
  watch_expires_at: z.string().nullable(),
  messages_synced: z.number(),
  thread_count: z.number(),
  unread_count: z.number(),
})
export type MailConnection = z.infer<typeof mailConnectionSchema>

/** The caller's mailboxes: the clinic's shared ones, and her own personal ones. */
export async function listMailConnections(): Promise<MailConnection[]> {
  const { data, error } = await supabase.rpc('list_mail_connections')
  if (error) throw error
  return z.array(mailConnectionSchema).parse(data)
}

const settingsSchema = z.object({ pubsub_topic: z.string().nullable() })
export type CommunicationsSettings = z.infer<typeof settingsSchema>

/** The effective settings (`communications.mailboxes_manage`). */
export async function fetchCommunicationsSettings(): Promise<CommunicationsSettings> {
  const { data, error } = await supabase.rpc('get_communications_settings')
  if (error) throw error
  return settingsSchema.parse(data)
}

/** Saves the topic (null clears it); a malformed name is a French P0001. Returns the effective settings. */
export async function saveCommunicationsSettings(patch: Partial<CommunicationsSettings>): Promise<CommunicationsSettings> {
  const { data, error } = await supabase.rpc('set_communications_settings', { p_patch: patch })
  if (error) throw error
  return settingsSchema.parse(data)
}

const startSchema = z.object({ url: z.url({ protocol: /^https?$/ }) })

/** « Connecter une boîte »: Google's consent page for the clinic's OAuth application (signed state, 10 minutes). */
export async function startGmailConnect(kind: 'shared' | 'personal' = 'shared'): Promise<string> {
  return startSchema.parse(await invokeFunction('gmail-connect', { action: 'start', kind })).url
}

const callbackSchema = z.object({ connection_id: z.string(), email_address: z.string() })
export type ConnectedMailbox = z.infer<typeof callbackSchema>

/** The return from Google: the code and the state it handed the browser, posted with the session. */
export async function finishGmailConnect(code: string, state: string): Promise<ConnectedMailbox> {
  return callbackSchema.parse(await invokeFunction('gmail-callback', { code, state }))
}

const syncSchema = z.object({
  outcome: z.enum(['synced', 'skipped', 'needs_reconnect', 'error']),
  messages: z.number(),
  attachments: z.number(),
  initial_pending: z.boolean(),
  code: z.string().optional(),
})
export type SyncResult = z.infer<typeof syncSchema>

/** « Synchroniser » one mailbox (`full`: the 45-day pass again). */
export async function syncMailConnection(connectionId: string, full = false): Promise<SyncResult> {
  return syncSchema.parse(await invokeFunction('gmail-sync', { connection_id: connectionId, ...(full && { full: true }) }))
}

const disconnectSchema = z.object({ ok: z.literal(true), revoked: z.boolean() })

/** « Déconnecter »: the watch stopped, the grant revoked at Google, the tokens deleted; the mirror stays. */
export async function disconnectMailConnection(connectionId: string): Promise<{ revoked: boolean }> {
  const { revoked } = disconnectSchema.parse(await invokeFunction('gmail-connect', { action: 'disconnect', connection_id: connectionId }))
  return { revoked }
}

/**
 * The push endpoint to give Pub/Sub's subscription. `org` routes the push; the token is the
 * secret « Jeton Pub/Sub » and is never shown again once saved, so the address carries a
 * placeholder the person replaces with it.
 */
export function gmailWebhookUrl(orgId: string, tokenPlaceholder: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-webhook?org=${encodeURIComponent(orgId)}&token=${tokenPlaceholder}`
}
