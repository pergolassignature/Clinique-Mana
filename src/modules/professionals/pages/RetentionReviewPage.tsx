import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Handshake } from 'lucide-react'
import { t } from '@/i18n'
import { rpcErrorDetail, rpcErrorHint } from '@/core/modules/errors'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SaveButton } from '@/shared/components/SaveButton'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { Decision, ReviewRow } from '../api/compensation'
import { DecisionDialog, type DecisionTarget } from '../components/compensation/DecisionDialog'
import { RefusalAlert } from '../components/compensation/DatedRowParts'
import { RetentionStatusBadge } from '../components/compensation/RetentionParts'
import { useRetentionReview, useSaveReviewSessions } from '../hooks/use-compensation'
import {
  decisionActionLabel,
  formatPercent,
  formatSessions,
  monthLabel,
  monthOf,
  needsDecision,
  retentionDisplay,
  retentionTone,
  sessionsLabel,
  shiftMonth,
  tierRangeLabel,
  tierShortLabel,
} from '../lib/compensation'
import {
  changedEntries,
  countByFilter,
  countByStatus,
  draftCount,
  filterRows,
  invalidRows,
  isChanged,
  isImportedBalance,
  liveTotal,
  onlyImportedBalances,
  OPTIONAL_FILTERS,
  REVIEW_FILTERS,
  shownCounts,
  type Drafts,
  type ReviewFilter,
} from '../lib/review'

const R = 'modules.professionals.review'
const W = 'modules.professionals.compensation'

/** The earliest month the picker reaches (the RPC's own bound). */
const FIRST_MONTH = '2000-01-01'

/** The sheet's colour cues on design-system tokens (P4-190). */
const TONE_CLASSES = {
  warning: 'bg-warning/10',
  success: 'bg-success/10',
  info: 'bg-info/10',
  default: '',
} as const

/** Six columns on a wide screen; one card per professional below `lg` (P4-199). */
const COLUMNS =
  'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.35fr)_minmax(0,0.75fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]'

/** The decisions a row offers (the database checks them again). */
function decisionsFor(row: ReviewRow): Decision[] {
  if (row.status === 'profession_unconfirmed' || row.suggested === null) return []
  if (row.applied === null) return ['suggested', 'initial']
  if (row.status === 'gap') return ['suggested', 'maintained', 'custom']
  return []
}

/**
 * « Révision mensuelle » (`professionals.compensation`, P4-190, made clear by P4-197–P4-199): the
 * clinic's spreadsheet as a page. One read per month (`list_retention_review`), every active
 * professional: the month's 50/60 and 30-minute sessions (typed in place, saved in one batch, all
 * or nothing), the cumulative count and its breakdown, the tier, the retention (« 27,5 % → 27 % »
 * when a decision is due), a plain status, and decision buttons that carry their value. The pay
 * per session is in the decision dialog. The filter starts on « À décider » (gaps and starting
 * rates to fix); a row being edited stays visible. The page opens on last month, or on the current
 * month when last month holds only the opening balances an import wrote (P4-192).
 */
