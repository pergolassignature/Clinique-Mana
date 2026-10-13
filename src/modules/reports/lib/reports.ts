import { t, type TranslationKey } from '@/i18n'
import { buildCsv, csvMoney, csvNumber, type CsvCell } from '@/shared/lib/csv'
import { formatInClinicTimezone, isCalendarDate, shiftCalendarDay } from '@/shared/lib/timezone'
import type {
  CancellationRow,
  CancellationsReport,
  ConsentsReport,
  FollowUpReport,
  RevenueLineRow,
  RevenueReport,
} from '../api/reports'

const R = 'modules.reports'

const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimals = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 })

/** `17500` → « 175,00 $ ». */
export const formatMoney = (cents: number): string => `${dollars.format(cents / 100)}\u00A0$`

/** `1` → « 1 », `1.5` → « 1,5 ». */
export const formatQuantity = (value: number): string => decimals.format(value)

// -----------------------------------------------------------------------------
// The period (RP-5): from a clinic date to another, a year at most.
// -----------------------------------------------------------------------------
export interface Period {
  from: string
  to: string
}

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`
const lastOfMonth = (day: string) => {
  const [y, m] = day.slice(0, 7).split('-').map(Number) as [number, number]
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return shiftCalendarDay(next, -1)
}

export const PERIOD_PRESETS = ['thisMonth', 'lastMonth', 'thisYear', 'lastYear'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

/** A preset's dates, from the clinic's today. */
export function presetPeriod(preset: PeriodPreset, today: string): Period {
  const year = Number(today.slice(0, 4))
  switch (preset) {
    case 'thisMonth':
      return { from: firstOfMonth(today), to: lastOfMonth(today) }
    case 'lastMonth': {
      const day = shiftCalendarDay(firstOfMonth(today), -1)
      return { from: firstOfMonth(day), to: day }
    }
    case 'thisYear':
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
  }
}

/** The days of a period, both counted. */
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

/** What is wrong with a period, as the database says it (null: fine). */
export function periodError(p: Period): string | null {
  if (!isCalendarDate(p.from) || !isCalendarDate(p.to) || p.to < p.from) return t(`${R}.period.invalid`)
  if (daysBetween(p.from, p.to) > 366) return t(`${R}.period.tooLong`)
  return null
}

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------
const LINE_TYPES = ['service', 'cancellation_fee', 'file_opening', 'adjustment', 'ivac_gap', 'payer_share', 'payer_claim'] as const

/** A line's type in plain French (« Ajustement »), the key itself when unknown. */
export function lineTypeLabel(type: string | null): string {
  if (!type) return ''
  return (LINE_TYPES as readonly string[]).includes(type) ? t(`${R}.lineTypes.${type}` as TranslationKey) : type
}

/** A line or a per-service total: « 10150 · Consultation individuelle 50 min », else its type. */
export function serviceLabel(row: { service_code: number | null; service_name: string | null; line_type: string | null }): string {
  if (row.service_name) return row.service_code ? `${row.service_code} · ${row.service_name}` : row.service_name
  return lineTypeLabel(row.line_type)
}

/** A cancellation's or an absence's reason: « Plus requis », « Absence ». */
export function reasonLabel(row: { kind: 'cancelled' | 'absent'; reason_name: string | null }): string {
  return row.kind === 'absent' ? t(`${R}.cancellations.absent`) : (row.reason_name ?? t(`${R}.cancellations.noReason`))
}

/** « Annulé (moins de 24 h) », « Annulé », « Absent ». */
export function kindLabel(row: { kind: 'cancelled' | 'absent'; late: boolean }): string {
  if (row.kind === 'absent') return t(`${R}.cancellations.kinds.absent`)
  return row.late ? t(`${R}.cancellations.kinds.late`) : t(`${R}.cancellations.kinds.cancelled`)
}

const when = (iso: string) => formatInClinicTimezone(iso, 'yyyy-MM-dd HH:mm')
const fileNumber = (n: number | null) => (n == null ? null : csvNumber(n))

// -----------------------------------------------------------------------------
// CSV (RP-6): built in the browser from the answer, guarded against formulas.
// -----------------------------------------------------------------------------
export function revenueCsv(report: RevenueReport, period: Period): { fileName: string; content: string } {
  const C = `${R}.revenue.columns`
  const fileName = t(`${R}.revenue.fileName`, { view: t(`${R}.revenue.fileViews.${report.view}`), from: period.from, to: period.to })
  if (report.view === 'invoice') {
    const header = [t(`${C}.date`), t(`${C}.number`), t(`${C}.fileNumber`), t(`${C}.client`), t(`${C}.payer`), t(`${C}.professional`),
      t(`${C}.subtotal`), t(`${C}.gst`), t(`${C}.qst`), t(`${C}.total`), t(`${C}.paid`), t(`${C}.balance`)]
    const rows: CsvCell[][] = report.rows.map((r) => [r.issued_on, r.number, fileNumber(r.client_number), r.client_name, r.payer_name,
      r.professional_names, csvMoney(r.subtotal_cents), csvMoney(r.gst_cents), csvMoney(r.qst_cents), csvMoney(r.total_cents),
      csvMoney(r.paid_cents), csvMoney(r.balance_cents)])
    return { fileName, content: buildCsv(header, rows) }
  }
  if (report.view === 'service') {
    const header = [t(`${C}.date`), t(`${C}.number`), t(`${C}.fileNumber`), t(`${C}.client`), t(`${C}.professional`), t(`${C}.code`),
      t(`${C}.service`), t(`${C}.description`), t(`${C}.quantity`), t(`${C}.unitPrice`), t(`${C}.subtotal`), t(`${C}.gst`), t(`${C}.qst`),
      t(`${C}.total`)]
    const rows: CsvCell[][] = report.rows.map((r: RevenueLineRow) => [r.issued_on, r.number, fileNumber(r.client_number), r.client_name,
      r.professional_name, r.service_code == null ? null : csvNumber(r.service_code), r.service_name ?? lineTypeLabel(r.line_type),
      r.description, csvNumber(r.quantity), r.unit_price_cents == null ? null : csvMoney(r.unit_price_cents), csvMoney(r.subtotal_cents),
      csvMoney(r.gst_cents), csvMoney(r.qst_cents), csvMoney(r.total_cents)])
    return { fileName, content: buildCsv(header, rows) }
  }
  const header = [t(`${C}.date`), t(`${C}.number`), t(`${C}.fileNumber`), t(`${C}.client`), t(`${C}.payer`), t(`${C}.mode`),
    t(`${C}.amount`), t(`${C}.reference`)]
  const rows: CsvCell[][] = report.rows.map((r) => [r.paid_on, r.number, fileNumber(r.client_number), r.client_name, r.payer_name,
    r.mode_name, csvMoney(r.amount_cents), r.reference])
  return { fileName, content: buildCsv(header, rows) }
}

export function cancellationsCsv(report: CancellationsReport, period: Period): { fileName: string; content: string } {
  const C = `${R}.cancellations.columns`
  const header = [t(`${C}.date`), t(`${C}.fileNumber`), t(`${C}.client`), t(`${C}.professional`), t(`${C}.service`), t(`${C}.kind`),
    t(`${C}.reason`), t(`${C}.cancelledAt`), t(`${C}.next`)]
  const rows: CsvCell[][] = report.rows.map((r: CancellationRow) => [when(r.starts_at), fileNumber(r.client_number), r.client_name,
    r.professional_name, r.service_name, kindLabel(r), r.kind === 'absent' ? null : reasonLabel(r),
    r.cancelled_at ? when(r.cancelled_at) : null, r.later_starts_at ? when(r.later_starts_at) : t(`${R}.cancellations.nothingAfter`)])
  return { fileName: t(`${R}.cancellations.fileName`, { from: period.from, to: period.to }), content: buildCsv(header, rows) }
}

export function followUpCsv(report: FollowUpReport, period: Period): { fileName: string; content: string } {
  const C = `${R}.followUp.columns`
  const header = [t(`${C}.date`), t(`${C}.fileNumber`), t(`${C}.client`), t(`${C}.kind`), t(`${C}.reason`), t(`${C}.professional`),
    t(`${C}.service`), t(`${C}.events`)]
  const rows: CsvCell[][] = report.rows.map((r) => [when(r.starts_at), fileNumber(r.client_number), r.client_name, kindLabel(r),
    r.kind === 'absent' ? null : reasonLabel(r), r.professional_name, r.service_name, csvNumber(r.events)])
  return { fileName: t(`${R}.followUp.fileName`, { from: period.from, to: period.to }), content: buildCsv(header, rows) }
}

/** « 2026-09 » → « septembre 2026 ». */
export function monthLabel(month: string): string {
  return formatInClinicTimezone(`${month}-15T12:00:00Z`, 'MMMM yyyy')
}

/** « 4,5 jours ». */
export const daysLabel = (days: number): string => t(`${R}.consents.days`, { days: decimals.format(days) })

/** The consents report as a CSV: the states per consent (what the clinic has today). */
export function consentsCsv(report: ConsentsReport, period: Period): { fileName: string; content: string } {
  const C = `${R}.consents.columns`
  const header = [t(`${C}.consent`), t(`${C}.signed`), t(`${C}.resign`), t(`${C}.pending`), t(`${C}.overdue`), t(`${C}.withdrawn`), t(`${C}.none`)]
  const rows: CsvCell[][] = report.gaps.map((g) => [g.consent_name, csvNumber(g.signed), csvNumber(g.resign), csvNumber(g.pending),
    csvNumber(g.overdue), csvNumber(g.withdrawn), csvNumber(g.none)])
  return { fileName: t(`${R}.consents.fileName`, { from: period.from, to: period.to }), content: buildCsv(header, rows) }
}
