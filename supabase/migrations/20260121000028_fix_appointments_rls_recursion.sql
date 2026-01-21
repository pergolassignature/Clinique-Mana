-- Migration: fix_appointments_rls_recursion
-- Module: availability
-- Fix: Infinite recursion in appointments UPDATE policy
-- Created: 2026-01-21

-- =============================================================================
-- FIX APPOINTMENTS UPDATE POLICY FOR PROVIDERS
-- The original policy caused infinite recursion by selecting from appointments
-- within the WITH CHECK clause of an appointments RLS policy.
--
-- Solution: Remove the self-referencing check. The USING clause already ensures
-- the provider can only update their own appointments. The WITH CHECK only needs
-- to verify the new row still belongs to the same professional.
-- =============================================================================

-- Drop the problematic policy
drop policy if exists "appointments_update_provider_own" on public.appointments;

-- Create fixed policy without self-referencing check
-- The WITH CHECK ensures the professional_id matches the provider's professional
-- This prevents a provider from reassigning appointments to other professionals
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
  );

-- Note: The WITH CHECK now simply verifies the professional_id belongs to the current user.
-- This still prevents providers from reassigning appointments to other professionals
-- because the professional_id must match their own professional record both before (USING)
-- and after (WITH CHECK) the update.
