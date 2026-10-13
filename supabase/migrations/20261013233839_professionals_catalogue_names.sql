-- =============================================================================
-- Professionnels: the names of its catalogue rows, inactive ones included (for reports)
-- =============================================================================
-- Decisions: D-43 (decisions log; Demandes D6)
--
-- A report on a past period names what was chosen then, even when a clientèle or a profession has
-- been retired since (`clienteles_catalog` and `profession_titles_catalog` list the active rows
-- only). On the pattern of `private.professional_display_names`, for definer callers after their
-- own permission check, with the org they verified; granted to no role:
--   * `private.clientele_names(org, ids[])` → (clientele_id, name);
--   * `private.profession_title_names(org, ids[])` → (title_id, name).
-- Additive: two functions.
-- =============================================================================

create function private.clientele_names(p_org uuid, p_ids uuid[])
returns table (clientele_id uuid, name text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name from public.clienteles c where c.org_id = p_org and c.id = any (coalesce(p_ids, '{}'))
$$;

create function private.profession_title_names(p_org uuid, p_ids uuid[])
returns table (title_id uuid, name text)
language sql
stable
set search_path = ''
as $$
  select t.id, t.name from public.profession_titles t where t.org_id = p_org and t.id = any (coalesce(p_ids, '{}'))
$$;

revoke all on function private.clientele_names(uuid, uuid[]), private.profession_title_names(uuid, uuid[])
  from public, anon, authenticated, service_role;
