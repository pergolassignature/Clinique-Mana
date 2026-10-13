import { t } from '@/i18n'
import { csvField } from '@/shared/lib/csv'
import { formatDateOnly, getClinicDateString, shiftCalendarDay } from '@/shared/lib/timezone'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { LineKind, PayoutExportRow, PayoutLine, PayoutPeriodRow, PayoutRule, PayoutState, Pricing } from '../api/payroll'

const P = 'modules.billing.payroll'

const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percent = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 })

/** `71100` → « 711,00 $ »; a negative adjustment « −45,00 $ ». */
export function formatPay(cents: number): string {
  return `${dollars.format(cents / 100)}\u00A0$`
}

/** `28` → « 28 % », `27.5` → « 27,5 % ». */
export function formatRetention(pct: number): string {
  return `${percent.format(pct)}\u00A0%`
}

const SIGNED_DOLLARS = /^[-−]?(?:[0-9]+(?:[.,][0-9]{0,2})?|[.,][0-9]{1,2})$/

/** An adjustment typed in dollars (`45`, `-12,50`, `−12.50 $`) → cents, never 0; null otherwise. */
export function parseAdjustment(input: string): number | null {
  const compact = input.replace(/[\s\u00A0\u202F]/g, '').replace(/\$$/, '')
  if (!SIGNED_DOLLARS.test(compact)) return null
  const negative = compact.startsWith('-') || compact.startsWith('−')
  const cents = Math.round(Number(compact.replace(/^[-−]/, '').replace(',', '.')) * 100)
  if (!Number.isFinite(cents) || cents === 0 || cents > 10_000_000) return null
  return negative ? -cents : cents
}

