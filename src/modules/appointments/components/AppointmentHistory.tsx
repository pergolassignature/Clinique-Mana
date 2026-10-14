import { useMemo } from 'react'
import { t } from '@/i18n'
import { actionLabel, auditDetailLines, tableLabel, type AuditDetailLine } from '@/core/audit/labels'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateFull, formatClinicTime, getClinicDateString } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import type { AgendaReference } from '../api/agenda'
import type { AppointmentHistoryEntry } from '../api/history'
import type { AgendaAppointment } from '../api/parse'
import { useAppointmentHistory } from '../hooks/use-agenda'
import { appointmentsAuditLabels } from '../lib/audit-labels'

const H = 'modules.appointments.editor.history'
const MODULE_LABELS = [appointmentsAuditLabels]
/** The ids the history names; every other id and the timestamps say nothing (the entry has its time). */
const NAMED = new Set(['professional_id', 'service_id', 'client_id', 'cancel_reason_id'])
const HIDDEN = (column: string) => (column === 'id' || column.endsWith('_id') || column === 'created_at' || column === 'updated_at') && !NAMED.has(column)
const EMPTY = (value: unknown) => value === null || value === '' || value === false

/** The entry without ids and timestamps, the names of the professional, service, client and reason, a creation without its empty values. */
function readable(entry: AppointmentHistoryEntry, names: ReadonlyMap<string, string>): AppointmentHistoryEntry {
  const fields = entry.changed_fields
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return entry
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

function DetailLine({ line }: { line: AuditDetailLine }) {
  if (line.kind === 'text') return <li>{line.text}</li>
  if (line.kind === 'value') {
    return (
      <li>
        <span className="text-muted-foreground">{line.field} : </span>
        <span title={line.value.title}>{line.value.text}</span>
      </li>
    )
  }
  return (
    <li>
      <span className="text-muted-foreground">{line.field} : </span>
      <span title={line.before.title}>{line.before.text}</span>
      {t(`${H}.arrow`)}
      <span title={line.after.title}>{line.after.text}</span>
    </li>
  )
}

/**
 * The sheet's « Historique » (AP-33): who did what to this appointment, its participants and its
 * video meeting, newest first, by clinic day, in the Journal d'audit's words; redacted values (the
 * notes, the message) stay « (masqué) ». 50 rows a page, « Charger plus ».
 */
export function AppointmentHistory({ appointment: a, reference }: { appointment: AgendaAppointment; reference: AgendaReference }) {
  const history = useAppointmentHistory(a.id)
  const entries = useMemo(() => history.data?.pages.flat() ?? [], [history.data])
  const names = useMemo(
    () =>
      new Map<string, string>([
        ...reference.professionals.map((p): [string, string] => [p.id, p.name]),
        ...reference.services.map((s): [string, string] => [s.id, `${s.code} · ${s.name}`]),
        ...reference.reasons.map((r): [string, string] => [r.id, r.name]),
        ...a.participants.map((p): [string, string] => [p.clientId, p.name]),
      ]),
    [reference, a.participants],
  )
  const people = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) if (entry.actor_id && entry.actor_name) map.set(entry.actor_id, entry.actor_name)
    return map
  }, [entries])
  const days = useMemo(() => {
    const list: { day: string; label: string; entries: AppointmentHistoryEntry[] }[] = []
    for (const entry of entries) {
      const day = getClinicDateString(entry.created_at)
      const last = list.at(-1)
      if (last?.day === day) last.entries.push(entry)
      else list.push({ day, label: formatClinicDateFull(entry.created_at), entries: [entry] })
    }
    return list
  }, [entries])

  if (history.isError && !history.data) return <LoadError message={t(`${H}.loadError`)} onRetry={() => void history.refetch()} retrying={history.isFetching} />
  if (!history.data) return <Loading />
  if (entries.length === 0) return <EmptyState title={t(`${H}.empty`)} inCard={false} />
  return (
    <div className="space-y-5">
      {days.map((day) => (
        <section key={day.day} aria-label={day.label} className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{day.label}</h3>
          <ol className="space-y-3">
            {day.entries.map((entry) => (
              <li key={entry.id} className="space-y-1 rounded-md border border-border p-3 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular text-muted-foreground">{formatClinicTime(entry.created_at)}</span>
                  <span className="font-medium">{entry.actor_name ?? t(entry.source.startsWith('link:') ? `${H}.client` : `${H}.system`)}</span>
                  <span>
                    {actionLabel(entry.action)} · {tableLabel(entry.table_name, MODULE_LABELS)}
                  </span>
                </p>
                <ul className="space-y-0.5 text-xs">
                  {auditDetailLines(readable(entry, names), { moduleLabels: MODULE_LABELS, people }).map((line, i) => (
                    <DetailLine key={i} line={line} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {history.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          aria-disabled={history.isFetchingNextPage || undefined}
          onClick={ignoreWhenInactive(history.isFetchingNextPage, () => void history.fetchNextPage())}
          className={softDisabledClasses}
        >
          {t(history.isFetchingNextPage ? `${H}.loadingMore` : `${H}.loadMore`)}
        </Button>
      )}
    </div>
  )
}
