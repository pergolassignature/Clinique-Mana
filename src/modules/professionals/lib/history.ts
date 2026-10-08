import { t, type TranslationKey } from '@/i18n'
import { fieldLabel, tableLabel } from '@/core/audit/labels'
import { formatPhone } from '@/shared/lib/format'
import { formatClinicDateFull, getClinicDateString } from '@/shared/lib/timezone'
import type { HistoryEntry, ProfessionalRecord } from '../api/parse'
import { OTHER_MOTIF_GROUP, type CatalogView } from './catalog-view'
import { PROFESSIONAL_STATUSES, type AvailabilityPeriod, type ProfessionalStatus } from './constants'
import { listLabel, periodsLabel, statusLabel } from './display'
import { FEW_MOTIFS, summarizeMotifs, type HeldMotif } from './motif-summary'

/**
 * The Historique tab's reading of `list_professional_history` (Task 4a.15): audit rows become
 * French sentences (« a modifié la ville », « a ajouté 65 motifs »), with the details behind a
 * disclosure. No raw JSON and no UUID ever reaches the screen (D5): ids are named through the
 * catalogue, and values the audit trigger redacted (« [redacted] ») are never read, only the fact
 * that the field changed.
 */

const H = 'modules.professionals.history'

/** What `private.audit_trigger` writes in place of a redacted column (Loi 25). */
const REDACTED = '[redacted]'

/** Columns that say nothing to a reader: ids, the org, timestamps, who changed the status (the actor says it). */
const TECHNICAL = new Set(['id', 'org_id', 'professional_id', 'created_at', 'updated_at', 'created_by', 'status_changed_at', 'status_changed_by'])
/** Free texts: shown in the details only, never inside a sentence. */
const LONG_TEXT = new Set(['bio', 'approach', 'availability_note', 'deactivation_note', 'activation_override_reason'])
/** A creation's details: who the file is about. Everything else starts empty or at its default. */
const CREATION_FIELDS = ['first_name', 'last_name', 'email', 'profile_id']

/** The 1:1 rows created empty with the record: folded into « a créé le dossier ». */
const PROFILE_TABLES: Readonly<Record<string, 'createdPublicProfile' | 'createdMatchingProfile'>> = {
  professional_public_profiles: 'createdPublicProfile',
  professional_matching_profiles: 'createdMatchingProfile',
}
/** Tables whose field phrases (« la ville ») exist in `history.fields`. */
type PhrasedTable = 'professionals' | 'professional_public_profiles' | 'professional_matching_profiles'
const PHRASED_TABLES = new Set<string>(['professionals', ...Object.keys(PROFILE_TABLES)])

/** The set tables (junctions written by a set RPC), the column holding the item, and how to name it. */
const SET_TABLES = {
  professional_motifs: 'motif_id',
  professional_languages: 'language_id',
  professional_clienteles: 'clientele_id',
  professional_specialties: 'specialty_id',
} as const
type SetTable = keyof typeof SET_TABLES
type SetChange = 'added' | 'removed' | 'specialized' | 'unspecialized'

/** Data from 4a.17's table: the history says what happened, never the values (P4-7, P4-38). */
const PRIVATE_TABLE = 'professional_private'

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

const unknown = (kind: 'motif' | 'clientele' | 'specialty' | 'language' | 'title' | 'reason') => t(`${H}.values.unknown.${kind}`)

const isStatus = (value: unknown): value is ProfessionalStatus => typeof value === 'string' && (PROFESSIONAL_STATUSES as readonly string[]).includes(value)

function reasonName(catalog: CatalogView, id: unknown): string {
  return (typeof id === 'string' && catalog.byId.deactivationReasons.get(id)?.name) || unknown('reason')
}

function titleName(catalog: CatalogView, id: string | undefined): string {
  return (id !== undefined && catalog.byId.titles.get(id)?.name) || unknown('title')
}

/** A value for reading: never an id, never JSON. Redacted values never get here. */
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
  if (column === 'public_phone' && typeof value === 'string') return formatPhone(value)
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  // Anything else (an object, a list) is not shown raw (D5).
  return t('audit.values.empty')
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
  if (typeof note === 'string' && note !== '') lines.push({ kind: 'value', field: fieldLabel('professionals', 'deactivation_note'), value: note })
  const account = pairOf(fields.deactivation_disabled_account)
  if (account?.after === true) lines.push({ kind: 'text', text: t(`${H}.lines.accountDisabled`) })
  if (account?.before === true && account.after === false) lines.push({ kind: 'text', text: t(`${H}.lines.accountEnabled`) })

  let sentence: string
  if (status.after === 'active') {
    const override = pairOf(fields.activation_override_reason)?.after
    sentence =
      typeof override === 'string' && override !== ''
        ? t(`${S}.activatedOverride`, { reason: override })
        : t(status.before === 'inactive' ? `${S}.reactivated` : `${S}.activated`)
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
    const lines: HistoryLine[] = added
      ? ['licence_number', 'is_primary']
          .filter((column) => fields[column] !== null && fields[column] !== undefined)
          .map((column) => ({ kind: 'value', field: fieldLabel(T, column), value: formatValue(ctx.catalog, column, fields[column]) }))
      : []
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
  const payer = type === 'ivac' ? t(`${H}.values.payers.ivac`) : type
  if (entry.action === 'update') {
    const number = pairOf(fields.number)
    if (!number) return fieldUpdate(catalog, 'professional_payer_numbers', fields)
    return { kind: 'change', sentence: t(`${S}.payerChanged`, { payer, before: formatValue(catalog, 'number', number.before), after: formatValue(catalog, 'number', number.after) }), lines: [] }
  }
  const number = formatValue(catalog, 'number', fields.number)
  return { kind: 'change', sentence: t(entry.action === 'insert' ? `${S}.payerAdded` : `${S}.payerRemoved`, { payer, number }), lines: [] }
}

