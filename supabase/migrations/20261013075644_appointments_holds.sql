-- =============================================================================
-- Rendez-vous: held appointments, the slots a proposal keeps for a client (plan R1b, AP-15)
-- =============================================================================
-- Demandes (D3b) proposes slots to a client; each proposed slot is an appointment in the state
-- `held` until the client accepts it, the proposal is withdrawn or it expires.
--   1. `appointments.state` gains `held`, with `held_until` (the expiry, set exactly while held)
--      and `hold_reference` (the proposal's id, kept once booked). A held appointment occupies
--      its slot through the same exclusion constraint (only `cancelled` frees one), so nobody
--      books over it and get_open_slots skips it; it never counts as booked: no reminder (R4),
--      no invoice (Facturation), no client link (« Mes clients ») before it is accepted.
--   2. Service-side helpers (security definer, granted to no role; the caller, Demandes' own
--      definer RPCs or its job, checks its permission and names its actor):
--        appointments_hold(org, professional, service, starts_at, client_ids, expires_at, actor,
--                          reference, mode) → id
--          every booking rule of book_appointment, in the availability only (no « Hors
--          disponibilités », no balance exception), an expiry after now and no later than the start;
--        appointments_confirm_hold(org, id, actor): held → booked, every rule checked again at
--          that moment (still active, still offered, still in the availability, the clients'
--          files and the balance rule, the slot free with today's duration and « pause après »);
--        appointments_release_hold(org, id, reason) → boolean: the hold is deleted (a proposal
--          never accepted is not an appointment), the reason in the audit's source; false when
--          it is no longer held (accepted, or already released).
--   3. The job `appointments.holds_release` (SQL, every 5 minutes) deletes the expired holds; a
--      new hold first clears its professional's expired ones, so a stale hold never blocks it.
--   4. The staff's RPCs refuse a held appointment (HINT `held`): move, cancel, presence; its
--      details (mode, notes) may still change. An anonymisation releases the client's holds.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_holds', true);

alter table public.appointments
  add column held_until timestamptz,
  add column hold_reference uuid,
  drop constraint appointments_state_check,
  add constraint appointments_state_check check (state in ('held', 'booked', 'confirmed', 'completed', 'cancelled')),
  add constraint appointments_held_check check ((state = 'held') = (held_until is not null)),
  add constraint appointments_held_personal_check check (not (is_personal and state = 'held'));
create index appointments_held_until_idx on public.appointments (held_until) where state = 'held';
create index appointments_org_hold_reference_idx on public.appointments (org_id, hold_reference) where hold_reference is not null;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The reasons a hold is released, as the audit's source names them.
create function private.appointments_hold_release_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('declined', 'withdrawn', 'other_accepted', 'expired', 'demande_closed', 'client_anonymized') then
    raise exception 'Unknown hold release reason' using errcode = '22023';
  end if;
  return p_reason;
end;
$$;

-- Deletes the expired holds (of one professional, or all); returns how many.
create function private.appointments_release_expired(p_org uuid, p_professional_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_count int;
begin
  perform pg_catalog.set_config('app.audit_source', 'job:appointments.holds_release:expired', true);
  delete from public.appointments a
   where a.state = 'held' and a.held_until <= pg_catalog.now()
     and (p_org is null or a.org_id = p_org)
     and (p_professional_id is null or a.professional_id = p_professional_id);
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_count;
end;
$$;

-- The actor of a service call: an active member of the clinic, or none (a client's own answer
-- through a secure link). Names her in the audit while the call runs (app.audit_actor is read
-- only when the session is not a user's, core_staff_invitations).
create function private.appointments_check_actor(p_org uuid, p_actor uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_org is null then
    raise exception 'p_org est requis' using errcode = '22023';
  end if;
  if p_actor is not null
     and not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org and p.status = 'active') then
    raise exception 'Unknown actor for this clinic' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.appointments_hold_release_reason(text), private.appointments_release_expired(uuid, uuid),
  private.appointments_check_actor(uuid, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Hold
-- -----------------------------------------------------------------------------
create function private.appointments_hold(
  p_org uuid,
  p_professional uuid,
  p_service uuid,
  p_starts_at timestamptz,
  p_client_ids uuid[],
  p_expires_at timestamptz,
  p_actor uuid,
  p_reference uuid default null,
  p_mode text default 'video'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_pro record;
  v_service record;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_id uuid;
  v_client uuid;
  v_ord int;
begin
  perform private.appointments_check_actor(p_org, p_actor);
  perform private.appointments_check_start(p_starts_at);
  if p_starts_at <= pg_catalog.now() then
    raise exception 'Ce créneau est déjà passé.' using errcode = 'P0001', hint = 'starts_at';
  end if;
  if p_expires_at is null or p_expires_at <= pg_catalog.now() or p_expires_at > p_starts_at then
    raise exception 'La proposition expire après maintenant et au plus tard au début du rendez-vous.' using errcode = 'P0001', hint = 'expires_at';
  end if;
  if coalesce(p_mode, 'video') not in ('video', 'phone') then
    raise exception 'Le rendez-vous se fait en vidéo ou par téléphone.' using errcode = 'P0001', hint = 'mode';
  end if;

  select * into v_pro from private.appointments_professional(p_org, p_professional);
  select * into v_service from private.appointments_service(p_org, p_service, v_pro.title_ids, true);
  v_ends := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
  -- In the availability only: a proposal never uses « Hors disponibilités ».
  perform private.appointments_outside_reason(
    private.appointments_in_availability(p_org, p_professional, p_service, p_starts_at, v_ends), null);
  -- The balance rule with no exception: a client who owes money is not offered a slot.
  perform private.appointments_check_clients(p_org, p_client_ids, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                             (p_starts_at at time zone private.appointments_tz(p_org))::date, true, null);

  perform private.appointments_release_expired(p_org, p_professional);
  if p_actor is not null then
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:appointments_hold', true);
  begin
    insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode, state,
                                     held_until, hold_reference, created_by)
    values (p_org, p_professional, p_service, p_starts_at, v_ends, v_blocks, coalesce(p_mode, 'video'), 'held',
            p_expires_at, p_reference, p_actor)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).' using errcode = 'P0001', hint = 'overlap';
  end;
  for v_client, v_ord in select x, o from pg_catalog.unnest(p_client_ids) with ordinality as u(x, o) loop
    insert into public.appointment_participants (appointment_id, client_id, org_id, role)
    values (v_id, v_client, p_org, case when v_ord = 1 then 'client' else 'second' end);
  end loop;
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Confirm: held → booked, every rule checked again
-- -----------------------------------------------------------------------------
create function private.appointments_confirm_hold(p_org uuid, p_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_appt public.appointments;
  v_pro record;
  v_service record;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_clients uuid[];
begin
  perform private.appointments_check_actor(p_org, p_actor);
  select a.* into v_appt from public.appointments a where a.org_id = p_org and a.id = p_id for update;
  if v_appt.id is null or v_appt.state <> 'held' then
    raise exception 'Ce créneau n''est plus réservé pour cette proposition.' using errcode = 'P0001', hint = 'hold_gone';
  end if;
  if v_appt.held_until <= pg_catalog.now() then
    raise exception 'La proposition a expiré : ce créneau n''est plus réservé.' using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_appt.starts_at <= pg_catalog.now() then
    raise exception 'Ce créneau est déjà passé.' using errcode = 'P0001', hint = 'starts_at';
  end if;

  select * into v_pro from private.appointments_professional(p_org, v_appt.professional_id);
  select * into v_service from private.appointments_service(p_org, v_appt.service_id, v_pro.title_ids, true);
  -- Today's duration and « pause après »: the service may have changed since the hold.
  v_ends := v_appt.starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_blocks := v_ends + pg_catalog.make_interval(mins => v_service.buffer_after_minutes);
  perform private.appointments_outside_reason(
    private.appointments_in_availability(p_org, v_appt.professional_id, v_appt.service_id, v_appt.starts_at, v_ends), null);
  select coalesce(array_agg(p.client_id order by p.role = 'second', p.created_at), '{}') into v_clients
    from public.appointment_participants p where p.appointment_id = p_id;
  perform private.appointments_check_clients(p_org, v_clients, v_service.for_two, v_pro.women_only, v_pro.min_client_age,
                                             (v_appt.starts_at at time zone private.appointments_tz(p_org))::date, true, null);

  if p_actor is not null then
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:appointments_confirm_hold', true);
  begin
    update public.appointments a
       set state = 'booked', held_until = null, ends_at = v_ends, blocks_until = v_blocks
     where a.id = p_id;
  exception when exclusion_violation then
    raise exception 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).' using errcode = 'P0001', hint = 'overlap';
  end;
  perform private.clients_link_professional(p_org, c, v_appt.professional_id, 'appointment') from pg_catalog.unnest(v_clients) c;
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Release
-- -----------------------------------------------------------------------------
create function private.appointments_release_hold(p_org uuid, p_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_reason text := private.appointments_hold_release_reason(p_reason);
  v_found boolean;
begin
  if p_org is null then
    raise exception 'p_org est requis' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:appointments_release_hold:' || v_reason, true);
  delete from public.appointments a where a.org_id = p_org and a.id = p_id and a.state = 'held';
  v_found := found;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  return v_found;
end;
$$;

revoke all on function
  private.appointments_hold(uuid, uuid, uuid, timestamptz, uuid[], timestamptz, uuid, uuid, text),
  private.appointments_confirm_hold(uuid, uuid, uuid),
  private.appointments_release_hold(uuid, uuid, text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. The job: expired holds free their slots
-- -----------------------------------------------------------------------------
create function private.job_appointments_holds_release()
returns text
language plpgsql
set search_path = ''
as $$
begin
  return 'released=' || private.appointments_release_expired(null, null);
end;
$$;
revoke all on function private.job_appointments_holds_release() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('appointments.holds_release', 'appointments', 'Créneaux proposés expirés',
   'Libère les créneaux proposés à un client qui n''ont pas été acceptés avant leur échéance.',
   'sql', 'private.job_appointments_holds_release', 'appointments.holds_release', true)
on conflict do nothing;

select cron.schedule('appointments.holds_release', '*/5 * * * *',
  $$select private.run_sql_job('appointments.holds_release')$$);

-- -----------------------------------------------------------------------------
-- 5. The staff's RPCs refuse a held appointment (move, cancel, presence)
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
         cancel_late = case when v_appt.is_personal or v_notice is null then null
                            else now() > v_appt.starts_at - pg_catalog.make_interval(hours => v_notice) end
   where a.id = p_id;
end;
$$;

create or replace function public.set_appointment_presence(p_appointment_id uuid, p_client_id uuid, p_presence text)
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
  if not private.appointments_can_act_on(v_appt) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.state = 'held' then
    raise exception 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.' using errcode = 'P0001', hint = 'held';
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

-- -----------------------------------------------------------------------------
-- 6. Anonymisation: the client's holds are released first
-- -----------------------------------------------------------------------------
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
     and exists (select 1 from public.appointment_participants p where p.appointment_id = q.appointment_id and p.client_id = p_id and p.role = 'client');
  delete from public.appointment_participants p
   where p.client_id = p_id
     and exists (select 1 from public.appointments a where a.id = p.appointment_id and a.starts_at > now() and a.state in ('booked', 'confirmed'))
     and exists (select 1 from public.appointment_participants q where q.appointment_id = p.appointment_id and q.client_id <> p_id);
  get diagnostics v_left = row_count;
  return v_released + v_texts + v_cancelled + v_left;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
