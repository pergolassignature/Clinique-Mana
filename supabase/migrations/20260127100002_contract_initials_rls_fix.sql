-- ============================================================================
-- FIX: Add UPDATE policy for contract_initials for anonymous users
-- ============================================================================
-- The upsert operation in saveContractInitials requires UPDATE permission
-- in addition to INSERT. This migration adds the missing UPDATE policy.
-- ============================================================================

-- Allow anon to update initials for contracts being signed
create policy "contract_initials_update_anon"
  on public.contract_initials for update
  to anon
  using (
    exists (
      select 1 from public.service_contracts
      where service_contracts.id = contract_initials.contract_id
      and service_contracts.status = 'sent'
      and service_contracts.expires_at > now()
    )
  );
