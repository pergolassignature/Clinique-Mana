import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import type { PayLine } from '../../api/compensation'
import { durationLabel, formatCents, type PayChange, type RetentionDisplay } from '../../lib/compensation'

/**
 * Pieces shared by the record's « Rétention » card, « Révision mensuelle » and the decision
 * dialog: the status, a key/value pair, the pay table and a decision's pay change. Amounts come
 * from the database (P4-189).
 */

const W = 'modules.professionals.compensation'

const STATUS_VARIANT = {
  newTier: 'warning',
  gridGap: 'warning',
  noRate: 'default',
  increaseDecided: 'success',
  floor: 'info',
  conforme: 'success',
  maintained: 'secondary',
  custom: 'secondary',
  professionUnconfirmed: 'outline',
} as const satisfies Record<RetentionDisplay, 'warning' | 'success' | 'info' | 'secondary' | 'outline' | 'default'>

/** « Nouveau palier atteint », « Taux de départ à fixer », « Conforme »… (P4-197): the words carry it, the dot only echoes. */
export function RetentionStatusBadge({ display }: { display: RetentionDisplay }) {
  return <Badge variant={STATUS_VARIANT[display]}>{t(`${W}.status.${display}`)}</Badge>
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

const P = 'modules.professionals.record.compensation.retention.payTable'

/**
 * « Versé par séance » on the record (P4-198): Durée · Prix client · Aujourd'hui (at the rate in
 * force on the read's date, what is paid that day) · « Dès le … » when a decision starts later.
 */
export function PayTable({ pay, upcomingFrom = null, caption }: { pay: readonly PayLine[]; upcomingFrom?: string | null; caption: string }) {
  const upcoming = upcomingFrom !== null && pay.some((line) => line.upcomingCents !== null && line.upcomingCents !== line.appliedCents)
  const cell = 'px-2 py-1.5 text-right tabular'
  return (
    <table className="w-full max-w-lg text-sm">
      <caption className="mb-1 text-left text-xs text-muted-foreground">{caption}</caption>
      <thead>
        <tr className="border-b border-border-light text-xs text-muted-foreground">
          <th scope="col" className="py-1.5 pr-2 text-left font-normal">
            {t(`${P}.duration`)}
          </th>
          <th scope="col" className={`${cell} font-normal`}>
            {t(`${P}.clientPrice`)}
          </th>
          <th scope="col" className={`${cell} font-normal`}>
            {t(`${P}.today`)}
          </th>
          {upcoming && (
            <th scope="col" className={`${cell} font-normal`}>
              {t(`${P}.from`, { date: formatDateOnlyShort(upcomingFrom) })}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {pay.map((line) => (
          <tr key={line.duration} className="border-b border-border-light last:border-0">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              {durationLabel(line.duration)}
            </th>
            <td className={`${cell} text-muted-foreground`}>{formatCents(line.clientPriceCents)}</td>
            <td className={`${cell} font-medium`}>{line.appliedCents === null ? <NoRate /> : formatCents(line.appliedCents)}</td>
            {upcoming && <td className={`${cell} font-medium`}>{line.upcomingCents === null ? <NoRate /> : formatCents(line.upcomingCents)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** No rate in force: said in words, never a dash (« il faut toujours être clair »). */
const NoRate = () => <span className="whitespace-nowrap font-normal text-muted-foreground">{t('modules.professionals.record.compensation.retention.noRate')}</span>

const C = `${W}.decision.pay`

/** « +0,87 $ », « −1,25 $ ». */
const signedCents = (cents: number): string => `${cents < 0 ? '−' : '+'}${formatCents(Math.abs(cents))}`

/**
 * A decision's effect on the pay, one line per duration the grid prices (P4-198): « Rencontre
 * 50 min : versé 126,88 $ → 127,75 $ (+0,87 $) », « … versé 105,00 $ » for a first rate,
 * « … (inchangé) » when it stays.
 */
export function PayChangeList({ changes }: { changes: readonly PayChange[] }) {
  if (changes.length === 0) return null
  return (
    <section aria-labelledby="decision-pay-title" className="rounded-md border border-border-light bg-muted/40 px-3 py-2">
      <h3 id="decision-pay-title" className="text-xs font-medium text-muted-foreground">
        {t(`${C}.title`)}
      </h3>
      <ul className="mt-1 space-y-0.5 text-sm">
        {changes.map((change) => (
          <li key={change.duration}>
            {t(`${C}.meeting`, { duration: durationLabel(change.duration) })} {t(`${C}.paid`)}{' '}
            {change.beforeCents === null ? (
              <span className="font-medium tabular">{formatCents(change.afterCents)}</span>
            ) : change.beforeCents === change.afterCents ? (
              <>
                <span className="font-medium tabular">{formatCents(change.afterCents)}</span> <span className="text-muted-foreground">{t(`${C}.unchanged`)}</span>
              </>
            ) : (
              <>
                <span className="tabular">{formatCents(change.beforeCents)}</span> <span aria-hidden>→</span>
                <span className="sr-only"> {t(`${C}.becomes`)}</span> <span className="font-medium tabular">{formatCents(change.afterCents)}</span>{' '}
                <span className="text-muted-foreground tabular">({signedCents(change.afterCents - change.beforeCents)})</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
