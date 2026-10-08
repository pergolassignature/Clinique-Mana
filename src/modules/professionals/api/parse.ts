import { z } from 'zod'
import { PROVINCES } from '@/shared/lib/field-schemas'
import {
  AVAILABILITY_PERIODS,
  GENDERS,
  INVITATION_STATES,
  MOTIF_CATEGORY_ICONS,
  OPEN_SUBMISSION_STATUSES,
  PAYER_TYPES,
  PROFESSIONAL_STATUSES,
  READINESS_ITEMS,
  READINESS_MISSING,
  READINESS_WARNINGS,
  SUBMISSION_KINDS,
} from '../lib/constants'

/**
 * Zod parsers of the module's RPC and view payloads, mapped to camelCase domain types.
 *
 * Why parse at all: the JSON RPCs are typed `Json` by the generator, and its view and set-returning
 * types are wrong in places (every view column nullable; `account_change`, `profile_id` and
 * `licence_number` non-null). Each payload is checked once here, so pages read plain types.
 * Objects drop unknown keys, so a column added by a later batch never breaks an older page.
 * Enumerations mirror the SQL checks (`../lib/constants`).
 */

/** The only message of a parse failure: the error boundary reports it, so it holds no row value. */
export const UNEXPECTED_SHAPE = 'professionals: unexpected RPC shape'

/** Parses a payload, throwing UNEXPECTED_SHAPE (never Zod's issues, which quote values) on a mismatch. */
export function parseRpc<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

// --- Catalogue (get_professionals_catalog) -------------------------------------------------------

/** The columns every list shares (key: every list but `languages`, whose code is its key). */
const listRow = { id: z.string(), name: z.string(), is_system: z.boolean(), sort_order: z.number(), is_active: z.boolean() }
const keyedRow = { ...listRow, key: z.string() }
const base = (r: { id: string; name: string; is_system: boolean; sort_order: number; is_active: boolean }) => ({
  id: r.id,
  name: r.name,
  isSystem: r.is_system,
  sortOrder: r.sort_order,
  isActive: r.is_active,
})
const keyed = (r: Parameters<typeof base>[0] & { key: string }) => ({ ...base(r), key: r.key })

const orderPayload = z
  .object({ ...keyedRow, acronym: z.string(), licence_label: z.string(), licence_pattern: z.string().nullable() })
  .transform((r) => ({ ...keyed(r), acronym: r.acronym, licenceLabel: r.licence_label, licencePattern: r.licence_pattern }))
const categoryPayload = z.object(keyedRow).transform(keyed)
const titlePayload = z
  .object({
    ...keyedRow,
    name_feminine: z.string().nullable(),
    name_masculine: z.string().nullable(),
    category_id: z.string(),
    order_id: z.string().nullable(),
  })
  .transform((r) => ({
    ...keyed(r),
    nameFeminine: r.name_feminine,
    nameMasculine: r.name_masculine,
    categoryId: r.category_id,
    orderId: r.order_id,
  }))
const clientelePayload = z
  .object({ ...keyedRow, min_age: z.number().nullable(), max_age: z.number().nullable() })
  .transform((r) => ({ ...keyed(r), minAge: r.min_age, maxAge: r.max_age }))
const motifCategoryPayload = z
  .object({ ...keyedRow, description: z.string().nullable(), icon: z.enum(MOTIF_CATEGORY_ICONS) })
  .transform((r) => ({ ...keyed(r), description: r.description, icon: r.icon }))
const motifPayload = z
  .object({ ...keyedRow, category_id: z.string().nullable(), is_restricted: z.boolean() })
  .transform((r) => ({ ...keyed(r), categoryId: r.category_id, isRestricted: r.is_restricted }))
const languagePayload = z.object({ ...listRow, code: z.string() }).transform((r) => ({ ...base(r), code: r.code }))
const deactivationReasonPayload = z
  .object({ ...keyedRow, requires_note: z.boolean(), disables_account: z.boolean() })
  .transform((r) => ({ ...keyed(r), requiresNote: r.requires_note, disablesAccount: r.disables_account }))

/** Professional orders (licensing bodies). A title with an order requires a licence (P4-6). */
export type ProfessionalOrder = z.output<typeof orderPayload>
export type ProfessionCategory = z.output<typeof categoryPayload>
/**
 * A title; `orderId` null means not regulated: no licence required. `nameFeminine` and
 * `nameMasculine` are the forms shown for a professional (null: the name), through `titleLabel`.
 */
