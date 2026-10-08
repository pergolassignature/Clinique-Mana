import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Handshake } from 'lucide-react'
import { t } from '@/i18n'
import { rpcErrorDetail, rpcErrorHint } from '@/core/modules/errors'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SaveButton } from '@/shared/components/SaveButton'
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
import { PayList, RetentionStatusBadge } from '../components/compensation/RetentionParts'
import { useRetentionReview, useSaveReviewSessions } from '../hooks/use-compensation'
import { formatPercent, formatSessions, monthLabel, monthOf, retentionTone, shiftMonth } from '../lib/compensation'
import {
  changedEntries,
  countByStatus,
  draftCount,
  filterRows,
  invalidRows,
  isChanged,
  liveTotal,
  REVIEW_FILTERS,
  shownCounts,
  type Drafts,
  type ReviewFilter,
} from '../lib/review'

const R = 'modules.professionals.review'
const W = 'modules.professionals.compensation'

/** The sheet's colour cues on design-system tokens (P4-190). */
const TONE_CLASSES = {
  warning: 'bg-warning/10',
  success: 'bg-success/10',
  info: 'bg-info/10',
  default: '',
} as const

/** The decisions a row offers (the database checks them again). */
function decisionsFor(row: ReviewRow): Decision[] {
  if (row.status === 'profession_unconfirmed' || row.suggested === null) return []
  if (row.applied === null) return ['suggested', 'initial']
  if (row.status === 'gap') return ['suggested', 'maintained', 'custom']
  return []
}

/**
 * « Révision mensuelle » (`professionals.compensation`, P4-190): the clinic's spreadsheet as a
 * page. One read per month (`list_retention_review`), every active professional: the month's
 * 50/60 and 30-minute sessions (typed in place, saved in one batch, all or nothing), the
 * cumulative count, the applied and suggested rates, the pay, the status, and the decisions for a
 * gap. The filter starts on « Écart à valider »; a row being edited stays visible.
 */
