-- Migration: services_v2_seed
-- Module: services-catalog
-- Created: 2026-01-20
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)
--
-- Idempotent seed data for profession categories, titles, and services.
-- Uses ON CONFLICT DO UPDATE for re-runnability.

-- =============================================================================
-- PROFESSION CATEGORIES
-- These determine pricing tiers
-- =============================================================================

insert into public.profession_categories (key, label_fr) values
  ('psychologie', 'Psychologie'),
  ('psychotherapie', 'Psychothérapie'),
  ('travail_social', 'Travail social'),
  ('psychoeducation', 'Psychoéducation'),
  ('sexologie', 'Sexologie'),
  ('naturopathie', 'Naturopathie'),
  ('orientation', 'Orientation'),
  ('coaching_professionnel', 'Coaching professionnel')
on conflict (key) do update set
  label_fr = excluded.label_fr,
  updated_at = now();

-- =============================================================================
-- PROFESSION TITLES
-- Mapped to their categories
-- =============================================================================

insert into public.profession_titles (key, label_fr, profession_category_key) values
  ('psychologue', 'Psychologue', 'psychologie'),
  ('psychotherapeute', 'Psychothérapeute', 'psychotherapie'),
  ('travailleur_social', 'Travailleur.euse social.e', 'travail_social'),
  ('psychoeducateur', 'Psychoéducateur.trice', 'psychoeducation'),
  ('sexologue', 'Sexologue', 'sexologie'),
  ('naturopathe', 'Naturopathe', 'naturopathie'),
  ('conseiller_orientation', 'Conseiller.ère en orientation', 'orientation'),
  ('coach_professionnel', 'Coach professionnel.le certifié.e', 'coaching_professionnel')
on conflict (key) do update set
  label_fr = excluded.label_fr,
  profession_category_key = excluded.profession_category_key,
  updated_at = now();

-- =============================================================================
-- SERVICES
-- Core service catalog
-- =============================================================================

-- Ouverture de dossier: Fixed global price (clinic administrative fee)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent)
values (
  'ouverture_de_dossier',
  'Ouverture de dossier',
  'Frais administratifs pour l''ouverture d''un nouveau dossier client. Ce n''est pas une consultation clinique.',
  'fixed',
  NULL,  -- No fixed duration, it's an admin fee
  1,
  true   -- Requires intake consent
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  updated_at = now();

-- Appel découverte: Fixed price (free)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent)
values (
  'appel_decouverte',
  'Appel découverte',
  'Appel gratuit de 15 minutes pour évaluer les besoins du client et déterminer l''approche appropriée.',
  'fixed',
  15,
  2,
  false
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  updated_at = now();

-- Consultation individuelle: Price varies by profession category
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent, color_hex)
values (
  'consultation_individuelle',
  'Consultation individuelle',
  'Séance de suivi individuel avec un professionnel.',
  'by_profession_category',
  50,  -- Default 50 minutes, variants possible (30, 60, 90)
  3,
  false,
  '#7FAE9D'  -- Sage green
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  color_hex = excluded.color_hex,
  updated_at = now();

-- Consultation couple: Price varies by profession category
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent, color_hex)
values (
  'consultation_couple',
  'Consultation de couple',
  'Séance de suivi pour couples.',
  'by_profession_category',
  60,  -- Default 60 minutes for couples
  4,
  false,
  '#B8D4E3'  -- Light blue
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  color_hex = excluded.color_hex,
  updated_at = now();

-- Séance prolongée: Price varies by profession category (90 min session)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent, color_hex)
values (
  'seance_prolongee',
  'Séance prolongée',
  'Séance de 90 minutes pour situations complexes nécessitant plus de temps.',
  'by_profession_category',
  90,
  5,
  false,
  '#E8D5B7'  -- Warm beige
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  color_hex = excluded.color_hex,
  updated_at = now();

-- Frais d'annulation: Prorata of cancelled service if < 24h
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent)
values (
  'frais_annulation',
  'Frais d''annulation',
  'Frais appliqués en cas d''annulation moins de 24 heures avant le rendez-vous. Calculé au prorata du service annulé.',
  'rule_cancellation_prorata',
  NULL,  -- No duration, it's a fee
  10,
  false
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  updated_at = now();

-- Discussion avec un autre intervenant: Hourly prorata billing
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent)
values (
  'discussion_autre_intervenant',
  'Discussion avec un autre intervenant',
  'Temps de discussion ou coordination avec un autre professionnel concernant un dossier. Facturé à la minute selon le taux horaire.',
  'by_profession_hourly_prorata',
  NULL,  -- Variable duration, billed by minute
  11,
  false
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  updated_at = now();

-- Rédaction de rapport: Hourly prorata billing
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, requires_consent)
values (
  'redaction_de_rapport',
  'Rédaction de rapport',
  'Temps de rédaction de rapports, notes cliniques détaillées ou documents officiels. Facturé à la minute selon le taux horaire.',
  'by_profession_hourly_prorata',
  NULL,  -- Variable duration, billed by minute
  12,
  false
)
on conflict (key) do update set
  name_fr = excluded.name_fr,
  description_fr = excluded.description_fr,
  pricing_model = excluded.pricing_model,
  default_duration_minutes = excluded.default_duration_minutes,
  display_order = excluded.display_order,
  requires_consent = excluded.requires_consent,
  updated_at = now();