/** « novembre 2026 ». */
export const monthLabel = (month: string): string => formatDateOnly(month, 'MMMM yyyy')
/** « Novembre 2026 » (a heading or the first word of a cell). */
export const monthTitle = (month: string): string => {
  const label = monthLabel(month)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** `2026-11-01` ↔ `2026-11` (the page's `?mois=`). */
export const monthParam = (month: string): string => month.slice(0, 7)
export function monthFromParam(value: string | null): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null
  return `${value}-01`
}

/** The month before `month` (`2026-11-01` → `2026-10-01`). */
export const previousMonth = (month: string): string => `${shiftCalendarDay(month, -1).slice(0, 7)}-01`
export const nextMonth = (month: string): string => `${shiftCalendarDay(month, 31).slice(0, 7)}-01`

/** The clinic's current month and the last finished one (the payroll's default). */
export function currentMonth(now: Date = new Date()): string {
  return `${getClinicDateString(now).slice(0, 7)}-01`
}
export const lastFinishedMonth = (now: Date = new Date()): string => previousMonth(currentMonth(now))

/** A period's state in plain French (« À valider », « Versée »…). */
export const stateLabel = (state: PayoutState): string => t(`${P}.states.${state}`)
export function stateTone(state: PayoutState): StatusTone {
  switch (state) {
    case 'draft':
      return 'neutral'
    case 'to_validate':
      return 'info'
    case 'correction_requested':
      return 'warning'
    case 'validated':
      return 'success'
    case 'paid':
      return 'success'
  }
}

/** The state's badge (`Badge` variants). */
export function stateBadgeVariant(state: PayoutState): 'outline' | 'info' | 'warning' | 'success' {
  const tone = stateTone(state)
  return tone === 'neutral' ? 'outline' : tone === 'info' ? 'info' : tone === 'warning' ? 'warning' : 'success'
}

export const kindLabel = (kind: LineKind): string => t(`${P}.kinds.${kind}`)
export const ruleLabel = (rule: PayoutRule): string => t(`${P}.rules.${rule}`)

/** Why a line is not priced (« Taux de départ à fixer »…), or how it is (« Grille », « Entente »). */
export const pricingLabel = (pricing: Pricing): string => t(`${P}.pricing.${pricing}`)
export const isUnpriced = (pricing: Pricing): boolean => pricing === 'no_title' || pricing === 'no_price' || pricing === 'no_rate'

/** What a line is: the service (« 10150 Consultation individuelle 50 min »), else its kind; an adjustment's note. */
export function lineDescription(line: Pick<PayoutLine, 'kind' | 'service_code' | 'service_name' | 'note'>): string {
  if (line.kind === 'adjustment') return line.note ?? kindLabel('adjustment')
  if (line.service_code !== null) return `${line.service_code} ${line.service_name ?? ''}`.trim()
  return kindLabel(line.kind)
}

/** The lines' subtotals per kind, in the order of LINE_KINDS, for the summary under the table. */
export function subtotalsByKind(lines: readonly PayoutLine[]): { kind: LineKind; count: number; cents: number }[] {
  const out = new Map<LineKind, { kind: LineKind; count: number; cents: number }>()
  for (const line of lines) {
    const row = out.get(line.kind) ?? { kind: line.kind, count: 0, cents: 0 }
    row.count += 1
    row.cents += line.amount_cents ?? 0
    out.set(line.kind, row)
  }
  const order: LineKind[] = ['session', 'late_cancellation', 'other_fees', 'workshop', 'adjustment']
  return order.flatMap((kind) => (out.has(kind) ? [out.get(kind)!] : []))
}

/** The month's summary for the administration's header: totals per state. */
export function monthSummary(rows: readonly PayoutPeriodRow[]): { periods: number; totalCents: number; unpriced: number; toSend: number; validated: number; paid: number } {
  return {
    periods: rows.length,
    totalCents: rows.reduce((sum, r) => sum + r.total_cents, 0),
    unpriced: rows.filter((r) => r.unpriced_count > 0).length,
    toSend: rows.filter((r) => (r.state === 'draft' || r.state === 'correction_requested') && r.unpriced_count === 0).length,
    validated: rows.filter((r) => r.state === 'validated').length,
    paid: rows.filter((r) => r.state === 'paid').length,
  }
}

// The CSV's text fields: guarded against formulas (`@/shared/lib/csv`).
export { csvField }

/**
 * The QuickBooks export (« Factures des professionnels »): one row per invoice, classed by
 * specialty, semicolon-separated (Excel fr-CA), amounts with a decimal comma, a BOM for the accents.
 */
export function exportCsv(rows: readonly PayoutExportRow[]): string {
  const header = [t(`${P}.export.columns.specialty`), t(`${P}.export.columns.professional`), t(`${P}.export.columns.number`),
    t(`${P}.export.columns.date`), t(`${P}.export.columns.amount`), t(`${P}.export.columns.state`), t(`${P}.export.columns.paidOn`)]
  const lines = rows.map((r) => [
    r.specialty,
    r.professional_name ?? '',
    r.invoice_number,
    r.issued_on,
    (r.amount_cents / 100).toFixed(2).replace('.', ','),
    stateLabel(r.state),
    r.paid_on ?? '',
  ])
  return '﻿' + [header, ...lines].map((cols) => cols.map(csvField).join(';')).join('\r\n') + '\r\n'
}

/** A professional's own invoice number to suggest: the month (« 2026-11 »). */
export const suggestedInvoiceNumber = (month: string): string => monthParam(month)

/** The invoice date's check: from the month's 1st to the clinic's today. */
export function invoiceDateError(value: string, month: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return t(`${P}.dialogs.invoice.dateRequired`)
  if (value < month || value > today) return t(`${P}.dialogs.invoice.dateRange`)
  return null
}

/** The invoice number's check (1 to 40 characters). */
export function invoiceNumberError(value: string): string | null {
  const v = value.trim()
  if (v === '') return t(`${P}.dialogs.invoice.numberRequired`)
  if (v.length > 40) return t(`${P}.dialogs.invoice.numberTooLong`)
  return null
}
