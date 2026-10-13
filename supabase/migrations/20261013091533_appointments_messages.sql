-- =============================================================================
-- Rendez-vous: the clients' messages — confirmations, reminders, changes, cancellations (plan R4)
-- =============================================================================
-- Decisions R-38, R-39, R-52 … R-55, AP-19 … AP-22.
--   1. `appointment_messages`: one row per appointment, recipient, channel, kind and start
--      (« unique »: a reminder is never sent twice). The recipients are Clients' contacts with the
--      right `appointments` (`private.client_contacts_for`: the client and each relation who
--      manages her appointments), each by her own channels (`reminders_by_email`,
--      `reminders_by_sms`) and language: a teen gets the text, her parent the email (R-54).
--      Operational (ids, statuses, no text): not audited, like `email_log`.
--   2. Events (a deferred constraint trigger, so the participants exist): a booking (or a
--      proposal accepted) → `confirmation`; a move → `changed`; a cancellation → `cancelled` (a
--      series: one message, for its first date). Never for a personal appointment, a held one,
--      an imported one (`external_ref`) or the past. A text is queued at once through
--      Communications' `private.send_sms` (it waits for the business hours itself and checks the
--      consent: none → `skipped`, `no_consent`); an email waits for the job.
--   3. Reminders (R-38, R-52, AP-19): on a business day, from the reminder hour to the end of the
--      business hours, the appointments of the next business day (and the days before it: a
--      Saturday's and a Monday's on Friday) get a `reminder`, unless a confirmation or a change
--      for that start went out in the last 18 hours.
--   4. The job `appointments.messages` (function `appointments-messages`, every 10 minutes)
--      materialises the reminders, then sends the pending emails: `prepare_…` issues the
--      confirmation link (`appointment_confirm`, until the start) and returns the values,
--      `finish_…` records the result (three tries, then `failed`).
--   5. Confirmation (R-39, AP-20): the link's page (`/rendez-vous/confirmer#t=…`, function
--      `appointments-confirm`) or « OUI » by text (`private.sms_confirmation_hook`, Communications'
--      stub replaced here) confirm the appointment: `confirmed`, `confirmed_at`, and the client's
--      participant row. An unconfirmed appointment triggers nothing (R-53).
--   6. « Clients sans rappel » (AP-21): `list_appointments_without_reminder(from, to)`, the
--      coming appointments no recipient of which can be reached (no email, no text with a
--      consent in force), for the counselors to phone.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_messages', true);

-- -----------------------------------------------------------------------------
-- 1. appointment_messages
-- -----------------------------------------------------------------------------
create table public.appointment_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  appointment_id uuid not null,
  client_id uuid not null,
  recipient_client_id uuid not null,
  channel text not null,
  kind text not null,
  starts_at timestamptz not null,
  language text not null default 'fr',
  status text not null default 'pending',
  skip_reason text,
  attempts smallint not null default 0,
  sms_message_id uuid,
  link_id uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint appointment_messages_appointment_fkey foreign key (org_id, appointment_id)
    references public.appointments (org_id, id) on delete cascade,
  constraint appointment_messages_channel_check check (channel in ('email', 'sms')),
  constraint appointment_messages_kind_check check (kind in ('confirmation', 'reminder', 'changed', 'cancelled')),
  constraint appointment_messages_language_check check (language in ('fr', 'en')),
  constraint appointment_messages_status_check check (status in ('pending', 'sent', 'failed', 'skipped')),
  constraint appointment_messages_skip_check check (
    (status = 'skipped') = (skip_reason is not null)
    and (skip_reason is null or skip_reason in ('no_consent', 'sms_off', 'cancelled', 'past', 'superseded', 'unreachable'))),
  constraint appointment_messages_unique_key unique (appointment_id, recipient_client_id, channel, kind, starts_at)
);
create index appointment_messages_org_appointment_idx on public.appointment_messages (org_id, appointment_id);
create index appointment_messages_pending_idx on public.appointment_messages (org_id, created_at) where status = 'pending';
create trigger appointment_messages_set_updated_at before update on public.appointment_messages
  for each row execute function private.set_updated_at();

alter table public.appointment_messages enable row level security;
revoke all on public.appointment_messages from anon, authenticated;
grant select on public.appointment_messages to authenticated;
-- The staff see what went out for an appointment (no text is stored: ids and statuses).
create policy appointment_messages_select on public.appointment_messages
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('appointments.view')));

-- -----------------------------------------------------------------------------
-- Words: the moment, the access, the texts
-- -----------------------------------------------------------------------------
-- « lundi 15 mars à 9 h 00 » / « Monday, March 15 at 9:00 AM », in the clinic's time zone.
create function private.appointments_when(p_at timestamptz, p_tz text, p_language text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v timestamp := p_at at time zone p_tz;
  v_dow int := extract(isodow from v)::int;
  v_month int := extract(month from v)::int;
begin
  if p_language = 'en' then
    return (array['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])[v_dow] || ', '
        || (array['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
                  'November', 'December'])[v_month] || ' ' || extract(day from v)::int
        || ' at ' || pg_catalog.to_char(v, 'FMHH12:MI') || ' ' || pg_catalog.to_char(v, 'AM');
  end if;
  return (array['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])[v_dow] || ' '
      || case when extract(day from v)::int = 1 then '1er' else extract(day from v)::int::text end || ' '
      || (array['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre',
                'novembre', 'décembre'])[v_month]
      || ' à ' || extract(hour from v)::int || ' h ' || pg_catalog.to_char(v, 'MI');
end;
$$;

-- How the client joins: the video link (lane C's `appointment_video_link`), or the phone.
create function private.appointments_access(p_org uuid, p_appointment uuid, p_mode text, p_language text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_url text;
  v_status text;
begin
  if p_mode = 'phone' then
    return case when p_language = 'en' then 'By phone: your professional will call you.'
                else 'Par téléphone : votre professionnel vous appellera.' end;
  end if;
  select l.url, l.status into v_url, v_status from private.appointment_video_link(p_org, p_appointment) l limit 1;
  if v_url is not null then
    return case when p_language = 'en' then 'By video: ' else 'Par vidéo : ' end || v_url;
  end if;
  if v_status = 'pending' then
    return case when p_language = 'en' then 'By video: the link will be sent to you before the appointment.'
                else 'Par vidéo : le lien vous sera envoyé avant le rendez-vous.' end;
  end if;
  return case when p_language = 'en' then 'By video.' else 'Par vidéo.' end;
end;
$$;

-- The text of a message (R-54): short, the clinic's name first; « OUI » confirms a booked one.
create function private.appointments_sms_body(p_kind text, p_language text, p_clinic text, p_when text, p_professional text,
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
             when 'changed' then 'your appointment was moved to ' || p_when || ' with ' || p_professional
             else 'your appointment on ' || p_when || ' with ' || p_professional || ' is cancelled' end ||
           case when p_kind = 'cancelled' then '.'
                else ' (' || case when p_mode = 'phone' then 'by phone' else 'by video' end || ').' end ||
           case when p_ask_confirmation and p_kind <> 'cancelled' then ' Reply YES to confirm.' else '' end
         else
           p_clinic || ' : ' ||
           case p_kind
             when 'reminder' then 'rappel de votre rendez-vous du ' || p_when || ' avec ' || p_professional
             when 'confirmation' then 'votre rendez-vous est réservé le ' || p_when || ' avec ' || p_professional
             when 'changed' then 'votre rendez-vous est déplacé au ' || p_when || ' avec ' || p_professional
             else 'votre rendez-vous du ' || p_when || ' avec ' || p_professional || ' est annulé' end ||
           case when p_kind = 'cancelled' then '.'
                else ' (' || case when p_mode = 'phone' then 'par téléphone' else 'par vidéo' end || ').' end ||
           case when p_ask_confirmation and p_kind <> 'cancelled' then ' Répondez OUI pour confirmer.' else '' end
         end
$$;

revoke all on function private.appointments_when(timestamptz, text, text), private.appointments_access(uuid, uuid, text, text),
  private.appointments_sms_body(text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Queueing a message for every recipient and channel
-- -----------------------------------------------------------------------------
-- Rows for each participant's contacts (Clients' right `appointments`), by their channels; a
-- text is handed to Communications at once. Returns how many rows were added.
create function private.appointments_queue_message(p_org uuid, p_appointment uuid, p_kind text)
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
  v_count int := 0;
  p record;
  c record;
begin
  select a.* into v from public.appointments a where a.org_id = p_org and a.id = p_appointment;
  if v.id is null or v.is_personal then
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
          update public.appointment_messages m
             set status = 'sent', sms_message_id = v_sms, sent_at = pg_catalog.now(), attempts = 1
           where m.id = v_id;
        exception when sqlstate 'P0001' then
          -- No consent in force for the number (or a number Communications cannot read).
          update public.appointment_messages m set status = 'skipped', skip_reason = 'no_consent' where m.id = v_id;
        end;
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.appointments_queue_message(uuid, uuid, text) from public, anon, authenticated, service_role;

-- The events, at commit (a deferred constraint trigger: book_appointment adds the participants
-- after the row). The row is read again: the transaction may have changed it since.
create function private.appointments_messages_trigger()
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
  elsif v.state in ('booked', 'confirmed') and old.state in ('booked', 'confirmed')
        and (old.starts_at is distinct from new.starts_at or old.professional_id is distinct from new.professional_id) then
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
revoke all on function private.appointments_messages_trigger() from public, anon, authenticated, service_role;

create constraint trigger appointments_messages
  after insert or update of state, starts_at, professional_id on public.appointments
  deferrable initially deferred
  for each row execute function private.appointments_messages_trigger();

-- -----------------------------------------------------------------------------
-- 3. Reminders
-- -----------------------------------------------------------------------------
-- On a business day, from the reminder hour until the business hours end: the appointments
-- after today up to the next business day (`reminder_business_days` of them). Returns the rows added.
create function private.appointments_queue_reminders(p_org uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_tz text := private.appointments_tz(p_org);
  v_days smallint[] := '{1,2,3,4,5}';
  v_end time := '17:00';
  v_lead smallint := 1;
  v_hour smallint := 8;
  v_local timestamp := pg_catalog.now() at time zone v_tz;
  v_today date := v_local::date;
  v_last date := v_local::date;
  v_n int := 0;
  v_count int := 0;
  a record;
begin
  select s.business_days, s.business_end, s.reminder_business_days, s.reminder_local_hour
    into v_days, v_end, v_lead, v_hour
    from public.appointment_settings s where s.org_id = p_org;
  v_days := coalesce(v_days, '{1,2,3,4,5}');
  if not (extract(isodow from v_today)::smallint = any (v_days))
     or v_local::time < pg_catalog.make_time(coalesce(v_hour, 8), 0, 0) or v_local::time >= coalesce(v_end, '17:00') then
    return 0;
  end if;
  for i in 1..30 loop
    v_last := v_last + 1;
    if extract(isodow from v_last)::smallint = any (v_days) then
      v_n := v_n + 1;
      exit when v_n >= coalesce(v_lead, 1);
    end if;
  end loop;
  for a in select x.id from public.appointments x
            where x.org_id = p_org and x.state in ('booked', 'confirmed') and not x.is_personal
              and x.starts_at > pg_catalog.now()
              and (x.starts_at at time zone v_tz)::date > v_today and (x.starts_at at time zone v_tz)::date <= v_last loop
    v_count := v_count + private.appointments_queue_message(p_org, a.id, 'reminder');
  end loop;
  return v_count;
end;
$$;
revoke all on function private.appointments_queue_reminders(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. The job's RPCs (service role)
-- -----------------------------------------------------------------------------
-- One pass for a clinic: the reminders due now, the stale emails set aside, then the emails to
-- send (oldest first). {"reminders": n, "email": [ids]}.
create function public.appointment_messages_for_service(p_org_id uuid, p_limit int default 50)
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

-- An email ready to go: the recipient, the template, the values and (but for a cancellation) a
-- fresh confirmation link with this hash, valid until the start. Null when it may no longer go.
create function public.prepare_appointment_message_for_service(p_org_id uuid, p_message_id uuid, p_token_hash bytea)
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

-- The send's result: sent, or tried again at the next pass (three tries, then failed).
create function public.finish_appointment_message_for_service(p_org_id uuid, p_message_id uuid, p_sent boolean)
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
  if coalesce(p_sent, false) then
    update public.appointment_messages x set status = 'sent', sent_at = pg_catalog.now() where x.id = m.id;
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

-- -----------------------------------------------------------------------------
-- 5. Confirmation: the link, « OUI »
-- -----------------------------------------------------------------------------
-- The appointment confirmed by its client (or someone who manages her appointments).
create function private.appointments_confirm(p_org uuid, p_appointment uuid, p_client uuid, p_source text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  perform pg_catalog.set_config('app.audit_source', p_source, true);
  update public.appointments a set state = 'confirmed', confirmed_at = pg_catalog.now()
   where a.org_id = p_org and a.id = p_appointment and a.state = 'booked';
  update public.appointment_participants p set confirmed_at = pg_catalog.now()
   where p.appointment_id = p_appointment and p.client_id = p_client and p.confirmed_at is null;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;
revoke all on function private.appointments_confirm(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

-- What the confirmation page shows (resolve-link): the clinic, the moment in words, the
-- professional, the mode, whether it is confirmed already. Nothing about the client.
create function public.resolve_appointment_confirm_link(p_link_id uuid)
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
  if v.id is null or v.state not in ('booked', 'confirmed') or v.starts_at <= pg_catalog.now() then
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

-- « Confirmer ma présence »: {"state": "confirmed" | "invalid"}. One use.
create function public.confirm_appointment_by_link_for_service(p_token_hash bytea)
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
  if v.id is null or v.state not in ('booked', 'confirmed') or v.starts_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('state', 'invalid');
  end if;
  perform private.consume_secure_link(p_token_hash, 'appointment_confirm');
  perform private.appointments_confirm(l.org_id, v.id, m.client_id, 'link:appointment_confirm');
  return pg_catalog.jsonb_build_object('state', 'confirmed');
end;
$$;

insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
values ('appointment_confirm', 'appointments', interval '7 days', interval '30 days', 1, false, false,
        'resolve_appointment_confirm_link', null, 'appointments.view')
on conflict do nothing;

-- « OUI » by text (Communications' hook, ADR 0003): the next booked appointment a text of which
-- went to this number confirms. True when one did.
create or replace function private.sms_confirmation_hook(p_org uuid, p_phone_e164 text, p_message_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  if p_org is null or p_phone_e164 is null or not public.module_enabled_for_org(p_org, 'appointments') then
    return false;
  end if;
  for r in select m.appointment_id, m.client_id, m.recipient_client_id
             from public.appointment_messages m
             join public.appointments a on a.id = m.appointment_id
            where m.org_id = p_org and m.channel = 'sms' and m.status = 'sent' and m.kind <> 'cancelled'
              and m.sent_at > pg_catalog.now() - interval '14 days'
              and a.state = 'booked' and a.starts_at > pg_catalog.now() and a.starts_at = m.starts_at
            order by a.starts_at loop
    if exists (select 1 from private.client_contacts_for(p_org, r.client_id, 'appointments') c
                where c.client_id = r.recipient_client_id and c.mobile_e164 = p_phone_e164) then
      perform private.appointments_confirm(p_org, r.appointment_id, r.client_id, 'sms:confirmation');
      return true;
    end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.sms_confirmation_hook(uuid, text, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. « Clients sans rappel »
-- -----------------------------------------------------------------------------
-- The coming appointments (14 days at most) no recipient of which can be reached: no email
-- (reminders by email), no mobile with a text consent in force (reminders by text).
create function public.list_appointments_without_reminder(p_from timestamptz, p_to timestamptz)
returns table (id uuid, professional_id uuid, starts_at timestamptz, participants jsonb)
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
                      where p.appointment_id = a.id), '[]'::jsonb)
      from a
     order by a.starts_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- The job, the emails
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('appointments.messages', 'appointments', 'Courriels et rappels des rendez-vous',
   'Envoie les confirmations, les déplacements, les annulations et, la veille ouvrable, les rappels des rendez-vous par courriel ; les textos partent par Communications.',
   'function', 'appointments-messages', null, 'appointments.messages', null, false)
on conflict do nothing;

select cron.schedule('appointments.messages', '*/10 * * * *',
  $$select private.invoke_job_function('appointments.messages')$$);

insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
select x.key, 'appointments', x.label, x.description, x.why_line, x.subject, x.body, x.button_label,
       case when x.key like '%\_en' then
         '[
           {"path": "recipient.first_name", "label": "Prénom de la personne qui reçoit le courriel", "sample": "Camille", "required": true, "kind": "text"},
           {"path": "client.first_name", "label": "Prénom du client", "sample": "Léa", "required": true, "kind": "text"},
           {"path": "appointment.starts_at", "label": "Date et heure du rendez-vous", "sample": "October 26, 2026 at 2:30 PM", "required": true, "kind": "datetime"},
           {"path": "professional.name", "label": "Professionnel", "sample": "Félix Martin", "required": true, "kind": "text"},
           {"path": "appointment.access", "label": "Vidéo ou téléphone", "sample": "By video: https://zoom.us/j/123", "required": true, "kind": "text"},
           {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}
         ]'::jsonb
       else
         '[
           {"path": "recipient.first_name", "label": "Prénom de la personne qui reçoit le courriel", "sample": "Camille", "required": true, "kind": "text"},
           {"path": "client.first_name", "label": "Prénom du client", "sample": "Léa", "required": true, "kind": "text"},
           {"path": "appointment.starts_at", "label": "Date et heure du rendez-vous", "sample": "26 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"},
           {"path": "professional.name", "label": "Professionnel", "sample": "Félix Martin", "required": true, "kind": "text"},
           {"path": "appointment.access", "label": "Vidéo ou téléphone", "sample": "Par vidéo : https://zoom.us/j/123", "required": true, "kind": "text"},
           {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"}
         ]'::jsonb
       end,
       'appointments.view'
  from (values
    ('appointments.confirmation', 'Rendez-vous réservé',
     'Envoyé au client (et à qui gère ses rendez-vous) quand un rendez-vous est réservé.',
     'Vous recevez ce courriel parce qu''un rendez-vous a été réservé à la clinique.',
     'Votre rendez-vous du {{appointment.starts_at}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Le rendez-vous de {{client.first_name}} avec {{professional.name}} est réservé le {{appointment.starts_at}}.\n\n'
     '{{appointment.access}}\n\n'
     'Merci de confirmer votre présence. Pour annuler ou changer ce rendez-vous, appelez la clinique.',
     'Confirmer ma présence'),
    ('appointments.confirmation_en', 'Rendez-vous réservé (anglais)',
     'La confirmation de réservation, en anglais.',
     'You receive this email because an appointment was booked at the clinic.',
     'Your appointment on {{appointment.starts_at}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     '{{client.first_name}}''s appointment with {{professional.name}} is booked on {{appointment.starts_at}}.\n\n'
     '{{appointment.access}}\n\n'
     'Please confirm your attendance. To cancel or change this appointment, please call the clinic.',
     'Confirm my attendance'),
    ('appointments.reminder', 'Rappel de rendez-vous',
     'Envoyé la veille ouvrable du rendez-vous (le vendredi pour le lundi).',
     'Vous recevez ce courriel parce qu''un rendez-vous approche à la clinique.',
     'Rappel : rendez-vous le {{appointment.starts_at}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Nous vous rappelons le rendez-vous de {{client.first_name}} avec {{professional.name}} le {{appointment.starts_at}}.\n\n'
     '{{appointment.access}}\n\n'
     'Merci de confirmer votre présence. Pour annuler ou changer ce rendez-vous, appelez la clinique.',
     'Confirmer ma présence'),
    ('appointments.reminder_en', 'Rappel de rendez-vous (anglais)',
     'Le rappel de rendez-vous, en anglais.',
     'You receive this email because an appointment is coming up at the clinic.',
     'Reminder: appointment on {{appointment.starts_at}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     'This is a reminder of {{client.first_name}}''s appointment with {{professional.name}} on {{appointment.starts_at}}.\n\n'
     '{{appointment.access}}\n\n'
     'Please confirm your attendance. To cancel or change this appointment, please call the clinic.',
     'Confirm my attendance'),
    ('appointments.changed', 'Rendez-vous déplacé',
     'Envoyé quand un rendez-vous change de date, d''heure ou de professionnel.',
     'Vous recevez ce courriel parce qu''un rendez-vous a été déplacé à la clinique.',
     'Rendez-vous déplacé au {{appointment.starts_at}} — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Le rendez-vous de {{client.first_name}} est déplacé : il aura lieu le {{appointment.starts_at}} avec {{professional.name}}.\n\n'
     '{{appointment.access}}\n\n'
     'Merci de confirmer votre présence. Pour toute question, appelez la clinique.',
     'Confirmer ma présence'),
    ('appointments.changed_en', 'Rendez-vous déplacé (anglais)',
     'Le rendez-vous déplacé, en anglais.',
     'You receive this email because an appointment was moved at the clinic.',
     'Appointment moved to {{appointment.starts_at}} — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     '{{client.first_name}}''s appointment was moved: it will take place on {{appointment.starts_at}} with {{professional.name}}.\n\n'
     '{{appointment.access}}\n\n'
     'Please confirm your attendance. If you have any question, please call the clinic.',
     'Confirm my attendance'),
    ('appointments.cancelled', 'Rendez-vous annulé',
     'Envoyé quand un rendez-vous à venir est annulé.',
     'Vous recevez ce courriel parce qu''un rendez-vous a été annulé à la clinique.',
     'Rendez-vous annulé — {{clinic.name}}',
     E'Bonjour {{recipient.first_name}},\n\n'
     'Le rendez-vous de {{client.first_name}} avec {{professional.name}} du {{appointment.starts_at}} est annulé.\n\n'
     'Pour prendre un autre rendez-vous, appelez la clinique.',
     null),
    ('appointments.cancelled_en', 'Rendez-vous annulé (anglais)',
     'Le rendez-vous annulé, en anglais.',
     'You receive this email because an appointment was cancelled at the clinic.',
     'Appointment cancelled — {{clinic.name}}',
     E'Hello {{recipient.first_name}},\n\n'
     '{{client.first_name}}''s appointment with {{professional.name}} on {{appointment.starts_at}} is cancelled.\n\n'
     'To book another appointment, please call the clinic.',
     null)
  ) as x(key, label, description, why_line, subject, body, button_label)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.appointment_messages_for_service(uuid, int),
  public.prepare_appointment_message_for_service(uuid, uuid, bytea),
  public.finish_appointment_message_for_service(uuid, uuid, boolean),
  public.resolve_appointment_confirm_link(uuid),
  public.confirm_appointment_by_link_for_service(bytea),
  public.list_appointments_without_reminder(timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.appointment_messages_for_service(uuid, int),
  public.prepare_appointment_message_for_service(uuid, uuid, bytea),
  public.finish_appointment_message_for_service(uuid, uuid, boolean),
  public.resolve_appointment_confirm_link(uuid),
  public.confirm_appointment_by_link_for_service(bytea)
to service_role;
grant execute on function public.list_appointments_without_reminder(timestamptz, timestamptz) to authenticated;

select pg_catalog.set_config('app.audit_source', '', true);
