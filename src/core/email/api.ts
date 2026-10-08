import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/** Rows per page of « Historique d'envoi » (the RPC's default; it clamps the limit to 1–100). */
export const EMAIL_LOG_PAGE_SIZE = 50

/** The sender of the caller's org (`email_settings`). */
export interface EmailSender {
  from_name: string
  from_address: string
  reply_to: string | null
  sending_domain: string
}

/** What `set_email_sender` takes (normalised by `senderSchema`). */
export interface EmailSenderUpdate {
  from_name: string
  from_address: string
  reply_to: string | null
}

const variableSchema = z.object({
  path: z.string(),
  label: z.string(),
  sample: z.string(),
  required: z.boolean(),
  kind: z.string(),
})

/**
 * One effective template (`list_email_templates`): the clinic's override or the default. A
 * default has no version, change date or author; a template may have no button.
 */
const templateSchema = z.object({
  key: z.string(),
  module_key: z.string(),
  label: z.string(),
  description: z.string(),
  is_custom: z.boolean(),
  version: z.number(),
  updated_at: z.string().nullable(),
  updated_by_name: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  button_label: z.string().nullable(),
  variables: z.array(variableSchema),
})
export type EmailTemplate = z.infer<typeof templateSchema>

/** A template's text as the editor sends it: trimmed, no button as null. */
export interface EmailTemplateDraft {
  subject: string
  body: string
  button_label: string | null
}

/**
 * One row of « Historique d'envoi » (`list_email_log`, RLS applies). An anonymised row (24 months)
 * has no address; a row has an error code only when it failed.
 */
const logRowSchema = z.object({
  id: z.string(),
  template_key: z.string(),
  template_label: z.string(),
  status: z.string(),
  to_email: z.string().nullable(),
  subject_type: z.string(),
  subject_id: z.string(),
  created_at: z.string(),
  sent_at: z.string().nullable(),
  last_event_at: z.string().nullable(),
  error_code: z.string().nullable(),
})
export type EmailLogRow = z.infer<typeof logRowSchema>

/** The log's filters; null means any. `from` is an instant (start of the period). */
export interface EmailLogFilters {
  templateKey: string | null
  status: string | null
  from: string | null
}

/** Where the next page starts: the last row seen (keyset on `created_at`, then `id`). */
export interface EmailLogCursor {
  before: string
  beforeId: string
}

/** The rendered preview (`email-preview`). */
const previewSchema = z.object({ subject: z.string(), html: z.string(), text: z.string() })
type RenderedEmail = z.infer<typeof previewSchema>

/**
 * A refusal from an email function: its English `code` (`rate_limited`, `invalid_request`…, see
 * `_shared/auth.ts`), the HTTP status, the function's message and, for an unknown placeholder,
 * the `variable`. `network` (status 0) when the function could not be reached; `internal` when the
 * answer is not the function's JSON.
 */
export class EmailFunctionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly variable?: string,
  ) {
    super(message)
    this.name = 'EmailFunctionError'
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), variable: z.string().optional() }),
})

/** The error of a failed `functions.invoke`, as an EmailFunctionError. */
async function functionError(error: unknown): Promise<EmailFunctionError> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response
    const body = errorBodySchema.safeParse(await response.json().catch(() => null))
    return body.success
      ? new EmailFunctionError(body.data.error.code, response.status, body.data.error.message, body.data.error.variable)
      : new EmailFunctionError('internal', response.status, 'Unexpected answer')
  }
  if (error instanceof FunctionsFetchError) return new EmailFunctionError('network', 0, 'Function unreachable')
  return new EmailFunctionError('internal', 0, error instanceof Error ? error.message : 'Unexpected error')
}

/** The sender of the caller's org (RLS returns only their own; `settings.view`). */
export async function fetchEmailSender(): Promise<EmailSender> {
  const { data, error } = await supabase.from('email_settings').select('from_name, from_address, reply_to, sending_domain').single()
  if (error) throw error
  return data
}

