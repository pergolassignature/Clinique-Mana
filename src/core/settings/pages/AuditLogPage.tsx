import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/i18n'
import type { AuditEntry, AuditFilters } from '@/core/audit/api'
import { useAuditActors, useAuditCatalog, useAuditEntries } from '@/core/audit/hooks'
import {
  actionLabel,
  AUDITED_TABLES,
  auditDetailLines,
  roleNamesFromEntries,
  shortRecordId,
  type AuditDetailLine,
  type AuditLookups,
  type AuditValue,
  sourceLabel,
  tableLabel,
} from '@/core/audit/labels'
import { AUDIT_PERIODS, periodStartOn, type AuditPeriod } from '@/core/audit/period'
import { useOrgRoles } from '@/core/access/org-roles'
import { EmptyState } from '@/shared/components/EmptyState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { focusRing } from '@/shared/ui/field-classes'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

/** Phone: 8 px cell padding; the person and the action move under the date and the section. */
const PHONE_TABLE = 'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2'

const COLUMN_COUNT = 5

const NO_ROWS: ReadonlySet<number> = new Set()

/** How long the live region stays empty before it says the result, so the same text is announced again. */
const ANNOUNCE_DELAY_MS = 150

/** Fills a `{name}` template from `t` with nodes (a value may carry its full form in `title`). */
function fillTemplate(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1]
    return name !== undefined && Object.hasOwn(parts, name) ? <Fragment key={index}>{parts[name]}</Fragment> : piece
  })
}

function Value({ value }: { value: AuditValue }) {
  return value.title === undefined ? value.text : <span title={value.title}>{value.text}</span>
}

