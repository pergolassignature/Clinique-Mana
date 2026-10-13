-- =============================================================================
-- Rendez-vous: availability by direct manipulation (drag to create, move, resize)
-- =============================================================================
-- Asked:     Jonathan through the coordinator, 2026-10-13 (« le mode disponibilités est trop lourd »)
-- Decisions: AP-27 (decisions log)
--
-- `set_availability_window(id, professional, weekday, start, end, valid_from, valid_until, week)`
-- is what the grid calls on a drop (the full editor keeps `set_availability_rule`):
-- * `id` null: a new window with the defaults (every service, visible to clients, no overflow);
--   else the window's weekday, times and validity change, its other settings kept.
-- * A window with the same settings (services, visibility, overflow, end of validity) that it
--   touches or overlaps on that weekday is merged into it (a chain too): one window from the
--   earliest start to the latest end, valid from the earliest date. One with other settings that
--   overlaps it is refused in French; touching, it stays apart.
-- * `week` (the Monday shown): the time it adds that week may not overlap an exception (one
--   already inside the window, « Bloquer » within it, never stops it from changing).
-- * Returns `{ id, weekday, start_time, end_time, valid_from, valid_until, previous, absorbed,
--   outside_count }`: the row before a change and the windows absorbed (« Annuler » puts them
--   back through the RPCs), and how many coming appointments it leaves outside the availability.
-- =============================================================================

