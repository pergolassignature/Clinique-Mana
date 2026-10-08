import { t, type TranslationKey } from '@/i18n'
import { fieldLabel } from '@/core/audit/labels'
import { formatPhone } from '@/shared/lib/format'
import { formatClinicDateFull, formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
import { DECISIONS, DURATIONS, type Decision, type Duration } from '../api/compensation'
import type { HistoryEntry, ProfessionalRecord } from '../api/parse'
import { OTHER_MOTIF_GROUP, type CatalogView } from './catalog-view'
import { durationLabel, formatCents, formatPercent, formatSessions, monthLabel, sessionsLabel } from './compensation'
import { PAYER_TYPES, PROFESSIONAL_STATUSES, type AvailabilityPeriod, type PayerType, type ProfessionalStatus } from './constants'
import { listLabel, periodsLabel, statusLabel } from './display'
import { FEW_MOTIFS, type HeldMotif } from './motif-summary'

/**
 * The Historique tab's reading of `list_professional_history` (Task 4a.15): audit rows become
 * French sentences (« a modifié la ville », « a ajouté 65 motifs »), with the details behind a
 * disclosure. No raw JSON and no UUID ever reaches the screen (D5): ids are named through the
 * catalogue, and values the audit trigger redacted (« [redacted] ») are never read, only the fact
 * that the field changed. As a last guard, `formatValue` never prints a UUID-shaped string or the
 * redaction marker, whatever the column.
 */

const H = 'modules.professionals.history'

/** What `private.audit_trigger` writes in place of a redacted column (Loi 25). */
const REDACTED = '[redacted]'
/** A UUID anywhere in a string: such a value is never printed (D5). */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Columns that say nothing to a reader: ids, the org, timestamps, who wrote the row or changed the status (the actor says it). */
const TECHNICAL = new Set([
  'id',
  'org_id',
  'professional_id',
  'user_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'status_changed_at',
  'status_changed_by',
  // A client agreement's future Clients id (P4-183): never shown.
  'client_id',
  // A client agreement's client reference: redacted by the audit trigger (Loi 25, P4-193); the
  // history shows the duration, the dates and the amounts only.
  'client_label',
  // The fiche's last download or email (P4-203): bookkeeping, not a change to the file.
  'fiche_generated_at',
])
/** Free texts: shown in the details only, never inside a sentence. */
const LONG_TEXT = new Set(['bio', 'approach', 'availability_note', 'deactivation_note', 'activation_override_reason'])
/** A creation's details: who the file is about. Everything else starts empty or at its default. */
const CREATION_FIELDS = ['first_name', 'last_name', 'email', 'profile_id']

/** The 1:1 rows created empty with the record: folded into « a créé le dossier ». */
const PROFILE_TABLES: Readonly<Record<string, 'publicProfile' | 'matchingProfile'>> = {
  professional_public_profiles: 'publicProfile',
  professional_matching_profiles: 'matchingProfile',
}
/** Tables whose field phrases (« la ville ») exist in `history.fields`. */
type PhrasedTable = 'professionals' | 'professional_public_profiles' | 'professional_matching_profiles'
const PHRASED_TABLES = new Set<string>(['professionals', ...Object.keys(PROFILE_TABLES)])

/** The set tables (junctions written by a set RPC), the column holding the item, and how to name it. */
const SET_TABLES = {
  professional_motifs: 'motif_id',
  professional_languages: 'language_id',
  professional_clienteles: 'clientele_id',
} as const
type SetTable = keyof typeof SET_TABLES
type SetChange = 'added' | 'removed' | 'specialized' | 'unspecialized'

/** Data from 4a.17's table: the history says what happened, never the values (P4-7, P4-38). */
const PRIVATE_TABLE = 'professional_private'
/**
 * The fields `reveal_professional_private` names in a `read` row (`{"fields": ["bank_account"]}`,
 * 4a.17), and how each reads. Only these names are ever read; anything else (or nothing) reads
 * « a consulté des données privées ».
 */
const PRIVATE_READ_FIELDS = { sin: 'sin', bank_account: 'bankAccount' } as const
type PrivateReadField = keyof typeof PRIVATE_READ_FIELDS

/**
 * A professional's retention rows (P4-193), shown only to `professionals.compensation` holders
 * (the RPC filters them, P4-144), with their values (P4-149): « a appliqué le taux suggéré de
 * 27,5 % dès le 1 nov. 2026 », « a ajouté une entente particulière (50 min) dès le … ». Closing the
 * previous row (on insert) or reopening it (on delete) is part of the same save and says nothing
 * of its own. The months of sessions (`professional_session_counts`) are not dated rows.
 */
const DATED_TABLES = { professional_retention: 'rate', professional_client_agreements: 'agreement' } as const
const SESSIONS_TABLE = 'professional_session_counts'
type DatedTable = keyof typeof DATED_TABLES
const isDatedTable = (table: string): table is DatedTable => Object.hasOwn(DATED_TABLES, table)
/** A calendar date as stored (`yyyy-MM-dd`): shown with `formatDateOnlyShort`, never through a timezone. */
const DATE_ONLY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/** One line of an event's details, already in French. */
export type HistoryLine =
  | { kind: 'change'; field: string; before: string; after: string }
  | { kind: 'value'; field: string; value: string }
  | { kind: 'text'; text: string }

/** Names behind a counted sentence (« a ajouté 65 motifs »): by category for motifs, one unnamed group otherwise. */
export interface HistoryNameGroup {
  key: string
  name: string | null
  items: HeldMotif[]
}

export interface HistoryEvent {
  /** The newest audit id of the event (a stable key). */
  id: number
  createdAt: string
  /** The person's name, or what wrote the row (« L'importation »), as the subject of the sentence. */
  actor: string
  byPerson: boolean
  /** « Modifications » shows `change` only; `read` is a consultation of private data (4a.17). */
  kind: 'change' | 'read'
  /** Follows the actor: « a modifié la ville ». */
  sentence: string
  lines: HistoryLine[]
  groups: HistoryNameGroup[]
}

export interface HistoryContext {
  catalog: CatalogView
  /** profession row id → title id: an update row names only what changed, not its title. */
  titleByRow: ReadonlyMap<string, string>
}

export const HISTORY_FILTERS = ['all', 'changes'] as const
export type HistoryFilter = (typeof HISTORY_FILTERS)[number]

// --- Small readers ---------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** An update's `{before, after}`, or null for a redacted column (the trigger replaced the pair). */
function pairOf(value: unknown): { before: unknown; after: unknown } | null {
  return isRecord(value) && Object.hasOwn(value, 'before') && Object.hasOwn(value, 'after') ? { before: value.before, after: value.after } : null
}

const fieldsOf = (entry: HistoryEntry): Record<string, unknown> => (isRecord(entry.changedFields) ? entry.changedFields : {})

/** The second part of a child row's record id (`<professional_id>:<item>`). */
const itemIdOf = (entry: HistoryEntry): string => entry.recordId.slice(entry.recordId.indexOf(':') + 1)

/** Rows written by one statement batch: same transaction time, same actor, same source. */
const transactionOf = (entry: HistoryEntry): string => `${entry.createdAt}|${entry.actorId ?? ''}|${entry.source}`

const unknown = (kind: 'motif' | 'clientele' | 'language' | 'title' | 'reason') => t(`${H}.values.unknown.${kind}`)

const isStatus = (value: unknown): value is ProfessionalStatus => typeof value === 'string' && (PROFESSIONAL_STATUSES as readonly string[]).includes(value)

function reasonName(catalog: CatalogView, id: unknown): string {
  return (typeof id === 'string' && catalog.byId.deactivationReasons.get(id)?.name) || unknown('reason')
}

function titleName(catalog: CatalogView, id: string | undefined): string {
  return (id !== undefined && catalog.byId.titles.get(id)?.name) || unknown('title')
}

/** A value for reading: never an id, never JSON, never the redaction marker. */
function formatValue(catalog: CatalogView, column: string, value: unknown): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return column === 'profile_id' ? t(`${H}.values.accountNone`) : t('audit.values.empty')
  }
  if (value === true) return t('audit.values.yes')
  if (value === false) return t('audit.values.no')
  if (column === 'profile_id') return t(`${H}.values.accountLinked`)
  if (column === 'status' && isStatus(value)) return statusLabel(value)
  if (column === 'deactivation_reason_id') return reasonName(catalog, value)
  if (column === 'availability_periods' && Array.isArray(value)) return periodsLabel(value as AvailabilityPeriod[])
  if (value === REDACTED) return t('audit.values.redacted')
  // An id the catalogue did not name (a column this tab does not know): never shown (D5).
  if (typeof value === 'string' && UUID_PATTERN.test(value)) return t(`${H}.values.hidden`)
  if (column === 'public_phone' && typeof value === 'string') return formatPhone(value)
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  // Anything else (an object, a list) is not shown raw (D5), and it is not empty either.
  return t(`${H}.values.hidden`)
}

