-- =============================================================================
-- Migration: fix_clientele_sort_order
-- Module: specialties
-- Created: 2026-01-26
-- Description: Fix the display order for clientele specialties to follow
--              a logical age-based progression: children → teens → adults → seniors → groups
-- =============================================================================

-- Update sort_order for clientele specialties
-- Logical progression: Enfants (1) → Adolescents (2) → Adultes (3) → Aînés (4) → Groupes (5)

UPDATE public.specialties SET sort_order = 1 WHERE code = 'children';
UPDATE public.specialties SET sort_order = 2 WHERE code = 'adolescents';
UPDATE public.specialties SET sort_order = 3 WHERE code = 'adults';
UPDATE public.specialties SET sort_order = 4 WHERE code = 'seniors';
UPDATE public.specialties SET sort_order = 5 WHERE code = 'groups';

-- =============================================================================
-- Verification (commented out - for manual testing)
-- =============================================================================
-- SELECT code, name_fr, category, sort_order
-- FROM public.specialties
-- WHERE category = 'clientele' AND is_active = true
-- ORDER BY sort_order;
