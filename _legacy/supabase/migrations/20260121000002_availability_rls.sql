-- Migration: availability_rls
-- Module: availability
-- Gate: 2 - Security (RLS)
-- Created: 2026-01-21

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- Default deny: no access unless explicitly granted via policies
-- =============================================================================

alter table public.availability_blocks enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_clients enable row level security;
alter table public.appointment_audit_log enable row level security;

-- =============================================================================
-- AVAILABILITY_BLOCKS: POLICIES
-- Admin/Staff: full access
-- Provider: CRUD own availability only
-- =============================================================================

-- Admin can manage all availability blocks
create policy "availability_blocks_all_admin"
  on public.availability_blocks
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can manage all availability blocks
create policy "availability_blocks_all_staff"
  on public.availability_blocks
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read their own availability blocks
create policy "availability_blocks_select_provider_own"
  on public.availability_blocks
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  );

-- Provider can insert their own availability blocks
create policy "availability_blocks_insert_provider_own"
  on public.availability_blocks
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  );

-- Provider can update their own availability blocks
create policy "availability_blocks_update_provider_own"
  on public.availability_blocks
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  );

-- Provider can delete their own availability blocks
create policy "availability_blocks_delete_provider_own"
  on public.availability_blocks
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  );

-- =============================================================================
-- APPOINTMENTS: POLICIES
-- Admin/Staff: full access
-- Provider: read/update own appointments (cannot create/delete directly)
-- =============================================================================

-- Admin can manage all appointments
create policy "appointments_all_admin"
  on public.appointments
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can manage all appointments
create policy "appointments_all_staff"
  on public.appointments
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read their own appointments
create policy "appointments_select_provider_own"
  on public.appointments
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  );

-- Provider can update their own appointments (for notes, completion, no-show)
create policy "appointments_update_provider_own"
  on public.appointments
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
    -- Provider cannot reassign to different professional
    and professional_id = (
      select professional_id from public.appointments a
      where a.id = appointments.id
    )
  );

-- =============================================================================
-- APPOINTMENT_CLIENTS: POLICIES
-- Admin/Staff: full access
-- Provider: read only (for their own appointments)
-- =============================================================================

-- Admin can manage all appointment clients
create policy "appointment_clients_all_admin"
  on public.appointment_clients
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can manage all appointment clients
create policy "appointment_clients_all_staff"
  on public.appointment_clients
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  )
  with check (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read clients for their own appointments
create policy "appointment_clients_select_provider_own"
  on public.appointment_clients
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and appointment_id in (
      select id from public.appointments
      where professional_id in (
        select id from public.professionals
        where profile_id = (select id from public.profiles where user_id = auth.uid())
      )
    )
  );

-- Provider can update attendance for their own appointments
create policy "appointment_clients_update_provider_own"
  on public.appointment_clients
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and appointment_id in (
      select id from public.appointments
      where professional_id in (
        select id from public.professionals
        where profile_id = (select id from public.profiles where user_id = auth.uid())
      )
    )
  )
  with check (
    (select public.get_my_role()) = 'provider'
    and appointment_id in (
      select id from public.appointments
      where professional_id in (
        select id from public.professionals
        where profile_id = (select id from public.profiles where user_id = auth.uid())
      )
    )
  );

-- =============================================================================
-- APPOINTMENT_AUDIT_LOG: POLICIES
-- Read-only for Admin/Staff/Provider (own)
-- Writes happen via SECURITY DEFINER triggers
-- =============================================================================

-- Admin can read all audit logs
create policy "appointment_audit_log_select_admin"
  on public.appointment_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- Staff can read all audit logs
create policy "appointment_audit_log_select_staff"
  on public.appointment_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'staff'
  );

-- Provider can read audit logs for their own appointments/availability
create policy "appointment_audit_log_select_provider_own"
  on public.appointment_audit_log
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and professional_id in (
      select id from public.professionals
      where profile_id = (select id from public.profiles where user_id = auth.uid())
    )
  );

-- No INSERT/UPDATE/DELETE policies = denied (writes via SECURITY DEFINER triggers only)

-- =============================================================================
-- REVOKE ANON ACCESS
-- =============================================================================

revoke all on public.availability_blocks from anon;
revoke all on public.appointments from anon;
revoke all on public.appointment_clients from anon;
revoke all on public.appointment_audit_log from anon;