/** « la ville » for a sentence; the field's label (« Ville ») for a table without phrases. */
function phrase(table: string, column: string): string {
  if (PHRASED_TABLES.has(table)) {
    const key = `${H}.fields.${table as PhrasedTable}.${column}`
    const text = t(key as TranslationKey)
    if (text !== key) return text
  }
  return `« ${fieldLabel(table, column)} »`
}

/** Details of an update: « Champ : avant → après », or « Champ : (masqué) » for a redacted column. */
function changeLines(catalog: CatalogView, table: string, fields: Record<string, unknown>): HistoryLine[] {
  return Object.entries(fields).map(([column, value]): HistoryLine => {
    const field = fieldLabel(table, column)
    const pair = pairOf(value)
    if (!pair) return { kind: 'value', field, value: t('audit.values.redacted') }
    return { kind: 'change', field, before: formatValue(catalog, column, pair.before), after: formatValue(catalog, column, pair.after) }
  })
}

const readable = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([column]) => !TECHNICAL.has(column)))

// --- One row -----------------------------------------------------------------------------------------

type Described = Pick<HistoryEvent, 'kind' | 'sentence' | 'lines'>

/** « a modifié la ville », « a modifié la province : QC → ON », « a modifié le genre et la ville ». */
function fieldUpdate(catalog: CatalogView, table: string, fields: Record<string, unknown>): Described | null {
  const columns = Object.keys(fields)
  if (columns.length === 0) return null
  const lines = changeLines(catalog, table, fields)
  const [column] = columns
  const pair = pairOf(fields[column as string])
  if (columns.length === 1 && column !== undefined && pair && !LONG_TEXT.has(column)) {
    const [line] = lines
    // The sentence says it all: nothing to unfold.
    if (line?.kind === 'change') {
      return { kind: 'change', sentence: t(`${H}.sentences.changedValue`, { field: phrase(table, column), before: line.before, after: line.after }), lines: [] }
    }
  }
  return { kind: 'change', sentence: t(`${H}.sentences.changedOne`, { field: listLabel(columns.map((c) => phrase(table, c))) }), lines }
}

