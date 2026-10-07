-- Migration: Add UPDATE policies for professional_specialties and professional_motifs
-- Purpose: Allow admin/staff to update is_specialized flag via the specialization toggle
-- Without these policies, the UPDATE operations fail silently due to RLS

-- =============================================================================
-- PROFESSIONAL_SPECIALTIES: UPDATE POLICY
-- =============================================================================

-- Admin/Staff can update professional specialties (for is_specialized toggle)
CREATE POLICY "professional_specialties_update_admin_staff"
  ON public.professional_specialties
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.get_my_role()) IN ('admin', 'staff')
  );

-- =============================================================================
-- PROFESSIONAL_MOTIFS: UPDATE POLICY
-- =============================================================================

-- Admin/Staff can update professional motifs (for is_specialized toggle)
CREATE POLICY "professional_motifs_update_admin_staff"
  ON public.professional_motifs
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.get_my_role()) IN ('admin', 'staff')
  );
