import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import type { Database } from '@/core/supabase/database.types'
import type { DiscountKind, FeeMode, GridDuration, PriceSource, RateVariant, ServiceKind, TaxRule } from '../lib/constants'
import {
  familyPayload,
  parseRpc,
  policyPayload,
  pricePayload,
  servicePayload,
  serviceTitlePayload,
  titlePayload,
  variantPayload,
  type BillingPolicy,
  type ProfessionTitle,
  type RateVariantRow,
  type Service,
  type ServiceFamily,
  type ServicePrice,
} from './parse'

/**
 * The settings section's reads (the tables, RLS-scoped to the clinic with `services.view`; the
 * titles through Professionnels' published `profession_titles_catalog`) and the module's RPCs
 * (`services.manage`). Dates are date-only `yyyy-MM-dd` strings (shown with `formatDateOnly*`,
 * never through a timezone); money is cents; every price is computed by the database.
 */

type Functions = Database['public']['Functions']
type RpcArgs<F extends keyof Functions> = Functions[F]['Args']

/** The generator types every uuid and text parameter as non-null; the RPCs take null where SQL allows it. */
function sqlArgs<F extends keyof Functions>(args: { [K in keyof RpcArgs<F>]-?: RpcArgs<F>[K] | null }): RpcArgs<F> {
  return args as RpcArgs<F>
}

/** Rows read per table: the catalogue has ~30 services; the caps only bound the payloads. */
const ROWS_MAX = 500

export interface ServicesSettings {
  families: ServiceFamily[]
  /** Every service, archived ones included, in family then sort order. */
  services: Service[]
  /** The titles offering each service (ids), keyed by service id. */
  titleIdsByService: ReadonlyMap<string, readonly string[]>
  variants: RateVariantRow[]
  policies: BillingPolicy[]
  /** The clinic's active profession titles, in their settings order. */
  titles: ProfessionTitle[]
}

export async function fetchServicesSettings(): Promise<ServicesSettings> {
  const [families, services, serviceTitles, variants, policies, titles] = await Promise.all([
    supabase.from('service_families').select('id, code, name, sort_order').order('sort_order').order('code').limit(ROWS_MAX),
    supabase
      .from('services')
      .select(
        'id, family_id, code, key, name, description, kind, duration_minutes, buffer_after_minutes, for_two, price_source, fixed_price_cents, grid_duration, tax_rule, colour, is_active, sort_order, updated_at',
      )
      .order('sort_order')
      .order('code')
      .limit(ROWS_MAX),
    supabase.from('service_titles').select('service_id, profession_title_id').limit(ROWS_MAX * 10),
    supabase.from('service_rate_variants').select('*').order('effective_from', { ascending: false }).limit(ROWS_MAX),
    supabase.from('billing_policies').select('*').order('effective_from', { ascending: false }).limit(ROWS_MAX),
    supabase.from('profession_titles_catalog').select('id, key, name, sort_order').order('sort_order').order('key').limit(ROWS_MAX),
  ])
  for (const result of [families, services, serviceTitles, variants, policies, titles]) if (result.error) throw result.error

  const titleIdsByService = new Map<string, string[]>()
  for (const link of parseRpc(z.array(serviceTitlePayload), serviceTitles.data)) {
    const ids = titleIdsByService.get(link.serviceId) ?? []
    ids.push(link.titleId)
    titleIdsByService.set(link.serviceId, ids)
  }
  return {
    families: parseRpc(z.array(familyPayload), families.data),
    services: parseRpc(z.array(servicePayload), services.data),
    titleIdsByService,
    variants: parseRpc(z.array(variantPayload), variants.data),
    policies: parseRpc(z.array(policyPayload), policies.data),
    titles: parseRpc(z.array(titlePayload), titles.data),
  }
}

/** Every price of the active catalogue on a date (`list_service_prices`, `services.view`). */
export async function fetchServicePrices(on: string): Promise<ServicePrice[]> {
  const { data, error } = await supabase.rpc('list_service_prices', { p_on: on })
  if (error) throw error
  return parseRpc(z.array(pricePayload), data)
}