export function RetentionReviewPage() {
  usePageTitle(t(`${R}.title`))
  const today = useClinicDate()
  const currentMonth = monthOf(today)
  const [month, setMonth] = useState(() => shiftMonth(currentMonth, -1))
  // Until the user picks a month, the default may still move to the current month (imports).
  const monthChosen = useRef(false)
  const [filter, setFilter] = useState<ReviewFilter>('todo')
  const [drafts, setDrafts] = useState<Drafts>({})
  const [refusal, setRefusal] = useState<{ message: string; detail: string | null } | null>(null)
  const [staleId, setStaleId] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionTarget | null>(null)
  const halfHintId = useId()
  const review = useRetentionReview(month)
  // While another month loads, the previous one is a placeholder: never shown as this month's.
  const loaded = review.data?.month === month ? review.data : undefined
  const rows = useMemo(() => loaded?.rows ?? [], [loaded])
  const nameOf = (id: string | undefined) => {
    const row = rows.find((r) => r.id === id)
    return row ? `${row.firstName} ${row.lastName}` : null
  }
  const save = useSaveReviewSessions(month, {
    onErrorMessage: (message, error) => {
      const id = rpcErrorDetail(error)
      const name = nameOf(id)
      if (rpcErrorHint(error) === 'stale' && id) {
        setStaleId(id)
        setRefusal({ message: t(`${R}.stale`, { name: name ?? '' }), detail: null })
      } else setRefusal({ message: name ? t(`${R}.refusedFor`, { name, message }) : message, detail: null })
    },
  })
  const entries = changedEntries(rows, drafts)
  const invalid = invalidRows(rows, drafts)
  const dirty = entries.length > 0
  useUnsavedChanges(dirty)
  const confirmLeave = useConfirmLeave()

  // After a stale refusal, the refetched month is the version that row's draft builds on.
  useEffect(() => {
    if (staleId === null) return
    const row = rows.find((r) => r.id === staleId)
    const draft = drafts[staleId]
    if (!row || !draft || (row.entry?.updatedAt ?? null) === draft.version) return
    setDrafts((current) => ({ ...current, [staleId]: { ...draft, version: row.entry?.updatedAt ?? null } }))
    setStaleId(null)
  }, [staleId, rows, drafts])

  // Last month holds only imported opening balances: open the current month instead.
  useEffect(() => {
    if (monthChosen.current || !loaded || month !== shiftMonth(currentMonth, -1)) return
    monthChosen.current = true
    if (onlyImportedBalances(loaded.rows)) setMonth(currentMonth)
  }, [loaded, month, currentMonth])

  const filterCounts = countByFilter(rows)
  const statusCounts = countByStatus(rows)
  const shown = filterRows(rows, filter, drafts)
  const type = (row: ReviewRow, field: 'long' | 'short', value: string) =>
    setDrafts((current) => {
      const base = current[row.id] ?? { ...shownCounts(row, current), version: row.entry?.updatedAt ?? null }
      return { ...current, [row.id]: { ...base, [field]: value } }
    })
  const changeMonth = (next: string) => {
    if (next > currentMonth || next < FIRST_MONTH || next === month) return
    confirmLeave(() => {
      monthChosen.current = true
      setDrafts({})
      setRefusal(null)
      setMonth(next)
    })
  }
  const openDecision = (row: ReviewRow, kind: Decision) =>
    setDecision({
      professionalId: row.id,
      name: `${row.firstName} ${row.lastName}`,
      decision: kind,
      appliedPct: row.applied?.pct ?? null,
      appliedDecision: row.applied?.decision ?? null,
      suggestedPct: row.suggested?.pct ?? null,
      tierLabel: row.suggested ? tierRangeLabel(row.suggested.threshold, row.next?.threshold ?? null) : null,
      // The open rate's start + 1 is checked by the database; the dialog only bounds the date.
      minDate: null,
      defaultFrom: shiftMonth(month, 1),
      // The suggestion shown is the count through the reviewed month: the decision uses the same.
      countMonth: month,
      expectedOpenId: row.applied?.id ?? null,
      pay: row.pay,
    })
  const todoSummary = [
    statusCounts.gap > 0 ? t(statusCounts.gap < 2 ? `${R}.todoGap.one` : `${R}.todoGap.other`, { count: String(statusCounts.gap) }) : null,
    statusCounts.no_rate > 0 ? t(statusCounts.no_rate < 2 ? `${R}.todoNoRate.one` : `${R}.todoNoRate.other`, { count: String(statusCounts.no_rate) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  let body
  // A month being loaded (the first, or another one) shows the loader, never « Rien à décider ».
  if (!loaded && (review.isPending || review.isFetching)) body = <Loading />
  else if (!loaded) body = <LoadError message={t(`${R}.loadError`)} retrying={review.isFetching} onRetry={() => void review.refetch()} />
  else
    body = (
      <form
        noValidate
        aria-busy={review.isFetching || undefined}
        onSubmit={(event) => {
          event.preventDefault()
          if (!dirty || invalid.size > 0) return
          setRefusal(null)
          save.mutate(entries, { onSuccess: () => setDrafts({}) })
        }}
        className="space-y-3"
      >
        <span id={halfHintId} className="sr-only">
          {t(`${R}.halfHint`)}
        </span>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {filter === 'todo' ? t(`${R}.noTodo`, { month: monthLabel(month) }) : t(`${R}.empty`)}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label={t(`${R}.listLabel`, { month: monthLabel(month) })}>
            <li aria-hidden className={cn('hidden gap-3 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid', COLUMNS)}>
              <span>{t(`${R}.columns.professional`)}</span>
              <span>
                {t(`${R}.columns.sessions`)}
                <span className="block font-normal">{t(`${R}.halfHint`)}</span>
              </span>
              <span>{t(`${R}.columns.cumulative`)}</span>
              <span>{t(`${R}.columns.tier`)}</span>
              <span>{t(`${R}.columns.retention`)}</span>
              <span>{t(`${R}.columns.status`)}</span>
            </li>
            {shown.map((row) => (
              <ReviewItem
                key={row.id}
                row={row}
                drafts={drafts}
                on={loaded.on}
                halfHintId={halfHintId}
                onType={(field, value) => type(row, field, value)}
                onDecide={(kind) => openDecision(row, kind)}
              />
            ))}
          </ul>
        )}
        <div className={cn('sticky bottom-0 z-10 space-y-2 rounded-lg border border-border bg-card p-3 shadow-soft', !dirty && !refusal && 'hidden')}>
          {refusal && <RefusalAlert message={refusal.message} detail={refusal.detail} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" role="status">
              {dirty ? t(`${R}.changes`, { count: String(entries.length) }) : ''}
              {invalid.size > 0 && ` ${t(`${R}.invalid`)}`}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setDrafts({})
                  setRefusal(null)
                }}
              >
                {t(`${R}.discard`)}
              </Button>
              <SaveButton pending={save.isPending} disabled={!dirty || invalid.size > 0} label={t(`${R}.save`)} pendingLabel={t('common.saving')} />
            </div>
          </div>
        </div>
      </form>
    )

  return (
    <div className="space-y-4">
      <PageHeader level={1} title={t(`${R}.title`)} description={t(`${R}.description`)} />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <MonthPicker month={month} min={FIRST_MONTH} max={currentMonth} onChange={changeMonth} />
        <FormField label={t(`${R}.filter`)}>
          {(field) => (
            <Select {...field} value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} className="w-64 max-w-full">
              {REVIEW_FILTERS.filter((value) => !OPTIONAL_FILTERS.includes(value) || filterCounts[value] > 0 || value === filter).map((value) => (
                <option key={value} value={value}>
                  {t(`${R}.filters.${value}`, { count: String(filterCounts[value]) })}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {loaded && filter === 'todo' && todoSummary && <p className="pb-1.5 text-sm text-muted-foreground">{todoSummary}</p>}
      </div>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{t(`${R}.legend`)}</p>
        <p>{t(`${R}.help`)}</p>
      </div>
      {body}
      <DecisionDialog target={decision} onClose={() => setDecision(null)} />
    </div>
  )
}

/**
 * The month as French words between two arrows (P4-199): « ‹ septembre 2026 › », never the
 * browser's own month field (English in some browsers). The next arrow stops at the clinic's month.
 */
function MonthPicker({ month, min, max, onChange }: { month: string; min: string; max: string; onChange: (month: string) => void }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-1">
      <span id={labelId} className="block text-xs font-medium text-foreground">
        {t(`${R}.month`)}
      </span>
      <div className="flex h-8 items-center rounded-md border border-border bg-card">
        <Button type="button" variant="ghost" size="icon" aria-label={t(`${R}.monthPrevious`)} disabled={month <= min} onClick={() => onChange(shiftMonth(month, -1))}>
          <ChevronLeft aria-hidden />
        </Button>
        <span aria-live="polite" className="min-w-36 px-1 text-center text-sm font-medium tabular">
          {monthLabel(month)}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label={t(`${R}.monthNext`)} disabled={month >= max} onClick={() => onChange(shiftMonth(month, 1))}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  )
}

interface ReviewItemProps {
  row: ReviewRow
  drafts: Drafts
  /** The review's date (the first day of the next month): a decision starting later says when. */
  on: string
  halfHintId: string
  onType: (field: 'long' | 'short', value: string) => void
  onDecide: (kind: Decision) => void
}

/** One professional: a row of six cells on a wide screen, a card below `lg`, in the same order. */
function ReviewItem({ row, drafts, on, halfHintId, onType, onDecide }: ReviewItemProps) {
  const id = useId()
  const name = `${row.firstName} ${row.lastName}`
  const counts = shownCounts(row, drafts)
  const total = liveTotal(row, drafts)
  const changed = isChanged(row, drafts[row.id])
  const display = retentionDisplay(row, row.increaseDecided)
  const longError = drafts[row.id] && draftCount(counts.long) === null ? t(`${W}.validation.sessionsLong`) : undefined
  const shortError = drafts[row.id] && draftCount(counts.short) === null ? t(`${W}.validation.sessionsShort`) : undefined
  const imported = isImportedBalance(row)
  const cellLabel = 'block text-xs text-muted-foreground lg:sr-only'
  return (
    <li aria-labelledby={`${id}-name`} className={cn('grid gap-3 px-4 py-4 lg:items-start lg:px-3 lg:py-3', COLUMNS, TONE_CLASSES[retentionTone(display)])}>
      <div className="min-w-0">
        <Link id={`${id}-name`} to={`/professionnels/${row.id}/remuneration`} className="text-sm font-medium text-foreground underline-offset-[3px] hover:underline">
          {name}
        </Link>
        <p className="text-xs text-muted-foreground">{row.titleLabel ?? t(`${R}.noTitle`)}</p>
        {row.agreements > 0 && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Handshake aria-hidden className="size-3.5" />
            {t(`${R}.agreements`, { count: String(row.agreements) })}
          </p>
        )}
      </div>

      <div className="min-w-0">
        <span className={cellLabel}>{t(`${R}.columns.sessions`)}</span>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:mt-0">
          <CountInput
            short={t(`${R}.long`)}
            label={t(`${R}.longLabel`, { name })}
            value={counts.long}
            errorId={longError ? `${id}-long-error` : undefined}
            onChange={(value) => onType('long', value)}
          />
          <CountInput
            short={t(`${R}.short`)}
            label={t(`${R}.shortLabel`, { name })}
            value={counts.short}
            hintId={halfHintId}
            errorId={shortError ? `${id}-short-error` : undefined}
            onChange={(value) => onType('short', value)}
          />
        </div>
        <p aria-hidden className="mt-1 text-xs text-muted-foreground lg:hidden">
          {t(`${R}.halfHint`)}
        </p>
        {longError && (
          <p id={`${id}-long-error`} className="mt-1 text-xs text-destructive">
            {longError}
          </p>
        )}
        {shortError && (
          <p id={`${id}-short-error`} className="mt-1 text-xs text-destructive">
            {shortError}
          </p>
        )}
      </div>

      {/* Cumul, palier, retenue: three columns of the card on a phone, three cells of the row on a wide screen. */}
      <div className="grid grid-cols-3 gap-3 lg:contents">
        <div className="min-w-0 text-sm">
          <span className={cellLabel}>{t(`${R}.columns.cumulative`)}</span>
          <span className="font-semibold tabular">{total === null ? '—' : formatSessions(total)}</span>
          {total !== null && !imported && ' '}
          {total !== null && !imported && (
            <span className="whitespace-nowrap text-xs text-muted-foreground tabular" title={breakdownLong(row.sessionsBefore, total)}>
              <span aria-hidden>{t(`${R}.breakdown`, { before: formatSessions(row.sessionsBefore), month: formatSessions(total - row.sessionsBefore) })}</span>
              <span className="sr-only">{breakdownLong(row.sessionsBefore, total)}</span>
            </span>
          )}
          {changed && <span className="block text-xs text-muted-foreground">{t(`${R}.unsaved`)}</span>}
          {row.entry && imported ? (
            <span className="block text-xs text-muted-foreground">{t(`${R}.importedBalance`, { count: sessionsLabel(row.entry.adjustment) })}</span>
          ) : (
            row.entry &&
            row.entry.adjustment !== 0 && (
              <span className="block text-xs text-muted-foreground">
                {t(`${R}.adjustment`, { value: `${row.entry.adjustment > 0 ? '+' : ''}${formatSessions(row.entry.adjustment)}` })}
              </span>
            )
          )}
        </div>

        <div className="min-w-0 text-sm">
          <span className={cellLabel}>{t(`${R}.columns.tier`)}</span>
          {row.suggested ? <TierCell row={row} imported={imported} /> : <span className="text-muted-foreground">—</span>}
          {changed && row.suggested && <span className="block text-xs text-muted-foreground">{t(`${R}.recalculated`)}</span>}
        </div>

        <div className="min-w-0 text-sm">
          <span className={cellLabel}>{t(`${R}.columns.retention`)}</span>
          <RetentionCell row={row} on={on} />
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <RetentionStatusBadge display={display} />
        <StatusNote row={row} display={display} />
        {decisionsFor(row).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {decisionsFor(row).map((kind) => {
              const action = decisionActionLabel(kind, row.applied?.pct ?? null, row.suggested?.pct ?? null)
              return (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={kind === 'suggested' ? 'default' : 'outline'}
                  aria-label={t(`${R}.decisionFor`, { action, name })}
                  onClick={() => onDecide(kind)}
                >
                  {action}
                </Button>
              )
            })}
          </div>
        )}
      </div>
    </li>
  )
}

/** « 88 avant + 15 ce mois-ci ». */
const breakdownLong = (before: number, total: number): string =>
  t(`${R}.breakdownLong`, { before: formatSessions(before), month: formatSessions(total - before) })

/** One count field: « 50/60 » or « 30 » beside it, the full label read by screen readers. */
function CountInput({
  short,
  label,
  value,
  hintId,
  errorId,
  onChange,
}: {
  short: string
  label: string
  value: string
  hintId?: string
  errorId?: string
  onChange: (value: string) => void
}) {
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="text-xs text-muted-foreground">
        {short}
      </span>
      <Input
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={errorId ? true : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        className="w-14 tabular"
      />
    </span>
  )
}

/** « 101–150 » with « nouveau » when this month's sessions crossed into it (read in full). */
function TierCell({ row, imported }: { row: ReviewRow; imported: boolean }) {
  const suggested = row.suggested
  if (!suggested) return null
  const next = row.next?.threshold ?? null
  const isNew = !imported && suggested.threshold > 0 && row.sessionsBefore < suggested.threshold
  return (
    <>
      <span aria-hidden className="whitespace-nowrap tabular">
        {tierShortLabel(suggested.threshold, next)}
      </span>
      <span className="sr-only">{tierRangeLabel(suggested.threshold, next)}</span>
      {isNew && (
        <span className="ml-1.5 inline-block rounded-sm bg-warning/20 px-1 text-2xs font-medium text-foreground">
          <span aria-hidden>{t(`${R}.newTier`)}</span>
          <span className="sr-only">, {t(`${R}.newTierLong`)}</span>
        </span>
      )}
    </>
  )
}

/**
 * « Passe de 27,5 % à 27 % » (« Aucun taux · 28 % proposé » without one) while a decision is due,
 * else the applied rate, « Aucun taux » without one (with the grid's when kept apart). No arrows
 * nor dashes (« il faut toujours être clair »).
 */
function RetentionCell({ row, on }: { row: ReviewRow; on: string }) {
  const { applied, suggested } = row
  const due = needsDecision(row.status) && suggested !== null && suggested.pct !== applied?.pct
  return (
    <>
      {due ? (
        <>
          <span aria-hidden className="tabular">
            {applied
              ? t(`${R}.retentionMove`, { from: formatPercent(applied.pct), to: formatPercent(suggested.pct) })
              : t(`${R}.retentionNone`, { to: formatPercent(suggested.pct) })}
          </span>
          <span className="sr-only">
            {applied
              ? t(`${R}.retentionChange`, { from: formatPercent(applied.pct), to: formatPercent(suggested.pct) })
              : t(`${R}.retentionFirst`, { to: formatPercent(suggested.pct) })}
          </span>
        </>
      ) : (
        <span className="whitespace-nowrap font-medium tabular">{applied ? formatPercent(applied.pct) : t(`${R}.noRate`)}</span>
      )}
      {!due && applied && suggested && suggested.pct !== applied.pct && (
        <span className="block text-xs text-muted-foreground">{t(`${R}.grid`, { rate: formatPercent(suggested.pct) })}</span>
      )}
      {applied && applied.effectiveFrom > on && !row.increaseDecided && (
        <span className="block text-xs text-muted-foreground">{t(`${R}.startsOn`, { date: formatDateOnlyShort(applied.effectiveFrom) })}</span>
      )}
    </>
  )
}

/** The line under a status: when a kept rate comes back, when a decided increase starts, why no grid. */
function StatusNote({ row, display }: { row: ReviewRow; display: ReturnType<typeof retentionDisplay> }) {
  const note = 'text-xs text-muted-foreground'
  switch (display) {
    case 'increaseDecided':
      return row.applied ? <p className={note}>{t(`${R}.startsOn`, { date: formatDateOnlyShort(row.applied.effectiveFrom) })}</p> : null
    case 'maintained':
    case 'custom':
      return (
        <>
          <p className={note}>{row.next ? t(`${R}.comesBack`, { count: sessionsLabel(row.next.threshold) }) : t(`${R}.staysAtFloor`)}</p>
          {display === 'custom' && row.applied?.note && <p className={cn(note, 'break-words')}>{row.applied.note}</p>}
        </>
      )
    case 'professionUnconfirmed':
      return <p className={note}>{t(`${R}.noGrid`)}</p>
    default:
      return null
  }
}
