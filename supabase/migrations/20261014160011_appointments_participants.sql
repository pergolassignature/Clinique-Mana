-- =============================================================================
-- Rendez-vous: an appointment for several people (R-79; amends AP-5)
-- =============================================================================
-- Asked:   Christine, second series, answer 10 (2026-10-14): « Un rendez-vous doit pouvoir réunir
--          plus d'une personne, et chacune reçoit sa notification » (a family). Decision R-79.
-- Needs:   *_appointments_booking.sql (appointments_check_clients), *_appointments_holds.sql
--          (appointments_anonymize_client), *_appointments_security_fixes.sql (get_booking_consents),
--          *_appointments_messages_sheet.sql (appointments_queue_message with `again`).
--
-- * `private.appointments_max_clients()` = 6: the clients one appointment may hold (the person seen
--   and five others, each with her own file). One constant, published (Demandes reads it).
--   Default decision — révisable.
-- * `appointments_check_clients` (same signature): up to that many; a couple service still needs
--   exactly two; the professional's limits still bear on the first client, the person seen.
-- * `appointment_participants.created_at` defaults to `clock_timestamp()`: the clients booked in one
--   call keep the order they were given (every reader orders by `role = 'second', created_at`).
--   The role stays `client` (the person seen) and `second` (every other participant): billing
--   invoices the appointment once, at the person seen's file (unchanged).
-- * `get_booking_consents`: up to the maximum.
-- * `add_appointment_participant(id, client)` / `remove_appointment_participant(id, client)`: the
--   sheet edits the participants of a booked or confirmed appointment still to come (the booking's
--   rules on the whole list; a professional only with her own clients). The added client (and each
--   relation who manages her appointments, AP-19) gets the confirmation; the removed one her
--   cancellation (a relation who still follows someone of the appointment does not), her pending
--   messages are set aside and her links revoked; removing the person seen makes the next one the
--   person seen.
-- * `appointments_queue_message(org, id, kind, again, client_ids)`: those clients' recipients only
--   (null: every participant, as before). The 4-argument one calls it with null.
-- * `appointments_anonymize_client`: one participant (the next) becomes the person seen, not every
--   other one.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_participants', true);

-- -----------------------------------------------------------------------------
-- 1. The maximum
-- -----------------------------------------------------------------------------
create function private.appointments_max_clients()
returns int
language sql
immutable
set search_path = ''
as $$
  select 6
$$;
revoke all on function private.appointments_max_clients() from public, anon, authenticated, service_role;

alter table public.appointment_participants alter column created_at set default pg_catalog.clock_timestamp();

