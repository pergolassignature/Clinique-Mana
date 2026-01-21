-- Migration: drop_deprecated_tables
-- Module: services-catalog
-- Created: 2026-01-21
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)
--
-- Drops deprecated tables that are no longer used:
-- - service_rules: Was for cancellation threshold params, not used by frontend
-- - service_tax_rules: Replaced by profession_categories.tax_included + services.is_taxable_override
--
-- These tables have no frontend code referencing them.

-- =============================================================================
-- DROP DEPRECATED TABLES
-- =============================================================================

-- Drop service_rules (cancellation threshold params - will implement differently when needed)
drop table if exists public.service_rules cascade;

-- Drop service_tax_rules (replaced by category-level tax + service-level override)
drop table if exists public.service_tax_rules cascade;
