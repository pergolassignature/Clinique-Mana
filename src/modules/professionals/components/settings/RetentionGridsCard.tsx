import { useId, useRef, useState } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { focusRing } from '@/shared/ui/field-classes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { DURATIONS, type GridRow } from '../../api/compensation'
import type { ProfessionTitle } from '../../api/parse'
import { useDeleteRetentionGrid } from '../../hooks/use-compensation'
import { canDeleteDated, datedStatus, durationLabel, formatCents, formatPercent, formatSessions, periodLabel, rowsOf, sessionsLabel, tierLastCount } from '../../lib/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge } from '../compensation/DatedRowParts'
import { useToday } from '../compensation/use-today'
import { GridDialog } from './GridDialog'

const G = 'modules.professionals.settings.compensation.grids'

/**
 * « 0 à 50 » … « 301 et plus » (the column is « Séances cumulées »): the clinic's sheet's ranges
 * (« 50 et - », « 51 à 100 »), in whole sessions (P4-198).
 */
function tierRange(tiers: GridRow['tiers'], index: number): string {
  const from = tiers[index]?.threshold ?? 0
  const next = tiers[index + 1]
  return next
    ? t(`${G}.range`, { from: formatSessions(from), to: formatSessions(tierLastCount(next.threshold)) })
    : t(`${G}.rangeOpen`, { from: formatSessions(from) })
}

/** The grid in force on `today`, else the coming one (the open row). */
const shownGrid = (series: readonly GridRow[], today: string) =>
  series.find((grid) => datedStatus(grid, today) === 'current') ?? series.find((grid) => grid.effectiveTo === null) ?? null

interface RetentionGridsCardProps {
  titles: readonly ProfessionTitle[]
  grids: readonly GridRow[]
}

/**
 * « Grilles de rétention » (P4-185): one grid per profession title, its tiers (threshold of
 * cumulative sessions → the clinic's retention) and client prices per duration. A change is a new
 * dated version (« Nouvelle version », prefilled from the current one); a version not in force
 * yet, or created less than 24 hours ago, can be deleted. A title without a grid reads
 * « Profession à confirmer » for its professionals.
 */
