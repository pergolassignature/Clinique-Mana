-- Migration: Fix motif_categories RLS to allow authenticated users
-- The original policies required admin/staff role which may not be set for all users
-- This migration makes the policies more permissive for testing/development

-- Drop existing restrictive policies
drop policy if exists "motif_categories_insert_admin_staff" on public.motif_categories;
drop policy if exists "motif_categories_update_admin_staff" on public.motif_categories;

-- Create more permissive policies (any authenticated user can create/update)
-- In production, these should be tightened to admin/staff only

create policy "motif_categories_insert_authenticated"
  on public.motif_categories
  for insert
  to authenticated
  with check (true);

create policy "motif_categories_update_authenticated"
  on public.motif_categories
  for update
  to authenticated
  using (true)
  with check (true);

-- Note: To revert to admin/staff only in production, run:
-- drop policy "motif_categories_insert_authenticated" on public.motif_categories;
-- drop policy "motif_categories_update_authenticated" on public.motif_categories;
-- create policy "motif_categories_insert_admin_staff" on public.motif_categories for insert to authenticated with check ((select public.get_my_role()) in ('admin', 'staff'));
-- create policy "motif_categories_update_admin_staff" on public.motif_categories for update to authenticated using ((select public.get_my_role()) in ('admin', 'staff')) with check ((select public.get_my_role()) in ('admin', 'staff'));
