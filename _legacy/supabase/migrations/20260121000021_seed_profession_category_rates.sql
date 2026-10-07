-- Migration: Seed profession_category_rates for hourly billing
-- Date: 2026-01-21
--
-- Hourly rates are derived from 50-min session prices:
--   hourly_rate = (50_min_price / 50) * 60
--
-- Example: Psychologie $160/50min → $192/hour

INSERT INTO public.profession_category_rates (profession_category_key, hourly_rate_cents, currency)
VALUES
  -- Psychologie: $160/50min → $192/hour
  ('psychologie', 19200, 'CAD'),
  -- Psychothérapie: $160/50min → $192/hour
  ('psychotherapie', 19200, 'CAD'),
  -- Sexologie: $130/50min → $156/hour
  ('sexologie', 15600, 'CAD'),
  -- Travail social: $110/50min → $132/hour
  ('travail_social', 13200, 'CAD'),
  -- Orientation: $130/50min → $156/hour
  ('orientation', 15600, 'CAD'),
  -- Psychoéducation: $130/50min → $156/hour
  ('psychoeducation', 15600, 'CAD'),
  -- Naturopathie: $130/50min → $156/hour (tax included)
  ('naturopathie', 15600, 'CAD'),
  -- Coaching: $110/50min → $132/hour (tax included)
  ('coaching_professionnel', 13200, 'CAD')
ON CONFLICT (profession_category_key) DO UPDATE SET
  hourly_rate_cents = EXCLUDED.hourly_rate_cents,
  updated_at = now();
