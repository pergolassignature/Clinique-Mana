import { describe, expect, it } from 'vitest'
import type { AuditEntry } from './api'
import {
  actionLabel,
  AUDITED_TABLES,
  auditDetailLines,
  auditDetailText,
  auditValue,
  fieldLabel,
  formatAuditValue,
  shortRecordId,
  sourceLabel,
  tableLabel,
  type AuditLookups,
} from './labels'

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
  roles: ['created_at', 'is_system', 'key', 'name', 'org_id'],
  org_role_permissions: ['org_id', 'permission_key', 'role'],
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
      'Rôles attribués',
      'Exceptions de permissions',
      'Rôles',
      'Permissions des rôles',
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

  it('formats instants (clinic timezone) and dates (no conversion) only in the columns that hold them', () => {
    // timestamptz as PostgreSQL writes it into jsonb: 19:58 in the clinic (EDT).
    expect(formatAuditValue('2026-10-07T23:58:45.949486+00:00', 'profiles', 'updated_at')).toBe('07 oct. 2026 à 19:58')
    expect(formatAuditValue('2026-10-07T23:58:45Z', 'tax_rates', 'created_at')).toBe('07 oct. 2026 à 19:58')
    expect(formatAuditValue('2026-10-07T23:58:45Z', 'profiles', 'last_sign_in_at')).toBe('07 oct. 2026 à 19:58')
    // A date-only column stays on its day.
    expect(formatAuditValue('2026-01-01', 'tax_rates', 'effective_from')).toBe('1 janv. 2026')
    expect(formatAuditValue('2026-01-01', 'tax_rates', 'effective_to')).toBe('1 janv. 2026')
  })

  it('shows a date-shaped value in any other column as text', () => {
    expect(formatAuditValue('2026-01-01', 'organizations', 'legal_name')).toBe('2026-01-01')
    expect(formatAuditValue('2026-10-07T23:58:45Z', 'profiles', 'display_name')).toBe('2026-10-07T23:58:45Z')
    expect(formatAuditValue('2026-13-45', 'profiles', 'display_name')).toBe('2026-13-45')
  })

  it('never throws on an invalid date in a date column: the raw string', () => {
    expect(formatAuditValue('2026-13-45', 'tax_rates', 'effective_from')).toBe('2026-13-45')
    expect(formatAuditValue('2026-13-45T25:00:00Z', 'profiles', 'updated_at')).toBe('2026-13-45T25:00:00Z')
    expect(formatAuditValue('pas une date', 'profiles', 'created_at')).toBe('pas une date')
  })

  it('formats tax rates as percentages', () => {
    expect(formatAuditValue(0.09975, 'tax_rates', 'rate')).toBe('9,975\u00a0%')
    expect(formatAuditValue(0.05, 'tax_rates', 'rate')).toBe('5\u00a0%')
    // Any other number stays as is.
    expect(formatAuditValue(0.09975, 'organizations', 'record_retention_years')).toBe('0.09975')
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
  const lines = (e: Parameters<typeof auditDetailLines>[0], lookups?: AuditLookups) => auditDetailLines(e, lookups).map(auditDetailText)

  it('lists each change of an update as « Champ : avant → après », in French', () => {
    expect(
      lines(
        entry('update', 'organizations', {
          neq: { before: null, after: '1234567890' },
          legal_name: { before: 'Ancienne inc.', after: 'Nouvelle inc.' },
        }),
      ),
    ).toEqual([`NEQ${NB}: (vide) → 1234567890`, `Raison sociale${NB}: Ancienne inc. → Nouvelle inc.`])
  })

  it('shows a redacted column of an update as « (masqué) », with no before or after', () => {
    // The trigger replaces the whole {before, after} pair of a redacted column.
    expect(lines(entry('update', 'organization_bank_details', { transit_number: '[redacted]' }))).toEqual([
      `Numéro de transit${NB}: (masqué)`,
    ])
  })

  it('lists the fields of an insert or a delete', () => {
    expect(lines(entry('insert', 'tax_rates', { tax: 'qst', rate: 0.09975 }))).toEqual([`Taxe${NB}: TVQ`, `Taux${NB}: 9,975${NB}%`])
    expect(lines(entry('delete', 'user_roles', { role: 'counselor' }))).toEqual([`Rôle${NB}: Conseillère`])
  })

  it('says a bank read revealed the account number', () => {
    expect(lines(entry('read', 'organization_bank_details', { fields: ['account_number'] }))).toEqual(['Consultation du numéro de compte'])
  })

  it('lists the fields of any other read', () => {
    expect(lines(entry('read', 'organization_bank_details', { fields: ['account_number', 'transit_number'] }))).toEqual([
      `Champs consultés${NB}: Numéro de compte, Numéro de transit`,
    ])
  })

  it('says there is no detail when the fields are missing or not an object', () => {
    for (const fields of [null, {}, 'x', [1], { fields: 'account_number' }]) {
      const action = fields !== null && typeof fields === 'object' && 'fields' in fields ? 'read' : 'update'
      expect(lines(entry(action, 'organizations', fields))).toEqual(['Aucun détail.'])
    }
  })

  it('shows an org_secrets insert with its masked Vault id', () => {
    expect(lines(entry('insert', 'org_secrets', { key: 'stripe_secret_key', vault_secret_id: '[redacted]', version: 1 }))).toEqual([
      `Clé${NB}: stripe_secret_key`,
      `Secret${NB}: (masqué)`,
      `Version${NB}: 1`,
    ])
  })

  it('renders date-shaped names as text, without crashing', () => {
    expect(
      lines(entry('update', 'profiles', { display_name: { before: '2026-13-45', after: 'Marie' } })),
    ).toEqual([`Nom${NB}: 2026-13-45 → Marie`])
    expect(lines(entry('update', 'organizations', { legal_name: { before: null, after: '2026-01-01' } }))).toEqual([
      `Raison sociale${NB}: (vide) → 2026-01-01`,
    ])
    expect(lines(entry('insert', 'tax_rates', { effective_from: '2026-01-01' }))).toEqual([`En vigueur du${NB}: 1 janv. 2026`])
  })

  it('shows a secret rotation as « Secret remplacé », never the raw JSON', () => {
    expect(lines(entry('update', 'org_secrets', { value: { rotated: true } }))).toEqual(['Secret remplacé'])
    expect(fieldLabel('org_secrets', 'value')).toBe('Valeur')
    // Anything else under `value` is shown as a value.
    expect(lines(entry('update', 'org_secrets', { value: { rotated: false } }))).toEqual([`Valeur${NB}: {"rotated":false}`])
  })

  it('names the people of the journal, or shows their short id with the full id in title', () => {
    const lookups = { people: new Map([['a0000000-0000-0000-0000-000000000001', 'Marie Tremblay']]) }
    const [known, unknown] = auditDetailLines(
      entry('update', 'org_modules', {
        updated_by: { before: 'a0000000-0000-0000-0000-000000000001', after: 'c0000000-0000-0000-0000-000000000009' },
      }),
      lookups,
    ).flatMap((line) => (line.kind === 'change' ? [line.before, line.after] : []))
    expect(known).toEqual({ text: 'Marie Tremblay', title: 'a0000000-0000-0000-0000-000000000001' })
    expect(unknown).toEqual({ text: 'c0000000…', title: 'c0000000-0000-0000-0000-000000000009' })
    expect(lines(entry('insert', 'tax_rates', { created_by: 'a0000000-0000-0000-0000-000000000001' }), lookups)).toEqual([`Créé par${NB}: Marie Tremblay`])
  })
})

