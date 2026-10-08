import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import type { AuditEntry, AuditFilters } from '@/core/audit/api'
import { useAuditActors, useAuditEntries } from '@/core/audit/hooks'
import {
  actionLabel,
  AUDITED_TABLES,
  auditDetailLines,
  shortRecordId,
  sourceLabel,
  tableLabel,
} from '@/core/audit/labels'
import { AUDIT_PERIODS, periodStart, type AuditPeriod } from '@/core/audit/period'
import { EmptyState } from '@/shared/components/EmptyState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { focusRing } from '@/shared/ui/field-classes'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

/** Phone: 8 px cell padding; the person and the action move under the date and the section. */
const PHONE_TABLE = 'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2'

const COLUMN_COUNT = 5

/** Who wrote the entry: the actor's name (same org only), else where it came from (« Données de test »). */
function actorOf(entry: AuditEntry): string {
  return entry.actor_name ?? sourceLabel(entry.source)
}

/**
 * Paramètres → Journal d'audit (`audit.view`, read only). Every change to the settings, newest
 * first, filtered by section, person and period (bounds computed in the clinic's timezone). Each
 * row opens onto what changed (« Champ : avant → après »); bank values only ever read « (masqué) »
 * (decision #31). « Charger plus » fetches the next 50 until « Début du journal ».
 */
