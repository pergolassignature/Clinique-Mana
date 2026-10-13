-- =============================================================================
-- Clients: the facts Facturation needs about a file (F1), published as a private helper
-- =============================================================================
-- Facturation prices a session with the client's rate variant and « Statut Indien » (R-5, R-64),
-- names the file on the invoice and refuses a closed one, without reading this module's tables
-- (CLAUDE.md §5). For definer callers after their own permission check, with the org they
-- verified; granted to no role. Unknown ids or another clinic's: `found` false.
-- =============================================================================

create function private.clients_billing_facts(p_org uuid, p_client_ids uuid[])
returns table (
  ord int, client_id uuid, found boolean, client_number int, display_name text, first_name text, rate_variant text,
  tax_exempt boolean, language text, is_archived boolean, is_closed boolean
)
language sql
stable
set search_path = ''
as $$
  select x.ord::int, x.id, c.id is not null, c.client_number, c.first_name || ' ' || c.last_name, c.first_name, c.rate_variant,
         coalesce(c.tax_exempt, false), c.language,
         coalesce(c.archived_at is not null, false),
         coalesce(c.merged_into_id is not null or c.anonymized_at is not null, false)
    from pg_catalog.unnest(coalesce(p_client_ids, '{}'::uuid[])) with ordinality as x(id, ord)
    left join public.clients c on c.org_id = p_org and c.id = x.id
   order by x.ord
$$;
revoke all on function private.clients_billing_facts(uuid, uuid[]) from public, anon, authenticated, service_role;
