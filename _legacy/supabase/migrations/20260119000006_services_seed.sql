-- Migration: services_seed
-- Module: services-catalog
-- Created: 2026-01-19
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)

-- =============================================================================
-- TAX RATES (Quebec)
-- =============================================================================

insert into public.tax_rates (key, label, rate_bps, region) values
  ('qc_gst', 'TPS', 500, 'QC'),    -- 5.00% federal GST
  ('qc_qst', 'TVQ', 9975, 'QC')    -- 9.975% Quebec QST
on conflict (key) do nothing;

-- =============================================================================
-- SAMPLE SERVICES
-- =============================================================================

-- Get tax rate IDs for later use
do $$
declare
  v_gst_id uuid;
  v_qst_id uuid;
  v_ouverture_id uuid;
  v_appel_decouverte_id uuid;
  v_consultation_id uuid;
begin
  -- Get tax rate IDs
  select id into v_gst_id from public.tax_rates where key = 'qc_gst';
  select id into v_qst_id from public.tax_rates where key = 'qc_qst';

  -- ============================================
  -- SERVICE: Ouverture de dossier
  -- ============================================
  insert into public.services (key, name, description_internal, default_duration_minutes, default_price_cents, is_bookable_online, calendar_color, sort_order)
  values (
    'ouverture_dossier',
    'Ouverture de dossier',
    'Première rencontre pour ouvrir un dossier client. Inclut évaluation initiale.',
    60,
    4349,  -- $43.49
    true,
    '#7FAE9D',  -- Sage green
    1
  )
  on conflict (key) do update set
    name = excluded.name,
    description_internal = excluded.description_internal,
    default_duration_minutes = excluded.default_duration_minutes,
    default_price_cents = excluded.default_price_cents,
    is_bookable_online = excluded.is_bookable_online,
    calendar_color = excluded.calendar_color,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id into v_ouverture_id;

  -- Variants for Ouverture de dossier
  insert into public.service_variants (service_id, key, label, sort_order) values
    (v_ouverture_id, 'individuel', 'Individuel', 1),
    (v_ouverture_id, 'couple', 'Couple', 2),
    (v_ouverture_id, 'mediation', 'Médiation', 3),
    (v_ouverture_id, 'service_consultation', 'Service de consultation', 4)
  on conflict (service_id, key) do nothing;

  -- Tax rules: Ouverture de dossier is taxable (TPS + TVQ)
  insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority) values
    (v_ouverture_id, v_gst_id, true, 1),
    (v_ouverture_id, v_qst_id, true, 2)
  on conflict (service_id, tax_rate_id) do nothing;

  -- Consent: Ouverture de dossier requires intake consent
  insert into public.service_consent_requirements (service_id, consent_document_key, is_required) values
    (v_ouverture_id, 'intake_consent_v1', true)
  on conflict (service_id, consent_document_key) do nothing;

  -- ============================================
  -- SERVICE: Appel découverte (free, tax exempt)
  -- ============================================
  insert into public.services (key, name, description_internal, default_duration_minutes, default_price_cents, is_bookable_online, calendar_color, sort_order)
  values (
    'appel_decouverte',
    'Appel découverte',
    'Appel gratuit de 15 minutes pour évaluer les besoins du client.',
    15,
    0,  -- Free
    true,
    '#B8D4E3',  -- Light blue
    2
  )
  on conflict (key) do update set
    name = excluded.name,
    description_internal = excluded.description_internal,
    default_duration_minutes = excluded.default_duration_minutes,
    default_price_cents = excluded.default_price_cents,
    is_bookable_online = excluded.is_bookable_online,
    calendar_color = excluded.calendar_color,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id into v_appel_decouverte_id;

  -- Tax rules: Appel découverte is tax exempt (applies = false)
  insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority) values
    (v_appel_decouverte_id, v_gst_id, false, 1),
    (v_appel_decouverte_id, v_qst_id, false, 2)
  on conflict (service_id, tax_rate_id) do nothing;

  -- ============================================
  -- SERVICE: Service de consultation (generic)
  -- ============================================
  insert into public.services (key, name, description_internal, default_duration_minutes, default_price_cents, is_bookable_online, calendar_color, sort_order)
  values (
    'consultation',
    'Service de consultation',
    'Séance de consultation standard.',
    50,
    13000,  -- $130.00
    true,
    '#E8D5B7',  -- Warm beige
    3
  )
  on conflict (key) do update set
    name = excluded.name,
    description_internal = excluded.description_internal,
    default_duration_minutes = excluded.default_duration_minutes,
    default_price_cents = excluded.default_price_cents,
    is_bookable_online = excluded.is_bookable_online,
    calendar_color = excluded.calendar_color,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning id into v_consultation_id;

  -- Tax rules: Consultation is taxable
  insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority) values
    (v_consultation_id, v_gst_id, true, 1),
    (v_consultation_id, v_qst_id, true, 2)
  on conflict (service_id, tax_rate_id) do nothing;

end $$;
