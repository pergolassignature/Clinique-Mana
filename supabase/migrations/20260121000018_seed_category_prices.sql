-- Migration: Seed category prices from pricing sheet
-- Date: 2026-01-21
--
-- Pricing sheet columns:
--   Rencontre 60 min couple = couple_60 services
--   Rencontre 50 min = web_50 / pae_50 / consultation services
--   Rencontre 30 min = web_30 / pae_30 services
--
-- Notes:
--   - "tx incluse" = tax included (Naturopathie, Coaching)
--   - Orientation doesn't offer couple services
--   - Naturopathie only offers 50 min
--   - Psychothérapie uses same rates as Psychologie

-- Clear any existing category prices first (but keep fixed prices)
DELETE FROM public.service_prices
WHERE profession_category_key IS NOT NULL;

-- Insert prices based on the pricing sheet
DO $$
DECLARE
  v_web_30 uuid;
  v_web_50 uuid;
  v_couple_60 uuid;
  v_individuelle_60 uuid;
  v_pae_30 uuid;
  v_pae_50 uuid;
  v_pae_couple uuid;
  v_consultation uuid;
BEGIN
  -- Fetch service IDs by key
  SELECT id INTO v_web_30 FROM public.services WHERE key = 'intervention_web_30';
  SELECT id INTO v_web_50 FROM public.services WHERE key = 'intervention_web_50';
  SELECT id INTO v_couple_60 FROM public.services WHERE key = 'intervention_couple_famille_60';
  SELECT id INTO v_individuelle_60 FROM public.services WHERE key = 'intervention_individuelle_60';
  SELECT id INTO v_pae_30 FROM public.services WHERE key = 'pae_externe_30';
  SELECT id INTO v_pae_50 FROM public.services WHERE key = 'pae_externe_50';
  SELECT id INTO v_pae_couple FROM public.services WHERE key = 'pae_externe_couple';
  SELECT id INTO v_consultation FROM public.services WHERE key = 'service_consultation';

  -- =====================================================
  -- PSYCHOLOGIE (psychologie)
  -- 60 min couple: $185, 50 min: $160, 30 min: $120
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'psychologie', NULL, 12000, 'CAD'),
    (v_web_50, 'psychologie', NULL, 16000, 'CAD'),
    (v_couple_60, 'psychologie', NULL, 18500, 'CAD'),
    (v_individuelle_60, 'psychologie', NULL, 18500, 'CAD'),
    (v_pae_30, 'psychologie', NULL, 12000, 'CAD'),
    (v_pae_50, 'psychologie', NULL, 16000, 'CAD'),
    (v_pae_couple, 'psychologie', NULL, 18500, 'CAD'),
    (v_consultation, 'psychologie', NULL, 16000, 'CAD');

  -- =====================================================
  -- PSYCHOTHERAPIE (psychotherapie) - Same as Psychologie
  -- 60 min couple: $185, 50 min: $160, 30 min: $120
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'psychotherapie', NULL, 12000, 'CAD'),
    (v_web_50, 'psychotherapie', NULL, 16000, 'CAD'),
    (v_couple_60, 'psychotherapie', NULL, 18500, 'CAD'),
    (v_individuelle_60, 'psychotherapie', NULL, 18500, 'CAD'),
    (v_pae_30, 'psychotherapie', NULL, 12000, 'CAD'),
    (v_pae_50, 'psychotherapie', NULL, 16000, 'CAD'),
    (v_pae_couple, 'psychotherapie', NULL, 18500, 'CAD'),
    (v_consultation, 'psychotherapie', NULL, 16000, 'CAD');

  -- =====================================================
  -- SEXOLOGIE (sexologie)
  -- 60 min couple: $155, 50 min: $130, 30 min: $96
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'sexologie', NULL, 9600, 'CAD'),
    (v_web_50, 'sexologie', NULL, 13000, 'CAD'),
    (v_couple_60, 'sexologie', NULL, 15500, 'CAD'),
    (v_individuelle_60, 'sexologie', NULL, 15500, 'CAD'),
    (v_pae_30, 'sexologie', NULL, 9600, 'CAD'),
    (v_pae_50, 'sexologie', NULL, 13000, 'CAD'),
    (v_pae_couple, 'sexologie', NULL, 15500, 'CAD'),
    (v_consultation, 'sexologie', NULL, 13000, 'CAD');

  -- =====================================================
  -- TRAVAIL SOCIAL (travail_social)
  -- 60 min couple: $130, 50 min: $110, 30 min: $80
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'travail_social', NULL, 8000, 'CAD'),
    (v_web_50, 'travail_social', NULL, 11000, 'CAD'),
    (v_couple_60, 'travail_social', NULL, 13000, 'CAD'),
    (v_individuelle_60, 'travail_social', NULL, 13000, 'CAD'),
    (v_pae_30, 'travail_social', NULL, 8000, 'CAD'),
    (v_pae_50, 'travail_social', NULL, 11000, 'CAD'),
    (v_pae_couple, 'travail_social', NULL, 13000, 'CAD'),
    (v_consultation, 'travail_social', NULL, 11000, 'CAD');

  -- =====================================================
  -- ORIENTATION (orientation)
  -- 50 min: $130, 30 min: $96 (NO couple services)
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'orientation', NULL, 9600, 'CAD'),
    (v_web_50, 'orientation', NULL, 13000, 'CAD'),
    (v_pae_30, 'orientation', NULL, 9600, 'CAD'),
    (v_pae_50, 'orientation', NULL, 13000, 'CAD'),
    (v_consultation, 'orientation', NULL, 13000, 'CAD');

  -- =====================================================
  -- PSYCHOEDUCATION (psychoeducation)
  -- 60 min couple: $155, 50 min: $130, 30 min: $96
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'psychoeducation', NULL, 9600, 'CAD'),
    (v_web_50, 'psychoeducation', NULL, 13000, 'CAD'),
    (v_couple_60, 'psychoeducation', NULL, 15500, 'CAD'),
    (v_individuelle_60, 'psychoeducation', NULL, 15500, 'CAD'),
    (v_pae_30, 'psychoeducation', NULL, 9600, 'CAD'),
    (v_pae_50, 'psychoeducation', NULL, 13000, 'CAD'),
    (v_pae_couple, 'psychoeducation', NULL, 15500, 'CAD'),
    (v_consultation, 'psychoeducation', NULL, 13000, 'CAD');

  -- =====================================================
  -- NATUROPATHIE (naturopathie)
  -- Only 50 min: $130 (tx incluse)
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_50, 'naturopathie', NULL, 13000, 'CAD'),
    (v_pae_50, 'naturopathie', NULL, 13000, 'CAD'),
    (v_consultation, 'naturopathie', NULL, 13000, 'CAD');

  -- =====================================================
  -- COACHING PROFESSIONNEL (coaching_professionnel)
  -- 50 min: $110, 30 min: $70 (tx incluse)
  -- =====================================================
  INSERT INTO public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency) VALUES
    (v_web_30, 'coaching_professionnel', NULL, 7000, 'CAD'),
    (v_web_50, 'coaching_professionnel', NULL, 11000, 'CAD'),
    (v_pae_30, 'coaching_professionnel', NULL, 7000, 'CAD'),
    (v_pae_50, 'coaching_professionnel', NULL, 11000, 'CAD'),
    (v_consultation, 'coaching_professionnel', NULL, 11000, 'CAD');

END $$;

-- =============================================================================
-- SUMMARY OF PRICES SEEDED
-- =============================================================================
-- Category              | 30 min | 50 min | 60 min couple
-- ----------------------|--------|--------|---------------
-- Psychologie           | $120   | $160   | $185
-- Psychothérapie        | $120   | $160   | $185
-- Sexologie             | $96    | $130   | $155
-- Travail social        | $80    | $110   | $130
-- Orientation           | $96    | $130   | (not offered)
-- Psychoéducation       | $96    | $130   | $155
-- Naturopathie          | —      | $130   | —     (tx incluse)
-- Coaching professionnel| $70    | $110   | —     (tx incluse)
-- =============================================================================
