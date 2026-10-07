-- Migration: professionals_address_fields
-- Module: professionals
-- Description: Add address fields to professionals table (same structure as clients)
-- Created: 2026-01-27

-- =============================================================================
-- ADD ADDRESS COLUMNS TO PROFESSIONALS TABLE
-- Matches clients table structure for consistency
-- =============================================================================

ALTER TABLE public.professionals
  ADD COLUMN street_number text,
  ADD COLUMN street_name text,
  ADD COLUMN apartment text,
  ADD COLUMN city text,
  ADD COLUMN province text CHECK (province IN ('QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU')),
  ADD COLUMN country text DEFAULT 'Canada',
  ADD COLUMN postal_code text;

-- Comments for documentation
COMMENT ON COLUMN public.professionals.street_number IS 'Street number for professional address';
COMMENT ON COLUMN public.professionals.street_name IS 'Street name for professional address';
COMMENT ON COLUMN public.professionals.apartment IS 'Apartment/suite number';
COMMENT ON COLUMN public.professionals.city IS 'City';
COMMENT ON COLUMN public.professionals.province IS 'Canadian province code (QC, ON, etc.)';
COMMENT ON COLUMN public.professionals.country IS 'Country (defaults to Canada)';
COMMENT ON COLUMN public.professionals.postal_code IS 'Postal code';