/** Saves the sender (`settings.email_manage`; an address off the sending domain → 23514). */
export async function setEmailSender(sender: EmailSenderUpdate): Promise<void> {
  const { error } = await supabase.rpc('set_email_sender', {
    p_from_name: sender.from_name,
    p_from_address: sender.from_address,
    // Empty clears it (the RPC stores null).
    p_reply_to: sender.reply_to ?? '',
  })
  if (error) throw error
}

/** Changes the sending domain, moving the from address onto it (`settings.integrations_manage`). */
export async function setEmailSendingDomain(domain: string): Promise<void> {
  const { error } = await supabase.rpc('set_email_sending_domain', { p_domain: domain })
  if (error) throw error
}

/** The effective templates of the caller's org (core and enabled modules; `settings.view`). */
export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  const { data, error } = await supabase.rpc('list_email_templates')
  if (error) throw error
  return z.array(templateSchema).parse(data)
}

/** Saves the clinic's text of a template as its next version (`settings.email_manage`; P0001 when refused). */
export async function saveEmailTemplate(key: string, draft: EmailTemplateDraft): Promise<void> {
  const { error } = await supabase.rpc('save_email_template', {
    p_key: key,
    p_subject: draft.subject,
    p_body: draft.body,
    // Empty means no button (the RPC stores null).
    p_button_label: draft.button_label ?? '',
  })
  if (error) throw error
}

/** « Rétablir le texte par défaut »: removes the clinic's text (`settings.email_manage`). */
export async function resetEmailTemplate(key: string): Promise<void> {
  const { error } = await supabase.rpc('reset_email_template', { p_key: key })
  if (error) throw error
}

/** One page of the send log, newest first: the newest page for a null cursor. */
export async function listEmailLog(filters: EmailLogFilters, cursor: EmailLogCursor | null): Promise<EmailLogRow[]> {
  const { data, error } = await supabase.rpc('list_email_log', {
    p_limit: EMAIL_LOG_PAGE_SIZE,
    ...(filters.templateKey !== null && { p_template_key: filters.templateKey }),
    ...(filters.status !== null && { p_status: filters.status }),
    ...(filters.from !== null && { p_from: filters.from }),
    ...(cursor && { p_before: cursor.before, p_before_id: cursor.beforeId }),
  })
  if (error) throw error
  return z.array(logRowSchema).parse(data)
}

/** When the caller's org last received an event from `provider`; null when never (`settings.view`). */
export async function lastWebhookEventAt(provider: 'resend'): Promise<string | null> {
  const { data, error } = await supabase.rpc('last_webhook_event_at', { p_provider: provider })
  if (error) throw error
  // The generated type says string; max() over no row is null.
  return (data as string | null) ?? null
}

/** Renders a draft with the catalogue's sample values (`email-preview`, `settings.view`); stores and sends nothing. */
export async function previewEmail(key: string, draft: EmailTemplateDraft, signal?: AbortSignal): Promise<RenderedEmail> {
  const { data, error } = await supabase.functions.invoke('email-preview', { body: { template_key: key, ...draft }, signal })
  if (error) throw await functionError(error)
  const preview = previewSchema.safeParse(data)
  if (!preview.success) throw new EmailFunctionError('internal', 200, 'Unexpected answer')
  return preview.data
}

/**
 * « M'envoyer un test » (`email-test-send`, `settings.email_manage`): the draft, with sample values
 * and a « [Test] » subject, to the caller's own address (the function never takes a recipient).
 */
export async function sendTestEmail(key: string, draft: EmailTemplateDraft): Promise<void> {
  const { error } = await supabase.functions.invoke('email-test-send', { body: { template_key: key, ...draft } })
  if (error) throw await functionError(error)
}

/** The address Resend posts delivery events to; `org` only routes the event (the function checks the signature). */
export function webhookUrl(orgId: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resend-webhook?org=${encodeURIComponent(orgId)}`
}
