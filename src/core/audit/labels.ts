import { t, type TranslationKey } from '@/i18n'
import { formatClinicDateTime, formatDateOnlyShort } from '@/shared/lib/timezone'
import type { AuditEntry } from './api'

/**
 * The audited tables the settings pages change, in the order of the « Section » filter. Their
 * French names are `audit.tables.<table>`; the columns are `audit.fields.<table>.<column>`, with
 * `audit.commonFields.<column>` for the ones every table has (`org_id`, `created_at`…).
 */
export const AUDITED_TABLES = [
  'organizations',
  'profiles',
  'user_roles',
  'user_permission_overrides',
  'org_modules',
  'org_module_settings',
  'org_secrets',
  'tax_rates',
  'organization_bank_details',
] as const

/** The French text of a key built from database names, or undefined when there is none. */
function lookup(key: string): string | undefined {
  // `t` returns the key itself when nothing (or no string) is there: an unknown table or column,
  // a name with a dot, or an inherited property such as `toString`.
  const text = t(key as TranslationKey)
  return text === key ? undefined : text
}

/** « Clinique » for `organizations`; the table name for a table without a label. */
export function tableLabel(table: string): string {
  return lookup(`audit.tables.${table}`) ?? table
}

/** « NEQ » for `organizations.neq`; the column name for a column without a label. */
export function fieldLabel(table: string, column: string): string {
  return lookup(`audit.fields.${table}.${column}`) ?? lookup(`audit.commonFields.${column}`) ?? column
}

/** « Création », « Modification », « Suppression », « Consultation »; the raw action otherwise. */
export function actionLabel(action: string): string {
  return lookup(`audit.actions.${action}`) ?? action
}

type SourceKey = 'app' | 'seed' | 'bootstrap' | 'migration' | 'auth' | 'system'
const SOURCES: Readonly<Record<string, SourceKey>> = { app: 'app', seed: 'seed', bootstrap: 'bootstrap', service: 'system', system: 'system' }
const SOURCE_PREFIXES: Readonly<Record<string, SourceKey>> = { rpc: 'app', auth: 'auth', migration: 'migration' }

/**
 * Who wrote a row that has no actor name (`audit_log.source`): `app`, `rpc:*` → « Application »,
 * `seed` → « Données de test », `bootstrap` → « Installation », `migration:*` → « Mise à jour »,
 * `auth:*` → « Connexion », `service` / `system` → « Système ». Anything else: the raw source.
 */
export function sourceLabel(source: string): string {
  const colon = source.indexOf(':')
  const prefix = colon > 0 ? source.slice(0, colon) : undefined
  const key = Object.hasOwn(SOURCES, source)
    ? SOURCES[source]
    : prefix !== undefined && Object.hasOwn(SOURCE_PREFIXES, prefix)
      ? SOURCE_PREFIXES[prefix]
      : undefined
  return key ? t(`audit.sources.${key}`) : source
}

/** The value `private.audit_trigger` writes in place of a redacted column (decision #31). */
export const REDACTED = '[redacted]'

/** A timestamptz as `to_jsonb` writes it (`2026-10-07T23:58:45.949486+00:00`). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/
/** A `date` column (`2026-10-07`). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * One value of `changed_fields`, for reading: null or empty → « (vide) », booleans → « Oui » /
 * « Non », a redacted value → « (masqué) », instants in the clinic's timezone, dates as they are
 * (no timezone), objects and arrays → compact JSON, the rest as is.
 */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('audit.values.empty')
  if (value === true) return t('audit.values.yes')
  if (value === false) return t('audit.values.no')
  if (value === REDACTED) return t('audit.values.redacted')
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && INSTANT.test(value)) return formatClinicDateTime(value)
  if (typeof value === 'string' && DATE_ONLY.test(value)) return formatDateOnlyShort(value)
  return String(value)
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** A record id for a table cell: each UUID cut to its first 8 characters (`b0000000…:professionals`). */
export function shortRecordId(recordId: string): string {
  return recordId.replace(UUID, (uuid) => `${uuid.slice(0, 8)}…`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * What an entry changed, one line each, in French:
 * - update: « Champ : avant → après »;
 * - insert / delete: « Champ : valeur »;
 * - read: « Consultation du numéro de compte » for the bank reveal, else « Champs consultés : … ».
 * « Aucun détail. » when `changed_fields` holds nothing readable.
 */
export function auditDetailLines({ action, table_name: table, changed_fields: fields }: Pick<AuditEntry, 'action' | 'table_name' | 'changed_fields'>): string[] {
  if (action === 'read' && isRecord(fields) && Array.isArray(fields.fields) && fields.fields.length > 0) {
    const columns = fields.fields.map(String)
    if (table === 'organization_bank_details' && columns.length === 1 && columns[0] === 'account_number') {
      return [t('audit.details.readAccountNumber')]
    }
    return [t('audit.details.readFields', { fields: columns.map((column) => fieldLabel(table, column)).join(', ') })]
  }
  if (action === 'read' || !isRecord(fields) || Object.keys(fields).length === 0) return [t('audit.details.none')]
  return Object.entries(fields).map(([column, value]) => {
    const field = fieldLabel(table, column)
    if (action === 'update' && isRecord(value) && Object.hasOwn(value, 'before') && Object.hasOwn(value, 'after')) {
      return t('audit.details.change', { field, before: formatAuditValue(value.before), after: formatAuditValue(value.after) })
    }
    return t('audit.details.value', { field, value: formatAuditValue(value) })
  })
}