export type ProfessionTitle = z.output<typeof titlePayload>
/** A clientèle: an age group (`minAge` set, `maxAge` null = « and over »), or none (couples, families, parents). */
export type Clientele = z.output<typeof clientelePayload>
export type MotifCategory = z.output<typeof motifCategoryPayload>
/** A motif; `categoryId` null (or an archived category) shows under « Sans catégorie » (P4-246). */
export type Motif = z.output<typeof motifPayload>
export type Language = z.output<typeof languagePayload>
export type DeactivationReason = z.output<typeof deactivationReasonPayload>

/** The eight lists of the caller's clinic, each in its sort order, archived rows included (`isActive`). */
export const catalogPayload = z
  .object({
    orders: z.array(orderPayload),
    categories: z.array(categoryPayload),
    titles: z.array(titlePayload),
    clienteles: z.array(clientelePayload),
    motif_categories: z.array(motifCategoryPayload),
    motifs: z.array(motifPayload),
    languages: z.array(languagePayload),
    deactivation_reasons: z.array(deactivationReasonPayload),
  })
  .transform(({ motif_categories, deactivation_reasons, ...lists }) => ({
    ...lists,
    motifCategories: motif_categories,
    deactivationReasons: deactivation_reasons,
  }))
export type ProfessionalsCatalog = z.output<typeof catalogPayload>

// --- Record (get_professional_record) ------------------------------------------------------------

