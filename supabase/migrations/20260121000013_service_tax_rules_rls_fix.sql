-- Migration: Fix RLS policies for services module
-- Problem: Previous policies only allowed SELECT for authenticated users, and
--          service_tax_rules policies queried profiles table directly (causing RLS recursion)
-- Solution: Use the get_my_role() security definer function and add proper write policies

-- =============================================================================
-- SERVICE_TAX_RULES: Fix policies
-- =============================================================================

-- Drop the broken policies from previous migration
drop policy if exists "service_tax_rules_insert_authenticated" on public.service_tax_rules;
drop policy if exists "service_tax_rules_update_authenticated" on public.service_tax_rules;
drop policy if exists "service_tax_rules_delete_authenticated" on public.service_tax_rules;

-- Add INSERT policy using get_my_role() helper
create policy "service_tax_rules_insert_authenticated"
  on public.service_tax_rules for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add UPDATE policy using get_my_role() helper
create policy "service_tax_rules_update_authenticated"
  on public.service_tax_rules for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add DELETE policy using get_my_role() helper
create policy "service_tax_rules_delete_authenticated"
  on public.service_tax_rules for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- SERVICES: Add write policies for admin/staff
-- =============================================================================

-- Add INSERT policy for services
create policy "services_insert_authenticated"
  on public.services for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add UPDATE policy for services
create policy "services_update_authenticated"
  on public.services for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add DELETE policy for services (for archiving - though we use is_active flag)
create policy "services_delete_authenticated"
  on public.services for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- PROFESSIONAL_SERVICES: Add write policies for admin/staff
-- =============================================================================

-- Add INSERT policy for professional_services
create policy "professional_services_insert_authenticated"
  on public.professional_services for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add UPDATE policy for professional_services
create policy "professional_services_update_authenticated"
  on public.professional_services for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add DELETE policy for professional_services
create policy "professional_services_delete_authenticated"
  on public.professional_services for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on policy "service_tax_rules_insert_authenticated" on public.service_tax_rules is 'Allows admin/staff to add tax rules for services';
comment on policy "service_tax_rules_update_authenticated" on public.service_tax_rules is 'Allows admin/staff to update tax rules for services';
comment on policy "service_tax_rules_delete_authenticated" on public.service_tax_rules is 'Allows admin/staff to remove tax rules from services';
comment on policy "services_insert_authenticated" on public.services is 'Allows admin/staff to create services';
comment on policy "services_update_authenticated" on public.services is 'Allows admin/staff to update services';
comment on policy "services_delete_authenticated" on public.services is 'Allows admin/staff to delete services';
comment on policy "professional_services_insert_authenticated" on public.professional_services is 'Allows admin/staff to assign services to professionals';
comment on policy "professional_services_update_authenticated" on public.professional_services is 'Allows admin/staff to update service assignments';
comment on policy "professional_services_delete_authenticated" on public.professional_services is 'Allows admin/staff to remove service assignments';