export function RetentionGridsCard({ titles, grids }: RetentionGridsCardProps) {
  const { now, today } = useToday()
  const [toDelete, setToDelete] = useState<{ grid: GridRow; title: string } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDeleteRetentionGrid({ onErrorMessage: (message) => setRefusal(message) })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const idBase = useId()
  // Active titles, plus an archived one that still has a grid.
  const shown = titles.filter((title) => title.isActive || grids.some((grid) => grid.titleId === title.id))
  // A column per duration that a shown grid prices, in the catalogue's order (60, 50, 30).
  const shownIds = new Set(shown.map((title) => title.id))
  const durations = DURATIONS.filter((duration) => grids.some((grid) => shownIds.has(grid.titleId) && grid.prices.some((p) => p.duration === duration)))
  // The professions whose versions are open.
  const [openTitles, setOpenTitles] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setOpenTitles((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const askDelete = (grid: GridRow, title: string, button: HTMLButtonElement) => {
    trigger.current = button
    setRefusal(null)
    setToDelete({ grid, title })
  }

  return (
    <SettingsCard as="section" title={t(`${G}.title`)} description={t(`${G}.description`)} headingRef={heading}>
      {/* One row per profession (audit 2026-10-09 §2.6): the retention (and from when its floor applies)
          and a column per priced duration, instead of a run-on sentence; numbers right-aligned. */}
      <Table aria-label={t(`${G}.title`)} scrollLabel={t(`${G}.title`)} scrollFocus="overflow" className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t(`${G}.columns.profession`)}</TableHead>
            <TableHead align="right">{t(`${G}.retention`)}</TableHead>
            {durations.map((duration) => (
              <TableHead key={duration} align="right">
                {durationLabel(duration)}
              </TableHead>
            ))}
            <TableHead>
              <span className="sr-only">{t(`${G}.columns.actions`)}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {shown.map((title) => {
          const series = rowsOf(grids, (grid) => grid.titleId === title.id)
          const grid = shownGrid(series, today)
          const open = series.find((row) => row.effectiveTo === null) ?? null
          const coming = open && datedStatus(open, today) === 'upcoming' && open !== grid ? open : null
          const expanded = openTitles.has(title.id)
          const detailsId = `${idBase}-${title.id}`
          return (
            <TableBody key={title.id}>
              <TableRow className="align-top hover:bg-transparent">
                <TableCell>
                  <span className="font-medium">{title.name}</span>
                  {coming && <span className="block text-xs text-muted-foreground">{t(`${G}.coming`, { date: formatDateOnlyShort(coming.effectiveFrom) })}</span>}
                  {series.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={() => toggle(title.id)}
                      className={cn('mt-0.5 flex items-center gap-1 rounded-sm text-left text-xs text-link', focusRing)}
                    >
                      <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} />
                      {series.length === 1 ? t(`${G}.detailsOne`) : t(`${G}.details`, { count: String(series.length) })}
                    </button>
                  )}
                </TableCell>
                {grid ? (
                  <>
                    <TableCell align="right" className="whitespace-nowrap tabular">
                      {t(`${G}.retentionRange`, { first: formatPercent(grid.tiers[0]?.pct ?? 0), floor: formatPercent(grid.tiers.at(-1)?.pct ?? 0) })}
                      <span className="block text-xs text-muted-foreground">{t(`${G}.fromSessions`, { tier: sessionsLabel(grid.tiers.at(-1)?.threshold ?? 0) })}</span>
                    </TableCell>
                    {durations.map((duration) => {
                      const price = grid.prices.find((p) => p.duration === duration)
                      return (
                        <TableCell key={duration} align="right" className="whitespace-nowrap tabular">
                          {price ? formatCents(price.clientPriceCents) : <span className="text-muted-foreground">{t(`${G}.notPriced`)}</span>}
                        </TableCell>
                      )
                    })}
                  </>
                ) : (
                  <TableCell colSpan={1 + durations.length} className="text-muted-foreground">
                    {t(`${G}.none`)}
                  </TableCell>
                )}
                <TableCell className="w-px whitespace-nowrap py-1.5 text-right">
                  <GridDialog titleId={title.id} titleName={title.name} series={series} />
                </TableCell>
              </TableRow>
              {series.length > 0 && (
                <TableRow id={detailsId} hidden={!expanded} className="hover:bg-transparent">
                  <TableCell colSpan={3 + durations.length} className="pt-0">
                    {expanded && <Versions title={title} series={series} today={today} now={now} onDelete={askDelete} />}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          )
        })}
      </Table>
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${G}.deleteTitle`)}
        body={toDelete ? t(`${G}.deleteBody`, { title: toDelete.title, date: formatDateOnlyShort(toDelete.grid.effectiveFrom) }) : ''}
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate(toDelete.grid.id, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={trigger}
        fallbackRef={heading}
      />
    </SettingsCard>
  )
}

interface VersionsProps {
  title: ProfessionTitle
  series: readonly GridRow[]
  today: string
  now: number
  onDelete: (grid: GridRow, title: string, button: HTMLButtonElement) => void
}

/** A profession's versions: the period, the status, the tiers and the client prices; two per row on a wide screen. */
function Versions({ title, series, today, now, onDelete }: VersionsProps) {
  return (
    <div className={cn('grid gap-3', series.length > 1 && '2xl:grid-cols-2')}>
      {series.map((version) => (
        <div key={version.id} className="rounded-md border border-border-light p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium">{periodLabel(version)}</span>
            <DatedStatusBadge status={datedStatus(version, today)} />
            {canDeleteDated(version, series, today, now, { keepFirst: false }) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                aria-label={t(`${G}.deleteLabel`, { title: title.name, date: formatDateOnlyShort(version.effectiveFrom) })}
                onClick={(event) => onDelete(version, title.name, event.currentTarget)}
              >
                <Trash2 aria-hidden className="sm:hidden" />
                <span className="max-sm:sr-only">{t('modules.professionals.compensation.delete')}</span>
              </Button>
            )}
          </div>
          {version.note && <p className="mt-1 break-words text-xs text-muted-foreground">{version.note}</p>}
          <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_auto]">
            <Table aria-label={t(`${G}.tiersLabel`, { title: title.name, date: formatDateOnlyShort(version.effectiveFrom) })} className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <TableHeader>
                <TableRow>
                  <TableHead>{t(`${G}.sessions`)}</TableHead>
                  <TableHead align="right">{t(`${G}.retention`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {version.tiers.map((tier, index) => (
                  <TableRow key={tier.threshold}>
                    <TableCell className="tabular">{tierRange(version.tiers, index)}</TableCell>
                    <TableCell align="right" className="tabular">
                      {formatPercent(tier.pct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <dl className="space-y-1 text-sm">
              <dt className="text-xs text-muted-foreground">{t(`${G}.prices`)}</dt>
              {version.prices.map((price) => (
                <dd key={price.duration} className="whitespace-nowrap tabular">
                  {durationLabel(price.duration)} · {formatCents(price.clientPriceCents)}
                </dd>
              ))}
            </dl>
          </div>
        </div>
      ))}
    </div>
  )
}
