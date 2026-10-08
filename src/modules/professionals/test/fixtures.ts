/**
 * RPC payloads as the database returns them (snake_case JSON), shaped on the migrations'
 * `jsonb_build_object` calls (20261008084945 get_professionals_catalog, 20261008100634
 * get_professional_record / get_professional_readiness / get_professional_public_profile, the
 * professionals_list view). Test-only: no production file imports this one.
 */

export const IDS = {
  opq: '00000000-0000-4000-8000-0000000000a1',
  psychologie: '00000000-0000-4000-8000-0000000000b1',
  naturopathie: '00000000-0000-4000-8000-0000000000b2',
  psychologue: '00000000-0000-4000-8000-0000000000c1',
  naturopathe: '00000000-0000-4000-8000-0000000000c2',
  archivedTitle: '00000000-0000-4000-8000-0000000000c3',
  children: '00000000-0000-4000-8000-0000000000d1',
  seniors: '00000000-0000-4000-8000-0000000000d2',
  couples: '00000000-0000-4000-8000-0000000000d3',
  cbt: '00000000-0000-4000-8000-0000000000e1',
  innerLife: '00000000-0000-4000-8000-0000000000f1',
  archivedCategory: '00000000-0000-4000-8000-0000000000f2',
  anxiete: '00000000-0000-4000-8000-000000000101',
  deuil: '00000000-0000-4000-8000-000000000102',
  psychose: '00000000-0000-4000-8000-000000000103',
  orphan: '00000000-0000-4000-8000-000000000104',
  archivedMotif: '00000000-0000-4000-8000-000000000105',
  fr: '00000000-0000-4000-8000-000000000201',
  en: '00000000-0000-4000-8000-000000000202',
  leave: '00000000-0000-4000-8000-000000000301',
  other: '00000000-0000-4000-8000-000000000302',
  ended: '00000000-0000-4000-8000-000000000303',
  professional: '00000000-0000-4000-8000-000000001001',
  professionRow: '00000000-0000-4000-8000-000000001101',
  admin: '00000000-0000-4000-8000-000000002001',
} as const

const ref = (id: string, key: string, name: string, sort_order: number, extra: Record<string, unknown> = {}) => ({
  id,
  key,
  name,
  is_system: false,
  sort_order,
  is_active: true,
  ...extra,
})

export const CATALOG_JSON = {
  orders: [
    ref(IDS.opq, 'opq', 'Ordre des psychologues du Québec', 10, { acronym: 'OPQ', licence_label: 'N° de permis', licence_pattern: '^[0-9]{5}$' }),
  ],
  categories: [ref(IDS.psychologie, 'psychologie', 'Psychologie', 10), ref(IDS.naturopathie, 'naturopathie', 'Naturopathie', 60)],
  titles: [
    ref(IDS.psychologue, 'psychologue', 'Psychologue', 10, { category_id: IDS.psychologie, order_id: IDS.opq }),
    ref(IDS.naturopathe, 'naturopathe', 'Naturopathe', 60, { category_id: IDS.naturopathie, order_id: null }),
    ref(IDS.archivedTitle, 'ancien_titre', 'Ancien titre', 70, { category_id: IDS.psychologie, order_id: null, is_active: false }),
  ],
  clienteles: [
    ref(IDS.children, 'children', 'Enfants', 10, { min_age: 0, max_age: 12, is_system: true }),
    ref(IDS.seniors, 'seniors', 'Aînés', 40, { min_age: 65, max_age: null, is_system: true }),
    ref(IDS.couples, 'couples', 'Couples', 50, { min_age: null, max_age: null, is_system: true }),
  ],
  specialties: [ref(IDS.cbt, 'cbt', 'Thérapie cognitivo-comportementale (TCC)', 10)],
  motif_categories: [
    ref(IDS.innerLife, 'inner_life', 'Vie intérieure', 10, { description: 'Anxiété, dépression, estime de soi et bien-être émotionnel', icon: 'Brain' }),
    ref(IDS.archivedCategory, 'ancienne', 'Ancienne catégorie', 20, { description: null, icon: 'Leaf', is_active: false }),
  ],
  motifs: [
    ref(IDS.anxiete, 'anxiete', 'Anxiété', 10, { category_id: IDS.innerLife, is_restricted: false }),
    ref(IDS.deuil, 'deuil', 'Deuil', 20, { category_id: IDS.archivedCategory, is_restricted: false }),
    ref(IDS.psychose, 'psychose', 'Psychose', 30, { category_id: IDS.innerLife, is_restricted: true }),
    ref(IDS.orphan, 'sans_categorie', 'Sans catégorie', 40, { category_id: null, is_restricted: false }),
    ref(IDS.archivedMotif, 'ancien_motif', 'Ancien motif', 50, { category_id: IDS.innerLife, is_restricted: false, is_active: false }),
  ],
  languages: [
    { id: IDS.fr, code: 'fr', name: 'Français', is_system: true, sort_order: 10, is_active: true },
    { id: IDS.en, code: 'en', name: 'Anglais', is_system: false, sort_order: 20, is_active: true },
  ],
  deactivation_reasons: [
    ref(IDS.leave, 'leave', 'Congé', 10, { requires_note: false, disables_account: false }),
    ref(IDS.ended, 'collaboration_ended', 'Fin de collaboration', 20, { requires_note: false, disables_account: true }),
    ref(IDS.other, 'other', 'Autre', 40, { requires_note: true, disables_account: false, is_system: true }),
  ],
}

