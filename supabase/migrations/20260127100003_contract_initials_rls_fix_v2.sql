-- ============================================================================
-- FIX: Contract initials RLS using security definer function
-- ============================================================================
-- The INSERT policy's subquery to service_contracts is subject to RLS,
-- creating a circular dependency. This migration creates a security definer
-- function to bypass the RLS check and allow the insert.
-- ============================================================================

-- Drop the existing policies that aren't working
drop policy if exists "contract_initials_insert_anon" on public.contract_initials;
drop policy if exists "contract_initials_update_anon" on public.contract_initials;
drop policy if exists "contract_initials_select_anon" on public.contract_initials;

-- Create a security definer function to check if a contract is valid for signing
create or replace function public.is_contract_signable(p_contract_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.service_contracts
    where id = p_contract_id
    and status = 'sent'
    and expires_at > now()
  );
$$;

-- Grant execute permission to anon
grant execute on function public.is_contract_signable(uuid) to anon;

-- Recreate policies using the security definer function
create policy "contract_initials_insert_anon"
  on public.contract_initials for insert
  to anon
  with check (public.is_contract_signable(contract_id));

create policy "contract_initials_update_anon"
  on public.contract_initials for update
  to anon
  using (public.is_contract_signable(contract_id));

create policy "contract_initials_select_anon"
  on public.contract_initials for select
  to anon
  using (public.is_contract_signable(contract_id));
