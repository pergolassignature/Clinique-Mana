-- =============================================================================
-- Module Demandes: the RPCs of D1 (create, edit, state, assign, contact attempts, tasks, note,
-- participants)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §10 (D1)
-- Decisions: D-1 … (decisions log)
--
-- Every RPC is SECURITY DEFINER, checks its permission first, scopes to the caller's clinic, locks
-- the request's row before reading what it changes, names itself in the journal
-- (`app.audit_source = 'rpc:<name>'`) and writes a `demande_events` row (codes only) for what the
-- KPIs read. User-facing refusals are French P0001; malformed input (an unknown key, a wrong type)
-- is 22023, for developers.
--
-- The intake is a JSON object of known keys (`private.demandes_intake_keys`): the same keys
-- create and edit, so the « saisie rapide » (a name and a phone) and the full intake are one RPC.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:demandes_rpcs', true);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The intake keys an RPC accepts (create adds received_at, channel and the source; edit does not
-- change where a request came from).
create function private.demandes_intake_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['client_id', 'contact_name', 'contact_email', 'contact_phone_e164', 'beneficiary', 'previous_therapy',
               'language', 'modality', 'availability_periods', 'availability_days', 'preferred_pro_gender',
               'profession_title_id', 'clientele_id', 'concerns', 'payer_kind', 'insurer', 'is_urgent', 'motif_ids']
$$;
revoke all on function private.demandes_intake_keys() from public, anon, authenticated, service_role;

-- The moves between states (D-2). Closing needs a reason; a closed request may be reopened.
create function private.demande_state_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
           when 'new'        then p_to in ('evaluating', 'accepted', 'waitlist', 'closed')
           when 'evaluating' then p_to in ('new', 'accepted', 'waitlist', 'closed')
           when 'accepted'   then p_to in ('evaluating', 'proposed', 'matched', 'waitlist', 'closed')
           when 'proposed'   then p_to in ('accepted', 'matched', 'waitlist', 'closed')
           when 'matched'    then p_to in ('accepted', 'closed')
           when 'waitlist'   then p_to in ('accepted', 'proposed', 'matched', 'closed')
           when 'closed'     then p_to in ('new', 'evaluating')
           else false
         end
$$;
revoke all on function private.demande_state_allowed(text, text) from public, anon, authenticated, service_role;

-- A text value of the intake: trimmed, empty → null.
create function private.demandes_text(p_data jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(p_data->>p_key), '')
$$;
revoke all on function private.demandes_text(jsonb, text) from public, anon, authenticated, service_role;

