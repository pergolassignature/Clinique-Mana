-- Migration: facturation_rls
-- Module: facturation
-- Gate: 2 — Security (RLS)
-- Created: 2026-01-23

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================================

alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.invoice_payer_allocations enable row level security;
alter table public.invoice_audit_log enable row level security;

-- =============================================================================
-- INVOICES: SELECT POLICIES
-- Admin and Staff can read all invoices
-- Provider can read invoices for their appointments
-- =============================================================================

create policy "invoices_select_admin"
  on public.invoices
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

create policy "invoices_select_staff"
  on public.invoices
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

create policy "invoices_select_provider_own"
  on public.invoices
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id = (
      select p.id from public.professionals p
      join public.profiles pr on pr.id = p.profile_id
      where pr.user_id = auth.uid()
    )
  );

-- =============================================================================
-- INVOICES: INSERT POLICIES
-- Admin and Staff can create invoices
-- =============================================================================

create policy "invoices_insert_admin"
  on public.invoices
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "invoices_insert_staff"
  on public.invoices
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- =============================================================================
-- INVOICES: UPDATE POLICIES
-- Admin and Staff can update any invoice
-- =============================================================================

create policy "invoices_update_admin"
  on public.invoices
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "invoices_update_staff"
  on public.invoices
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- =============================================================================
-- INVOICES: DELETE POLICIES
-- Admin only (soft delete via status='void' preferred)
-- =============================================================================

create policy "invoices_delete_admin_only"
  on public.invoices
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- INVOICE_LINE_ITEMS: POLICIES
-- Same access pattern as invoices (checked via invoice_id join)
-- =============================================================================

create policy "invoice_line_items_select_admin_staff"
  on public.invoice_line_items
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_line_items_select_provider_own"
  on public.invoice_line_items
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and invoice_id in (
      select i.id from public.invoices i
      where i.professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "invoice_line_items_insert_admin_staff"
  on public.invoice_line_items
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_line_items_update_admin_staff"
  on public.invoice_line_items
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_line_items_delete_admin_staff"
  on public.invoice_line_items
  for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- INVOICE_PAYMENTS: POLICIES
-- =============================================================================

create policy "invoice_payments_select_admin_staff"
  on public.invoice_payments
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_payments_select_provider_own"
  on public.invoice_payments
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and invoice_id in (
      select i.id from public.invoices i
      where i.professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "invoice_payments_insert_admin_staff"
  on public.invoice_payments
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_payments_update_admin_staff"
  on public.invoice_payments
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_payments_delete_admin"
  on public.invoice_payments
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- INVOICE_PAYER_ALLOCATIONS: POLICIES
-- =============================================================================

create policy "invoice_payer_allocations_select_admin_staff"
  on public.invoice_payer_allocations
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_payer_allocations_select_provider_own"
  on public.invoice_payer_allocations
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and invoice_id in (
      select i.id from public.invoices i
      where i.professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "invoice_payer_allocations_insert_admin_staff"
  on public.invoice_payer_allocations
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_payer_allocations_update_admin_staff"
  on public.invoice_payer_allocations
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_payer_allocations_delete_admin"
  on public.invoice_payer_allocations
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- INVOICE_AUDIT_LOG: POLICIES
-- Admin and Staff for reading; writes via SECURITY DEFINER triggers
-- =============================================================================

create policy "invoice_audit_log_select_admin_staff"
  on public.invoice_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "invoice_audit_log_select_provider_own"
  on public.invoice_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and invoice_id in (
      select i.id from public.invoices i
      where i.professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

-- No INSERT/UPDATE/DELETE policies for audit log (writes via trigger only)

-- =============================================================================
-- ANON ROLE: DENY ALL
-- =============================================================================

revoke all on public.invoices from anon;
revoke all on public.invoice_line_items from anon;
revoke all on public.invoice_payments from anon;
revoke all on public.invoice_payer_allocations from anon;
revoke all on public.invoice_audit_log from anon;