// --- Writes (services.manage) --------------------------------------------------------------------

/** What `save_service` takes: `id` null creates; the key, the code and the family are then set once. */
export interface ServiceInput {
  id: string | null
  familyId: string
  code: number
  key: string
  name: string
  description: string | null
  kind: ServiceKind
  durationMinutes: number
  bufferAfterMinutes: number
  forTwo: boolean
  priceSource: PriceSource
  fixedPriceCents: number | null
  gridDuration: GridDuration | null
  taxRule: TaxRule
  colour: string | null
  sortOrder: number
}

/** Creates or updates a service; resolves with its id. Refusals: French `P0001` with a HINT naming the field. */
export async function saveService(input: ServiceInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'save_service',
    sqlArgs<'save_service'>({
      p_id: input.id,
      p_family_id: input.familyId,
      p_code: input.code,
      p_key: input.key,
      p_name: input.name,
      p_description: input.description,
      p_kind: input.kind,
      p_duration_minutes: input.durationMinutes,
      p_buffer_after_minutes: input.bufferAfterMinutes,
      p_for_two: input.forTwo,
      p_price_source: input.priceSource,
      p_fixed_price_cents: input.fixedPriceCents,
      p_grid_duration: input.gridDuration,
      p_tax_rule: input.taxRule,
      p_colour: input.colour,
      p_sort_order: input.sortOrder,
    }),
  )
  if (error) throw error
  return z.string().parse(data)
}

/** Replaces the titles that offer a service (`set_service_titles`). */
export async function setServiceTitles(id: string, titleIds: readonly string[]): Promise<void> {
  const { error } = await supabase.rpc('set_service_titles', { p_id: id, p_title_ids: [...titleIds] })
  if (error) throw error
}

/** Archives (false) or restores (true) a service. */
export async function setServiceActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_service_active', { p_id: id, p_active: active })
  if (error) throw error
}

export interface VariantInput {
  serviceId: string
  variant: RateVariant
  /** Null: every title. */
  titleId: string | null
  discountKind: DiscountKind
  /** For `price` and `amount`. */
  amountCents: number | null
  /** For `percent`. */
  percent: number | null
  effectiveFrom: string
}

/** Appends a dated variant (closes the open one of its series); resolves with its id. */
export async function addRateVariant(input: VariantInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'add_service_rate_variant',
    sqlArgs<'add_service_rate_variant'>({
      p_service_id: input.serviceId,
      p_variant: input.variant,
      p_title_id: input.titleId,
      p_discount_kind: input.discountKind,
      p_amount_cents: input.amountCents,
      p_percent: input.percent,
      p_effective_from: input.effectiveFrom,
    }),
  )
  if (error) throw error
  return z.string().parse(data)
}

/** Ends an open variant on a date (its last day is the day before), or deletes it (null) while the database allows. */
export async function endRateVariant(id: string, effectiveTo: string | null): Promise<void> {
  const { error } = await supabase.rpc('end_service_rate_variant', sqlArgs<'end_service_rate_variant'>({ p_id: id, p_effective_to: effectiveTo }))
  if (error) throw error
}

export interface PolicyInput {
  effectiveFrom: string
  lateNoticeHours: number
  firstFeePercent: number
  nextFeePercent: number
  fileOpeningServiceId: string | null
  feeMode: FeeMode
}

/** Appends a dated policy (closes the open one); resolves with its id. */
export async function addBillingPolicy(input: PolicyInput): Promise<string> {
  const { data, error } = await supabase.rpc(
    'add_billing_policy',
    sqlArgs<'add_billing_policy'>({
      p_effective_from: input.effectiveFrom,
      p_late_notice_hours: input.lateNoticeHours,
      p_first_fee_percent: input.firstFeePercent,
      p_next_fee_percent: input.nextFeePercent,
      p_file_opening_service_id: input.fileOpeningServiceId,
      p_fee_mode: input.feeMode,
    }),
  )
  if (error) throw error
  return z.string().parse(data)
}

/** Deletes the coming policy (the previous one opens again). */
export async function deleteBillingPolicy(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_billing_policy', { p_id: id })
  if (error) throw error
}
