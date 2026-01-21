-- Migration: profiles_insert_staff
-- Purpose: Allow staff to insert profiles (needed for creating new professionals)
-- Created: 2026-01-21
--
-- Previously only admin could insert into profiles, but staff need this ability
-- to create new professionals via the "Ajouter un professionnel" feature.
-- Staff can only create provider profiles (not admin/staff profiles).

-- =============================================================================
-- ADD STAFF INSERT POLICY FOR PROFILES
-- Staff can only create profiles with role='provider'
-- =============================================================================

CREATE POLICY "profiles_insert_staff_provider_only"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.get_my_role()) = 'staff'
    AND role = 'provider'  -- Staff can only create provider profiles
  );
