-- =============================================================================
-- Rendez-vous: the pre-cutover security review's fixes (2026-10-14)
-- =============================================================================
--   1. book_appointment (and so create_series, which books each date through it): a professional
--      booking her own agenda (appointments.self, without appointments.manage) books only the
--      clients already in her files (Clients' private.client_visible_to_professional); booking
--      another would have linked her to the client (clients_link_professional) and opened the
--      client's file to her. The staff are unchanged.
--   2. video_link_email_for_service (« Votre lien de rencontre »): the contact's email opt-out
--      (reminders_by_email) as for the confirmations and reminders, and no row while the module is
--      reserved for testers (P3-40): the job then marks the link as handled, as for nobody to email.
--   3. Confirmation links: a link confirms only the start its message announced (as « OUI » by
--      text does), and a move, a cancellation or a restore revokes the appointment's links.
--   4. Audit: the Zoom meeting's id redacted (appointments.video_external_id,
--      appointment_video_meetings.external_id), with the columns already redacted.
--   5. list_agenda and the participants' policy: a held slot (a proposal, AP-15) shows no client to
--      a professional (no client link before acceptance); the staff unchanged.
--   6. retry_appointment_video and cancel_series_from: the permission checked before the read
--      answers anything about the appointment.
--   7. get_booking_consents: the file's existence from Clients' private.clients_booking_facts, not
--      Clients' table.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_security_fixes', true);

-- -----------------------------------------------------------------------------
-- 1. book_appointment: a professional books her own clients only
-- -----------------------------------------------------------------------------
-- *_appointments_agenda.sql's, with the check before the clients' rules.
create or replace function public.book_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_ids uuid[],
  p_mode text default 'video',
  p_internal_note text default null,
  p_client_message text default null,
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
  v_pro record;
  v_service record;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_override text := nullif(pg_catalog.btrim(coalesce(p_balance_override_reason, '')), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(p_internal_note, '')), '');
  v_message text := nullif(pg_catalog.btrim(coalesce(p_client_message, '')), '');
  v_outside text;
  v_id uuid;
  v_client uuid;
  v_ord int;
  v_overridden boolean;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  perform private.appointments_check_start(p_starts_at);
  if coalesce(p_mode, 'video') not in ('video', 'phone') then
    raise exception 'Le rendez-vous se fait en vidéo ou par téléphone.' using errcode = 'P0001', hint = 'mode';
  end if;
  if v_override is not null and pg_catalog.char_length(v_override) not between 3 and 500 then
    raise exception 'La raison de l''exception compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'balance_override_reason';
  end if;
  if (v_note is not null and pg_catalog.char_length(v_note) > 5000) or (v_message is not null and pg_catalog.char_length(v_message) > 2000) then
    raise exception 'La note compte 5 000 caractères au plus, le message au client 2 000.' using errcode = 'P0001', hint = 'internal_note';
  end if;

  select * into v_pro from private.appointments_professional(v_org, p_professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids, true);
  v_ends := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
  v_outside := private.appointments_outside_reason(
    private.appointments_in_availability(v_org, p_professional_id, p_service_id, p_starts_at, v_ends), p_outside_availability_reason);
  -- A professional books only the clients already in her files (the staff match the others):
  -- checked before any rule reads the clients' facts.
  if not private.has_permission('appointments.manage') and exists (
       select 1 from pg_catalog.unnest(coalesce(p_client_ids, '{}'::uuid[])) as x(id)
        where x.id is null or not private.client_visible_to_professional(x.id, p_professional_id)) then
    raise exception 'Ce client n''est pas encore dans vos dossiers : demandez à la clinique de le jumeler.'
      using errcode = 'P0001', hint = 'client_ids';
  end if;
  v_overridden := private.appointments_check_clients(v_org, p_client_ids, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                                     (p_starts_at at time zone private.appointments_tz(v_org))::date, true, v_override);

  begin
    insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode,
                                     internal_note, client_message, balance_override_reason, balance_override_by,
                                     outside_availability_reason, outside_availability_by, created_by)
    values (v_org, p_professional_id, p_service_id, p_starts_at, v_ends, v_blocks, coalesce(p_mode, 'video'),
            v_note, v_message,
            case when v_overridden then v_override end,
            case when v_overridden then auth.uid() end,
            v_outside, case when v_outside is not null then auth.uid() end,
            auth.uid())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).' using errcode = 'P0001', hint = 'overlap';
  end;
  for v_client, v_ord in select x, o from pg_catalog.unnest(p_client_ids) with ordinality as u(x, o) loop
    insert into public.appointment_participants (appointment_id, client_id, org_id, role)
    values (v_id, v_client, v_org, case when v_ord = 1 then 'client' else 'second' end);
    perform private.clients_link_professional(v_org, v_client, p_professional_id, 'appointment');
  end loop;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. « Votre lien de rencontre »: the email opt-out, the testers' reservation
