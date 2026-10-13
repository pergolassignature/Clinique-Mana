-- =============================================================================
-- Rendez-vous: series, personal appointments, completion (plan R3; AP-16 … AP-18)
-- =============================================================================
--   1. Series (AP-16): `appointment_series` (the rule: every 1–12 weeks, on chosen weekdays,
--      at the first one's local time, N appointments (2–52) or until a date; the dates skipped
--      for a conflict), `appointments.series_id`. preview_series lists each date with its
--      conflict (« Déjà un rendez-vous », « Hors disponibilités »); create_series books every
--      date through book_appointment (every rule, the overrides included) and, on a conflict,
--      refuses with the dates (HINT `series_conflicts`) unless asked to skip them; any other
--      refusal (the client, the service) is the booking's. cancel_series_from cancels an
--      appointment and the series' later active ones, each through cancel_appointment (its late
--      flag); returns how many.
--   2. Personal appointments (AP-2, AP-17): book_personal_appointment(starts, ends, label,
--      is_work) by a professional on her own agenda only (appointments.self); any time, never
--      over another appointment; the staff see it as busy time (list_agenda). Move and cancel
--      are R1's.
--   3. Completion (AP-18): the SQL job `appointments.mark_completed` (hourly) marks the past
--      booked or confirmed appointments completed, except those whose every client is absent
--      (a no-show: Facturation's decision, R-59); noting every client absent on a completed one
--      takes it back to booked (or confirmed), so the next pass leaves it.
--   4. list_agenda returns `series_id`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_series', true);

-- -----------------------------------------------------------------------------
-- appointment_series
-- -----------------------------------------------------------------------------
create table public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  first_starts_at timestamptz not null,
  interval_weeks smallint not null,
  weekdays smallint[] not null,
  occurrences smallint,
  until_on date,
  skipped_on date[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint appointment_series_org_id_id_key unique (org_id, id),
  constraint appointment_series_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id),
  constraint appointment_series_service_fkey foreign key (org_id, service_id)
    references public.services (org_id, id),
  constraint appointment_series_interval_check check (interval_weeks between 1 and 12),
  constraint appointment_series_weekdays_check check (
    pg_catalog.cardinality(weekdays) between 1 and 7 and weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- Exactly one end: a number of appointments, or a last date.
  constraint appointment_series_end_check check ((occurrences is null) <> (until_on is null)),
  constraint appointment_series_occurrences_check check (occurrences is null or occurrences between 2 and 52)
);
create index appointment_series_org_professional_idx on public.appointment_series (org_id, professional_id);
create index appointment_series_org_service_idx on public.appointment_series (org_id, service_id);
create index appointment_series_created_by_idx on public.appointment_series (created_by);

alter table public.appointments
  add column series_id uuid,
  add constraint appointments_series_fkey foreign key (org_id, series_id) references public.appointment_series (org_id, id);
create index appointments_org_series_idx on public.appointments (org_id, series_id, starts_at);
-- The completion job's pass: active appointments by end.
create index appointments_active_ends_idx on public.appointments (ends_at) where state in ('booked', 'confirmed');

alter table public.appointment_series enable row level security;
revoke all on public.appointment_series from anon, authenticated;
grant select on public.appointment_series to authenticated;
-- As the appointments: the staff every professional's, a professional her own.
create policy appointment_series_select on public.appointment_series
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view'))
              or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id()))));
create trigger appointment_series_audit after insert or update or delete on public.appointment_series
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- 1. Series
-- -----------------------------------------------------------------------------
-- The local dates of a series: weeks every p_interval from the first date's (Monday-based),
-- the chosen weekdays, from the first date on, until p_until or p_count dates (52 at most).
create function private.appointments_series_dates(p_first date, p_interval int, p_weekdays int[], p_count int, p_until date)
returns setof date
language sql
immutable
set search_path = ''
as $$
  select d
    from (select (p_first - (extract(isodow from p_first)::int - 1)) + (k * p_interval * 7) + (w - 1) as d
            from pg_catalog.generate_series(0, 52 * 12) k
           cross join pg_catalog.unnest(p_weekdays) w) x
   where d >= p_first and (p_until is null or d <= p_until)
   order by d
   limit least(coalesce(p_count, 52), 52)
$$;

