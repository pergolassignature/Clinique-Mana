/**
 * The module's enumerations, mirroring the SQL checks of `*_services_module.sql`. Identifiers
 * are English; the French words are in the i18n (`modules.services.*`).
 */

/** `services.kind`: a consultation, a short call, a fee, a workshop, an administrative service. */
export const SERVICE_KINDS = ['session', 'call', 'fee', 'workshop', 'admin'] as const
export type ServiceKind = (typeof SERVICE_KINDS)[number]

/**
 * `services.price_source`: the retention grid of the professional's title (`grid`), a fixed
 * amount, free, or an amount typed on the invoice line (`entered`, R-41).
 */
export const PRICE_SOURCES = ['grid', 'fixed', 'free', 'entered'] as const
export type PriceSource = (typeof PRICE_SOURCES)[number]

/** The retention grids' columns (60 min couple or family, 50 min, 30 min). */
export const GRID_DURATIONS = [60, 50, 30] as const
export type GridDuration = (typeof GRID_DURATIONS)[number]

/** `services.tax_rule` (R-64: the list confirmed by Christine; the client's exemption is passed in). */
export const TAX_RULES = ['exempt', 'taxable'] as const
export type TaxRule = (typeof TAX_RULES)[number]

/** `service_rate_variants.variant` (R-5). */
export const RATE_VARIANTS = ['student', 'reduced'] as const
export type RateVariant = (typeof RATE_VARIANTS)[number]

/** `service_rate_variants.discount_kind`: the variant's own price, an amount off, a percent off. */
export const DISCOUNT_KINDS = ['price', 'amount', 'percent'] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]

/** `billing_policies.fee_mode` (R-37, R-59): proposed and decided by the professional, or automatic. */
export const FEE_MODES = ['confirm', 'automatic'] as const
export type FeeMode = (typeof FEE_MODES)[number]

/** The audit source of the catalogue seed (`private.seed_services_catalogue`). */
export const SEED_SOURCE = 'seed:services_catalogue'
