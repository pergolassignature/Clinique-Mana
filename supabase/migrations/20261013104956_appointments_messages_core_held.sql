-- =============================================================================
-- Rendez-vous: the messages under core's CC-14 (P3-40 enforced in core)
-- =============================================================================
--   * Rendez-vous' texts name their module to `private.send_sms` (its 9th argument): core holds
--     them too while Rendez-vous is reserved (AP-26's own guard stays).
--   * An email core refuses because its template's module is reserved (`sendTemplatedEmail`
--     answers `module_reserved`) is set aside (`skipped`, `reserved`) instead of tried again:
--     `finish_appointment_message_for_service` gains `p_skip_reason`.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_messages_core_held', true);

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
        insert into public.appointment_messages (org_id, appointment_id, client_id, recipient_client_id, channel, kind, starts_at, language)
        values (p_org, v.id, p.client_id, c.client_id, 'email', p_kind, v.starts_at, case when c.language = 'en' then 'en' else 'fr' end)
        on conflict on constraint appointment_messages_unique_key do nothing
        returning id into v_id;
        if v_id is not null then
          v_count := v_count + 1;
        end if;
      end if;
      if c.reminders_by_sms and c.mobile_e164 is not null then
        v_id := null;
        insert into public.appointment_messages (org_id, appointment_id, client_id, recipient_client_id, channel, kind, starts_at, language)
        values (p_org, v.id, p.client_id, c.client_id, 'sms', p_kind, v.starts_at, case when c.language = 'en' then 'en' else 'fr' end)
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

drop function public.finish_appointment_message_for_service(uuid, uuid, boolean);
create function public.finish_appointment_message_for_service(p_org_id uuid, p_message_id uuid, p_sent boolean,
                                                              p_skip_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.appointment_messages;
begin
  select x.* into m from public.appointment_messages x where x.org_id = p_org_id and x.id = p_message_id for update;
  if m.id is null or m.status <> 'pending' then
    return;
  end if;
  if p_skip_reason is not null and p_skip_reason not in ('reserved') then
    raise exception 'Unknown skip reason' using errcode = '22023';
  end if;
  if coalesce(p_sent, false) then
    update public.appointment_messages x set status = 'sent', sent_at = pg_catalog.now() where x.id = m.id;
  elsif p_skip_reason is not null then
    -- Core held the email (its template's module reserved, CC-14): set aside, never tried again.
    if m.link_id is not null then
      perform private.revoke_secure_links(p_org_id, 'appointment_confirm', 'appointment_message', m.id, null);
    end if;
    update public.appointment_messages x set status = 'skipped', skip_reason = p_skip_reason where x.id = m.id;
  else
    if m.link_id is not null then
      perform private.revoke_secure_links(p_org_id, 'appointment_confirm', 'appointment_message', m.id, null);
    end if;
    update public.appointment_messages x
       set status = case when x.attempts >= 3 then 'failed' else 'pending' end
     where x.id = m.id;
  end if;
end;
$$;

revoke all on function public.finish_appointment_message_for_service(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_appointment_message_for_service(uuid, uuid, boolean, text) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