-- =============================================================================
-- SERVICE PRICES
-- Fixed prices for 'fixed' model services
-- =============================================================================

-- Get service IDs and insert prices
do $$
declare
  v_ouverture_id uuid;
  v_appel_id uuid;
  v_gst_id uuid;
  v_qst_id uuid;
begin
  -- Get service IDs
  select id into v_ouverture_id from public.services where key = 'ouverture_de_dossier';
  select id into v_appel_id from public.services where key = 'appel_decouverte';

  -- Get tax rate IDs (from previous migration)
  select id into v_gst_id from public.tax_rates where key = 'qc_gst';
  select id into v_qst_id from public.tax_rates where key = 'qc_qst';

  -- ============================================
  -- Ouverture de dossier: Fixed global price
  -- Price from existing UI: $43.49 = 4349 cents
  -- This is a TAXABLE clinic admin fee
  -- ============================================
  insert into public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency)
  values (
    v_ouverture_id,
    NULL,  -- Global price, not per profession
    NULL,  -- No duration variant
    4349,  -- $43.49
    'CAD'
  )
  on conflict (service_id, profession_category_key, duration_minutes) do update set
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    updated_at = now();

  -- Tax rules for Ouverture de dossier (taxable: TPS + TVQ)
  if v_gst_id is not null then
    insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority)
    values (v_ouverture_id, v_gst_id, true, 1)
    on conflict (service_id, tax_rate_id) do update set
      applies = excluded.applies,
      priority = excluded.priority,
      updated_at = now();
  end if;

  if v_qst_id is not null then
    insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority)
    values (v_ouverture_id, v_qst_id, true, 2)
    on conflict (service_id, tax_rate_id) do update set
      applies = excluded.applies,
      priority = excluded.priority,
      updated_at = now();
  end if;

  -- ============================================
  -- Appel découverte: Fixed global price (FREE)
  -- This is tax-exempt (free service)
  -- ============================================
  insert into public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency)
  values (
    v_appel_id,
    NULL,  -- Global price
    NULL,  -- Default duration (15 min)
    0,     -- Free
    'CAD'
  )
  on conflict (service_id, profession_category_key, duration_minutes) do update set
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    updated_at = now();

  -- Tax rules for Appel découverte (exempt - free service)
  if v_gst_id is not null then
    insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority)
    values (v_appel_id, v_gst_id, false, 1)
    on conflict (service_id, tax_rate_id) do update set
      applies = false,
      priority = excluded.priority,
      updated_at = now();
  end if;

  if v_qst_id is not null then
    insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority)
    values (v_appel_id, v_qst_id, false, 2)
    on conflict (service_id, tax_rate_id) do update set
      applies = false,
      priority = excluded.priority,
      updated_at = now();
  end if;

