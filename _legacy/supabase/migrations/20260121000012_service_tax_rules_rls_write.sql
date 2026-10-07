-- Migration: Add write access RLS policies for service_tax_rules
-- Purpose: Allow authenticated clinic staff to manage tax rules for services
-- The existing policies only allow SELECT for authenticated users and ALL for service_role

-- Add INSERT policy for authenticated users (admin/staff)
create policy "service_tax_rules_insert_authenticated"
  on public.service_tax_rules for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'staff')
        and profiles.status = 'active'
    )
  );

-- Add UPDATE policy for authenticated users (admin/staff)
create policy "service_tax_rules_update_authenticated"
  on public.service_tax_rules for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'staff')
        and profiles.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'staff')
        and profiles.status = 'active'
    )
  );

-- Add DELETE policy for authenticated users (admin/staff)
create policy "service_tax_rules_delete_authenticated"
  on public.service_tax_rules for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role in ('admin', 'staff')
        and profiles.status = 'active'
    )
  );

comment on policy "service_tax_rules_insert_authenticated" on public.service_tax_rules is 'Allows admin/staff to add tax rules for services';
comment on policy "service_tax_rules_update_authenticated" on public.service_tax_rules is 'Allows admin/staff to update tax rules for services';
comment on policy "service_tax_rules_delete_authenticated" on public.service_tax_rules is 'Allows admin/staff to remove tax rules from services';