/** A status change: « a activé le dossier », « a désactivé le dossier (raison : Congé) »… */
function statusUpdate(catalog: CatalogView, fields: Record<string, unknown>, status: { before: unknown; after: unknown }): Described {
  const S = `${H}.sentences`
  const lines: HistoryLine[] = []
  const note = pairOf(fields.deactivation_note)?.after
  if (typeof note === 'string' && note !== '') {
    lines.push({ kind: 'value', field: fieldLabel('professionals', 'deactivation_note'), value: formatValue(catalog, 'deactivation_note', note) })
  }
  const account = pairOf(fields.deactivation_disabled_account)
  if (account?.after === true) lines.push({ kind: 'text', text: t(`${H}.lines.accountDisabled`) })
  if (account?.before === true && account.after === false) lines.push({ kind: 'text', text: t(`${H}.lines.accountEnabled`) })

  let sentence: string
  if (status.after === 'active') {
    // The reason is a free text: in the details, not the sentence (P4-103).
    const override = pairOf(fields.activation_override_reason)?.after
    if (typeof override === 'string' && override !== '') {
      sentence = t(`${S}.activatedOverride`)
      lines.unshift({
        kind: 'value',
        field: fieldLabel('professionals', 'activation_override_reason'),
        value: formatValue(catalog, 'activation_override_reason', override),
      })
    } else {
      sentence = t(status.before === 'inactive' ? `${S}.reactivated` : `${S}.activated`)
    }
  } else if (status.after === 'inactive') {
    sentence = t(`${S}.deactivated`, { reason: reasonName(catalog, pairOf(fields.deactivation_reason_id)?.after) })
  } else {
    sentence = t(`${S}.statusChanged`, { before: formatValue(catalog, 'status', status.before), after: formatValue(catalog, 'status', status.after) })
  }
  return { kind: 'change', sentence, lines }
}

function professionalRow(catalog: CatalogView, entry: HistoryEntry): Described | null {
  const fields = readable(fieldsOf(entry))
  if (entry.action === 'insert') {
    const lines = CREATION_FIELDS.filter((column) => {
      const value = fields[column]
      return value !== null && value !== undefined && value !== '' && value !== REDACTED
    }).map((column): HistoryLine => ({ kind: 'value', field: fieldLabel('professionals', column), value: formatValue(catalog, column, fields[column]) }))
    return { kind: 'change', sentence: t(`${H}.sentences.created`), lines }
  }
  if (entry.action === 'delete') return { kind: 'change', sentence: t(`${H}.sentences.deleted`), lines: [] }
  const status = pairOf(fields.status)
  return status ? statusUpdate(catalog, fields, status) : fieldUpdate(catalog, 'professionals', fields)
}

