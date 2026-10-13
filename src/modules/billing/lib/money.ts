import { t } from '@/i18n'
import type { InvoiceStatus, LineType } from '../api/invoices'

/**
 * Money as the clinic reads it (fr-CA, a no-break space before the sign; the same forms as
 * Services et tarifs and « Fiscalité »). Amounts are cents from the database: nothing here
 * computes an invoice.
 */
const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `3783` → « 37,83 $ ». */
export const formatCents = (cents: number): string => `${dollars.format(cents / 100)}\u00A0$`

const DOLLARS_INPUT = /^(?:[0-9]+(?:[.,][0-9]{0,2})?|[.,][0-9]{1,2})$/

/** Typed dollars (`175`, `37,83`, `85.00 $`, `1 000`) → cents; null for anything else. */
export function parseDollars(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/\$$/, '')
  if (!DOLLARS_INPUT.test(compact)) return null
  return Math.round(Number(compact.replace(',', '.')) * 100)
}

const V = 'modules.billing.audit.values'
export const statusLabel = (status: InvoiceStatus): string => t(`${V}.invoices.status.${status}`)
export const lineTypeLabel = (type: LineType): string => t(`${V}.invoice_lines.line_type.${type}`)
export const statusVariant = (status: InvoiceStatus): 'outline' | 'success' | 'secondary' =>
  status === 'draft' ? 'outline' : status === 'issued' ? 'success' : 'secondary'