-- *_appointments_booking.sql's, up to the maximum.
create or replace function private.appointments_check_clients(
  p_org uuid, p_client_ids uuid[], p_for_two boolean, p_women_only boolean, p_min_age smallint, p_on date,
  p_check_balance boolean, p_override_reason text, p_check_count boolean default true
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count int := coalesce(pg_catalog.cardinality(p_client_ids), 0);
  v_distinct int;
  v_overridden boolean := false;
  r record;
  i int := 0;
begin
  select count(distinct x) into v_distinct from pg_catalog.unnest(coalesce(p_client_ids, '{}'::uuid[])) x;
  if v_count = 0 then
    raise exception 'Choisissez le client du rendez-vous.' using errcode = 'P0001', hint = 'client_ids';
  end if;
  if v_distinct <> v_count then
    raise exception 'Le même client est choisi deux fois.' using errcode = 'P0001', hint = 'client_ids';
  end if;
  if p_check_count and p_for_two and v_count <> 2 then
    raise exception 'Ce service se réserve pour deux personnes : choisissez les deux clients.' using errcode = 'P0001', hint = 'client_ids';
  end if;
  if v_count > private.appointments_max_clients() then
    raise exception 'Un rendez-vous compte % clients au plus.', private.appointments_max_clients() using errcode = 'P0001', hint = 'client_ids';
  end if;
  -- Clients' published facts (never its tables, CLAUDE.md §5).
  for r in select f.* from private.clients_booking_facts(p_org, p_client_ids) f order by f.ord loop
    i := i + 1;
    if not r.found then
      raise exception 'Dossier client introuvable.' using errcode = 'P0001', hint = 'client_ids';
    end if;
    if r.is_closed then
      raise exception 'Ce dossier est fusionné ou anonymisé : choisissez le dossier conservé.' using errcode = 'P0001', hint = 'client_ids';
    end if;
    if r.is_archived then
      raise exception 'Ce dossier est archivé : restaurez-le avant de réserver.' using errcode = 'P0001', hint = 'client_ids';
    end if;
    -- The professional's limits (P4-245) bear on the first client, the person seen.
    if i = 1 and p_women_only and r.sex is not null and r.sex <> 'female' then
      raise exception 'Ce professionnel reçoit seulement des femmes.' using errcode = 'P0001', hint = 'client_ids';
    end if;
    if i = 1 and p_min_age is not null and r.birthday is not null
       and extract(year from pg_catalog.age(p_on, r.birthday)) < p_min_age then
      raise exception 'Ce professionnel reçoit les clients de % ans et plus.', p_min_age using errcode = 'P0001', hint = 'client_ids';
    end if;
    if p_check_balance and private.client_has_balance(p_org, r.client_id) then
      if p_override_reason is null then
        raise exception 'Ce client a un solde dû : il faut le régler, ou une exception approuvée, avant un nouveau rendez-vous.'
          using errcode = 'P0001', hint = 'balance_due';
      end if;
      if not private.has_permission('appointments.balance_override') then
        raise exception 'Permission refusée : appointments.balance_override' using errcode = '42501';
      end if;
      v_overridden := true;
    end if;
  end loop;
  return v_overridden;
end;
$$;
revoke all on function private.appointments_check_clients(uuid, uuid[], boolean, boolean, smallint, date, boolean, text, boolean)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. get_booking_consents: up to the maximum
-- -----------------------------------------------------------------------------
-- *_appointments_security_fixes.sql's, with the maximum.
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
  if p_client_ids is null or pg_catalog.cardinality(p_client_ids) > private.appointments_max_clients() then
    raise exception '% clients au plus.', private.appointments_max_clients() using errcode = '22023';
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

-- -----------------------------------------------------------------------------
-- 3. The queue, for some clients only
-- -----------------------------------------------------------------------------
-- *_appointments_messages_sheet.sql's, with `p_client_ids`: null queues for every participant (as
-- before); otherwise for those clients only, participants or not (a client just removed gets her
-- cancellation). A cancellation for a removed client skips a relation who still follows another
-- participant of the appointment (the appointment is not cancelled for her).
create function private.appointments_queue_message(p_org uuid, p_appointment uuid, p_kind text, p_again boolean, p_client_ids uuid[])
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
  for p in
    select x.client_id from public.appointment_participants x
     where x.appointment_id = v.id and p_client_ids is null
    union all
    select u.id from pg_catalog.unnest(coalesce(p_client_ids, '{}'::uuid[])) as u(id)
     where p_client_ids is not null and u.id is not null
  loop
    for c in select * from private.client_contacts_for(p_org, p.client_id, 'appointments') loop
      -- A reminder right after a confirmation or a change of that start is one message too many.
      continue when p_kind = 'reminder' and not coalesce(p_again, false) and exists (
        select 1 from public.appointment_messages m
         where m.appointment_id = v.id and m.recipient_client_id = c.client_id and m.starts_at = v.starts_at
           and m.kind in ('confirmation', 'changed') and m.created_at > pg_catalog.now() - interval '18 hours');
      -- A removed client's cancellation never reaches a relation who still follows a participant.
      continue when p_kind = 'cancelled' and p_client_ids is not null and exists (
        select 1 from public.appointment_participants y
         cross join lateral private.client_contacts_for(p_org, y.client_id, 'appointments') k
         where y.appointment_id = v.id and not (y.client_id = any (p_client_ids)) and k.client_id = c.client_id);
      if c.reminders_by_email and c.email is not null then
        v_id := null;
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
revoke all on function private.appointments_queue_message(uuid, uuid, text, boolean, uuid[]) from public, anon, authenticated, service_role;

create or replace function private.appointments_queue_message(p_org uuid, p_appointment uuid, p_kind text, p_again boolean)
returns int
language sql
set search_path = ''
as $f$
  select private.appointments_queue_message(p_org, p_appointment, p_kind, p_again, null)
$f$;