-- Checks an intake object: an object, known keys only, the right JSON types. The table's checks
-- do the rest (values, lengths).
create function private.demandes_check_intake(p_data jsonb, p_extra text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_type text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'The intake must be an object' using errcode = '22023';
  end if;
  for v_key, v_type in select k, jsonb_typeof(v) from jsonb_each(p_data) as e(k, v) loop
    if not (v_key = any (private.demandes_intake_keys() || p_extra)) then
      raise exception 'Unknown intake key: %', v_key using errcode = '22023';
    end if;
    if v_type <> 'null' and (
         (v_key in ('availability_periods', 'availability_days', 'motif_ids') and v_type <> 'array')
      or (v_key in ('previous_therapy', 'is_urgent') and v_type <> 'boolean')
      or (v_key = 'source_utm' and v_type <> 'object')
      or (v_key not in ('availability_periods', 'availability_days', 'motif_ids', 'previous_therapy', 'is_urgent', 'source_utm')
          and v_type <> 'string')) then
      raise exception 'Wrong type for intake key %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_data ? 'motif_ids' and jsonb_array_length(coalesce(p_data->'motif_ids', '[]')) > 50 then
    raise exception 'At most 50 motifs' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.demandes_check_intake(jsonb, text[]) from public, anon, authenticated, service_role;

-- Replaces a request's motifs with p_ids (catalogue rows of the same clinic: the FK).
create function private.demandes_set_motifs(p_org uuid, p_demande uuid, p_ids jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.demande_motifs m
   where m.demande_id = p_demande
     and not (m.motif_id::text in (select jsonb_array_elements_text(coalesce(p_ids, '[]'))));
  insert into public.demande_motifs (demande_id, motif_id, org_id)
  select p_demande, x::uuid, p_org from jsonb_array_elements_text(coalesce(p_ids, '[]')) x
  on conflict do nothing;
end;
$$;
revoke all on function private.demandes_set_motifs(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- A staff member of p_org who may work the requests (an assignee, a task's owner).
create function private.demandes_assert_worker(p_org uuid, p_user uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_user is not null and (
       not exists (select 1 from public.profiles p where p.user_id = p_user and p.org_id = p_org and p.status = 'active')
       or not ('demandes.manage' = any (private.permission_keys_for(p_user)))) then
    raise exception 'Cette personne ne peut pas traiter les demandes.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.demandes_assert_worker(uuid, uuid) from public, anon, authenticated, service_role;

-- The request p_id of the caller's clinic, locked; P0001 when there is none.
create function private.demandes_lock(p_id uuid)
returns public.demandes
language plpgsql
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  select * into v_row from public.demandes d
   where d.id = p_id and d.org_id = private.current_user_org_id()
   for no key update;
  if v_row.id is null then
    raise exception 'Cette demande n''existe pas.' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;
revoke all on function private.demandes_lock(uuid) from public, anon, authenticated, service_role;

create function private.demandes_require(p_permission text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.has_permission(p_permission) then
    raise exception 'Permission refusée : %', p_permission using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.demandes_require(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- create_demande: a new request (the full intake or the « saisie rapide »)
-- -----------------------------------------------------------------------------
-- p_data: the intake keys, plus `received_at` (default now), `channel` (default phone), the
-- source (`referral_source_id`, `source_campaign`, `source_utm`, `source_referrer`),
-- `assigned_to` (default none: the shared inbox) and `internal_note` (needs demandes.notes).
-- Returns the request's id; its reference is given by the table.
create function public.create_demande(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
  v_note text;
  v_assignee uuid;
  v_utm jsonb;
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_check_intake(p_data, array['received_at', 'channel', 'referral_source_id', 'source_campaign',
    'source_utm', 'source_referrer', 'assigned_to', 'internal_note']);
  v_note := private.demandes_text(p_data, 'internal_note');
  if v_note is not null then
    perform private.demandes_require('demandes.notes');
  end if;
  v_assignee := private.demandes_text(p_data, 'assigned_to')::uuid;
  perform private.demandes_assert_worker(v_org, v_assignee);
  -- utm_* keys only, string values.
  v_utm := coalesce((select jsonb_object_agg(k, pg_catalog.left(v #>> '{}', 200))
                       from jsonb_each(coalesce(p_data->'source_utm', '{}')) as e(k, v)
                      where k ~ '^utm_[a-z]{1,20}$' and jsonb_typeof(v) = 'string'), '{}');

  perform pg_catalog.set_config('app.audit_source', 'rpc:create_demande', true);
  insert into public.demandes (
    org_id, received_at, received_by, channel, referral_source_id, source_campaign, source_utm, source_referrer,
    client_id, contact_name, contact_email, contact_phone_e164, beneficiary, previous_therapy, language, modality,
    availability_periods, availability_days, preferred_pro_gender, profession_title_id, clientele_id, concerns,
    payer_kind, insurer, is_urgent, assigned_to, assigned_at, created_by)
  values (
    v_org,
    coalesce(private.demandes_text(p_data, 'received_at')::timestamptz, pg_catalog.now()),
    auth.uid(),
    coalesce(private.demandes_text(p_data, 'channel'), 'phone'),
    private.demandes_text(p_data, 'referral_source_id')::uuid,
    coalesce(private.demandes_text(p_data, 'source_campaign'), nullif(v_utm->>'utm_campaign', '')),
    v_utm,
    pg_catalog.left(private.demandes_text(p_data, 'source_referrer'), 500),
    private.demandes_text(p_data, 'client_id')::uuid,
    private.demandes_text(p_data, 'contact_name'),
    pg_catalog.lower(private.demandes_text(p_data, 'contact_email')),
    private.demandes_text(p_data, 'contact_phone_e164'),
    private.demandes_text(p_data, 'beneficiary'),
    (p_data->>'previous_therapy')::boolean,
    coalesce(private.demandes_text(p_data, 'language'), 'fr'),
    coalesce(private.demandes_text(p_data, 'modality'), 'any'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'availability_periods') x), '{}'),
    coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p_data->'availability_days') x), '{}'),
    coalesce(private.demandes_text(p_data, 'preferred_pro_gender'), 'any'),
    private.demandes_text(p_data, 'profession_title_id')::uuid,
    private.demandes_text(p_data, 'clientele_id')::uuid,
    private.demandes_text(p_data, 'concerns'),
    coalesce(private.demandes_text(p_data, 'payer_kind'), 'unknown'),
    private.demandes_text(p_data, 'insurer'),
    coalesce((p_data->>'is_urgent')::boolean, false),
    v_assignee,
    case when v_assignee is not null then pg_catalog.now() end,
    auth.uid())
  returning id into v_id;

  if p_data ? 'motif_ids' then
    perform private.demandes_set_motifs(v_org, v_id, p_data->'motif_ids');
  end if;
  if v_note is not null then
    insert into public.demande_notes (demande_id, org_id, internal_note, updated_by) values (v_id, v_org, v_note, auth.uid());
  end if;
  insert into public.demande_events (demande_id, org_id, kind, to_state, assignee, by_user)
  values (v_id, v_org, 'created', 'new', v_assignee, auth.uid());
  return v_id;
end;
$$;
revoke all on function public.create_demande(jsonb) from public, anon, authenticated;
grant execute on function public.create_demande(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- update_demande: the intake changed (only the keys given)
-- -----------------------------------------------------------------------------
create function public.update_demande(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_urgent boolean;
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_check_intake(p_patch, array[]::text[]);
  v_row := private.demandes_lock(p_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour la modifier.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:update_demande', true);
  update public.demandes d set
    client_id = case when p_patch ? 'client_id' then private.demandes_text(p_patch, 'client_id')::uuid else d.client_id end,
    contact_name = case when p_patch ? 'contact_name' then private.demandes_text(p_patch, 'contact_name') else d.contact_name end,
    contact_email = case when p_patch ? 'contact_email' then pg_catalog.lower(private.demandes_text(p_patch, 'contact_email')) else d.contact_email end,
    contact_phone_e164 = case when p_patch ? 'contact_phone_e164' then private.demandes_text(p_patch, 'contact_phone_e164') else d.contact_phone_e164 end,
    beneficiary = case when p_patch ? 'beneficiary' then private.demandes_text(p_patch, 'beneficiary') else d.beneficiary end,
    previous_therapy = case when p_patch ? 'previous_therapy' then (p_patch->>'previous_therapy')::boolean else d.previous_therapy end,
    language = case when p_patch ? 'language' then coalesce(private.demandes_text(p_patch, 'language'), 'fr') else d.language end,
    modality = case when p_patch ? 'modality' then coalesce(private.demandes_text(p_patch, 'modality'), 'any') else d.modality end,
    availability_periods = case when p_patch ? 'availability_periods'
      then coalesce((select array_agg(x) from jsonb_array_elements_text(p_patch->'availability_periods') x), '{}') else d.availability_periods end,
    availability_days = case when p_patch ? 'availability_days'
      then coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p_patch->'availability_days') x), '{}') else d.availability_days end,
    preferred_pro_gender = case when p_patch ? 'preferred_pro_gender' then coalesce(private.demandes_text(p_patch, 'preferred_pro_gender'), 'any') else d.preferred_pro_gender end,
    profession_title_id = case when p_patch ? 'profession_title_id' then private.demandes_text(p_patch, 'profession_title_id')::uuid else d.profession_title_id end,
    clientele_id = case when p_patch ? 'clientele_id' then private.demandes_text(p_patch, 'clientele_id')::uuid else d.clientele_id end,
    concerns = case when p_patch ? 'concerns' then private.demandes_text(p_patch, 'concerns') else d.concerns end,
    payer_kind = case when p_patch ? 'payer_kind' then coalesce(private.demandes_text(p_patch, 'payer_kind'), 'unknown') else d.payer_kind end,
    insurer = case when p_patch ? 'insurer' then private.demandes_text(p_patch, 'insurer') else d.insurer end,
    is_urgent = case when p_patch ? 'is_urgent' then coalesce((p_patch->>'is_urgent')::boolean, false) else d.is_urgent end
   where d.id = v_row.id
  returning d.is_urgent into v_urgent;

  if p_patch ? 'motif_ids' then
    perform private.demandes_set_motifs(v_row.org_id, v_row.id, p_patch->'motif_ids');
  end if;
  if v_urgent is distinct from v_row.is_urgent then
    insert into public.demande_events (demande_id, org_id, kind, by_user)
    values (v_row.id, v_row.org_id, case when v_urgent then 'urgent_set' else 'urgent_cleared' end, auth.uid());
  end if;
end;
$$;
revoke all on function public.update_demande(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_demande(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- set_demande_state: a move between states (D-2)
-- -----------------------------------------------------------------------------
-- `closed` needs p_closed_reason; `matched` needs p_professional_id (an active professional of the
-- clinic): she is linked to the request's client (Clients' `clients_link_professional`, reason
-- `demande`) and reads the request (demandes.self). Leaving `matched` unlinks the request from her
-- (the client link stays: Clients' rule). Reopening clears the closing.
create function public.set_demande_state(p_id uuid, p_state text, p_closed_reason text default null, p_professional_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_id);
  if p_state is null or p_state = v_row.state or not private.demande_state_allowed(v_row.state, p_state) then
    raise exception 'Cette demande ne peut pas passer de « % » à « % ».',
      private.demande_state_label(v_row.state), coalesce(private.demande_state_label(p_state), p_state)
      using errcode = 'P0001';
  end if;
  if p_state = 'closed' and p_closed_reason is null then
    raise exception 'Indiquez pourquoi la demande est fermée.' using errcode = 'P0001';
  end if;
  if p_state <> 'closed' and p_closed_reason is not null then
    raise exception 'A closing reason is only for a closed request' using errcode = '22023';
  end if;
  if p_state = 'matched' then
    if p_professional_id is null or not exists (
         select 1 from public.professionals p
          where p.id = p_professional_id and p.org_id = v_row.org_id and p.status = 'active') then
      raise exception 'Choisissez un professionnel actif de la clinique.' using errcode = 'P0001';
    end if;
  elsif p_professional_id is not null then
    raise exception 'A professional is only for a matched request' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_state', true);
  update public.demandes d set
    state = p_state,
    closed_reason = case when p_state = 'closed' then p_closed_reason end,
    closed_at = case when p_state = 'closed' then pg_catalog.now() end,
    matched_professional_id = case when p_state = 'matched' then p_professional_id end,
    matched_at = case when p_state = 'matched' then pg_catalog.now() end,
    next_contact_at = case when p_state = 'closed' then null else d.next_contact_at end
   where d.id = v_row.id;
  if p_state = 'matched' and v_row.client_id is not null then
    perform private.clients_link_professional(v_row.org_id, v_row.client_id, p_professional_id, 'demande');
  end if;
  insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, closed_reason, professional_id, by_user)
  values (v_row.id, v_row.org_id, 'state_changed', v_row.state, p_state, p_closed_reason,
          case when p_state = 'matched' then p_professional_id end, auth.uid());
end;
$$;
revoke all on function public.set_demande_state(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_demande_state(uuid, text, text, uuid) to authenticated;

-- The French name of a state, for the refusals above (the app has its own labels).
create function private.demande_state_label(p_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_state
           when 'new' then 'Nouvelle' when 'evaluating' then 'En évaluation' when 'accepted' then 'Acceptée'
           when 'proposed' then 'Proposée' when 'matched' then 'Jumelée' when 'waitlist' then 'Liste d''attente'
           when 'closed' then 'Fermée'
         end
$$;
revoke all on function private.demande_state_label(text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- assign_demande: the counselor in charge (null: back to the shared inbox)
-- -----------------------------------------------------------------------------
create function public.assign_demande(p_id uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_id);
  perform private.demandes_assert_worker(v_row.org_id, p_assignee);
  if p_assignee is not distinct from v_row.assigned_to then
    return;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:assign_demande', true);
  update public.demandes d set assigned_to = p_assignee, assigned_at = case when p_assignee is not null then pg_catalog.now() end
   where d.id = v_row.id;
  insert into public.demande_events (demande_id, org_id, kind, assignee, by_user)
  values (v_row.id, v_row.org_id, 'assigned', p_assignee, auth.uid());
end;
$$;
revoke all on function public.assign_demande(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_demande(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- log_demande_contact: a contact attempt (« sans réponse » and the next try)
-- -----------------------------------------------------------------------------
-- p_next_contact_at: when to try again (null: no callback planned). Returns the attempts so far.
create function public.log_demande_contact(p_id uuid, p_channel text, p_outcome text, p_next_contact_at timestamptz default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_attempts int;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour noter un appel.' using errcode = 'P0001';
  end if;
  if p_next_contact_at is not null and p_next_contact_at < pg_catalog.now() - interval '5 minutes' then
    raise exception 'La prochaine tentative doit être dans le futur.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:log_demande_contact', true);
  insert into public.demande_events (demande_id, org_id, kind, contact_channel, contact_outcome, by_user)
  values (v_row.id, v_row.org_id, 'contact', p_channel, p_outcome, auth.uid());
  update public.demandes d set
    contact_attempts = d.contact_attempts + 1,
    last_contact_at = pg_catalog.now(),
    next_contact_at = p_next_contact_at
   where d.id = v_row.id
  returning d.contact_attempts into v_attempts;
  return v_attempts;
end;
$$;
revoke all on function public.log_demande_contact(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.log_demande_contact(uuid, text, text, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Tasks: add, complete, cancel
-- -----------------------------------------------------------------------------
create function public.add_demande_task(p_demande_id uuid, p_kind text, p_due_at timestamptz, p_assigned_to uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_id uuid;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_demande_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour y ajouter une tâche.' using errcode = 'P0001';
  end if;
  if p_due_at is null then
    raise exception 'Indiquez quand la tâche est à faire.' using errcode = 'P0001';
  end if;
  perform private.demandes_assert_worker(v_row.org_id, p_assigned_to);
  perform pg_catalog.set_config('app.audit_source', 'rpc:add_demande_task', true);
  insert into public.demande_tasks (demande_id, org_id, kind, due_at, assigned_to, created_by)
  values (v_row.id, v_row.org_id, p_kind, p_due_at, p_assigned_to, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_demande_task(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.add_demande_task(uuid, text, timestamptz, uuid) to authenticated;

-- Done with an outcome (`not_needed` when nothing was done). A call's outcome is also a contact
-- attempt of the request (log_demande_contact's counters).
create function public.complete_demande_task(p_demande_id uuid, p_task_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_kind text;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_demande_id);
  select t.kind into v_kind from public.demande_tasks t
   where t.demande_id = v_row.id and t.id = p_task_id and t.state = 'open' for update;
  if v_kind is null then
    raise exception 'Cette tâche n''est plus ouverte.' using errcode = 'P0001';
  end if;
  if p_outcome is null then
    raise exception 'Indiquez le résultat de la tâche.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:complete_demande_task', true);
  update public.demande_tasks t set state = 'done', outcome = p_outcome, done_at = pg_catalog.now(), done_by = auth.uid()
   where t.demande_id = v_row.id and t.id = p_task_id;
  insert into public.demande_events (demande_id, org_id, kind, contact_channel, contact_outcome, by_user)
  values (v_row.id, v_row.org_id, 'task_done',
          case when p_outcome <> 'not_needed' and v_kind in ('discovery_call', 'callback') then 'phone' end,
          case when p_outcome <> 'not_needed' then p_outcome end, auth.uid());
  if p_outcome <> 'not_needed' and v_kind in ('discovery_call', 'callback') then
    update public.demandes d set contact_attempts = d.contact_attempts + 1, last_contact_at = pg_catalog.now()
     where d.id = v_row.id;
  end if;
end;
$$;
revoke all on function public.complete_demande_task(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_demande_task(uuid, uuid, text) to authenticated;

create function public.cancel_demande_task(p_demande_id uuid, p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  v_row := private.demandes_lock(p_demande_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:cancel_demande_task', true);
  update public.demande_tasks t set state = 'cancelled', done_at = pg_catalog.now(), done_by = auth.uid()
   where t.demande_id = v_row.id and t.id = p_task_id and t.state = 'open';
  if not found then
    raise exception 'Cette tâche n''est plus ouverte.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.cancel_demande_task(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_demande_task(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- set_demande_note: the internal note (demandes.notes; empty removes it)
-- -----------------------------------------------------------------------------
create function public.set_demande_note(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_note text := nullif(pg_catalog.btrim(p_note), '');
begin
  perform private.demandes_require('demandes.notes');
  v_row := private.demandes_lock(p_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_note', true);
  if v_note is null then
    delete from public.demande_notes n where n.demande_id = v_row.id;
  else
    insert into public.demande_notes as n (demande_id, org_id, internal_note, updated_by)
    values (v_row.id, v_row.org_id, v_note, auth.uid())
    on conflict (demande_id) do update set internal_note = excluded.internal_note, updated_by = excluded.updated_by
      where n.internal_note is distinct from excluded.internal_note;
  end if;
end;
$$;
revoke all on function public.set_demande_note(uuid, text) from public, anon, authenticated;
grant execute on function public.set_demande_note(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- set_demande_participants: who the request is for, as a set (at most 10, one main person)
-- -----------------------------------------------------------------------------
-- Each element: { id?, client_id?, display_name?, relationship, birthday?, is_primary }. A row with
-- an id is updated, without one added; a row missing from the set is removed.
create function public.set_demande_participants(p_id uuid, p_participants jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
begin
  perform private.demandes_require('demandes.manage');
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) > 10 then
    raise exception 'Participants must be an array of at most 10' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_participants) e where coalesce((e->>'is_primary')::boolean, false)) > 1 then
    raise exception 'Une seule personne est la personne principale.' using errcode = 'P0001';
  end if;
  v_row := private.demandes_lock(p_id);
  perform pg_catalog.set_config('app.audit_source', 'rpc:set_demande_participants', true);

  create temp table if not exists tmp_demande_participants (
    id uuid, client_id uuid, display_name text, relationship text, birthday date, is_primary boolean
  ) on commit drop;
  truncate tmp_demande_participants;
  insert into tmp_demande_participants
  -- An id that is not one of this request's participants is a new row.
  select case when x.id in (select p.id from public.demande_participants p where p.demande_id = v_row.id) then x.id
              else gen_random_uuid() end,
         x.client_id, nullif(pg_catalog.btrim(x.display_name), ''),
         coalesce(x.relationship, 'self'), x.birthday, coalesce(x.is_primary, false)
    from jsonb_to_recordset(p_participants) as x(id uuid, client_id uuid, display_name text, relationship text,
                                                   birthday date, is_primary boolean);

  delete from public.demande_participants p
   where p.demande_id = v_row.id and p.id not in (select t.id from tmp_demande_participants t);
  -- The main person first loses the flag, so the one-primary index never sees two.
  update public.demande_participants p set is_primary = false
   where p.demande_id = v_row.id and p.is_primary
     and p.id in (select t.id from tmp_demande_participants t where not t.is_primary);
  insert into public.demande_participants as p (id, demande_id, org_id, client_id, display_name, relationship, birthday, is_primary)
  select t.id, v_row.id, v_row.org_id, t.client_id, t.display_name, t.relationship, t.birthday, t.is_primary
    from tmp_demande_participants t
  on conflict (demande_id, id) do update set
    client_id = excluded.client_id, display_name = excluded.display_name, relationship = excluded.relationship,
    birthday = excluded.birthday, is_primary = excluded.is_primary;
end;
$$;
revoke all on function public.set_demande_participants(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_demande_participants(uuid, jsonb) to authenticated;
