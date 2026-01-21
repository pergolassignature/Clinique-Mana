-- Migration: demandes_rls
-- Module: demandes
-- Gate: 2 - Row Level Security
-- Created: 2026-01-21

-- =============================================================================
-- ENABLE RLS
-- =============================================================================

alter table public.demandes enable row level security;
alter table public.demande_participants enable row level security;
alter table public.demande_audit_log enable row level security;

-- =============================================================================
-- DEMANDES POLICIES
-- Admin/Staff: Full access
-- Provider: Read assigned demandes only
-- =============================================================================

-- SELECT policies
create policy "demandes_select_admin"
  on public.demandes for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

create policy "demandes_select_staff"
  on public.demandes for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

create policy "demandes_select_provider"
  on public.demandes for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and assigned_professional_id = (
      select p.id from public.professionals p
      where p.profile_id = (
        select id from public.profiles where user_id = auth.uid()
      )
    )
  );

-- INSERT policies (admin and staff only)
create policy "demandes_insert_admin"
  on public.demandes for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "demandes_insert_staff"
  on public.demandes for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- UPDATE policies
create policy "demandes_update_admin"
  on public.demandes for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "demandes_update_staff"
  on public.demandes for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- DELETE policies (admin only)
create policy "demandes_delete_admin"
  on public.demandes for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- DEMANDE_PARTICIPANTS POLICIES
-- Admin/Staff: Full access
-- Provider: Read only for assigned demandes
-- =============================================================================

-- SELECT policies
create policy "demande_participants_select_admin"
  on public.demande_participants for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

create policy "demande_participants_select_staff"
  on public.demande_participants for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

create policy "demande_participants_select_provider"
  on public.demande_participants for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and exists (
      select 1 from public.demandes d
      where d.id = demande_participants.demande_id
      and d.assigned_professional_id = (
        select p.id from public.professionals p
        where p.profile_id = (
          select id from public.profiles where user_id = auth.uid()
        )
      )
    )
  );

-- INSERT policies
create policy "demande_participants_insert_admin"
  on public.demande_participants for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "demande_participants_insert_staff"
  on public.demande_participants for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- UPDATE policies
create policy "demande_participants_update_admin"
  on public.demande_participants for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "demande_participants_update_staff"
  on public.demande_participants for update
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- DELETE policies
create policy "demande_participants_delete_admin"
  on public.demande_participants for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

create policy "demande_participants_delete_staff"
  on public.demande_participants for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- =============================================================================
-- DEMANDE_AUDIT_LOG POLICIES
-- Read-only for admin/staff, append-only via triggers
-- =============================================================================

create policy "demande_audit_log_select_admin"
  on public.demande_audit_log for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Insert is handled by triggers only (no direct insert policy)
