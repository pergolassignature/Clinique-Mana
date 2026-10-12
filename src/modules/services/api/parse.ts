import { z } from 'zod'
import { DISCOUNT_KINDS, FEE_MODES, GRID_DURATIONS, PRICE_SOURCES, RATE_VARIANTS, SERVICE_KINDS, TAX_RULES } from '../lib/constants'

/**
 * Zod parsers of the module's table and RPC payloads, mapped to camelCase domain types. Each
 * payload is checked once here, so the pages read plain types; objects drop unknown keys, so a
 * column a later batch adds never breaks an older page. Enumerations mirror the SQL checks
 * (`../lib/constants`).
 */

/** The only message of a parse failure: the error boundary reports it, so it holds no row value. */
export const UNEXPECTED_SHAPE = 'services: unexpected RPC shape'

/** Parses a payload, throwing UNEXPECTED_SHAPE (never Zod's issues, which quote values) on a mismatch. */
export function parseRpc<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(UNEXPECTED_SHAPE)
  return result.data
}

const gridDuration = z.union([z.literal(60), z.literal(50), z.literal(30)])

export const familyPayload = z
  .object({ id: z.string(), code: z.number().int(), name: z.string(), sort_order: z.number().int() })
  .transform((r) => ({ id: r.id, code: r.code, name: r.name, sortOrder: r.sort_order }))
export type ServiceFamily = z.output<typeof familyPayload>

export const servicePayload = z
  .object({
    id: z.string(),
    family_id: z.string(),
    code: z.number().int(),
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    kind: z.enum(SERVICE_KINDS),
    duration_minutes: z.number().int(),
    buffer_after_minutes: z.number().int(),
    for_two: z.boolean(),
    price_source: z.enum(PRICE_SOURCES),
    fixed_price_cents: z.number().int().nullable(),
    grid_duration: gridDuration.nullable(),
    tax_rule: z.enum(TAX_RULES),
    colour: z.string().nullable(),
    is_active: z.boolean(),
    sort_order: z.number().int(),
    updated_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    familyId: r.family_id,
    code: r.code,
    key: r.key,
    name: r.name,
    description: r.description,
    kind: r.kind,
    durationMinutes: r.duration_minutes,
    /** The « pause après »: a 50 min session books 60 (R-13). */
    bufferAfterMinutes: r.buffer_after_minutes,
    forTwo: r.for_two,
    priceSource: r.price_source,
    fixedPriceCents: r.fixed_price_cents,
    /** The retention grid's column a `grid` service reads (null otherwise). */
    gridDuration: r.grid_duration,
    taxRule: r.tax_rule,
    colour: r.colour,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  }))
export type Service = z.output<typeof servicePayload>

export const serviceTitlePayload = z
  .object({ service_id: z.string(), profession_title_id: z.string() })
  .transform((r) => ({ serviceId: r.service_id, titleId: r.profession_title_id }))

export const variantPayload = z
  .object({
    id: z.string(),
    service_id: z.string(),
    variant: z.enum(RATE_VARIANTS),
    profession_title_id: z.string().nullable(),
    discount_kind: z.enum(DISCOUNT_KINDS),
    amount_cents: z.number().int().nullable(),
    percent: z.number().nullable(),
    effective_from: z.string(),
    effective_to: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    serviceId: r.service_id,
    variant: r.variant,
    /** The title the rate is for, null for every title. */
    titleId: r.profession_title_id,
    discountKind: r.discount_kind,
    /** The variant's own price (`price`) or the amount taken off (`amount`), in cents. */
    amountCents: r.amount_cents,
    percent: r.percent,
    effectiveFrom: r.effective_from,
    /** Exclusive; null while the row is open. */
    effectiveTo: r.effective_to,
    createdAt: r.created_at,
  }))
export type RateVariantRow = z.output<typeof variantPayload>

export const policyPayload = z
  .object({
    id: z.string(),
    effective_from: z.string(),
    effective_to: z.string().nullable(),
    late_notice_hours: z.number().int(),
    first_fee_percent: z.number(),
    next_fee_percent: z.number(),
    file_opening_service_id: z.string().nullable(),
    fee_mode: z.enum(FEE_MODES),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    lateNoticeHours: r.late_notice_hours,
    firstFeePercent: r.first_fee_percent,
    nextFeePercent: r.next_fee_percent,
    fileOpeningServiceId: r.file_opening_service_id,
    feeMode: r.fee_mode,
    createdAt: r.created_at,
  }))
export type BillingPolicy = z.output<typeof policyPayload>

/** A profession title of the Professionnels catalogue (`profession_titles_catalog`): active rows only. */
export const titlePayload = z
  .object({ id: z.string(), key: z.string(), name: z.string(), sort_order: z.number().int() })
  .transform((r) => ({ id: r.id, key: r.key, name: r.name, sortOrder: r.sort_order }))
export type ProfessionTitle = z.output<typeof titlePayload>

/**
 * One row of `list_service_prices`: a grid service's price for one title, or a title-less row
 * for a service whose price does not depend on the title. `priceCents` null: typed on the
 * invoice (`entered`), or no grid in force (« À confirmer »).
 */
export const pricePayload = z
  .object({
    service_id: z.string(),
    title_id: z.string().nullable(),
    price_cents: z.number().int().nullable(),
    student_price_cents: z.number().int().nullable(),
    reduced_price_cents: z.number().int().nullable(),
    tax_rule: z.enum(TAX_RULES),
    source: z.enum(PRICE_SOURCES),
  })
  .transform((r) => ({
    serviceId: r.service_id,
    titleId: r.title_id,
    priceCents: r.price_cents,
    studentPriceCents: r.student_price_cents,
    reducedPriceCents: r.reduced_price_cents,
    taxRule: r.tax_rule,
    source: r.source,
  }))
export type ServicePrice = z.output<typeof pricePayload>

/** `GRID_DURATIONS` as the parser types them. */
export type { GridDuration } from '../lib/constants'
export { GRID_DURATIONS }