export const READINESS_JSON = {
  complete: false,
  done: 0,
  total: 1,
  items: [{ key: 'matching_profile', done: false, missing: ['clientele', 'motif'] }],
  warnings: [],
}

export const PROFESSIONAL_JSON = {
  id: IDS.professional,
  profile_id: null,
  first_name: 'Marie',
  last_name: 'Tremblay',
  email: 'marie.t@exemple.ca',
  personal_phone: '+15145551234',
  address_line1: '123, rue Saint-Denis',
  address_line2: null,
  city: 'Montréal',
  province: 'QC',
  postal_code: 'H2X 1Y4',
  country: 'CA',
  years_experience: 12,
  gender: null,
  status: 'draft',
  status_changed_at: '2026-10-08T12:00:00+00:00',
  status_changed_by: null,
  deactivation_reason_id: null,
  deactivation_note: null,
  deactivation_disabled_account: false,
  activation_override_reason: null,
  created_at: '2026-10-08T12:00:00+00:00',
  created_by: IDS.admin,
  updated_at: '2026-10-08T12:00:00+00:00',
}

export const RECORD_JSON = {
  professional: PROFESSIONAL_JSON,
  public_profile: {
    bio: null,
    approach: null,
    public_email: null,
    public_phone: null,
    created_at: '2026-10-08T12:00:00+00:00',
    updated_at: '2026-10-08T12:00:00+00:00',
  },
  matching_profile: {
    accepting_new_clients: true,
    availability_periods: ['am', 'evening'],
    availability_note: null,
    created_at: '2026-10-08T12:00:00+00:00',
    updated_at: '2026-10-08T12:00:00+00:00',
  },
  professions: [{ id: IDS.professionRow, profession_title_id: IDS.psychologue, licence_number: '12345', is_primary: true }],
  clienteles: [{ id: IDS.couples, specialized: true }],
  specialties: [],
  motif_ids: [IDS.anxiete],
  language_ids: [IDS.fr],
  payer_numbers: [{ payer_type: 'ivac', number: '123456' }],
  readiness: READINESS_JSON,
}

export const LIST_ROW_JSON = {
  id: IDS.professional,
  first_name: 'Marie',
  last_name: 'Tremblay',
  email: 'marie.t@exemple.ca',
  status: 'draft',
  status_changed_at: '2026-10-08T12:00:00+00:00',
  deactivation_reason_id: null,
  has_account: false,
  primary_title_id: IDS.psychologue,
  primary_licence_number: '12345',
  language_ids: [IDS.fr],
  clientele_ids: [IDS.couples],
  specialty_ids: [],
  motif_ids: [IDS.anxiete],
  accepting_new_clients: true,
  matching_complete: true,
  ready: true,
  email_matches_login: true,
  created_at: '2026-10-08T12:00:00+00:00',
  updated_at: '2026-10-08T12:00:00+00:00',
}

export const HISTORY_ROW_JSON = {
  id: 4012,
  created_at: '2026-10-08T12:05:00+00:00',
  table_name: 'professional_motifs',
  record_id: `${IDS.professional}:${IDS.anxiete}`,
  action: 'insert',
  changed_fields: { motif_id: IDS.anxiete },
  actor_id: IDS.admin,
  actor_name: 'Admin Local',
  actor_role: 'admin',
  source: 'app',
}
