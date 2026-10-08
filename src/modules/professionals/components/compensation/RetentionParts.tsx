import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import type { PayLine, RetentionStatus } from '../../api/compensation'
import { durationLabel, formatCents } from '../../lib/compensation'

/**
 * Pieces shared by the record's « Rétention » card and « Révision mensuelle »: the status, a
 * key/value pair and the pay per duration. Amounts come from the database (P4-189).
 */

const W = 'modules.professionals.compensation'

const STATUS_VARIANT = {
  gap: 'warning',
  conforme: 'success',
  floor: 'info',
  maintained: 'secondary',
  custom: 'secondary',
  profession_unconfirmed: 'outline',
} as const satisfies Record<RetentionStatus, 'warning' | 'success' | 'info' | 'secondary' | 'outline'>

/** « Écart à valider », « Conforme », « Palier maximum atteint »… (P4-188). */
export function RetentionStatusBadge({ status }: { status: RetentionStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{t(`${W}.retentionStatus.${status}`)}</Badge>
}

/** One key/value pair: the term 12 px secondary, the value 13 px (design system). */
export function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  )
}

/**
 * Pay per duration: « 50 min · 126,88 $ » at the rate in force on the read's date (what is paid
 * that day, P4-189), the suggested amount next to it when it differs (« → 127,75 $ »), and the
 * amount of a decision starting later, labelled as such (« À venir dès le 1 nov. 2026 : 127,75 $ »,
 * `upcomingFrom` being that decision's start). `compact` (the review's narrow cell) drops the client
 * price, shortens « 60 min / couple » to « 60 min » and puts the other amounts on their own lines.
 */
export function PayList({ pay, upcomingFrom = null, compact = false }: { pay: readonly PayLine[]; upcomingFrom?: string | null; compact?: boolean }) {
  if (pay.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <ul className="space-y-0.5">
      {pay.map((line) => {
        const differs = line.suggestedCents !== null && line.suggestedCents !== line.appliedCents
        return (
          <li key={line.duration} className={compact ? 'text-sm' : 'whitespace-nowrap text-sm'}>
            <span className="text-muted-foreground">{compact ? t(`${W}.pay.minutes`, { duration: String(line.duration) }) : durationLabel(line.duration)}</span>{' '}
            <span className="whitespace-nowrap font-medium tabular">{line.appliedCents === null ? '—' : formatCents(line.appliedCents)}</span>
            {differs && (
              <span className={compact ? 'block whitespace-nowrap text-xs text-muted-foreground tabular' : 'text-muted-foreground tabular'}>
                {' '}
                <span aria-hidden>→</span>
                <span className="sr-only">{t(`${W}.pay.suggestedPrefix`)}</span> {formatCents(line.suggestedCents ?? 0)}
              </span>
            )}
            {upcomingFrom !== null && line.upcomingCents !== null && line.upcomingCents !== line.appliedCents && (
              <span className="block whitespace-normal text-xs text-muted-foreground tabular">
                {t(`${W}.pay.upcoming`, { date: formatDateOnlyShort(upcomingFrom), amount: formatCents(line.upcomingCents) })}
              </span>
            )}
            {!compact && <span className="block text-xs text-muted-foreground">{t(`${W}.pay.clientPrice`, { price: formatCents(line.clientPriceCents) })}</span>}
          </li>
        )
      })}
    </ul>
  )
}
