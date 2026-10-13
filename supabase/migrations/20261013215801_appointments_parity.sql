-- =============================================================================
-- Rendez-vous: the gaps of the parity audit before the cutover (part 1)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13, after the parity audit (docs/plans/2026-10-13-parity-audit.md):
--          points 1, 2, 3, 5 and 6 of lane A's agenda batch; decisions AP-28 … AP-32.
-- Needs:   *_appointments_module.sql, *_appointments_booking.sql (helpers), *_appointments_holds.sql
--          (move and cancel), *_appointments_messages.sql (the messages' trigger and texts),
--          *_appointments_video.sql (its triggers follow ends_at and state on their own),
--          Clients' published private.required_consents_for and client_payers_active.
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §5–§6; P3-40 (the messages' own guard).
--
-- Key choices
-- * « Changer le service » (AP-28): change_appointment_service(id, service, outside reason) keeps the
--   date, the time and the professional; the service's duration and « pause après » give the new end.
--   Every booking rule again: the professional offers it, the clients fit it (two for a couple
--   service), the availability (or the staff's reason, AP-12), the overlap (exclusion constraint).
--   No price is stored on an appointment: Facturation prices its service when it invoices the session
--   (a session is invoiced once completed, never before), so the change needs nothing else. The state
--   (booked or confirmed) is kept: the client is told once (`changed`), never cancel + confirm.
-- * « Rétablir » (AP-29): restore_appointment(id) brings a cancelled appointment still to come back as
--   booked (its cancellation's fields cleared, its participants to confirm again). The slot must be
--   free (the exclusion constraint), the files still active. A past one is refused: a fee is only ever
--   collected for a past appointment (private.appointments_fee_candidates), so no fee decision or
--   draft can exist for one that is restored. The client is told (`changed`); the video triggers
--   queue its meeting again.
-- * « Marquer confirmé » (AP-30): confirm_appointment(id) (appointments.manage) is what a counselor
--   records after calling a client of « Clients sans rappel »: booked → confirmed, every participant
--   confirmed (audited under the RPC's name). No message.
-- * Late cancellation in business hours (AP-31): appointment_settings.late_notice_business_hours,
--   **on by default** (GOrendezvous's « 24 h ouvrables »): the notice counts the hours of business
--   days only (whole days, the clinic's zone), so a Monday 10:00 appointment cancelled on Saturday is
--   late with 24 hours of notice. Off: calendar hours, as before. private.appointments_cancel_late is
--   what cancel_appointment (and anything reading Services' `late_notice_hours` for an appointment)
--   uses; set_appointment_settings takes the switch (dropped and made again with a defaulted 6th
--   argument: callers with 5 keep working).
-- * Consents at booking (AP-32): get_booking_consents(service, clients) is get_appointment_consents
--   for an appointment not booked yet (the screen shows what is missing, never blocks, R-47); a
--   professional (appointments.self without .view) reads only her own clients'. Both return each
--   consent's name (Clients' private.clients_consent_names); get_appointment_consents, which no
--   screen called yet, is dropped and made again with it.
-- * The messages: the trigger now also says `changed` for a restored appointment and for a change of
--   service (ends_at), and its texts say « modifié » (a move, a new service, a restore), in the
--   default templates that no clinic has changed and in the texts. A change and a cancellation are
--   a new message each time (`appointment_messages.event_at` joins the key): a restored appointment
--   cancelled again, or moved back to a start it had, is told again.
-- * Additive: a column, new functions, two replaced with their signatures, one settings RPC with a
--   new defaulted argument, the messages' trigger made again with two more columns.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_parity', true);

-- -----------------------------------------------------------------------------
-- 5. Late cancellation counted in business hours (AP-31)
-- -----------------------------------------------------------------------------
alter table public.appointment_settings
  add column late_notice_business_hours boolean not null default true;

-- Minutes of [p_from, p_to) that fall on the clinic's business days (whole days, its zone).
create function private.appointments_business_minutes(p_org uuid, p_from timestamptz, p_to timestamptz)
returns int
language sql
stable
set search_path = ''
as $$
  with s as (
    select coalesce(x.business_days, '{1,2,3,4,5}'::smallint[]) as days, private.appointments_tz(p_org) as tz
      from (select 1) one
      left join public.appointment_settings x on x.org_id = p_org
  ),
  d as (
    select g::date as day, s.days, s.tz
      from s, pg_catalog.generate_series((p_from at time zone s.tz)::date, (p_to at time zone s.tz)::date, interval '1 day') g
     where p_to > p_from
  )
  select coalesce(pg_catalog.sum(greatest(0, extract(epoch from (
           least(p_to, (d.day + 1)::timestamp at time zone d.tz) - greatest(p_from, d.day::timestamp at time zone d.tz))) / 60)), 0)::int
    from d
   where extract(isodow from d.day)::smallint = any (d.days)
$$;

-- Whether cancelling at p_at an appointment starting at p_starts_at is late with p_notice_hours of
-- notice (Services' policy); null without a policy.
create function private.appointments_cancel_late(p_org uuid, p_starts_at timestamptz, p_notice_hours int, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
           when p_notice_hours is null then null
           when coalesce((select s.late_notice_business_hours from public.appointment_settings s where s.org_id = p_org), true)
             then private.appointments_business_minutes(p_org, p_at, p_starts_at) < p_notice_hours * 60
           else p_at > p_starts_at - pg_catalog.make_interval(hours => p_notice_hours)
         end
$$;
revoke all on function private.appointments_business_minutes(uuid, timestamptz, timestamptz),
  private.appointments_cancel_late(uuid, timestamptz, int, timestamptz)
  from public, anon, authenticated, service_role;

-- *_appointments_holds.sql's, with the notice through private.appointments_cancel_late.
create or replace function public.cancel_appointment(p_id uuid, p_reason_key text, p_details text default null, p_kept_on_schedule boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_reason uuid;
  v_notice smallint;
  v_details text := nullif(pg_catalog.btrim(coalesce(p_details, '')), '');
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state = 'held' then
    raise exception 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.' using errcode = 'P0001', hint = 'held';
  end if;
  if v_appt.state not in ('booked', 'confirmed') then
    raise exception 'Ce rendez-vous est déjà annulé ou terminé.' using errcode = 'P0001', hint = 'state';
  end if;
  select r.id into v_reason from public.cancellation_reasons r
   where r.org_id = v_org and r.key = coalesce(p_reason_key, 'not_specified') and r.is_active;
  if v_reason is null then
    raise exception 'Choisissez la raison de l''annulation.' using errcode = 'P0001', hint = 'reason';
  end if;
  if v_details is not null and pg_catalog.char_length(v_details) > 1000 then
    raise exception 'Les détails comptent 1 000 caractères au plus.' using errcode = 'P0001', hint = 'details';
  end if;
  select b.late_notice_hours into v_notice
    from public.billing_policy_on((v_appt.starts_at at time zone private.appointments_tz(v_org))::date) b;
  update public.appointments a
     set state = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason_id = v_reason,
         cancel_details = v_details, kept_on_schedule = coalesce(p_kept_on_schedule, false),
         cancel_late = case when v_appt.is_personal then null
                            else private.appointments_cancel_late(v_org, v_appt.starts_at, v_notice, now()) end
   where a.id = p_id;
end;
$$;

-- *_appointments_booking.sql's, with the notice's switch (null: unchanged).
drop function public.set_appointment_settings(int[], time, time, int, int);
create function public.set_appointment_settings(
  p_business_days int[], p_business_start time, p_business_end time, p_reminder_business_days int, p_reminder_local_hour int,
  p_late_notice_business_hours boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('appointments.settings') then
    raise exception 'Permission refusée : appointments.settings' using errcode = '42501';
  end if;
  if p_business_days is null or pg_catalog.cardinality(p_business_days) = 0
     or not (p_business_days <@ array[1, 2, 3, 4, 5, 6, 7]) then
    raise exception 'Choisissez les jours ouvrables.' using errcode = 'P0001', hint = 'business_days';
  end if;
  if p_business_start is null or p_business_end is null or p_business_end <= p_business_start then
    raise exception 'L''heure de fermeture vient après l''heure d''ouverture.' using errcode = 'P0001', hint = 'business_end';
  end if;
  if p_reminder_business_days is null or p_reminder_business_days not between 1 and 5 then
    raise exception 'Le rappel part de 1 à 5 jours ouvrables avant.' using errcode = 'P0001', hint = 'reminder_business_days';
  end if;
  if p_reminder_local_hour is null or p_reminder_local_hour not between 0 and 23 then
    raise exception 'L''heure d''envoi des rappels est entre 0 et 23 h.' using errcode = 'P0001', hint = 'reminder_local_hour';
  end if;
  insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour,
                                           late_notice_business_hours, updated_by)
  values (v_org, (select array_agg(distinct d::smallint order by d::smallint) from pg_catalog.unnest(p_business_days) d),
          p_business_start, p_business_end, p_reminder_business_days, p_reminder_local_hour,
          coalesce(p_late_notice_business_hours, true), auth.uid())
  on conflict (org_id) do update
     set business_days = excluded.business_days, business_start = excluded.business_start, business_end = excluded.business_end,
         reminder_business_days = excluded.reminder_business_days, reminder_local_hour = excluded.reminder_local_hour,
         late_notice_business_hours = coalesce(p_late_notice_business_hours, public.appointment_settings.late_notice_business_hours),
         updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.set_appointment_settings(int[], time, time, int, int, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_appointment_settings(int[], time, time, int, int, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 1. « Changer le service » (AP-28)
-- -----------------------------------------------------------------------------
create function public.change_appointment_service(p_id uuid, p_service_id uuid, p_outside_availability_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_pro record;
  v_service record;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_clients uuid[];
  v_outside text;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.is_personal then
    raise exception 'Un rendez-vous personnel n''a pas de service.' using errcode = 'P0001', hint = 'service_id';
  end if;
  if v_appt.state = 'held' then
    raise exception 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.' using errcode = 'P0001', hint = 'held';
  end if;
  if v_appt.state not in ('booked', 'confirmed') then
    raise exception 'Le service d''un rendez-vous annulé ou terminé ne change plus.' using errcode = 'P0001', hint = 'state';
  end if;
  if p_service_id is null then
    raise exception 'Choisissez le service.' using errcode = 'P0001', hint = 'service_id';
  end if;
  if p_service_id = v_appt.service_id then
    return;
  end if;
  select * into v_pro from private.appointments_professional(v_org, v_appt.professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids, true);
  v_ends := v_appt.starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
  v_outside := private.appointments_outside_reason(
    private.appointments_in_availability(v_org, v_appt.professional_id, p_service_id, v_appt.starts_at, v_ends),
    p_outside_availability_reason);
  select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_clients
    from public.appointment_participants p where p.appointment_id = p_id;
  perform private.appointments_check_clients(v_org, v_clients, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                             (v_appt.starts_at at time zone private.appointments_tz(v_org))::date, false, null, true);
  begin
    update public.appointments a
       set service_id = p_service_id, ends_at = v_ends, blocks_until = v_blocks,
           outside_availability_reason = coalesce(v_outside, a.outside_availability_reason),
           outside_availability_by = case when v_outside is not null then auth.uid() else a.outside_availability_by end
     where a.id = p_id;
  exception when exclusion_violation then
    raise exception 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).' using errcode = 'P0001', hint = 'overlap';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. « Rétablir » (AP-29)
-- -----------------------------------------------------------------------------
create function public.restore_appointment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_pro record;
  v_service record;
  v_clients uuid[];
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state <> 'cancelled' then
    raise exception 'Ce rendez-vous n''est pas annulé.' using errcode = 'P0001', hint = 'state';
  end if;
  if v_appt.starts_at <= pg_catalog.now() then
    raise exception 'Un rendez-vous passé ne se rétablit pas : réservez-en un nouveau au besoin.' using errcode = 'P0001', hint = 'starts_at';
  end if;
  if not v_appt.is_personal then
    select * into v_pro from private.appointments_professional(v_org, v_appt.professional_id);
    select * into v_service from private.appointments_service(v_org, v_appt.service_id, v_pro.title_ids, false);
    select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_clients
      from public.appointment_participants p where p.appointment_id = p_id;
    perform private.appointments_check_clients(v_org, v_clients, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                               (v_appt.starts_at at time zone private.appointments_tz(v_org))::date, false, null, false);
  end if;
  begin
    update public.appointments a
       set state = 'booked', confirmed_at = null, cancelled_at = null, cancelled_by = null, cancel_reason_id = null,
           cancel_details = null, cancel_late = null, kept_on_schedule = false
     where a.id = p_id;
  exception when exclusion_violation then
    raise exception 'Le créneau est maintenant pris : ce rendez-vous ne peut pas être rétabli.' using errcode = 'P0001', hint = 'overlap';
  end;
  update public.appointment_participants p set confirmed_at = null where p.appointment_id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. « Marquer confirmé » (AP-30)
-- -----------------------------------------------------------------------------
create function public.confirm_appointment(p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_at timestamptz := pg_catalog.now();
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if not private.has_permission('appointments.manage') then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null or v_appt.is_personal then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if v_appt.state = 'confirmed' then
    return v_appt.confirmed_at;
  end if;
  if v_appt.state <> 'booked' then
    raise exception 'Seul un rendez-vous réservé se confirme.' using errcode = 'P0001', hint = 'state';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:confirm_appointment', true);
  update public.appointments a set state = 'confirmed', confirmed_at = v_at where a.id = p_id;
  update public.appointment_participants p set confirmed_at = v_at where p.appointment_id = p_id and p.confirmed_at is null;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- « Clients sans rappel » says which are confirmed already (AP-30)
-- -----------------------------------------------------------------------------
-- *_appointments_messages.sql's, with the state (return type: dropped, made again).
drop function public.list_appointments_without_reminder(timestamptz, timestamptz);
create function public.list_appointments_without_reminder(p_from timestamptz, p_to timestamptz)
returns table (id uuid, professional_id uuid, starts_at timestamptz, participants jsonb, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_sms_on boolean;
begin
  if not private.has_permission('appointments.view') then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '14 days' then
    raise exception 'Choisissez une période de 14 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  v_sms_on := public.module_enabled_for_org(v_org, 'communications');
  return query
    with a as (
      select x.* from public.appointments x
       where x.org_id = v_org and x.state in ('booked', 'confirmed') and not x.is_personal
         and x.starts_at >= greatest(p_from, pg_catalog.now()) and x.starts_at < p_to
         and not exists (
           select 1 from public.appointment_participants p
            cross join lateral private.client_contacts_for(v_org, p.client_id, 'appointments') c
            where p.appointment_id = x.id
              and ((c.reminders_by_email and c.email is not null)
                   or (v_sms_on and c.reminders_by_sms and c.mobile_e164 is not null
                       and private.sms_consent_status(v_org, c.mobile_e164) = 'opted_in')))
    ),
    names as (
      select n.* from private.clients_display_names(
        v_org, (select coalesce(array_agg(distinct p.client_id), '{}') from public.appointment_participants p where p.appointment_id in (select a.id from a))) n
    )
    select a.id, a.professional_id, a.starts_at,
           coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('client_id', p.client_id, 'name', n.display_name,
                                                                                'client_number', n.client_number) order by p.role)
                       from public.appointment_participants p left join names n on n.client_id = p.client_id
                      where p.appointment_id = a.id), '[]'::jsonb),
           a.state
      from a
     order by a.starts_at;
end;
$$;
revoke all on function public.list_appointments_without_reminder(timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.list_appointments_without_reminder(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. The consents a booking needs (AP-32)
-- -----------------------------------------------------------------------------
create function public.get_booking_consents(p_service_id uuid, p_client_ids uuid[])
returns table (client_id uuid, consent_key text, consent_name text, frequency text, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('appointments.view');
  v_pro uuid := private.current_professional_id();
  v_code text;
begin
  if not (v_staff or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_client_ids is null or pg_catalog.cardinality(p_client_ids) > 2 then
    raise exception 'Deux clients au plus.' using errcode = '22023';
  end if;
  select f.code::text into v_code from private.service_booking_facts(v_org, p_service_id) f;
  return query
    select x.id, c.consent_key, coalesce(n.name_fr, c.consent_key), c.frequency, c.state
      from pg_catalog.unnest(p_client_ids) with ordinality as x(id, ord)
     cross join lateral private.required_consents_for(
             v_org, x.id, v_code,
             (select y.kind from public.client_payers_active y where y.org_id = v_org and y.client_id = x.id order by y.kind limit 1),
             null, '{}', null, null) c
      left join private.clients_consent_names(v_org) n on n.key = c.consent_key
     where exists (select 1 from public.clients k where k.org_id = v_org and k.id = x.id)
       and (v_staff or (v_pro is not null and private.client_visible_to_professional(x.id, v_pro)))
     order by x.ord, c.consent_key;
end;
$$;

-- *_appointments_booking.sql's, with each consent's name (Clients' private.clients_consent_names):
-- the sheet says which one is missing. No screen called it yet (return type: dropped, made again).
drop function public.get_appointment_consents(uuid);
create function public.get_appointment_consents(p_appointment_id uuid)
returns table (client_id uuid, consent_key text, consent_name text, frequency text, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_code text;
begin
  if not (private.has_permission('appointments.view') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_appointment_id;
  if v_appt.id is null
     or not ((private.has_permission('appointments.view') and not v_appt.is_personal)
             or v_appt.professional_id = private.current_professional_id()) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  select f.code::text into v_code from private.service_booking_facts(v_org, v_appt.service_id) f;
  return query
    select p.client_id, c.consent_key, coalesce(n.name_fr, c.consent_key), c.frequency, c.state
      from public.appointment_participants p
     cross join lateral private.required_consents_for(
             v_org, p.client_id, v_code,
             (select x.kind from public.client_payers_active x where x.org_id = v_org and x.client_id = p.client_id order by x.kind limit 1),
             null, '{}', 'appointment', v_appt.id) c
      left join private.clients_consent_names(v_org) n on n.key = c.consent_key
     where p.appointment_id = v_appt.id
     order by p.role, p.client_id, c.consent_key;
end;
$$;
revoke all on function public.get_appointment_consents(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_appointment_consents(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The messages' key: a change or a cancellation is a new message each time (AP-29)
-- -----------------------------------------------------------------------------
-- The key kept one message per recipient, channel, kind and start: a restored appointment cancelled
-- again, or moved back to a start it had, told no one. `event_at` (the transaction's time, for
-- `changed` and `cancelled` only) keeps the double fire of one transaction out and lets a later
-- event through; reminders and confirmations keep their one message per start.
alter table public.appointment_messages add column event_at timestamptz;
alter table public.appointment_messages drop constraint appointment_messages_unique_key;
alter table public.appointment_messages add constraint appointment_messages_unique_key
  unique nulls not distinct (appointment_id, recipient_client_id, channel, kind, starts_at, event_at);

-- *_appointments_messages_core_held.sql's, with `event_at`.
create or replace function private.appointments_queue_message(p_org uuid, p_appointment uuid, p_kind text)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v public.appointments;
  v_tz text := private.appointments_tz(p_org);
  v_clinic text;
  v_pro text;
  v_sms_on boolean := public.module_enabled_for_org(p_org, 'communications');
  v_id uuid;
  v_sms uuid;
  v_hint text;
  v_count int := 0;
  -- A change or a cancellation is one event per transaction (AP-29): a later one is a new message.
  v_event timestamptz := case when p_kind in ('changed', 'cancelled') then pg_catalog.now() end;
  p record;
  c record;
begin
  select a.* into v from public.appointments a where a.org_id = p_org and a.id = p_appointment;
  if v.id is null or v.is_personal then
    return 0;
  end if;
  -- P3-40: while Rendez-vous is reserved for testers, nothing reaches a client and nothing is
  -- kept to go out at the launch.
  if not public.module_open_to_all_for_org(p_org, 'appointments') then
    return 0;
  end if;
  select o.name into v_clinic from public.organizations o where o.id = p_org;
  select n.display_name into v_pro from private.professional_display_names(p_org, array[v.professional_id]) n;
  for p in select x.client_id from public.appointment_participants x where x.appointment_id = v.id order by x.role loop
    for c in select * from private.client_contacts_for(p_org, p.client_id, 'appointments') loop
      -- A reminder right after a confirmation or a change of that start is one message too many.
      continue when p_kind = 'reminder' and exists (
        select 1 from public.appointment_messages m
         where m.appointment_id = v.id and m.recipient_client_id = c.client_id and m.starts_at = v.starts_at
           and m.kind in ('confirmation', 'changed') and m.created_at > pg_catalog.now() - interval '18 hours');
      if c.reminders_by_email and c.email is not null then
        insert into public.appointment_messages (org_id, appointment_id, client_id, recipient_client_id, channel, kind, starts_at, language, event_at)
        values (p_org, v.id, p.client_id, c.client_id, 'email', p_kind, v.starts_at, case when c.language = 'en' then 'en' else 'fr' end, v_event)
        on conflict on constraint appointment_messages_unique_key do nothing
        returning id into v_id;
        if v_id is not null then
          v_count := v_count + 1;
        end if;
      end if;
      if c.reminders_by_sms and c.mobile_e164 is not null then
        v_id := null;
        insert into public.appointment_messages (org_id, appointment_id, client_id, recipient_client_id, channel, kind, starts_at, language, event_at)
        values (p_org, v.id, p.client_id, c.client_id, 'sms', p_kind, v.starts_at, case when c.language = 'en' then 'en' else 'fr' end, v_event)
        on conflict on constraint appointment_messages_unique_key do nothing
        returning id into v_id;
        continue when v_id is null;
        v_count := v_count + 1;
        if not v_sms_on then
          update public.appointment_messages m set status = 'skipped', skip_reason = 'sms_off' where m.id = v_id;
          continue;
        end if;
        begin
          v_sms := private.send_sms(
            p_org, c.mobile_e164,
            private.appointments_sms_body(p_kind, case when c.language = 'en' then 'en' else 'fr' end, v_clinic,
                                          private.appointments_when(v.starts_at, v_tz, c.language), coalesce(v_pro, ''),
                                          v.mode, v.state = 'booked'),
            case p_kind when 'cancelled' then 'other' else p_kind end, 'appointment', v.id, false, null, 'appointments');
          if v_sms is null then
            -- Communications reserved for testers (P3-40): send_sms queues nothing automatic.
            update public.appointment_messages m set status = 'skipped', skip_reason = 'sms_off' where m.id = v_id;
          else
            update public.appointment_messages m
               set status = 'sent', sms_message_id = v_sms, sent_at = pg_catalog.now(), attempts = 1
             where m.id = v_id;
          end if;
        exception when sqlstate 'P0001' then
          get stacked diagnostics v_hint = pg_exception_hint;
          -- Communications reserved (a cancellation is a typed kind there), else no consent in
          -- force for the number (or a number Communications cannot read).
          update public.appointment_messages m
             set status = 'skipped', skip_reason = case when v_hint = 'module_reserved' then 'sms_off' else 'no_consent' end
           where m.id = v_id;
        end;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- The messages: a restore and a change of service say `changed`; « modifié » in the texts
-- -----------------------------------------------------------------------------
create or replace function private.appointments_messages_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.appointments;
  v_kind text;
begin
  select a.* into v from public.appointments a where a.id = new.id;
  if v.id is null or v.is_personal or v.external_ref is not null or v.starts_at <= pg_catalog.now() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if v.state in ('booked', 'confirmed') then
      v_kind := 'confirmation';
    end if;
  elsif v.state = 'cancelled' and old.state in ('booked', 'confirmed') then
    v_kind := 'cancelled';
    update public.appointment_messages m set status = 'skipped', skip_reason = 'cancelled'
     where m.appointment_id = v.id and m.status = 'pending' and m.kind <> 'cancelled';
  elsif v.state = 'booked' and old.state = 'held' then
    v_kind := 'confirmation';
  elsif v.state in ('booked', 'confirmed') and old.state = 'cancelled' then
    -- Restored (AP-29): its cancellation, if not gone yet, never leaves.
    v_kind := 'changed';
    update public.appointment_messages m set status = 'skipped', skip_reason = 'superseded'
     where m.appointment_id = v.id and m.status = 'pending' and m.kind = 'cancelled';
  elsif v.state in ('booked', 'confirmed') and old.state in ('booked', 'confirmed')
        and (old.starts_at is distinct from new.starts_at or old.professional_id is distinct from new.professional_id
             or old.service_id is distinct from new.service_id or old.ends_at is distinct from new.ends_at) then
    v_kind := 'changed';
    update public.appointment_messages m set status = 'skipped', skip_reason = 'superseded'
     where m.appointment_id = v.id and m.status = 'pending' and m.starts_at <> v.starts_at;
  end if;
  if v_kind is null then
    return null;
  end if;
  -- A series: one confirmation (its first date) and one cancellation (the first cancelled now).
  if v.series_id is not null and v_kind = 'confirmation' and exists (
       select 1 from public.appointments s where s.series_id = v.series_id and s.id <> v.id
          and s.state in ('booked', 'confirmed') and s.starts_at < v.starts_at) then
    return null;
  end if;
  if v.series_id is not null and v_kind = 'cancelled' and exists (
       select 1 from public.appointments s where s.series_id = v.series_id and s.id <> v.id
          and s.state = 'cancelled' and s.cancelled_at = v.cancelled_at and s.starts_at < v.starts_at) then
    return null;
  end if;
  perform private.appointments_queue_message(v.org_id, v.id, v_kind);
  return null;
end;
$$;

drop trigger appointments_messages on public.appointments;
create constraint trigger appointments_messages
  after insert or update of state, starts_at, ends_at, professional_id, service_id on public.appointments
  deferrable initially deferred
  for each row execute function private.appointments_messages_trigger();

-- The texts: *_appointments_messages.sql's, `changed` in words that fit a move, a new service and a restore.
create or replace function private.appointments_sms_body(p_kind text, p_language text, p_clinic text, p_when text, p_professional text,
                                                         p_mode text, p_ask_confirmation boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_language = 'en' then
           p_clinic || ': ' ||
           case p_kind
             when 'reminder' then 'reminder of your appointment on ' || p_when || ' with ' || p_professional
             when 'confirmation' then 'your appointment is booked on ' || p_when || ' with ' || p_professional
             when 'changed' then 'your appointment was updated: ' || p_when || ' with ' || p_professional
             else 'your appointment on ' || p_when || ' with ' || p_professional || ' is cancelled' end ||
           case when p_kind = 'cancelled' then '.'
                else ' (' || case when p_mode = 'phone' then 'by phone' else 'by video' end || ').' end ||
           case when p_ask_confirmation and p_kind <> 'cancelled' then ' Reply YES to confirm.' else '' end
         else
           p_clinic || ' : ' ||
           case p_kind
             when 'reminder' then 'rappel de votre rendez-vous du ' || p_when || ' avec ' || p_professional
             when 'confirmation' then 'votre rendez-vous est réservé le ' || p_when || ' avec ' || p_professional
             when 'changed' then 'votre rendez-vous est modifié : le ' || p_when || ' avec ' || p_professional
             else 'votre rendez-vous du ' || p_when || ' avec ' || p_professional || ' est annulé' end ||
           case when p_kind = 'cancelled' then '.'
                else ' (' || case when p_mode = 'phone' then 'par téléphone' else 'par vidéo' end || ').' end ||
           case when p_ask_confirmation and p_kind <> 'cancelled' then ' Répondez OUI pour confirmer.' else '' end
         end
$$;

update public.email_template_defaults d
   set label = 'Rendez-vous modifié',
       description = 'Envoyé quand un rendez-vous change de date, d''heure, de professionnel ou de service, ou qu''un rendez-vous annulé est rétabli.',
       why_line = 'Vous recevez ce courriel parce qu''un rendez-vous a été modifié à la clinique.',
       subject = 'Rendez-vous modifié : le {{appointment.starts_at}} — {{clinic.name}}',
       body = E'Bonjour {{recipient.first_name}},\n\n'
              'Le rendez-vous de {{client.first_name}} est modifié : il aura lieu le {{appointment.starts_at}} avec {{professional.name}}.\n\n'
              '{{appointment.access}}\n\n'
              'Merci de confirmer votre présence. Pour toute question, appelez la clinique.'
 where d.key = 'appointments.changed' and d.label = 'Rendez-vous déplacé';
update public.email_template_defaults d
   set label = 'Rendez-vous modifié (anglais)',
       description = 'Le rendez-vous modifié, en anglais.',
       why_line = 'You receive this email because an appointment was updated at the clinic.',
       subject = 'Appointment updated: {{appointment.starts_at}} — {{clinic.name}}',
       body = E'Hello {{recipient.first_name}},\n\n'
              '{{client.first_name}}''s appointment was updated: it will take place on {{appointment.starts_at}} with {{professional.name}}.\n\n'
              '{{appointment.access}}\n\n'
              'Please confirm your attendance. If you have any question, please call the clinic.'
 where d.key = 'appointments.changed_en' and d.label = 'Rendez-vous déplacé (anglais)';

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  public.change_appointment_service(uuid, uuid, text),
  public.restore_appointment(uuid),
  public.confirm_appointment(uuid),
  public.get_booking_consents(uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function
  public.change_appointment_service(uuid, uuid, text),
  public.restore_appointment(uuid),
  public.confirm_appointment(uuid),
  public.get_booking_consents(uuid, uuid[])
to authenticated;
