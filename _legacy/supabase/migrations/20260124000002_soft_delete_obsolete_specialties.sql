-- Migration: soft_delete_obsolete_specialties
-- Module: specialties
-- Created: 2026-01-24
-- Description: Soft delete obsolete specialties no longer used in the recommendation system.
--              These specialties are marked inactive to preserve historical data and audit trail.

-- =============================================================================
-- SOFT DELETE OBSOLETE SPECIALTIES
-- Mark lgbtq, indigenous, newcomers as inactive (is_active = false)
-- These are no longer used in the simplified recommendation system
-- =============================================================================

-- Idempotent update - safe to run multiple times
-- Sets is_active = false for the three obsolete specialty codes

update public.specialties
set is_active = false
where code in ('lgbtq', 'indigenous', 'newcomers')
  and is_active = true;

-- Note: We use a WHERE clause that checks is_active = true to ensure
-- idempotency and to avoid unnecessary row updates on subsequent runs.
-- The professional_specialties junction table entries are preserved
-- for historical reference.
