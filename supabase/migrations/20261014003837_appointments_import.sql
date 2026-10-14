-- =============================================================================
-- Rendez-vous: the GOrendezvous import of appointments (I2, prepared before support's export)
-- =============================================================================
-- Asked:   coordinator, 2026-10-13 (lane A: « prepare the I2 import code against a synthetic
--          export shape … so that only the column mapping remains »); plan §9 I2; decision I-15.
-- Needs:   *_appointments_module.sql, *_appointments_video.sql, *_appointments_publications.sql,
--          *_appointments_billing_facts.sql, *_appointments_fee_facts.sql, Clients'
--          private.clients_import_match and private.clients_link_professional, Services'
--          private.service_id_by_code and service_booking_facts, Professionnels' booking facts.
--
-- `import_appointment(row, dry_run)` (appointments.manage, clients.manage and clients.merge; the terminal script
-- signs in as the person running it, as I1 and I3): one GOrendezvous appointment, all or nothing.
-- * `external_ref` « gorendezvous:… » (already imported → `skipped`: a run resumes); the
--   professional (the tool's employees file); the service by its 5-digit code; one or two clients
--   by `client_ref` (« gorendezvous:<ClientId> ») or name (Clients' `clients_import_match`: not
--   found or several → `unmatched`, never an error), each linked to the professional
--   (`client_professional_links`, reason `import`: the backfill « Mes clients » reads).
-- * History (already started): `completed` (each client `present` or `absent`) or `cancelled`
--   (a reason by key or name, else « Non spécifiée »), its slot without the « pause après » (two
--   GOrendezvous sessions back to back are not a conflict). Coming: `booked` or `confirmed`,
--   with its pause, its existing video link kept (`video_status` ready), never a new Zoom meeting
--   nor a « Votre lien » email while that link stands; reminders as any appointment, never a
--   confirmation (the messages' trigger, replaced below, skips an import's insert only: a move,
--   a cancellation or a restore made here afterwards is told as for any appointment).
-- * Two appointments of a professional overlapping: `conflict` (the tool lists them; « no
--   future overlap left » is I2's acceptance), never an error that stops the run.
-- * An imported appointment that had already started when imported is history for Facturation
--   (already invoiced in GOrendezvous, I3): never in the morning queue, a fee candidate or the
--   file's « à facturer » (the three published functions below exclude it); one imported before it
--   started is an ordinary appointment once it happens.
-- * Never imported: GOrendezvous's notes (clinical content stays out, D8).
-- Returns {status: ok | skipped | unmatched | conflict | error, dry_run, id, reason, notes, errors}.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_import', true);

create function public.import_appointment(p_row jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_dry boolean := coalesce(p_dry_run, true);
  v_ref text;
  v_pro uuid;
  v_code int;
  v_service uuid;
  v_facts record;
  v_starts timestamptz;
  v_ends timestamptz;
  v_blocks timestamptz;
  v_state text;
  v_mode text;
  v_past boolean;
  v_reason uuid;
  v_reason_text text;
  v_cancelled timestamptz;
  v_url text;
  v_clients jsonb;
  v_client jsonb;
  v_match record;
  v_ids uuid[] := '{}';
  v_absent boolean[] := '{}';
  v_cid uuid;
  v_id uuid;
  v_notes jsonb := '[]';
  v_errors jsonb := '[]';
  v_status text := 'ok';
  v_message text;
  v_hint text;
  v_i int := 0;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if not private.has_permission('appointments.manage') then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  perform private.clients_import_assert();  -- clients.manage and clients.merge: whoever imports, as I1
  if p_row is null or pg_catalog.jsonb_typeof(p_row) <> 'object'
     or pg_catalog.jsonb_typeof(coalesce(p_row -> 'clients', '[]')) <> 'array' then
    raise exception 'Une ligne d''import est un objet JSON (clients : une liste).' using errcode = '22023';
  end if;
  v_ref := pg_catalog.btrim(coalesce(p_row ->> 'external_ref', ''));
  if v_ref !~ '^gorendezvous:[A-Za-z0-9:_-]{1,60}$' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'external_ref',
        'message', 'La référence GOrendezvous du rendez-vous est requise.')));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appointments.import:' || v_org::text || ':' || v_ref, 0));
  select a.id into v_id from public.appointments a where a.org_id = v_org and a.external_ref = v_ref;
  if v_id is not null then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'dry_run', v_dry, 'id', v_id, 'reason', 'Déjà importé');
  end if;

  -- The clients first: one not found or with homonyms is listed, never an error.
  v_clients := coalesce(p_row -> 'clients', '[]');
  if pg_catalog.jsonb_array_length(v_clients) not between 1 and 2 then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
      'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'clients',
        'message', 'Un rendez-vous compte un ou deux clients.')));
  end if;
  for v_client in select x.value from pg_catalog.jsonb_array_elements(v_clients) x loop
    v_i := v_i + 1;
    select m.* into v_match from private.clients_import_match(v_org, v_client ->> 'client_ref', v_client ->> 'client_name') m;
    if v_match.status <> 'ok' then
      return pg_catalog.jsonb_build_object('status', 'unmatched', 'dry_run', v_dry, 'id', null, 'client', v_i,
                                           'reason', case v_match.status when 'ambiguous' then 'client_ambiguous' else 'client_not_found' end);
    end if;
    if v_match.client_id = any (v_ids) then
      return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null,
        'errors', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', 'clients',
          'message', 'Le même client est nommé deux fois.')));
    end if;
    v_ids := v_ids || v_match.client_id;
    -- Absent: per client (`clients[].absent`), else the row's (`absent`); « true » only.
    v_absent := v_absent || (pg_catalog.lower(coalesce(v_client ->> 'absent', p_row ->> 'absent', '')) in ('true', 't', '1'));
  end loop;

  perform pg_catalog.set_config('app.audit_source', 'import', true);
  begin
    begin
      v_pro := nullif(p_row ->> 'professional_id', '')::uuid;
      v_code := nullif(p_row ->> 'service_code', '')::int;
      v_starts := (p_row ->> 'starts_at')::timestamptz;
      v_ends := nullif(p_row ->> 'ends_at', '')::timestamptz;
      v_cancelled := nullif(p_row ->> 'cancelled_at', '')::timestamptz;
    exception when others then
      raise exception 'Un professionnel, un code, une date ou une heure est illisible.' using errcode = 'P0001', hint = 'starts_at';
    end;
    if v_pro is null or not exists (select 1 from private.professional_booking_facts(v_org, v_pro) f where f.status is not null) then
      raise exception 'Le professionnel du rendez-vous est introuvable.' using errcode = 'P0001', hint = 'professional_id';
    end if;
    v_service := private.service_id_by_code(v_org, v_code);
    if v_service is null then
      raise exception 'Le code de service est inconnu du catalogue.' using errcode = 'P0001', hint = 'service_code';
    end if;
    select f.* into v_facts from private.service_booking_facts(v_org, v_service) f;
    if v_starts is null then
      raise exception 'La date et l''heure du rendez-vous sont requises.' using errcode = 'P0001', hint = 'starts_at';
    end if;
    v_ends := coalesce(v_ends, v_starts + pg_catalog.make_interval(mins => greatest(coalesce(v_facts.duration_minutes, 0), 5)));
    if v_ends <= v_starts or v_ends - v_starts > interval '12 hours' then
      raise exception 'La fin du rendez-vous vient après son début, le même jour.' using errcode = 'P0001', hint = 'ends_at';
    end if;
    v_past := v_starts <= pg_catalog.now();
    v_state := coalesce(nullif(p_row ->> 'state', ''), case when v_past then 'completed' else 'booked' end);
    if (v_past and v_state not in ('completed', 'cancelled')) or (not v_past and v_state not in ('booked', 'confirmed', 'cancelled')) then
      raise exception 'L''état ne convient pas : un rendez-vous passé est terminé ou annulé, un rendez-vous à venir réservé, confirmé ou annulé.'
        using errcode = 'P0001', hint = 'state';
    end if;
    v_mode := coalesce(nullif(p_row ->> 'mode', ''), 'video');
    if v_mode not in ('video', 'phone') then
      raise exception 'Le mode est vidéo ou téléphone.' using errcode = 'P0001', hint = 'mode';
    end if;
    v_blocks := case when v_past then v_ends else v_ends + pg_catalog.make_interval(mins => coalesce(v_facts.buffer_after_minutes, 0)) end;
    if v_blocks - v_starts > interval '12 hours' then
      v_blocks := v_ends;
    end if;
    if v_state = 'cancelled' then
      v_reason_text := nullif(pg_catalog.btrim(coalesce(p_row ->> 'cancel_reason', '')), '');
      select r.id into v_reason from public.cancellation_reasons r
       where r.org_id = v_org and v_reason_text is not null
         and (r.key = v_reason_text or private.clients_fold(r.name) = private.clients_fold(v_reason_text))
       order by r.key = v_reason_text desc limit 1;
      if v_reason is null then
        select r.id into v_reason from public.cancellation_reasons r where r.org_id = v_org and r.key = 'not_specified';
        if v_reason_text is not null then
          v_notes := v_notes || pg_catalog.jsonb_build_array('reason_unknown');
        end if;
      end if;
      v_cancelled := coalesce(v_cancelled, least(v_starts, pg_catalog.now()));
    end if;
    v_url := nullif(pg_catalog.btrim(coalesce(p_row ->> 'video_url', '')), '');
    if v_url is not null and (v_past or v_mode <> 'video' or v_state = 'cancelled') then
      v_url := null;
    end if;
    if v_url is not null and (v_url !~ '^https://\S+$' or char_length(v_url) > 500) then
      v_url := null;
      v_notes := v_notes || pg_catalog.jsonb_build_array('video_url_invalid');
    end if;

    begin
      insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode, state,
                                       confirmed_at, completed_at, cancelled_at, cancel_reason_id, cancel_late,
                                       video_url, video_status, external_ref, created_by)
      values (v_org, v_pro, v_service, v_starts, v_ends, v_blocks, v_mode, v_state,
              case when v_state = 'confirmed' then pg_catalog.now() end,
              case when v_state = 'completed' then v_ends end,
              case when v_state = 'cancelled' then v_cancelled end,
              v_reason, null,
              v_url, case when v_url is not null then 'ready' end, v_ref, auth.uid())
      returning id into v_id;
    exception when exclusion_violation then
      v_status := 'conflict';
    end;
    if v_status = 'ok' then
      v_i := 0;
      foreach v_cid in array v_ids loop
        v_i := v_i + 1;
        insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence)
        values (v_id, v_cid, v_org, case when v_i = 1 then 'client' else 'second' end,
                case when v_state = 'completed' then case when v_absent[v_i] then 'absent' else 'present' end else 'expected' end);
        perform private.clients_link_professional(v_org, v_cid, v_pro, 'import');
      end loop;
    end if;

    if v_dry then
      raise exception 'import_appointment: rollback' using errcode = 'IMPRB';
    end if;
  exception
    when sqlstate 'IMPRB' then
      null;  -- a dry run: everything above is rolled back
    when check_violation then
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', null,
        'message', 'Une valeur de la ligne ne respecte pas les règles de son champ (longueur, caractères).'));
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text, v_hint = pg_exception_hint;
      v_errors := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('field', nullif(v_hint, ''), 'message', v_message));
  end;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);

  if v_errors <> '[]' then
    return pg_catalog.jsonb_build_object('status', 'error', 'dry_run', v_dry, 'id', null, 'errors', v_errors);
  end if;
  if v_status = 'conflict' then
    return pg_catalog.jsonb_build_object('status', 'conflict', 'dry_run', v_dry, 'id', null, 'future', not v_past,
                                         'reason', 'Ce professionnel a déjà un rendez-vous sur ce créneau.');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'dry_run', v_dry, 'id', case when not v_dry then v_id end,
                                       'future', not v_past, 'notes', v_notes);