function professionRow(ctx: HistoryContext, entry: HistoryEntry): Described | null {
  const fields = readable(fieldsOf(entry))
  const S = `${H}.sentences`
  const T = 'professional_professions'
  const titleId = typeof fields.profession_title_id === 'string' ? fields.profession_title_id : ctx.titleByRow.get(itemIdOf(entry))
  const title = titleName(ctx.catalog, titleId)
  if (entry.action !== 'update') {
    const added = entry.action === 'insert'
    const lines: HistoryLine[] = []
    if (added) {
      // An empty licence says nothing; « Titre principal » only when it is the primary one.
      const licence = fields.licence_number
      if (typeof licence === 'string' && licence.trim() !== '' && licence !== REDACTED) {
        lines.push({ kind: 'value', field: fieldLabel(T, 'licence_number'), value: formatValue(ctx.catalog, 'licence_number', licence) })
      }
      if (fields.is_primary === true) lines.push({ kind: 'value', field: fieldLabel(T, 'is_primary'), value: formatValue(ctx.catalog, 'is_primary', true) })
    }
    return { kind: 'change', sentence: t(added ? `${S}.titleAdded` : `${S}.titleRemoved`, { title }), lines }
  }
  // A primary that loses the flag: the row becoming primary in the same save says it.
  const { is_primary: primary, ...rest } = fields
  const becamePrimary = pairOf(primary)?.after === true
  const licence = pairOf(fields.licence_number)
  // The licence is in the sentence; the details keep what else changed (the primary flag).
  const others = Object.entries(becamePrimary ? fields : rest).filter(([column]) => column !== 'licence_number')
  const lines = changeLines(ctx.catalog, T, Object.fromEntries(others))
  if (licence) {
    return {
      kind: 'change',
      sentence: t(`${S}.licenceChanged`, { title, before: formatValue(ctx.catalog, 'licence_number', licence.before), after: formatValue(ctx.catalog, 'licence_number', licence.after) }),
      lines,
    }
  }
  if (becamePrimary) return { kind: 'change', sentence: t(`${S}.primaryTitle`, { title }), lines: [] }
  return Object.keys(rest).length > 0 ? fieldUpdate(ctx.catalog, T, rest) : null
}

function payerRow(catalog: CatalogView, entry: HistoryEntry): Described | null {
  const fields = readable(fieldsOf(entry))
  const S = `${H}.sentences`
  const type = typeof fields.payer_type === 'string' ? fields.payer_type : itemIdOf(entry)
  // A payer this tab does not know yet reads « le numéro de payeur », never its raw key.
  const payer = (PAYER_TYPES as readonly string[]).includes(type) ? t(`${H}.values.payers.${type as PayerType}`) : t(`${H}.values.payers.other`)
  if (entry.action === 'update') {
    const number = pairOf(fields.number)
    if (!number) return fieldUpdate(catalog, 'professional_payer_numbers', fields)
    return { kind: 'change', sentence: t(`${S}.payerChanged`, { payer, before: formatValue(catalog, 'number', number.before), after: formatValue(catalog, 'number', number.after) }), lines: [] }
  }
  const number = formatValue(catalog, 'number', fields.number)
  return { kind: 'change', sentence: t(entry.action === 'insert' ? `${S}.payerAdded` : `${S}.payerRemoved`, { payer, number }), lines: [] }
}

/**
 * A consultation of private data (4a.17): « a affiché le NAS », « a affiché le numéro de compte »,
 * both listed, read from `changedFields.fields` against PRIVATE_READ_FIELDS. Any other name, or
 * none, reads « a consulté des données privées ». Never a value.
 */
function privateRead(entry: HistoryEntry): string {
  const names = fieldsOf(entry).fields
  const known = Array.isArray(names) && names.length > 0 && names.every((name) => typeof name === 'string' && Object.hasOwn(PRIVATE_READ_FIELDS, name))
  if (!known) return t(`${H}.sentences.privateReadOther`)
  const fields = [...new Set(names as PrivateReadField[])].map((name) => t(`${H}.privateFields.${PRIVATE_READ_FIELDS[name]}`))
  return t(`${H}.sentences.privateRead`, { fields: listLabel(fields) })
}

const PERCENT_COLUMNS = new Set(['retention_pct', 'suggested_pct'])
const MONEY_COLUMNS = new Set(['professional_amount_cents', 'client_price_cents'])
const SESSION_COLUMNS = new Set(['sessions_total', 'adjustment'])
const isDecision = (value: unknown): value is Decision => typeof value === 'string' && (DECISIONS as readonly string[]).includes(value)
const isDuration = (value: unknown): value is Duration => typeof value === 'number' && (DURATIONS as readonly number[]).includes(value)

/** A compensation column's value for reading: dates date-only, percents and money French, labels by name. */
function compensationValue(ctx: HistoryContext, column: string, value: unknown): string {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    if (column === 'month') return monthLabel(value)
    if (column === 'effective_from' || column === 'effective_to') return formatDateOnlyShort(value)
  }
  if (typeof value === 'number') {
    if (PERCENT_COLUMNS.has(column)) return formatPercent(value)
    if (MONEY_COLUMNS.has(column)) return formatCents(value)
    if (SESSION_COLUMNS.has(column)) return formatSessions(value)
    if (column === 'duration' && isDuration(value)) return durationLabel(value)
  }
  if (column === 'decision' && isDecision(value)) return t(`modules.professionals.compensation.decisions.${value}`)
  return formatValue(ctx.catalog, column, value)
}