create function public.set_availability_window(
  p_id uuid, p_professional_id uuid, p_weekday int, p_start_time time, p_end_time time,
  p_valid_from date, p_valid_until date, p_week date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_tz text;
  v_existing public.availability_rules;
  v_services uuid[];
  v_visible boolean;
  v_overflow boolean;
  v_from date;
  v_until date := p_valid_until;
  v_start time := p_start_time;
  v_end time := p_end_time;
  v_absorbed jsonb := '[]'::jsonb;
  v_watch uuid[];
  v_outside int;
  v_day date;
  v_same boolean;
  v_id uuid;
  r public.availability_rules;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if p_id is not null then
    select x.* into v_existing from public.availability_rules x where x.org_id = v_org and x.id = p_id for update;
    if v_existing.id is null or v_existing.professional_id <> p_professional_id then
      raise exception 'Plage introuvable.' using errcode = 'P0001', hint = 'rule_id';
    end if;
  end if;
  -- One writer of a professional's windows at a time (the same lock as set_availability_rule).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('availability_rules:' || p_professional_id::text, 0));
  perform private.appointments_professional(v_org, p_professional_id);
  if p_weekday is null or p_weekday not between 1 and 7 then
    raise exception 'Choisissez le jour de la semaine.' using errcode = 'P0001', hint = 'weekday';
  end if;
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    raise exception 'La fin de la plage vient après son début.' using errcode = 'P0001', hint = 'end_time';
  end if;
  if extract(minute from p_start_time)::int % 5 <> 0 or extract(minute from p_end_time)::int % 5 <> 0
     or extract(second from p_start_time) <> 0 or extract(second from p_end_time) <> 0 then
    raise exception 'Les heures d''une plage tombent sur un multiple de 5 minutes.' using errcode = 'P0001', hint = 'start_time';
  end if;
  v_from := coalesce(p_valid_from, private.clinic_today());
  if v_until is not null and v_until < v_from then
    raise exception 'La fin de validité vient après son début.' using errcode = 'P0001', hint = 'valid_until';
  end if;
  v_services := coalesce(v_existing.service_ids, '{}'::uuid[]);
  v_visible := coalesce(v_existing.visible_to_clients, true);
  v_overflow := coalesce(v_existing.overflow_allowed, false);
  v_tz := private.appointments_tz(v_org);

  -- The week shown: the time it adds that week may not overlap an exception (an exception already
  -- inside the window, « Bloquer » within it, never stops the window from changing).
  if p_week is not null then
    v_day := pg_catalog.date_trunc('week', p_week::timestamp)::date + (p_weekday - 1);
    v_same := v_existing.id is not null and v_existing.weekday = p_weekday;
    if v_day >= v_from and (v_until is null or v_day <= v_until)
       and exists (select 1
                     from public.availability_exceptions e,
                          (values (v_start, case when v_same then least(v_end, v_existing.start_time) else v_end end),
                                  (case when v_same then greatest(v_start, v_existing.end_time) else v_end end, v_end)) as part(s, f)
                    where part.s < part.f
                      and e.org_id = v_org and e.professional_id = p_professional_id
                      and pg_catalog.tstzrange(e.starts_at, e.ends_at, '[)')
                          && pg_catalog.tstzrange((v_day + part.s) at time zone v_tz, (v_day + part.f) at time zone v_tz, '[)')) then
      raise exception 'Ce moment est bloqué (vacances, congé ou autre absence) : retirez d''abord le blocage.' using errcode = 'P0001', hint = 'exception';
    end if;
  end if;

  -- The coming appointments inside the availability now, on the old or the new weekday.
  select coalesce(pg_catalog.array_agg(a.id), '{}'::uuid[]) into v_watch
    from public.appointments a
   where a.org_id = v_org and a.professional_id = p_professional_id and not a.is_personal
     and a.state in ('booked', 'confirmed') and a.starts_at > pg_catalog.now()
     and extract(isodow from a.starts_at at time zone v_tz)::int in (p_weekday, coalesce(v_existing.weekday::int, p_weekday))
     and private.appointments_in_availability(v_org, p_professional_id, a.service_id, a.starts_at, a.ends_at);

  -- Merge the windows with the same settings it touches or overlaps, until none is left.
  loop
    select x.* into r from public.availability_rules x
     where x.org_id = v_org and x.professional_id = p_professional_id and x.weekday = p_weekday
       and x.id is distinct from p_id
       and x.start_time <= v_end and v_start <= x.end_time
       and x.valid_from <= coalesce(v_until, 'infinity'::date) and v_from <= coalesce(x.valid_until, 'infinity'::date)
       and x.service_ids @> v_services and x.service_ids <@ v_services
       and x.visible_to_clients = v_visible and x.overflow_allowed = v_overflow
       and x.valid_until is not distinct from v_until
     order by x.start_time
     limit 1
     for update;
    exit when r.id is null;
    v_absorbed := v_absorbed || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(r) - 'org_id' - 'created_at' - 'created_by' - 'updated_at');
    v_start := least(v_start, r.start_time);
    v_end := greatest(v_end, r.end_time);
    v_from := least(v_from, r.valid_from);
    delete from public.availability_rules x where x.id = r.id;
  end loop;

  -- Any other window it overlaps has other settings: refused.
  if exists (select 1 from public.availability_rules x
              where x.org_id = v_org and x.professional_id = p_professional_id and x.weekday = p_weekday
                and x.id is distinct from p_id
                and x.start_time < v_end and v_start < x.end_time
                and x.valid_from <= coalesce(v_until, 'infinity'::date) and v_from <= coalesce(x.valid_until, 'infinity'::date)) then
    raise exception 'Cette plage chevauche une plage aux réglages différents (services, visibilité ou validité) : modifiez-la avec « Plus d''options… ».'
      using errcode = 'P0001', hint = 'start_time';
  end if;

  if p_id is null then
    insert into public.availability_rules (org_id, professional_id, weekday, start_time, end_time, service_ids,
                                           visible_to_clients, overflow_allowed, valid_from, valid_until, created_by)
    values (v_org, p_professional_id, p_weekday, v_start, v_end, '{}', true, false, v_from, v_until, auth.uid())
    returning id into v_id;
  else
    update public.availability_rules x
       set weekday = p_weekday, start_time = v_start, end_time = v_end, valid_from = v_from, valid_until = v_until
     where x.id = p_id
    returning x.id into v_id;
  end if;

  select count(*)::int into v_outside
    from public.appointments a
   where a.id = any (v_watch)
     and not private.appointments_in_availability(v_org, p_professional_id, a.service_id, a.starts_at, a.ends_at);

  return pg_catalog.jsonb_build_object(
    'id', v_id, 'weekday', p_weekday, 'start_time', v_start, 'end_time', v_end, 'valid_from', v_from, 'valid_until', v_until,
    'previous', case when p_id is null then null
                     else pg_catalog.to_jsonb(v_existing) - 'org_id' - 'created_at' - 'created_by' - 'updated_at' end,
    'absorbed', v_absorbed,
    'outside_count', v_outside);
end;
$$;
revoke all on function public.set_availability_window(uuid, uuid, int, time, time, date, date, date) from public, anon;
grant execute on function public.set_availability_window(uuid, uuid, int, time, time, date, date, date) to authenticated;