end;
$$;
revoke all on function public.import_appointment(jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.import_appointment(jsonb, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Video: an imported link stands (no Zoom meeting made over it)
-- -----------------------------------------------------------------------------
-- *_appointments_video.sql's, but an imported appointment with its own link and no meeting of ours
-- queues no task: GOrendezvous's link stays the client's (a « Régénérer » or clearing it by hand
-- brings the usual meeting back).
create or replace function private.appointments_video_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'completed' then
    return null;
  end if;
  if new.external_ref is not null and new.video_url is not null
     and not exists (select 1 from public.appointment_video_meetings m where m.appointment_id = new.id) then
    return null;
  end if;
  if private.appointment_video_target(new.org_id, new.professional_id, new.mode, new.state, new.is_personal, new.starts_at) is not null
     or exists (select 1 from public.appointment_video_meetings m where m.appointment_id = new.id) then
    perform private.appointment_video_request(new.org_id, new.id);
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Facturation's publications: an imported appointment that had already started is history
-- -----------------------------------------------------------------------------
-- *_appointments_publications.sql's (the morning queue, FPay).
create or replace function private.appointments_for_billing(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, starts_at timestamptz, ends_at timestamptz, state text, professional_id uuid, service_id uuid,
  mode text, client_id uuid, role text, presence text, cancel_late boolean, cancelled_at timestamptz, series_id uuid
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.starts_at, a.ends_at, a.state, a.professional_id, a.service_id, a.mode,
         p.client_id, p.role, p.presence, a.cancel_late, a.cancelled_at, a.series_id
    from public.appointments a
    join public.appointment_participants p on p.appointment_id = a.id
   where a.org_id = p_org and not a.is_personal
     and a.starts_at >= p_from and a.starts_at < p_to
     and (a.state = 'completed' or (a.state = 'cancelled' and a.cancel_late))
     and (a.external_ref is null or a.starts_at >= a.created_at)
   order by a.starts_at, a.id, p.role
$$;

-- *_appointments_billing_facts.sql's (the file's « à facturer »).
create or replace function private.client_billable_appointments(p_org uuid, p_client_id uuid, p_since date)
returns table (
  appointment_id uuid, professional_id uuid, service_id uuid, starts_at timestamptz, local_date date, state text, client_ids uuid[]
)
language sql
stable
set search_path = ''
as $$
  select f.appointment_id, f.professional_id, f.service_id, f.starts_at, f.local_date, f.state, f.client_ids
    from private.appointment_billing_facts(
           p_org,
           (select coalesce(pg_catalog.array_agg(p.appointment_id), '{}')
              from public.appointment_participants p
              join public.appointments a on a.id = p.appointment_id
             where p.org_id = p_org and p.client_id = p_client_id
               and a.state in ('booked', 'confirmed', 'completed') and not a.is_personal
               and (a.external_ref is null or a.starts_at >= a.created_at)
               and (p_since is null or a.starts_at >= (p_since::timestamp at time zone private.appointments_tz(p_org))))) f
   order by f.starts_at desc
   limit 200
$$;

-- *_appointments_fee_facts.sql's (the cancellation fees).
create or replace function private.appointments_fee_candidates(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, starts_at timestamptz, local_date date, professional_id uuid, service_id uuid,
  client_ids uuid[], kind text
)
language sql
stable
set search_path = ''
as $$
  select a.id, a.starts_at, (a.starts_at at time zone private.appointments_tz(a.org_id))::date, a.professional_id, a.service_id,
         (select pg_catalog.array_agg(p.client_id order by p.role = 'second', p.created_at)
            from public.appointment_participants p where p.appointment_id = a.id),
         case when a.state = 'cancelled' then 'late_cancellation' else 'no_show' end
    from public.appointments a
   where a.org_id = p_org and not a.is_personal
     and a.starts_at >= p_from and a.starts_at < p_to
     and (a.external_ref is null or a.starts_at >= a.created_at)
     and ((a.state = 'cancelled' and a.cancel_late)
          or (a.state in ('booked', 'confirmed') and a.ends_at <= pg_catalog.now()
              and exists (select 1 from public.appointment_participants p where p.appointment_id = a.id)
              and not exists (select 1 from public.appointment_participants p
                               where p.appointment_id = a.id and p.presence <> 'absent')))
   order by a.starts_at, a.id
$$;

-- -----------------------------------------------------------------------------
-- Messages: an import sends no confirmation; what the staff do afterwards is told
-- -----------------------------------------------------------------------------
-- *_appointments_parity.sql's, but `external_ref` silences only the insert: an imported
-- appointment moved, cancelled or restored here gets its « modifié » or « annulé » as any other.
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

select pg_catalog.set_config('app.audit_source', '', true);
