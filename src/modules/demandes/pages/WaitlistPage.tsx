import { useId, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { StatusDot } from '@/shared/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { ENTRY_STATES, type EntryState, type WaitlistEntry, type WaitlistList } from '../api/waitlist'
import { CompatibleCard } from '../components/waitlist/CompatibleCard'
import { EntrySheet } from '../components/waitlist/EntrySheet'
import { useDemandesRealtime } from '../hooks/use-demandes'
import { useWaitlist, useWaitlistLists } from '../hooks/use-waitlist'
import { demandePath, personLabel } from '../lib/display'
import {
  STATE_PARAM,
  consentLabel,
  consentSettled,
  entryStateLabel,
  entryStateTone,
  exitReasonLabel,
  feeLabel,
  feeSettled,
  rankLabel,
  targetFromParam,
  waitedLabel,
} from '../lib/waitlist'

const W = 'modules.demandes.waitlist'
const P = `${W}.page`

/**
 * « Liste d'attente » (plan §10 D3, roadmap §2.3 bis): one list at a time — a profession or a
 * professional, chosen with its count — or every open entry; each person's rank (priority, then
 * the oldest), the days waited, whether the entry is complete (consent, fee), the last news, and
 * the list's average wait (an estimate for the counselor, never promised). A state narrows (« À
 * rappeler », « Incomplètes »…); a row opens its side sheet. The list is in the address; live
 * with the other counselors.
 */
export function WaitlistPage() {
  usePageTitle(t(`${W}.name`))
  useDemandesRealtime(true)
  const [params, setParams] = useSearchParams()
  const listId = useId()
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const target = targetFromParam(params.get('liste'))
  const state = (Object.entries(STATE_PARAM) as [EntryState, string][]).find(([, v]) => v === params.get('etat'))?.[0] ?? null
  const query = useMemo(() => ({ target, states: state ? [state] : null }), [target?.kind, target?.id, state]) // eslint-disable-line react-hooks/exhaustive-deps
  const lists = useWaitlistLists()
  const entries = useWaitlist(query)
  const selected = target ? lists.data?.find((l) => l.target_id === target.id) ?? null : null
  const { can } = useAccess()

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }
  const titles = (lists.data ?? []).filter((l) => l.target_kind === 'title')
  const professionals = (lists.data ?? []).filter((l) => l.target_kind === 'professional')
  const option = (l: WaitlistList) => (
    <option key={l.target_id} value={`${l.target_kind === 'title' ? 't' : 'p'}-${l.target_id}`}>
      {t(`${P}.listOption`, { name: l.name, count: String(l.open_count) })}
    </option>
  )

  return (
    <>
      <PageHeader level={1} title={t(`${W}.name`)} description={t(`${P}.description`)} />
      <section aria-label={t(`${P}.label`)} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={listId}>{t(`${P}.list`)}</Label>
            <Select id={listId} value={params.get('liste') ?? ''} onChange={(e) => update({ liste: e.target.value || null })} className="w-72 max-w-full">
              <option value="">{t(`${P}.allLists`)}</option>
              <optgroup label={t(`${P}.professions`)}>{titles.map(option)}</optgroup>
              <optgroup label={t(`${P}.professionals`)}>{professionals.map(option)}</optgroup>
            </Select>
          </div>
          {selected && (
            <p className="pb-2 text-sm text-muted-foreground">
              {selected.average_wait_days === null
                ? t(`${P}.noAverage`)
                : t(`${P}.average`, { days: String(selected.average_wait_days) })}
            </p>
          )}
        </div>
        <div role="group" aria-label={t(`${P}.statesLabel`)} className="flex flex-wrap gap-2">
          <Button type="button" variant={state === null ? 'default' : 'outline'} size="sm" aria-pressed={state === null} onClick={() => update({ etat: null })} className="max-sm:h-11">
            {t(`${P}.openOnly`)}
          </Button>
          {ENTRY_STATES.map((s) => (
            <Button
              key={s}
              type="button"
              variant={state === s ? 'default' : 'outline'}
              size="sm"
              aria-pressed={state === s}
              onClick={() => update({ etat: state === s ? null : STATE_PARAM[s] })}
              className="max-sm:h-11"
            >
              {t(`${P}.filters.${s}`)}
              {selected && s === 'to_call' && <span className="tabular">{selected.to_call_count}</span>}
              {selected && s === 'incomplete' && <span className="tabular">{selected.incomplete_count}</span>}
            </Button>
          ))}
        </div>
        {/* D4 part 2: on a professional's list, who she could be offered, in list order. */}
        {target?.kind === 'professional' && selected && can('professionals.view') && <CompatibleCard professionalId={target.id} name={selected.name} />}
        {entries.isError && !entries.data ? (
          <LoadError message={t(`${P}.loadError`)} onRetry={() => void entries.refetch()} retrying={entries.isFetching} />
        ) : entries.data && entries.data.length === 0 ? (
          <EmptyState title={t(state ? `${P}.emptyFiltered` : `${P}.empty`)} body={t(`${P}.emptyBody`)} />
        ) : (
          <EntriesTable rows={entries.data ?? null} showList={target === null} onOpen={setOpenEntry} />
        )}
      </section>
      <EntrySheet entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  )
}