export function RetentionReviewPage() {
  usePageTitle(t(`${R}.title`))
  const today = useClinicDate()
  const currentMonth = monthOf(today)
  const [month, setMonth] = useState(() => shiftMonth(currentMonth, -1))
  const [filter, setFilter] = useState<ReviewFilter>('gap')
  const [drafts, setDrafts] = useState<Drafts>({})
  const [refusal, setRefusal] = useState<{ message: string; detail: string | null } | null>(null)
  const [staleId, setStaleId] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionTarget | null>(null)
  const review = useRetentionReview(month)
  const rows = useMemo(() => (review.data?.month === month ? review.data.rows : []), [review.data, month])
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

  const counts = countByStatus(rows)
  const shown = filterRows(rows, filter, drafts)
  const type = (row: ReviewRow, field: 'long' | 'short', value: string) =>
    setDrafts((current) => {
      const base = current[row.id] ?? { ...shownCounts(row, current), version: row.entry?.updatedAt ?? null }
      return { ...current, [row.id]: { ...base, [field]: value } }
    })
  const changeMonth = (value: string) => {
    if (!/^[0-9]{4}-[0-9]{2}$/.test(value)) return
    const next = `${value}-01`
    if (next > currentMonth || next === month) return
    confirmLeave(() => {
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
      suggestedPct: row.suggested?.pct ?? null,
      suggestedThreshold: row.suggested?.threshold ?? null,
      // The open rate's start + 1 is checked by the database; the dialog only bounds the date.
      minDate: null,
      defaultFrom: shiftMonth(month, 1),
    })

  let body
  if (review.isPending) body = <Loading />
  else if (!review.data) body = <LoadError message={t(`${R}.loadError`)} retrying={review.isFetching} onRetry={() => void review.refetch()} />
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
        {shown.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{filter === 'gap' ? t(`${R}.noGap`) : t(`${R}.empty`)}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label={t(`${R}.listLabel`, { month: monthLabel(month) })}>
            <li aria-hidden className="hidden gap-3 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
              <span>{t(`${R}.columns.professional`)}</span>
              <span>{t(`${R}.columns.sessions`)}</span>
              <span>{t(`${R}.columns.cumulative`)}</span>
              <span>{t(`${R}.columns.rates`)}</span>
              <span>{t(`${R}.columns.pay`)}</span>
              <span>{t(`${R}.columns.status`)}</span>
            </li>
            {shown.map((row) => {
              const name = `${row.firstName} ${row.lastName}`
              const counts = shownCounts(row, drafts)
              const total = liveTotal(row, drafts)
              const changed = isChanged(row, drafts[row.id])
              return (
                <li
                  key={row.id}
                  className={cn('grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start', TONE_CLASSES[retentionTone(row.status, row.increaseDecided)])}
                >
                  <div className="min-w-0">
                    <Link to={`/professionnels/${row.id}/remuneration`} className="text-sm font-medium text-foreground underline-offset-[3px] hover:underline">
                      {name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.titleName ?? t(`${R}.noTitle`)}</p>
                    {row.agreements > 0 && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Handshake aria-hidden className="size-3.5" />
                        {t(`${R}.agreements`, { count: String(row.agreements) })}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <FormField label={t(`${R}.long`)} error={drafts[row.id] && draftCount(counts.long) === null ? t(`${W}.validation.sessionsLong`) : undefined}>
                      {(field) => (
                        <Input
                          {...field}
                          aria-label={t(`${R}.longLabel`, { name })}
                          value={counts.long}
                          onChange={(event) => type(row, 'long', event.target.value)}
                          inputMode="numeric"
                          autoComplete="off"
                          className="tabular"
                        />
                      )}
                    </FormField>
                    <FormField label={t(`${R}.short`)} error={drafts[row.id] && draftCount(counts.short) === null ? t(`${W}.validation.sessionsShort`) : undefined}>
                      {(field) => (
                        <Input
                          {...field}
                          aria-label={t(`${R}.shortLabel`, { name })}
                          value={counts.short}
                          onChange={(event) => type(row, 'short', event.target.value)}
                          inputMode="numeric"
                          autoComplete="off"
                          className="tabular"
                        />
                      )}
                    </FormField>
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-muted-foreground lg:hidden">{t(`${R}.columns.cumulative`)} </span>
                    <span className="font-medium tabular">{total === null ? '—' : formatSessions(total)}</span>
                    {changed && <span className="ml-1 text-xs text-muted-foreground">{t(`${R}.unsaved`)}</span>}
                    <span className="block text-xs text-muted-foreground">{t(`${R}.before`, { count: formatSessions(row.sessionsBefore) })}</span>
                    {row.entry && row.entry.adjustment !== 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t(`${R}.adjustment`, { value: `${row.entry.adjustment > 0 ? '+' : ''}${formatSessions(row.entry.adjustment)}` })}
                      </span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="block">
                      <span className="text-xs text-muted-foreground">{t(`${R}.applied`)} </span>
                      <span className="font-medium tabular">{row.applied ? formatPercent(row.applied.pct) : '—'}</span>
                    </span>
                    <span className="block">
                      <span className="text-xs text-muted-foreground">{t(`${R}.suggested`)} </span>
                      <span className="tabular">{row.suggested ? formatPercent(row.suggested.pct) : '—'}</span>
                      {row.suggested && <span className="text-xs text-muted-foreground"> · {t(`${R}.tier`, { tier: formatSessions(row.suggested.threshold) })}</span>}
                    </span>
                  </div>
                  <div>
                    <PayList pay={row.pay} compact />
                  </div>
                  <div className="space-y-1.5">
                    <RetentionStatusBadge status={row.status} />
                    {row.increaseDecided && <p className="text-xs text-muted-foreground">{t(`${R}.increaseDecided`)}</p>}
                    {row.applied?.decision === 'custom' && row.applied.note && <p className="break-words text-xs text-muted-foreground">{row.applied.note}</p>}
                    <div className="flex flex-wrap gap-1">
                      {decisionsFor(row).map((kind) => (
                        <Button key={kind} type="button" size="sm" variant={kind === 'suggested' ? 'default' : 'outline'} aria-label={t(`${R}.decisionLabel.${kind}`, { name })} onClick={() => openDecision(row, kind)}>
                          {t(`${W}.decision.action.${kind}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
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
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t(`${R}.month`)}>
          {(field) => (
            <Input {...field} type="month" value={month.slice(0, 7)} min="2000-01" max={currentMonth.slice(0, 7)} onChange={(event) => changeMonth(event.target.value)} className="w-44" />
          )}
        </FormField>
        <FormField label={t(`${R}.filter`)}>
          {(field) => (
            <Select {...field} value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} className="w-60">
              {REVIEW_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === 'all'
                    ? t(`${R}.filters.all`, { count: String(rows.length) })
                    : t(`${R}.filters.status`, { status: t(`${W}.retentionStatus.${value}`), count: String(counts[value]) })}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <p className="pb-1.5 text-xs text-muted-foreground">{t(`${R}.legend`)}</p>
      </div>
      {body}
      <DecisionDialog target={decision} onClose={() => setDecision(null)} />
    </div>
  )
}