/** A compensation column's label: money columns read « Prix client », not the log's « (¢) » label. */
const compensationLabel = (table: string, column: string): string =>
  column === 'client_price_cents' || column === 'professional_amount_cents' ? t(`${H}.moneyFields.${column}`) : fieldLabel(table, column)

/** « Note : … », « Séances cumulées : 55,5 »… under a new row, for the columns that hold something. */
function valueLines(ctx: HistoryContext, table: string, fields: Record<string, unknown>, columns: readonly string[]): HistoryLine[] {
  return columns
    .filter((column) => fields[column] !== null && fields[column] !== undefined && fields[column] !== '' && fields[column] !== 0)
    .map((column) => ({ kind: 'value', field: compensationLabel(table, column), value: compensationValue(ctx, column, fields[column]) }))
}

/** An update's « Champ : avant → après » lines, values read as compensation values. */
function compensationChanges(ctx: HistoryContext, table: string, fields: Record<string, unknown>): HistoryLine[] {
  return Object.entries(fields).map(([column, value]): HistoryLine => {
    const pair = pairOf(value)
    const field = compensationLabel(table, column)
    return pair
      ? { kind: 'change', field, before: compensationValue(ctx, column, pair.before), after: compensationValue(ctx, column, pair.after) }
      : { kind: 'value', field, value: t('audit.values.redacted') }
  })
}

/** A professional's applied rate or client agreement (P4-149: values shown, to `compensation` holders only). */
function datedRow(ctx: HistoryContext, table: DatedTable, entry: HistoryEntry): Described | null {
  const fields = readable(fieldsOf(entry))
  const S = `${H}.sentences`
  if (entry.action === 'update') {
    const lines = compensationChanges(ctx, table, fields)
    if (lines.length === 0) return null
    return { kind: 'change', sentence: t(table === 'professional_retention' ? `${S}.rateChanged` : `${S}.agreementChanged`), lines }
  }
  const added = entry.action === 'insert'
  const date = compensationValue(ctx, 'effective_from', fields.effective_from)
  if (table === 'professional_retention') {
    const rate = compensationValue(ctx, 'retention_pct', fields.retention_pct)
    if (!added) return { kind: 'change', sentence: t(`${S}.rateDeleted`, { rate, date }), lines: [] }
    const decision = isDecision(fields.decision) ? fields.decision : 'initial'
    const tier = typeof fields.tier_threshold === 'number' ? sessionsLabel(fields.tier_threshold) : '—'
    return { kind: 'change', sentence: t(`${S}.rateSet.${decision}`, { rate, date, tier }), lines: valueLines(ctx, table, fields, ['sessions_total', 'suggested_pct', 'note']) }
  }
  const duration = compensationValue(ctx, 'duration', fields.duration)
  if (!added) return { kind: 'change', sentence: t(`${S}.agreementDeleted`, { duration, date }), lines: [] }
  return {
    kind: 'change',
    sentence: t(`${S}.agreementAdded`, { duration, date }),
    lines: valueLines(ctx, table, fields, ['client_price_cents', 'professional_amount_cents', 'effective_to', 'note']),
  }
}

/** A month of sessions: entered, changed (the update names only what changed), removed. */
function sessionsRow(ctx: HistoryContext, entry: HistoryEntry): Described | null {
  const fields = readable(fieldsOf(entry))
  const S = `${H}.sentences`
  if (entry.action === 'update') {
    const lines = compensationChanges(ctx, SESSIONS_TABLE, fields)
    return lines.length === 0 ? null : { kind: 'change', sentence: t(`${S}.sessionsChanged`), lines }
  }
  const month = compensationValue(ctx, 'month', fields.month)
  if (entry.action === 'delete') return { kind: 'change', sentence: t(`${S}.sessionsDeleted`, { month }), lines: [] }
  return {
    kind: 'change',
    sentence: t(`${S}.sessionsSet`, { month }),
    lines: valueLines(ctx, SESSIONS_TABLE, fields, ['sessions_50_60', 'sessions_30', 'adjustment', 'note']),
  }
}

