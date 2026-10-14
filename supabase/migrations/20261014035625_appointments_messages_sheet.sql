-- =============================================================================
-- Rendez-vous: the appointment's « Messages » and « Renvoyer la notification » (parity audit L12)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (post-cutover audit: the appointment sheet's « Messages », its
--          messages and « Renvoyer la notification »); decision AP-47.
-- Needs:   *_appointments_messages.sql, *_appointments_parity.sql (appointments_queue_message).
--
-- * `list_appointment_messages(id)` (appointments.view; or appointments.self for her own
--   appointment, as the history): every message of the appointment, newest first: kind, channel,
--   the recipient's name (Clients' `clients_display_names`), status, why it was not sent, tries,
--   when queued and sent. Never an address, a number or a text.
-- * `resend_appointment_notification(id)` (appointments.manage): the client's notification again,
--   for every recipient and channel, as the event would: a coming booked or confirmed appointment
--   → its confirmation; a cancelled one (still to come) → its cancellation. Refused for a past,
--   held or personal appointment, and within 2 minutes of the last one of that kind (a double
--   click). Returns how many messages were queued (0: no recipient can be reached, or Rendez-vous
--   is reserved for testers, P3-40). A text leaves at once (Communications' rules); an email
--   leaves with the messages job.
-- * `appointments_queue_message(org, id, kind, again)`: the queue, with `again` (a new message past
--   the one-per-start key; a reminder not held back by a recent confirmation). The 3-argument one
--   is now `again => false`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_messages_sheet', true);

-- *_appointments_parity.sql's, with `p_again`.
create function private.appointments_queue_message(p_org uuid, p_appointment uuid, p_kind text, p_again boolean)
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
  -- « Renvoyer la notification »: a new message of any kind, past the one-per-start key.
  v_event timestamptz := case when p_kind in ('changed', 'cancelled') or coalesce(p_again, false) then pg_catalog.now() end;
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
      continue when p_kind = 'reminder' and not coalesce(p_again, false) and exists (
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

revoke all on function private.appointments_queue_message(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

create or replace function private.appointments_queue_message(p_org uuid, p_appointment uuid, p_kind text)
returns int
language sql
set search_path = ''
as $f$
  select private.appointments_queue_message(p_org, p_appointment, p_kind, false)
$f$;

create function public.list_appointment_messages(p_id uuid)
returns table (
  id uuid, kind text, channel text, recipient_client_id uuid, recipient_name text, status text, skip_reason text,
  attempts int, created_at timestamptz, sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
begin
  if not (private.has_permission('appointments.view') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id;
  if v_appt.id is null
     or not ((private.has_permission('appointments.view') and not v_appt.is_personal)
             or (v_appt.professional_id = private.current_professional_id() and private.has_permission('appointments.self'))) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  return query
    select m.id, m.kind, m.channel, m.recipient_client_id, n.display_name, m.status, m.skip_reason,
           m.attempts::int, m.created_at, m.sent_at
      from public.appointment_messages m
      left join private.clients_display_names(v_org, (select pg_catalog.array_agg(distinct x.recipient_client_id)
                                                        from public.appointment_messages x where x.appointment_id = p_id)) n
        on n.client_id = m.recipient_client_id
     where m.org_id = v_org and m.appointment_id = p_id
     order by m.created_at desc, m.kind, m.channel, m.id;
end;
$$;
revoke all on function public.list_appointment_messages(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_appointment_messages(uuid) to authenticated;

create function public.resend_appointment_notification(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_kind text;
begin
  if not private.has_permission('appointments.manage') then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null or v_appt.is_personal then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if v_appt.starts_at <= pg_catalog.now() then
    raise exception 'Ce rendez-vous est passé : il n''y a plus de notification à envoyer.' using errcode = 'P0001', hint = 'starts_at';
  end if;
  v_kind := case v_appt.state when 'booked' then 'confirmation' when 'confirmed' then 'confirmation' when 'cancelled' then 'cancelled' end;
  if v_kind is null then
    raise exception 'Un rendez-vous en attente d''acceptation n''a pas encore de notification.' using errcode = 'P0001', hint = 'state';
  end if;
  if exists (select 1 from public.appointment_messages m
              where m.appointment_id = p_id and m.kind = v_kind and m.created_at > pg_catalog.now() - interval '2 minutes') then
    raise exception 'Une notification vient de partir : réessayez dans quelques minutes.' using errcode = 'P0001', hint = 'recent';
  end if;
  return private.appointments_queue_message(v_org, p_id, v_kind, true);
end;
$$;
revoke all on function public.resend_appointment_notification(uuid) from public, anon, authenticated, service_role;
grant execute on function public.resend_appointment_notification(uuid) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
