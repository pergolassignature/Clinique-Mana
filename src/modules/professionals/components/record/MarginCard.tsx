import { Fragment, useId, useRef, useState } from 'react'
import { ChevronRight, Trash2, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { MarginInForce, MarginRow, ProfessionalCompensation } from '../../api/compensation'
import { useDeleteProfessionalMargin } from '../../hooks/use-compensation'
import { canDeleteDated, datedStatus, formatPercent, isOutsideRange, periodLabel, rangeLabel, rowsOfKind } from '../../lib/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge } from '../compensation/DatedRowParts'
import { MarginDialog } from './MarginDialog'

const M = 'modules.professionals.record.compensation.margin'
const W = 'modules.professionals.compensation'

/** Phone: 8 px cells, none at the edges (as « Fiscalité »'s rates). */
const PHONE_TABLE =
  'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2 max-sm:[&_td:first-child]:pl-0 max-sm:[&_th:first-child]:pl-0 max-sm:[&_td:last-child]:pr-0 max-sm:[&_th:last-child]:pr-0'

/** « 28 % », « 25–30 % (par défaut) », or « Aucune marge » when the clinic has no range either. */
function marginText(margin: MarginInForce): string {
  if (margin.source === 'professional' && margin.marginPct !== null) return formatPercent(margin.marginPct)
  if (margin.min !== null && margin.max !== null) return t(`${W}.byDefault`, { range: rangeLabel(margin.min, margin.max) })
  return t(`${M}.none`)
}

interface MarginCardProps {
  professionalId: string
  data: ProfessionalCompensation
}

/**
 * « Marge clinique » (`professionals.compensation`): per kind, the margin in force today (the
 * professional's, or the default range), since when, a coming one, and « Historique » unfolding
 * every dated row of the kind. « Supprimer » on the one row the database will let go (P4-145);
 * « Nouvelle marge » adds one. Statuses follow the clinic's date and the clock (the 24-hour window).
 */
export function MarginCard({ professionalId, data }: MarginCardProps) {
  const now = useNow(60_000)
  const today = getClinicDateString(new Date(now))
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [toDelete, setToDelete] = useState<{ row: MarginRow; kindName: string } | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDeleteProfessionalMargin(professionalId, { onErrorMessage: (message) => setRefusal(message) })
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const baseId = useId()

  const toggle = (kind: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  return (
    <SettingsCard
      as="section"
      title={t(`${M}.title`)}
      description={t(`${M}.description`)}
      footer={<MarginDialog ref={addButton} professionalId={professionalId} kinds={data.margins} rows={data.marginRows} />}
    >
      <Table className={PHONE_TABLE}>
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t(`${M}.type`)}</TableHead>
            <TableHead>{t(`${M}.current`)}</TableHead>
            <TableHead className="max-sm:hidden">{t(`${M}.since`)}</TableHead>
            <TableHead>
              <span className="sr-only">{t(`${M}.actions`)}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.margins.map((margin) => {
            const series = rowsOfKind(data.marginRows, margin.kind)
            const openRow = series.find((row) => row.effectiveTo === null)
            const upcoming = openRow && datedStatus(openRow, today) === 'upcoming' ? openRow : null
            const outside = margin.source === 'professional' && margin.marginPct !== null && isOutsideRange(margin.marginPct, margin.min, margin.max)
            const panelId = `${baseId}-${margin.kind}`
            const expanded = open.has(margin.kind)
            return (
              <Fragment key={margin.kind}>
                <TableRow className="align-top">
                  <TableCell className="font-medium">{margin.name}</TableCell>
                  <TableCell>
                    <span className="whitespace-nowrap tabular">{marginText(margin)}</span>
                    {margin.effectiveFrom && (
                      <span className="block text-xs text-muted-foreground sm:hidden">{t(`${M}.sinceLine`, { date: formatDateOnlyShort(margin.effectiveFrom) })}</span>
                    )}
                    {outside && (
                      <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                        <TriangleAlert aria-hidden className="mt-px size-3 shrink-0 text-warning" />
                        {t(`${M}.outside`, { range: rangeLabel(margin.min ?? 0, margin.max ?? 0) })}
                      </span>
                    )}
                    {upcoming && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t(`${M}.upcoming`, { margin: formatPercent(upcoming.marginPct), date: formatDateOnlyShort(upcoming.effectiveFrom) })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap max-sm:hidden">{margin.effectiveFrom ? formatDateOnlyShort(margin.effectiveFrom) : '—'}</TableCell>
                  <TableCell className="py-1 text-right">
                    {series.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        aria-label={t(`${M}.historyLabel`, { kind: margin.name })}
                        onClick={() => toggle(margin.kind)}
                      >
                        <ChevronRight aria-hidden className={cn('transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} />
                        <span className="max-sm:sr-only">{t(`${W}.history`)}</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {series.length > 0 && (
                  <TableRow id={panelId} hidden={!expanded} className="hover:bg-transparent">
                    <TableCell colSpan={4} className="pt-0">
                      <ol className="divide-y divide-border-light rounded-md border border-border-light">
                        {series.map((row) => (
                            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                              <span className="font-medium tabular">{formatPercent(row.marginPct)}</span>
                              <span className="text-muted-foreground">{periodLabel(row)}</span>
                              <DatedStatusBadge status={datedStatus(row, today)} />
                              {row.note && <span className="basis-full break-words text-xs text-muted-foreground">{row.note}</span>}
                              {canDeleteDated(row, series, today, now, { keepFirst: false }) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="ml-auto"
                                  aria-label={t(`${M}.deleteLabel`, { kind: margin.name, margin: formatPercent(row.marginPct), date: formatDateOnlyShort(row.effectiveFrom) })}
                                  onClick={(event) => {
                                    deleteTrigger.current = event.currentTarget
                                    setRefusal(null)
                                    setToDelete({ row, kindName: margin.name })
                                  }}
                                >
                                  <Trash2 aria-hidden className="sm:hidden" />
                                  <span className="max-sm:sr-only">{t(`${W}.delete`)}</span>
                                </Button>
                              )}
                            </li>
                        ))}
                      </ol>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${M}.deleteTitle`)}
        body={
          toDelete
            ? t(`${M}.deleteBody`, { kind: toDelete.kindName, margin: formatPercent(toDelete.row.marginPct), date: formatDateOnlyShort(toDelete.row.effectiveFrom) })
            : ''
        }
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate(toDelete.row.id, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={deleteTrigger}
        fallbackRef={addButton}
      />
    </SettingsCard>
  )
}
