-- Migration: Convert tax-inclusive prices to pre-tax storage
-- Date: 2026-01-21
--
-- This migration converts prices for categories where tax_included = true
-- (Naturopathie, Coaching professionnel) from tax-inclusive to pre-tax amounts.
--
-- Quebec combined tax rate: TPS (5%) + TVQ (9.975%) = 14.975%
-- Formula: pre_tax = total / 1.14975
--
-- After this migration, ALL prices in service_prices and profession_category_rates
-- are stored as pre-tax amounts. The tax_included flag now means "is taxable"
-- (whether to ADD tax), not "price includes tax".

-- =============================================================================
-- CONVERT SERVICE_PRICES FOR TAX-INCLUDED CATEGORIES
-- =============================================================================

-- Convert Naturopathie prices (currently tax-inclusive)
UPDATE public.service_prices
SET price_cents = ROUND(price_cents / 1.14975)
WHERE profession_category_key = 'naturopathie';

-- Convert Coaching professionnel prices (currently tax-inclusive)
UPDATE public.service_prices
SET price_cents = ROUND(price_cents / 1.14975)
WHERE profession_category_key = 'coaching_professionnel';

-- =============================================================================
-- CONVERT PROFESSION_CATEGORY_RATES FOR TAX-INCLUDED CATEGORIES
-- =============================================================================

-- Convert Naturopathie hourly rate (currently tax-inclusive)
UPDATE public.profession_category_rates
SET hourly_rate_cents = ROUND(hourly_rate_cents / 1.14975)
WHERE profession_category_key = 'naturopathie';

-- Convert Coaching professionnel hourly rate (currently tax-inclusive)
UPDATE public.profession_category_rates
SET hourly_rate_cents = ROUND(hourly_rate_cents / 1.14975)
WHERE profession_category_key = 'coaching_professionnel';

-- =============================================================================
-- UPDATE COLUMN COMMENT TO REFLECT NEW MEANING
-- =============================================================================

COMMENT ON COLUMN public.profession_categories.tax_included IS
  'When true, this category''s services are taxable (TPS+TVQ should be added to pre-tax price). All prices are stored as pre-tax amounts. This flag indicates whether to ADD tax at billing time.';

-- =============================================================================
-- CONVERSION SUMMARY
-- =============================================================================
--
-- Before (tax-inclusive storage):
--   Naturopathie:           $130.00 stored → displays as $130.00 (tax included)
--   Coaching 50 min:        $110.00 stored → displays as $110.00 (tax included)
--   Coaching 30 min:        $70.00 stored  → displays as $70.00 (tax included)
--
-- After (pre-tax storage):
--   Naturopathie:           $113.07 stored → displays as $113.07 + $16.93 tax = $130.00
--   Coaching 50 min:        $95.67 stored  → displays as $95.67 + $14.33 tax = $110.00
--   Coaching 30 min:        $60.88 stored  → displays as $60.88 + $9.12 tax = $70.00
--
-- Hourly rates:
--   Naturopathie:           $156.00/h stored → $135.61/h + tax = $155.91/h
--   Coaching:               $132.00/h stored → $114.79/h + tax = $131.97/h
-- =============================================================================
