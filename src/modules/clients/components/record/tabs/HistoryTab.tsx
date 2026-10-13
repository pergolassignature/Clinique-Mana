import { useMemo } from 'react'
import { t } from '@/i18n'
import { actionLabel, auditDetailLines, tableLabel, type AuditDetailLine } from '@/core/audit/labels'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { useClientHistory } from '../../../hooks/use-clients'
import { clientsAuditLabels } from '../../../lib/audit-labels'
import { groupByDay, peopleOf, readable } from '../../../lib/history'
import { useClientRecordData } from '../record-context'

const H = 'modules.clients.record.history'
const MODULE_LABELS = [clientsAuditLabels]

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
 * « Historique » (plan C3.4, done in C4): the file's audit trail, newest first, by clinic day:
 * who, when, what (« Modification · Clients ») and the changed fields in the Journal d'audit's
 * words. Personal values arrive redacted (« (masqué) », CL-10): the history shows that a name or
 * a phone changed, never to what. Read when the tab opens, 50 rows a page, « Charger plus ».
 */
export function HistoryTab() {
  const { summary } = useClientRecordData()
  const history = useClientHistory(summary.client.id)
  const entries = useMemo(() => history.data?.pages.flat() ?? [], [history.data])
  const days = useMemo(() => groupByDay(entries), [entries])
  const lookups = useMemo(() => ({ moduleLabels: MODULE_LABELS, people: peopleOf(entries) }), [entries])

  if (history.isError && !history.data) return <LoadError message={t(`${H}.loadError`)} onRetry={() => void history.refetch()} retrying={history.isFetching} />
  if (!history.data) return <Loading />

  return (
    <SettingsCard as="section" title={t(`${H}.title`)} description={t(`${H}.description`)}>
      {entries.length === 0 ? (
        <EmptyState title={t(`${H}.empty`)} inCard={false} />
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.day} aria-label={day.label} className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{day.label}</h3>
              <ol className="space-y-3">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="space-y-1 rounded-md border border-border p-3 text-sm">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="tabular text-muted-foreground">{formatClinicTime(entry.created_at)}</span>
                      <span className="font-medium">{entry.actor_name ?? t(`${H}.system`)}</span>
                      <span>
                        {actionLabel(entry.action)} · {tableLabel(entry.table_name, MODULE_LABELS)}
                      </span>
                    </p>
                    <ul className="space-y-0.5 text-xs">
                      {auditDetailLines(readable(entry), lookups).map((line, i) => (
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
              className={cn(softDisabledClasses)}
            >
              {t(history.isFetchingNextPage ? `${H}.loadingMore` : `${H}.loadMore`)}
            </Button>
          )}
          {history.isFetchNextPageError && <p className="text-sm text-destructive">{t(`${H}.loadMoreError`)}</p>}
        </div>
      )}
    </SettingsCard>
  )
}