const professionalPayload = z
  .object({
    id: z.string(),
    profile_id: z.string().nullable(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string(),
    personal_phone: z.string().nullable(),
    address_line1: z.string().nullable(),
    address_line2: z.string().nullable(),
    city: z.string().nullable(),
    province: z.enum(PROVINCES),
    postal_code: z.string().nullable(),
    country: z.string(),
    years_experience: z.number().nullable(),
    gender: z.enum(GENDERS).nullable(),
    status: z.enum(PROFESSIONAL_STATUSES),
    status_changed_at: z.string(),
    status_changed_by: z.string().nullable(),
    deactivation_reason_id: z.string().nullable(),
    deactivation_note: z.string().nullable(),
    deactivation_disabled_account: z.boolean(),
    activation_override_reason: z.string().nullable(),
    created_at: z.string(),
    created_by: z.string().nullable(),
    updated_at: z.string(),
  })
  .transform((p) => ({
    id: p.id,
    /** The provider's account, once the invitation is accepted (4b). */
    profileId: p.profile_id,
    firstName: p.first_name,
    lastName: p.last_name,
    email: p.email,
    personalPhone: p.personal_phone,
    addressLine1: p.address_line1,
    addressLine2: p.address_line2,
    city: p.city,
    province: p.province,
    postalCode: p.postal_code,
    country: p.country,
    yearsExperience: p.years_experience,
    gender: p.gender,
    status: p.status,
    statusChangedAt: p.status_changed_at,
    statusChangedBy: p.status_changed_by,
    deactivationReasonId: p.deactivation_reason_id,
    deactivationNote: p.deactivation_note,
    /** True when this module's deactivation disabled the account (reactivation re-enables it, P4-11). */
    deactivationDisabledAccount: p.deactivation_disabled_account,
    activationOverrideReason: p.activation_override_reason,
    createdAt: p.created_at,
    createdBy: p.created_by,
    updatedAt: p.updated_at,
  }))
export type Professional = z.output<typeof professionalPayload>

const publicProfileRowPayload = z
  .object({
    bio: z.string().nullable(),
    approach: z.string().nullable(),
    public_email: z.string().nullable(),
    public_phone: z.string().nullable(),
    updated_at: z.string(),
  })
  .transform((r) => ({ bio: r.bio, approach: r.approach, publicEmail: r.public_email, publicPhone: r.public_phone, updatedAt: r.updated_at }))
export type PublicProfile = z.output<typeof publicProfileRowPayload>

const matchingProfileRowPayload = z
  .object({
    accepting_new_clients: z.boolean(),
    availability_periods: z.array(z.enum(AVAILABILITY_PERIODS)),
    availability_note: z.string().nullable(),
    min_client_age: z.number().nullable(),
    women_only: z.boolean(),
    new_client_places: z.number().int().nullable(),
    new_client_places_set_at: z.string().nullable(),
    updated_at: z.string(),
  })
  .transform((r) => ({
    acceptingNewClients: r.accepting_new_clients,
    availabilityPeriods: r.availability_periods,
    availabilityNote: r.availability_note,
    /** The youngest client age the professional takes (« Enfants (8 ans et plus) »), null for none (P4-245). */
    minClientAge: r.min_client_age,
    /** Women clients only (« Femmes exclusivement », P4-245). */
    womenOnly: r.women_only,
    /** « Places offertes » (0–99), null when not tracked (P4-382). The places left are Demandes'. */
    newClientPlaces: r.new_client_places,
    /** When the number was last (re)declared: the database stamps it when the number changes; null with it. */
    newClientPlacesSetAt: r.new_client_places_set_at,
    updatedAt: r.updated_at,
  }))
export type MatchingProfile = z.output<typeof matchingProfileRowPayload>

/** « Bon à savoir » (P4-384): staff only; null without a note (and always for the provider). */
export const matchingNotePayload = z
  .object({ note: z.string(), updated_at: z.string() })
  .transform((r) => ({ note: r.note, updatedAt: r.updated_at }))
  .nullable()
export type MatchingNote = NonNullable<z.output<typeof matchingNotePayload>>

/**
 * One of the professional's titles (at most two, exactly one primary). Shared by the record and
 * `set_professional_professions`, whose generated type calls `licence_number` non-null.
 */
export const professionRowPayload = z
  .object({ id: z.string(), profession_title_id: z.string(), licence_number: z.string().nullable(), is_primary: z.boolean() })
  .transform((r) => ({ id: r.id, titleId: r.profession_title_id, licenceNumber: r.licence_number, isPrimary: r.is_primary }))
export type ProfessionRow = z.output<typeof professionRowPayload>

/** A held clientèle; `specialized` is the « ★ spécialisé » flag. */
export interface SpecializedRef {
  id: string
  specialized: boolean
}
const specializedRefPayload = z.object({ id: z.string(), specialized: z.boolean() })

const payerNumberPayload = z
  .object({ payer_type: z.enum(PAYER_TYPES), number: z.string() })
  .transform((r) => ({ type: r.payer_type, number: r.number }))
export type PayerNumber = z.output<typeof payerNumberPayload>

const readinessShape = z.object({
  /** Ready to activate without an override. */
  complete: z.boolean(),
  done: z.number(),
  total: z.number(),
  items: z.array(z.object({ key: z.enum(READINESS_ITEMS), done: z.boolean(), missing: z.array(z.enum(READINESS_MISSING)) })),
  warnings: z.array(z.enum(READINESS_WARNINGS)),
})
export type Readiness = z.output<typeof readinessShape>
export type ReadinessItem = Readiness['items'][number]


/** `get_professional_record`: the record page in one payload, null when the caller cannot read it. */
export const recordPayload = z
  .object({
    professional: professionalPayload,
    public_profile: publicProfileRowPayload,
    matching_profile: matchingProfileRowPayload,
    matching_note: matchingNotePayload,
    professions: z.array(professionRowPayload),
    clienteles: z.array(specializedRefPayload),
    motif_ids: z.array(z.string()),
    language_ids: z.array(z.string()),
    payer_numbers: z.array(payerNumberPayload),
    readiness: readinessShape,
  })
  .transform((r) => ({
    professional: r.professional,
    publicProfile: r.public_profile,
    matchingProfile: r.matching_profile,
    matchingNote: r.matching_note,
    professions: r.professions,
    clienteles: r.clienteles,
    motifIds: r.motif_ids,
    languageIds: r.language_ids,
    payerNumbers: r.payer_numbers,
    readiness: r.readiness,
  }))
  .nullable()
export type ProfessionalRecord = NonNullable<z.output<typeof recordPayload>>

// --- Onboarding (get_professional_onboarding, list_professional_invitation_states) ---------------

/** The invitation link that matters (A2.5): its state and times (timestamps, clinic timezone for display). */
export interface InvitationInfo {
  state: (typeof INVITATION_STATES)[number]
  sentAt: string
  expiresAt: string
  openedAt: string | null
  usedAt: string | null
}

/** The file's open submission (at most one): the onboarding questionnaire or an update request. */
export interface OpenSubmission {
  id: string
  kind: (typeof SUBMISSION_KINDS)[number]
  status: (typeof OPEN_SUBMISSION_STATUSES)[number]
  submittedAt: string | null
}

/**
 * Where the file stands in its onboarding (P4-270): the invitation link, the open submission and
 * whether an onboarding questionnaire was ever approved. A file with neither link nor submission
 * has none (null).
 */
export interface Onboarding {
  invitation: InvitationInfo | null
  submission: OpenSubmission | null
  onboardingApproved: boolean
}

const invitationPayload = z
  .object({
    state: z.enum(INVITATION_STATES),
    sent_at: z.string(),
    expires_at: z.string(),
    opened_at: z.string().nullable(),
    used_at: z.string().nullable(),
  })
  .transform((r): InvitationInfo => ({ state: r.state, sentAt: r.sent_at, expiresAt: r.expires_at, openedAt: r.opened_at, usedAt: r.used_at }))

const openSubmissionPayload = z
  .object({ id: z.string(), kind: z.enum(SUBMISSION_KINDS), status: z.enum(OPEN_SUBMISSION_STATUSES), submitted_at: z.string().nullable() })
  .transform((r): OpenSubmission => ({ id: r.id, kind: r.kind, status: r.status, submittedAt: r.submitted_at }))

/** `get_professional_onboarding`: the record's onboarding line, null without link or submission. */
export const onboardingPayload = z
  .object({ invitation: invitationPayload.nullable(), submission: openSubmissionPayload.nullable(), onboarding_approved: z.boolean() })
  .transform((r): Onboarding => ({ invitation: r.invitation, submission: r.submission, onboardingApproved: r.onboarding_approved }))
  .nullable()

/**
 * One row of `list_professional_invitation_states` (the whole clinic in one request, joined by the
 * list in memory). Flat columns: a file without a link has a null state and times, one without an
 * open submission null submission columns.
 */
export const invitationStateRowPayload = z
  .object({
    professional_id: z.string(),
    state: z.enum(INVITATION_STATES).nullable(),
    sent_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    opened_at: z.string().nullable(),
    used_at: z.string().nullable(),
    submission_id: z.string().nullable(),
    submission_kind: z.enum(SUBMISSION_KINDS).nullable(),
    submission_status: z.enum(OPEN_SUBMISSION_STATUSES).nullable(),
    submitted_at: z.string().nullable(),
    onboarding_approved: z.boolean(),
  })
  .transform((r): { professionalId: string; onboarding: Onboarding } => ({
    professionalId: r.professional_id,
    onboarding: {
      invitation:
        r.state && r.sent_at && r.expires_at
          ? { state: r.state, sentAt: r.sent_at, expiresAt: r.expires_at, openedAt: r.opened_at, usedAt: r.used_at }
          : null,
      submission:
        r.submission_id && r.submission_kind && r.submission_status
          ? { id: r.submission_id, kind: r.submission_kind, status: r.submission_status, submittedAt: r.submitted_at }
          : null,
      onboardingApproved: r.onboarding_approved,
    },
  }))

// --- List (professionals_list, list_professionals) -----------------------------------------------

/**
 * One row of `professionals_list`: ids, never labels (resolved from the cached catalogue). The
 * generated view type makes every column nullable; only these are, in fact.
 */
export const listRowPayload = z
  .object({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string(),
    status: z.enum(PROFESSIONAL_STATUSES),
    status_changed_at: z.string(),
    deactivation_reason_id: z.string().nullable(),
    has_account: z.boolean(),
    primary_title_id: z.string().nullable(),
    primary_licence_number: z.string().nullable(),
    /** Picks the title's form the list shows (P4-342). */
    gender: z.enum(GENDERS).nullable(),
    language_ids: z.array(z.string()),
    clientele_ids: z.array(z.string()),
    motif_ids: z.array(z.string()),
    // Left join: every professional has a matching profile (created with the record).
    accepting_new_clients: z.boolean().nullable(),
    matching_complete: z.boolean(),
    ready: z.boolean(),
    email_matches_login: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    status: r.status,
    statusChangedAt: r.status_changed_at,
    deactivationReasonId: r.deactivation_reason_id,
    hasAccount: r.has_account,
    primaryTitleId: r.primary_title_id,
    primaryLicenceNumber: r.primary_licence_number,
    gender: r.gender,
    languageIds: r.language_ids,
    clienteleIds: r.clientele_ids,
    motifIds: r.motif_ids,
    acceptingNewClients: r.accepting_new_clients ?? false,
    matchingComplete: r.matching_complete,
    ready: r.ready,
    emailMatchesLogin: r.email_matches_login,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    /**
     * Not a column of the view: the list joins `list_professional_invitation_states` in memory
     * (`withOnboarding`, P4-270); null until then, and for a file without link or submission.
     */
    onboarding: null as Onboarding | null,
  }))
