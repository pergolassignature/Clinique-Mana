// The « Revenus » exports (Facturation → Revenus → Exporter, three views: par facture, par
// service-produit, par paiement; tour notes §5, §11, §18) → invoice, line and payment records for
// I3. GOrendezvous exports only invoices that are not cancelled (QuickBooks holds the rest).
//
// The exact headers are not documented: the aliases below are the labels GOrendezvous shows on
// screen, in French and English; the first real export confirms them (decision I-2). A missing
// required column refuses the file with its name.
import { readTable } from './table.mjs'
import { foldText, normalizeName, parseDateOnly, parseMoneyCents } from './normalize.mjs'

/** An invoice number as GOrendezvous writes it: « [yyyy]-[7] » (2026-0001234). */
export const INVOICE_NUMBER = /^[0-9]{4}-[0-9]{1,9}$/

const DATE = ['Date', 'Date de facture', 'Date de facturation', 'Invoice Date']
const INVOICE = ['Facture', 'N° de facture', 'No de facture', 'Numéro de facture', 'Invoice', 'Invoice Number', 'Invoice #']
const CLIENT = ['Client', 'Nom du client', 'Client Name']
const PROFESSIONAL = ['Professionnel', 'Professionnelle', 'Employé', 'Intervenant', 'Staff', 'Professional', 'Employee']
const TPS = ['TPS', 'GST']
const TVQ = ['TVQ', 'QST', 'PST']
const TOTAL = ['Total', 'Total TTC', 'Montant total', 'Total Amount']

export const INVOICE_COLUMNS = {
  date: DATE,
  invoiceNumber: INVOICE,
  client: CLIENT,
  professional: PROFESSIONAL,
  subtotal: ['Sous-total', 'Sous total', 'Subtotal'],
  tps: TPS,
  tvq: TVQ,
  total: TOTAL,
  paid: ['Payé', 'Montant payé', 'Paid'],
  balance: ['Solde', 'Balance', 'Solde dû'],
  payer: ['Payé par', 'Payeur', 'Paid by', 'Payer'],
}
export const LINE_COLUMNS = {
  date: DATE,
  invoiceNumber: INVOICE,
  client: CLIENT,
  professional: PROFESSIONAL,
  service: ['Service', 'Service / Produit', 'Service-produit', 'Produit', 'Item', 'Service/Product'],
  serviceCode: ['Code', 'Code du service', 'Service Code'],
  quantity: ['Quantité', 'Qté', 'Quantity', 'Qty'],
  unitPrice: ['Prix', 'Prix unitaire', 'Unit Price', 'Price'],
  discount: ['Rabais', 'Escompte', 'Discount'],
  tps: TPS,
  tvq: TVQ,
  total: TOTAL,
}
export const PAYMENT_COLUMNS = {
  date: ['Date', 'Date du paiement', 'Payment Date'],
  invoiceNumber: INVOICE,
  client: CLIENT,
  method: ['Mode de paiement', 'Mode', 'Méthode de paiement', 'Payment Method', 'Method'],
  amount: ['Montant', 'Montant payé', 'Amount'],
  reference: ['Référence', 'Reference', 'Note'],
}

/**
 * GOrendezvous's payment methods (tour notes §5, §18) → the method Facturation records. « Argent
 * comptant » is how the clinic recorded card payments taken through QuickBooks Payments (Christine,
 * answer 6; R-57): imported as card. A method not listed rejects the payment (`unknown_payment_method`).
 */
export const PAYMENT_METHODS = {
  'argent comptant': 'card_qbo_payments',
  'carte de credit': 'card_qbo_payments',
  interac: 'interac',
  'virement interac': 'interac',
  stripe: 'card_stripe',
  'note de credit': 'credit_note',
  cheque: 'cheque',
  'virement bancaire': 'bank_transfer',
  'acces d': 'bank_transfer',
}

/** A method label → its key, or null when it is not one the import knows. */
export const mapPaymentMethod = (label) => PAYMENT_METHODS[foldText(label).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()] ?? null

export const REVENUE_REASON_LABELS = {
  invalid_date: 'date illisible',
  invalid_invoice_number: 'numéro de facture illisible (attendu AAAA-N)',
  invalid_amount: 'montant illisible',
  missing_client: 'client manquant',
  unknown_payment_method: 'mode de paiement inconnu',
  totals_mismatch: 'sous-total + taxes ≠ total',
  invalid_quantity: 'quantité illisible',
}

