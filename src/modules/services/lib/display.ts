import { t } from '@/i18n'
import type { RateVariantRow, Service } from '../api/parse'
import type { DiscountKind, FeeMode, GridDuration, PriceSource, RateVariant, ServiceKind, TaxRule } from './constants'
import { formatCents, formatPercent } from './format'

/** The module's words for its stored codes (the same ones the Journal d'audit reads). */

export const kindLabel = (kind: ServiceKind): string => t(`modules.services.audit.values.services.kind.${kind}`)
export const priceSourceLabel = (source: PriceSource): string => t(`modules.services.audit.values.services.price_source.${source}`)
export const taxRuleLabel = (rule: TaxRule): string => t(`modules.services.audit.values.services.tax_rule.${rule}`)
export const variantLabel = (variant: RateVariant): string => t(`modules.services.audit.values.service_rate_variants.variant.${variant}`)
export const discountKindLabel = (kind: DiscountKind): string => t(`modules.services.audit.values.service_rate_variants.discount_kind.${kind}`)
export const feeModeLabel = (mode: FeeMode): string => t(`modules.services.audit.values.billing_policies.fee_mode.${mode}`)

/** « 60 min (couple ou famille) », « 50 min », « 30 min »: the retention grids' columns. */
export function gridDurationLabel(duration: GridDuration): string {
  return duration === 60 ? t('modules.services.display.grid60') : t('modules.services.display.gridMinutes', { minutes: String(duration) })
}

/** « 50 min », « 50 min + 10 min de pause » (with the pause after), « Aucune » for a service without a slot. */
export function durationLabel(service: Pick<Service, 'durationMinutes' | 'bufferAfterMinutes'>): string {
  if (service.durationMinutes === 0) return t('modules.services.display.noDuration')
  const base = t('modules.services.display.minutes', { minutes: String(service.durationMinutes) })
  return service.bufferAfterMinutes > 0 ? t('modules.services.display.withBuffer', { base, buffer: String(service.bufferAfterMinutes) }) : base
}

/** What the catalogue says of a price: « Selon la grille (50 min) », « 37,83 $ », « Gratuit », « Saisi à la facture ». */
export function priceSummary(service: Pick<Service, 'priceSource' | 'fixedPriceCents' | 'gridDuration'>): string {
  switch (service.priceSource) {
    case 'grid':
      return service.gridDuration === null ? priceSourceLabel('grid') : t('modules.services.display.gridPrice', { duration: gridDurationLabel(service.gridDuration) })
    case 'fixed':
      return service.fixedPriceCents === null ? priceSourceLabel('fixed') : formatCents(service.fixedPriceCents)
    case 'free':
      return priceSourceLabel('free')
    default:
      return priceSourceLabel('entered')
  }
}

/** « 120,00 $ », « −25,00 $ », « −20 % »: a variant's discount as a short figure. */
export function discountLabel(variant: Pick<RateVariantRow, 'discountKind' | 'amountCents' | 'percent'>): string {
  if (variant.discountKind === 'percent') return variant.percent === null ? '' : `−${formatPercent(variant.percent)}`
  if (variant.amountCents === null) return ''
  return variant.discountKind === 'amount' ? `−${formatCents(variant.amountCents)}` : formatCents(variant.amountCents)
}

/** « 10 · Individuel »: a family's heading. */
export const familyHeading = (family: { code: number; name: string }): string => `${family.code} · ${family.name}`
