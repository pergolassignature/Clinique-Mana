-- =============================================================================
-- Clients: finding an imported file by its name (GOrendezvous import, I3)
-- =============================================================================
-- Asked:     coordinator, 2026-10-13 (the billing import); agreed with lane C (the import tool)
-- Decisions: BI-20 (decisions log)
--
-- GOrendezvous's « Revenus » exports name the client, never its id. Facturation's import finds the
-- dossier through `private.clients_import_match(org, ref, name)` (granted to no role):
-- * `ref` given (« gorendezvous:<ClientId> », the tool's --clients-map for the homonyms): the file
--   imported with that reference;
-- * else the name, among the imported files (`external_ref` « gorendezvous:… »): the same words
--   whatever their order, case, accents and punctuation (« Tremblay, Marie-Ève » = « marie eve
--   tremblay »), exactly one file.
-- A merged file leads along its merges to the one kept; an anonymised file, found or kept, is
-- never returned. Returns `status` `ok`,
-- `not_found` or `ambiguous`, and the file's id when `ok`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_import_match', true);

-- The words of a name, folded and sorted: « Marie-Ève Tremblay » → « eve marie tremblay ».
-- Immutable for its index (unaccent's dictionary is fixed).
create function private.clients_import_name_key(p_first text, p_last text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.string_agg(w, ' ' order by w)
    from pg_catalog.regexp_split_to_table(
           pg_catalog.btrim(pg_catalog.regexp_replace(
             pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_first, '') || ' ' || coalesce(p_last, ''))),
             '[^a-z0-9]+', ' ', 'g')),
           ' ') w
   where w <> ''
$$;
revoke all on function private.clients_import_name_key(text, text) from public, anon, authenticated, service_role;

create index clients_org_import_name_idx on public.clients (org_id, private.clients_import_name_key(first_name, last_name))
  where external_ref like 'gorendezvous:%';

create function private.clients_import_match(p_org uuid, p_ref text, p_name text, out status text, out client_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- The files found, each followed along its merges to the file kept (a bounded chain), which
  -- must not be anonymised.
  with recursive found as (
    select c.id
      from public.clients c
     where c.org_id = p_org and c.anonymized_at is null
       and case when nullif(pg_catalog.btrim(coalesce(p_ref, '')), '') is not null
                then c.external_ref = pg_catalog.btrim(p_ref)
                else c.external_ref like 'gorendezvous:%'
                     and private.clients_import_name_key(p_name, null) is not null
                     and private.clients_import_name_key(c.first_name, c.last_name) = private.clients_import_name_key(p_name, null) end
  ), chain (start_id, id, merged_into_id, anonymized_at, depth) as (
    select f.id, c.id, c.merged_into_id, c.anonymized_at, 0
      from found f join public.clients c on c.id = f.id
    union all
    select ch.start_id, c.id, c.merged_into_id, c.anonymized_at, ch.depth + 1
      from chain ch join public.clients c on c.org_id = p_org and c.id = ch.merged_into_id
     where ch.depth < 20
  )
  select pg_catalog.array_agg(distinct ch.id) into v_ids
    from chain ch
   where ch.merged_into_id is null and ch.anonymized_at is null;
  if coalesce(pg_catalog.cardinality(v_ids), 0) = 0 then
    status := 'not_found';
  elsif pg_catalog.cardinality(v_ids) > 1 then
    status := 'ambiguous';
  else
    status := 'ok';
    client_id := v_ids[1];
  end if;
end;
$$;
revoke all on function private.clients_import_match(uuid, text, text) from public, anon, authenticated, service_role;

select pg_catalog.set_config('app.audit_source', '', true);
