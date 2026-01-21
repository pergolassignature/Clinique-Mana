-- Migration: Add RLS write policies for service_prices table
-- Allows admin/staff to manage service pricing

-- Add INSERT policy for service_prices
create policy "service_prices_insert_authenticated"
  on public.service_prices for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add UPDATE policy for service_prices
create policy "service_prices_update_authenticated"
  on public.service_prices for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- Add DELETE policy for service_prices
create policy "service_prices_delete_authenticated"
  on public.service_prices for delete
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

comment on policy "service_prices_insert_authenticated" on public.service_prices is 'Allows admin/staff to add service prices';
comment on policy "service_prices_update_authenticated" on public.service_prices is 'Allows admin/staff to update service prices';
comment on policy "service_prices_delete_authenticated" on public.service_prices is 'Allows admin/staff to remove service prices';
