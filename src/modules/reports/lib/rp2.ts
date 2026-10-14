import { t } from '@/i18n'
import { buildCsv, csvMoney, csvNumber, type CsvCell } from '@/shared/lib/csv'
import type { IvacRow, IvacState, PayoutState, PayoutsReport } from '../api/rp2'
import { monthLabel, type Period } from './reports'

const R = 'modules.reports'

/** « À facturer à l'IVAC », « Payée »… */
export const ivacStateLabel = (state: IvacState): string => t(`${R}.ivac.states.${state}`)

/** « Brouillon », « À valider », « Payé »… */
export const payoutStateLabel = (state: PayoutState): string => t(`${R}.payouts.states.${state}`)

/** The row's sorts (legacy: the date, the client, the professional). */
export const IVAC_SORTS = ['date_desc', 'date_asc', 'client', 'professional'] as const
export type IvacSort = (typeof IVAC_SORTS)[number]

const byName = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'fr-CA', { sensitivity: 'base' })

/** The rows in the chosen order; ties by date (newest first). */
export function sortIvacRows(rows: readonly IvacRow[], sort: IvacSort): IvacRow[] {
  const newest = (a: IvacRow, b: IvacRow) => b.service_on.localeCompare(a.service_on)
  const sorted = [...rows]
  switch (sort) {
    case 'date_desc':
      return sorted.sort(newest)
    case 'date_asc':
      return sorted.sort((a, b) => -newest(a, b))
    case 'client':
      return sorted.sort((a, b) => byName(a.client_name, b.client_name) || newest(a, b))
    case 'professional':
      return sorted.sort((a, b) => byName(a.professional_name, b.professional_name) || newest(a, b))
  }
}

/** « 10150 · Consultation individuelle 50 min ». */
export const ivacServiceLabel = (row: Pick<IvacRow, 'service_code' | 'service_name'>): string =>
  row.service_name ? (row.service_code ? `${row.service_code} · ${row.service_name}` : row.service_name) : ''

/** « IVAC » as a CSV: what is shown, in the order shown. */
export function ivacCsv(rows: readonly IvacRow[], period: Period): { fileName: string; content: string } {
  const C = `${R}.ivac.columns`
  const header = [t(`${C}.date`), t(`${C}.fileNumber`), t(`${C}.client`), t(`${C}.ivacFile`), t(`${C}.professional`), t(`${C}.ivacNumber`),
    t(`${C}.service`), t(`${C}.amount`), t(`${C}.state`), t(`${C}.clientInvoice`), t(`${C}.ivacInvoice`)]
  const body: CsvCell[][] = rows.map((r) => [r.service_on, r.client_number == null ? null : csvNumber(r.client_number), r.client_name,
    r.file_number, r.professional_name, r.professional_ivac_number, r.by_hand ? (r.service_name ?? '') : ivacServiceLabel(r),
    csvMoney(r.amount_cents), ivacStateLabel(r.state), r.client_invoice_number, r.payer_invoice_number])
  return { fileName: t(`${R}.ivac.fileName`, { from: period.from, to: period.to }), content: buildCsv(header, body) }
}

/** « Paie » as a CSV: one line per summary. */
export function payoutsCsv(report: PayoutsReport, period: Period): { fileName: string; content: string } {
  const C = `${R}.payouts.columns`
  const header = [t(`${C}.month`), t(`${C}.professional`), t(`${C}.title`), t(`${C}.state`), t(`${C}.sessions`), t(`${C}.sessionAmount`),
    t(`${C}.lateCancellations`), t(`${C}.lateCancellationAmount`), t(`${C}.other`), t(`${C}.adjustments`), t(`${C}.total`),
    t(`${C}.unpriced`), t(`${C}.paidOn`)]
  const body: CsvCell[][] = report.rows.map((r) => [monthLabel(r.month.slice(0, 7)), r.professional_name, r.title_name,
    payoutStateLabel(r.state), csvNumber(r.sessions), csvMoney(r.session_cents), csvNumber(r.late_cancellations),
    csvMoney(r.late_cancellation_cents), csvMoney(r.other_cents), csvMoney(r.adjustment_cents), csvMoney(r.total_cents),
    csvNumber(r.unpriced_count), r.paid_on])
  return { fileName: t(`${R}.payouts.fileName`, { from: period.from, to: period.to }), content: buildCsv(header, body) }
}