/** One audit row of a table that is not a set, as a sentence and its details. */
function describeRow(ctx: HistoryContext, entry: HistoryEntry): Described | null {
  if (entry.tableName === PRIVATE_TABLE) {
    return entry.action === 'read'
      ? { kind: 'read', sentence: privateRead(entry), lines: [] }
      : { kind: 'change', sentence: t(`${H}.sentences.privateChanged`), lines: [] }
  }
  if (isDatedTable(entry.tableName)) return datedRow(ctx, entry.tableName, entry)
  if (entry.tableName === SESSIONS_TABLE) return sessionsRow(ctx, entry)
  switch (entry.tableName) {
    case 'professionals':
      return professionalRow(ctx.catalog, entry)
    case 'professional_professions':
      return professionRow(ctx, entry)
    case 'professional_payer_numbers':
      return payerRow(ctx.catalog, entry)
  }
  const profileSentence = Object.hasOwn(PROFILE_TABLES, entry.tableName) ? PROFILE_TABLES[entry.tableName] : undefined
  if (profileSentence && entry.action === 'update') return fieldUpdate(ctx.catalog, entry.tableName, readable(fieldsOf(entry)))
  if (profileSentence && entry.action === 'insert') return { kind: 'change', sentence: t(`${H}.sentences.${profileSentence}.created`), lines: [] }
  if (profileSentence && entry.action === 'delete') return { kind: 'change', sentence: t(`${H}.sentences.${profileSentence}.deleted`), lines: [] }
  // A table this tab does not know yet (a later batch's): that something happened, never the
  // table's name or its values.
  return entry.action === 'read'
    ? { kind: 'read', sentence: t(`${H}.sentences.otherRead`), lines: [] }
    : { kind: 'change', sentence: t(`${H}.sentences.other`), lines: [] }
}

// --- Sets --------------------------------------------------------------------------------------------

interface SetBatch {
  table: SetTable
  change: SetChange
  ids: string[]
  /** Items added with the ★ (clientèles). */
  specialized: Set<string>
}

function setChangeOf(entry: HistoryEntry): SetChange | null {
  if (entry.action === 'insert') return 'added'
  if (entry.action === 'delete') return 'removed'
  const flag = pairOf(fieldsOf(entry).is_specialized)
  if (entry.action === 'update' && flag) return flag.after === true ? 'specialized' : 'unspecialized'
  return null
}

type ListTable = Exclude<SetTable, 'professional_motifs'>
const LIST_KIND = { professional_languages: 'language', professional_clienteles: 'clientele' } as const

/** The names of a batch, and how many of them (the last ones) the catalogue no longer knows. */
interface BatchNames {
  groups: HistoryNameGroup[]
  unknownCount: number
}

/**
 * The items of a language or clientèle batch, in the catalogue's order, archived ones
 * last and marked, unknown ones after them (as motifs, P4-100); « (spécialisé) » after the ones
 * added with the ★.
 */
function listItems(catalog: CatalogView, batch: SetBatch & { table: ListTable }): BatchNames {
  const list = batch.table === 'professional_languages' ? catalog.languages : catalog.clienteles
  const held = new Set(batch.ids)
  const known = list.filter((item) => held.has(item.id)).map((item) => ({ id: item.id, name: item.name, archived: !item.isActive }))
  const knownIds = new Set(known.map((item) => item.id))
  const missing = batch.ids.filter((id) => !knownIds.has(id)).map((id) => ({ id, name: unknown(LIST_KIND[batch.table]), archived: false }))
  const star = t('modules.professionals.record.overview.matching.specialized')
  const ordered = [...known.filter((item) => !item.archived), ...known.filter((item) => item.archived), ...missing]
  const items = ordered.map(({ id, name, archived }) => ({ id, name: batch.specialized.has(id) ? `${name} ${star}` : name, archived }))
  return { groups: [{ key: batch.table, name: null, items }], unknownCount: missing.length }
}

/** The motifs by category (the record's grouping, P4-249), archived ones last in each, unknown ones last under « Sans catégorie ». */
function motifGroups(catalog: CatalogView, ids: readonly string[]): BatchNames {
  const held = new Set(ids)
  const groups: HistoryNameGroup[] = []
  for (const group of catalog.motifGroups) {
    const motifs = group.motifs.filter((m) => held.has(m.id))
    if (motifs.length === 0) continue
    const ordered = [...motifs.filter((m) => m.isActive), ...motifs.filter((m) => !m.isActive)]
    groups.push({ key: group.key, name: group.name, items: ordered.map(({ id, name, isActive }) => ({ id, name, archived: !isActive })) })
  }
  const missing = ids.filter((id) => !catalog.byId.motifs.has(id)).length
  if (missing > 0) {
    const items = ids.filter((id) => !catalog.byId.motifs.has(id)).map((id) => ({ id, name: unknown('motif'), archived: false }))
    const other = groups.find((group) => group.key === OTHER_MOTIF_GROUP)
    // « Sans catégorie » is the catalogue's last group (catalog-view), so the unknown ones end the list.
    if (other) other.items.push(...items)
    else groups.push({ key: OTHER_MOTIF_GROUP, name: t('modules.professionals.otherCategory'), items })
  }
  return { groups, unknownCount: missing }
}

