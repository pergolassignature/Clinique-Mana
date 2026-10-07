-- Migration: clients_rls
-- Module: clients
-- Gate: 3 — Security (RLS)
-- Created: 2026-01-21

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================================

alter table public.clients enable row level security;
alter table public.client_notes enable row level security;
alter table public.client_consents enable row level security;
alter table public.client_relations enable row level security;
alter table public.client_audit_log enable row level security;

-- =============================================================================
-- CLIENTS: SELECT POLICIES
-- Admin and Staff can read all clients
-- Provider can read clients they are assigned to
-- =============================================================================

create policy "clients_select_admin"
  on public.clients
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

create policy "clients_select_staff"
  on public.clients
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

create policy "clients_select_provider_assigned"
  on public.clients
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and primary_professional_id = (
      select p.id from public.professionals p
      join public.profiles pr on pr.id = p.profile_id
      where pr.user_id = auth.uid()
    )
  );

-- =============================================================================
-- CLIENTS: INSERT POLICIES
-- Admin and Staff can create clients
-- =============================================================================

create policy "clients_insert_admin"
  on public.clients
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "clients_insert_staff"
  on public.clients
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- =============================================================================
-- CLIENTS: UPDATE POLICIES
-- Admin and Staff can update any client
-- Provider can update clients they are assigned to
-- =============================================================================

create policy "clients_update_admin"
  on public.clients
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "clients_update_staff"
  on public.clients
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

create policy "clients_update_provider_assigned"
  on public.clients
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and primary_professional_id = (
      select p.id from public.professionals p
      join public.profiles pr on pr.id = p.profile_id
      where pr.user_id = auth.uid()
    )
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and primary_professional_id = (
      select p.id from public.professionals p
      join public.profiles pr on pr.id = p.profile_id
      where pr.user_id = auth.uid()
    )
  );

-- =============================================================================
-- CLIENTS: DELETE POLICIES
-- Admin only (soft delete via is_archived preferred)
-- =============================================================================

create policy "clients_delete_admin_only"
  on public.clients
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- CLIENT NOTES: POLICIES
-- Same access pattern as clients table
-- =============================================================================

create policy "client_notes_select_admin_staff"
  on public.client_notes
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_notes_select_provider_assigned"
  on public.client_notes
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and client_id in (
      select c.id from public.clients c
      where c.primary_professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "client_notes_insert_admin_staff"
  on public.client_notes
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_notes_insert_provider_assigned"
  on public.client_notes
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'provider'
    and client_id in (
      select c.id from public.clients c
      where c.primary_professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "client_notes_update_admin_staff"
  on public.client_notes
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_notes_delete_admin"
  on public.client_notes
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- CLIENT CONSENTS: POLICIES
-- =============================================================================

create policy "client_consents_select_admin_staff"
  on public.client_consents
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_consents_select_provider_assigned"
  on public.client_consents
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and client_id in (
      select c.id from public.clients c
      where c.primary_professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "client_consents_insert_admin_staff"
  on public.client_consents
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_consents_update_admin_staff"
  on public.client_consents
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_consents_delete_admin"
  on public.client_consents
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- CLIENT RELATIONS: POLICIES
-- =============================================================================

create policy "client_relations_select_admin_staff"
  on public.client_relations
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_relations_select_provider_assigned"
  on public.client_relations
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and client_id in (
      select c.id from public.clients c
      where c.primary_professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "client_relations_insert_admin_staff"
  on public.client_relations
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_relations_update_admin_staff"
  on public.client_relations
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_relations_delete_admin_staff"
  on public.client_relations
  for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- CLIENT AUDIT LOG: POLICIES
-- Admin only for reading; writes via SECURITY DEFINER trigger
-- =============================================================================

create policy "client_audit_log_select_admin"
  on public.client_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- No INSERT/UPDATE/DELETE policies = denied (writes happen via trigger)

-- =============================================================================
-- ANON ROLE: DENY ALL
-- =============================================================================

revoke all on public.clients from anon;
revoke all on public.client_notes from anon;
revoke all on public.client_consents from anon;
revoke all on public.client_relations from anon;
revoke all on public.client_audit_log from anon;
