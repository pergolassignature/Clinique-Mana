import { describe, expect, it } from 'vitest'
import type { PayoutExportRow, PayoutLine } from '../api/payroll'
import {
  exportCsv,
  formatPay,
  formatRetention,
  invoiceDateError,
  monthFromParam,
  monthTitle,
  nextMonth,
  parseAdjustment,
  previousMonth,
  subtotalsByKind,
} from './payroll'

const line = (over: Partial<PayoutLine>): PayoutLine => ({
  id: 'l',
  kind: 'session',
  occurred_on: '2026-09-03',
  paid_on: null,
  client_id: null,
  client_name: null,
  client_number: null,
  service_code: null,
  service_name: null,
  duration: null,
  base_cents: null,
  retention_pct: null,
  amount_cents: 1000,
  pricing: 'grid',
  note: null,
  late: false,
  ...over,
})

describe('payroll display', () => {
  it('money and rates in French', () => {
    expect(formatPay(71100)).toMatch(/^711,00\s\$$/)
    expect(formatPay(-4500)).toMatch(/^[-−]45,00\s\$$/)
    expect(formatRetention(27.5)).toMatch(/^27,5\s%$/)
    expect(formatRetention(28)).toMatch(/^28\s%$/)
  })

  it('an adjustment typed in dollars, signed, never zero', () => {
    expect(parseAdjustment('45')).toBe(4500)
    expect(parseAdjustment('-12,50 $')).toBe(-1250)
    expect(parseAdjustment('−12.5')).toBe(-1250)
    expect(parseAdjustment('0')).toBeNull()
    expect(parseAdjustment('abc')).toBeNull()
    expect(parseAdjustment('')).toBeNull()
  })

  it('months', () => {
    expect(monthFromParam('2026-11')).toBe('2026-11-01')
    expect(monthFromParam('2026-13')).toBeNull()
    expect(monthFromParam(null)).toBeNull()
    expect(previousMonth('2026-01-01')).toBe('2025-12-01')
    expect(nextMonth('2026-12-01')).toBe('2027-01-01')
    expect(nextMonth('2026-02-01')).toBe('2026-03-01')
    expect(monthTitle('2026-11-01')).toBe('Novembre 2026')
  })

  it('subtotals per kind, in order, an unpriced line counted for nothing', () => {
    const rows = subtotalsByKind([
      line({ kind: 'adjustment', amount_cents: -500 }),
      line({ amount_cents: 12600 }),
      line({ amount_cents: null, pricing: 'no_rate' }),
      line({ kind: 'other_fees', amount_cents: 8500 }),
    ])
    expect(rows).toEqual([
      { kind: 'session', count: 2, cents: 12600 },
      { kind: 'other_fees', count: 1, cents: 8500 },
      { kind: 'adjustment', count: 1, cents: -500 },
    ])
  })

  it('the invoice date: from the month\'s 1st to today', () => {
    expect(invoiceDateError('2026-10-01', '2026-09-01', '2026-10-13')).toBeNull()
    expect(invoiceDateError('2026-08-31', '2026-09-01', '2026-10-13')).not.toBeNull()
    expect(invoiceDateError('2026-10-14', '2026-09-01', '2026-10-13')).not.toBeNull()
    expect(invoiceDateError('', '2026-09-01', '2026-10-13')).not.toBeNull()
  })

  it('the QuickBooks export: semicolons, a decimal comma, quotes when needed, a BOM', () => {
    const rows: PayoutExportRow[] = [
      { period_id: 'p', professional_name: 'Pro; Un', specialty: 'Psychologue', invoice_number: '2026-09', issued_on: '2026-10-01', amount_cents: 71100, state: 'paid', paid_on: '2026-10-05' },
    ]
    const csv = exportCsv(rows)
    expect(csv.startsWith('﻿')).toBe(true)
    const [, data] = csv.slice(1).trim().split('\r\n')
    expect(data).toBe('Psychologue;"Pro; Un";2026-09;2026-10-01;711,00;Versée;2026-10-05')
  })
})
