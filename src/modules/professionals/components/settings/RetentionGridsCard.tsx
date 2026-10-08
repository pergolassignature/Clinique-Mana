import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { GridRow } from '../../api/compensation'
import type { ProfessionTitle } from '../../api/parse'
import { useDeleteRetentionGrid } from '../../hooks/use-compensation'
import { canDeleteDated, datedStatus, durationLabel, formatCents, formatPercent, formatSessions, periodLabel, rowsOf, sessionsLabel, tierLastCount } from '../../lib/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge } from '../compensation/DatedRowParts'
import { Disclosure } from '../record/MotifsSummary'
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
  // Active titles, plus an archived one that still has a grid.
  const shown = titles.filter((title) => title.isActive || grids.some((grid) => grid.titleId === title.id))

  return (
    <SettingsCard as="section" title={t(`${G}.title`)} description={t(`${G}.description`)} headingRef={heading}>
      <ul className="divide-y divide-border-light">
        {shown.map((title) => {
          const series = rowsOf(grids, (grid) => grid.titleId === title.id)
          const grid = shownGrid(series, today)
          const open = series.find((row) => row.effectiveTo === null) ?? null
          const coming = open && datedStatus(open, today) === 'upcoming' && open !== grid ? open : null
          return (
            <li key={title.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold">{title.name}</h4>
                  {grid ? (
                    <p className="text-xs text-muted-foreground">
                      {t(`${G}.summary`, {
                        first: formatPercent(grid.tiers[0]?.pct ?? 0),
                        floor: formatPercent(grid.tiers.at(-1)?.pct ?? 0),
                        tier: sessionsLabel(grid.tiers.at(-1)?.threshold ?? 0),
                      })}
                      {' · '}
                      {grid.prices.map((price) => `${durationLabel(price.duration)} ${formatCents(price.clientPriceCents)}`).join(' · ')}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t(`${G}.none`)}</p>
                  )}
                  {coming && <p className="text-xs text-muted-foreground">{t(`${G}.coming`, { date: formatDateOnlyShort(coming.effectiveFrom) })}</p>}
                </div>
                <GridDialog titleId={title.id} titleName={title.name} series={series} />
              </div>
              {series.length > 0 && (
                <Disclosure label={<span className="text-sm">{t(`${G}.details`, { count: String(series.length) })}</span>}>
                  <div className="space-y-3">
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
                              onClick={(event) => {
                                trigger.current = event.currentTarget
                                setRefusal(null)
                                setToDelete({ grid: version, title: title.name })
                              }}
                            >
                              <Trash2 aria-hidden className="sm:hidden" />
                              <span className="max-sm:sr-only">{t('modules.professionals.compensation.delete')}</span>
                            </Button>
                          )}
                        </div>
                        {version.note && <p className="mt-1 break-words text-xs text-muted-foreground">{version.note}</p>}
                        <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <Table aria-label={t(`${G}.tiersLabel`, { title: title.name, date: formatDateOnlyShort(version.effectiveFrom) })} className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t(`${G}.sessions`)}</TableHead>
                                <TableHead className="text-right">{t(`${G}.retention`)}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {version.tiers.map((tier, index) => (
                                <TableRow key={tier.threshold}>
                                  <TableCell className="tabular">{tierRange(version.tiers, index)}</TableCell>
                                  <TableCell className="text-right tabular">{formatPercent(tier.pct)}</TableCell>
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
                </Disclosure>
              )}
            </li>
          )
        })}
      </ul>
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