/** « Champ : avant → après », « Champ : valeur » or a sentence, with the i18n templates. */
function DetailLine({ line }: { line: AuditDetailLine }) {
  switch (line.kind) {
    case 'change':
      return fillTemplate(t('audit.details.change'), {
        field: line.field,
        before: <Value value={line.before} />,
        after: <Value value={line.after} />,
      })
    case 'value':
      return fillTemplate(t('audit.details.value'), { field: line.field, value: <Value value={line.value} /> })
    case 'text':
      return line.text
  }
}

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
  const sectionFilterRef = useRef<HTMLSelectElement>(null)
  const endRef = useRef<HTMLParagraphElement>(null)
  const detailsIdPrefix = useId()

  // Changes at the clinic's midnight (one timer, no tick): the period's first day follows it.
  const clinicDate = useClinicDate()
  const from = periodStartOn(period, clinicDate)
  const filters = useMemo<AuditFilters>(() => ({ table: table || null, actor: actor || null, from }), [table, actor, from])
  const hasFilters = table !== '' || actor !== '' || period !== 'all'
  // What the rows on screen belong to. A new filter, or a new period start (midnight, unless
  // « Tout »), closes every row and drops a pending « Charger plus » focus move: both are keyed by it.
  const view = `${from ?? 'all'}|${table}|${actor}|${period}`
  const [opened, setOpened] = useState<{ view: string; ids: ReadonlySet<number> }>({ view, ids: NO_ROWS })
  const expanded = opened.view === view ? opened.ids : NO_ROWS
  const loadMoreView = useRef<string | null>(null)

  const { data, isPending, isError, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useAuditEntries(filters)
  const { data: actors, isError: actorsFailed, isFetching: actorsFetching, refetch: refetchActors } = useAuditActors()
  const { data: catalog } = useAuditCatalog()
  // Custom role names (base roles have their label); the same query as the Rôles tab, refreshed by its changes.
  const { data: roles } = useOrgRoles()
  const entries = useMemo(() => data?.pages.flat() ?? [], [data])
  // Names for the ids and keys in the details; each falls back to the raw value while missing. A
  // deleted custom role keeps the last name its own rows on screen carry; a current one, its name.
  const lookups = useMemo<AuditLookups>(
    () => ({
      people: new Map(actors?.map((person) => [person.actor_id, person.actor_name])),
      permissions: new Map(catalog?.permissions.map((permission) => [permission.key, permission.description])),
      modules: new Map(catalog?.modules.map((module) => [module.key, module.name])),
      roles: new Map([...roleNamesFromEntries(entries), ...(roles?.map((role): [string, string] => [role.key, role.name]) ?? [])]),
    }),
    [actors, catalog, roles, entries],
  )

  // Once a « Charger plus » fetch settles: on the last page the button goes away, so its focus
  // moves to « Début du journal ». Only after a press in this view (never after a refetch).
  useEffect(() => {
    if (isFetchingNextPage || loadMoreView.current === null) return
    const pressedHere = loadMoreView.current === view
    loadMoreView.current = null
    if (pressedHere && !hasNextPage) endRef.current?.focus()
  }, [hasNextPage, isFetchingNextPage, view])

  const resetFilters = () => {
    setTable('')
    setActor('')
    setPeriod('all')
    sectionFilterRef.current?.focus()
  }

  const toggle = (id: number) =>
    setOpened((current) => {
      const ids = new Set(current.view === view ? current.ids : NO_ROWS)
      if (!ids.delete(id)) ids.add(id)
      return { view, ids }
    })

  const emptyAfterFilter = hasFilters && !isPending && !isError && entries.length === 0
  // The live region is emptied on every filter change, then says the result a moment later: a
  // second empty result (even one already cached) is announced again.
  const [announcedView, setAnnouncedView] = useState<string | null>(null)
  useEffect(() => {
    if (!emptyAfterFilter) return
    const id = setTimeout(() => setAnnouncedView(view), ANNOUNCE_DELAY_MS)
    return () => clearTimeout(id)
  }, [emptyAfterFilter, view])

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
        // The live region after the filters already says it: heard once.
        titleAriaHidden
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
                          <span className="sr-only"> {t('audit.row.toggle', { action, section })}</span>
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
                          {auditDetailLines(entry, lookups).map((line, index) => (
                            <li key={index} className="break-words">
                              <DetailLine line={line} />
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
          {/* A status: the new count is announced when « Charger plus » adds rows. */}
          <p role="status">{entries.length === 1 ? t('audit.countOne') : t('audit.countOther', { count: String(entries.length) })}</p>
          {hasNextPage ? (
            <div className="flex flex-wrap items-center gap-2">
              {isFetchNextPageError && !isFetchingNextPage && <p role="alert">{t('audit.loadMoreError')}</p>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={isFetchingNextPage || undefined}
                onClick={ignoreWhenInactive(isFetchingNextPage, () => {
                  loadMoreView.current = view
                  void fetchNextPage()
                })}
                className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
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
            <Select {...field} ref={sectionFilterRef} value={table} onChange={(event) => setTable(event.target.value)}>
              <option value="">{t('audit.filters.allTables')}</option>
              {AUDITED_TABLES.map((name) => (
                <option key={name} value={name}>
                  {tableLabel(name)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div>
          <FormField label={t('audit.filters.actor')}>
            {(field) => (
              <Select {...field} value={actor} onChange={(event) => setActor(event.target.value)}>
                <option value="">{t('audit.filters.allActors')}</option>
                {actors?.map((person) => (
                  <option key={person.actor_id} value={person.actor_id}>
                    {person.actor_name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {/* Without the list, only « Toutes les personnes » can be chosen: say so, and offer to retry. */}
          {actorsFailed && !actors && (
            <div role="alert" className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <p>{t('audit.filters.actorsError')}</p>
              <Button
                type="button"
                variant="link"
                className="text-xs"
                // Not just « Réessayer »: the journal's own retry may be on the page too.
                aria-label={t('audit.filters.actorsRetry')}
                disabled={actorsFetching}
                onClick={() => void refetchActors()}
              >
                {t('common.retry')}
              </Button>
            </div>
          )}
        </div>
        <FormField label={t('audit.filters.period')}>
          {(field) => (
            <Select
              {...field}
              value={period}
              onChange={(event) => setPeriod(event.target.value as AuditPeriod)}
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
        {emptyAfterFilter && announcedView === view ? t('audit.emptyFiltered.title') : ''}
      </p>
      {content}
    </div>
  )
}