/** One audit row of a table that is not a set, as a sentence and its details. */
function describeRow(ctx: HistoryContext, entry: HistoryEntry): Described | null {
  if (entry.tableName === PRIVATE_TABLE) {
    return entry.action === 'read'
      ? { kind: 'read', sentence: t(`${H}.sentences.privateRead`), lines: [] }
      : { kind: 'change', sentence: t(`${H}.sentences.privateChanged`), lines: [] }
  }
  switch (entry.tableName) {
    case 'professionals':
      return professionalRow(ctx.catalog, entry)
    case 'professional_professions':
      return professionRow(ctx, entry)
    case 'professional_payer_numbers':
      return payerRow(ctx.catalog, entry)
  }
  const profileSentence = PROFILE_TABLES[entry.tableName]
  if (profileSentence && entry.action === 'update') return fieldUpdate(ctx.catalog, entry.tableName, readable(fieldsOf(entry)))
  if (profileSentence && entry.action === 'insert') return { kind: 'change', sentence: t(`${H}.sentences.${profileSentence}`), lines: [] }
  // A table this tab does not know yet (a later batch's): what it is, never its values.
  return { kind: entry.action === 'read' ? 'read' : 'change', sentence: t(`${H}.sentences.other`, { section: tableLabel(entry.tableName) }), lines: [] }
}

// --- Sets --------------------------------------------------------------------------------------------

interface SetBatch {
  table: SetTable
  change: SetChange
  ids: string[]
  /** Items added with the ★ (clientèles, approaches). */
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
const LIST_KIND = { professional_languages: 'language', professional_clienteles: 'clientele', professional_specialties: 'specialty' } as const

/**
 * The items of a language, clientèle or approach batch, in the catalogue's order (unknown ones
 * last), archived ones marked, « (spécialisé) » after the ones added with the ★.
 */
function listItems(catalog: CatalogView, batch: SetBatch & { table: ListTable }): HeldMotif[] {
  const list = batch.table === 'professional_languages' ? catalog.languages : batch.table === 'professional_clienteles' ? catalog.clienteles : catalog.specialties
  const held = new Set(batch.ids)
  const known = list.filter((item) => held.has(item.id)).map((item) => ({ id: item.id, name: item.name, archived: !item.isActive }))
  const knownIds = new Set(known.map((item) => item.id))
  const missing = batch.ids.filter((id) => !knownIds.has(id)).map((id) => ({ id, name: unknown(LIST_KIND[batch.table]), archived: false }))
  const star = t('modules.professionals.record.overview.matching.specialized')
  return [...known, ...missing].map(({ id, name, archived }) => ({ name: batch.specialized.has(id) ? `${name} ${star}` : name, archived }))
}

/** The motifs by category (the record's grouping, P4-73), unknown ones under « Autres ». */
function motifGroups(catalog: CatalogView, ids: readonly string[]): HistoryNameGroup[] {
  const groups: HistoryNameGroup[] = summarizeMotifs(ids, catalog).full.map((group) => ({ key: group.key, name: group.name, items: group.motifs }))
  const missing = ids.filter((id) => !catalog.byId.motifs.has(id)).length
  if (missing > 0) {
    const items = Array.from({ length: missing }, () => ({ name: unknown('motif'), archived: false }))
    const other = groups.find((group) => group.key === OTHER_MOTIF_GROUP)
    if (other) other.items.push(...items)
    else groups.push({ key: OTHER_MOTIF_GROUP, name: t('modules.professionals.otherCategory'), items })
  }
  return groups
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
  const groups = isListBatch(batch) ? [{ key: batch.table, name: null, items: listItems(catalog, batch) }] : motifGroups(catalog, batch.ids)
  const names = groups.flatMap((group) => group.items.map(historyItemLabel))
  const count = String(batch.ids.length)
  if (batch.change === 'added' || batch.change === 'removed') {
    const S = `${H}.sets.${batch.table}` as const
    if (names.length > FEW_MOTIFS) return { sentence: t(`${S}.${batch.change}Many`, { count }), groups }
    const sentence = names.length === 1 ? t(`${S}.${batch.change}One`, { name: names[0] ?? '' }) : t(`${S}.${batch.change}Few`, { names: listLabel(names) })
    return { sentence, groups: [] }
  }
  // Only clientèles and approaches carry the ★ (setChangeOf reads `is_specialized`).
  const S = `${H}.sets.${batch.table as 'professional_clienteles' | 'professional_specialties'}` as const
  if (names.length > FEW_MOTIFS) return { sentence: t(`${S}.${batch.change}Many`, { count }), groups }
  return { sentence: t(`${S}.${batch.change}Few`, { names: listLabel(names) }), groups: [] }
}

// --- Assembly ----------------------------------------------------------------------------------------

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
    if (PROFILE_TABLES[entry.tableName] && entry.action === 'insert' && creations.has(transactionOf(entry))) continue
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
  /** `yyyy-MM-dd` in the clinic's timezone. */
  key: string
  /** « Jeudi 8 octobre 2026 ». */
  label: string
  events: HistoryEvent[]
}

/** Events (newest first) by clinic day, newest day first. */
export function groupHistoryByDay(events: readonly HistoryEvent[]): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const event of events) {
    const key = getClinicDateString(event.createdAt)
    let day = days.at(-1)
    if (day?.key !== key) {
      const label = formatClinicDateFull(event.createdAt)
      day = { key, label: label.charAt(0).toLocaleUpperCase('fr-CA') + label.slice(1), events: [] }
      days.push(day)
    }
    day.events.push(event)
  }
  return days
}
