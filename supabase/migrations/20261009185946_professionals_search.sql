-- =============================================================================
-- Professionnels: the global search (⌘K, « Rechercher… »)
-- =============================================================================
-- The palette asks each enabled module for records (manifest `search`); this is the
-- professionals' read. `professionals_list` has no search parameter (the list page filters in the
-- browser), and the palette must not load every row to find one.
--
-- * search_professionals(p_query, p_limit): professionals.view first (42501 otherwise: the
--   provider, a disabled module), the caller's clinic only (definer, so the org filter is
--   explicit). Every word of the query (at most 5, the query cut at 100 characters) must match one
--   of: the first or last name (lower case, accents removed: « genevieve » finds Geneviève), the
--   email, any of the professional's licence numbers or her IVAC number (letters and digits only:
--   « ts-04518 » finds TS04518). LIKE's wildcards are escaped. Under two characters: nothing.
-- * Returns the name, the stored and displayed status (P4-43: in_review reads « En préparation »
--   once the onboarding questionnaire is approved and nothing waits) and the primary profession
--   (gendered label, order acronym, licence): what the list shows, never the email nor any private
--   data. Names starting with the first word first, then by name; p_limit clamped to 1–20.
-- * No index: a clinic has at most 500 professionals (the list's cap) read through the
--   (org_id, id) key, and pg_trgm is not installed; unaccent is (*_professionals_reference_settings).
-- =============================================================================

-- Lower case without accents, as the browser's fold (`list-search.ts`). The two-argument unaccent
-- names its dictionary (the search_path is empty).
create function private.search_fold(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')))
$$;
revoke all on function private.search_fold(text) from public, anon, authenticated, service_role;

-- A LIKE pattern matching `p_text` anywhere, its % _ \ taken literally.
create function private.like_contains(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
revoke all on function private.like_contains(text) from public, anon, authenticated, service_role;

create function public.search_professionals(p_query text, p_limit integer default 8)
returns table (
  id uuid, first_name text, last_name text, status text, display_status text,
  title_label text, order_acronym text, licence_number text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_words text[];
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();

  v_words := array(
    select w
      from pg_catalog.regexp_split_to_table(
             pg_catalog.btrim(private.search_fold(pg_catalog.left(p_query, 100)), E' \t\r\n'), E'\\s+') w
     where w <> ''
     limit 5);
  if pg_catalog.char_length(pg_catalog.array_to_string(v_words, '')) < 2 then
    return;
  end if;

  return query
  with c as (
    select p.id, p.first_name, p.last_name, p.status, p.gender,
           private.search_fold(p.first_name) as first_f,
           private.search_fold(p.last_name) as last_f,
           p.email,
           -- Licences and the IVAC number, letters and digits only, lower case.
           pg_catalog.lower(pg_catalog.regexp_replace(
             coalesce((select pg_catalog.string_agg(x.licence_number, ' ')
                         from public.professional_professions x
                        where x.org_id = p.org_id and x.professional_id = p.id), '')
             || ' ' ||
             coalesce((select pg_catalog.string_agg(n.number, ' ')
                         from public.professional_payer_numbers n
                        where n.org_id = p.org_id and n.professional_id = p.id), ''),
             '[^A-Za-z0-9 ]', '', 'g')) as numbers
      from public.professionals p
     where p.org_id = v_org
  ), m as (
    select c.*
      from c
     where (select pg_catalog.bool_and(
                     c.first_f like private.like_contains(w)
                     or c.last_f like private.like_contains(w)
                     or c.email like private.like_contains(w)
                     or (pg_catalog.regexp_replace(w, '[^a-z0-9]', '', 'g') <> ''
                         and c.numbers like private.like_contains(pg_catalog.regexp_replace(w, '[^a-z0-9]', '', 'g'))))
              from pg_catalog.unnest(v_words) w)
  )
  select m.id, m.first_name, m.last_name, m.status,
         case when m.status = 'in_review'
                   and exists (select 1 from public.professional_submissions s
                                where s.org_id = v_org and s.professional_id = m.id
                                  and s.kind = 'onboarding' and s.status = 'approved')
                   and not exists (select 1 from public.professional_submissions s
                                    where s.org_id = v_org and s.professional_id = m.id and s.status = 'submitted')
              then 'preparing' else m.status end,
         case when pt.id is not null
              then private.profession_title_label(pt.name, pt.name_feminine, pt.name_masculine, m.gender) end,
         po.acronym,
         pp.licence_number
    from m
    left join public.professional_professions pp on pp.professional_id = m.id and pp.is_primary
    left join public.profession_titles pt on pt.org_id = pp.org_id and pt.id = pp.profession_title_id
    left join public.professional_orders po on po.org_id = pt.org_id and po.id = pt.order_id
   order by (pg_catalog.starts_with(m.first_f, v_words[1]) or pg_catalog.starts_with(m.last_f, v_words[1])) desc,
            m.last_name, m.first_name, m.id
   limit v_limit;
end;
$$;

revoke all on function public.search_professionals(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_professionals(text, integer) to authenticated;
