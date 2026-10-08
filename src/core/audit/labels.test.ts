import { describe, expect, it } from 'vitest'
import type { AuditEntry } from './api'
import { actionLabel, AUDITED_TABLES, auditDetailLines, fieldLabel, formatAuditValue, shortRecordId, sourceLabel, tableLabel } from './labels'

// The columns of every audited table the settings pages change, from the generated types (a new
// column fails here until it has a French label).
const COLUMNS: Record<(typeof AUDITED_TABLES)[number], string[]> = {
  organizations: [
    'address_line1', 'address_line2', 'city', 'country', 'created_at', 'currency', 'default_locale', 'email',
    'gst_number', 'id', 'legal_name', 'name', 'neq', 'phone', 'postal_code', 'privacy_officer_email',
    'privacy_officer_name', 'privacy_policy_url', 'province', 'qst_number', 'record_retention_years',
    'signatory_name', 'signatory_title', 'timezone', 'updated_at', 'website',
  ],
  profiles: ['created_at', 'display_name', 'email', 'org_id', 'status', 'updated_at', 'user_id'],
  user_roles: ['created_at', 'org_id', 'role', 'user_id'],
  user_permission_overrides: ['created_at', 'created_by', 'granted', 'org_id', 'permission_key', 'user_id'],
  org_modules: ['enabled', 'module_key', 'org_id', 'updated_at', 'updated_by'],
  org_module_settings: ['module_key', 'org_id', 'settings', 'updated_at', 'updated_by'],
  org_secrets: ['key', 'org_id', 'updated_at', 'updated_by', 'vault_secret_id', 'version'],
  tax_rates: ['created_at', 'created_by', 'effective_from', 'effective_to', 'id', 'org_id', 'rate', 'tax'],
  organization_bank_details: [
    'account_last4', 'account_number', 'etransfer_email', 'institution_number', 'org_id', 'transit_number',
    'updated_at', 'updated_by',
  ],
}

describe('tableLabel', () => {
  it('names each audited table in French, in the filter order', () => {
    expect(AUDITED_TABLES.map(tableLabel)).toEqual([
      'Clinique',
      'Utilisateurs',
      'Rôles',
      'Exceptions de permissions',
      'Modules',
      'Paramètres de module',
      'Secrets',
      'Taux de taxes',
      'Coordonnées bancaires',
    ])
  })

  it('falls back to the table name', () => {
    expect(tableLabel('professionals')).toBe('professionals')
  })
})

describe('fieldLabel', () => {
  it('names the columns in French', () => {
    expect(fieldLabel('organizations', 'neq')).toBe('NEQ')
    expect(fieldLabel('organizations', 'legal_name')).toBe('Raison sociale')
    expect(fieldLabel('profiles', 'status')).toBe('Statut')
    expect(fieldLabel('organization_bank_details', 'account_number')).toBe('Numéro de compte')
    expect(fieldLabel('tax_rates', 'rate')).toBe('Taux')
  })

  it('shares the labels of the columns every table has', () => {
    expect(fieldLabel('profiles', 'updated_at')).toBe('Modifié le')
    expect(fieldLabel('tax_rates', 'created_by')).toBe('Créé par')
    expect(fieldLabel('user_roles', 'user_id')).toBe('Utilisateur')
  })

  it('labels every column of every audited table', () => {
    for (const [table, columns] of Object.entries(COLUMNS)) {
      for (const column of columns) {
        expect(fieldLabel(table, column), `${table}.${column}`).not.toBe(column)
      }
    }
  })

  it('falls back to the column name (unknown column or table)', () => {
    expect(fieldLabel('organizations', 'new_column')).toBe('new_column')
    expect(fieldLabel('professionals', 'license_number')).toBe('license_number')
  })

  it('never resolves a key outside a table (no prototype or nested lookups)', () => {
    expect(fieldLabel('organizations', 'toString')).toBe('toString')
    expect(fieldLabel('organizations.neq', 'x')).toBe('x')
  })
})

describe('actionLabel', () => {
  it('names the four actions', () => {
    expect(['insert', 'update', 'delete', 'read'].map(actionLabel)).toEqual(['Création', 'Modification', 'Suppression', 'Consultation'])
  })

  it('falls back to the raw action', () => {
    expect(actionLabel('truncate')).toBe('truncate')
  })
})

describe('sourceLabel', () => {
  it.each([
    ['app', 'Application'],
    ['rpc:reveal_bank_account_number', 'Application'],
    ['seed', 'Données de test'],
    ['bootstrap', 'Installation'],
    ['migration:core_tax_rates', 'Mise à jour'],
    ['auth:email_change', 'Connexion'],
    ['service', 'Système'],
    ['system', 'Système'],
  ])('%s → %s', (source, label) => {
    expect(sourceLabel(source)).toBe(label)
  })

  it('falls back to the raw source', () => {
    expect(sourceLabel('job:nightly')).toBe('job:nightly')
  })
})

