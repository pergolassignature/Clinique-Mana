-- Migration: Add RLS write policy for profession_categories
-- Allows admin/staff to update profession_categories (e.g., tax_included flag)

-- =============================================================================
-- PROFESSION_CATEGORIES: Add UPDATE policy for admin/staff
-- =============================================================================

-- Add UPDATE policy using get_my_role() helper
create policy "profession_categories_update_authenticated"
  on public.profession_categories for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  )
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- =============================================================================
-- COMMENTS
-- =============================================================================

comment on policy "profession_categories_update_authenticated" on public.profession_categories is 'Allows admin/staff to update profession category settings (e.g., tax_included flag)';
