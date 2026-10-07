-- Migration: Add is_specialized flag to professional_specialties and professional_motifs
-- Purpose: Allow professionals to mark certain specialties/motifs as their core specializations
-- This is used for internal organization and weighted matching

-- ============================================================================
-- PROFESSIONAL_SPECIALTIES
-- ============================================================================

-- Remove unused proficiency_level column
ALTER TABLE public.professional_specialties
  DROP COLUMN IF EXISTS proficiency_level;

-- Add is_specialized flag
ALTER TABLE public.professional_specialties
  ADD COLUMN is_specialized BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient queries on specialized items
CREATE INDEX idx_professional_specialties_specialized
  ON public.professional_specialties(professional_id)
  WHERE is_specialized = true;

-- ============================================================================
-- PROFESSIONAL_MOTIFS
-- ============================================================================

-- Add is_specialized flag
ALTER TABLE public.professional_motifs
  ADD COLUMN is_specialized BOOLEAN NOT NULL DEFAULT false;

-- Index for efficient queries on specialized items
CREATE INDEX idx_professional_motifs_specialized
  ON public.professional_motifs(professional_id)
  WHERE is_specialized = true;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN public.professional_specialties.is_specialized IS
  'Indicates this specialty is a core specialization for the professional';

COMMENT ON COLUMN public.professional_motifs.is_specialized IS
  'Indicates this motif is a core specialization for the professional';