export type ProfessionalListRow = z.output<typeof listRowPayload>

// --- History (list_professional_history) ---------------------------------------------------------

/**
 * One audit row of the professional, its 1:1 rows or its child rows. `changedFields`: for an
 * update `{column: {before, after}}`; for an insert or a delete, the row; redacted values are
 * `"[redacted]"` (even a null one on insert, 4a.4 note for 4a.15). The actor is null for rows
 * written by a seed, a migration or the system; the name is null for an actor of another clinic.
 */
export const historyEntryPayload = z
  .object({
    id: z.number(),
    created_at: z.string(),
    table_name: z.string(),
    record_id: z.string(),
    action: z.enum(['insert', 'update', 'delete', 'read']),
    changed_fields: z.unknown().nullable(),
    actor_id: z.string().nullable(),
    actor_name: z.string().nullable(),
    actor_role: z.string().nullable(),
    source: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    createdAt: r.created_at,
    tableName: r.table_name,
    recordId: r.record_id,
    action: r.action,
    changedFields: r.changed_fields ?? null,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    source: r.source,
  }))
export type HistoryEntry = z.output<typeof historyEntryPayload>

// --- Status changes (professionals-set-status, Task 4b.6) -----------------------------------------

/**
 * `professionals-set-status`'s answer to « Activer » / « Désactiver »: the status RPC's row and
 * whether the sign-in ban followed. `accountChange` is set only when the call disabled or
 * re-enabled the provider's account (the function then bans or unbans it); `profileId` is null
 * without an account change. `signinSynced` is false when Auth refused the ban or the unban
 * (P4-381): the status change stands, and « Réessayer » sends `sync_signin`.
 */
