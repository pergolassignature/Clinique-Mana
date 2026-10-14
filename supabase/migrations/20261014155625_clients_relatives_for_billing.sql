-- =============================================================================
-- Clients: a file's relatives, published for Facturation (R-78)
-- =============================================================================
-- Decision: R-78 (Christine, answer 7 of the second series: no file-opening fee for a new file
-- when a relative already has a billed file).
--
-- * `private.client_relative_ids(org, client)`: the files linked to this one by a relation
--   (`client_relations`, either side of the pair, whatever its type or its rights). For definer
--   callers after their own permission check, with the org they verified; granted to no role.
--   Facturation reads it instead of this module's table (CLAUDE.md §5).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_relatives_for_billing', true);

create function private.client_relative_ids(p_org uuid, p_client_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select r.client_b_id from public.client_relations r where r.org_id = p_org and r.client_a_id = p_client_id
  union
  select r.client_a_id from public.client_relations r where r.org_id = p_org and r.client_b_id = p_client_id
$$;
revoke all on function private.client_relative_ids(uuid, uuid) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
