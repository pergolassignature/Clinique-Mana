-- =============================================================================
-- Rendez-vous: P3-40 for the clients' messages (R4 addendum, AP-26)
-- =============================================================================
-- While Rendez-vous is reserved for testers (`org_modules.testers_only`), nothing reaches a
-- client and nothing piles up to go out at the launch:
--   * a booking, a move or a cancellation queues no message (no row);
--   * the job's pass sets every pending message aside (`skipped`, `reserved`) and sends nothing;
--     no reminder is queued; an email prepared in between is set aside too;
--   * a text Communications refuses or drops because it is itself reserved is `skipped`
--     (`sms_off`), never counted as sent nor as a missing consent.
-- The email template's test send (core, « M'envoyer un test ») is untouched.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_messages_reserved', true);

alter table public.appointment_messages
  drop constraint appointment_messages_skip_check,
  add constraint appointment_messages_skip_check check (
    (status = 'skipped') = (skip_reason is not null)
    and (skip_reason is null or skip_reason in ('no_consent', 'sms_off', 'cancelled', 'past', 'superseded', 'unreachable', 'reserved')));

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
            case p_kind when 'cancelled' then 'other' else p_kind end, 'appointment', v.id, false, null);
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

create or replace function public.appointment_messages_for_service(p_org_id uuid, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reminders int;
begin
  if p_org_id is null then
    raise exception 'p_org_id est requis' using errcode = '22023';
  end if;
  -- P3-40: reserved for testers, nothing goes out and nothing waits for the launch.
  if not public.module_open_to_all_for_org(p_org_id, 'appointments') then
    update public.appointment_messages m set status = 'skipped', skip_reason = 'reserved'
     where m.org_id = p_org_id and m.status = 'pending';
    return pg_catalog.jsonb_build_object('reminders', 0, 'email', '[]'::jsonb);
  end if;
  v_reminders := private.appointments_queue_reminders(p_org_id);
  update public.appointment_messages m
     set status = 'skipped',
         skip_reason = case when a.state = 'cancelled' and m.kind <> 'cancelled' then 'cancelled'
                            when m.kind <> 'cancelled' and a.starts_at <> m.starts_at then 'superseded'
                            else 'past' end
    from public.appointments a
   where a.id = m.appointment_id and m.org_id = p_org_id and m.status = 'pending' and m.channel = 'email'
     and ((a.state = 'cancelled' and m.kind <> 'cancelled') or (m.kind <> 'cancelled' and a.starts_at <> m.starts_at)
          or a.starts_at <= pg_catalog.now());
  return pg_catalog.jsonb_build_object(
    'reminders', v_reminders,
    'email', coalesce((select pg_catalog.jsonb_agg(x.id order by x.created_at)
                         from (select m.id, m.created_at from public.appointment_messages m
                                where m.org_id = p_org_id and m.status = 'pending' and m.channel = 'email'
                                order by m.created_at limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb));
end;
$$;

create or replace function public.prepare_appointment_message_for_service(p_org_id uuid, p_message_id uuid, p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.appointment_messages;
  v public.appointments;
  c record;
  v_client_first text;
  v_tz text := private.appointments_tz(p_org_id);
  v_link uuid;
  v_pro text;
begin
  select x.* into m from public.appointment_messages x
   where x.org_id = p_org_id and x.id = p_message_id and x.channel = 'email' for update;
  if m.id is null or m.status <> 'pending' then
    return null;
  end if;
  if not public.module_open_to_all_for_org(p_org_id, 'appointments') then
    update public.appointment_messages x set status = 'skipped', skip_reason = 'reserved' where x.id = m.id;
    return null;
  end if;
  select a.* into v from public.appointments a where a.id = m.appointment_id;
  select x.* into c from private.client_contacts_for(p_org_id, m.client_id, 'appointments') x
   where x.client_id = m.recipient_client_id and x.email is not null and x.reminders_by_email;
  if c.client_id is null then
    update public.appointment_messages x set status = 'skipped', skip_reason = 'unreachable' where x.id = m.id;
    return null;
  end if;
  select x.first_name into v_client_first from private.client_contacts_for(p_org_id, m.client_id, 'appointments') x where x.is_self;
  select n.display_name into v_pro from private.professional_display_names(p_org_id, array[v.professional_id]) n;
  if m.kind <> 'cancelled' then
    perform private.revoke_secure_links(p_org_id, 'appointment_confirm', 'appointment_message', m.id, null);
    v_link := private.issue_secure_link(p_org_id, 'appointment_confirm', 'appointment_message', m.id, p_token_hash, null,
                                        least(v.starts_at - pg_catalog.now(), interval '30 days'));
  end if;
  update public.appointment_messages x set attempts = x.attempts + 1, link_id = v_link where x.id = m.id;
  return pg_catalog.jsonb_build_object(
    'message_id', m.id,
    'appointment_id', v.id,
    'kind', m.kind,
    'language', m.language,
    'email', c.email,
    'recipient_first_name', c.first_name,
    'client_first_name', coalesce(v_client_first, c.first_name),
    'starts_at', v.starts_at,
    'professional_name', coalesce(v_pro, ''),
    'access', private.appointments_access(p_org_id, v.id, v.mode, m.language),
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'with_link', v_link is not null);
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
