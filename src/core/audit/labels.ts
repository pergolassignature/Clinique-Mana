import { t } from '@/i18n'
import { isBaseRoleKey, roleLabel } from '@/core/access/roles'
import type { ModuleAuditLabels } from '@/core/modules/types'
import { signatureStatusLabel } from '@/core/signing/status'
import { formatRate } from '@/shared/lib/format'
import { formatClinicDateTime, formatDateOnlyShort } from '@/shared/lib/timezone'
import type { AuditEntry } from './api'
import { lookupAuditText as lookup } from './module-labels'

/**
 * Core's audited tables, in the order of the « Section » filter (each enabled module's tables
 * follow, from its `ModuleManifest.audit`). Their French names are `audit.tables.<table>`; the
 * columns are `audit.fields.<table>.<column>`, with `audit.commonFields.<column>` for the ones
 * every table has (`org_id`, `created_at`…). `src/app/audit-labels.test.ts` checks that every table
 * the migrations audit is here or in a module's list, named in French with each of its columns.
 */
export const AUDITED_TABLES = [
  'organizations',
  'profiles',
  'user_roles',
  'user_permission_overrides',
  'staff_invitations',
  'roles',
  'org_role_permissions',
  'org_modules',
  'org_module_settings',
  'org_secrets',
  'tax_rates',
  'organization_bank_details',
  'org_scheduled_jobs',
  'email_settings',
  'email_templates',
  'email_template_versions',
  'signing_settings',
  'document_templates',
  'document_template_versions',
  'signature_requests',
  'signature_request_signers',
  'stored_files',
  'secure_links',
] as const

/** The first module's answer, or undefined when none has one. */
function firstOf(modules: readonly ModuleAuditLabels[], read: (labels: ModuleAuditLabels) => string | undefined): string | undefined {
  for (const labels of modules) {
    const text = read(labels)
    if (text !== undefined) return text
  }
  return undefined
}

/** « Clinique » for `organizations`, a module's name for its own tables; the table name for a table without one. */
export function tableLabel(table: string, modules: readonly ModuleAuditLabels[] = []): string {
  return lookup(`audit.tables.${table}`) ?? firstOf(modules, (m) => m.tableLabel(table)) ?? table
}

/** « NEQ » for `organizations.neq`, a module's name for its own columns; the column name for a column without one. */
export function fieldLabel(table: string, column: string, modules: readonly ModuleAuditLabels[] = []): string {
  return (
    lookup(`audit.fields.${table}.${column}`) ??
    firstOf(modules, (m) => m.fieldLabel(table, column)) ??
    lookup(`audit.commonFields.${column}`) ??
    column
  )
}

/** « Création », « Modification », « Suppression », « Consultation »; the raw action otherwise. */
export function actionLabel(action: string): string {
  return lookup(`audit.actions.${action}`) ?? action
}

type SourceKey = 'app' | 'seed' | 'bootstrap' | 'migration' | 'auth' | 'job' | 'system'
const SOURCES: Readonly<Record<string, SourceKey>> = { app: 'app', seed: 'seed', bootstrap: 'bootstrap', service: 'system', system: 'system' }
const SOURCE_PREFIXES: Readonly<Record<string, SourceKey>> = {
  rpc: 'app',
  auth: 'auth',
  migration: 'migration',
  // A catalogue seeded by a migration (`seed:professionals_reference`): part of that update.
  seed: 'migration',
  job: 'job',
  trigger: 'system',
}

/**
 * Who wrote a row that has no actor name (`audit_log.source`): `app`, `rpc:*` → « Application »,
 * `seed` → « Données de test », `bootstrap` → « Installation », `migration:*` and `seed:*` →
 * « Mise à jour », `auth:*` → « Connexion », `job:*` → « Tâche planifiée », `service`, `system` and
 * `trigger:*` → « Système »; then a module's own sources (`import` → « Importation »). Anything
 * else: the raw source.
 */
