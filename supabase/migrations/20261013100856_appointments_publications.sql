-- =============================================================================
-- Rendez-vous: « Mon agenda », a client's visits, the publications (plan R5; AP-23 … AP-25)
-- =============================================================================
--   1. get_my_agenda_reference() (appointments.self): the professional's own file (id, name,
--      titles) and the services she offers (the published catalogue, which a professional cannot
--      read: services.view is the staff's), for « Mon agenda » (AP-23).
--   2. list_client_visits(client, before, limit) (AP-24): a client's appointments, newest first
--      (keyset on the start): the professional, the service, the state, her presence, the
--      cancellation's reason and late flag. Staff (appointments.view) see all of them; a
--      professional (appointments.self) her own with a client she is linked to. Clients' record
--      shows it in « Visites et paiements » (the module slot `client.visits`).
--   3. For other modules (granted to no role; definer callers after their own check, AP-25):
--      private.appointments_for_billing(org, from, to) → Facturation (F2, FPay): the completed
--      appointments and the late cancellations of the period, each client with her presence;
--      private.first_appointments(org, client_ids[]) → Demandes: per client, her first active
--      appointment (booked, confirmed or completed) and whether it is confirmed.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_publications', true);

-- -----------------------------------------------------------------------------
-- 1. « Mon agenda »'s reference
-- -----------------------------------------------------------------------------
create function public.get_my_agenda_reference()
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
         and (pg_catalog.cardinality(s.title_ids) = 0 or s.title_ids && coalesce(v_pro.title_ids, '{}'))), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. A client's visits
-- -----------------------------------------------------------------------------
create function public.list_client_visits(p_client_id uuid, p_before timestamptz default null, p_limit int default 50)
returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz, state text, mode text, professional_id uuid, professional_name text,
  service_id uuid, service_code int, service_name text, presence text, role text, cancel_reason text, cancel_late boolean,
  kept_on_schedule boolean, confirmed_at timestamptz
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
  if not (v_staff or (private.has_permission('appointments.self') and v_me is not null
                      and private.client_visible_to_professional(p_client_id, v_me))) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  return query
    with v as (
      select a.*, p.presence as p_presence, p.role as p_role
        from public.appointment_participants p
        join public.appointments a on a.id = p.appointment_id
       where p.org_id = v_org and p.client_id = p_client_id and a.state <> 'held'
         and (v_staff or a.professional_id = v_me)
         and (p_before is null or a.starts_at < p_before)
       order by a.starts_at desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ),
    names as (
      select n.* from private.professional_display_names(v_org, (select coalesce(array_agg(distinct v.professional_id), '{}') from v)) n
    )
    select v.id, v.starts_at, v.ends_at, v.state, v.mode, v.professional_id, n.display_name,
           v.service_id, s.code, s.name, v.p_presence, v.p_role, r.name, v.cancel_late, v.kept_on_schedule, v.confirmed_at
      from v
      left join names n on n.professional_id = v.professional_id
      left join public.services_catalog s on s.org_id = v_org and s.id = v.service_id
      left join public.cancellation_reasons r on r.org_id = v_org and r.id = v.cancel_reason_id
     order by v.starts_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Published for other modules
-- -----------------------------------------------------------------------------
-- Facturation (F2 morning queue, FPay): the completed appointments of [p_from, p_to) and the
-- late cancellations (the fee is the professional's decision, R-59), one row per client.
create function private.appointments_for_billing(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, starts_at timestamptz, ends_at timestamptz, state text, professional_id uuid, service_id uuid,
  mode text, client_id uuid, role text, presence text, cancel_late boolean, cancelled_at timestamptz, series_id uuid
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.state, a.professional_id, a.service_id, a.mode,
         p.client_id, p.role, p.presence, a.cancel_late, a.cancelled_at, a.series_id
    from public.appointments a
    join public.appointment_participants p on p.appointment_id = a.id
   where a.org_id = p_org and not a.is_personal
     and a.starts_at >= p_from and a.starts_at < p_to
     and (a.state = 'completed' or (a.state = 'cancelled' and a.cancel_late))
   order by a.starts_at, a.id, p.role
$$;

-- Demandes: per client, her first active appointment (booked, confirmed or completed).
create function private.first_appointments(p_org uuid, p_client_ids uuid[])
returns table (client_id uuid, appointment_id uuid, starts_at timestamptz, professional_id uuid, state text, confirmed boolean)
language sql
stable
set search_path = ''
as $$
  select distinct on (p.client_id) p.client_id, a.id, a.starts_at, a.professional_id, a.state, a.state in ('confirmed', 'completed')
    from public.appointment_participants p
    join public.appointments a on a.id = p.appointment_id
   where p.org_id = p_org and p.client_id = any (coalesce(p_client_ids, '{}'))
     and a.state in ('booked', 'confirmed', 'completed')
   order by p.client_id, a.starts_at
$$;

revoke all on function private.appointments_for_billing(uuid, timestamptz, timestamptz), private.first_appointments(uuid, uuid[])
  from public, anon, authenticated, service_role;

revoke all on function public.get_my_agenda_reference(), public.list_client_visits(uuid, timestamptz, int) from public, anon;
grant execute on function public.get_my_agenda_reference(), public.list_client_visits(uuid, timestamptz, int) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
