-- =============================================================================
-- Clients: the list's order by file number or newest files (A-3, parity audit L17)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (post-cutover audit A-3: the Clients list's sort and column
--          picker); decision CL-32.
-- Needs:   *_clients_list_last_visit.sql, *_clients_imports_security_fixes.sql (latest body).
--
-- `list_clients` is replaced (two parameters and one column added, the rest as the latest body):
-- * `p_sort` also takes `number` (the file number, ascending; keyset `p_after_number`) and
--   `created_recent` (the newest files first; keyset `p_after_created` with the id); neither
--   needs `appointments.view` (only the last appointment's orders and filter do);
-- * each row carries the file's `created_at` (« Ouvert le », a column the picker offers).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_list_sorts', true);

drop function public.list_clients(text, text, uuid, uuid, text, text, uuid, int, text, text, timestamptz);

create function public.list_clients(
  p_query text default null,
  p_status text default 'active',
  p_professional_id uuid default null,
  p_tag_id uuid default null,
  p_after_last text default null,
  p_after_first text default null,
  p_after_id uuid default null,
  p_limit int default 50,
  p_sort text default 'name',
  p_last_visit text default null,
  p_after_visit timestamptz default null,
  p_after_number int default null,
  p_after_created timestamptz default null
)
returns table (id uuid, client_number int, first_name text, last_name text, birthday date, email text,
               mobile_e164 text, primary_professional_id uuid, is_archived boolean, tag_ids uuid[],
               rate_variant text, tax_exempt boolean, is_banned boolean, file_incomplete boolean,
               special_agreement boolean, sort_last text, sort_first text, last_visit_at timestamptz,
               sort_visit timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_words text[];
  v_visits boolean := private.has_permission('appointments.view');
  v_sort text := coalesce(p_sort, 'name');
  v_tz text;
  v_today date;
begin
  if not private.has_permission('clients.view') then
    raise exception 'Permission refusée : clients.view' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'archived', 'all') then
    raise exception 'État inconnu : %', p_status using errcode = '22023';
  end if;
  if v_sort not in ('name', 'number', 'created_recent', 'visit_recent', 'visit_oldest') then
    raise exception 'Tri inconnu : %', p_sort using errcode = '22023';
  end if;
  if p_last_visit is not null and p_last_visit not in ('within_30', 'within_90', 'over_90', 'over_180', 'over_365', 'never') then
    raise exception 'Filtre inconnu : %', p_last_visit using errcode = '22023';
  end if;
  if not v_visits and (v_sort in ('visit_recent', 'visit_oldest') or p_last_visit is not null) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  select o.timezone into v_tz from public.organizations o where o.id = v_org;
  v_tz := coalesce(v_tz, 'America/Toronto');
  v_today := (pg_catalog.now() at time zone v_tz)::date;
  v_words := array(select w from pg_catalog.regexp_split_to_table(private.clients_name_form(pg_catalog.left(p_query, 200)), ' ') w where w <> '');
  return query
    with visits as (
      select v.client_id, v.last_at from private.appointments_last_visits(v_org) v where v_visits
    ), page as (
      select c.*, private.clients_name_form(c.last_name) as s_last, private.clients_name_form(c.first_name) as s_first,
             vi.last_at,
             case v_sort when 'visit_recent' then coalesce(vi.last_at, '-infinity'::timestamptz)
                         when 'visit_oldest' then coalesce(vi.last_at, 'infinity'::timestamptz) end as s_visit
        from public.clients c
        left join visits vi on vi.client_id = c.id
       where c.org_id = v_org
         and c.merged_into_id is null and c.anonymized_at is null
         and (p_status = 'all' or (p_status = 'active') = (c.archived_at is null))
         and (p_professional_id is null or c.primary_professional_id = p_professional_id)
         and (p_tag_id is null or exists (select 1 from public.client_tag_links l where l.client_id = c.id and l.tag_id = p_tag_id))
         and (p_last_visit is null
              or (p_last_visit = 'never' and vi.last_at is null)
              or (p_last_visit = 'within_30' and vi.last_at >= ((v_today - 30)::timestamp at time zone v_tz))
              or (p_last_visit = 'within_90' and vi.last_at >= ((v_today - 90)::timestamp at time zone v_tz))
              or (p_last_visit = 'over_90' and vi.last_at < ((v_today - 90)::timestamp at time zone v_tz))
              or (p_last_visit = 'over_180' and vi.last_at < ((v_today - 180)::timestamp at time zone v_tz))
              or (p_last_visit = 'over_365' and vi.last_at < ((v_today - 365)::timestamp at time zone v_tz)))
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
           p.rate_variant, p.tax_exempt, p.is_banned, p.file_incomplete, p.special_agreement, p.s_last, p.s_first,
           p.last_at, p.s_visit, p.created_at
      from page p
     where p_after_id is null
        or (v_sort = 'name' and (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id))
        or (v_sort = 'visit_recent' and (p.s_visit < p_after_visit
              or (p.s_visit = p_after_visit and (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id))))
        or (v_sort = 'visit_oldest' and (p.s_visit > p_after_visit
              or (p.s_visit = p_after_visit and (p.s_last, p.s_first, p.id) > (coalesce(p_after_last, ''), coalesce(p_after_first, ''), p_after_id))))
        or (v_sort = 'number' and p.client_number > p_after_number)
        or (v_sort = 'created_recent' and (p.created_at, p.id) < (p_after_created, p_after_id))
     order by case when v_sort = 'visit_recent' then p.s_visit end desc,
              case when v_sort = 'visit_oldest' then p.s_visit end asc,
              case when v_sort = 'number' then p.client_number end asc,
              case when v_sort = 'created_recent' then p.created_at end desc,
              case when v_sort = 'created_recent' then p.id end desc,
              p.s_last, p.s_first, p.id
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.list_clients(text, text, uuid, uuid, text, text, uuid, int, text, text, timestamptz, int, timestamptz) from public, anon, authenticated;
grant execute on function public.list_clients(text, text, uuid, uuid, text, text, uuid, int, text, text, timestamptz, int, timestamptz) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