export function sourceLabel(source: string, modules: readonly ModuleAuditLabels[] = []): string {
  const colon = source.indexOf(':')
  const prefix = colon > 0 ? source.slice(0, colon) : undefined
  const key = Object.hasOwn(SOURCES, source)
    ? SOURCES[source]
    : prefix !== undefined && Object.hasOwn(SOURCE_PREFIXES, prefix)
      ? SOURCE_PREFIXES[prefix]
      : undefined
  return key ? t(`audit.sources.${key}`) : (firstOf(modules, (m) => m.sourceLabel(source)) ?? source)
}

/** The value `private.audit_trigger` writes in place of a redacted column (decision #31). */
const REDACTED = '[redacted]'

/**
 * A calendar date (`date`), shown without any timezone conversion. The schema's naming: a `date`
 * column ends in `_on` (`expires_on`) or is a dated row's bound (`effective_from`, `effective_to`);
 * a `timestamptz` ends in `_at` (`retain_until` aside). A module's other dates (a month) are its own.
 */
const isDateOnlyColumn = (column: string) => column.endsWith('_on') || column === 'effective_from' || column === 'effective_to'
/** An instant (`timestamptz`): shown in the clinic's timezone. */
const isInstantColumn = (column: string) => column.endsWith('_at') || column === 'retain_until'

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
 * JSON. Dates by their column's name: `*_on`, `effective_from` and `effective_to` as calendar
 * dates, `*_at` and `retain_until` in the clinic's timezone; `tax_rates.rate` as a rate. Any other
 * value, a date-shaped one in another column included, is shown as is.
 */
export function formatAuditValue(value: unknown, table = '', column = ''): string {
  if (value === null || value === undefined || value === '') return t('audit.values.empty')
  if (value === true) return t('audit.values.yes')
  if (value === false) return t('audit.values.no')
  if (value === REDACTED) return t('audit.values.redacted')
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && isDateOnlyColumn(column)) return formatDateSafely(value, formatDateOnlyShort)
  if (typeof value === 'string' && isInstantColumn(column)) return formatDateSafely(value, formatClinicDateTime)
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
  /**
   * role key → stored name, for the clinic's custom roles (base roles use their i18n label): the
   * current roles, plus the deleted ones' last names (`roleNamesFromEntries`).
   */
  roles?: ReadonlyMap<string, string>
  /** The enabled modules' labels (`ModuleManifest.audit`): their tables' columns and values. */
  moduleLabels?: readonly ModuleAuditLabels[]
}

/** A value as shown: its text, and the full value in `title` when the text shortens it. */
export interface AuditValue {
  text: string
  title?: string
}

/** Columns holding a person's user id: `*_by` (`created_by`, `reviewed_by`…) and these. */
const PERSON_COLUMNS = new Set(['user_id', 'actor_id', 'accepted_user_id'])
const isPersonColumn = (column: string) => PERSON_COLUMNS.has(column) || column.endsWith('_by')
/** Columns holding a permission key: `permission_key` and `*_permission` (`view_permission`…). */
const isPermissionColumn = (column: string) => column === 'permission_key' || column.endsWith('_permission')

/** A stored code that may name an i18n key: lower-case letters, digits and `_` only. */
const CODE = /^[a-z0-9_]{1,60}$/

/**
 * One value of `table.column`, for reading. Stored codes become French (`role` and `roles.key`,
 * custom role names included, the statuses of core's tables (`audit.values.enums`), a signature
 * request's status, `tax_rates.tax`, module and permission keys), a module's values read as the
 * module says (`lookups.moduleLabels`), and person ids become names, each falling back to the raw
 * value; a person not in `lookups.people` shows a short id, the full one in `title`. A custom role
 * whose name is unknown shows « Rôle personnalisé », its key in `title`. Everything else goes
 * through `formatAuditValue`.
 */
