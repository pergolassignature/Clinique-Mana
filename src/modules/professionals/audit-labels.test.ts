import { describe, expect, expectTypeOf, it } from 'vitest'
import { t, type TranslationKey } from '@/i18n'
import type { Tables } from '@/core/supabase/database.types'

/**
 * Every audited table of the module and its columns: the Journal d'audit and the Historique tab
 * name them through `audit.tables.<table>` and `audit.fields.<table>.<column>` (or
 * `audit.commonFields.<column>`). The type check below fails when a migration adds a column.
 */
const COLUMNS = {
  professional_orders: ['id', 'org_id', 'key', 'name', 'acronym', 'licence_label', 'licence_pattern', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  profession_categories: ['id', 'org_id', 'key', 'name', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  profession_titles: ['id', 'org_id', 'key', 'name', 'category_id', 'order_id', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  clienteles: ['id', 'org_id', 'key', 'name', 'min_age', 'max_age', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  motif_categories: ['id', 'org_id', 'key', 'name', 'description', 'icon', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  motifs: ['id', 'org_id', 'key', 'name', 'category_id', 'is_restricted', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  languages: ['id', 'org_id', 'code', 'name', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  deactivation_reasons: ['id', 'org_id', 'key', 'name', 'requires_note', 'disables_account', 'is_system', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  professionals: [
    'id', 'org_id', 'profile_id', 'first_name', 'last_name', 'email', 'personal_phone', 'address_line1', 'address_line2', 'city', 'province',
    'postal_code', 'country', 'years_experience', 'gender', 'status', 'status_changed_at', 'status_changed_by', 'deactivation_reason_id',
    'deactivation_note', 'deactivation_disabled_account', 'activation_override_reason', 'created_at', 'created_by', 'updated_at',
  ],
  professional_public_profiles: ['org_id', 'professional_id', 'bio', 'approach', 'public_email', 'public_phone', 'created_at', 'updated_at'],
  professional_matching_profiles: [
    'org_id', 'professional_id', 'accepting_new_clients', 'availability_periods', 'availability_note', 'min_client_age', 'women_only', 'created_at', 'updated_at',
  ],
  professional_professions: ['id', 'org_id', 'professional_id', 'profession_title_id', 'licence_number', 'is_primary', 'created_at', 'updated_at'],
  professional_clienteles: ['org_id', 'professional_id', 'clientele_id', 'is_specialized', 'created_at', 'updated_at'],
  professional_motifs: ['org_id', 'professional_id', 'motif_id', 'created_at'],
  professional_languages: ['org_id', 'professional_id', 'language_id', 'created_at'],
  professional_payer_numbers: ['org_id', 'professional_id', 'payer_type', 'number', 'created_at', 'updated_at'],
  // 4a.17 (labels added by 4a.18): the private data (every value redacted in the log) and the four dated compensation tables.
  professional_private: [
    'professional_id', 'org_id', 'sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number', 'bank_institution', 'bank_transit',
    'bank_account', 'bank_account_last4', 'key_version', 'created_at', 'updated_at', 'updated_by',
  ],
  compensation_defaults: ['id', 'org_id', 'kind', 'margin_min_pct', 'margin_max_pct', 'effective_from', 'effective_to', 'created_at', 'created_by'],
  professional_compensation: ['id', 'org_id', 'professional_id', 'kind', 'margin_pct', 'effective_from', 'effective_to', 'note', 'created_at', 'created_by'],
  recognition_rules: [
    'id', 'org_id', 'effective_from', 'effective_to', 'step_sessions', 'bonus_per_50min_cents', 'bonus_per_30min_cents', 'cap_pct', 'cap_basis',
    'note', 'created_at', 'created_by',
  ],
  professional_recognition: ['id', 'org_id', 'professional_id', 'level', 'sessions_counted', 'effective_from', 'effective_to', 'note', 'created_at', 'created_by'],
} as const

type ModuleTable = keyof typeof COLUMNS
/** The columns of each table the list above misses: never, table by table. */
type Missing = { [T in ModuleTable]: Exclude<keyof Tables<T>, (typeof COLUMNS)[T][number]> }[ModuleTable]

const label = (key: string) => {
  const text = t(key as TranslationKey)
  return text === key ? undefined : text
}

describe('audit labels of the professionals tables', () => {
  it('lists every column of every table (type check)', () => {
    expectTypeOf<Missing>().toEqualTypeOf<never>()
  })

  for (const [table, columns] of Object.entries(COLUMNS)) {
    it(`names ${table} and each of its columns in French`, () => {
      expect(label(`audit.tables.${table}`)).toBeDefined()
      for (const column of columns) expect(label(`audit.fields.${table}.${column}`) ?? label(`audit.commonFields.${column}`), column).toBeDefined()
    })
  }
})
