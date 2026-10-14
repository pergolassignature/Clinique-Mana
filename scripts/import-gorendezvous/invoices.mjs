// The billing import (I3): the three « Revenus » exports (par facture, par service-produit, par
// paiement), read by revenue.mjs, put together as one row per invoice for Facturation's
// `import_invoice(row, dry_run)`, and the dry run's report. Pure: no file, no database.
//
// A row: the GOrendezvous number, the date, the client's name (Clients finds the imported file;
// the --clients-map gives the ClientId of homonyms), the totals, its lines (the service by code,
// the professional when the employees file names her) and its payments (a negative amount is a
// refund). A « Note de crédit » payment is an imported credit on its invoice (BI-27): it counts
// in what is paid, never goes to QuickBooks and is never refunded. **The report never prints a value from the files**: line numbers, invoice counts,
// months, money totals and French reasons only (decision I-6).
import { readTable } from './table.mjs'
import { foldText } from './normalize.mjs'
import { INVOICE_NUMBER } from './revenue.mjs'

export const INVOICE_REASON_LABELS = {
  invoice_without_lines: 'facture sans ligne dans « par service-produit »',
  duplicate_invoice: 'numéro de facture en double dans « par facture »',
  line_without_invoice: 'ligne d’une facture absente de « par facture »',
  payment_without_invoice: 'paiement sans numéro de facture',
  payment_unknown_invoice: 'paiement d’une facture absente de « par facture »',
  zero_payment: 'paiement de 0 $',
  client_not_found: 'aucun dossier importé à ce nom (ajoutez-le à --clients-map)',
  client_ambiguous: 'plusieurs dossiers importés à ce nom (départagez avec --clients-map)',
  invalid_map_row: 'ligne illisible (attendu : Facture ; ClientId)',
  duplicate_map_row: 'facture en double',
}

export const CLIENTS_MAP_COLUMNS = {
  invoiceNumber: ['Facture', 'N° de facture', 'Numéro de facture', 'Invoice'],
  clientId: ['ClientId', 'Client Id', 'Id du client', 'No client', 'N° client GOrendezvous'],
}

/** The --clients-map file: GOrendezvous invoice number → ClientId. `{ refFor(number), rejected }`. */
export function readClientsMap(text) {
  const map = new Map()
  const rejected = []
  if (text !== undefined) {
    const { rows } = readTable(text, { columns: CLIENTS_MAP_COLUMNS, required: ['invoiceNumber', 'clientId'] })
    for (const row of rows) {
      const number = row.get('invoiceNumber')
      const id = row.get('clientId')
      if (!INVOICE_NUMBER.test(number) || !/^[0-9A-Za-z-]{1,40}$/.test(id)) rejected.push({ line: row.line, reasons: ['invalid_map_row'] })
      else if (map.has(number)) rejected.push({ line: row.line, reasons: ['duplicate_map_row'] })
      else map.set(number, `gorendezvous:${id}`)
    }
  }
  return { refFor: (number) => map.get(number) ?? null, rejected, size: map.size }
}

/** Payment methods as revenue.mjs maps them → Facturation's `payment_modes.code`. */
export const CREDIT_NOTE_MODE = 'credit_note'
const MODE_CODES = { qbo_payments_card: 'qbo_payments_card', stripe: 'stripe', interac: 'interac', credit_note: CREDIT_NOTE_MODE, cheque: 'cheque', bank_transfer: 'bank_transfer' }

/**
 * The three exports → `{ rows, rejected, payerDiffers }`. `rows`: `{ line, number, month,
 * total_cents, row }` per invoice of « par facture » with at least one line; `rejected`: `{ file,
 * line, reasons }` (`file`: invoices, lines or payments). `professionalFor(label)` is the
 * employees file's lookup (or none); `codeFor(line)` the services file's; `refFor(number)` the
 * clients map's. `payerDiffers`: invoices whose « Payé par » is not the client (IVAC, PAE…), billed
 * to the client here and left to complete.
 */
