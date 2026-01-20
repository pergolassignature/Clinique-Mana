-- Migration: fix_professionals_rls_recursion
-- Module: professionals
-- Purpose: Fix infinite recursion bug in professionals RLS policy
-- Created: 2026-01-19
--
-- The professionals_update_provider_own policy had a WITH CHECK clause that
-- queried the professionals table, causing infinite recursion when evaluated.
-- This fix removes the self-referential query.

-- =============================================================================
-- DROP AND RECREATE THE BROKEN POLICY
-- =============================================================================

-- Drop the policy with infinite recursion
drop policy if exists "professionals_update_provider_own" on public.professionals;

-- Recreate without the self-referential status check
-- Status changes are now protected at the application layer for providers
-- (Staff/Admin policies already have unrestricted update access)
create policy "professionals_update_provider_own"
  on public.professionals
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and profile_id = (select id from public.profiles where user_id = (select auth.uid()))
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and profile_id = (select id from public.profiles where user_id = (select auth.uid()))
    -- NOTE: Status protection is handled at application layer
    -- The previous self-referential check caused infinite recursion (error 42P17)
  );

-- =============================================================================
-- GRANT INSERT ON AUDIT LOG FOR STAFF
-- The audit log insert was failing because there was no policy allowing it.
-- Staff need to be able to insert audit log entries when applying questionnaires.
-- =============================================================================

-- Allow admin/staff to insert audit log entries
create policy "professional_audit_log_insert_admin_staff"
  on public.professional_audit_log
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );
