-- Migration: Add RLS write access for profession_category_rates
-- Date: 2026-01-21
--
-- Allows admin/staff to update hourly rates from the frontend.

-- UPDATE policy for admin/staff
CREATE POLICY "profession_category_rates_update_authenticated"
  ON public.profession_category_rates FOR UPDATE
  TO authenticated
  USING ((SELECT public.get_my_role()) IN ('admin', 'staff'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('admin', 'staff'));

-- INSERT policy for admin/staff (in case new categories are added)
CREATE POLICY "profession_category_rates_insert_authenticated"
  ON public.profession_category_rates FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('admin', 'staff'));