/** The names for a sentence: active ones first, then archived, then unknown — the same for every set. */
function sentenceNames({ groups, unknownCount }: BatchNames): string[] {
  const items = groups.flatMap((group) => group.items)
  const known = items.slice(0, items.length - unknownCount)
  return [...known.filter((item) => !item.archived), ...known.filter((item) => item.archived), ...items.slice(items.length - unknownCount)].map(
    historyItemLabel,
  )
}

/** « Ancien motif (archivé) » inside a sentence. */
export const historyItemLabel = (item: HeldMotif) =>
  item.archived ? `${item.name} (${t('modules.professionals.record.overview.matching.archived')})` : item.name

const isListBatch = (batch: SetBatch): batch is SetBatch & { table: ListTable } => batch.table !== 'professional_motifs'

/**
 * « a ajouté le motif Anxiété », « a ajouté les motifs A, B et C »; past FEW_MOTIFS items, a count
 * (« a ajouté 65 motifs ») with the names behind the disclosure, never one huge sentence.
 */
function describeSet(catalog: CatalogView, batch: SetBatch): Pick<HistoryEvent, 'sentence' | 'groups'> {
  const named = isListBatch(batch) ? listItems(catalog, batch) : motifGroups(catalog, batch.ids)
  const { groups } = named
  const names = sentenceNames(named)
  const count = String(batch.ids.length)
  if (batch.change === 'added' || batch.change === 'removed') {
    const S = `${H}.sets.${batch.table}` as const
    if (names.length > FEW_MOTIFS) return { sentence: t(`${S}.${batch.change}Many`, { count }), groups }
    const sentence = names.length === 1 ? t(`${S}.${batch.change}One`, { name: names[0] ?? '' }) : t(`${S}.${batch.change}Few`, { names: listLabel(names) })
    return { sentence, groups: [] }
  }
  // Only clientèles carry the ★ (setChangeOf reads `is_specialized`).
  const S = `${H}.sets.${batch.table as 'professional_clienteles'}` as const
  if (names.length > FEW_MOTIFS) return { sentence: t(`${S}.${batch.change}Many`, { count }), groups }
  return { sentence: t(`${S}.${batch.change}Few`, { names: listLabel(names) }), groups: [] }
}

// --- Assembly ----------------------------------------------------------------------------------------

/**
 * The subject of the sentence: the person's name; « Une personne qui n'a plus accès » for an actor
 * id the clinic no longer names; else what wrote the row, by source (P4-104): `seed` and
 * `import…` → « L'importation », `migration:…` → « Une mise à jour du système », anything else
 * (`bootstrap`, `service`…) → « Le système ».
 */
function actorOf(entry: HistoryEntry): { actor: string; byPerson: boolean } {
  if (entry.actorName) return { actor: entry.actorName, byPerson: true }
  if (entry.actorId) return { actor: t(`${H}.actors.unknown`), byPerson: false }
  const source = entry.source
  if (source === 'seed' || source.startsWith('seed:') || source === 'import' || source.startsWith('import:')) return { actor: t(`${H}.actors.import`), byPerson: false }
  if (source.startsWith('migration:')) return { actor: t(`${H}.actors.migration`), byPerson: false }
  return { actor: t(`${H}.actors.system`), byPerson: false }
}

const isSetTable = (table: string): table is SetTable => Object.hasOwn(SET_TABLES, table)

/**
 * Audit rows (newest first) → events (newest first). Rows of one set save (same transaction,
 * table and kind of change) become one event; the empty 1:1 rows created with the record are
 * folded into « a créé le dossier »; every other row is its own event. A row with nothing to say
 * (a former primary title losing the flag) gives none.
 */
