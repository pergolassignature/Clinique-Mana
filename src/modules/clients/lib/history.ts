import { formatClinicDateFull, getClinicDateString } from '@/shared/lib/timezone'
import type { ClientHistoryEntry } from '../api/parse'

// The record's « Historique » (C4), pure.

/** Ids and timestamps say nothing to the reader (the entry has its time): left out of the details, but the ids the history names. */
const NAMED = new Set(['primary_professional_id', 'professional_id', 'referral_source_id', 'tag_id'])
const HIDDEN = (column: string) => (column === 'id' || column.endsWith('_id') || column === 'created_at' || column === 'updated_at') && !NAMED.has(column)
/** On a creation or a deletion, an empty value or a « Non » says nothing either: what was given is listed. */
const EMPTY = (value: unknown) => value === null || value === '' || value === false

/**
 * The entry as the history shows it: without ids and timestamps, and a creation or deletion
 * without its empty values (an update keeps them: « (vide) → … » is a change).
 */
export function readable(entry: ClientHistoryEntry, names: ReadonlyMap<string, string> = new Map()): ClientHistoryEntry {
  const fields = entry.changed_fields
  if (entry.action === 'read' || typeof fields !== 'object' || fields === null || Array.isArray(fields)) return entry
  const whole = entry.action === 'insert' || entry.action === 'delete'
  const name = (value: unknown) => (typeof value === 'string' ? (names.get(value) ?? value) : value)
  const named = (column: string, value: unknown) => {
    if (!NAMED.has(column)) return value
    if (typeof value === 'object' && value !== null && 'before' in value && 'after' in value) {
      const change = value as { before: unknown; after: unknown }
      return { before: name(change.before), after: name(change.after) }
    }
    return name(value)
  }
  return {
    ...entry,
    changed_fields: Object.fromEntries(
      Object.entries(fields)
        .filter(([column, value]) => !HIDDEN(column) && !(whole && EMPTY(value)))
        .map(([column, value]) => [column, named(column, value)]),
    ),
  }
}

/** The names of the professionals, sources and tags (the record's reference lists), by id. */
export function referenceNames(reference: { professionals: readonly { id: string; name: string }[]; referralSources: readonly { id: string; name: string }[]; tags: readonly { id: string; name: string }[] }): Map<string, string> {
  return new Map([...reference.professionals, ...reference.referralSources, ...reference.tags].map((o) => [o.id, o.name]))
}

/** The people the entries name (their authors), for the `*_by` values. */
export function peopleOf(entries: readonly ClientHistoryEntry[]): Map<string, string> {
  const people = new Map<string, string>()
  for (const entry of entries) if (entry.actor_id && entry.actor_name) people.set(entry.actor_id, entry.actor_name)
  return people
}

/** The entries by clinic day, newest first (the rows already come newest first). */
export function groupByDay(entries: readonly ClientHistoryEntry[]): { day: string; label: string; entries: ClientHistoryEntry[] }[] {
  const days: { day: string; label: string; entries: ClientHistoryEntry[] }[] = []
  for (const entry of entries) {
    const day = getClinicDateString(new Date(entry.created_at))
    const last = days.at(-1)
    if (last?.day === day) last.entries.push(entry)
    else days.push({ day, label: formatClinicDateFull(entry.created_at), entries: [entry] })
  }
  return days
}
