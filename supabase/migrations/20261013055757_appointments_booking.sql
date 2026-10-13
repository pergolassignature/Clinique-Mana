-- =============================================================================
-- Rendez-vous: booking RPCs (plan R1)
-- =============================================================================
-- Every write of the agenda, all definer, the permission first, refusals in French (P0001)
-- with the field as HINT:
--   settings     set_appointment_settings (appointments.settings)
--   availability set_availability_rule, delete_availability_rule, add_availability_exception,
--                remove_availability_exception (appointments.manage, or appointments.self for
--                the professional's own)
--   booking      book_appointment, move_appointment, set_appointment_presence, cancel_appointment
--   reads        get_open_slots (appointments.view, or appointments.self for one's own; Demandes)
-- The rules a booking checks, in the database (R-13, R-58, AP-3 … AP-7):
--   - the professional is active and offers the service (one of her titles, or a clinic service);
--   - the service is bookable (a duration), its slot is duration + « pause après »;
--   - the slot lies in one of her availability windows (local time, the service allowed, an
--     exception never overlapping), else « en dehors de ses disponibilités »;
--   - no overlap with her other active appointments (the exclusion constraint);
--   - the clients: one (two for a couple service, or a second person), active files only, her
--     limits (« Femmes seulement », a minimum age) on the client;
--   - a client with a balance is refused (HINT balance_due) unless someone holding
--     appointments.balance_override gives a reason (R-58). `private.client_has_balance` is a
--     stub returning false until Facturation (F3) replaces it.
-- Published for other modules: get_open_slots; the merge and anonymisation handlers of Clients.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_booking', true);

-- -----------------------------------------------------------------------------
-- Helpers (private, granted to no role)
-- -----------------------------------------------------------------------------
create function private.appointments_tz(p_org uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto')
$$;

-- May the caller act on this professional's agenda? The staff on every one, a professional on hers.
create function private.appointments_can_act(p_professional_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_permission('appointments.manage')
      or (private.has_permission('appointments.self') and p_professional_id is not null
          and p_professional_id = private.current_professional_id())
$$;

-- Facturation (F3) replaces this stub: whether a client owes money (R-58).
create function private.client_has_balance(p_org uuid, p_client_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select false
$$;

-- The professional must be active; returns her title ids, « Femmes seulement » and minimum age.
create function private.appointments_professional(p_org uuid, p_professional_id uuid)
returns table (title_ids uuid[], women_only boolean, min_client_age smallint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Professionnels' published facts (never its tables, CLAUDE.md §5).
  select f.status, f.title_ids, f.women_only, f.min_client_age
    into v_status, title_ids, women_only, min_client_age
    from private.professional_booking_facts(p_org, p_professional_id) f;
  if v_status is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  if v_status <> 'active' then
    raise exception 'Ce professionnel n''est pas actif : il ne reçoit pas de rendez-vous.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  return next;
end;
$$;

-- The service, if bookable and offered by these titles: its duration, « pause après », couple flag.
create function private.appointments_service(p_org uuid, p_service_id uuid, p_title_ids uuid[])
returns table (duration_minutes int, buffer_after_minutes int, for_two boolean)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_titles uuid[];
begin
  select s.duration_minutes, s.buffer_after_minutes, s.for_two, s.title_ids
    into duration_minutes, buffer_after_minutes, for_two, v_titles
    from public.services_catalog s
   where s.org_id = p_org and s.id = p_service_id;
  if duration_minutes is null then
    raise exception 'Ce service n''existe pas ou n''est plus offert.' using errcode = 'P0001', hint = 'service_id';
  end if;
  if duration_minutes = 0 then
    raise exception 'Ce service ne se réserve pas à l''agenda (il n''a pas de durée).' using errcode = 'P0001', hint = 'service_id';
  end if;
  if pg_catalog.cardinality(v_titles) > 0 and not (v_titles && coalesce(p_title_ids, '{}')) then
    raise exception 'Ce professionnel n''offre pas ce service.' using errcode = 'P0001', hint = 'service_id';
  end if;
  return next;
end;
$$;

-- Whether [p_starts, p_ends) lies in one of the professional's windows for this service (local
-- time in the clinic's zone, the same local day) and no exception overlaps it.
create function private.appointments_in_availability(p_org uuid, p_professional_id uuid, p_service_id uuid, p_starts timestamptz, p_ends timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  with l as (
    select (p_starts at time zone private.appointments_tz(p_org)) as ls,
           (p_ends at time zone private.appointments_tz(p_org)) as le
  )
  select exists (
           select 1 from public.availability_rules r, l
            where r.org_id = p_org and r.professional_id = p_professional_id
              and r.weekday = extract(isodow from l.ls)::smallint
              and l.ls::date >= r.valid_from and (r.valid_until is null or l.ls::date <= r.valid_until)
              and l.le::date = l.ls::date
              and l.ls::time >= r.start_time
              and (case when r.overflow_allowed then l.ls::time < r.end_time else l.le::time <= r.end_time end)
              and (pg_catalog.cardinality(r.service_ids) = 0 or p_service_id = any (r.service_ids)))
     and not exists (
           select 1 from public.availability_exceptions e
            where e.org_id = p_org and e.professional_id = p_professional_id
              and pg_catalog.tstzrange(e.starts_at, e.ends_at, '[)') && pg_catalog.tstzrange(p_starts, p_ends, '[)'))
$$;

-- The clients of a booking: their number, active files only (Clients' published facts), the
-- professional's limits on the first one, the balance rule on each (R-58).
create function private.appointments_check_clients(
  p_org uuid, p_client_ids uuid[], p_for_two boolean, p_women_only boolean, p_min_age smallint, p_on date,
  p_check_balance boolean, p_override_reason text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count int := coalesce(pg_catalog.cardinality(p_client_ids), 0);
  v_distinct int;
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
  if p_for_two and v_count <> 2 then
    raise exception 'Ce service se réserve pour deux personnes : choisissez les deux clients.' using errcode = 'P0001', hint = 'client_ids';
  end if;
  if v_count > 2 then
    raise exception 'Un rendez-vous compte deux clients au plus.' using errcode = 'P0001', hint = 'client_ids';
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
    end if;
  end loop;
end;
$$;

revoke all on function private.appointments_tz(uuid), private.appointments_can_act(uuid),
  private.client_has_balance(uuid, uuid), private.appointments_professional(uuid, uuid),
  private.appointments_service(uuid, uuid, uuid[]),
  private.appointments_in_availability(uuid, uuid, uuid, timestamptz, timestamptz),
  private.appointments_check_clients(uuid, uuid[], boolean, boolean, smallint, date, boolean, text)
  from public, anon, authenticated, service_role;

-- A start on a 5-minute mark (the grid snaps at 15, the editor types to 5).
create function private.appointments_check_start(p_starts_at timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_starts_at is null then
    raise exception 'Choisissez la date et l''heure du rendez-vous.' using errcode = 'P0001', hint = 'starts_at';
  end if;
  if extract(second from p_starts_at) <> 0 or extract(minute from p_starts_at)::int % 5 <> 0 then
    raise exception 'L''heure du rendez-vous tombe sur un multiple de 5 minutes.' using errcode = 'P0001', hint = 'starts_at';
  end if;
end;
$$;
revoke all on function private.appointments_check_start(timestamptz) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Settings (appointments.settings)
-- -----------------------------------------------------------------------------
create function public.set_appointment_settings(
  p_business_days int[], p_business_start time, p_business_end time, p_reminder_business_days int, p_reminder_local_hour int
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
  insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour, updated_by)
  values (v_org, (select array_agg(distinct d::smallint order by d::smallint) from pg_catalog.unnest(p_business_days) d),
          p_business_start, p_business_end, p_reminder_business_days, p_reminder_local_hour, auth.uid())
  on conflict (org_id) do update
     set business_days = excluded.business_days, business_start = excluded.business_start, business_end = excluded.business_end,
         reminder_business_days = excluded.reminder_business_days, reminder_local_hour = excluded.reminder_local_hour,
         updated_by = excluded.updated_by;
end;
$$;

-- -----------------------------------------------------------------------------
-- Availability
-- -----------------------------------------------------------------------------
-- Creates (p_id null) or updates a weekly window. Its services must be the clinic's active ones;
-- two windows of a professional never overlap on a weekday over overlapping validity.
create function public.set_availability_rule(
  p_id uuid, p_professional_id uuid, p_weekday int, p_start_time time, p_end_time time, p_service_ids uuid[],
  p_visible_to_clients boolean, p_overflow_allowed boolean, p_valid_from date, p_valid_until date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_existing public.availability_rules;
  v_from date := coalesce(p_valid_from, private.clinic_today());
  v_services uuid[] := coalesce(p_service_ids, '{}');
  v_id uuid;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if p_id is not null then
    select r.* into v_existing from public.availability_rules r where r.org_id = v_org and r.id = p_id for update;
    if v_existing.id is null then
      raise exception 'Plage introuvable.' using errcode = 'P0001', hint = 'rule_id';
    end if;
    if not private.appointments_can_act(v_existing.professional_id) then
      raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
    end if;
  end if;
  perform private.appointments_professional(v_org, p_professional_id);
  if p_weekday is null or p_weekday not between 1 and 7 then
    raise exception 'Choisissez le jour de la semaine.' using errcode = 'P0001', hint = 'weekday';
  end if;
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then
    raise exception 'La fin de la plage vient après son début.' using errcode = 'P0001', hint = 'end_time';
  end if;
  if extract(minute from p_start_time)::int % 5 <> 0 or extract(minute from p_end_time)::int % 5 <> 0
     or extract(second from p_start_time) <> 0 or extract(second from p_end_time) <> 0 then
    raise exception 'Les heures d''une plage tombent sur un multiple de 5 minutes.' using errcode = 'P0001', hint = 'start_time';
  end if;
  if p_valid_until is not null and p_valid_until < v_from then
    raise exception 'La fin de validité vient après son début.' using errcode = 'P0001', hint = 'valid_until';
  end if;
  if exists (select 1 from pg_catalog.unnest(v_services) s
              where not exists (select 1 from public.services_catalog c where c.org_id = v_org and c.id = s and c.duration_minutes > 0)) then
    raise exception 'Un des services choisis n''existe pas ou ne se réserve pas à l''agenda.' using errcode = 'P0001', hint = 'service_ids';
  end if;
  if exists (select 1 from public.availability_rules r
              where r.org_id = v_org and r.professional_id = p_professional_id and r.weekday = p_weekday
                and r.id is distinct from p_id
                and r.start_time < p_end_time and p_start_time < r.end_time
                and r.valid_from <= coalesce(p_valid_until, 'infinity'::date)
                and v_from <= coalesce(r.valid_until, 'infinity'::date)) then
    raise exception 'Cette plage chevauche une autre plage du même jour.' using errcode = 'P0001', hint = 'start_time';
  end if;
  if p_id is null then
    insert into public.availability_rules (org_id, professional_id, weekday, start_time, end_time, service_ids,
                                           visible_to_clients, overflow_allowed, valid_from, valid_until, created_by)
    values (v_org, p_professional_id, p_weekday, p_start_time, p_end_time,
            (select coalesce(array_agg(distinct s), '{}') from pg_catalog.unnest(v_services) s),
            coalesce(p_visible_to_clients, true), coalesce(p_overflow_allowed, false), v_from, p_valid_until, auth.uid())
    returning id into v_id;
  else
    update public.availability_rules r
       set professional_id = p_professional_id, weekday = p_weekday, start_time = p_start_time, end_time = p_end_time,
           service_ids = (select coalesce(array_agg(distinct s), '{}') from pg_catalog.unnest(v_services) s),
           visible_to_clients = coalesce(p_visible_to_clients, true), overflow_allowed = coalesce(p_overflow_allowed, false),
           valid_from = v_from, valid_until = p_valid_until
     where r.id = p_id
    returning r.id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.delete_availability_rule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pro uuid;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select r.professional_id into v_pro from public.availability_rules r where r.org_id = v_org and r.id = p_id for update;
  if v_pro is null then
    raise exception 'Plage introuvable.' using errcode = 'P0001', hint = 'rule_id';
  end if;
  if not private.appointments_can_act(v_pro) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  delete from public.availability_rules r where r.id = p_id;
end;
$$;

create function public.add_availability_exception(p_professional_id uuid, p_kind text, p_starts_at timestamptz, p_ends_at timestamptz, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_label text := nullif(pg_catalog.btrim(coalesce(p_label, '')), '');
  v_id uuid;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  perform private.appointments_professional(v_org, p_professional_id);
  if p_kind is null or p_kind not in ('holiday', 'vacation', 'other') then
    raise exception 'Choisissez le type : jour férié, vacances ou autre.' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'La fin de l''exception vient après son début.' using errcode = 'P0001', hint = 'ends_at';
  end if;
  if p_ends_at - p_starts_at > interval '366 days' then
    raise exception 'Une exception dure un an au plus.' using errcode = 'P0001', hint = 'ends_at';
  end if;
  if v_label is not null and (pg_catalog.char_length(v_label) > 120 or not private.is_tidy_text(v_label)) then
    raise exception 'Le libellé compte 120 caractères au plus.' using errcode = 'P0001', hint = 'label';
  end if;
  insert into public.availability_exceptions (org_id, professional_id, kind, starts_at, ends_at, label, created_by)
  values (v_org, p_professional_id, p_kind, p_starts_at, p_ends_at, v_label, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_availability_exception(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pro uuid;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select e.professional_id into v_pro from public.availability_exceptions e where e.org_id = v_org and e.id = p_id for update;
  if v_pro is null then
    raise exception 'Exception introuvable.' using errcode = 'P0001', hint = 'exception_id';
  end if;
  if not private.appointments_can_act(v_pro) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  delete from public.availability_exceptions e where e.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Booking
-- -----------------------------------------------------------------------------
-- Books one appointment; returns its id. `p_client_ids`: the client first, then a second person
-- (two for a couple service). `p_balance_override_reason`: with appointments.balance_override,
-- books a client who owes money and keeps the reason (R-58).
create function public.book_appointment(
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_ids uuid[],
  p_mode text default 'video',
  p_internal_note text default null,
  p_client_message text default null,
  p_balance_override_reason text default null
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
  v_id uuid;
  v_client uuid;
  v_ord int;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  perform private.appointments_check_start(p_starts_at);
  if p_starts_at > now() + interval '2 years' then
    raise exception 'Un rendez-vous se réserve au plus deux ans à l''avance.' using errcode = 'P0001', hint = 'starts_at';
  end if;
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
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids);
  v_ends := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
  if not private.appointments_in_availability(v_org, p_professional_id, p_service_id, p_starts_at, v_ends) then
    raise exception 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.' using errcode = 'P0001', hint = 'starts_at';
  end if;
  perform private.appointments_check_clients(v_org, p_client_ids, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                             (p_starts_at at time zone private.appointments_tz(v_org))::date, true, v_override);

  begin
    insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode,
                                     internal_note, client_message, balance_override_reason, balance_override_by, created_by)
    values (v_org, p_professional_id, p_service_id, p_starts_at, v_ends, v_blocks, coalesce(p_mode, 'video'),
            v_note, v_message,
            case when v_override is not null and private.has_permission('appointments.balance_override') then v_override end,
            case when v_override is not null and private.has_permission('appointments.balance_override') then auth.uid() end,
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

-- Moves an appointment to another start (and professional): the same checks as a booking but
-- the balance; the client's confirmation is cleared (the time changed).
create function public.move_appointment(p_id uuid, p_starts_at timestamptz, p_professional_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_new_pro uuid;
  v_pro record;
  v_service record;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_clients uuid[];
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  v_new_pro := coalesce(p_professional_id, v_appt.professional_id);
  if not private.appointments_can_act(v_appt.professional_id) or not private.appointments_can_act(v_new_pro) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state not in ('booked', 'confirmed') then
    raise exception 'Un rendez-vous annulé ou terminé ne se déplace pas.' using errcode = 'P0001', hint = 'state';
  end if;
  perform private.appointments_check_start(p_starts_at);
  if v_appt.is_personal then
    v_ends := p_starts_at + (v_appt.ends_at - v_appt.starts_at);
    v_blocks := v_ends;
  else
    select * into v_pro from private.appointments_professional(v_org, v_new_pro);
    select * into v_service from private.appointments_service(v_org, v_appt.service_id, v_pro.title_ids);
    v_ends := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
    v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
    if not private.appointments_in_availability(v_org, v_new_pro, v_appt.service_id, p_starts_at, v_ends) then
      raise exception 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.' using errcode = 'P0001', hint = 'starts_at';
    end if;
    select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_clients
      from public.appointment_participants p where p.appointment_id = p_id;
    perform private.appointments_check_clients(v_org, v_clients, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                               (p_starts_at at time zone private.appointments_tz(v_org))::date, false, null);
  end if;
  begin
    update public.appointments a
       set starts_at = p_starts_at, ends_at = v_ends, blocks_until = v_blocks, professional_id = v_new_pro,
           state = case when a.starts_at = p_starts_at and a.professional_id = v_new_pro then a.state else 'booked' end,
           confirmed_at = case when a.starts_at = p_starts_at and a.professional_id = v_new_pro then a.confirmed_at end
     where a.id = p_id;
  exception when exclusion_violation then
    raise exception 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).' using errcode = 'P0001', hint = 'overlap';
  end;
  if v_new_pro <> v_appt.professional_id or v_appt.starts_at <> p_starts_at then
    update public.appointment_participants p set confirmed_at = null where p.appointment_id = p_id;
  end if;
  if v_new_pro <> v_appt.professional_id then
    perform private.clients_link_professional(v_org, p.client_id, v_new_pro, 'appointment')
       from public.appointment_participants p where p.appointment_id = p_id;
  end if;
end;
$$;

-- A participant's presence: « Sera présent » (expected), « Présent(e) », « Absent(e) ».
create function public.set_appointment_presence(p_appointment_id uuid, p_client_id uuid, p_presence text)
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
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act(v_appt.professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state = 'cancelled' then
    raise exception 'Le rendez-vous est annulé : la présence ne se note pas.' using errcode = 'P0001', hint = 'state';
  end if;
  if p_presence is null or p_presence not in ('expected', 'present', 'absent') then
    raise exception 'La présence est : sera présent, présent ou absent.' using errcode = 'P0001', hint = 'presence';
  end if;
  update public.appointment_participants p set presence = p_presence
   where p.appointment_id = p_appointment_id and p.client_id = p_client_id;
  if not found then
    raise exception 'Ce client n''est pas au rendez-vous.' using errcode = 'P0001', hint = 'client_id';
  end if;
end;
$$;

-- Cancels an appointment with a reason (its key); late when under the cancellation policy's
-- notice on the session's date (Services et tarifs' billing_policy_on); « garder à l'horaire »
-- keeps the slot taken. The fee is Facturation's (R-59), from `cancel_late`.
create function public.cancel_appointment(p_id uuid, p_reason_key text, p_details text default null, p_kept_on_schedule boolean default false)
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
  if not private.appointments_can_act(v_appt.professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
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
         cancel_late = case when v_appt.is_personal or v_notice is null then null
                            else now() > v_appt.starts_at - pg_catalog.make_interval(hours => v_notice) end
   where a.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------
-- The free slots of a professional for a service between two local dates (62 days at most):
-- each availability window allowing the service, cut in slots of the service's length plus its
-- « pause après » from the window's start, minus the past, the exceptions and her active
-- appointments. Staff (appointments.view) for any professional; a professional for herself.
create function public.get_open_slots(p_professional_id uuid, p_service_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_tz text := private.appointments_tz(v_org);
  v_pro record;
  v_service record;
  v_slot interval;
  v_length interval;
begin
  if not (private.has_permission('appointments.view')
          or (private.has_permission('appointments.self') and p_professional_id = private.current_professional_id())) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choisissez une période de 62 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  select * into v_pro from private.appointments_professional(v_org, p_professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids);
  v_length := pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_slot := pg_catalog.make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes);
  return query
    select s.starts_at, s.starts_at + v_length
      from (select distinct ((d.day + r.start_time) at time zone v_tz) + k.n * v_slot as starts_at,
                   r.end_time, r.overflow_allowed, d.day
              from pg_catalog.generate_series(p_from, p_to, interval '1 day') as d0(ts)
             cross join lateral (select d0.ts::date as day) d
              join public.availability_rules r
                on r.org_id = v_org and r.professional_id = p_professional_id
               and r.weekday = extract(isodow from d.day)::smallint
               and d.day >= r.valid_from and (r.valid_until is null or d.day <= r.valid_until)
               and (pg_catalog.cardinality(r.service_ids) = 0 or p_service_id = any (r.service_ids))
             cross join lateral pg_catalog.generate_series(0, 96) as k(n)) s
     where ((s.starts_at at time zone v_tz)::date = s.day)
       and (case when s.overflow_allowed then (s.starts_at at time zone v_tz)::time < s.end_time
                 else ((s.starts_at + v_length) at time zone v_tz)::time <= s.end_time
                      and ((s.starts_at + v_length) at time zone v_tz)::date = s.day end)
       and s.starts_at >= now()
       and not exists (select 1 from public.availability_exceptions e
                        where e.org_id = v_org and e.professional_id = p_professional_id
                          and pg_catalog.tstzrange(e.starts_at, e.ends_at, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_length, '[)'))
       and not exists (select 1 from public.appointments a
                        where a.org_id = v_org and a.professional_id = p_professional_id
                          and (a.state <> 'cancelled' or a.kept_on_schedule)
                          and pg_catalog.tstzrange(a.starts_at, a.blocks_until, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_slot, '[)'))
     order by s.starts_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clients' merge and anonymisation (data plug-ins, ADR 0003)
-- -----------------------------------------------------------------------------
-- A merge moves the merged file's places in appointments to the kept one; an appointment that
-- already holds both keeps the kept file once.
create function private.appointments_reassign_client(p_old uuid, p_new uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_dropped int;
  v_moved int;
begin
  delete from public.appointment_participants p
   where p.client_id = p_old
     and exists (select 1 from public.appointment_participants q where q.appointment_id = p.appointment_id and q.client_id = p_new);
  get diagnostics v_dropped = row_count;
  update public.appointment_participants p set client_id = p_new where p.client_id = p_old;
  get diagnostics v_moved = row_count;
  return v_dropped + v_moved;
end;
$$;

-- An anonymisation blanks the free texts of the person's appointments (the note, the message,
-- the cancellation's details): they may name her. Dates, services and presence stay counted.
create function private.appointments_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.appointments a
     set internal_note = null, client_message = null, cancel_details = null
   where exists (select 1 from public.appointment_participants p where p.appointment_id = a.id and p.client_id = p_id)
     and (a.internal_note is not null or a.client_message is not null or a.cancel_details is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.appointments_reassign_client(uuid, uuid), private.appointments_anonymize_client(uuid)
  from public, anon, authenticated, service_role;

insert into public.client_merge_handlers (module_key, function_name)
values ('appointments', 'private.appointments_reassign_client')
on conflict do nothing;
insert into public.client_anonymize_handlers (module_key, function_name)
values ('appointments', 'private.appointments_anonymize_client')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.set_appointment_settings(int[], time, time, int, int),
  public.set_availability_rule(uuid, uuid, int, time, time, uuid[], boolean, boolean, date, date),
  public.delete_availability_rule(uuid),
  public.add_availability_exception(uuid, text, timestamptz, timestamptz, text),
  public.remove_availability_exception(uuid),
  public.book_appointment(uuid, uuid, timestamptz, uuid[], text, text, text, text),
  public.move_appointment(uuid, timestamptz, uuid),
  public.set_appointment_presence(uuid, uuid, text),
  public.cancel_appointment(uuid, text, text, boolean),
  public.get_open_slots(uuid, uuid, date, date)
from public, anon;
grant execute on function
  public.set_appointment_settings(int[], time, time, int, int),
  public.set_availability_rule(uuid, uuid, int, time, time, uuid[], boolean, boolean, date, date),
  public.delete_availability_rule(uuid),
  public.add_availability_exception(uuid, text, timestamptz, timestamptz, text),
  public.remove_availability_exception(uuid),
  public.book_appointment(uuid, uuid, timestamptz, uuid[], text, text, text, text),
  public.move_appointment(uuid, timestamptz, uuid),
  public.set_appointment_presence(uuid, uuid, text),
  public.cancel_appointment(uuid, text, text, boolean),
  public.get_open_slots(uuid, uuid, date, date)
to authenticated;