export function buildHistoryEvents(rows: readonly HistoryEntry[], ctx: HistoryContext): HistoryEvent[] {
  const creations = new Set(rows.filter((r) => r.tableName === 'professionals' && r.action === 'insert').map(transactionOf))
  // A dated row added or removed closes or reopens its neighbour in the same save (P4-145).
  const datedWrites = new Set(rows.filter((r) => isDatedTable(r.tableName) && r.action !== 'update').map((r) => `${transactionOf(r)}|${r.tableName}`))
  const isNeighbourUpdate = (entry: HistoryEntry) =>
    isDatedTable(entry.tableName) &&
    entry.action === 'update' &&
    datedWrites.has(`${transactionOf(entry)}|${entry.tableName}`) &&
    Object.keys(readable(fieldsOf(entry))).every((column) => column === 'effective_to')
  const units: (HistoryEntry | { first: HistoryEntry; batch: SetBatch })[] = []
  const batches = new Map<string, SetBatch>()
  for (const entry of rows) {
    if (isSetTable(entry.tableName)) {
      const change = setChangeOf(entry)
      if (!change) continue
      const key = `${transactionOf(entry)}|${entry.tableName}|${change}`
      let batch = batches.get(key)
      if (!batch) {
        batch = { table: entry.tableName, change, ids: [], specialized: new Set() }
        batches.set(key, batch)
        units.push({ first: entry, batch })
      }
      const fields = fieldsOf(entry)
      const column = SET_TABLES[entry.tableName]
      const id = typeof fields[column] === 'string' ? (fields[column] as string) : itemIdOf(entry)
      batch.ids.push(id)
      if (change === 'added' && fields.is_specialized === true) batch.specialized.add(id)
      continue
    }
    if (Object.hasOwn(PROFILE_TABLES, entry.tableName) && entry.action === 'insert' && creations.has(transactionOf(entry))) continue
    if (isNeighbourUpdate(entry)) continue
    units.push(entry)
  }

  const events: HistoryEvent[] = []
  for (const unit of units) {
    const entry = 'batch' in unit ? unit.first : unit
    const base = { id: entry.id, createdAt: entry.createdAt, ...actorOf(entry) }
    if ('batch' in unit) {
      events.push({ ...base, kind: 'change', lines: [], ...describeSet(ctx.catalog, unit.batch) })
      continue
    }
    const described = describeRow(ctx, entry)
    if (described) events.push({ ...base, ...described, groups: [] })
  }
  return events
}

/**
 * The rows that can be read now. While more pages remain, the oldest transaction on screen may
 * continue on the next page (a save of 72 motifs writes 72 rows), so its rows wait for that page:
 * « a ajouté 50 motifs » then « 72 » would be wrong. Without more pages, every row.
 */
export function settledHistoryRows(rows: readonly HistoryEntry[], more: boolean): readonly HistoryEntry[] {
  const last = rows.at(-1)
  if (!more || !last) return rows
  const open = transactionOf(last)
  let end = rows.length
  while (end > 0 && transactionOf(rows[end - 1] as HistoryEntry) === open) end -= 1
  return rows.slice(0, end)
}

/**
 * Whether the tab must read on by itself (P4-101): more pages exist and the last loaded page
 * holds only rows of the held-back save (its first row is of the same transaction as its last).
 * That page added nothing to the screen, so « Charger plus » would seem to do nothing. An empty
 * last page, or the end of the history, stops it.
 */
export function historyReadsOn(pages: readonly (readonly HistoryEntry[])[], more: boolean): boolean {
  const last = pages.at(-1)
  const first = last?.[0]
  const end = last?.at(-1)
  return more && first !== undefined && end !== undefined && transactionOf(first) === transactionOf(end)
}

/** The professions' title ids by row id: the record's rows, and any loaded row that names its title. */
export function professionTitlesByRow(rows: readonly HistoryEntry[], record: Pick<ProfessionalRecord, 'professions'>): Map<string, string> {
  const titles = new Map(record.professions.map((p) => [p.id, p.titleId]))
  for (const entry of rows) {
    if (entry.tableName !== 'professional_professions') continue
    const title = fieldsOf(entry).profession_title_id
    const rowId = itemIdOf(entry)
    if (typeof title === 'string' && !titles.has(rowId)) titles.set(rowId, title)
  }
  return titles
}

export function filterHistory(events: readonly HistoryEvent[], filter: HistoryFilter): readonly HistoryEvent[] {
  return filter === 'all' ? events : events.filter((event) => event.kind === 'change')
}

export interface HistoryDay {
  /**
   * Unique among the days: `yyyy-MM-dd` in the clinic's timezone, then `-2`, `-3`… when the same
   * day comes back (rows are ordered by audit id, and a long transaction may commit after a
   * later one, across midnight).
   */
  key: string
  /** `yyyy-MM-dd` in the clinic's timezone. */
  date: string
  /** « Jeudi 8 octobre 2026 ». */
  label: string
  events: HistoryEvent[]
}

/** Events (newest first) by clinic day, newest day first. */
export function groupHistoryByDay(events: readonly HistoryEvent[]): HistoryDay[] {
  const days: HistoryDay[] = []
  const seen = new Map<string, number>()
  for (const event of events) {
    const date = getClinicDateString(event.createdAt)
    let day = days.at(-1)
    if (day?.date !== date) {
      const label = formatClinicDateFull(event.createdAt)
      const count = (seen.get(date) ?? 0) + 1
      seen.set(date, count)
      day = { key: count === 1 ? date : `${date}-${count}`, date, label: label.charAt(0).toLocaleUpperCase('fr-CA') + label.slice(1), events: [] }
      days.push(day)
    }
    day.events.push(event)
  }
  return days
}
