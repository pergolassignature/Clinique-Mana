// src/services-catalog/constants/pricing-models.ts

import type { PricingModel } from '../types'

export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  fixed: 'pages.services.pricing.fixed',
  by_profession_category: 'pages.services.pricing.byCategory',
  rule_cancellation_prorata: 'pages.services.pricing.cancellation',
  by_profession_hourly_prorata: 'pages.services.pricing.hourlyProrata',
}

export const PRICING_MODEL_DESCRIPTIONS: Record<PricingModel, string> = {
  fixed: 'pages.services.pricing.fixedDesc',
  by_profession_category: 'pages.services.pricing.byCategoryDesc',
  rule_cancellation_prorata: 'pages.services.pricing.cancellationDesc',
  by_profession_hourly_prorata: 'pages.services.pricing.hourlyProrataDesc',
}

export const PRICING_MODELS: PricingModel[] = [
  'fixed',
  'by_profession_category',
  'rule_cancellation_prorata',
  'by_profession_hourly_prorata',
]
