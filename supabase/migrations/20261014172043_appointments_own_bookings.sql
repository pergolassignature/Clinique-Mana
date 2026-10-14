-- =============================================================================
-- Rendez-vous: a professional's own bookings outside her availability (R-82; amends AP-12)
-- =============================================================================
-- Asked:   Christine, second series, answer 16 (2026-10-14): « Le professionnel peut ajouter un
--          rendez-vous où il veut »; the staff keep a reason and never book over another
--          appointment. Decision R-82, which supersedes AP-12's « never a professional on her own
--          agenda ».
-- Needs:   *_appointments_agenda.sql (appointments_outside_reason), *_appointments_security_fixes.sql
--          (book_appointment), *_appointments_holds.sql (move_appointment), *_appointments_parity.sql
--          (change_appointment_service), *_appointments_series.sql (preview_series).
--
-- * `private.appointments_own_agenda(professional)`: the caller holds `appointments.self` and the
--   professional is her own file (`private.current_professional_id()`, never an id from the client).
-- * `private.appointments_outside_reason(in_availability, reason, professional)`: on her own agenda
--   a professional books, moves or changes the service outside her availability without a reason;
--   the trace stays on the appointment (`outside_availability_reason` « Réservé par le
--   professionnel sur son propre agenda. » unless she wrote one, `outside_availability_by` = her,
--   the audit as for the staff). Anyone else: AP-12 as before (the 2-argument function, unchanged;
--   the holds of Demandes keep it: a proposal is in the availability only).
-- * `book_appointment`, `move_appointment`, `change_appointment_service`: the 3-argument check.
--   `create_series` books every date through `book_appointment`.
-- * `preview_series`: on her own agenda, a date outside the availability is not a conflict.
-- * Never over another appointment: the exclusion constraint is untouched (HINT `overlap`).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_own_bookings', true);

-- -----------------------------------------------------------------------------
-- 1. The rule
-- -----------------------------------------------------------------------------
create function private.appointments_own_agenda(p_professional_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Never null: a caller without a professional file (an admin) is not on her own agenda.
  select coalesce(private.has_permission('appointments.self') and p_professional_id is not null
                  and p_professional_id = private.current_professional_id(), false)
$$;

create function private.appointments_outside_reason(p_in_availability boolean, p_reason text, p_professional_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if p_in_availability then
    return null;
  end if;
  if not private.appointments_own_agenda(p_professional_id) then
    -- The staff (AP-12): a reason, `appointments.manage`.
    return private.appointments_outside_reason(p_in_availability, p_reason);
  end if;
  -- R-82: the professional on her own agenda, no reason asked; the trace stays.
  if v_reason is null then
    return 'Réservé par le professionnel sur son propre agenda.';
  end if;
  if pg_catalog.char_length(v_reason) not between 3 and 500 or not private.is_tidy_text(v_reason) then
    raise exception 'La raison « Hors disponibilités » compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'outside_availability_reason';
  end if;
  return v_reason;
end;
$$;

revoke all on function private.appointments_own_agenda(uuid), private.appointments_outside_reason(boolean, text, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. book_appointment (*_appointments_security_fixes.sql's, the 3-argument check)
-- -----------------------------------------------------------------------------
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
    private.appointments_in_availability(v_org, p_professional_id, p_service_id, p_starts_at, v_ends), p_outside_availability_reason,
    p_professional_id);
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
-- 3. move_appointment (*_appointments_holds.sql's, the 3-argument check)
-- -----------------------------------------------------------------------------
create or replace function public.move_appointment(p_id uuid, p_starts_at timestamptz, p_professional_id uuid default null,
                                        p_outside_availability_reason text default null)
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
  v_outside text;
begin
  if not (private.has_permission('appointments.manage') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_id for update;
  if v_appt.id is null then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  v_new_pro := coalesce(p_professional_id, v_appt.professional_id);
  if not private.appointments_can_act_on(v_appt) or not private.appointments_can_act(v_new_pro)
     or (v_appt.is_personal and v_new_pro <> v_appt.professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state = 'held' then
    raise exception 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.' using errcode = 'P0001', hint = 'held';
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
    select * into v_service from private.appointments_service(v_org, v_appt.service_id, v_pro.title_ids, false);
    v_ends := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
    v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
    v_outside := private.appointments_outside_reason(
      private.appointments_in_availability(v_org, v_new_pro, v_appt.service_id, p_starts_at, v_ends), p_outside_availability_reason,
      v_new_pro);
    select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_clients
      from public.appointment_participants p where p.appointment_id = p_id;
    perform private.appointments_check_clients(v_org, v_clients, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                               (p_starts_at at time zone private.appointments_tz(v_org))::date, false, null, false);
  end if;
  begin
    update public.appointments a
       set starts_at = p_starts_at, ends_at = v_ends, blocks_until = v_blocks, professional_id = v_new_pro,
           state = case when a.starts_at = p_starts_at and a.professional_id = v_new_pro then a.state else 'booked' end,
           confirmed_at = case when a.starts_at = p_starts_at and a.professional_id = v_new_pro then a.confirmed_at end,
           outside_availability_reason = v_outside,
           outside_availability_by = case when v_outside is not null then auth.uid() end
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

-- -----------------------------------------------------------------------------
-- 4. change_appointment_service (*_appointments_parity.sql's, the 3-argument check)
-- -----------------------------------------------------------------------------
create or replace function public.change_appointment_service(p_id uuid, p_service_id uuid, p_outside_availability_reason text default null)
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
    p_outside_availability_reason, v_appt.professional_id);
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
-- 5. preview_series (*_appointments_series.sql's): on her own agenda, outside is no conflict
-- -----------------------------------------------------------------------------
create or replace function public.preview_series(
  p_professional_id uuid, p_service_id uuid, p_first_starts_at timestamptz,
  p_interval_weeks int, p_weekdays int[], p_count int default null, p_until date default null
)
returns table (occurrence int, starts_at timestamptz, ends_at timestamptz, conflict text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_pro record;
  v_service record;
  v_length interval;
  v_slot interval;
  v_own boolean;
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  v_own := private.appointments_own_agenda(p_professional_id);
  select * into v_pro from private.appointments_professional(v_org, p_professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids, true);
  v_length := pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_slot := pg_catalog.make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes);
  return query
    select s.occurrence, s.starts_at, s.starts_at + v_length,
           case when exists (select 1 from public.appointments a
                              where a.org_id = v_org and a.professional_id = p_professional_id
                                and (a.state <> 'cancelled' or a.kept_on_schedule)
                                and pg_catalog.tstzrange(a.starts_at, a.blocks_until, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_slot, '[)'))
                  then 'overlap'
                when not v_own
                     and not private.appointments_in_availability(v_org, p_professional_id, p_service_id, s.starts_at, s.starts_at + v_length)
                  then 'outside_availability'
           end
      from private.appointments_series_starts(v_org, p_first_starts_at, p_interval_weeks, p_weekdays, p_count, p_until) s
     order by s.occurrence;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
