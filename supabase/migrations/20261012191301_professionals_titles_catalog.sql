-- =============================================================================
-- Professionnels: the published catalogue view of the profession titles (plan S3.1)
-- =============================================================================
-- Services et tarifs says which titles offer a service and prices by title; it reads the titles
-- through this view, never the raw table (CLAUDE.md §5). Same shape as the other catalogue views
-- (motifs_catalog, clienteles_catalog, languages_catalog): active rows only, security invoker,
-- so the table's RLS decides who reads (any professionals permission, the provider included).
-- `name` is the settings form; `name_feminine` / `name_masculine` the forms shown for a person.
-- =============================================================================

create view public.profession_titles_catalog with (security_invoker = true) as
  select t.id, t.org_id, t.key, t.name, t.name_feminine, t.name_masculine, t.category_id, t.order_id, t.sort_order
    from public.profession_titles t
   where t.is_active;

revoke all on public.profession_titles_catalog from anon, authenticated;
grant select on public.profession_titles_catalog to authenticated;
