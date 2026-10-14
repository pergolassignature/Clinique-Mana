import { useId, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusDot } from '@/shared/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { Columns3 } from 'lucide-react'
import { usePreferenceWriter, useUserPreference } from '@/core/preferences/hooks'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Select } from '@/shared/ui/select'
import {
  ASSIGNED,
  FLAGS,
  PAGE_SIZE,
  SORTS,
  VIEWS,
  type AssignedFilter,
  type InboxFlag,
  type InboxQuery,
  type InboxRow,
  type InboxSort,
  type InboxView,
} from '../api/demandes'
import { INBOX_COLUMNS, INBOX_COLUMNS_PREFERENCE, SORT_PARAM, columnsOf, type InboxColumn } from '../lib/inbox-columns'
import { LogContactDialog } from '../components/LogContactDialog'
import { NewDemandeDialog } from '../components/NewDemandeDialog'
import { useDemandesRealtime, useInbox, useInboxCounts } from '../hooks/use-demandes'
import { demandePath, optionLabel, personLabel, promiseText, stateLabel, stateTone } from '../lib/display'

const I = 'modules.demandes.inbox'

/** The URL's words (French), never the search (a name, a phone: Loi 25 keeps it in the history state). */
const VIEW_PARAM: Record<InboxView, string> = { open: 'ouvertes', matched: 'jumelees', waitlist: 'liste-attente', closed: 'fermees', all: 'toutes' }
const ASSIGNED_PARAM: Record<AssignedFilter, string> = { any: 'toutes', me: 'moi', none: 'personne' }
const FLAG_PARAM: Record<InboxFlag, string> = { late: 'en-retard', no_answer: 'sans-reponse', urgent: 'urgentes', due: 'a-rappeler' }

const fromParam = <K extends string>(map: Record<K, string>, raw: string | null, fallback: K): K =>
  (Object.entries(map).find(([, v]) => v === raw)?.[0] as K | undefined) ?? fallback

const flagOf = (raw: string) => (Object.entries(FLAG_PARAM) as [InboxFlag, string][]).find(([, v]) => v === raw)?.[0]

function searchOf(state: unknown): string {
  return typeof state === 'object' && state !== null && typeof (state as { q?: unknown }).q === 'string' ? (state as { q: string }).q : ''
}

/**
 * « Demandes » (plan §10 D2): the counselors' inbox. Open requests first, the urgent then the
 * late (the « 24–48 h ouvrables » promise broken) then the oldest; « Sans réponse », « À
 * rappeler », « Urgentes » as filters with their counts; mine, unassigned or all; a search on
 * the number, a name, an email or a phone. Each row says how long the person has waited, who
 * handles it (« Je m'en occupe »), the last attempt and the next one, with « Noter un appel ».
 * Follows the other counselors' changes live (the clinic's Demandes channel).
 */
