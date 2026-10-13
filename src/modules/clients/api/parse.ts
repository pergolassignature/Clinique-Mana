import { z } from 'zod'
import { HOLDER_RELATIONS, LANGUAGES, PAYER_KINDS, RATE_VARIANTS, RELATION_TYPES, SEXES } from '../lib/constants'

/**
 * Zod parsers of the module's RPC and view payloads, mapped to camelCase domain types. Objects drop
 * unknown keys, so a column a later batch adds never breaks an older page. A mismatch throws
 * UNEXPECTED_SHAPE, never Zod's issues (which quote values: personal data, Loi 25).
 */
export const UNEXPECTED_SHAPE = 'clients: unexpected RPC shape'

export function parseRpc<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

/** One row of `list_clients` (the list page). */
export const listRowPayload = z
  .object({
    id: z.string(),
    client_number: z.number().int(),
    first_name: z.string(),
    last_name: z.string(),
    birthday: z.string().nullable(),
    email: z.string().nullable(),
    mobile_e164: z.string().nullable(),
    primary_professional_id: z.string().nullable(),
    is_archived: z.boolean(),
    tag_ids: z.array(z.string()),
    rate_variant: z.enum(RATE_VARIANTS).nullable(),
    tax_exempt: z.boolean(),
    is_banned: z.boolean(),
    file_incomplete: z.boolean(),
    special_agreement: z.boolean(),
    sort_last: z.string(),
    sort_first: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    clientNumber: r.client_number,
    firstName: r.first_name,
    lastName: r.last_name,
    birthday: r.birthday,
    email: r.email,
    mobile: r.mobile_e164,
    primaryProfessionalId: r.primary_professional_id,
    isArchived: r.is_archived,
    tagIds: r.tag_ids,
    rateVariant: r.rate_variant,
    taxExempt: r.tax_exempt,
    isBanned: r.is_banned,
    fileIncomplete: r.file_incomplete,
    specialAgreement: r.special_agreement,
    /** The keyset cursor (the RPC's sort keys). */
    cursor: { last: r.sort_last, first: r.sort_first, id: r.id },
  }))
export type ClientListRow = z.output<typeof listRowPayload>

