/**
 * The module's fixed vocabularies, mirroring the SQL checks (migrations 20261008082847 to
 * 20261008100634). Identifiers are English; their French labels live in `modules.professionals.*`.
 */

/** `professionals_status_check`, in lifecycle order. */
export const PROFESSIONAL_STATUSES = ['draft', 'invited', 'in_review', 'active', 'inactive'] as const
export type ProfessionalStatus = (typeof PROFESSIONAL_STATUSES)[number]

/**
 * The status as staff read it (P4-43): the stored `in_review` reads « À réviser » while a
 * submission waits for review and « En préparation » once the onboarding questionnaire is
 * approved (`displayStatus`, `lib/onboarding.ts`). The list's status filter uses these.
 */
export const DISPLAY_STATUSES = ['draft', 'invited', 'in_review', 'preparing', 'active', 'inactive'] as const
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number]

/**
 * The state of a file's invitation link (`private.professional_onboarding_states`, A2.5): the
 * link that matters is the used one, else the live one, else the newest.
 */
export const INVITATION_STATES = ['sent', 'opened', 'expired', 'used', 'revoked'] as const
export type InvitationState = (typeof INVITATION_STATES)[number]

/** `professional_submissions.kind`: the questionnaire of the invitation, or an update request. */
export const SUBMISSION_KINDS = ['onboarding', 'update'] as const
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number]

/** The statuses of an open submission (one per file at most): being filled in, or sent for review. */
export const OPEN_SUBMISSION_STATUSES = ['draft', 'submitted'] as const
export type OpenSubmissionStatus = (typeof OPEN_SUBMISSION_STATUSES)[number]

/**
 * `professional_submissions_status_check`: being filled in (or sent back), sent for review,
 * applied, or closed without review (P4-301).
 */
export const SUBMISSION_STATUSES = ['draft', 'submitted', 'approved', 'cancelled'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/**
 * `private.submission_fields()`: the thirty fields a submission can answer, in the questionnaire's
 * order (the review lists them so, `apply_professional_submission` applies them so).
 */
export const SUBMISSION_FIELDS = [
  'personal_phone',
  'address_line1',
  'address_line2',
  'city',
  'province',
  'postal_code',
  'professions',
  'years_experience',
  'bio',
  'approach',
  'public_email',
  'public_phone',
  'language_ids',
  'clienteles',
  'min_client_age',
  'women_only',
  'motif_ids',
  'accepting_new_clients',
  'availability_periods',
  'availability_note',
  'photo',
  'insurance',
  'business_number',
  'gst_number',
  'qst_number',
  'bank_institution',
  'bank_transit',
  'bank_account',
  'sin',
  'consent',
] as const
export type SubmissionField = (typeof SUBMISSION_FIELDS)[number]

/** A field's kind in `private.submission_fields()`: how its value is shaped and applied. */
export const SUBMISSION_FIELD_KINDS = ['plain', 'set', 'file', 'private', 'consent'] as const
export type SubmissionFieldKind = (typeof SUBMISSION_FIELD_KINDS)[number]

/** The `private` fields of `private.submission_fields()`: applied to `professional_private` (its masks change). */
export const PRIVATE_SUBMISSION_FIELDS: ReadonlySet<SubmissionField> = new Set([
  'business_number',
  'gst_number',
  'qst_number',
  'bank_institution',
  'bank_transit',
  'bank_account',
  'sin',
])

/** The `set` fields of `private.submission_fields()`: they change the lists' « Utilisé par » counts. */
export const SET_SUBMISSION_FIELDS: ReadonlySet<SubmissionField> = new Set(['professions', 'language_ids', 'clienteles', 'motif_ids'])

/** `private.submission_sections()`: the questionnaire's eleven sections, in its order (P4-276). */
export const SUBMISSION_SECTIONS = [
  'personal',
  'professional',
  'portrait',
  'languages',
  'clienteles',
  'motifs',
  'availability',
  'photo',
  'insurance',
  'tax_bank',
  'consent',
] as const
export type SubmissionSection = (typeof SUBMISSION_SECTIONS)[number]

/** `professionals_gender_check` (P4-5: staff only, for the client's preference). */
export const GENDERS = ['female', 'male', 'unspecified'] as const
export type Gender = (typeof GENDERS)[number]

/** `professional_matching_profiles_availability_periods_check` (P4-4), in display order. */
export const AVAILABILITY_PERIODS = ['am', 'pm', 'end_of_day', 'evening', 'weekend'] as const
export type AvailabilityPeriod = (typeof AVAILABILITY_PERIODS)[number]

/** `professional_payer_numbers_payer_type_check`. */
export const PAYER_TYPES = ['ivac'] as const
export type PayerType = (typeof PAYER_TYPES)[number]

/** `motif_categories_icon_check`: the 20 Lucide icons of the categories editor. */
export const MOTIF_CATEGORY_ICONS = [
  'Brain',
  'Users',
  'AlertTriangle',
  'Briefcase',
  'GraduationCap',
  'Fingerprint',
  'Shield',
  'Leaf',
  'Heart',
  'Activity',
  'Star',
  'Zap',
  'Cloud',
  'Sun',
  'Moon',
  'Home',
  'Target',
  'Compass',
  'Sparkles',
  'MessageCircle',
] as const
export type MotifCategoryIcon = (typeof MOTIF_CATEGORY_ICONS)[number]

/**
 * The eight reference lists, by table name: what `set_professionals_reference_active`,
 * `reorder_professionals_reference` and `list_professionals_reference_usage` call a « kind ».
 */
export const REFERENCE_KINDS = [
  'professional_orders',
  'profession_categories',
  'profession_titles',
  'clienteles',
  'motif_categories',
  'motifs',
  'languages',
  'deactivation_reasons',
] as const
export type ReferenceKind = (typeof REFERENCE_KINDS)[number]

/** `get_professional_readiness` items (4a: one; 4b–4d append theirs; an item without `missing` keys names its own gap). */
export const READINESS_ITEMS = ['matching_profile', 'account_created', 'submission_approved'] as const
export type ReadinessItemKey = (typeof READINESS_ITEMS)[number]

/** What a readiness item can lack, in the order the RPC lists them. */
export const READINESS_MISSING = ['profession', 'licence', 'regulated_title', 'language', 'clientele', 'motif'] as const
export type ReadinessMissing = (typeof READINESS_MISSING)[number]

/** Readiness warnings: noted, but not gaps (`complete` stays true). */
export const READINESS_WARNINGS = ['login_email_mismatch'] as const
export type ReadinessWarning = (typeof READINESS_WARNINGS)[number]

/** The record's tabs (P4-13), as URL segments: `/professionnels/:id/:onglet`. */
export const RECORD_TABS = ['apercu', 'jumelage', 'profil-public', 'identite', 'documents', 'remuneration', 'historique'] as const
export type RecordTab = (typeof RECORD_TABS)[number]

/** A record's URL, on « Aperçu » unless a tab is named. */
export const recordPath = (id: string, tab: RecordTab = 'apercu') => `/professionnels/${id}/${tab}`

/** Rows per page of the list (4a.10; the page number is in the URL). */
export const PAGE_SIZE = 25

/** The most ids a set RPC or a list filter takes (`22023` beyond). */
export const MAX_SET_SIZE = 500