end $$;

-- =============================================================================
-- SERVICE RULES
-- Cancellation threshold rule
-- =============================================================================

do $$
declare
  v_frais_id uuid;
begin
  select id into v_frais_id from public.services where key = 'frais_annulation';

  if v_frais_id is not null then
    insert into public.service_rules (service_id, rule_type, params)
    values (
      v_frais_id,
      'cancellation_prorata',
      '{"threshold_hours": 24}'::jsonb
    )
    on conflict (service_id, rule_type) do update set
      params = excluded.params,
      updated_at = now();
  end if;
end $$;

-- =============================================================================
-- PROFESSION CATEGORY RATES (Hourly rates for minute-based billing)
--
-- NOTE: Actual rates are UNKNOWN. These are PLACEHOLDER values.
-- TODO: Replace with actual hourly rates from clinic pricing sheet.
--
-- Formula for minute billing: billed_amount = (minutes/60) * hourly_rate_cents
-- =============================================================================

-- Placeholder hourly rates (in cents)
-- Using $130/hour as a PLACEHOLDER - this needs to be verified with actual rates
-- Commented out to avoid seeding incorrect data - uncomment and adjust when rates are known

/*
insert into public.profession_category_rates (profession_category_key, hourly_rate_cents, currency) values
  ('psychologie', 15600, 'CAD'),        -- PLACEHOLDER: $156/hour
  ('psychotherapie', 15600, 'CAD'),     -- PLACEHOLDER: $156/hour
  ('travail_social', 13000, 'CAD'),     -- PLACEHOLDER: $130/hour
  ('psychoeducation', 13000, 'CAD'),    -- PLACEHOLDER: $130/hour
  ('sexologie', 13000, 'CAD'),          -- PLACEHOLDER: $130/hour
  ('naturopathie', 12000, 'CAD'),       -- PLACEHOLDER: $120/hour
  ('orientation', 13000, 'CAD'),        -- PLACEHOLDER: $130/hour
  ('coaching_professionnel', 15000, 'CAD')  -- PLACEHOLDER: $150/hour
on conflict (profession_category_key) do update set
  hourly_rate_cents = excluded.hourly_rate_cents,
  currency = excluded.currency,
  updated_at = now();
*/

-- =============================================================================
-- SERVICE PRICES BY PROFESSION CATEGORY
--
-- NOTE: Category-specific prices for consultations are UNKNOWN.
-- TODO: Add prices per profession category when pricing sheet is available.
--
-- Example structure (commented out):
-- =============================================================================

/*
-- Example: Psychologie prices
do $$
declare
  v_consult_indiv_id uuid;
begin
  select id into v_consult_indiv_id from public.services where key = 'consultation_individuelle';

  -- 50-minute session for psychologie
  insert into public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency)
  values (v_consult_indiv_id, 'psychologie', 50, 13000, 'CAD')  -- $130
  on conflict (service_id, profession_category_key, duration_minutes) do update set
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    updated_at = now();

  -- 30-minute session variant
  insert into public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency)
  values (v_consult_indiv_id, 'psychologie', 30, 8000, 'CAD')  -- $80
  on conflict (service_id, profession_category_key, duration_minutes) do update set
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    updated_at = now();
end $$;
*/

-- =============================================================================
-- SUMMARY
--
-- Tables seeded:
-- - profession_categories (8 categories)
-- - profession_titles (8 titles mapped to categories)
-- - services (8 services with appropriate pricing models)
-- - service_prices (2 fixed prices: ouverture_de_dossier, appel_decouverte)
-- - service_tax_rules (tax rules for fixed-price services)
-- - service_rules (cancellation threshold rule)
--
-- NOT SEEDED (awaiting actual pricing data):
-- - profession_category_rates (hourly rates - structure ready, values unknown)
-- - service_prices per category (consultation prices - structure ready, values unknown)
-- =============================================================================