describe('auditValue', () => {
  const lookups: AuditLookups = {
    modules: new Map([['professionals', 'Professionnels']]),
    permissions: new Map([['audit.view', "Consulter le journal d'audit"]]),
    people: new Map([['u1', 'Julie Roy']]),
  }

  it('names roles, keeping an unknown role as is', () => {
    expect(auditValue('user_roles', 'role', 'admin_assistant').text).toBe('Adjointe administrative')
    expect(auditValue('user_roles', 'role', 'staff').text).toBe('staff')
    // A custom role: its stored name from the lookups; its key without them.
    const roles = new Map([['custom_0a1b2c3d', 'Réception']])
    expect(auditValue('org_role_permissions', 'role', 'custom_0a1b2c3d', { roles }).text).toBe('Réception')
    expect(auditValue('user_roles', 'role', 'custom_0a1b2c3d').text).toBe('custom_0a1b2c3d')
    expect(auditValue('user_roles', 'role', 'counselor', { roles: new Map([['counselor', 'Autre']]) }).text).toBe('Conseillère')
  })

  it('names the profile statuses, keeping any other as is', () => {
    expect(auditValue('profiles', 'status', 'active').text).toBe('Actif')
    expect(auditValue('profiles', 'status', 'disabled').text).toBe('Désactivé')
    expect(auditValue('profiles', 'status', 'invited').text).toBe('invited')
  })

  it('names the taxes, keeping any other as is', () => {
    expect(auditValue('tax_rates', 'tax', 'gst').text).toBe('TPS')
    expect(auditValue('tax_rates', 'tax', 'qst').text).toBe('TVQ')
    expect(auditValue('tax_rates', 'tax', 'hst').text).toBe('hst')
  })

  it('names modules from the catalogue, else shows the key', () => {
    expect(auditValue('org_modules', 'module_key', 'professionals', lookups).text).toBe('Professionnels')
    expect(auditValue('org_modules', 'module_key', 'billing', lookups).text).toBe('billing')
    expect(auditValue('org_modules', 'module_key', 'professionals').text).toBe('professionals')
  })

  it('describes permissions from the catalogue, else shows the key', () => {
    expect(auditValue('user_permission_overrides', 'permission_key', 'audit.view', lookups).text).toBe("Consulter le journal d'audit")
    expect(auditValue('user_permission_overrides', 'permission_key', 'audit.view').text).toBe('audit.view')
  })

  it('names a person in any person column, else shortens the id', () => {
    for (const column of ['user_id', 'actor_id', 'created_by', 'updated_by']) {
      expect(auditValue('profiles', column, 'u1', lookups)).toEqual({ text: 'Julie Roy', title: 'u1' })
    }
    expect(auditValue('profiles', 'user_id', 'b0000000-0000-0000-0000-00000000000a')).toEqual({
      text: 'b0000000…',
      title: 'b0000000-0000-0000-0000-00000000000a',
    })
  })

  it('keeps empty and redacted values as such, whatever the column', () => {
    expect(auditValue('tax_rates', 'created_by', null)).toEqual({ text: '(vide)' })
    expect(auditValue('organization_bank_details', 'updated_by', '[redacted]')).toEqual({ text: '(masqué)' })
  })
})
