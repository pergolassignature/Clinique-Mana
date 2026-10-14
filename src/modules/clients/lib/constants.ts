/**
 * The module's codes, mirroring the SQL checks of `*_clients_module.sql` and `*_clients_rpcs.sql`.
 * Identifiers are English; the French words are in the i18n (`modules.clients.*`).
 */

export const SEXES = ['female', 'male', 'other'] as const
export type Sex = (typeof SEXES)[number]

export const LANGUAGES = ['fr', 'en'] as const
export type ClientLanguage = (typeof LANGUAGES)[number]

/** Services et tarifs' variants (R-5): the rate applied to the client's sessions. */
export const RATE_VARIANTS = ['student', 'reduced'] as const
export type ClientRateVariant = (typeof RATE_VARIANTS)[number]

/** What the related person is to the client (`set_client_relation`'s p_type). */
export const RELATION_TYPES = ['parent', 'child', 'guardian', 'ward', 'spouse', 'sibling', 'other'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

/** The rights of one side of a relation (R-9, R-48, R-61). */
export const RELATION_RIGHTS = ['main_contact', 'manages_appointments', 'receives_communications', 'receives_invoices'] as const
export type RelationRight = (typeof RELATION_RIGHTS)[number]
export type RelationRights = Record<RelationRight, boolean>

export const PAYER_KINDS = ['ivac', 'pae'] as const
export type PayerKind = (typeof PAYER_KINDS)[number]

export const HOLDER_RELATIONS = ['self', 'spouse', 'parent', 'other'] as const
export type HolderRelation = (typeof HOLDER_RELATIONS)[number]

/** The list's state filter (`list_clients`' p_status). */
export const CLIENT_STATUSES = ['active', 'archived', 'all'] as const
export type ClientStatusFilter = (typeof CLIENT_STATUSES)[number]

/** The record's tabs, in order: the URL's last segment (`/clients/:id/:onglet`). */
export const RECORD_TABS = ['apercu', 'informations', 'proches', 'assurance-et-payeurs', 'consentements', 'demandes', 'visites-et-paiements', 'courriels', 'historique'] as const
export type ClientRecordTab = (typeof RECORD_TABS)[number]

/** A record's path, on a tab (Aperçu by default). */
export const clientPath = (id: string, tab: ClientRecordTab = 'apercu'): string => `/clients/${id}/${tab}`