-- -----------------------------------------------------------------------------
-- 4. The participants of an appointment, from the sheet
-- -----------------------------------------------------------------------------
-- The checks both RPCs share: the caller may act on the appointment, a booked or confirmed one
-- with clients, still to come. Returns the locked row.
create function private.appointments_participants_target(p_org uuid, p_id uuid)
returns public.appointments
language plpgsql
set search_path = ''
as $$
declare
  v_appt public.appointments;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = p_org and a.id = p_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.is_personal then
    raise exception 'Un rendez-vous personnel n''a pas de client.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if v_appt.state = 'held' then
    raise exception 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.' using errcode = 'P0001', hint = 'held';
  end if;
  if v_appt.state not in ('booked', 'confirmed') then
    raise exception 'Les participants d''un rendez-vous annulé ou terminé ne changent plus.' using errcode = 'P0001', hint = 'state';
  end if;
  if v_appt.starts_at <= pg_catalog.now() then
    raise exception 'Ce rendez-vous est commencé : ses participants ne changent plus (notez plutôt la présence).' using errcode = 'P0001', hint = 'starts_at';
  end if;
  return v_appt;
end;
$$;
revoke all on function private.appointments_participants_target(uuid, uuid) from public, anon, authenticated, service_role;

create function public.add_appointment_participant(p_appointment_id uuid, p_client_id uuid)
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
  v_on date;
