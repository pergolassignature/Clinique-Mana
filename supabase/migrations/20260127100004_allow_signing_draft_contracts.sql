-- ============================================================================
-- FIX: Allow signing draft contracts
-- ============================================================================
-- Since we allow copying the signing link for draft contracts (bypassing email),
-- we also need to allow the anonymous user to sign draft contracts.
-- ============================================================================

-- Update the security definer function to allow both draft and sent statuses
create or replace function public.is_contract_signable(p_contract_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.service_contracts
    where id = p_contract_id
    and status in ('draft', 'sent')
    and expires_at > now()
  );
$$;

-- Also need to update the service_contracts SELECT policy for anon
-- to allow reading draft contracts too
drop policy if exists "service_contracts_select_by_token_anon" on public.service_contracts;

create policy "service_contracts_select_by_token_anon"
  on public.service_contracts for select
  to anon
  using (
    token is not null
    and status in ('draft', 'sent')
    and expires_at > now()
  );

-- Update the UPDATE policy to allow signing draft contracts too
drop policy if exists "service_contracts_update_anon_sign" on public.service_contracts;

create policy "service_contracts_update_anon_sign"
  on public.service_contracts for update
  to anon
  using (
    token is not null
    and status in ('draft', 'sent')
    and expires_at > now()
  )
  with check (status = 'signed');
