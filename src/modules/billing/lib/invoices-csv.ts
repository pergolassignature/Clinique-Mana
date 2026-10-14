import { t } from '@/i18n'
import { buildCsv, csvMoney, type CsvCell } from '@/shared/lib/csv'
import type { InvoiceRow } from '../api/invoices'
import { paymentLabel, statusLabel } from './money'

const L = 'modules.billing.list'
const C = `${L}.csv`

/** « 12 » → « CLI-000012 » (Clients' file number, as the record shows it). */
const fileNumber = (n: number | null): string | null => (n === null ? null : `CLI-${String(n).padStart(6, '0')}`)

/**
 * The invoices list as a CSV (parity audit L7): the invoices of the tab (drafts, issued, credited
 * or all), newest first, with what the list shows and what is paid and due.
 */
export function invoicesCsv(rows: readonly InvoiceRow[], view: string, today: string): { fileName: string; content: string } {
  const header = [
    t(`${C}.number`),
    t(`${C}.issuedOn`),
    t(`${C}.fileNumber`),
    t(`${C}.client`),
    t(`${C}.payer`),
    t(`${C}.total`),
    t(`${C}.paid`),
    t(`${C}.balance`),
    t(`${C}.status`),
    t(`${C}.payment`),
  ]
  const body: CsvCell[][] = rows.map((r) => [
    r.number ?? t(`${L}.draft`),
    r.issuedOn,
    fileNumber(r.clientNumber),
    r.clientName,
    r.payerKind !== 'organisation' && r.payerId === r.clientId ? t(`${L}.payerSelf`) : r.payerName,
    csvMoney(r.totalCents),
    csvMoney(r.paidCents),
    csvMoney(r.status === 'issued' ? r.totalCents - r.paidCents : 0),
    statusLabel(r.status),
    r.status === 'issued' ? paymentLabel(r.paymentStatus) : null,
  ])
  return { fileName: t(`${C}.fileName`, { view, date: today }), content: buildCsv(header, body) }
}