describe('formatAuditValue', () => {
  it('shows null and missing values as « (vide) »', () => {
    expect(formatAuditValue(null)).toBe('(vide)')
    expect(formatAuditValue(undefined)).toBe('(vide)')
    expect(formatAuditValue('')).toBe('(vide)')
  })

  it('shows booleans as Oui / Non', () => {
    expect(formatAuditValue(true)).toBe('Oui')
    expect(formatAuditValue(false)).toBe('Non')
  })

  it('shows a redacted value as « (masqué) »', () => {
    expect(formatAuditValue('[redacted]')).toBe('(masqué)')
  })

  it('shows strings and numbers as is', () => {
    expect(formatAuditValue('1234567890')).toBe('1234567890')
    expect(formatAuditValue(0.09975)).toBe('0.09975')
    expect(formatAuditValue(7)).toBe('7')
  })

  it('shows instants in the clinic timezone, and dates without any conversion', () => {
    // timestamptz as PostgreSQL writes it into jsonb: 19:58 in the clinic (EDT).
    expect(formatAuditValue('2026-10-07T23:58:45.949486+00:00')).toBe('07 oct. 2026 à 19:58')
    expect(formatAuditValue('2026-10-07T23:58:45Z')).toBe('07 oct. 2026 à 19:58')
    // A date-only column (tax_rates.effective_from) stays on its day.
    expect(formatAuditValue('2026-01-01')).toBe('1 janv. 2026')
  })

  it('shows objects and arrays as compact JSON', () => {
    expect(formatAuditValue({ reminders: true, days: [1, 2] })).toBe('{"reminders":true,"days":[1,2]}')
    expect(formatAuditValue(['a', 'b'])).toBe('["a","b"]')
  })
})

describe('shortRecordId', () => {
  it('shortens each UUID to its first 8 characters', () => {
    expect(shortRecordId('b0000000-0000-0000-0000-00000000000a')).toBe('b0000000…')
    expect(shortRecordId('B0000000-0000-0000-0000-00000000000A:professionals')).toBe('B0000000…:professionals')
  })

  it('keeps any other id as is', () => {
    expect(shortRecordId('42')).toBe('42')
    expect(shortRecordId('n/a')).toBe('n/a')
  })
})

describe('auditDetailLines', () => {
  const entry = (action: string, table_name: string, changed_fields: unknown): Pick<AuditEntry, 'action' | 'table_name' | 'changed_fields'> => ({
    action,
    table_name,
    changed_fields,
  })
  const NB = '\u00a0'

  it('lists each change of an update as « Champ : avant → après », in French', () => {
    expect(
      auditDetailLines(
        entry('update', 'organizations', {
          neq: { before: null, after: '1234567890' },
          legal_name: { before: 'Ancienne inc.', after: 'Nouvelle inc.' },
        }),
      ),
    ).toEqual([`NEQ${NB}: (vide) → 1234567890`, `Raison sociale${NB}: Ancienne inc. → Nouvelle inc.`])
  })

  it('shows a redacted column of an update as « (masqué) », with no before or after', () => {
    // The trigger replaces the whole {before, after} pair of a redacted column.
    expect(auditDetailLines(entry('update', 'organization_bank_details', { transit_number: '[redacted]' }))).toEqual([
      `Numéro de transit${NB}: (masqué)`,
    ])
  })

  it('lists the fields of an insert or a delete', () => {
    expect(auditDetailLines(entry('insert', 'tax_rates', { tax: 'qst', rate: 0.09975 }))).toEqual([`Taxe${NB}: qst`, `Taux${NB}: 0.09975`])
    expect(auditDetailLines(entry('delete', 'user_roles', { role: 'counselor' }))).toEqual([`Rôle${NB}: counselor`])
  })

  it('says a bank read revealed the account number', () => {
    expect(auditDetailLines(entry('read', 'organization_bank_details', { fields: ['account_number'] }))).toEqual(['Consultation du numéro de compte'])
  })

  it('lists the fields of any other read', () => {
    expect(auditDetailLines(entry('read', 'organization_bank_details', { fields: ['account_number', 'transit_number'] }))).toEqual([
      `Champs consultés${NB}: Numéro de compte, Numéro de transit`,
    ])
  })

  it('says there is no detail when the fields are missing or not an object', () => {
    for (const fields of [null, {}, 'x', [1], { fields: 'account_number' }]) {
      const action = fields !== null && typeof fields === 'object' && 'fields' in fields ? 'read' : 'update'
      expect(auditDetailLines(entry(action, 'organizations', fields))).toEqual(['Aucun détail.'])
    }
  })
})