export const statusChangePayload = z
  .object({
    status: z.enum(PROFESSIONAL_STATUSES),
    account_change: z.enum(['disabled', 'enabled']).nullable(),
    profile_id: z.string().nullable(),
    signin_synced: z.boolean(),
  })
  .transform((r) => ({ status: r.status, accountChange: r.account_change, profileId: r.profile_id, signinSynced: r.signin_synced }))
export type StatusChange = z.output<typeof statusChangePayload>

/** `sync_signin`: the provider account's status (null without one) and whether the ban now follows it. */
export const signinSyncPayload = z
  .object({ account_status: z.enum(['active', 'disabled']).nullable(), signin_synced: z.boolean() })
  .transform((r) => ({ accountStatus: r.account_status, signinSynced: r.signin_synced }))
export type SigninSync = z.output<typeof signinSyncPayload>

// --- Module settings (get_professionals_settings) ------------------------------------------------

/**
 * `collectSin` is off until an admin turns it on after the accountant confirms (P4-7). The
 * invitation's lifetime (1–30 days) and its reminder delay (1–29 days, null for no reminder; shorter
 * than the lifetime, P4-308) are « Invitations »'s (4b.1). The fiche's render options (P4-353) are
 * on by default.
 */
export const settingsPayload = z
  .object({
    collect_sin: z.boolean(),
    invitation_expiry_days: z.number().int(),
    invitation_reminder_after_days: z.number().int().nullable(),
    fiche_show_pro_contact: z.boolean(),
    fiche_show_clinic_footer: z.boolean(),
    fiche_show_closing: z.boolean(),
  })
  .transform((s) => ({
    collectSin: s.collect_sin,
    invitationExpiryDays: s.invitation_expiry_days,
    invitationReminderAfterDays: s.invitation_reminder_after_days,
    ficheShowProContact: s.fiche_show_pro_contact,
    ficheShowClinicFooter: s.fiche_show_clinic_footer,
    ficheShowClosing: s.fiche_show_closing,
  }))
export type ProfessionalsSettings = z.output<typeof settingsPayload>
