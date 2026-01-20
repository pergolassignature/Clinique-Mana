-- Migration: professional_professions_rls_write
-- Module: professionals / services
-- Created: 2026-01-20
-- Target: STAGING (vnmbjbdsjxmpijyjmmkh)
--
-- Adds write policies for admin/staff on professional_professions table.
-- The original migration only allowed SELECT for authenticated users.

-- =============================================================================
-- PROFESSIONAL_PROFESSIONS: WRITE POLICIES FOR ADMIN/STAFF
-- =============================================================================

-- Admin can insert professional professions
create policy "professional_professions_insert_admin"
  on public.professional_professions
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can insert professional professions
create policy "professional_professions_insert_staff"
  on public.professional_professions
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can update professional professions
create policy "professional_professions_update_admin"
  on public.professional_professions
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can update professional professions
create policy "professional_professions_update_staff"
  on public.professional_professions
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Admin can delete professional professions
create policy "professional_professions_delete_admin"
  on public.professional_professions
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can delete professional professions
create policy "professional_professions_delete_staff"
  on public.professional_professions
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );
