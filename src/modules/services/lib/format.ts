/**
 * Money and percents as the clinic reads them (fr-CA, a no-break space before the sign), the
 * same forms as « Fiscalité » and the retention program. Amounts are cents from the database;
 * nothing here computes a price.
 */

const dollars = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `3783` → « 37,83 $ ». */
export function formatCents(cents: number): string {
  return `${dollars.format(cents / 100)}\u00A0$`
}

const percentNumber = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 })

/** `50` → « 50 % », `12.5` → « 12,5 % ». */
export function formatPercent(percent: number): string {
  return `${percentNumber.format(percent)}\u00A0%`
}

const DOLLARS_INPUT = /^(?:[0-9]+(?:[.,][0-9]{0,2})?|[.,][0-9]{1,2})$/

/** Typed dollars (`175`, `37,83`, `85.00 $`, `1 000`) → cents; null for anything else (a third decimal included). */
export function parseDollars(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/\$$/, '')
  if (!DOLLARS_INPUT.test(compact)) return null
  return Math.round(Number(compact.replace(',', '.')) * 100)
}

const PERCENT_INPUT = /^[0-9]+(?:[.,][0-9]{0,2})?$/

/** A typed percent (`50`, `12,5`, `12,5 %`) → the stored value (two decimals); null when it is not a non-negative number. */
export function parsePercent(input: string): number | null {
  const compact = input.replace(/\s/g, '').replace(/%$/, '')
  if (!PERCENT_INPUT.test(compact)) return null
  return Math.round(Number(compact.replace(',', '.')) * 100) / 100
}

/** `12688` → « 126,88 »: a stored amount as the money fields take it (no sign). */
export const centsInput = (cents: number): string => dollars.format(cents / 100).replace(/\s/g, '')

/** `12.5` → « 12,5 »: a stored percent as the percent fields take it. */
export const percentInput = (percent: number): string => percentNumber.format(percent).replace(/\s/g, '')
