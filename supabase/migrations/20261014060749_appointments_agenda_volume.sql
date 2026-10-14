-- =============================================================================
-- Rendez-vous: the agenda at production volume (volume test, 2026-10-14)
-- =============================================================================
-- With 60 professionals and two years of appointments, `list_agenda` over the month view (42
-- days, every professional: ~5 900 appointments) took ~700 ms: each appointment's participants
-- were aggregated in a correlated subquery that scanned the whole `names` CTE (no index on a CTE),
-- so the cost grew with the square of the period's appointments.
--
-- Same signature and answer (`create or replace`): the participants are read once, joined to
-- their names once, aggregated per appointment and hash-joined to the appointments. The held-slot
-- rule (AP-15, *_appointments_security_fixes.sql) is kept.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_agenda_volume', true);

create or replace function public.list_agenda(p_from timestamptz, p_to timestamptz, p_professional_ids uuid[] default null)
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
    with a as materialized (
      select x.*
        from public.appointments x
       where x.org_id = v_org
         and x.starts_at < p_to and x.blocks_until > p_from
         and x.starts_at > p_from - interval '12 hours'
         and (p_professional_ids is null or x.professional_id = any (p_professional_ids))
         and (v_staff or x.professional_id = v_me)
    ),
    -- The participants of the appointments that show them (never a personal one; a held slot
    -- only for the staff, AP-15).
    parts as materialized (
      select p.appointment_id, p.client_id, p.role, p.presence, p.confirmed_at
        from public.appointment_participants p
        join a on a.id = p.appointment_id
       where not a.is_personal and (a.state <> 'held' or v_staff)
    ),
    names as materialized (
      select n.client_id, n.display_name, n.client_number
        from private.clients_display_names(v_org, (select coalesce(array_agg(distinct parts.client_id), '{}') from parts)) n
    ),
    agg as (
      select parts.appointment_id,
             pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'client_id', parts.client_id, 'name', n.display_name, 'client_number', n.client_number,
               'role', parts.role, 'presence', parts.presence, 'confirmed_at', parts.confirmed_at)
             order by parts.role, n.display_name) as participants
        from parts
        left join names n on n.client_id = parts.client_id
       group by parts.appointment_id
    )
    select a.id, a.professional_id,
           -- Another professional's personal appointment: busy time only.
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.service_id end,
           a.starts_at, a.ends_at, a.blocks_until, a.mode, a.state, a.is_personal,
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.personal_label end,
           a.kept_on_schedule, a.cancel_late, a.cancel_reason_id, a.confirmed_at,
           a.outside_availability_reason is not null, a.balance_override_reason is not null,
           a.video_url, a.video_status,
           coalesce(agg.participants, '[]'::jsonb),
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.series_id end
      from a
      left join agg on agg.appointment_id = a.id
     order by a.starts_at, a.professional_id;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