export function assembleInvoices({ invoices, lines, payments }, { professionalFor = () => null, codeFor = (l) => l.service_code, refFor = () => null } = {}) {
  const rejected = []
  const linesBy = new Map()
  const paymentsBy = new Map()
  const headers = new Map()
  for (const invoice of invoices) {
    if (headers.has(invoice.invoiceNumber)) {
      rejected.push({ file: 'invoices', line: invoice.line, reasons: ['duplicate_invoice'] })
      continue
    }
    headers.set(invoice.invoiceNumber, invoice)
  }
  for (const line of lines) {
    if (!headers.has(line.invoiceNumber)) {
      rejected.push({ file: 'lines', line: line.line, reasons: ['line_without_invoice'] })
      continue
    }
    if (!linesBy.has(line.invoiceNumber)) linesBy.set(line.invoiceNumber, [])
    linesBy.get(line.invoiceNumber).push(line)
  }
  for (const payment of payments) {
    const reasons = []
    if (!payment.invoiceNumber) reasons.push('payment_without_invoice')
    else if (!headers.has(payment.invoiceNumber)) reasons.push('payment_unknown_invoice')
    if (payment.amount_cents === 0) reasons.push('zero_payment')
    if (reasons.length > 0) {
      rejected.push({ file: 'payments', line: payment.line, reasons })
      continue
    }
    if (!paymentsBy.has(payment.invoiceNumber)) paymentsBy.set(payment.invoiceNumber, [])
    paymentsBy.get(payment.invoiceNumber).push(payment)
  }

  const rows = []
  let payerDiffers = 0
  for (const [number, invoice] of headers) {
    const own = linesBy.get(number) ?? []
    if (own.length === 0) {
      rejected.push({ file: 'invoices', line: invoice.line, reasons: ['invoice_without_lines'] })
      continue
    }
    if (invoice.payer && foldText(invoice.payer) !== foldText(invoice.client)) payerDiffers += 1
    const paid = paymentsBy.get(number) ?? []
    const professional = (label) => {
      const hit = label ? professionalFor(label) : null
      return hit && !hit.excluded ? hit.id : null
    }
    rows.push({
      line: invoice.line,
      number,
      month: invoice.date.slice(0, 7),
      total_cents: invoice.total_cents,
      row: {
        gorendezvous_number: number,
        issued_on: invoice.date,
        client_name: invoice.client,
        client_ref: refFor(number),
        subtotal_cents: invoice.subtotal_cents,
        gst_cents: invoice.tps_cents,
        qst_cents: invoice.tvq_cents,
        total_cents: invoice.total_cents,
        lines: own.map((l) => ({
          service_code: codeFor(l),
          description: l.service,
          quantity: l.quantity,
          unit_price_cents: l.unit_price_cents,
          gst_cents: l.tps_cents,
          qst_cents: l.tvq_cents,
          total_cents: l.total_cents,
          professional_id: professional(l.professional ?? invoice.professional),
        })),
        payments: paid.filter((p) => p.amount_cents > 0).map((p) => ({ paid_on: p.date, mode_code: MODE_CODES[p.method] ?? p.method, amount_cents: p.amount_cents })),
        // A refund carries its mode: import_invoice puts it on a payment of that mode first (a
        // negative « Note de crédit » on the imported credit, BI-27).
        refunds: paid.filter((p) => p.amount_cents < 0).map((p) => ({ paid_on: p.date, mode_code: MODE_CODES[p.method] ?? p.method, amount_cents: -p.amount_cents })),
      },
    })
  }
  return { rows, rejected, payerDiffers }
}

/** Invoices and money per month: `[{ month, count, total_cents }]`, oldest first. */
export function byMonth(items) {
  const months = new Map()
  for (const { month, total_cents } of items) {
    const m = months.get(month) ?? { month, count: 0, total_cents: 0 }
    m.count += 1
    m.total_cents += total_cents
    months.set(month, m)
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/** The highest number imported per year (the sequence Facturation continues from). */
export function lastNumbers(numbers) {
  const years = new Map()
  for (const number of numbers) {
    const [year, seq] = number.split('-').map(Number)
    years.set(year, Math.max(years.get(year) ?? 0, seq))
  }
  return [...years].sort((a, b) => a[0] - b[0]).map(([year, last]) => ({ year, last }))
}