-- Checks a series' rule; returns its occurrences' local starts (the first one's local time).
create function private.appointments_series_starts(
  p_org uuid, p_first_starts_at timestamptz, p_interval_weeks int, p_weekdays int[], p_count int, p_until date
)
returns table (occurrence int, local_date date, starts_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := private.appointments_tz(p_org);
  v_first timestamp := p_first_starts_at at time zone v_tz;
begin
  perform private.appointments_check_start(p_first_starts_at);
  if p_interval_weeks is null or p_interval_weeks not between 1 and 12 then
    raise exception 'Une série se répète chaque semaine ou aux 2 à 12 semaines.' using errcode = 'P0001', hint = 'interval_weeks';
  end if;
  if coalesce(pg_catalog.cardinality(p_weekdays), 0) = 0 or not (p_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]) then
    raise exception 'Choisissez les jours de la série.' using errcode = 'P0001', hint = 'weekdays';
  end if;
  if (p_count is null) = (p_until is null) then
    raise exception 'Choisissez le nombre de rendez-vous ou la date de fin de la série.' using errcode = 'P0001', hint = 'count';
  end if;
  if p_count is not null and p_count not between 2 and 52 then
    raise exception 'Une série compte de 2 à 52 rendez-vous.' using errcode = 'P0001', hint = 'count';
  end if;
  if p_until is not null and (p_until <= v_first::date or p_until > v_first::date + 730) then
    raise exception 'La fin de la série tombe après le premier rendez-vous, dans les deux ans.' using errcode = 'P0001', hint = 'until';
  end if;
  return query
    select (row_number() over (order by d))::int, d, (d + v_first::time) at time zone v_tz
      from private.appointments_series_dates(v_first::date, p_interval_weeks, (select array_agg(distinct x) from pg_catalog.unnest(p_weekdays) x), p_count, p_until) d;
end;
$$;

revoke all on function private.appointments_series_dates(date, int, int[], int, date),
  private.appointments_series_starts(uuid, timestamptz, int, int[], int, date)
  from public, anon, authenticated, service_role;

-- The dates of a series with their conflict, before booking it: `overlap` (another active
-- appointment, « pause après » included) or `outside_availability` (no window, an exception).
create function public.preview_series(
  p_professional_id uuid, p_service_id uuid, p_first_starts_at timestamptz,
  p_interval_weeks int, p_weekdays int[], p_count int default null, p_until date default null
)
returns table (occurrence int, starts_at timestamptz, ends_at timestamptz, conflict text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_pro record;
  v_service record;
  v_length interval;
  v_slot interval;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select * into v_pro from private.appointments_professional(v_org, p_professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids, true);
  v_length := pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_slot := pg_catalog.make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes);
  return query
    select s.occurrence, s.starts_at, s.starts_at + v_length,
           case when exists (select 1 from public.appointments a
                              where a.org_id = v_org and a.professional_id = p_professional_id
                                and (a.state <> 'cancelled' or a.kept_on_schedule)
                                and pg_catalog.tstzrange(a.starts_at, a.blocks_until, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_slot, '[)'))
                  then 'overlap'
                when not private.appointments_in_availability(v_org, p_professional_id, p_service_id, s.starts_at, s.starts_at + v_length)
                  then 'outside_availability'
           end
      from private.appointments_series_starts(v_org, p_first_starts_at, p_interval_weeks, p_weekdays, p_count, p_until) s
     order by s.occurrence;
end;
$$;

-- Books a series: each date through book_appointment (every rule; the overrides apply to every
-- date). A date in conflict (an overlap, outside the availability) refuses the whole series with
-- the dates, unless p_skip_conflicts: then those dates are skipped and kept on the series.
create function public.create_series(
  p_professional_id uuid,
  p_service_id uuid,
  p_first_starts_at timestamptz,
  p_interval_weeks int,
  p_weekdays int[],
  p_count int,
  p_until date,
  p_client_ids uuid[],
  p_mode text default 'video',
  p_internal_note text default null,
  p_client_message text default null,
  p_skip_conflicts boolean default false,
  p_balance_override_reason text default null,
  p_outside_availability_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_series uuid;
  v_id uuid;
  v_hint text;
  v_skipped date[] := '{}';
  v_booked int := 0;
  s record;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  -- The rule first (its refusals in French), then the series.
  perform count(*) from private.appointments_series_starts(v_org, p_first_starts_at, p_interval_weeks, p_weekdays, p_count, p_until);
  insert into public.appointment_series (org_id, professional_id, service_id, first_starts_at, interval_weeks, weekdays,
                                         occurrences, until_on, created_by)
  values (v_org, p_professional_id, p_service_id, p_first_starts_at, coalesce(p_interval_weeks, 1),
          coalesce((select array_agg(distinct x::smallint order by x::smallint) from pg_catalog.unnest(p_weekdays) x), '{}'),
          p_count, p_until, auth.uid())
  returning id into v_series;

  for s in select * from private.appointments_series_starts(v_org, p_first_starts_at, p_interval_weeks, p_weekdays, p_count, p_until) loop
    begin
      v_id := public.book_appointment(p_professional_id, p_service_id, s.starts_at, p_client_ids, p_mode, p_internal_note,
                                      p_client_message, p_balance_override_reason, p_outside_availability_reason);
      update public.appointments a set series_id = v_series where a.id = v_id;
      v_booked := v_booked + 1;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_hint = pg_exception_hint;
      -- A date's conflict; any other refusal (the client, the service, the start) is the series'.
      if v_hint not in ('overlap', 'outside_availability') then
        raise;
      end if;
      v_skipped := v_skipped || s.local_date;
    end;
  end loop;

  if pg_catalog.cardinality(v_skipped) > 0 and not coalesce(p_skip_conflicts, false) then
    raise exception '% de la série % en conflit : %. Ignorez ces dates ou changez la série.',
      case when pg_catalog.cardinality(v_skipped) = 1 then 'Une date' else pg_catalog.cardinality(v_skipped)::text || ' dates' end,
      case when pg_catalog.cardinality(v_skipped) = 1 then 'est' else 'sont' end,
      (select pg_catalog.string_agg(private.format_date_short_fr(d), ', ' order by d) from pg_catalog.unnest(v_skipped) d)
      using errcode = 'P0001', hint = 'series_conflicts';
  end if;
  if v_booked = 0 then
    raise exception 'Aucune date de la série n''est libre.' using errcode = 'P0001', hint = 'series_conflicts';
  end if;
  if pg_catalog.cardinality(v_skipped) > 0 then
    update public.appointment_series x set skipped_on = v_skipped where x.id = v_series;
  end if;
  return v_series;
end;
$$;

-- Cancels an appointment of a series and the series' later active ones (each through
-- cancel_appointment, so each gets its late flag); returns how many.
create function public.cancel_series_from(p_id uuid, p_reason_key text, p_details text default null, p_kept_on_schedule boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_count int := 0;
  r record;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if v_appt.series_id is null then
    raise exception 'Ce rendez-vous ne fait pas partie d''une série.' using errcode = 'P0001', hint = 'series';
  end if;
  for r in select a.id from public.appointments a
            where a.org_id = v_org and a.series_id = v_appt.series_id and a.starts_at >= v_appt.starts_at
              and a.state in ('booked', 'confirmed')
            order by a.starts_at loop
    perform public.cancel_appointment(r.id, p_reason_key, p_details, p_kept_on_schedule);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'Ce rendez-vous est déjà annulé ou terminé.' using errcode = 'P0001', hint = 'state';
  end if;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Personal appointments: the professional's own (AP-2, AP-17)
-- -----------------------------------------------------------------------------
create function public.book_personal_appointment(p_starts_at timestamptz, p_ends_at timestamptz, p_label text, p_is_work boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_me uuid := private.current_professional_id();
  v_label text := nullif(pg_catalog.btrim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  if v_me is null or not private.has_permission('appointments.self') then
    raise exception 'Permission refusée : appointments.self' using errcode = '42501';
  end if;
  perform private.appointments_check_start(p_starts_at);
  if p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '12 hours'
     or extract(second from p_ends_at) <> 0 or extract(minute from p_ends_at)::int % 5 <> 0 then
    raise exception 'La fin tombe après le début, sur un multiple de 5 minutes, dans les 12 heures.' using errcode = 'P0001', hint = 'ends_at';
  end if;
  if v_label is not null and (pg_catalog.char_length(v_label) > 120 or not private.is_tidy_text(v_label)) then
    raise exception 'Le libellé compte 120 caractères au plus.' using errcode = 'P0001', hint = 'label';
  end if;
  begin
    insert into public.appointments (org_id, professional_id, starts_at, ends_at, blocks_until, is_personal, is_work, personal_label, created_by)
    values (v_org, v_me, p_starts_at, p_ends_at, p_ends_at, true, coalesce(p_is_work, false), v_label, auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Vous avez déjà un rendez-vous sur ce créneau (pause après comprise).' using errcode = 'P0001', hint = 'overlap';
  end;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Completion
-- -----------------------------------------------------------------------------
-- The past booked or confirmed appointments become completed, except a no-show (every client
-- absent). Personal ones too (no client).
create function private.job_appointments_mark_completed()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.appointments a
     set state = 'completed', completed_at = pg_catalog.now()
   where a.state in ('booked', 'confirmed') and a.ends_at <= pg_catalog.now()
     and (a.is_personal
          or exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.presence <> 'absent'));
  get diagnostics v_count = row_count;
  return 'completed=' || v_count;
end;
$$;
revoke all on function private.job_appointments_mark_completed() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('appointments.mark_completed', 'appointments', 'Rendez-vous terminés',
   'Marque terminés les rendez-vous passés, sauf ceux dont tous les clients sont notés absents.',
   'sql', 'private.job_appointments_mark_completed', 'appointments.mark_completed', true)
on conflict do nothing;

select cron.schedule('appointments.mark_completed', '20 * * * *',
  $$select private.run_sql_job('appointments.mark_completed')$$);

-- -----------------------------------------------------------------------------
-- 4. Presence: a completed appointment whose every client is absent is a no-show
-- -----------------------------------------------------------------------------
create or replace function public.set_appointment_presence(p_appointment_id uuid, p_client_id uuid, p_presence text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state = 'held' then
    raise exception 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.' using errcode = 'P0001', hint = 'held';
  end if;
  if v_appt.state = 'cancelled' then
    raise exception 'Le rendez-vous est annulé : la présence ne se note pas.' using errcode = 'P0001', hint = 'state';
  end if;
  if p_presence is null or p_presence not in ('expected', 'present', 'absent') then
    raise exception 'La présence est : sera présent, présent ou absent.' using errcode = 'P0001', hint = 'presence';
  end if;
  update public.appointment_participants p set presence = p_presence
   where p.appointment_id = p_appointment_id and p.client_id = p_client_id;
  if not found then
    raise exception 'Ce client n''est pas au rendez-vous.' using errcode = 'P0001', hint = 'client_id';
  end if;
  -- Every client absent on a completed appointment: a no-show, back to its state before (AP-18).
  if v_appt.state = 'completed'
     and not exists (select 1 from public.appointment_participants p where p.appointment_id = p_appointment_id and p.presence <> 'absent') then
    update public.appointments a
       set state = case when a.confirmed_at is not null then 'confirmed' else 'booked' end, completed_at = null
     where a.id = p_appointment_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. list_agenda with the series
-- -----------------------------------------------------------------------------
drop function public.list_agenda(timestamptz, timestamptz, uuid[]);
create function public.list_agenda(p_from timestamptz, p_to timestamptz, p_professional_ids uuid[] default null)
returns table (
  id uuid, professional_id uuid, service_id uuid, starts_at timestamptz, ends_at timestamptz, blocks_until timestamptz,
  mode text, state text, is_personal boolean, personal_label text, kept_on_schedule boolean, cancel_late boolean,
  cancel_reason_id uuid, confirmed_at timestamptz, outside_availability boolean, balance_override boolean,
  video_url text, video_status text, participants jsonb, series_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('appointments.view');
  v_me uuid := private.current_professional_id();
begin
  if not (v_staff or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '45 days' then
    raise exception 'Choisissez une période de 45 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  return query
    with a as (
      select x.*
        from public.appointments x
       where x.org_id = v_org
         and x.starts_at < p_to and x.blocks_until > p_from
         and x.starts_at > p_from - interval '12 hours'
         and (p_professional_ids is null or x.professional_id = any (p_professional_ids))
         and (v_staff or x.professional_id = v_me)
    ),
    names as (
      select n.* from private.clients_display_names(
        v_org, (select coalesce(array_agg(distinct p.client_id), '{}') from public.appointment_participants p where p.appointment_id in (select a.id from a))) n
    )
    select a.id, a.professional_id,
           -- Another professional's personal appointment: busy time only.
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.service_id end,
           a.starts_at, a.ends_at, a.blocks_until, a.mode, a.state, a.is_personal,
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.personal_label end,
           a.kept_on_schedule, a.cancel_late, a.cancel_reason_id, a.confirmed_at,
           a.outside_availability_reason is not null, a.balance_override_reason is not null,
           a.video_url, a.video_status,
           case when a.is_personal then '[]'::jsonb else coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'client_id', p.client_id, 'name', n.display_name, 'client_number', n.client_number,
                      'role', p.role, 'presence', p.presence, 'confirmed_at', p.confirmed_at)
                    order by p.role, n.display_name)
               from public.appointment_participants p
               left join names n on n.client_id = p.client_id
              where p.appointment_id = a.id), '[]'::jsonb) end,
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.series_id end
      from a
     order by a.starts_at, a.professional_id;
end;
$$;

revoke all on function
  public.preview_series(uuid, uuid, timestamptz, int, int[], int, date),
  public.create_series(uuid, uuid, timestamptz, int, int[], int, date, uuid[], text, text, text, boolean, text, text),
  public.cancel_series_from(uuid, text, text, boolean),
  public.book_personal_appointment(timestamptz, timestamptz, text, boolean),
  public.list_agenda(timestamptz, timestamptz, uuid[])
from public, anon;
grant execute on function
  public.preview_series(uuid, uuid, timestamptz, int, int[], int, date),
  public.create_series(uuid, uuid, timestamptz, int, int[], int, date, uuid[], text, text, text, boolean, text, text),
  public.cancel_series_from(uuid, text, text, boolean),
  public.book_personal_appointment(timestamptz, timestamptz, text, boolean),
  public.list_agenda(timestamptz, timestamptz, uuid[])
to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
