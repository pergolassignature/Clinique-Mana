-- =============================================================================
-- Clients: a match fills the primary professional of the files that have none (A-6)
-- =============================================================================
-- Parity audit L19 (docs/plans/2026-10-13-parity-audit.md); legacy « Assign … then sets
-- primary_professional_id on participants that have none » (inventory §C). Decision D-41.
--
-- `private.clients_fill_primary_professional(org, client_ids, professional)`: the files of p_org
-- among p_client_ids that have no primary professional get p_professional_id; a file that has one
-- keeps it; merged and anonymised files are left alone. Returns how many changed. For definer
-- callers (Demandes' match, through `private.demandes_link_clients`), after their own permission
-- check, with the org they verified and a professional of that clinic (the foreign key). Granted to
-- no role. The audit row carries the caller's source.
-- Additive: one function.
-- =============================================================================

create function private.clients_fill_primary_professional(p_org uuid, p_client_ids uuid[], p_professional_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_org is null or p_professional_id is null or coalesce(pg_catalog.cardinality(p_client_ids), 0) = 0 then
    return 0;
  end if;
  update public.clients c
     set primary_professional_id = p_professional_id
   where c.org_id = p_org
     and c.id = any (p_client_ids)
     and c.primary_professional_id is null
     and c.merged_into_id is null
     and c.anonymized_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.clients_fill_primary_professional(uuid, uuid[], uuid) from public, anon, authenticated, service_role;