-- -----------------------------------------------------------------------------
-- *_appointments_video.sql's, with both conditions.
create or replace function public.video_link_email_for_service(p_org_id uuid, p_appointment_id uuid)
returns table (email text, first_name text, language text, clinic_name text, professional_name text,
               starts_at timestamptz, join_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- P3-40: reserved for testers, nothing goes out (no row: the job marks the link as handled).
  if not public.module_open_to_all_for_org(p_org_id, 'appointments') then
    return;
  end if;
  return query
    select distinct on (pg_catalog.lower(c.email))
           c.email, c.first_name, case when c.language = 'en' then 'en' else 'fr' end,
           o.name, (select n.display_name from private.professional_display_names(a.org_id, array[a.professional_id]) n), a.starts_at, m.join_url
      from public.appointments a
      join public.appointment_video_meetings m on m.appointment_id = a.id
      join public.organizations o on o.id = a.org_id
      join public.appointment_participants ap on ap.appointment_id = a.id and ap.org_id = a.org_id
      cross join lateral private.client_contacts_for(a.org_id, ap.client_id, 'appointments') c
     where a.org_id = p_org_id and a.id = p_appointment_id
       and a.state in ('booked', 'confirmed') and a.starts_at > pg_catalog.now()
       and c.reminders_by_email
       and nullif(pg_catalog.btrim(coalesce(c.email, '')), '') is not null
     order by pg_catalog.lower(c.email), c.is_self desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Confirmation links: the announced start only; revoked by a move, a cancellation, a restore
-- -----------------------------------------------------------------------------
-- *_appointments_messages.sql's, with the start compared to the message's.
create or replace function public.resolve_appointment_confirm_link(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  m public.appointment_messages;
  v public.appointments;
begin
  select x.* into l from public.secure_links x
   where x.id = p_link_id and x.purpose = 'appointment_confirm' and x.subject_type = 'appointment_message'
     and x.revoked_at is null and x.expires_at > pg_catalog.now() and x.use_count < x.max_uses;
  if l.id is null then
    return null;
  end if;
  select x.* into m from public.appointment_messages x where x.id = l.subject_id and x.org_id = l.org_id;
  select a.* into v from public.appointments a where a.id = m.appointment_id and a.org_id = l.org_id;
  if v.id is null or v.state not in ('booked', 'confirmed') or v.starts_at <= pg_catalog.now() or v.starts_at <> m.starts_at then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'clinic_name', (select o.name from public.organizations o where o.id = l.org_id),
    'language', m.language,
    'when', private.appointments_when(v.starts_at, private.appointments_tz(l.org_id), m.language),
    'professional_name', coalesce((select n.display_name from private.professional_display_names(l.org_id, array[v.professional_id]) n), ''),
    'mode', v.mode,
    'confirmed', v.state = 'confirmed');
end;
$$;

create or replace function public.confirm_appointment_by_link_for_service(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.secure_links;
  m public.appointment_messages;
  v public.appointments;
begin
  select x.* into l from public.secure_links x
   where x.token_hash = p_token_hash and x.purpose = 'appointment_confirm' and x.subject_type = 'appointment_message'
   for update;
  if l.id is null or l.revoked_at is not null or l.expires_at <= pg_catalog.now() or l.use_count >= l.max_uses
     or not public.module_enabled_for_org(l.org_id, 'appointments') then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  select x.* into m from public.appointment_messages x where x.id = l.subject_id and x.org_id = l.org_id;
  select a.* into v from public.appointments a where a.id = m.appointment_id and a.org_id = l.org_id for update;
  if v.id is null or v.state not in ('booked', 'confirmed') or v.starts_at <= pg_catalog.now() or v.starts_at <> m.starts_at then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  perform private.consume_secure_link(p_token_hash, 'appointment_confirm');
  perform private.appointments_confirm(l.org_id, v.id, m.client_id, 'link:appointment_confirm');
  return pg_catalog.jsonb_build_object('state', 'confirmed');
end;
$$;

-- *_appointments_import.sql's, with the revocation.
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
  if v.id is null or v.is_personal or (tg_op = 'INSERT' and v.external_ref is not null) or v.starts_at <= pg_catalog.now() then
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
  -- Moved, cancelled or restored: the links already sent confirm nothing any more.
  if v_kind <> 'confirmation' then
    perform private.revoke_secure_links(v.org_id, 'appointment_confirm', 'appointment_message', m.id, null)
       from public.appointment_messages m
      where m.appointment_id = v.id and m.link_id is not null;
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

-- -----------------------------------------------------------------------------
-- 4. Audit: the Zoom meeting's id redacted
-- -----------------------------------------------------------------------------
drop trigger appointments_audit on public.appointments;
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function private.audit_trigger('personal_label', 'internal_note', 'client_message', 'cancel_details',
                                                      'balance_override_reason', 'video_url', 'outside_availability_reason',
                                                      'video_external_id');
drop trigger appointment_video_meetings_audit on public.appointment_video_meetings;
create trigger appointment_video_meetings_audit after insert or update or delete on public.appointment_video_meetings
  for each row execute function private.audit_trigger('join_url', 'emailed_join_url', 'external_id');

-- -----------------------------------------------------------------------------
-- 5. A held slot shows no client to a professional (AP-15)
-- -----------------------------------------------------------------------------
-- *_appointments_series.sql's, the participants empty for a held slot unless appointments.view.
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
           -- A held slot (a proposal, AP-15): no client for a professional before acceptance.
           case when a.is_personal or (a.state = 'held' and not v_staff) then '[]'::jsonb else coalesce((
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

-- *_appointments_module.sql's policy, a held slot's participants for the staff only.
drop policy appointment_participants_select on public.appointment_participants;
create policy appointment_participants_select on public.appointment_participants
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view')) or (select private.has_permission('appointments.self')))
         and exists (select 1 from public.appointments a
                      where a.id = appointment_id
                        and (a.state <> 'held' or (select private.has_permission('appointments.view')))));

-- -----------------------------------------------------------------------------
-- 6. The permission before the read answers
-- -----------------------------------------------------------------------------
-- *_appointments_video.sql's, the permission first.
create or replace function public.retry_appointment_video(p_appointment_id uuid)
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
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_appointment_id;
  if v_appt.id is null or v_appt.is_personal and not (private.has_permission('appointments.self')
                                                      and v_appt.professional_id = private.current_professional_id()) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act(v_appt.professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.video_status is distinct from 'failed' then
    raise exception 'Le lien de ce rendez-vous n''est pas en échec.' using errcode = 'P0001', hint = 'video_status';
  end if;
  perform private.appointment_video_request(v_org, p_appointment_id);
  update public.appointments a set video_status = 'pending' where a.id = p_appointment_id and a.org_id = v_org;
end;
$$;

-- *_appointments_series.sql's, the appointment's own check before its series is told.
create or replace function public.cancel_series_from(p_id uuid, p_reason_key text, p_details text default null, p_kept_on_schedule boolean default false)
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
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
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
-- 7. get_booking_consents through Clients' published fact
-- -----------------------------------------------------------------------------
-- *_appointments_parity.sql's, Clients' private.clients_booking_facts for the file's existence.
create or replace function public.get_booking_consents(p_service_id uuid, p_client_ids uuid[])
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
     where exists (select 1 from private.clients_booking_facts(v_org, array[x.id]) f where f.found)
       and (v_staff or (v_pro is not null and private.client_visible_to_professional(x.id, v_pro)))
     order by x.ord, c.consent_key;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
