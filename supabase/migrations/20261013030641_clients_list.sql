-- =============================================================================
-- Clients: the list page's read (plan C3.2)
-- =============================================================================
-- ~8 500 files: the list pages on the server with a keyset cursor (last name, first name, id,
-- case and accents ignored), never loading them all. Filters: the words of a search (as
-- search_clients: the name, the email, the number, a phone's digits), the state (active, archived,
-- all), the primary professional, a tag. Merged and anonymised files never show. clients.view
-- first; the caller's clinic only; the columns the list shows, nothing else (no notes, no address).
-- =============================================================================

create function public.list_clients(
  p_query text default null,
  p_status text default 'active',
  p_professional_id uuid default null,
  p_tag_id uuid default null,
  p_after_last text default null,
  p_after_first text default null,
  p_after_id uuid default null,
  p_limit int default 50
)
returns table (id uuid, client_number int, first_name text, last_name text, birthday date, email text,
               mobile_e164 text, primary_professional_id uuid, is_archived boolean, tag_ids uuid[],
               rate_variant text, tax_exempt boolean, is_banned boolean, file_incomplete boolean,
               special_agreement boolean, sort_last text, sort_first text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_words text[];
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'archived', 'all') then
    raise exception 'État inconnu : %', p_status using errcode = '22023';
  end if;
  v_words := array(select w from pg_catalog.regexp_split_to_table(private.clients_name_form(p_query), ' ') w where w <> '');
  return query
    with page as (
      select c.*, private.clients_name_form(c.last_name) as s_last, private.clients_name_form(c.first_name) as s_first
        from public.clients c
       where c.org_id = v_org
         and c.merged_into_id is null and c.anonymized_at is null
         and (p_status = 'all' or (p_status = 'active') = (c.archived_at is null))
         and (p_professional_id is null or c.primary_professional_id = p_professional_id)
         and (p_tag_id is null or exists (select 1 from public.client_tag_links l where l.client_id = c.id and l.tag_id = p_tag_id))
         and not exists (
           select 1 from pg_catalog.unnest(v_words) w
            where not (pg_catalog.strpos(private.clients_name_form(c.first_name || ' ' || c.last_name), w) > 0
                       or pg_catalog.strpos(coalesce(c.email, ''), w) > 0
                       or c.client_number::text = w
                       or (pg_catalog.regexp_replace(w, '[^0-9]', '', 'g') ~ '^[0-9]{3,}$'
                           and pg_catalog.strpos(pg_catalog.regexp_replace(concat_ws(' ', c.mobile_e164, c.home_e164, c.work_e164), '[^0-9 ]', '', 'g'),
                                                 pg_catalog.regexp_replace(w, '[^0-9]', '', 'g')) > 0)))
    )
    select p.id, p.client_number, p.first_name, p.last_name, p.birthday, p.email, p.mobile_e164,
           p.primary_professional_id, p.archived_at is not null,
           coalesce((select array_agg(l.tag_id order by l.created_at) from public.client_tag_links l where l.client_id = p.id), '{}'),
           p.rate_variant, p.tax_exempt, p.is_banned, p.file_incomplete, p.special_agreement, p.s_last, p.s_first
      from page p
     where p_after_id is null
        or (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id)
     order by p.s_last, p.s_first, p.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.list_clients(text, text, uuid, uuid, text, text, uuid, int) from public, anon, authenticated;
grant execute on function public.list_clients(text, text, uuid, uuid, text, text, uuid, int) to authenticated;