export function AuditLogPage() {
  const [table, setTable] = useState('')
  const [actor, setActor] = useState('')
  const [period, setPeriod] = useState<AuditPeriod>('all')
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const sectionFilterRef = useRef<HTMLSelectElement>(null)
  const endRef = useRef<HTMLParagraphElement>(null)
  const loadMoreClicked = useRef(false)
  const detailsIdPrefix = useId()

  // Ticks every minute: the period's first day follows the clinic's date while the page stays open.
  const now = useNow(60_000)
  const from = periodStart(period, new Date(now))
  const filters = useMemo<AuditFilters>(() => ({ table: table || null, actor: actor || null, from }), [table, actor, from])
  const hasFilters = table !== '' || actor !== '' || period !== 'all'

  const { data, isPending, isError, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useAuditEntries(filters)
  const { data: actors } = useAuditActors()
  const entries = data?.pages.flat() ?? []

  // Once a « Charger plus » fetch settles: on the last page the button goes away, so its focus
  // moves to « Début du journal ». Only after a press (never after a background refetch).
  useEffect(() => {
    if (isFetchingNextPage || !loadMoreClicked.current) return
    loadMoreClicked.current = false
    if (!hasNextPage) endRef.current?.focus()
  }, [hasNextPage, isFetchingNextPage])

  /** Applies a filter change: a new query from the newest page, every row closed. */
  const changeFilter = (apply: () => void) => {
    apply()
    loadMoreClicked.current = false
    setExpanded(new Set())
  }

  const resetFilters = () => {
    changeFilter(() => {
      setTable('')
      setActor('')
      setPeriod('all')
    })
    sectionFilterRef.current?.focus()
  }

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const emptyAfterFilter = hasFilters && !isPending && !isError && entries.length === 0

  let content
  if (isPending) {
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  } else if (isError && !data) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('audit.loadError')}</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  } else if (entries.length === 0) {
    content = hasFilters ? (
      <EmptyState
        title={t('audit.emptyFiltered.title')}
        body={t('audit.emptyFiltered.body')}
        action={
          <Button type="button" variant="outline" onClick={resetFilters}>
            {t('audit.filters.reset')}
          </Button>
        }
      />
    ) : (
      <EmptyState title={t('audit.empty.title')} body={t('audit.empty.body')} />
    )
  } else {
    content = (
      <div className="rounded-lg border border-border">
        <Table scrollLabel={t('audit.scrollLabel')} className={PHONE_TABLE}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t('audit.columns.date')}</TableHead>
              <TableHead className="max-sm:hidden">{t('audit.columns.actor')}</TableHead>
              <TableHead>{t('audit.columns.table')}</TableHead>
              <TableHead className="max-sm:hidden">{t('audit.columns.action')}</TableHead>
              <TableHead className="max-sm:hidden">{t('audit.columns.record')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const open = expanded.has(entry.id)
              const detailsId = `${detailsIdPrefix}-${entry.id}`
              const date = formatClinicDateTime(entry.created_at)
              const who = actorOf(entry)
              const section = tableLabel(entry.table_name)
              const action = actionLabel(entry.action)
              return (
                <Fragment key={entry.id}>
                  <TableRow className={cn(open && 'border-b-0 bg-card-hover')}>
                    <TableCell className="whitespace-nowrap py-1">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={open ? detailsId : undefined}
                        onClick={() => toggle(entry.id)}
                        className={cn(
                          '-ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-left max-sm:min-h-11',
                          focusRing,
                        )}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn('h-3.5 w-3.5 shrink-0 text-subtle transition-transform duration-120', open && 'rotate-90')}
                        />
                        <span>
                          {date}
                          <span className="sr-only"> {t('audit.row.toggle')}</span>
                          <span className="block text-xs text-muted-foreground sm:hidden">{who}</span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="max-w-48 truncate max-sm:hidden" title={who}>
                      <span className={cn(entry.actor_name === null && 'text-muted-foreground')}>{who}</span>
                    </TableCell>
                    {/* Truncated from `sm` up; on a phone a long name wraps, so the table fits. */}
                    <TableCell className="sm:max-w-48 sm:truncate">
                      {section}
                      <span className="block text-xs text-muted-foreground sm:hidden">{action}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap max-sm:hidden">{action}</TableCell>
                    <TableCell className="whitespace-nowrap max-sm:hidden">
                      <span title={entry.record_id} className="text-muted-foreground">
                        {shortRecordId(entry.record_id)}
                      </span>
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow id={detailsId} className="bg-card-hover hover:bg-card-hover">
                      <TableCell colSpan={COLUMN_COUNT} className="h-auto pb-3 pl-8 pt-0 max-sm:pl-7">
                        <ul className="space-y-0.5">
                          {auditDetailLines(entry).map((line, index) => (
                            <li key={index} className="break-words">
                              {line}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {t('audit.details.record', { id: entry.record_id })}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <p>{entries.length === 1 ? t('audit.countOne') : t('audit.countOther', { count: String(entries.length) })}</p>
          {hasNextPage ? (
            <div className="flex flex-wrap items-center gap-2">
              {isFetchNextPageError && !isFetchingNextPage && <p role="alert">{t('audit.loadMoreError')}</p>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={isFetchingNextPage || undefined}
                onClick={ignoreWhenInactive(isFetchingNextPage, () => {
                  loadMoreClicked.current = true
                  void fetchNextPage()
                })}
                className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {isFetchingNextPage ? t('audit.loadingMore') : t('audit.loadMore')}
              </Button>
            </div>
          ) : (
            <p ref={endRef} tabIndex={-1} className="outline-none">
              {t('audit.end')}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader title={t('settings.sections.audit')} description={t('audit.description')} />
      <div role="group" aria-label={t('audit.filters.label')} className="grid gap-3 sm:max-w-form sm:grid-cols-3">
        <FormField label={t('audit.filters.table')}>
          {(field) => (
            <Select {...field} ref={sectionFilterRef} value={table} onChange={(event) => changeFilter(() => setTable(event.target.value))}>
              <option value="">{t('audit.filters.allTables')}</option>
              {AUDITED_TABLES.map((name) => (
                <option key={name} value={name}>
                  {tableLabel(name)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('audit.filters.actor')}>
          {(field) => (
            <Select {...field} value={actor} onChange={(event) => changeFilter(() => setActor(event.target.value))}>
              <option value="">{t('audit.filters.allActors')}</option>
              {actors?.map((person) => (
                <option key={person.actor_id} value={person.actor_id}>
                  {person.actor_name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('audit.filters.period')}>
          {(field) => (
            <Select
              {...field}
              value={period}
              onChange={(event) => changeFilter(() => setPeriod(event.target.value as AuditPeriod))}
            >
              {AUDIT_PERIODS.map((key) => (
                <option key={key} value={key}>
                  {t(`audit.filters.periods.${key}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      {/* Always in the page, so screen readers hear the text when it appears. */}
      <p data-testid="audit-live" aria-live="polite" className="sr-only">
        {emptyAfterFilter ? t('audit.emptyFiltered.title') : ''}
      </p>
      {content}
    </div>
  )
}
