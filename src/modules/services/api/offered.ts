import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { PRICE_SOURCES, TAX_RULES } from '../lib/constants'
import { offeredServices, type OfferedService } from '../lib/offered'
import { fetchServicePrices } from './catalogue'
import { parseRpc } from './parse'

/**
 * « Services offerts » on a professional's record (L26): Services' published reads only
 * (`services_catalog`, `list_service_prices`) and Professionnels' published directory
 * (`professionals_directory`: her titles). `services.view`.
 */

const catalogueRow = z
  .object({
    id: z.string(),
    code: z.number().int(),
    name: z.string(),
    duration_minutes: z.number().int(),
    buffer_after_minutes: z.number().int(),
    for_two: z.boolean(),
    price_source: z.enum(PRICE_SOURCES),
    tax_rule: z.enum(TAX_RULES),
    title_ids: z.array(z.string()).nullable(),
  })
  .transform((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    durationMinutes: r.duration_minutes,
    bufferAfterMinutes: r.buffer_after_minutes,
    forTwo: r.for_two,
    priceSource: r.price_source,
    taxRule: r.tax_rule,
    titleIds: r.title_ids ?? [],
  }))

const directoryRow = z.object({
  primary_title_id: z.string().nullable(),
  professions: z.array(z.object({ title_id: z.string() }).passthrough()).nullable(),
})

/** Her services today (`on`, the clinic's date), or null when the professional is not the clinic's. */
export async function fetchOfferedServices(professionalId: string, on: string): Promise<OfferedService[] | null> {
  const [directory, catalogue, prices] = await Promise.all([
    supabase.from('professionals_directory').select('primary_title_id, professions').eq('id', professionalId).maybeSingle(),
    supabase.from('services_catalog').select('id, code, name, duration_minutes, buffer_after_minutes, for_two, price_source, tax_rule, title_ids').order('code').limit(1000),
    fetchServicePrices(on),
  ])
  if (directory.error) throw directory.error
  if (catalogue.error) throw catalogue.error
  if (!directory.data) return null
  const pro = parseRpc(directoryRow, directory.data)
  return offeredServices(
    parseRpc(z.array(catalogueRow), catalogue.data),
    { primaryTitleId: pro.primary_title_id, titleIds: (pro.professions ?? []).map((p) => p.title_id) },
    prices,
  )
}