begin
  v_appt := private.appointments_participants_target(v_org, p_appointment_id);
  if p_client_id is null then
    raise exception 'Choisissez le client à ajouter.' using errcode = 'P0001', hint = 'client_id';
  end if;
  if exists (select 1 from public.appointment_participants p where p.appointment_id = v_appt.id and p.client_id = p_client_id) then
    raise exception 'Ce client participe déjà à ce rendez-vous.' using errcode = 'P0001', hint = 'client_id';
  end if;
  -- A professional adds only the clients already in her files (AP-49's security review).
  if not private.has_permission('appointments.manage')
     and not private.client_visible_to_professional(p_client_id, v_appt.professional_id) then
    raise exception 'Ce client n''est pas encore dans vos dossiers : demandez à la clinique de le jumeler.'
      using errcode = 'P0001', hint = 'client_id';
  end if;
  select * into v_pro from private.appointments_professional(v_org, v_appt.professional_id);
  select * into v_service from private.appointments_service(v_org, v_appt.service_id, v_pro.title_ids, false);
  select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_clients
    from public.appointment_participants p where p.appointment_id = v_appt.id;
  if v_service.for_two and pg_catalog.cardinality(v_clients) >= 2 then
    raise exception 'Ce service se réserve pour deux personnes : changez le service pour ajouter une autre personne.' using errcode = 'P0001', hint = 'client_id';
  end if;
  v_on := (v_appt.starts_at at time zone private.appointments_tz(v_org))::date;
  -- The booking's rules on the whole list (the maximum, the files, her limits on the person seen)…
  perform private.appointments_check_clients(v_org, v_clients || p_client_id, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                             v_on, false, null, false);
  -- … and the balance rule on the new client, with no exception (as a proposal).
  perform private.appointments_check_clients(v_org, array[p_client_id], false, false, null, v_on, true, null, false);
  insert into public.appointment_participants (appointment_id, client_id, org_id, role)
  values (v_appt.id, p_client_id, v_org, 'second');
  perform private.clients_link_professional(v_org, p_client_id, v_appt.professional_id, 'appointment');
  -- Her confirmation (and her relations'), now: the others already have theirs.
  perform private.appointments_queue_message(v_org, v_appt.id, 'confirmation', false, array[p_client_id]);
end;
$$;

create function public.remove_appointment_participant(p_appointment_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_role text;
  v_pro record;
  v_service record;
  v_rest uuid[];
begin
  v_appt := private.appointments_participants_target(v_org, p_appointment_id);
  select p.role into v_role from public.appointment_participants p where p.appointment_id = v_appt.id and p.client_id = p_client_id;
  if v_role is null then
    raise exception 'Ce client n''est pas au rendez-vous.' using errcode = 'P0001', hint = 'client_id';
  end if;
  select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_rest
    from public.appointment_participants p where p.appointment_id = v_appt.id and p.client_id <> p_client_id;
  if pg_catalog.cardinality(v_rest) = 0 then
    raise exception 'Un rendez-vous garde au moins un client : annulez-le plutôt.' using errcode = 'P0001', hint = 'client_id';
  end if;
  select * into v_pro from private.appointments_professional(v_org, v_appt.professional_id);
  select * into v_service from private.appointments_service(v_org, v_appt.service_id, v_pro.title_ids, false);
  if v_service.for_two then
    raise exception 'Ce service se réserve pour deux personnes : changez le service avant de retirer une personne.' using errcode = 'P0001', hint = 'client_id';
  end if;
  -- The next one may become the person seen: the professional's limits bear on her.
  perform private.appointments_check_clients(v_org, v_rest, false, v_pro.women_only, v_pro.min_client_age,
                                             (v_appt.starts_at at time zone private.appointments_tz(v_org))::date, false, null, false);
  delete from public.appointment_participants p where p.appointment_id = v_appt.id and p.client_id = p_client_id;
  if v_role = 'client' then
    update public.appointment_participants p set role = 'client' where p.appointment_id = v_appt.id and p.client_id = v_rest[1];
  end if;
  -- Her messages waiting are set aside, and the links already sent to her confirm or cancel nothing.
  perform private.revoke_secure_links(v_org, 'appointment_confirm', 'appointment_message', m.id, null),
          private.revoke_secure_links(v_org, 'appointment_manage', 'appointment_message', m.id, null)
     from public.appointment_messages m
    where m.appointment_id = v_appt.id and m.client_id = p_client_id and m.link_id is not null;
  update public.appointment_messages m set status = 'skipped', skip_reason = 'superseded'
   where m.appointment_id = v_appt.id and m.client_id = p_client_id and m.status = 'pending';
  -- Her cancellation (and her relations', unless they still follow someone of the appointment).
  perform private.appointments_queue_message(v_org, v_appt.id, 'cancelled', false, array[p_client_id]);
end;
$$;

revoke all on function public.add_appointment_participant(uuid, uuid), public.remove_appointment_participant(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.add_appointment_participant(uuid, uuid), public.remove_appointment_participant(uuid, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Anonymisation: one participant becomes the person seen
-- -----------------------------------------------------------------------------
-- *_appointments_holds.sql's, promoting only the next participant (by order) when the anonymised
-- file was the person seen of a coming appointment with others.
create or replace function private.appointments_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_released int;
  v_texts int;
  v_cancelled int;
  v_left int;
begin
  -- Her held slots are released: a proposal to an anonymised file is moot (R1b).
  perform pg_catalog.set_config('app.audit_source', 'rpc:appointments_release_hold:client_anonymized', true);
  delete from public.appointments a
   where a.state = 'held'
     and exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.client_id = p_id);
  get diagnostics v_released = row_count;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  update public.appointments a
     set internal_note = null, client_message = null, cancel_details = null, outside_availability_reason = null
   where exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.client_id = p_id)
     and (a.internal_note is not null or a.client_message is not null or a.cancel_details is not null
          or a.outside_availability_reason is not null);
  get diagnostics v_texts = row_count;

  update public.appointments a
     set state = 'cancelled', cancelled_at = now(), cancel_late = null,
         cancel_reason_id = (select r.id from public.cancellation_reasons r where r.org_id = a.org_id and r.key = 'not_specified')
   where a.starts_at > now() and a.state in ('booked', 'confirmed')
     and exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.client_id = p_id)
     and not exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.client_id <> p_id);
  get diagnostics v_cancelled = row_count;

  update public.appointment_participants q set role = 'client'
   where q.client_id <> p_id and q.role = 'second'
     and exists (select 1 from public.appointments a where a.id = q.appointment_id and a.starts_at > now() and a.state in ('booked', 'confirmed'))
     and exists (select 1 from public.appointment_participants p where p.appointment_id = q.appointment_id and p.client_id = p_id and p.role = 'client')
     and q.client_id = (select y.client_id from public.appointment_participants y
                         where y.appointment_id = q.appointment_id and y.client_id <> p_id
                         order by y.role = 'second', y.created_at, y.client_id
                         limit 1);
  delete from public.appointment_participants p
   where p.client_id = p_id
     and exists (select 1 from public.appointments a where a.id = p.appointment_id and a.starts_at > now() and a.state in ('booked', 'confirmed'))
     and exists (select 1 from public.appointment_participants q where q.appointment_id = p.appointment_id and q.client_id <> p_id);
  get diagnostics v_left = row_count;
  return v_released + v_texts + v_cancelled + v_left;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
