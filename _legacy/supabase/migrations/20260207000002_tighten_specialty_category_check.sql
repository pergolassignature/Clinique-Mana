-- =============================================================================
-- Migration: tighten_specialty_category_check
-- Module: specialties
-- Created: 2026-02-07
-- Description: Remove deprecated 'issue' and 'modality' from the CHECK constraint
--              on specialties.category. These categories were soft-deleted in
--              migration 20260125000001 but the constraint was left permissive.
--              Uses NOT VALID to preserve existing inactive rows with old categories.
-- =============================================================================

-- Drop the current constraint
ALTER TABLE public.specialties DROP CONSTRAINT IF EXISTS specialties_category_check;

-- Add tightened constraint with NOT VALID to skip validation of existing rows.
-- This prevents new issue/modality specialties while preserving soft-deleted ones.
ALTER TABLE public.specialties
  ADD CONSTRAINT specialties_category_check
  CHECK (category IN ('therapy_type', 'clientele'))
  NOT VALID;

-- Update documentation
COMMENT ON COLUMN public.specialties.category IS 'Category: therapy_type, clientele (issue and modality deprecated, existing rows preserved)';
