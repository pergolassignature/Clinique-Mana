-- Migration: Add tax_included flag to profession_categories
-- Date: 2026-01-21
--
-- Context:
-- - Most profession categories offer tax-exempt services (no TPS/TVQ)
-- - Naturopathie and Coaching professionnel are taxable, but prices include tax
-- - This flag indicates whether stored prices already include taxes
--
-- When tax_included = true:
-- - The price_cents in service_prices is the FINAL price (taxes included)
-- - At invoice time, back-calculate: pre_tax = price / 1.14975 (QC combined rate)
-- - Display: "$113.04 + TPS $5.65 + TVQ $11.28 = $130.00"
--
-- When tax_included = false (default):
-- - The price_cents is the base price
-- - No taxes are added (services are tax-exempt for this category)

-- Add the column
ALTER TABLE public.profession_categories
ADD COLUMN IF NOT EXISTS tax_included boolean NOT NULL DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.profession_categories.tax_included IS
  'When true, prices for this category already include TPS+TVQ taxes. When false, prices are tax-exempt.';

-- Set tax_included = true for Naturopathie and Coaching
UPDATE public.profession_categories
SET tax_included = true
WHERE key IN ('naturopathie', 'coaching_professionnel');

-- Verify
-- SELECT key, label_fr, tax_included FROM public.profession_categories ORDER BY key;
