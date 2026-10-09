import { describe, expect, expectTypeOf, it } from 'vitest'
import { fieldLabel, tableLabel } from '@/core/audit/labels'
import type { Tables } from '@/core/supabase/database.types'
import { PROFESSIONALS_AUDITED_TABLES, professionalsAuditLabels } from './lib/audit-labels'

/**
 * Every audited table of the module and its columns: the Journal d'audit and the Historique tab
 * name them through the module's labels (`modules.professionals.audit.tables.<table>` and
 * `.fields.<table>.<column>`, or core's `audit.commonFields.<column>`). The type check below fails
 * when a migration adds a column; `src/app/audit-labels.test.ts` checks the tables against the
 * migrations' audit triggers.
 */
const COLUMNS = {
  professional_orders: ['id', 'org_id', 'key', 'name', 'acronym', 'licence_label', 'licence_pattern', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  profession_categories: ['id', 'org_id', 'key', 'name', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  profession_titles: ['id', 'org_id', 'key', 'name', 'name_feminine', 'name_masculine', 'category_id', 'order_id', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  clienteles: ['id', 'org_id', 'key', 'name', 'min_age', 'max_age', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  motif_categories: ['id', 'org_id', 'key', 'name', 'description', 'icon', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  motifs: ['id', 'org_id', 'key', 'name', 'category_id', 'is_restricted', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  languages: ['id', 'org_id', 'code', 'name', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  deactivation_reasons: ['id', 'org_id', 'key', 'name', 'requires_note', 'disables_account', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  professionals: [
    'id', 'org_id', 'profile_id', 'first_name', 'last_name', 'email', 'personal_phone', 'address_line1', 'address_line2', 'city', 'province',
    'postal_code', 'country', 'years_experience', 'gender', 'status', 'status_changed_at', 'status_changed_by', 'deactivation_reason_id',
    'deactivation_note', 'deactivation_disabled_account', 'activation_override_reason', 'created_at', 'created_by', 'updated_at',
    'fiche_generated_at',
  ],
  professional_public_profiles: ['org_id', 'professional_id', 'bio', 'approach', 'public_email', 'public_phone', 'photo_document_id', 'created_at', 'updated_at'],
  professional_matching_profiles: [
    'org_id', 'professional_id', 'accepting_new_clients', 'availability_periods', 'availability_note', 'min_client_age', 'women_only',
    'new_client_places', 'new_client_places_set_at', 'created_at', 'updated_at',
  ],
  // « Bon à savoir » (P4-384): the text is redacted in the log; the field is still named.
  professional_matching_notes: ['org_id', 'professional_id', 'note', 'created_at', 'updated_at'],
  professional_professions: ['id', 'org_id', 'professional_id', 'profession_title_id', 'licence_number', 'is_primary', 'created_at', 'updated_at'],
  professional_clienteles: ['org_id', 'professional_id', 'clientele_id', 'is_specialized', 'created_at', 'updated_at'],
  professional_motifs: ['org_id', 'professional_id', 'motif_id', 'created_at'],
  professional_languages: ['org_id', 'professional_id', 'language_id', 'created_at'],
  professional_payer_numbers: ['org_id', 'professional_id', 'payer_type', 'number', 'created_at', 'updated_at'],
  // 4a.17 (labels added by 4a.18): the private data (every value redacted in the log).
  professional_private: [
    'professional_id', 'org_id', 'sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number', 'bank_institution', 'bank_transit',
    'bank_account', 'bank_account_last4', 'key_version', 'created_at', 'updated_at', 'updated_by',
  ],
  // The retention program (P4-180…): the clinic's grids and other rates, and each professional's months, rates and agreements.
  compensation_rates: ['id', 'org_id', 'kind', 'retention_pct', 'effective_from', 'effective_to', 'created_at', 'created_by'],
  retention_grids: ['id', 'org_id', 'title_id', 'effective_from', 'effective_to', 'note', 'created_at', 'created_by'],
  retention_grid_tiers: ['org_id', 'grid_id', 'threshold_sessions', 'retention_pct'],
  retention_grid_prices: ['org_id', 'grid_id', 'duration', 'client_price_cents'],
  professional_session_counts: [
    'id', 'org_id', 'professional_id', 'month', 'sessions_50_60', 'sessions_30', 'adjustment', 'note', 'created_at', 'created_by', 'updated_at', 'updated_by',
  ],
  professional_retention: [
    'id', 'org_id', 'professional_id', 'retention_pct', 'decision', 'tier_threshold', 'suggested_pct', 'sessions_total', 'effective_from', 'effective_to',
    'note', 'created_at', 'created_by',
  ],
  professional_client_agreements: [
    'id', 'org_id', 'professional_id', 'client_label', 'client_id', 'duration', 'professional_amount_cents', 'client_price_cents', 'effective_from',
    'effective_to', 'note', 'created_at', 'created_by',
  ],
  // 4c.2: « Documents requis » and the professionals' documents.
  document_types: [
    'id', 'org_id', 'key', 'name', 'is_system', 'required', 'expiry_rule', 'reminder_days', 'weekly_after_expiry', 'accepted_mime', 'max_bytes',
    'sort_order', 'is_active', 'created_at', 'updated_at',
  ],
  professional_documents: [
    'id', 'org_id', 'professional_id', 'document_type_id', 'stored_file_id', 'status', 'expires_on', 'metadata', 'uploaded_by', 'uploaded_at',
    'reviewed_by', 'reviewed_at', 'rejection_reason', 'submission_id', 'signature_request_id', 'created_at', 'updated_at',
  ],
  // 4b: the questionnaire, its private data, the invitation deliveries; 4c–4d: consents and contracts.
  professional_submissions: [
    'id', 'org_id', 'professional_id', 'kind', 'status', 'requested_by', 'requested_sections', 'secure_link_id', 'prefill', 'submitted_values',
    'submitted_at', 'private_saved_at', 'reviewed_by', 'reviewed_at', 'decision_note', 'applied_fields', 'created_at', 'updated_at',
  ],
  professional_submission_private: [
    'submission_id', 'professional_id', 'org_id', 'sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number', 'bank_institution',
    'bank_transit', 'bank_account', 'bank_account_last4', 'key_version', 'created_at', 'updated_at',
  ],
  professional_consents: [
    'id', 'org_id', 'professional_id', 'consent_version_id', 'submission_id', 'signer_name', 'signed_at', 'expires_on', 'withdrawn_at',
    'withdrawal_effective_on', 'created_at',
  ],
  professional_invitation_deliveries: ['id', 'org_id', 'professional_id', 'link_id', 'method', 'email_failure', 'created_at', 'created_by'],
  professional_contract_snapshots: [
    'id', 'org_id', 'professional_id', 'template_version_id', 'title', 'template_values', 'annexe', 'signers', 'idempotency_key', 'created_at',
    'created_by',
  ],
  consent_versions: ['id', 'org_id', 'key', 'version', 'title', 'body', 'published_at', 'published_by', 'created_at', 'updated_at'],
} as const

type ModuleTable = keyof typeof COLUMNS
/** The columns of each table the list above misses: never, table by table. */
type Missing = { [T in ModuleTable]: Exclude<keyof Tables<T>, (typeof COLUMNS)[T][number]> }[ModuleTable]

const MODULE = [professionalsAuditLabels]

describe('audit labels of the professionals tables', () => {
  it('lists every column of every table (type check)', () => {
    expectTypeOf<Missing>().toEqualTypeOf<never>()
  })

  it('offers every table in the journal\'s « Section » filter', () => {
    expect([...PROFESSIONALS_AUDITED_TABLES].sort()).toEqual(Object.keys(COLUMNS).sort())
  })

  for (const [table, columns] of Object.entries(COLUMNS)) {
    it(`names ${table} and each of its columns in French`, () => {
      expect(tableLabel(table, MODULE)).not.toBe(table)
      for (const column of columns) expect(fieldLabel(table, column, MODULE), column).not.toBe(column)
    })
  }
})

describe('values of the professionals tables', () => {
  const value = professionalsAuditLabels.value

  it('reads statuses and codes in French', () => {
    expect(value('professionals', 'status', 'in_review')).toBe('À réviser')
    expect(value('professionals', 'gender', 'female')).toBe('Femme')
    expect(value('professional_documents', 'status', 'verified')).toBe('Vérifié')
    expect(value('document_types', 'expiry_rule', 'next_march_31')).toBe('Le 31 mars suivant')
    expect(value('professional_submissions', 'status', 'submitted')).toBe('Envoyé, à réviser')
    expect(value('professional_submissions', 'kind', 'update')).toBe('Mise à jour du profil')
    expect(value('professional_invitation_deliveries', 'method', 'copied')).toBe('Lien copié')
    expect(value('professional_retention', 'decision', 'maintained')).toBe('Taux maintenu')
  })

  it('reads months, durations, rates and amounts as the module shows them', () => {
    expect(value('professional_session_counts', 'month', '2026-10-01')).toBe('octobre 2026')
    expect(value('professional_client_agreements', 'duration', 60)).toBe('60 min / couple')
    expect(value('professional_retention', 'retention_pct', 27.5)).toMatch(/^27,5\s%$/)
    expect(value('professional_client_agreements', 'client_price_cents', 12000)).toMatch(/^120,00\s\$$/)
  })

  it('leaves unknown codes, other tables and other columns to core', () => {
    expect(value('professionals', 'status', 'archived')).toBeUndefined()
    expect(value('profiles', 'status', 'active')).toBeUndefined()
    expect(value('professional_documents', 'expires_on', '2027-03-31')).toBeUndefined()
  })

  it('names its own source', () => {
    expect(professionalsAuditLabels.sourceLabel('import')).toBe('Importation')
    expect(professionalsAuditLabels.sourceLabel('app')).toBeUndefined()
  })
})