/** The `clients` row of `get_client_summary` (staff). */
export const clientPayload = z
  .object({
    id: z.string(),
    client_number: z.number().int(),
    first_name: z.string(),
    last_name: z.string(),
    birth_first_name: z.string().nullable(),
    pronouns: z.string().nullable(),
    sex: z.enum(SEXES).nullable(),
    birthday: z.string().nullable(),
    email: z.string().nullable(),
    mobile_e164: z.string().nullable(),
    home_e164: z.string().nullable(),
    work_e164: z.string().nullable(),
    work_ext: z.string().nullable(),
    language: z.enum(LANGUAGES),
    time_zone: z.string().nullable(),
    reminders_by_sms: z.boolean(),
    reminders_by_email: z.boolean(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    city: z.string().nullable(),
    province: z.string().nullable(),
    postal_code: z.string().nullable(),
    country: z.string(),
    referral_source_id: z.string().nullable(),
    referred_by: z.string().nullable(),
    // Optional: reads made before CL-30 (and other modules' rows) may not carry it.
    referred_by_client_id: z.string().nullable().optional(),
    custom_field: z.string().nullable(),
    primary_professional_id: z.string().nullable(),
    rate_variant: z.enum(RATE_VARIANTS).nullable(),
    tax_exempt: z.boolean(),
    is_banned: z.boolean(),
    file_incomplete: z.boolean(),
    special_agreement: z.boolean(),
    shared_custody: z.boolean(),
    external_ref: z.string().nullable(),
    archived_at: z.string().nullable(),
    merged_into_id: z.string().nullable(),
    anonymized_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    clientNumber: r.client_number,
    firstName: r.first_name,
    lastName: r.last_name,
    birthFirstName: r.birth_first_name,
    pronouns: r.pronouns,
    sex: r.sex,
    birthday: r.birthday,
    email: r.email,
    mobile: r.mobile_e164,
    home: r.home_e164,
    work: r.work_e164,
    workExt: r.work_ext,
    language: r.language,
    timeZone: r.time_zone,
    remindersBySms: r.reminders_by_sms,
    remindersByEmail: r.reminders_by_email,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    province: r.province,
    postalCode: r.postal_code,
    country: r.country,
    referralSourceId: r.referral_source_id,
    referredBy: r.referred_by,
    referredByClientId: r.referred_by_client_id ?? null,
    customField: r.custom_field,
    primaryProfessionalId: r.primary_professional_id,
    rateVariant: r.rate_variant,
    taxExempt: r.tax_exempt,
    isBanned: r.is_banned,
    fileIncomplete: r.file_incomplete,
    specialAgreement: r.special_agreement,
    sharedCustody: r.shared_custody,
    externalRef: r.external_ref,
    archivedAt: r.archived_at,
    mergedIntoId: r.merged_into_id,
    anonymizedAt: r.anonymized_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
export type Client = z.output<typeof clientPayload>

const rightsPayload = z
  .object({
    main_contact: z.boolean(),
    manages_appointments: z.boolean(),
    receives_communications: z.boolean(),
    receives_invoices: z.boolean(),
  })
  .transform((r) => ({
    main_contact: r.main_contact,
    manages_appointments: r.manages_appointments,
    receives_communications: r.receives_communications,
    receives_invoices: r.receives_invoices,
  }))

export const relationPayload = z
  .object({
    id: z.string(),
    related_id: z.string(),
    related_number: z.number().int(),
    related_name: z.string(),
    related_archived: z.boolean(),
    type: z.enum(RELATION_TYPES),
    related_rights: rightsPayload,
    client_rights: rightsPayload,
  })
  .transform((r) => ({
    id: r.id,
    relatedId: r.related_id,
    relatedNumber: r.related_number,
    relatedName: r.related_name,
    relatedArchived: r.related_archived,
    /** What the related person is to the client. */
    type: r.type,
    /** What the related person may do for the client. */
    relatedRights: r.related_rights,
    /** What the client may do for the related person. */
    clientRights: r.client_rights,
  }))
export type ClientRelation = z.output<typeof relationPayload>

export const insurancePayload = z
  .object({
    rank: z.union([z.literal(1), z.literal(2)]),
    insurer: z.string(),
    policy_number: z.string().nullable(),
    certificate_number: z.string().nullable(),
    holder_relation: z.enum(HOLDER_RELATIONS),
    holder_name: z.string().nullable(),
  })
  .transform((r) => ({
    rank: r.rank,
    insurer: r.insurer,
    policyNumber: r.policy_number,
    certificateNumber: r.certificate_number,
    holderRelation: r.holder_relation,
    holderName: r.holder_name,
  }))
export type ClientInsurance = z.output<typeof insurancePayload>

export const payerPayload = z
  .object({
    id: z.string(),
    kind: z.enum(PAYER_KINDS),
    organisation_name: z.string().nullable(),
    file_number: z.string().nullable(),
    session_amount_cents: z.number().int().nullable(),
    max_sessions: z.number().int().nullable(),
    max_amount_cents: z.number().int().nullable(),
    starts_on: z.string().nullable(),
    expires_on: z.string().nullable(),
    is_active: z.boolean(),
    note: z.string().nullable(),
    // FP: the terms Facturation splits by; `is_stub` for the import's payers to complete.
    coverage_percent: z.number().int().nullable().default(null),
    renewal_month: z.number().int().nullable().default(null),
    renewal_day: z.number().int().nullable().default(null),
    prior_used_cents: z.number().int().nullable().default(null),
    prior_used_sessions: z.number().int().nullable().default(null),
    prior_used_on: z.string().nullable().default(null),
    is_stub: z.boolean().default(false),
  })
  .transform((r) => ({
    id: r.id,
    kind: r.kind,
    organisationName: r.organisation_name,
    fileNumber: r.file_number,
    sessionAmountCents: r.session_amount_cents,
    maxSessions: r.max_sessions,
    maxAmountCents: r.max_amount_cents,
    startsOn: r.starts_on,
    expiresOn: r.expires_on,
    isActive: r.is_active,
    note: r.note,
    coveragePercent: r.coverage_percent,
    renewalMonth: r.renewal_month,
    renewalDay: r.renewal_day,
    priorUsedCents: r.prior_used_cents,
    priorUsedSessions: r.prior_used_sessions,
    priorUsedOn: r.prior_used_on,
    isStub: r.is_stub,
  }))
export type ClientPayer = z.output<typeof payerPayload>

/** The file a client was referred by (« Référé par », CL-30): no name once anonymised. */
export const referrerPayload = z
  .object({
    id: z.string(),
    client_number: z.number().int(),
    display_name: z.string().nullable(),
    anonymized: z.boolean(),
    archived: z.boolean(),
  })
  .transform((r) => ({ id: r.id, clientNumber: r.client_number, name: r.display_name, anonymized: r.anonymized, archived: r.archived }))
export type ClientReferrer = z.output<typeof referrerPayload>

export const summaryPayload = z
  .object({
    client: clientPayload,
    referrer: referrerPayload.nullable().optional(),
    notes: z
      .object({ admin_notes: z.string().nullable(), special_agreement_note: z.string().nullable() })
      .nullable(),
    relations: z.array(relationPayload),
    insurances: z.array(insurancePayload),
    payers: z.array(payerPayload),
    tags: z.array(z.object({ id: z.string(), name: z.string() })),
    professionals: z.array(
      z.object({ professional_id: z.string(), reason: z.string(), first_linked_at: z.string(), last_linked_at: z.string() }).transform((r) => ({
        professionalId: r.professional_id,
        reason: r.reason,
        firstLinkedAt: r.first_linked_at,
        lastLinkedAt: r.last_linked_at,
      })),
    ),
  })
  .transform((r) => ({
    client: r.client,
    adminNotes: r.notes?.admin_notes ?? null,
    specialAgreementNote: r.notes?.special_agreement_note ?? null,
    relations: r.relations,
    insurances: r.insurances,
    payers: r.payers,
    tags: r.tags,
    professionals: r.professionals,
    referrer: r.referrer ?? null,
  }))
export type ClientSummary = z.output<typeof summaryPayload>

/** One row of `find_client_duplicates` (the creation form's panel). */
export const duplicatePayload = z
  .object({
    client_id: z.string(),
    level: z.enum(['high', 'medium']),
    reasons: z.array(z.string()),
    client_number: z.number().int(),
    display_name: z.string(),
    birthday: z.string().nullable(),
    email: z.string().nullable(),
    mobile_e164: z.string().nullable(),
    is_archived: z.boolean(),
  })
  .transform((r) => ({
    clientId: r.client_id,
    level: r.level,
    reasons: r.reasons,
    clientNumber: r.client_number,
    displayName: r.display_name,
    birthday: r.birthday,
    email: r.email,
    mobile: r.mobile_e164,
    isArchived: r.is_archived,
  }))
export type ClientDuplicate = z.output<typeof duplicatePayload>

/** One row of `search_clients` (the relation picker). */
export const searchRowPayload = z
  .object({
    id: z.string(),
    client_number: z.number().int(),
    first_name: z.string(),
    last_name: z.string(),
    birthday: z.string().nullable(),
    email: z.string().nullable(),
    mobile_e164: z.string().nullable(),
    is_archived: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    clientNumber: r.client_number,
    name: `${r.first_name} ${r.last_name}`,
    birthday: r.birthday,
    email: r.email,
    mobile: r.mobile_e164,
    isArchived: r.is_archived,
  }))
export type ClientSearchRow = z.output<typeof searchRowPayload>

/** One row of `my_clients` (« Mes clients »). */
export const myClientPayload = z
  .object({
    id: z.string(),
    client_number: z.number().int(),
    display_name: z.string(),
    pronouns: z.string().nullable(),
    birthday: z.string().nullable(),
    language: z.enum(LANGUAGES),
    email: z.string().nullable(),
    mobile_e164: z.string().nullable(),
    is_primary: z.boolean(),
    reason: z.string(),
    first_linked_at: z.string(),
    is_archived: z.boolean(),
  })
  .transform((r) => ({
    id: r.id,
    clientNumber: r.client_number,
    name: r.display_name,
    pronouns: r.pronouns,
    birthday: r.birthday,
    language: r.language,
    email: r.email,
    mobile: r.mobile_e164,
    isPrimary: r.is_primary,
    reason: r.reason,
    firstLinkedAt: r.first_linked_at,
    isArchived: r.is_archived,
  }))
export type MyClient = z.output<typeof myClientPayload>

/** A row of a reference list read by the forms. */
/** A reference row (source, tag), inactive ones included: a file may still hold one. */
export const optionPayload = z.object({ id: z.string(), name: z.string(), is_active: z.boolean() }).transform((r) => ({ id: r.id, name: r.name, active: r.is_active }))
export type ClientOption = z.output<typeof optionPayload>

/**
 * The Loi 25 export's sections beyond the summary (`export_client_privacy`, C4): the files merged
 * into this one (each a summary), the consents (signed, their version, signers and answers) and when.
 */
export const exportExtraPayload = z
  .object({
    merged_files: z.array(summaryPayload),
    consents: z.array(
      z
        .object({
          consent_key: z.string(),
          name: z.string(),
          version_label: z.string(),
          language: z.string(),
          signed_at: z.string(),
          signed_by: z.unknown(),
          answers: z.unknown().nullable(),
          source: z.string(),
          superseded_at: z.string().nullable(),
          withdrawn_at: z.string().nullable(),
          withdrawal_note: z.string().nullable(),
        })
        .transform((r) => ({
          key: r.consent_key,
          name: r.name,
          version: r.version_label,
          language: r.language,
          signedAt: r.signed_at,
          signers: Array.isArray(r.signed_by)
            ? r.signed_by.flatMap((s: unknown) => (typeof s === 'object' && s !== null && typeof (s as { name?: unknown }).name === 'string' ? [(s as { name: string }).name] : []))
            : [],
          answers: r.answers,
          source: r.source,
          supersededAt: r.superseded_at,
          withdrawnAt: r.withdrawn_at,
          withdrawalNote: r.withdrawal_note,
        })),
    ),
    exported_at: z.string(),
  })
  .transform((r) => ({ mergedFiles: r.merged_files, consents: r.consents, exportedAt: r.exported_at }))
export type ClientExportExtra = z.output<typeof exportExtraPayload>
export type ClientExport = { summary: ClientSummary } & ClientExportExtra

/** One row of the record's « Historique » (`list_client_history`): an `audit_log` row, as the journal reads it. */
export const historyEntryPayload = z.object({
  id: z.number(),
  created_at: z.string(),
  table_name: z.string(),
  record_id: z.string(),
  action: z.string(),
  changed_fields: z.unknown().nullable(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_role: z.string().nullable(),
  source: z.string(),
})
export type ClientHistoryEntry = z.output<typeof historyEntryPayload>
