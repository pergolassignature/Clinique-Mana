import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { useProfessionalHistory } from '../../../hooks/use-professional-record'
import {
  buildHistoryEvents,
  filterHistory,
  groupHistoryByDay,
  HISTORY_FILTERS,
  historyReadsOn,
  professionTitlesByRow,
  settledHistoryRows,
  type HistoryEvent,
  type HistoryFilter,
  type HistoryLine,
} from '../../../lib/history'
import { CategoryNames, Disclosure } from '../MotifsSummary'
import { useRecordData } from '../record-context'

const H = 'modules.professionals.history'

/**
 * « Historique » (Task 4a.15): the file's audit trail as one timeline, newest first, by clinic
 * day. Each entry reads « {qui} {a fait quoi} » and unfolds to its details; nothing shows raw JSON,
 * an id or a redacted value (D5, Loi 25). Fetched when the tab opens (or on its hover), 50 rows a
 * page; « Charger plus » reads on.
 */
export function HistoryTab() {
  const { record, catalog } = useRecordData()
  const { data, isPending, isError, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useProfessionalHistory(record.professional.id)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const endRef = useRef<HTMLParagraphElement>(null)
  const loadMorePressed = useRef(false)

  const pages = data?.pages
  const rows = useMemo(() => pages?.flat() ?? [], [pages])
  const settled = useMemo(() => settledHistoryRows(rows, hasNextPage), [rows, hasNextPage])
  const events = useMemo(
    () => buildHistoryEvents(settled, { catalog, titleByRow: professionTitlesByRow(rows, record) }),
    [settled, rows, catalog, record],
  )
  const days = useMemo(() => groupHistoryByDay(filterHistory(events, filter)), [events, filter])

  // A last page holding only the held-back save added nothing to the screen (the first page, or
  // the one « Charger plus » brought): read on, page by page, until the save ends (P4-101). It
  // stops on an error, an empty page or the end of the history. Each new page re-runs this
  // (`pageCount`): a quick fetch may never render as pending.
  const readsOn = historyReadsOn(pages ?? [], hasNextPage)
  const chaining = readsOn && !isFetchNextPageError
  const pageCount = pages?.length ?? 0
  useEffect(() => {
    if (chaining && !isFetchingNextPage) void fetchNextPage()
  }, [chaining, pageCount, isFetchingNextPage, fetchNextPage])
  const loadingMore = isFetchingNextPage || chaining

  // After « Charger plus » (and the pages it reads on) reaches the start, its button goes away:
  // focus moves to « Début de l'historique ».
  useEffect(() => {
    if (isFetchingNextPage || readsOn || !loadMorePressed.current) return
    loadMorePressed.current = false
    if (!hasNextPage) endRef.current?.focus()
  }, [hasNextPage, isFetchingNextPage, readsOn])

  let content: ReactNode
  if (isPending || (chaining && events.length === 0)) {
    content = <Loading />
  } else if (isError && !data) {
    content = <LoadError message={t(`${H}.loadError`)} retrying={isFetching} onRetry={() => void refetch()} />
  } else if (readsOn && events.length === 0) {
    // The save that fills the first pages could not be read to its end: nothing to show but the retry.
    content = <LoadError message={t(`${H}.loadError`)} retrying={isFetchingNextPage} onRetry={() => void fetchNextPage()} />
  } else {
    content = (
      <>
        {events.length === 0 && !hasNextPage ? (
          <EmptyState title={t(`${H}.empty.title`)} body={t(`${H}.empty.body`)} />
        ) : days.length === 0 ? (
          // Only a filter can empty loaded entries; without one, the list waits for « Charger plus ».
          filter !== 'all' && <EmptyState title={t(`${H}.emptyFiltered.title`)} body={t(`${H}.emptyFiltered.body`)} />
        ) : (
          <div className="space-y-5">
            {days.map((day) => (
              <HistoryDaySection key={day.key} label={day.label} events={day.events} />
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-light pt-3 text-xs text-muted-foreground">
          {hasNextPage ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={loadingMore || undefined}
                onClick={ignoreWhenInactive(loadingMore, () => {
                  loadMorePressed.current = true
                  void fetchNextPage()
                })}
                className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {loadingMore ? t(`${H}.loadingMore`) : t(`${H}.loadMore`)}
              </Button>
              {isFetchNextPageError && !isFetchingNextPage && <p role="alert">{t(`${H}.loadMoreError`)}</p>}
            </>
          ) : (
            events.length > 0 && (
              <p ref={endRef} tabIndex={-1} className="outline-none">
                {t(`${H}.end`)}
              </p>
            )
          )}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      <SegmentedToggle
        label={t(`${H}.filter.label`)}
        options={HISTORY_FILTERS.map((value) => ({ value, label: t(`${H}.filter.${value}`) }))}
        value={filter}
        onChange={setFilter}
      />
      <Card>
        <CardContent className="pt-4">{content}</CardContent>
      </Card>
    </div>
  )
}

function HistoryDaySection({ label, events }: { label: string; events: readonly HistoryEvent[] }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      <ol className="mt-2 space-y-2">
        {events.map((event) => (
          <HistoryItem key={event.id} event={event} />
        ))}
      </ol>
    </section>
  )
}

/**
 * « 14:30  Admin Local a modifié la ville », unfolding to its details when it has any. Memoised:
 * an event keeps its identity until the loaded rows change, so the loading state of « Charger
 * plus » and the filter do not re-render the entries.
 */
const HistoryItem = memo(function HistoryItem({ event }: { event: HistoryEvent }) {
  const text = (
    <>
      <span className={cn('font-medium', !event.byPerson && 'text-muted-foreground')}>{event.actor}</span> {event.sentence}
    </>
  )
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 text-sm">
      <time dateTime={event.createdAt} className="tabular-nums text-muted-foreground">
        {formatClinicTime(event.createdAt)}
      </time>
      {/* Values (emails, reasons) may be long words: they wrap anywhere rather than widen the page. */}
      <div className="min-w-0 [overflow-wrap:anywhere]">
        {event.lines.length > 0 || event.groups.length > 0 ? (
          <Disclosure label={text}>
            <HistoryDetails event={event} />
          </Disclosure>
        ) : (
          // Aligned with the text of the entries that have a chevron (14 px + 4 px gap).
          <p className="pl-[18px]">{text}</p>
        )}
      </div>
    </li>
  )
})

function lineText(line: HistoryLine): string {
  switch (line.kind) {
    case 'change':
      return t('audit.details.change', { field: line.field, before: line.before, after: line.after })
    case 'value':
      return t('audit.details.value', { field: line.field, value: line.value })
    case 'text':
      return line.text
  }
}

/**
 * The « Champ : avant → après » lines, then the names a counted sentence stands for: by category
 * for motifs, each category's title on its own line and every name under it (P4-249), as on the
 * record.
 */
function HistoryDetails({ event }: { event: HistoryEvent }) {
  return (
    <>
      {event.lines.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground">
          {event.lines.map((line, index) => (
            <li key={index}>{lineText(line)}</li>
          ))}
        </ul>
      )}
      {event.groups.length > 0 && <CategoryNames groups={event.groups} className={cn(event.lines.length > 0 && 'mt-2')} />}
    </>
  )
}
