import { formatClinicDateFull, getClinicDateString } from '@/shared/lib/timezone'
import type { ClientHistoryEntry } from '../api/parse'

// The record's « Historique » (C4), pure.

/** Ids and timestamps say nothing to the reader (the entry has its time): left out of the details. */
const HIDDEN = (column: string) => column === 'id' || column.endsWith('_id') || column === 'created_at' || column === 'updated_at'
/** On a creation or a deletion, an empty value or a « Non » says nothing either: what was given is listed. */
const EMPTY = (value: unknown) => value === null || value === '' || value === false

/**
 * The entry as the history shows it: without ids and timestamps, and a creation or deletion
 * without its empty values (an update keeps them: « (vide) → … » is a change).
 */
export function readable(entry: ClientHistoryEntry): ClientHistoryEntry {
  const fields = entry.changed_fields
  if (entry.action === 'read' || typeof fields !== 'object' || fields === null || Array.isArray(fields)) return entry
  const whole = entry.action === 'insert' || entry.action === 'delete'
  return { ...entry, changed_fields: Object.fromEntries(Object.entries(fields).filter(([column, value]) => !HIDDEN(column) && !(whole && EMPTY(value)))) }
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
