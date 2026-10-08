import { t, type TranslationKey } from '@/i18n'
import { roleLabel } from '@/core/access/roles'
import { formatRate } from '@/shared/lib/format'
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

/** Columns holding a calendar date (`date`): shown without any timezone conversion. */
const DATE_ONLY_COLUMNS = new Set(['effective_from', 'effective_to'])
/** Columns holding an instant (`timestamptz`): shown in the clinic's timezone. */
const INSTANT_COLUMNS = new Set(['created_at', 'updated_at', 'last_sign_in_at'])

/** Runs a date formatter; the raw string when the date is invalid (never throws). */
function formatDateSafely(value: string, format: (value: string) => string): string {
  try {
    const text = format(value)
    // The timezone helpers print « — » for a date they cannot read.
    return text === '—' ? value : text
  } catch {
    return value
  }
}

/**
 * One value of `changed_fields` in `table.column`, for reading: null or empty → « (vide) »,
 * booleans → « Oui » / « Non », a redacted value → « (masqué) », objects and arrays → compact
 * JSON. Only the columns known to hold them are read as dates (`effective_from` / `effective_to`
 * as calendar dates, `created_at` / `updated_at` / `last_sign_in_at` in the clinic's timezone) and
 * as a rate (`tax_rates.rate`); any other value, a date-shaped name included, is shown as is.
 */
export function formatAuditValue(value: unknown, table = '', column = ''): string {
  if (value === null || value === undefined || value === '') return t('audit.values.empty')
  if (value === true) return t('audit.values.yes')
  if (value === false) return t('audit.values.no')
  if (value === REDACTED) return t('audit.values.redacted')
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && DATE_ONLY_COLUMNS.has(column)) return formatDateSafely(value, formatDateOnlyShort)
  if (typeof value === 'string' && INSTANT_COLUMNS.has(column)) return formatDateSafely(value, formatClinicDateTime)
  if (table === 'tax_rates' && column === 'rate' && Number.isFinite(Number(value))) return formatRate(Number(value))
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

/** Names the details can show instead of stored codes and ids; each is optional (fallback: the raw value). */
export interface AuditLookups {
  /** user id → display name (`list_audit_actors`). */
  people?: ReadonlyMap<string, string>
  /** permission key → description (`permissions` catalogue). */
  permissions?: ReadonlyMap<string, string>
  /** module key → name (`modules` catalogue). */
  modules?: ReadonlyMap<string, string>
}

/** A value as shown: its text, and the full value in `title` when the text shortens it. */
export interface AuditValue {
  text: string
  title?: string
}

/** Columns holding a person's user id, in any table. */
const PERSON_COLUMNS = new Set(['user_id', 'actor_id', 'created_by', 'updated_by'])

/** The profiles.status values (`check (status in ('active', 'disabled'))`). */
const PROFILE_STATUSES = new Set(['active', 'disabled'])

/**
 * One value of `table.column`, for reading. Stored codes become French (`role`, `profiles.status`,
 * `tax_rates.tax`, module and permission keys) and person ids become names, each falling back to
 * the raw value; a person not in `lookups.people` shows a short id, the full one in `title`.
 * Everything else goes through `formatAuditValue`.
 */
export function auditValue(table: string, column: string, value: unknown, lookups: AuditLookups = {}): AuditValue {
  if (typeof value !== 'string' || value === '' || value === REDACTED) return { text: formatAuditValue(value, table, column) }
  if (PERSON_COLUMNS.has(column)) {
    const name = lookups.people?.get(value)
    return name !== undefined ? { text: name, title: value } : { text: shortRecordId(value), title: value }
  }
  if (column === 'role') return { text: roleLabel(value) }
  if (table === 'profiles' && column === 'status' && PROFILE_STATUSES.has(value)) {
    return { text: t(`audit.values.status.${value as 'active' | 'disabled'}`) }
  }
  if (table === 'tax_rates' && column === 'tax' && (value === 'gst' || value === 'qst')) {
    return { text: t(`settings.tax.taxes.${value}.title`) }
  }
  if (column === 'module_key') return { text: lookups.modules?.get(value) ?? value }
  if (column === 'permission_key') return { text: lookups.permissions?.get(value) ?? value }
  return { text: formatAuditValue(value, table, column) }
}

/** One line of an entry's details. */
export type AuditDetailLine =
  | { kind: 'change'; field: string; before: AuditValue; after: AuditValue }
  | { kind: 'value'; field: string; value: AuditValue }
  | { kind: 'text'; text: string }

/** `set_org_secret` records a rotation as `{"value": {"rotated": true}}`: the value itself never appears. */
function isSecretRotation(table: string, column: string, value: unknown): boolean {
  return table === 'org_secrets' && column === 'value' && isRecord(value) && value.rotated === true
}

/**
 * What an entry changed, one line each, in French:
 * - update: « Champ : avant → après » (a redacted column: « Champ : (masqué) »; a secret
 *   rotation: « Secret remplacé »);
 * - insert / delete: « Champ : valeur »;
 * - read: « Consultation du numéro de compte » for the bank reveal, else « Champs consultés : … ».
 * « Aucun détail. » when `changed_fields` holds nothing readable.
 */
export function auditDetailLines(
  { action, table_name: table, changed_fields: fields }: Pick<AuditEntry, 'action' | 'table_name' | 'changed_fields'>,
  lookups: AuditLookups = {},
): AuditDetailLine[] {
  if (action === 'read' && isRecord(fields) && Array.isArray(fields.fields) && fields.fields.length > 0) {
    const columns = fields.fields.map(String)
    if (table === 'organization_bank_details' && columns.length === 1 && columns[0] === 'account_number') {
      return [{ kind: 'text', text: t('audit.details.readAccountNumber') }]
    }
    return [{ kind: 'text', text: t('audit.details.readFields', { fields: columns.map((column) => fieldLabel(table, column)).join(', ') }) }]
  }
  if (action === 'read' || !isRecord(fields) || Object.keys(fields).length === 0) return [{ kind: 'text', text: t('audit.details.none') }]
  return Object.entries(fields).map(([column, value]): AuditDetailLine => {
    if (isSecretRotation(table, column, value)) return { kind: 'text', text: t('audit.details.secretRotated') }
    const field = fieldLabel(table, column)
    if (action === 'update' && isRecord(value) && Object.hasOwn(value, 'before') && Object.hasOwn(value, 'after')) {
      return { kind: 'change', field, before: auditValue(table, column, value.before, lookups), after: auditValue(table, column, value.after, lookups) }
    }
    return { kind: 'value', field, value: auditValue(table, column, value, lookups) }
  })
}

/** A detail line as plain text (« NEQ : (vide) → 1234567890 »). */
export function auditDetailText(line: AuditDetailLine): string {
  switch (line.kind) {
    case 'change':
      return t('audit.details.change', { field: line.field, before: line.before.text, after: line.after.text })
    case 'value':
      return t('audit.details.value', { field: line.field, value: line.value.text })
    case 'text':
      return line.text
  }
}
