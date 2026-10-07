-- Migration: professional_motifs_rls_fix
-- Module: motifs
-- Gate: 3 — Security (RLS)
-- Created: 2026-01-19
--
-- Fixes missing RLS policies for professional_motifs table.
-- Without these, admin/staff cannot manage professional motifs.

-- =============================================================================
-- PROFESSIONAL_MOTIFS: RLS POLICIES
-- Match the pattern from professional_specialties
-- =============================================================================

-- Admin can read all professional motifs (already covered by select_authenticated)
-- Staff can read all professional motifs (already covered by select_authenticated)

-- Admin/Staff can insert professional motifs
drop policy if exists "professional_motifs_insert_admin_staff" on public.professional_motifs;
create policy "professional_motifs_insert_admin_staff"
  on public.professional_motifs
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Admin/Staff can delete professional motifs
drop policy if exists "professional_motifs_delete_admin_staff" on public.professional_motifs;
create policy "professional_motifs_delete_admin_staff"
  on public.professional_motifs
  for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Note: service_role policy already exists for bulk operations
