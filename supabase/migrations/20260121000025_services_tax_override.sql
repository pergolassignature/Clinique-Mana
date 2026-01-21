-- Migration: services_tax_override
-- Module: services-catalog
-- Created: 2026-01-21
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)
--
-- Adds is_taxable_override column to services table.
-- This allows marking administrative services (e.g., Ouverture de dossier)
-- as always taxable, regardless of the professional's category tax status.
--
-- Tax logic hierarchy:
-- 1. If service.is_taxable_override = true → always apply taxes
-- 2. Otherwise → use profession_categories.tax_included
--
-- NOTE: This can only force taxes ON, never OFF. A service cannot be
-- exempt if the category is taxable - exemptions follow the professional.

-- =============================================================================
-- ADD COLUMN
-- =============================================================================

alter table public.services
  add column if not exists is_taxable_override boolean default null;

comment on column public.services.is_taxable_override is
  'When true, service is always taxable regardless of profession category. NULL/false = use category setting.';

-- =============================================================================
-- UPDATE EXISTING ADMINISTRATIVE SERVICES
-- =============================================================================

-- Mark "Ouverture de dossier" as always taxable
update public.services
set is_taxable_override = true
where key = 'ouverture_dossier';

-- Mark "Frais d'annulation" as always taxable (administrative fee)
update public.services
set is_taxable_override = true
where key = 'frais_annulation';
