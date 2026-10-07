-- Migration: services_v3_seed
-- Module: services-catalog
-- Created: 2026-01-21
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)
--
-- Replaces the sample services with the clinic's actual service catalog (12 services).
-- Clears existing service data and re-seeds with correct services.

-- =============================================================================
-- CLEAR EXISTING SERVICE DATA
-- Order matters due to FK constraints
-- =============================================================================

-- Clear junction tables first
delete from public.professional_services;
delete from public.service_tax_rules;
delete from public.service_prices;
delete from public.service_rules;

-- Clear services
delete from public.services;

-- =============================================================================
-- INSERT SERVICES (12 total)
-- =============================================================================

-- 1. Rencontre d'intervention web - 30 min
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'intervention_web_30',
  'Rencontre d''intervention web - 30 minutes',
  'Séance de 30 minutes en vidéoconférence.',
  'by_profession_category',
  30,
  1,
  '#22C55E',
  true,
  false
);

-- 2. Rencontre d'intervention web - 50 min
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'intervention_web_50',
  'Rencontre d''intervention web - 50 minutes',
  'Séance de 50 minutes en vidéoconférence.',
  'by_profession_category',
  50,
  2,
  '#22C55E',
  true,
  false
);

-- 3. Rencontre d'intervention couple - famille - 60 min
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'intervention_couple_famille_60',
  'Rencontre d''intervention couple - famille - 60 minutes',
  'Séance de 60 minutes pour couples ou familles.',
  'by_profession_category',
  60,
  3,
  '#F472B6',
  true,
  false
);

-- 4. Rencontre d'intervention individuelle (couple-famille) - 60 min
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'intervention_individuelle_60',
  'Rencontre d''intervention individuelle (couple-famille) - 60 minutes',
  'Séance individuelle de 60 minutes dans un contexte de suivi couple-famille.',
  'by_profession_category',
  60,
  4,
  '#F472B6',
  true,
  false
);

-- 5. Appel découverte - 15 min (FREE)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'appel_decouverte',
  'Appel découverte - 15 minutes',
  'Appel gratuit de 15 minutes pour évaluer les besoins et déterminer l''approche appropriée.',
  'fixed',
  15,
  5,
  '#22C55E',
  true,
  false
);

-- 6. Discussion avec un autre intervenant (hourly prorata)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'discussion_intervenant',
  'Discussion avec un autre intervenant',
  'Temps de discussion ou coordination avec un autre professionnel concernant un dossier. Facturé à la minute.',
  'by_profession_hourly_prorata',
  NULL,
  6,
  '#22C55E',
  true,
  false
);

-- 7. Ouverture de dossier (FIXED $43.49 + tax)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'ouverture_dossier',
  'Ouverture de dossier',
  'Frais administratifs pour l''ouverture d''un nouveau dossier client.',
  'fixed',
  NULL,
  7,
  '#EF4444',
  true,
  true
);

-- 8. PAE externe - 30 min
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'pae_externe_30',
  'PAE externe - 30 minutes',
  'Programme d''aide aux employés - séance de 30 minutes.',
  'by_profession_category',
  30,
  8,
  '#F97316',
  true,
  false
);

-- 9. PAE externe - 50 min
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'pae_externe_50',
  'PAE externe - 50 minutes',
  'Programme d''aide aux employés - séance de 50 minutes.',
  'by_profession_category',
  50,
  9,
  '#F97316',
  true,
  false
);

-- 10. PAE externe - couple
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'pae_externe_couple',
  'PAE externe - couple',
  'Programme d''aide aux employés - séance de couple.',
  'by_profession_category',
  60,
  10,
  '#FACC15',
  true,
  false
);

-- 11. Rédaction de rapport (hourly prorata)
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'redaction_rapport',
  'Rédaction de rapport',
  'Temps de rédaction de rapports, notes cliniques détaillées ou documents officiels. Facturé à la minute.',
  'by_profession_hourly_prorata',
  NULL,
  11,
  '#06B6D4',
  true,
  false
);

-- 12. Service de consultation
insert into public.services (key, name_fr, description_fr, pricing_model, default_duration_minutes, display_order, color_hex, is_active, requires_consent)
values (
  'service_consultation',
  'Service de consultation',
  'Service de consultation générale.',
  'by_profession_category',
  50,
  12,
  '#D946EF',
  true,
  false
);

-- =============================================================================
-- INSERT FIXED PRICES
-- =============================================================================

do $$
declare
  v_appel_id uuid;
  v_ouverture_id uuid;
  v_gst_id uuid;
  v_qst_id uuid;
begin
  -- Get service IDs
  select id into v_appel_id from public.services where key = 'appel_decouverte';
  select id into v_ouverture_id from public.services where key = 'ouverture_dossier';

  -- Get tax rate IDs
  select id into v_gst_id from public.tax_rates where key = 'qc_gst';
  select id into v_qst_id from public.tax_rates where key = 'qc_qst';

  -- Appel découverte: FREE
  insert into public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency)
  values (v_appel_id, NULL, NULL, 0, 'CAD');

  -- Ouverture de dossier: $43.49
  insert into public.service_prices (service_id, profession_category_key, duration_minutes, price_cents, currency)
  values (v_ouverture_id, NULL, NULL, 4349, 'CAD');

  -- Tax rules for Ouverture de dossier (taxable: TPS + TVQ)
  if v_gst_id is not null then
    insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority)
    values (v_ouverture_id, v_gst_id, true, 1);
  end if;

  if v_qst_id is not null then
    insert into public.service_tax_rules (service_id, tax_rate_id, applies, priority)
    values (v_ouverture_id, v_qst_id, true, 2);
  end if;

end $$;

-- =============================================================================
-- SUMMARY
--
-- Services created: 12
-- - 8 with by_profession_category pricing (prices to be set via UI)
-- - 2 with fixed pricing (Appel découverte FREE, Ouverture de dossier $43.49)
-- - 2 with by_profession_hourly_prorata (Discussion, Rédaction)
--
-- Next steps:
-- - Use the pricing UI to set prices per profession category
-- - Assign services to professionals
-- =============================================================================