/** Money cells: an empty optional one is 0, a filled unreadable one a rejection reason. */
function money(row, field, reasons, { required = false } = {}) {
  const cell = row.get(field)
  if (cell === '') {
    if (required) reasons.push('invalid_amount')
    return required ? null : 0
  }
  const cents = parseMoneyCents(cell)
  if (cents === null && !reasons.includes('invalid_amount')) reasons.push('invalid_amount')
  return cents
}

function common(row, reasons) {
  const date = parseDateOnly(row.get('date'))
  if (!date) reasons.push('invalid_date')
  const invoiceNumber = row.get('invoiceNumber')
  if (invoiceNumber !== '' && !INVOICE_NUMBER.test(invoiceNumber)) reasons.push('invalid_invoice_number')
  const client = normalizeName(row.get('client'))
  return { date, invoiceNumber: invoiceNumber || null, client }
}

/** « par facture » → `{ invoices, rejected }`; the totals are checked (sous-total + TPS + TVQ = total, when the sub-total is there). */
export function readInvoices(text) {
  const { rows } = readTable(text, { columns: INVOICE_COLUMNS, required: ['date', 'invoiceNumber', 'total'] })
  const invoices = []
  const rejected = []
  for (const row of rows) {
    const reasons = []
    const base = common(row, reasons)
    if (!base.invoiceNumber) reasons.push('invalid_invoice_number')
    if (!base.client) reasons.push('missing_client')
    const subtotal = row.get('subtotal') === '' ? null : money(row, 'subtotal', reasons)
    const tps = money(row, 'tps', reasons)
    const tvq = money(row, 'tvq', reasons)
    const total = money(row, 'total', reasons, { required: true })
    if (subtotal !== null && total !== null && tps !== null && tvq !== null && subtotal + tps + tvq !== total) reasons.push('totals_mismatch')
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons: [...new Set(reasons)] })
      continue
    }
    invoices.push({
      line: row.line,
      ...base,
      professional: row.get('professional') || null,
      subtotal_cents: subtotal,
      tps_cents: tps,
      tvq_cents: tvq,
      total_cents: total,
      paid_cents: row.get('paid') === '' ? null : parseMoneyCents(row.get('paid')),
      balance_cents: row.get('balance') === '' ? null : parseMoneyCents(row.get('balance')),
      payer: row.get('payer') || null,
    })
  }
  return { invoices, rejected }
}

/** « par service-produit » → `{ lines, rejected }`. */
export function readInvoiceLines(text) {
  const { rows } = readTable(text, { columns: LINE_COLUMNS, required: ['date', 'invoiceNumber', 'service', 'total'] })
  const lines = []
  const rejected = []
  for (const row of rows) {
    const reasons = []
    const base = common(row, reasons)
    if (!base.invoiceNumber) reasons.push('invalid_invoice_number')
    let quantity = 1
    if (row.get('quantity') !== '') {
      quantity = Number(row.get('quantity').replace(',', '.'))
      if (!Number.isFinite(quantity) || quantity <= 0) reasons.push('invalid_quantity')
    }
    const unitPrice = row.get('unitPrice') === '' ? null : money(row, 'unitPrice', reasons)
    const discount = money(row, 'discount', reasons)
    const tps = money(row, 'tps', reasons)
    const tvq = money(row, 'tvq', reasons)
    const total = money(row, 'total', reasons, { required: true })
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons: [...new Set(reasons)] })
      continue
    }
    lines.push({
      line: row.line,
      ...base,
      professional: row.get('professional') || null,
      service: row.get('service'),
      service_code: /^[0-9]{5}$/.test(row.get('serviceCode')) ? row.get('serviceCode') : null,
      quantity,
      unit_price_cents: unitPrice,
      discount_cents: discount,
      tps_cents: tps,
      tvq_cents: tvq,
      total_cents: total,
      taxed: (tps ?? 0) + (tvq ?? 0) !== 0,
    })
  }
  return { lines, rejected }
}

/** « par paiement » → `{ payments, rejected }`; a refund is a negative amount. */
export function readPayments(text) {
  const { rows } = readTable(text, { columns: PAYMENT_COLUMNS, required: ['date', 'method', 'amount'] })
  const payments = []
  const rejected = []
  for (const row of rows) {
    const reasons = []
    const base = common(row, reasons)
    const method = mapPaymentMethod(row.get('method'))
    if (!method) reasons.push('unknown_payment_method')
    const amount = money(row, 'amount', reasons, { required: true })
    if (reasons.length > 0) {
      rejected.push({ line: row.line, reasons: [...new Set(reasons)], ...(!method && { methodLabel: row.get('method') }) })
      continue
    }
    payments.push({
      line: row.line,
      ...base,
      method,
      method_label: row.get('method'),
      amount_cents: amount,
      refund: amount < 0,
    })
  }
  return { payments, rejected }
}
