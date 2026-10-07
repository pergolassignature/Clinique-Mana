-- Migration: external_payers_rls
-- Module: external-payers
-- Gate: 3 — Security (RLS)
-- Created: 2026-01-21

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================================

alter table public.clinic_settings enable row level security;
alter table public.professional_ivac_numbers enable row level security;
alter table public.client_external_payers enable row level security;
alter table public.client_payer_ivac enable row level security;
alter table public.client_payer_pae enable row level security;

-- =============================================================================
-- CLINIC SETTINGS: POLICIES
-- Read: all authenticated users (admin, staff, provider)
-- Write: admin only
-- =============================================================================

create policy "clinic_settings_select_authenticated"
  on public.clinic_settings
  for select
  to authenticated
  using (true);

create policy "clinic_settings_update_admin"
  on public.clinic_settings
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- No INSERT/DELETE policies needed (singleton row created in migration)

-- =============================================================================
-- PROFESSIONAL IVAC NUMBERS: POLICIES
-- Read: all authenticated users
-- Write: admin only
-- =============================================================================

create policy "professional_ivac_numbers_select_authenticated"
  on public.professional_ivac_numbers
  for select
  to authenticated
  using (true);

create policy "professional_ivac_numbers_insert_admin"
  on public.professional_ivac_numbers
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "professional_ivac_numbers_update_admin"
  on public.professional_ivac_numbers
  for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  )
  with check (
    (select public.get_my_role()) = 'admin'
  );

create policy "professional_ivac_numbers_delete_admin"
  on public.professional_ivac_numbers
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- CLIENT EXTERNAL PAYERS: POLICIES
-- Same access pattern as clients table
-- =============================================================================

-- SELECT: Admin and Staff can see all; Provider can see for assigned clients
create policy "client_external_payers_select_admin_staff"
  on public.client_external_payers
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_external_payers_select_provider_assigned"
  on public.client_external_payers
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

-- INSERT: Admin and Staff only
create policy "client_external_payers_insert_admin_staff"
  on public.client_external_payers
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- UPDATE: Admin and Staff only
create policy "client_external_payers_update_admin_staff"
  on public.client_external_payers
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- DELETE: Admin only (soft delete via is_active preferred)
create policy "client_external_payers_delete_admin"
  on public.client_external_payers
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- CLIENT PAYER IVAC: POLICIES
-- Access follows client_external_payers base table
-- =============================================================================

create policy "client_payer_ivac_select_admin_staff"
  on public.client_payer_ivac
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_payer_ivac_select_provider_assigned"
  on public.client_payer_ivac
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and payer_id in (
      select cep.id from public.client_external_payers cep
      join public.clients c on c.id = cep.client_id
      where c.primary_professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "client_payer_ivac_insert_admin_staff"
  on public.client_payer_ivac
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_payer_ivac_update_admin_staff"
  on public.client_payer_ivac
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_payer_ivac_delete_admin"
  on public.client_payer_ivac
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- CLIENT PAYER PAE: POLICIES
-- Access follows client_external_payers base table
-- =============================================================================

create policy "client_payer_pae_select_admin_staff"
  on public.client_payer_pae
  for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_payer_pae_select_provider_assigned"
  on public.client_payer_pae
  for select
  to authenticated
  using (
    (select public.get_my_role()) = 'provider'
    and payer_id in (
      select cep.id from public.client_external_payers cep
      join public.clients c on c.id = cep.client_id
      where c.primary_professional_id = (
        select p.id from public.professionals p
        join public.profiles pr on pr.id = p.profile_id
        where pr.user_id = auth.uid()
      )
    )
  );

create policy "client_payer_pae_insert_admin_staff"
  on public.client_payer_pae
  for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_payer_pae_update_admin_staff"
  on public.client_payer_pae
  for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

create policy "client_payer_pae_delete_admin"
  on public.client_payer_pae
  for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- =============================================================================
-- ANON ROLE: DENY ALL
-- =============================================================================

revoke all on public.clinic_settings from anon;
revoke all on public.professional_ivac_numbers from anon;
revoke all on public.client_external_payers from anon;
revoke all on public.client_payer_ivac from anon;
revoke all on public.client_payer_pae from anon;
