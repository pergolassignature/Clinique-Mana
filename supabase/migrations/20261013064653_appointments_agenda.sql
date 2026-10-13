-- =============================================================================
-- Rendez-vous: the agenda's reads and the staff override (plan R2, AP-12, AP-13)
-- =============================================================================
--   1. AP-12 « Hors disponibilités »: a holder of appointments.manage (conseillère, adjointe,
--      admin) may book or move an appointment outside the professional's availability with an
--      explicit reason (3–500 characters), kept with its author and shown on the appointment;
--      never a professional on her own agenda (appointments.self alone); overlaps stay
--      impossible (the exclusion constraint is untouched). The reason is redacted in the audit:
--      the trigger is created again with it in its list, and an anonymisation blanks it.
--      book_appointment and move_appointment gain the trailing `p_outside_availability_reason`.
--   2. set_appointment_details(id, mode, internal_note, client_message): the editor's « Notes ».
--   3. list_agenda(from, to, professional_ids): the agenda's appointments with their clients'
--      names (Clients' published helper), 45 days at most. Staff see every professional's, a
--      personal one as busy time only (no label, no client); a professional sees her own.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_agenda', true);

alter table public.appointments
  add column outside_availability_reason text,
  add column outside_availability_by uuid references public.profiles(user_id) on delete set null,
  add constraint appointments_outside_availability_check
    check (outside_availability_reason is null or char_length(outside_availability_reason) between 3 and 500);
create index appointments_outside_availability_by_idx on public.appointments (outside_availability_by);

-- The audit trigger, with the new free text among the redacted columns.
drop trigger appointments_audit on public.appointments;
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function private.audit_trigger('personal_label', 'internal_note', 'client_message', 'cancel_details',
                                                      'balance_override_reason', 'video_url', 'outside_availability_reason');

-- The reason given to book outside the availability: required there, staff only (AP-12).
create function private.appointments_outside_reason(p_in_availability boolean, p_reason text)
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
  if v_reason is null then
    -- Its own HINT: the editor offers « Hors disponibilités » to the staff on it (AP-12).
    raise exception 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.' using errcode = 'P0001', hint = 'outside_availability';
  end if;
  if not private.has_permission('appointments.manage') then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_reason) not between 3 and 500 or not private.is_tidy_text(v_reason) then
    raise exception 'La raison « Hors disponibilités » compte de 3 à 500 caractères.' using errcode = 'P0001', hint = 'outside_availability_reason';
  end if;
  return v_reason;
end;
$$;
revoke all on function private.appointments_outside_reason(boolean, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. book_appointment and move_appointment with the override
-- -----------------------------------------------------------------------------
drop function public.book_appointment(uuid, uuid, timestamptz, uuid[], text, text, text, text);
create function public.book_appointment(
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

drop function public.move_appointment(uuid, timestamptz, uuid);
create function public.move_appointment(p_id uuid, p_starts_at timestamptz, p_professional_id uuid default null,
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
      private.appointments_in_availability(v_org, v_new_pro, v_appt.service_id, p_starts_at, v_ends), p_outside_availability_reason);
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
-- 2. The editor's details
-- -----------------------------------------------------------------------------
create function public.set_appointment_details(p_id uuid, p_mode text, p_internal_note text, p_client_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_internal_note, '')), '');
  v_message text := nullif(pg_catalog.btrim(coalesce(p_client_message, '')), '');
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
  if v_appt.state = 'cancelled' then
    raise exception 'Ce rendez-vous est annulé : il ne se modifie plus.' using errcode = 'P0001', hint = 'state';
  end if;
  if coalesce(p_mode, v_appt.mode) not in ('video', 'phone') then
    raise exception 'Le rendez-vous se fait en vidéo ou par téléphone.' using errcode = 'P0001', hint = 'mode';
  end if;
  if (v_note is not null and pg_catalog.char_length(v_note) > 5000) then
    raise exception 'La note compte 5 000 caractères au plus.' using errcode = 'P0001', hint = 'internal_note';
  end if;
  if (v_message is not null and pg_catalog.char_length(v_message) > 2000) then
    raise exception 'Le message au client compte 2 000 caractères au plus.' using errcode = 'P0001', hint = 'client_message';
  end if;
  update public.appointments a
     set mode = coalesce(p_mode, a.mode), internal_note = v_note, client_message = v_message
   where a.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. The agenda
-- -----------------------------------------------------------------------------
create function public.list_agenda(p_from timestamptz, p_to timestamptz, p_professional_ids uuid[] default null)
returns table (
  id uuid, professional_id uuid, service_id uuid, starts_at timestamptz, ends_at timestamptz, blocks_until timestamptz,
  mode text, state text, is_personal boolean, personal_label text, kept_on_schedule boolean, cancel_late boolean,
  cancel_reason_id uuid, confirmed_at timestamptz, outside_availability boolean, balance_override boolean,
  video_url text, video_status text, participants jsonb
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
           case when a.is_personal then '[]'::jsonb else coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'client_id', p.client_id, 'name', n.display_name, 'client_number', n.client_number,
                      'role', p.role, 'presence', p.presence, 'confirmed_at', p.confirmed_at)
                    order by p.role, n.display_name)
               from public.appointment_participants p
               left join names n on n.client_id = p.client_id
              where p.appointment_id = a.id), '[]'::jsonb) end
      from a
     order by a.starts_at, a.professional_id;
end;
$$;

revoke all on function
  public.book_appointment(uuid, uuid, timestamptz, uuid[], text, text, text, text, text),
  public.move_appointment(uuid, timestamptz, uuid, text),
  public.set_appointment_details(uuid, text, text, text),
  public.list_agenda(timestamptz, timestamptz, uuid[])
from public, anon;
grant execute on function
  public.book_appointment(uuid, uuid, timestamptz, uuid[], text, text, text, text, text),
  public.move_appointment(uuid, timestamptz, uuid, text),
  public.set_appointment_details(uuid, text, text, text),
  public.list_agenda(timestamptz, timestamptz, uuid[])
to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Anonymisation: the override's reason is a free text too (it may name the client)
-- -----------------------------------------------------------------------------
create or replace function private.appointments_anonymize_client(p_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_texts int;
  v_cancelled int;
  v_left int;
begin
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
     and exists (select 1 from public.appointment_participants p where p.appointment_id = q.appointment_id and p.client_id = p_id and p.role = 'client');
  delete from public.appointment_participants p
   where p.client_id = p_id
     and exists (select 1 from public.appointments a where a.id = p.appointment_id and a.starts_at > now() and a.state in ('booked', 'confirmed'))
     and exists (select 1 from public.appointment_participants q where q.appointment_id = p.appointment_id and q.client_id <> p_id);
  get diagnostics v_left = row_count;
  return v_texts + v_cancelled + v_left;
end;
$$;