function EntriesTable({ rows, showList, onOpen }: { rows: readonly WaitlistEntry[] | null; showList: boolean; onOpen: (id: string) => void }) {
  return (
    <Table aria-label={t(`${P}.table`)} scrollLabel={t(`${P}.table`)} scrollFocus="overflow" stickyHeader>
      <TableHeader>
        <TableRow className="[&>th]:whitespace-nowrap">
          <TableHead>{t(`${P}.columns.rank`)}</TableHead>
          <TableHead>{t(`${P}.columns.person`)}</TableHead>
          {showList && <TableHead className="max-md:hidden">{t(`${P}.columns.list`)}</TableHead>}
          <TableHead>{t(`${P}.columns.registered`)}</TableHead>
          <TableHead className="max-sm:hidden">{t(`${P}.columns.state`)}</TableHead>
          <TableHead className="max-lg:hidden">{t(`${P}.columns.complete`)}</TableHead>
          <TableHead>
            <span className="sr-only">{t(`${P}.columns.actions`)}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows === null ? (
          <TableRow>
            <TableCell colSpan={7}>
              <p role="status" className="py-2 text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => <EntryRow key={row.id} row={row} showList={showList} onOpen={onOpen} />)
        )}
      </TableBody>
    </Table>
  )
}

function EntryRow({ row, showList, onOpen }: { row: WaitlistEntry; showList: boolean; onOpen: (id: string) => void }) {
  const person = personLabel(row)
  const closed = row.state === 'closed'
  return (
    <TableRow className={cn(closed && 'text-muted-foreground')}>
      <TableCell className="tabular whitespace-nowrap text-sm">{rankLabel(row) ?? '—'}</TableCell>
      <TableCell className="min-w-44">
        <Link to={demandePath(row.demande_id, 'suivi')} className="font-medium text-link underline-offset-2 hover:underline">
          {person}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular">{row.reference}</span>
          {row.priority === 'priority' && <Badge variant="warning">{t(`${W}.priority.priority`)}</Badge>}
        </p>
        {row.priority_reason && <p className="text-xs text-foreground">{row.priority_reason}</p>}
      </TableCell>
      {showList && <TableCell className="max-md:hidden text-sm">{row.target_name}</TableCell>}
      <TableCell className="whitespace-nowrap text-sm">
        <p className="tabular">{formatClinicDateShort(row.registered_at)}</p>
        <p className="text-xs text-muted-foreground">{waitedLabel(row.waited_days)}</p>
      </TableCell>
      <TableCell className="max-sm:hidden text-sm">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={entryStateTone(row.state)} />
          {entryStateLabel(row.state)}
        </span>
        {row.exit_reason && <p className="text-xs">{exitReasonLabel(row.exit_reason)}</p>}
        {row.followup_unanswered && !closed && <p className="text-xs font-medium text-foreground">{t(`${W}.followupUnanswered`)}</p>}
        {row.pending_offer && <p className="text-xs text-foreground">{t(`${P}.pendingOffer`)}</p>}
      </TableCell>
      <TableCell className="max-lg:hidden text-xs">
        {!closed && (
          <>
            <p className="inline-flex items-center gap-1.5">
              <StatusDot tone={consentSettled(row.consent_state) ? 'success' : 'warning'} />
              {row.consent_state ? consentLabel(row.consent_state) : t(`${W}.consent.none`)}
            </p>
            <p className="flex items-center gap-1.5">
              <StatusDot tone={feeSettled(row.fee_status) ? 'success' : 'warning'} />
              {feeLabel(row.fee_status)}
            </p>
          </>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button type="button" variant="outline" size="sm" onClick={() => onOpen(row.id)} aria-label={t(`${P}.openFor`, { person })} className="max-sm:h-11">
          {t(`${P}.open`)}
        </Button>
      </TableCell>
    </TableRow>
  )
}