export function auditValue(table: string, column: string, value: unknown, lookups: AuditLookups = {}): AuditValue {
  if (value === null || value === undefined || value === '' || value === REDACTED) return { text: formatAuditValue(value, table, column) }
  const fromModule = firstOf(lookups.moduleLabels ?? [], (m) => m.value(table, column, value))
  if (fromModule !== undefined) return { text: fromModule }
  if (typeof value !== 'string') return { text: formatAuditValue(value, table, column) }
  if (isPersonColumn(column)) {
    const name = lookups.people?.get(value)
    return name !== undefined ? { text: name, title: value } : { text: shortRecordId(value), title: value }
  }
  // A status or kind of a core table (`profiles.status`, `signature_request_signers.role`…).
  const code = CODE.test(value) ? lookup(`audit.values.enums.${table}.${column}.${value}`) : undefined
  if (code !== undefined) return { text: code }
  if (column === 'role' || (table === 'roles' && column === 'key')) {
    const name = lookups.roles?.get(value)
    if (name === undefined && !isBaseRoleKey(value) && value.startsWith('custom_')) return { text: t('access.customRole'), title: value }
    return { text: roleLabel(value, name) }
  }
  if (table === 'signature_requests' && column === 'status') return { text: signatureStatusLabel(value, null).label }
  if (table === 'tax_rates' && column === 'tax' && (value === 'gst' || value === 'qst')) {
    return { text: t(`settings.tax.taxes.${value}.title`) }
  }
  if (column === 'module_key') return { text: lookups.modules?.get(value) ?? value }
  if (isPermissionColumn(column)) return { text: lookups.permissions?.get(value) ?? value }
  return { text: formatAuditValue(value, table, column) }
}

/**
 * The custom role names the entries' `roles` rows carry, by key, the newest first wins (`entries`
 * come newest first). A deleted role is gone from the clinic's roles, but its rows keep its name:
 * the creation's and deletion's values (`key`, `name`), and a rename's new name (`record_id` is
 * the key). So the other rows naming it (user_roles, org_role_permissions) show its name.
 */
export function roleNamesFromEntries(entries: readonly Pick<AuditEntry, 'action' | 'table_name' | 'record_id' | 'changed_fields'>[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const { action, table_name: table, record_id: recordId, changed_fields: fields } of entries) {
    if (table !== 'roles' || !isRecord(fields)) continue
    const name = action === 'update' ? (isRecord(fields.name) ? fields.name.after : undefined) : fields.name
    const key = action === 'update' ? recordId : fields.key
    if (typeof key === 'string' && typeof name === 'string' && !names.has(key)) names.set(key, name)
  }
  return names
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
  const modules = lookups.moduleLabels ?? []
  if (action === 'read' && isRecord(fields) && Array.isArray(fields.fields) && fields.fields.length > 0) {
    const columns = fields.fields.map(String)
    if (table === 'organization_bank_details' && columns.length === 1 && columns[0] === 'account_number') {
      return [{ kind: 'text', text: t('audit.details.readAccountNumber') }]
    }
    return [{ kind: 'text', text: t('audit.details.readFields', { fields: columns.map((column) => fieldLabel(table, column, modules)).join(', ') }) }]
  }
  if (action === 'read' || !isRecord(fields) || Object.keys(fields).length === 0) return [{ kind: 'text', text: t('audit.details.none') }]
  return Object.entries(fields).map(([column, value]): AuditDetailLine => {
    if (isSecretRotation(table, column, value)) return { kind: 'text', text: t('audit.details.secretRotated') }
    const field = fieldLabel(table, column, modules)
    if (action === 'update' && isRecord(value) && Object.hasOwn(value, 'before') && Object.hasOwn(value, 'after')) {
      return { kind: 'change', field, before: auditValue(table, column, value.before, lookups), after: auditValue(table, column, value.after, lookups) }
    }
    return { kind: 'value', field, value: auditValue(table, column, value, lookups) }
  })
}
