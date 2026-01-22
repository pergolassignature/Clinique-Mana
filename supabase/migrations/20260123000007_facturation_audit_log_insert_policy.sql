-- Migration: facturation_audit_log_insert_policy
-- Module: facturation
-- Gate: Allows authenticated users to insert audit log entries
-- Created: 2026-01-23

-- =============================================================================
-- INVOICE_AUDIT_LOG: INSERT POLICY
-- Admin and Staff can insert audit log entries
-- (Originally designed for SECURITY DEFINER triggers, but now called from app)
-- =============================================================================

create policy "invoice_audit_log_insert_admin_staff"
  on public.invoice_audit_log
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );
