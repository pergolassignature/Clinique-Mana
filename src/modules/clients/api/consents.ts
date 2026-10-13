import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/**
 * Client consents for the staff (Clients C5a): the catalogue, the rules and settings, the texts
 * (core document templates `clients.consent_<key>_<fr|en>`), the open requests, each client's
 * states; sending through `clients-consent-send`. Every payload is parsed here; a mismatch throws
 * UNEXPECTED_SHAPE (never Zod's issues, which could quote a value).
 */

export const UNEXPECTED_SHAPE = 'clients: unexpected consent shape'

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

const clauseSchema = z.object({ key: z.string(), kind: z.enum(['agree', 'yes_no']), text_fr: z.string(), text_en: z.string() })

const typeSchema = z
  .object({ key: z.string(), name_fr: z.string(), name_en: z.string(), clauses: z.array(clauseSchema), sort_order: z.number(), is_active: z.boolean() })
  .transform((r) => ({ key: r.key, name: r.name_fr, nameEn: r.name_en, clauses: r.clauses, isActive: r.is_active }))
export type ConsentType = z.output<typeof typeSchema>

/** The clinic's consents, in their order. */
export async function fetchConsentTypes(): Promise<ConsentType[]> {
  const { data, error } = await supabase
    .from('client_consent_types')
    .select('key, name_fr, name_en, clauses, sort_order, is_active')
    .order('sort_order')
    .order('key')
  if (error) throw error
  return parse(z.array(typeSchema), data)
}

export const TRIGGER_KINDS = ['general', 'service', 'payer_kind', 'professional_status', 'situation'] as const
export type TriggerKind = (typeof TRIGGER_KINDS)[number]

const ruleSchema = z
  .object({
    id: z.string(),
    consent_key: z.string(),
    trigger_kind: z.enum(TRIGGER_KINDS),
    target: z.string().nullable(),
    frequency: z.enum(['once', 'each_time']),
    is_active: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    consentKey: r.consent_key,
    triggerKind: r.trigger_kind,
    target: r.target,
    frequency: r.frequency,
    isActive: r.is_active,
  }))
export type ConsentRule = z.output<typeof ruleSchema>

export async function fetchConsentRules(): Promise<ConsentRule[]> {
  const { data, error } = await supabase
    .from('client_consent_rules')
    .select('id, consent_key, trigger_kind, target, frequency, is_active')
    .order('consent_key')
    .order('trigger_kind')
  if (error) throw error
  return parse(z.array(ruleSchema), data)
}

/** Creates or changes a rule (`set_client_consent_rule`, clients.manage); a refusal is a French P0001 with its HINT. */
export async function saveConsentRule(rule: Omit<ConsentRule, 'id'> & { id: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('set_client_consent_rule', {
    p_id: rule.id as string,
    p_consent_key: rule.consentKey,
    p_trigger_kind: rule.triggerKind,
    p_target: rule.target as string,
    p_frequency: rule.frequency,
    p_is_active: rule.isActive,
  })
  if (error) throw error
  return parse(z.string(), data)
}

const settingsSchema = z
  .object({
    due_days_before_first_appointment: z.number().int(),
    reminder_days: z.number().int(),
    pre_appointment_reminder_hours: z.number().int(),
    retention_policy: z.string().nullable(),
    signed_pdf_retention_years: z.number().int().nullable(),
  })
  .transform((r) => ({
    dueDays: r.due_days_before_first_appointment,
    reminderDays: r.reminder_days,
    preAppointmentHours: r.pre_appointment_reminder_hours,
    retentionPolicy: r.retention_policy,
    /** Years an ended consent's sealed PDF is kept; null: kept, nothing purged (CC-18). */
    retentionYears: r.signed_pdf_retention_years,
  }))
export type ConsentSettings = z.output<typeof settingsSchema>

export async function fetchConsentSettings(): Promise<ConsentSettings> {
  const { data, error } = await supabase
    .from('client_consent_settings')
    .select('due_days_before_first_appointment, reminder_days, pre_appointment_reminder_hours, retention_policy, signed_pdf_retention_years')
    .maybeSingle()
  if (error) throw error
  if (!data) return { dueDays: 1, reminderDays: 7, preAppointmentHours: 48, retentionPolicy: null, retentionYears: null }
  return parse(settingsSchema, data)
}

const SETTING_KEYS = {
  dueDays: 'due_days_before_first_appointment',
  reminderDays: 'reminder_days',
  preAppointmentHours: 'pre_appointment_reminder_hours',
  retentionPolicy: 'retention_policy',
  retentionYears: 'signed_pdf_retention_years',
} as const satisfies Record<keyof ConsentSettings, string>

export async function saveConsentSettings(patch: Partial<ConsentSettings>): Promise<ConsentSettings> {
  const p_patch = Object.fromEntries(Object.entries(patch).map(([k, v]) => [SETTING_KEYS[k as keyof ConsentSettings], v]))
  const { data, error } = await supabase.rpc('set_client_consent_settings', { p_patch })
  if (error) throw error
  return parse(settingsSchema, data)
}

const templateSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  published_version: z.number().int().nullable(),
  published_version_id: z.string().nullable(),
  published_at: z.string().nullable(),
  draft_version_id: z.string().nullable(),
})
const versionSchema = z.object({ id: z.string(), version: z.number().int(), body: z.unknown() })

/** The mark of the seeded placeholder texts (migration `clients_consents`): never published to clients. */
export const PLACEHOLDER_MARK = 'Texte provisoire'

const isPlaceholder = (body: unknown) => JSON.stringify(body ?? null).includes(PLACEHOLDER_MARK)

const KEY = /^clients\.consent_(.+)_(fr|en)$/

export interface ConsentTemplate {
  id: string
  consentKey: string
  language: 'fr' | 'en'
  title: string
  published: { id: string; version: number; publishedAt: string } | null
  /** The draft, and whether it is still the seeded placeholder (« Publier » is then hidden). */
  draft: { id: string; version: number; placeholder: boolean } | null
}

/**
 * The 14 consent texts: core's templates of the module (`list_document_templates`), with the
 * version in force and the draft (`list_document_template_versions`, only for a template that has
 * one: its number and whether it is still the placeholder).
 */
export async function fetchConsentTemplates(): Promise<ConsentTemplate[]> {
  const { data, error } = await supabase.rpc('list_document_templates', { p_module_key: 'clients' })
  if (error) throw error
  const rows = parse(z.array(templateSchema), data).filter((r) => KEY.test(r.key))
  return Promise.all(
    rows.map(async (r): Promise<ConsentTemplate> => {
      const [, consentKey = '', language = 'fr'] = KEY.exec(r.key) ?? []
      let draft: ConsentTemplate['draft'] = null
      if (r.draft_version_id) {
        const versions = await supabase.rpc('list_document_template_versions', { p_template_id: r.id })
        if (versions.error) throw versions.error
        const found = parse(z.array(versionSchema), versions.data).find((v) => v.id === r.draft_version_id)
        if (found) draft = { id: found.id, version: found.version, placeholder: isPlaceholder(found.body) }
      }
      const published =
        r.published_version_id !== null && r.published_version !== null && r.published_at !== null
          ? { id: r.published_version_id, version: r.published_version, publishedAt: r.published_at }
          : null
      return { id: r.id, consentKey, language: language as 'fr' | 'en', title: r.title, published, draft }
    }),
  )
}

export type Population = 'new_clients' | 'all_active'

/** Publishes a consent text's draft; returns how many signed consents were flagged « À signer de nouveau ». */
export async function publishConsentVersion(versionId: string, population: Population): Promise<number> {
  const { data, error } = await supabase.rpc('publish_client_consent_version', { p_version_id: versionId, p_population: population })
  if (error) throw error
  return parse(z.number().int(), data)
}

const toObtainSchema = z
  .object({
    request_id: z.string(),
    client_id: z.string(),
    client_name: z.string(),
    consent_key: z.string(),
    consent_name: z.string(),
    language: z.enum(['fr', 'en']),
    due_at: z.string().nullable(),
    is_overdue: z.boolean(),
    created_at: z.string(),
    last_sent_at: z.string(),
    reminded_at: z.string().nullable(),
    answered: z.boolean(),
    signing_status: z.string().nullable(),
  })
  .transform((r) => ({
    requestId: r.request_id,
    clientId: r.client_id,
    clientName: r.client_name,
    consentKey: r.consent_key,
    consentName: r.consent_name,
    language: r.language,
    dueAt: r.due_at,
    isOverdue: r.is_overdue,
    createdAt: r.created_at,
    lastSentAt: r.last_sent_at,
    remindedAt: r.reminded_at,
    answered: r.answered,
    signingStatus: r.signing_status,
  }))
export type ConsentToObtain = z.output<typeof toObtainSchema>

export const TO_OBTAIN_LIMIT = 500

/** « Consentements à obtenir »: the first TO_OBTAIN_LIMIT open requests, overdue first, then by due date; and how many there are. */
export async function fetchConsentsToObtain(): Promise<{ rows: ConsentToObtain[]; total: number }> {
  const { data, error, count } = await supabase
    .from('client_consents_to_obtain')
    .select('request_id, client_id, client_name, consent_key, consent_name, language, due_at, is_overdue, created_at, last_sent_at, reminded_at, answered, signing_status', {
      count: 'exact',
    })
    .order('is_overdue', { ascending: false })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at')
    .limit(TO_OBTAIN_LIMIT)
  if (error) throw error
  const rows = parse(z.array(toObtainSchema), data)
  return { rows, total: count ?? rows.length }
}

export const CONSENT_STATES = ['signed', 'resign', 'pending', 'overdue', 'withdrawn'] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

const statusSchema = z
  .object({
    consent_key: z.string(),
    state: z.enum(CONSENT_STATES),
    version_label: z.string().nullable(),
    signed_at: z.string().nullable(),
    request_id: z.string().nullable(),
    due_at: z.string().nullable(),
    last_sent_at: z.string().nullable(),
    consent_id: z.string().nullable(),
    withdrawn_at: z.string().nullable(),
    signed_file_id: z.string().nullable(),
    source: z.enum(['app', 'import']).nullable(),
    copy_sent_at: z.string().nullable(),
    in_force: z.boolean(),
  })
  .transform((r) => ({
    consentKey: r.consent_key,
    state: r.state,
    versionLabel: r.version_label,
    signedAt: r.signed_at,
    requestId: r.request_id,
    dueAt: r.due_at,
    lastSentAt: r.last_sent_at,
    /** The consent shown (in force, or the withdrawn one); null when only a request is out. */
    consentId: r.consent_id,
    withdrawnAt: r.withdrawn_at,
    /** Its sealed PDF (one press downloads it); null for an imported signature. */
    fileId: r.signed_file_id,
    source: r.source,
    copySentAt: r.copy_sent_at,
    /** Whether that consent is in force (« Retirer le consentement »), even with a new request out. */
    inForce: r.in_force,
  }))
export type ClientConsentStatus = z.output<typeof statusSchema>

/** One client's consents in force (or withdrawn) and open requests (the id in the filter is a file id, not personal data). */
export async function fetchClientConsentStatus(clientId: string): Promise<ClientConsentStatus[]> {
  const { data, error } = await supabase
    .from('client_consents_status')
    .select('consent_key, state, version_label, signed_at, request_id, due_at, last_sent_at, consent_id, withdrawn_at, signed_file_id, source, copy_sent_at, in_force')
    .eq('client_id', clientId)
  if (error) throw error
  return parse(z.array(statusSchema), data)
}

const sentSchema = z.object({
  request_id: z.string(),
  resent: z.boolean(),
  signers: z.array(z.object({ role: z.enum(['client', 'client_2']), sent: z.boolean(), code: z.string().optional() })),
})
export type ConsentSent = z.infer<typeof sentSchema>

/** « Envoyer »: a request to the people who must sign (`clients-consent-send`). Throws a FunctionCallError. */
export async function sendConsentRequest(clientId: string, consentKey: string): Promise<ConsentSent> {
  const data = await invokeFunction('clients-consent-send', { action: 'send', client_id: clientId, consent_key: consentKey, context_type: 'record', context_id: clientId })
  return parse(sentSchema, data)
}

/** « Renvoyer »: new links for an open request. */
export async function resendConsentRequest(requestId: string): Promise<ConsentSent> {
  const data = await invokeFunction('clients-consent-send', { action: 'resend', request_id: requestId })
  return parse(sentSchema, data)
}

const copySchema = z.object({
  consent_id: z.string(),
  copy_sent_at: z.string().nullable(),
  recipients: z.array(z.object({ role: z.enum(['client', 'client_2']), sent: z.boolean(), code: z.string().optional() })),
})
export type ConsentCopySent = z.infer<typeof copySchema>

/** « Envoyer la copie signée »: the sealed PDF emailed to the people who sign for the client today (C5b). Throws a FunctionCallError. */
export async function sendConsentCopy(consentId: string): Promise<ConsentCopySent> {
  const data = await invokeFunction('clients-consent-send', { action: 'copy', consent_id: consentId })
  return parse(copySchema, data)
}

/** « Retirer le consentement » (clients.manage): from now, with the note (3 to 500 characters). Returns when. */
export async function withdrawConsent(consentId: string, note: string): Promise<string> {
  const { data, error } = await supabase.rpc('withdraw_client_consent', { p_id: consentId, p_note: note })
  if (error) throw error
  return parse(z.string(), data)
}

/** « Annuler la demande » (refused once a signature has started). */
export async function cancelConsentRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_client_consent_request', { p_id: requestId })
  if (error) throw error
}

const versionClauseSchema = z.object({ key: z.string(), kind: z.enum(['agree', 'yes_no']), text: z.string() })
export type VersionClause = z.output<typeof versionClauseSchema>
const versionClausesSchema = z.object({ clauses: z.array(versionClauseSchema), editable: z.boolean() })
export type VersionClauses = z.output<typeof versionClausesSchema>

/**
 * A consent text version's « Oui / Non » clauses (CC-13), in its language: its own, else its
 * published version's, else the consent's; and whether the caller may change them (a draft,
 * clients.manage).
 */
export async function fetchConsentClauses(versionId: string): Promise<VersionClauses> {
  const { data, error } = await supabase.rpc('get_client_consent_clauses', { p_version_id: versionId })
  if (error) throw error
  return parse(versionClausesSchema, data)
}

/** Saves a draft's clauses (at most 20; texts trimmed); a French P0001 for a published one, no text, too many. */
export async function saveConsentClauses(versionId: string, clauses: VersionClause[]): Promise<VersionClause[]> {
  const { data, error } = await supabase.rpc('set_client_consent_clauses', { p_version_id: versionId, p_clauses: clauses })
  if (error) throw error
  return parse(z.array(versionClauseSchema), data)
}
