-- =============================================================================
-- Rendez-vous: the reminder and confirmation state on the agenda's blocks (AP-49, parity audit L12)
-- =============================================================================
-- Asked:   coordinator, 2026-10-14 (L12 remainder: like GOrendezvous, a bell when the reminder
--          went, a check when the client confirmed, and « injoignable »; read with the agenda, no
--          extra polling).
-- Needs:   *_appointments_agenda_volume.sql (latest body), *_appointments_messages.sql.
--
-- `list_agenda` is replaced (same parameters; two columns added; the rest as the latest body):
-- * `reminder_status`: `sent` (a reminder of the appointment's current start went), `pending`
--   (queued), or null;
-- * `unreachable`: a coming booked or confirmed appointment of the next 14 days none of whose
--   recipients can be reminded (the rule of « Clients sans rappel »); false otherwise.
-- The client's confirmation is the state (`confirmed`) and the participants' `confirmed_at`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_agenda_reminders', true);

drop function public.list_agenda(timestamptz, timestamptz, uuid[]);

create function public.list_agenda(p_from timestamptz, p_to timestamptz, p_professional_ids uuid[] default null)
returns table (
  id uuid, professional_id uuid, service_id uuid, starts_at timestamptz, ends_at timestamptz, blocks_until timestamptz,
  mode text, state text, is_personal boolean, personal_label text, kept_on_schedule boolean, cancel_late boolean,
  cancel_reason_id uuid, confirmed_at timestamptz, outside_availability boolean, balance_override boolean,
  video_url text, video_status text, participants jsonb, series_id uuid, reminder_status text, unreachable boolean
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
  v_sms_on boolean;
begin
  if not (v_staff or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '45 days' then
    raise exception 'Choisissez une période de 45 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  v_sms_on := public.module_enabled_for_org(v_org, 'communications');
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
    -- The reminder of the appointment's current start (AP-49): sent, else waiting, else none.
    reminders as (
      select m.appointment_id,
             case when bool_or(m.status = 'sent') then 'sent' when bool_or(m.status = 'pending') then 'pending' end as status
        from public.appointment_messages m
        join a on a.id = m.appointment_id and m.starts_at = a.starts_at
       where m.kind = 'reminder' and not a.is_personal
       group by m.appointment_id
    ),
    -- « Injoignable » (AP-49, as « Clients sans rappel »): a coming booked or confirmed appointment
    -- of the next 14 days none of whose recipients has an email or a text consent for reminders.
    unreachable as (
      select a.id
        from a
       where a.state in ('booked', 'confirmed') and not a.is_personal
         and a.starts_at >= pg_catalog.now() and a.starts_at < pg_catalog.now() + interval '14 days'
         and exists (select 1 from parts p where p.appointment_id = a.id)
         and not exists (
           select 1 from parts p
            cross join lateral private.client_contacts_for(v_org, p.client_id, 'appointments') c
            where p.appointment_id = a.id
              and ((c.reminders_by_email and c.email is not null)
                   or (v_sms_on and c.reminders_by_sms and c.mobile_e164 is not null
                       and private.sms_consent_status(v_org, c.mobile_e164) = 'opted_in')))
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
           case when a.is_personal and a.professional_id is distinct from v_me then null else a.series_id end,
           r.status, u.id is not null
      from a
      left join agg on agg.appointment_id = a.id
      left join reminders r on r.appointment_id = a.id
      left join unreachable u on u.id = a.id
     order by a.starts_at, a.professional_id;
end;
$$;

revoke all on function public.list_agenda(timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.list_agenda(timestamptz, timestamptz, uuid[]) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
