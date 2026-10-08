import { z } from 'zod'
import { supabase } from '@/core/supabase/client'

/** The taxes `tax_rates.tax` allows (`check (tax in ('gst', 'qst'))`). */
export const TAXES = ['gst', 'qst'] as const
export type Tax = (typeof TAXES)[number]

export const TAX_RATE_COLUMNS = 'id, tax, rate, effective_from, effective_to, created_at' as const

/**
 * One dated rate. It applies on [effective_from, effective_to): `effective_to` is the first day it
 * no longer applies (null while open). Both are date-only `yyyy-MM-dd` strings: never convert them
 * between timezones. `created_at` is an instant (the 24 h correction window).
 */
const taxRateSchema = z.object({
  id: z.string(),
  // The generated types say `string`; the table's check allows only these two.
  tax: z.enum(TAXES),
  // numeric(7, 6): a JSON number from PostgREST, read as one even if it ever comes as a string.
  rate: z.coerce.number(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  created_at: z.string(),
})
export type TaxRate = z.infer<typeof taxRateSchema>

/** The org's rates (every member reads them), by tax, newest first. */
export async function fetchTaxRates(): Promise<TaxRate[]> {
  const { data, error } = await supabase
    .from('tax_rates')
    .select(TAX_RATE_COLUMNS)
    .order('tax')
    .order('effective_from', { ascending: false })
  if (error) throw error
  return z.array(taxRateSchema).parse(data)
}

/**
 * Adds a rate from `effectiveFrom` (`yyyy-MM-dd`, sent as is) and closes the open one on that day.
 * `rate` is the fraction (`0.1` for 10 %). Resolves with the new id; a refusal the user can fix
 * (rate out of range, date not after the open rate's) is a French `P0001`.
 */
export async function addTaxRate(tax: Tax, rate: number, effectiveFrom: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_tax_rate', { p_tax: tax, p_rate: rate, p_effective_from: effectiveFrom })
  if (error) throw error
  return data
}

/**
 * Deletes the last (open) rate of a tax and reopens the previous one. The database allows it only
 * when the rate is not in force yet or was created less than 24 hours ago, and never on a tax's
 * first rate (`canDeleteTaxRate` mirrors this); otherwise a French `P0001`.
 */
export async function deleteTaxRate(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_tax_rate', { p_id: id })
  if (error) throw error
}

/** The rate of `tax` in force on `date` (`yyyy-MM-dd`), or null when none applies (before the first rate). */
export async function taxRateOn(tax: Tax, date: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('tax_rate_on', { p_tax: tax, p_date: date })
  if (error) throw error
  // Typed `number` by the generator, but SQL returns null when no row matches.
  return (data as number | null) ?? null
}
