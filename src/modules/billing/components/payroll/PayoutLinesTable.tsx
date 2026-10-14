import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { PayoutLine } from '../../api/payroll'
import { formatPay, formatRetention, isUnpriced, kindLabel, lineDescription, pricingLabel, subtotalsByKind } from '../../lib/payroll'

const L = 'modules.billing.payroll.lines'

interface PayoutLinesTableProps {
  lines: readonly PayoutLine[]
  totalCents: number
  /** The client's name (the professional and the administration); never shown in the PDF. */
  showClients?: boolean
  /** « Retirer » on an adjustment (the administration, an open period). */
  onRemoveAdjustment?: (line: PayoutLine) => void
  removing?: boolean
}

/**
 * A summary's lines, as the professional checks them: the date, the client, the service, the
 * client price, the clinic's retention and what she is paid; a line « À compléter » says why
 * (« Taux de départ à fixer »…); one that came late reads « Mois précédent », a fee « Payé le … ».
 * Then the subtotal of each kind and the total.
 */
export function PayoutLinesTable({ lines, totalCents, showClients = true, onRemoveAdjustment, removing = false }: PayoutLinesTableProps) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">{t(`${L}.empty`)}</p>
  const subtotals = subtotalsByKind(lines)
  return (
    <div className="space-y-3">
      <Table aria-label={t(`${L}.table`)} scrollLabel={t(`${L}.table`)} scrollFocus="overflow" className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead className="max-sm:hidden">{t(`${L}.columns.date`)}</TableHead>
            {showClients && <TableHead>{t(`${L}.columns.client`)}</TableHead>}
            <TableHead>{t(`${L}.columns.service`)}</TableHead>
            <TableHead align="right" className="max-sm:hidden">{t(`${L}.columns.base`)}</TableHead>
            <TableHead align="right" className="max-sm:hidden">{t(`${L}.columns.retention`)}</TableHead>
            <TableHead align="right">{t(`${L}.columns.amount`)}</TableHead>
            {onRemoveAdjustment && <TableHead className="w-0"><span className="sr-only">{t(`${L}.columns.actions`)}</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id} className="align-top" data-kind={line.kind}>
              <TableCell className="whitespace-nowrap max-sm:hidden">
                {formatDateOnlyShort(line.occurred_on)}
                {line.late && (
                  <span className="block">
                    <Badge variant="info">{t(`${L}.late`)}</Badge>
                  </span>
                )}
              </TableCell>
              {showClients && (
                <TableCell className="sm:min-w-[140px]">
                  {line.client_name ?? <span className="text-muted-foreground">{t(`${L}.noClient`)}</span>}
                  {line.client_number !== null && (
                    <span className="block text-xs text-muted-foreground">{t(`${L}.fileNumber`, { number: `CLI-${String(line.client_number).padStart(6, '0')}` })}</span>
                  )}
                </TableCell>
              )}
              <TableCell className="sm:min-w-[200px]">
                {lineDescription(line)}
                {/* On a phone the date goes here, and the base and the retention fold away: the amount stays in view. */}
                <span className="block text-xs text-muted-foreground sm:hidden">{formatDateOnlyShort(line.occurred_on)}</span>
                <span className="block text-xs text-muted-foreground">
                  {kindLabel(line.kind)}
                  {line.pricing === 'agreement' && ` · ${pricingLabel('agreement')}`}
                  {line.paid_on && ` · ${t(`${L}.paidOn`, { date: formatDateOnlyShort(line.paid_on) })}`}
                </span>
              </TableCell>
              <TableCell align="right" className="whitespace-nowrap max-sm:hidden">
                {line.base_cents === null ? '' : formatPay(line.base_cents)}
              </TableCell>
              <TableCell align="right" className="whitespace-nowrap max-sm:hidden">
                {line.retention_pct === null ? '' : formatRetention(line.retention_pct)}
              </TableCell>
              <TableCell align="right" className="whitespace-nowrap font-medium">
                {isUnpriced(line.pricing) ? (
                  <Badge variant="warning">{t(`${L}.unpriced`, { reason: pricingLabel(line.pricing) })}</Badge>
                ) : (
                  formatPay(line.amount_cents ?? 0)
                )}
              </TableCell>
              {onRemoveAdjustment && (
                <TableCell className="w-0">
                  {line.kind === 'adjustment' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t(`${L}.removeAdjustment`, { note: line.note ?? '' })}
                      aria-disabled={removing || undefined}
                      onClick={() => !removing && onRemoveAdjustment(line)}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="ml-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {subtotals.map((row) => (
          <div key={row.kind} className="contents">
            <dt className="text-muted-foreground">{t(`${L}.subtotal`, { kind: kindLabel(row.kind), count: String(row.count) })}</dt>
            <dd className="tabular text-right">{formatPay(row.cents)}</dd>
          </div>
        ))}
        <div className="contents">
          <dt className="font-semibold">{t(`${L}.total`)}</dt>
          <dd className="tabular text-right font-semibold">{formatPay(totalCents)}</dd>
        </div>
      </dl>
    </div>
  )
}