export function DemandesInboxPage() {
  usePageTitle(t('modules.demandes.name'))
  const { can } = useAccess()
  const { params, update: patchUrl } = useUrlParams()
  const location = useLocation()
  const searchId = useId()
  const [page, setPage] = useState(0)
  useDemandesRealtime(true)

  const view = fromParam(VIEW_PARAM, params.get('vue'), 'open')
  const sort: InboxSort = (Object.entries(SORT_PARAM) as [InboxSort, string | null][]).find(([, v]) => v !== null && v === params.get('tri'))?.[0] ?? 'priority'
  // The columns she chose (her preference), the defaults until it is read.
  const preference = useUserPreference(INBOX_COLUMNS_PREFERENCE)
  const writeColumns = usePreferenceWriter(INBOX_COLUMNS_PREFERENCE)
  const columns = columnsOf(preference.data)
  const toggleColumn = (column: InboxColumn) => {
    const next = columns.includes(column) ? columns.filter((c) => c !== column) : INBOX_COLUMNS.filter((c) => c === column || columns.includes(c))
    writeColumns.schedule({ columns: next })
  }
  const assigned = fromParam(ASSIGNED_PARAM, params.get('pour'), 'any')
  const flags = (params.get('filtres') ?? '').split(',').map(flagOf).filter((f): f is InboxFlag => f !== undefined)
  const typed = searchOf(location.state)
  const search = useDebouncedValue(typed, 250)
  const query = useMemo<InboxQuery>(() => ({ view, assigned, flags, search, sort }), [view, assigned, flags.join(','), search, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  const inbox = useInbox(query, page)
  const counts = useInboxCounts()

  // From the latest address (useUrlParams): « tri » and the filters never undo each other.
  const update = (patch: Record<string, string | null>, q: string = typed) => {
    setPage(0)
    patchUrl(patch, { replace: true, state: q ? { q } : null })
  }
  const toggleFlag = (flag: InboxFlag) => {
    const set = new Set(flags)
    if (set.has(flag)) set.delete(flag)
    else set.add(flag)
    update({ filtres: FLAGS.filter((f) => set.has(f)).map((f) => FLAG_PARAM[f]).join(',') || null })
  }
  const flagCount = (flag: InboxFlag) => {
    if (!counts.data) return null
    return flag === 'late' ? counts.data.late : flag === 'no_answer' ? counts.data.no_answer : flag === 'due' ? counts.data.due : null
  }
  const rows = inbox.data
  const filtered = flags.length > 0 || assigned !== 'any' || Boolean(search)

  return (
    <>
      <PageHeader
        level={1}
        title={t('modules.demandes.name')}
        description={t(`${I}.description`)}
        actions={can('demandes.manage') ? <NewDemandeDialog /> : undefined}
      />
      <Tabs value={view} onValueChange={(next) => update({ vue: next === 'open' ? null : VIEW_PARAM[next as InboxView] })}>
        <TabsList aria-label={t(`${I}.views`)} className="flex-wrap">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${I}.view.${v}`)}
              {v === 'open' && counts.data && <span className="tabular ml-1.5 text-muted-foreground">{counts.data.open}</span>}
              {v === 'waitlist' && counts.data && counts.data.waitlist > 0 && (
                <span className="tabular ml-1.5 text-muted-foreground">{counts.data.waitlist}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view}>
      <section aria-label={t(`${I}.label`)} className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <label htmlFor={searchId} className="sr-only">
              {t(`${I}.searchLabel`)}
            </label>
            <Input
              id={searchId}
              type="search"
              value={typed}
              onChange={(event) => update({}, event.target.value)}
              placeholder={t(`${I}.search`)}
              autoComplete="off"
              className="pl-8"
            />
          </div>
          <SegmentedToggle
            label={t(`${I}.assignedLabel`)}
            value={assigned}
            onChange={(next) => update({ pour: next === 'any' ? null : ASSIGNED_PARAM[next] })}
            options={ASSIGNED.map((a) => ({
              value: a,
              label:
                a === 'me' && counts.data
                  ? t(`${I}.assigned.meCount`, { count: String(counts.data.mine) })
                  : a === 'none' && counts.data
                    ? t(`${I}.assigned.noneCount`, { count: String(counts.data.unassigned) })
                    : t(`${I}.assigned.${a}`),
            }))}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor={`${searchId}-sort`} className="text-sm font-medium text-foreground">
              {t(`${I}.sort.label`)}
            </label>
            <Select id={`${searchId}-sort`} value={sort} onChange={(e) => update({ tri: SORT_PARAM[e.target.value as InboxSort] })} className="w-auto">
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`${I}.sort.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" className="max-sm:h-11">
                <Columns3 aria-hidden />
                {t(`${I}.columnPicker.label`)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" collisionPadding={16} aria-label={t(`${I}.columnPicker.title`)} className="w-64 p-3">
              <div className="grid gap-2">
                {INBOX_COLUMNS.map((c) => (
                  <CheckboxField key={c} label={t(`${I}.columns.${c}`)} checked={columns.includes(c)} onCheckedChange={() => toggleColumn(c)} />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div role="group" aria-label={t(`${I}.flagsLabel`)} className="flex flex-wrap gap-2">
          {FLAGS.map((flag) => {
            const on = flags.includes(flag)
            const count = flagCount(flag)
            return (
              <Button key={flag} type="button" variant={on ? 'default' : 'outline'} size="sm" aria-pressed={on} onClick={() => toggleFlag(flag)} className="max-sm:h-11">
                {t(`${I}.flags.${flag}`)}
                {count !== null && <span className="tabular">{count}</span>}
              </Button>
            )
          })}
        </div>
        {inbox.isError && !inbox.data ? (
          <LoadError message={t(`${I}.loadError`)} onRetry={() => void inbox.refetch()} retrying={inbox.isFetching} />
        ) : rows && rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title={t(`${I}.noMatch.title`)}
              body={t(`${I}.noMatch.body`)}
              action={
                <Button variant="outline" onClick={() => update({ pour: null, filtres: null }, '')}>
                  {t(`${I}.reset`)}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t(`${I}.empty.${view}`)} body={t(`${I}.emptyBody`)} />
          )
        ) : (
          <InboxTable rows={rows ?? null} canLog={can('demandes.manage')} columns={columns} />
        )}
        {rows && (page > 0 || rows.length === PAGE_SIZE) && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} className="max-sm:h-11">
              {t(`${I}.previous`)}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={rows.length < PAGE_SIZE} onClick={() => setPage(page + 1)} className="max-sm:h-11">
              {t(`${I}.next`)}
            </Button>
          </div>
        )}
      </section>
        </TabsContent>
      </Tabs>
    </>
  )
}

function InboxTable({ rows, canLog, columns }: { rows: readonly InboxRow[] | null; canLog: boolean; columns: readonly InboxColumn[] }) {
  const show = (c: InboxColumn) => columns.includes(c)
  return (
    <Table aria-label={t(`${I}.table`)} scrollLabel={t(`${I}.table`)} scrollFocus="overflow" stickyHeader>
      <TableHeader>
        <TableRow className="[&>th]:whitespace-nowrap">
          <TableHead>{t(`${I}.columns.person`)}</TableHead>
          <TableHead>{t(`${I}.columns.received`)}</TableHead>
          {show('state') && <TableHead className="max-sm:hidden">{t(`${I}.columns.state`)}</TableHead>}
          {show('beneficiary') && <TableHead className="max-md:hidden">{t(`${I}.columns.beneficiary`)}</TableHead>}
          {show('motifs') && <TableHead className="max-md:hidden">{t(`${I}.columns.motifs`)}</TableHead>}
          {show('assigned') && <TableHead className="max-lg:hidden">{t(`${I}.columns.assigned`)}</TableHead>}
          {show('followUp') && <TableHead className="max-md:hidden">{t(`${I}.columns.followUp`)}</TableHead>}
          <TableHead>
            <span className="sr-only">{t(`${I}.columns.actions`)}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows === null ? (
          <TableRow>
            <TableCell colSpan={3 + columns.length}>
              <p role="status" className="py-2 text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => <InboxRowView key={row.id} row={row} canLog={canLog} show={show} />)
        )}
      </TableBody>
    </Table>
  )
}

function InboxRowView({ row, canLog, show }: { row: InboxRow; canLog: boolean; show: (c: InboxColumn) => boolean }) {
  const person = personLabel(row)
  const promise = promiseText(row.promise, row.waiting_hours)
  const open = !['matched', 'closed'].includes(row.state)
  return (
    <TableRow className={cn(!open && 'text-muted-foreground')}>
      <TableCell className="min-w-48">
        <Link to={demandePath(row.id)} className="font-medium text-link underline-offset-2 hover:underline">
          {person}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular">{row.reference}</span>
          {row.client_number !== null && <span className="tabular">{t(`${I}.fileNumber`, { number: String(row.client_number) })}</span>}
          {row.is_urgent && <Badge variant="error">{t(`${I}.urgent`)}</Badge>}
        </p>
        {row.handled_by_name && <p className="text-xs text-foreground">{t(`${I}.handledBy`, { name: row.handled_by_name })}</p>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <p className="tabular text-sm">{formatClinicDateTime(row.received_at)}</p>
        {open && (
          <p className="inline-flex items-center gap-1.5 text-xs text-foreground">
            <StatusDot tone={promise.tone} />
            {promise.label}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{optionLabel('channel', row.channel)}</p>
      </TableCell>
      {show('state') && (
        <TableCell className="max-sm:hidden">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <StatusDot tone={stateTone(row.state)} />
            {stateLabel(row.state)}
          </span>
        </TableCell>
      )}
      {show('beneficiary') && (
        <TableCell className="max-md:hidden text-sm">{row.beneficiary ? optionLabel('beneficiary', row.beneficiary) : ''}</TableCell>
      )}
      {show('motifs') && (
        <TableCell className="tabular max-md:hidden text-sm">
          {row.motif_count === 0
            ? t(`${I}.columnPicker.noMotif`)
            : row.motif_count === 1
              ? t(`${I}.columnPicker.motifOne`)
              : t(`${I}.columnPicker.motifCount`, { count: String(row.motif_count) })}
        </TableCell>
      )}
      {show('assigned') && (
        <TableCell className="max-lg:hidden text-sm">{row.assigned_name ?? <span className="text-muted-foreground">{t(`${I}.unassigned`)}</span>}</TableCell>
      )}
      {show('followUp') && (
      <TableCell className="max-md:hidden text-xs">
        {row.no_answer && <p className="font-medium text-foreground">{t(`${I}.noAnswer`, { count: String(row.contact_attempts) })}</p>}
        {row.last_contact_at && (
          <p className="text-muted-foreground">
            {t(`${I}.lastContact`, { date: formatClinicDateTime(row.last_contact_at), outcome: row.last_outcome ? optionLabel('outcome', row.last_outcome) : '' })}
          </p>
        )}
        {row.next_contact_at && <p className="text-foreground">{t(`${I}.nextContact`, { date: formatClinicDateTime(row.next_contact_at) })}</p>}
        {!row.last_contact_at && open && <p className="text-muted-foreground">{t(`${I}.neverContacted`)}</p>}
      </TableCell>
      )}
      <TableCell className="text-right">{canLog && open && <LogContactDialog demandeId={row.id} person={person} compact />}</TableCell>
    </TableRow>
  )
}
