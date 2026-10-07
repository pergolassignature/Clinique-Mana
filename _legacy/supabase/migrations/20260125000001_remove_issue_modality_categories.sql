-- =============================================================================
-- Migration: remove_issue_modality_categories
-- Module: specialties
-- Created: 2026-01-25
-- Description: Remove 'issue' and 'modality' specialty categories from active use.
--              Soft-delete all specialties in these categories.
--              Note: CHECK constraint is NOT modified to preserve historical data.
--              The frontend code prevents creation of new issue/modality specialties.
-- =============================================================================

-- =============================================================================
-- Soft-delete all specialties with category 'issue' or 'modality'
-- =============================================================================

UPDATE public.specialties
SET is_active = false
WHERE category IN ('issue', 'modality')
  AND is_active = true;

-- =============================================================================
-- Documentation
-- =============================================================================

COMMENT ON COLUMN public.specialties.category IS 'Category: therapy_type, clientele (issue and modality deprecated)';
