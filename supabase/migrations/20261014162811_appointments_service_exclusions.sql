-- =============================================================================
-- Rendez-vous: never a service the professional does not offer (decision R-83)
-- =============================================================================
-- Decision: R-83 (decisions log); Services et tarifs' list of the services a professional does not
--           offer (`20261014162731_services_professional_exclusions.sql`), read through its
--           published helper `private.service_excluded_for` (never its table).
--
-- * A guard on `appointments` (BEFORE INSERT, and UPDATE OF service_id or professional_id): a
--   booking, a hold, a series, a proposal's appointment or a move to another professional or
--   service is refused in French (P0001, HINT `service_id`, « Ce professionnel n'offre pas ce
--   service. ») when she does not offer the service. A trigger rather than a change to every
--   booking RPC (they all reach this table), so the rule holds whoever writes. Untouched: a
--   personal appointment (no service), a move in time (same service and professional), and an
--   imported appointment (`external_ref` on insert: GOrendezvous's history is kept as it was).
-- * « Mon agenda »'s reference (`get_my_agenda_reference`, latest body
--   20261013100856_appointments_publications.sql): her services leave out the ones she does not
--   offer. The staff's pickers read `services_catalog.excluded_professional_ids` (the app).
-- * `get_open_slots` (latest body 20261014000122_appointments_google_busy.sql, otherwise unchanged)
--   refuses a service she does not offer as it refuses one her titles do not offer (P0001, HINT
--   `service_id`): no slot is ever proposed for it.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_service_exclusions', true);

-- Definer: whoever writes the row (a definer RPC, the service role), the list is read the same way.
create function private.appointments_check_service_offered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.external_ref is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.service_id is not distinct from old.service_id and new.professional_id is not distinct from old.professional_id then
    return new;
  end if;
  if private.service_excluded_for(new.org_id, new.professional_id, new.service_id) then
    raise exception 'Ce professionnel n''offre pas ce service.' using errcode = 'P0001', hint = 'service_id';
  end if;
  return new;
end;
$$;
revoke all on function private.appointments_check_service_offered() from public, anon, authenticated, service_role;

create trigger appointments_check_service_offered
  before insert or update of service_id, professional_id on public.appointments
  for each row execute function private.appointments_check_service_offered();

-- « Mon agenda »'s reference: the professional herself and the services she offers.
create or replace function public.get_my_agenda_reference()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_me uuid := private.current_professional_id();
  v_pro record;
begin
  if v_me is null or not private.has_permission('appointments.self') then
    raise exception 'Permission refusée : appointments.self' using errcode = '42501';
  end if;
  select * into v_pro from private.professional_booking_facts(v_org, v_me);
  return pg_catalog.jsonb_build_object(
    'professional', pg_catalog.jsonb_build_object(
      'id', v_me,
      'display_name', (select n.display_name from private.professional_display_names(v_org, array[v_me]) n),
      'status', v_pro.status,
      'professions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('title_id', x)) from pg_catalog.unnest(v_pro.title_ids) x), '[]'::jsonb)),
    'services', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', s.id, 'code', s.code, 'name', s.name, 'duration_minutes', s.duration_minutes,
               'buffer_after_minutes', s.buffer_after_minutes, 'for_two', s.for_two, 'colour', s.colour,
               'title_ids', s.title_ids) order by s.code)
        from public.services_catalog s
       where s.org_id = v_org and s.duration_minutes > 0
         and (pg_catalog.cardinality(s.title_ids) = 0 or s.title_ids && coalesce(v_pro.title_ids, '{}'))
         -- R-83: never one she does not offer.
         and not private.service_excluded_for(v_org, v_me, s.id)), '[]'::jsonb));
end;
$$;

-- Open slots: never for a service she does not offer.
create or replace function public.get_open_slots(p_professional_id uuid, p_service_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_tz text := private.appointments_tz(v_org);
  v_pro record;
  v_service record;
  v_slot interval;
  v_length interval;
begin
  if not (private.has_permission('appointments.view')
          or (private.has_permission('appointments.self') and p_professional_id = private.current_professional_id())) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choisissez une période de 62 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  select * into v_pro from private.appointments_professional(v_org, p_professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids, true);
  -- R-83: a service she does not offer has no slot (as a service her titles do not offer).
  if private.service_excluded_for(v_org, p_professional_id, p_service_id) then
    raise exception 'Ce professionnel n''offre pas ce service.' using errcode = 'P0001', hint = 'service_id';
  end if;
  v_length := pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_slot := pg_catalog.make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes);
  return query
    select s.starts_at, s.starts_at + v_length
      from (select distinct ((d.day + r.start_time) at time zone v_tz) + k.n * v_slot as starts_at,
                   r.end_time, r.overflow_allowed, d.day
              from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d0(ts)
             cross join lateral (select d0.ts::date as day) d
              join public.availability_rules r
                on r.org_id = v_org and r.professional_id = p_professional_id
               and r.weekday = extract(isodow from d.day)::smallint
               and d.day >= r.valid_from and (r.valid_until is null or d.day <= r.valid_until)
               and (pg_catalog.cardinality(r.service_ids) = 0 or p_service_id = any (r.service_ids))
             cross join lateral pg_catalog.generate_series(
                   0, pg_catalog.ceil(extract(epoch from (r.end_time - r.start_time)) / extract(epoch from v_slot))::int) as k(n)) s
     where ((s.starts_at at time zone v_tz)::date = s.day)
       and ((s.starts_at + v_length) at time zone v_tz)::date = s.day
       and (case when s.overflow_allowed then (s.starts_at at time zone v_tz)::time < s.end_time
                 else ((s.starts_at + v_length) at time zone v_tz)::time <= s.end_time end)
       and s.starts_at >= now()
       and not exists (select 1 from public.availability_exceptions e
                        where e.org_id = v_org and e.professional_id = p_professional_id
                          and pg_catalog.tstzrange(e.starts_at, e.ends_at, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_length, '[)'))
       -- AP-43: her Google busy times (when she connected her agenda).
       and not exists (select 1 from public.external_busy_blocks g
                        where g.org_id = v_org and g.professional_id = p_professional_id
                          and pg_catalog.tstzrange(g.starts_at, g.ends_at, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_length, '[)'))
       and not exists (select 1 from public.appointments a
                        where a.org_id = v_org and a.professional_id = p_professional_id
                          and (a.state <> 'cancelled' or a.kept_on_schedule)
                          and pg_catalog.tstzrange(a.starts_at, a.blocks_until, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_slot, '[)'))
     order by s.starts_at;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
