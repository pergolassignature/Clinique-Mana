-- Migration: recommendations_audit_insert_policies
-- Module: recommendations
-- Gate: 2 - RLS Fix
-- Created: 2026-01-22
--
-- Adds missing INSERT policies to recommendation_audit_log table.
-- The original migration only had SELECT policies.

-- =============================================================================
-- ADD INSERT POLICIES FOR AUDIT LOG
-- =============================================================================

-- Admin can create audit log entries
create policy "recommendation_audit_log_insert_admin"
  on public.recommendation_audit_log for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can create audit log entries
create policy "recommendation_audit_log_insert_staff"
  on public.recommendation_audit_log for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );
