-- =============================================================================
-- Demandes: the parity gaps before the cutover (parity audit P6–P9, L19)
-- =============================================================================
-- Audit:     docs/plans/2026-10-13-parity-audit.md (P6 B-1, P7 B-2, P8 B-3, P9 B-4, L19 A-6)
-- Legacy:    docs/plans/2026-10-06-legacy-feature-inventory.md §C
-- Decisions: D-37 … D-41
--
-- * B-2 (D-40) The intake's missing questions, as legacy asked them (labels « déléguée —
--   révisable », Christine confirms the wording; no diagnostic field, D8):
--   - « Enjeux » has_issues yes/no → issues {coparenting, other} + issues_comment;
--   - « Consultations antérieures » (the existing previous_therapy yes/no) → previous_professionals
--     {psychologist, social_worker, psychoeducator, physician, other} + previous_comment;
--   - « Contexte légal » has_legal_context yes/no → legal_context {court_order, dpj} + legal_detail;
--   - the « autre » details: motif_other (a motif not in the list), availability_other.
--   « Non » (or no answer) clears the follow-ups: `private.demandes_clear_followups` before every
--   write, and a check keeps it true. The comments are redacted in the audit like `concerns`.
--   `create_demande` / `update_demande` accept the new keys (the intake's whitelist and types).
-- * B-1 (D-37) A proposal books the request's file and its participants' other files (the main
--   person first): all of them, at most two (an appointment counts two clients). A couple service
--   needs two files; more than two is refused in plain words. `private.demandes_booking_clients`.
-- * B-4 (D-39) `demande_consents(p_id)` (demandes.view): per file of the request (its own and the
--   participants'), the consents the situation requires and their state, read live from Clients'
--   `required_consents_for` and `client_consents_status` (pending past its due date → overdue).
--   Nothing is copied onto the request.
-- * A-6 (D-41) At the match (and when a file is added to a matched request), the files without a
--   primary professional get her, and so do those whose primary professional is the request's
--   previous match (a request matched again): `private.demandes_link_clients` now calls Clients'
--   `clients_fill_primary_professional`.
-- * B-3 (D-38) « Jumelée » by hand needs no change here: `set_demande_state(…, 'matched', …,
--   p_professional_id)` already exists (D-2); the screens offer it now.
-- Additive: columns with defaults (no existing row changes), checks that existing rows meet, the
-- audit trigger recreated, functions replaced with the same signatures, one helper, one RPC.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:demandes_parity', true);

-- -----------------------------------------------------------------------------
-- B-2: the intake's follow-up questions
-- -----------------------------------------------------------------------------
alter table public.demandes
  add column has_issues boolean,
  add column issues text[] not null default '{}',
  add column issues_comment text,
  add column previous_professionals text[] not null default '{}',
  add column previous_comment text,
  add column has_legal_context boolean,
  add column legal_context text[] not null default '{}',
  add column legal_detail text,
  add column motif_other text,
  add column availability_other text;

alter table public.demandes
  add constraint demandes_issues_check check (issues <@ array['coparenting', 'other']::text[]),
  add constraint demandes_issues_comment_check check (char_length(issues_comment) between 1 and 2000),
  add constraint demandes_previous_professionals_check
    check (previous_professionals <@ array['psychologist', 'social_worker', 'psychoeducator', 'physician', 'other']::text[]),
  add constraint demandes_previous_comment_check check (char_length(previous_comment) between 1 and 2000),
  add constraint demandes_legal_context_check check (legal_context <@ array['court_order', 'dpj']::text[]),
  add constraint demandes_legal_detail_check check (char_length(legal_detail) between 1 and 2000),
  add constraint demandes_motif_other_check check (char_length(motif_other) between 1 and 200 and private.is_tidy_text(motif_other)),
  add constraint demandes_availability_other_check
    check (char_length(availability_other) between 1 and 300 and private.is_tidy_text(availability_other)),
  -- « Non » (or no answer) holds no follow-up.
  add constraint demandes_followups_check check (
    (has_issues is true or (issues = '{}' and issues_comment is null))
    and (previous_therapy is true or (previous_professionals = '{}' and previous_comment is null))
    and (has_legal_context is true or (legal_context = '{}' and legal_detail is null)));

-- « Non » clears what follows the question (legacy), whoever writes.
create function private.demandes_clear_followups()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.has_issues is distinct from true then
    new.issues := '{}';
    new.issues_comment := null;
  end if;
  if new.previous_therapy is distinct from true then
    new.previous_professionals := '{}';
    new.previous_comment := null;
  end if;
  if new.has_legal_context is distinct from true then
    new.legal_context := '{}';
    new.legal_detail := null;
  end if;
  return new;
end;
$$;
revoke all on function private.demandes_clear_followups() from public, anon, authenticated, service_role;
create trigger demandes_clear_followups before insert or update on public.demandes
  for each row execute function private.demandes_clear_followups();

-- The same audit trigger, now redacting the follow-ups' free text too (health or family context,
-- like `concerns`).
create or replace trigger demandes_audit after insert or update or delete on public.demandes
  for each row execute function private.audit_trigger(
    'contact_name', 'contact_email', 'contact_phone_e164', 'concerns', 'source_referrer', 'source_utm', 'source_landing_page',
    'issues_comment', 'previous_comment', 'legal_detail', 'motif_other');

-- The intake keys, now with the follow-ups.
create or replace function private.demandes_intake_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['client_id', 'contact_name', 'contact_email', 'contact_phone_e164', 'beneficiary', 'previous_therapy',
               'language', 'modality', 'availability_periods', 'availability_days', 'preferred_pro_gender',
               'profession_title_id', 'clientele_id', 'concerns', 'payer_kind', 'insurer', 'is_urgent', 'motif_ids',
               'has_issues', 'issues', 'issues_comment', 'previous_professionals', 'previous_comment',
               'has_legal_context', 'legal_context', 'legal_detail', 'motif_other', 'availability_other']
$$;

-- Checks an intake object: an object, known keys only, the right JSON types. The table's checks
-- do the rest (values, lengths).
create or replace function private.demandes_check_intake(p_data jsonb, p_extra text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_type text;
  v_arrays constant text[] := array['availability_periods', 'availability_days', 'motif_ids', 'issues', 'previous_professionals', 'legal_context'];
  v_booleans constant text[] := array['previous_therapy', 'is_urgent', 'has_issues', 'has_legal_context'];
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'The intake must be an object' using errcode = '22023';
  end if;
  for v_key, v_type in select k, jsonb_typeof(v) from jsonb_each(p_data) as e(k, v) loop
    if not (v_key = any (private.demandes_intake_keys() || p_extra)) then
      raise exception 'Unknown intake key: %', v_key using errcode = '22023';
    end if;
    if v_type <> 'null' and (
         (v_key = any (v_arrays) and v_type <> 'array')
      or (v_key = any (v_booleans) and v_type <> 'boolean')
      or (v_key = 'source_utm' and v_type <> 'object')
      or (not (v_key = any (v_arrays || v_booleans || array['source_utm'])) and v_type <> 'string')) then
      raise exception 'Wrong type for intake key %', v_key using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(private.demandes_array(p_data, 'motif_ids')) > 50 then
    raise exception 'At most 50 motifs' using errcode = '22023';
  end if;
end;
$$;

-- A list of codes of the intake: distinct, sorted; empty for null / absent.
create function private.demandes_codes(p_data jsonb, p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce((select array_agg(distinct x order by x) from jsonb_array_elements_text(private.demandes_array(p_data, p_key)) x), '{}')
$$;
revoke all on function private.demandes_codes(jsonb, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- private.demandes_insert, now with the follow-ups (otherwise as D1)
-- -----------------------------------------------------------------------------
create or replace function private.demandes_insert(p_org uuid, p_data jsonb, p_actor uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_note text := private.demandes_text(p_data, 'internal_note');
  v_assignee uuid := private.demandes_text(p_data, 'assigned_to')::uuid;
  v_received timestamptz := coalesce(private.demandes_text(p_data, 'received_at')::timestamptz, pg_catalog.now());
  v_utm jsonb;
  v_constraint text;
begin
  perform private.demandes_check_intake(p_data, array['received_at', 'channel', 'referral_source_id', 'source_campaign',
    'source_utm', 'source_referrer', 'assigned_to', 'internal_note']);
  perform private.demandes_assert_worker(p_org, v_assignee);
  if v_received > pg_catalog.now() + interval '5 minutes' then
    raise exception 'La date de réception ne peut pas être dans le futur.' using errcode = 'P0001';
  end if;
  v_utm := coalesce((select jsonb_object_agg(k, private.demandes_clean(v #>> '{}', 200))
                       from jsonb_each(case when jsonb_typeof(p_data->'source_utm') = 'object' then p_data->'source_utm' else '{}' end) as e(k, v)
                      where k in ('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id')
                        and jsonb_typeof(v) = 'string' and private.demandes_clean(v #>> '{}', 200) is not null), '{}');

  begin
    insert into public.demandes (
      org_id, received_at, received_by, channel, referral_source_id, source_campaign, source_utm, source_referrer,
      client_id, contact_name, contact_email, contact_phone_e164, beneficiary, previous_therapy, language, modality,
      availability_periods, availability_days, preferred_pro_gender, profession_title_id, clientele_id, concerns,
      payer_kind, insurer, is_urgent, assigned_to, assigned_at, created_by,
      has_issues, issues, issues_comment, previous_professionals, previous_comment,
      has_legal_context, legal_context, legal_detail, motif_other, availability_other)
    values (
      p_org,
      v_received,
      p_actor,
      coalesce(private.demandes_text(p_data, 'channel'), 'phone'),
      private.demandes_text(p_data, 'referral_source_id')::uuid,
      coalesce(private.demandes_clean(p_data->>'source_campaign', 200), v_utm->>'utm_campaign'),
      v_utm,
      private.demandes_clean(p_data->>'source_referrer', 500),
      private.demandes_text(p_data, 'client_id')::uuid,
      private.demandes_text(p_data, 'contact_name'),
      pg_catalog.lower(private.demandes_text(p_data, 'contact_email')),
      private.demandes_text(p_data, 'contact_phone_e164'),
      private.demandes_text(p_data, 'beneficiary'),
      (p_data->>'previous_therapy')::boolean,
      coalesce(private.demandes_text(p_data, 'language'), 'fr'),
      coalesce(private.demandes_text(p_data, 'modality'), 'any'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(private.demandes_array(p_data, 'availability_periods')) x), '{}'),
      coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(private.demandes_array(p_data, 'availability_days')) x), '{}'),
      coalesce(private.demandes_text(p_data, 'preferred_pro_gender'), 'any'),
      private.demandes_text(p_data, 'profession_title_id')::uuid,
      private.demandes_text(p_data, 'clientele_id')::uuid,
      private.demandes_text(p_data, 'concerns'),
      coalesce(private.demandes_text(p_data, 'payer_kind'), 'unknown'),
      private.demandes_text(p_data, 'insurer'),
      coalesce((p_data->>'is_urgent')::boolean, false),
      v_assignee,
      case when v_assignee is not null then pg_catalog.now() end,
      p_actor,
      (p_data->>'has_issues')::boolean,
      private.demandes_codes(p_data, 'issues'),
      private.demandes_text(p_data, 'issues_comment'),
      private.demandes_codes(p_data, 'previous_professionals'),
      private.demandes_text(p_data, 'previous_comment'),
      (p_data->>'has_legal_context')::boolean,
      private.demandes_codes(p_data, 'legal_context'),
      private.demandes_text(p_data, 'legal_detail'),
      private.demandes_text(p_data, 'motif_other'),
      private.demandes_text(p_data, 'availability_other'))
    returning id into v_id;
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'demandes_contact_check' then
      raise exception 'Indiquez comment joindre la personne : un dossier, un nom, un courriel ou un téléphone.' using errcode = 'P0001';
    end if;
    raise;
  end;

  if p_data ? 'motif_ids' then
    perform private.demandes_set_motifs(p_org, v_id, private.demandes_array(p_data, 'motif_ids'));
  end if;
  if v_note is not null then
    insert into public.demande_notes (demande_id, org_id, internal_note, updated_by) values (v_id, p_org, v_note, p_actor);
  end if;
  insert into public.demande_events (demande_id, org_id, kind, to_state, assignee, by_user)
  values (v_id, p_org, 'created', 'new', v_assignee, p_actor);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- update_demande, now with the follow-ups (otherwise as D1)
-- -----------------------------------------------------------------------------
create or replace function public.update_demande(p_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_urgent boolean;
  v_client uuid;
  v_constraint text;
begin
  perform private.demandes_require('demandes.manage');
  perform private.demandes_check_intake(p_patch, array[]::text[]);
  v_row := private.demandes_lock(p_id);
  if v_row.state = 'closed' then
    raise exception 'Cette demande est fermée : rouvrez-la pour la modifier.' using errcode = 'P0001';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:update_demande', true);
  begin
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
      then coalesce((select array_agg(x) from jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_periods')) x), '{}')
      else d.availability_periods end,
    availability_days = case when p_patch ? 'availability_days'
      then coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(private.demandes_array(p_patch, 'availability_days')) x), '{}')
      else d.availability_days end,
    preferred_pro_gender = case when p_patch ? 'preferred_pro_gender' then coalesce(private.demandes_text(p_patch, 'preferred_pro_gender'), 'any') else d.preferred_pro_gender end,
    profession_title_id = case when p_patch ? 'profession_title_id' then private.demandes_text(p_patch, 'profession_title_id')::uuid else d.profession_title_id end,
    clientele_id = case when p_patch ? 'clientele_id' then private.demandes_text(p_patch, 'clientele_id')::uuid else d.clientele_id end,
    concerns = case when p_patch ? 'concerns' then private.demandes_text(p_patch, 'concerns') else d.concerns end,
    payer_kind = case when p_patch ? 'payer_kind' then coalesce(private.demandes_text(p_patch, 'payer_kind'), 'unknown') else d.payer_kind end,
    insurer = case when p_patch ? 'insurer' then private.demandes_text(p_patch, 'insurer') else d.insurer end,
    is_urgent = case when p_patch ? 'is_urgent' then coalesce((p_patch->>'is_urgent')::boolean, false) else d.is_urgent end,
    has_issues = case when p_patch ? 'has_issues' then (p_patch->>'has_issues')::boolean else d.has_issues end,
    issues = case when p_patch ? 'issues' then private.demandes_codes(p_patch, 'issues') else d.issues end,
    issues_comment = case when p_patch ? 'issues_comment' then private.demandes_text(p_patch, 'issues_comment') else d.issues_comment end,
    previous_professionals = case when p_patch ? 'previous_professionals' then private.demandes_codes(p_patch, 'previous_professionals')
                                  else d.previous_professionals end,
    previous_comment = case when p_patch ? 'previous_comment' then private.demandes_text(p_patch, 'previous_comment') else d.previous_comment end,
    has_legal_context = case when p_patch ? 'has_legal_context' then (p_patch->>'has_legal_context')::boolean else d.has_legal_context end,
    legal_context = case when p_patch ? 'legal_context' then private.demandes_codes(p_patch, 'legal_context') else d.legal_context end,
    legal_detail = case when p_patch ? 'legal_detail' then private.demandes_text(p_patch, 'legal_detail') else d.legal_detail end,
    motif_other = case when p_patch ? 'motif_other' then private.demandes_text(p_patch, 'motif_other') else d.motif_other end,
    availability_other = case when p_patch ? 'availability_other' then private.demandes_text(p_patch, 'availability_other') else d.availability_other end
   where d.id = v_row.id
  returning d.is_urgent, d.client_id into v_urgent, v_client;
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'demandes_contact_check' then
      raise exception 'Gardez un moyen de joindre la personne : un dossier, un nom, un courriel ou un téléphone.' using errcode = 'P0001';
    end if;
    raise;
  end;

  if p_patch ? 'motif_ids' then
    perform private.demandes_set_motifs(v_row.org_id, v_row.id, private.demandes_array(p_patch, 'motif_ids'));
  end if;
  if v_client is distinct from v_row.client_id then
    perform private.demandes_link_clients(v_row.org_id, v_row.id);
  end if;
  if v_urgent is distinct from v_row.is_urgent then
    insert into public.demande_events (demande_id, org_id, kind, by_user)
    values (v_row.id, v_row.org_id, case when v_urgent then 'urgent_set' else 'urgent_cleared' end, auth.uid());
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- A-6: the match also fills the files' primary professional
-- -----------------------------------------------------------------------------
-- The matched professional sees the request's client and its participants' files (Clients'
-- clients_link_professional, reason `demande`), and the files without a primary professional get
-- her (Clients' clients_fill_primary_professional, D-41), as do those whose primary professional
-- is the request's previous match: the last `matched` event, written after this call by both
-- matching paths (`set_demande_state`, an accepted proposal), so at a new match it names the one
-- before. Called at the match, and when a client is added to a matched request.
create or replace function private.demandes_link_clients(p_org uuid, p_demande uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pro uuid;
  v_previous uuid;
  v_ids uuid[];
  v_client uuid;
begin
  select d.matched_professional_id into v_pro from public.demandes d
   where d.id = p_demande and d.org_id = p_org and d.state = 'matched';
  if v_pro is null then
    return;
  end if;
  select coalesce(array_agg(distinct x.client_id), '{}') into v_ids
    from (select d.client_id from public.demandes d where d.id = p_demande and d.org_id = p_org and d.client_id is not null
          union
          select p.client_id from public.demande_participants p
           where p.demande_id = p_demande and p.org_id = p_org and p.client_id is not null) x;
  foreach v_client in array v_ids loop
    perform private.clients_link_professional(p_org, v_client, v_pro, 'demande');
  end loop;
  select e.professional_id into v_previous from public.demande_events e
   where e.demande_id = p_demande and e.org_id = p_org and e.kind = 'state_changed' and e.to_state = 'matched'
     and e.professional_id is not null
   order by e.at desc, e.id desc
   limit 1;
  perform private.clients_fill_primary_professional(p_org, v_ids, v_pro, v_previous);
end;
$$;

-- -----------------------------------------------------------------------------
-- B-1: who a proposal books
-- -----------------------------------------------------------------------------
-- The request's file (the person contacted and seen: the professional's limits bear on her), then
-- its participants' other files, the main person first (D-37). All of them, two at most: an
-- appointment counts two clients (Rendez-vous R1b); a couple service needs two. Refusals in French.
create function private.demandes_booking_clients(p_org uuid, p_demande uuid, p_for_two boolean)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client uuid;
  v_ids uuid[];
begin
  select d.client_id into v_client from public.demandes d where d.id = p_demande and d.org_id = p_org;
  if v_client is null then
    raise exception 'Rattachez d''abord le dossier du client (onglet Accueil).' using errcode = 'P0001', hint = 'client_id';
  end if;
  v_ids := array[v_client] || coalesce((
    select array_agg(x.client_id order by x.is_primary desc, x.created_at, x.id)
      from (select distinct on (p.client_id) p.client_id, p.is_primary, p.created_at, p.id
              from public.demande_participants p
             where p.demande_id = p_demande and p.org_id = p_org and p.client_id is not null and p.client_id <> v_client
             order by p.client_id, p.is_primary desc, p.created_at, p.id) x), '{}');
  if coalesce(p_for_two, false) and pg_catalog.cardinality(v_ids) < 2 then
    raise exception 'Ce service se réserve pour deux personnes : ajoutez le dossier de la deuxième personne (onglet Participants).'
      using errcode = 'P0001', hint = 'participants';
  end if;
  if pg_catalog.cardinality(v_ids) > 2 then
    raise exception 'Un rendez-vous compte deux clients au plus, et cette demande en a % avec un dossier : réservez ce rendez-vous dans l''agenda.',
      pg_catalog.cardinality(v_ids) using errcode = 'P0001', hint = 'participants';
  end if;
  return v_ids;
end;
$$;
revoke all on function private.demandes_booking_clients(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- create_proposition_for_service, now booking the participants' files (D-37; otherwise as D3b).
create or replace function public.create_proposition_for_service(
  p_actor uuid,
  p_demande_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz[],
  p_mode text,
  p_token_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.demandes;
  v_org uuid;
  v_to record;
  v_clients uuid[];
  v_for_two boolean;
  v_expires timestamptz;
  v_prop uuid := gen_random_uuid();
  v_start timestamptz;
  v_appt uuid;
  v_slots jsonb := '[]';
  v_link uuid;
  v_dir record;
  v_service_name text;
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_token_hash is null or pg_catalog.length(p_token_hash) <> 32 then
    raise exception 'Invalid token hash' using errcode = '22023';
  end if;
  select d.org_id into v_org from public.demandes d where d.id = p_demande_id;
  if v_org is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active')
     or not ('demandes.manage' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : demandes.manage' using errcode = '42501';
  end if;
  -- P3-40: nothing leaves for a client while Demandes is reserved for its testers.
  if not public.module_open_to_all_for_org(v_org, 'demandes') then
    raise exception 'Demandes est réservé aux testeurs : aucune proposition ne part vers un client pour le moment.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  if not public.module_enabled_for_org(v_org, 'appointments') then
    raise exception 'Activez d''abord Rendez-vous : une proposition réserve des plages dans l''agenda.' using errcode = 'P0001', hint = 'appointments';
  end if;
  select d.* into v_row from public.demandes d where d.id = p_demande_id for no key update;
  if v_row.state not in ('accepted', 'waitlist', 'proposed') then
    raise exception 'Une proposition se fait sur une demande « Acceptée » ou sur la liste d''attente : changez d''abord son état.'
      using errcode = 'P0001', hint = 'state';
  end if;
  if v_row.client_id is null then
    raise exception 'Rattachez d''abord le dossier du client (onglet Accueil).' using errcode = 'P0001', hint = 'client_id';
  end if;
  if exists (select 1 from public.demande_propositions x where x.demande_id = v_row.id and x.response = 'pending') then
    raise exception 'Une proposition attend déjà sa réponse : retirez-la d''abord.' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('video', 'phone') then
    raise exception 'Choisissez vidéo ou téléphone.' using errcode = 'P0001', hint = 'mode';
  end if;
  if p_starts_at is null or pg_catalog.cardinality(p_starts_at) not between 1 and 3
     or (select pg_catalog.count(distinct x) from pg_catalog.unnest(p_starts_at) x) <> pg_catalog.cardinality(p_starts_at) then
    raise exception 'Proposez de 1 à 3 plages différentes.' using errcode = 'P0001', hint = 'slots';
  end if;
  -- 48 h, or until the last slot starts when they all start sooner (the job then frees the request on time).
  v_expires := least(pg_catalog.now() + interval '48 hours', (select pg_catalog.max(x) from pg_catalog.unnest(p_starts_at) x));
  select r.* into v_to from private.demandes_recipient(v_org, v_row.id) r;
  if v_to.email is null then
    raise exception 'Aucune adresse courriel pour envoyer la proposition : ajoutez-la au dossier, ou proposez par téléphone.'
      using errcode = 'P0001', hint = 'email';
  end if;
  select f.for_two into v_for_two from private.service_booking_facts(v_org, p_service_id) f;
  -- The request's file, then its participants' other files (D-37).
  v_clients := private.demandes_booking_clients(v_org, v_row.id, v_for_two);

  -- What the person is shown, as on the fiche (no user here: Professionnels' published facts).
  select f.display_name, f.title into v_dir from private.professional_display_facts(v_org, p_professional_id) f;
  select s.name into v_service_name from public.services_catalog s where s.id = p_service_id and s.org_id = v_org;
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.audit_source', 'rpc:create_proposition', true);
  insert into public.demande_propositions
    (id, demande_id, org_id, professional_id, proposed_by, expires_at, directory_updated_at, directory_snapshot, service_id, mode, language)
  values
    (v_prop, v_row.id, v_org, p_professional_id, p_actor, v_expires, null,
     pg_catalog.jsonb_build_object('display_name', v_dir.display_name, 'title', v_dir.title, 'service_name', v_service_name),
     p_service_id, p_mode, case when v_to.language = 'en' then 'en' else 'fr' end);
  for v_start in select x from pg_catalog.unnest(p_starts_at) x order by x loop
    -- Every booking rule (R1b), in her availability; a slot starting within 48 h is held until it starts.
    v_appt := private.appointments_hold(v_org, p_professional_id, p_service_id, v_start, v_clients,
                                        least(v_expires, v_start), p_actor, v_prop, p_mode);
    v_slots := v_slots || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'appointment_id', v_appt, 'starts_at', v_start,
      'ends_at', (select a.ends_at from public.appointments a where a.id = v_appt)));
  end loop;
  v_link := private.issue_secure_link(v_org, 'proposition', 'demande_proposition', v_prop, p_token_hash, p_actor,
                                      greatest(v_expires - pg_catalog.now(), interval '1 minute'), '{}');
  perform pg_catalog.set_config('app.audit_source', 'rpc:create_proposition', true);
  update public.demande_propositions x set slots = v_slots, secure_link_id = v_link where x.id = v_prop;
  if v_row.state <> 'proposed' and private.demande_state_allowed(v_row.state, 'proposed') then
    update public.demandes d set state = 'proposed' where d.id = v_row.id;
    insert into public.demande_events (demande_id, org_id, kind, from_state, to_state, professional_id, by_user)
    values (v_row.id, v_org, 'state_changed', v_row.state, 'proposed', p_professional_id, p_actor);
  end if;
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'proposition_id', v_prop, 'demande_id', v_row.id, 'email', v_to.email, 'first_name', v_to.first_name,
    'language', case when v_to.language = 'en' then 'en' else 'fr' end,
    'clinic_name', (select o.name from public.organizations o where o.id = v_org),
    'timezone', (select o.timezone from public.organizations o where o.id = v_org),
    'professional_name', v_dir.display_name,
    'service_name', v_service_name,
    'mode', p_mode, 'slots', v_slots, 'expires_at', v_expires);
end;
$$;

-- -----------------------------------------------------------------------------
-- B-4: the consents of the request's files, live (D-39)
-- -----------------------------------------------------------------------------
-- Null when the request is not the caller's clinic's. One element per file (the request's first,
-- then the participants' in their order): { client_id, consents: [{ key, name, state }] }, the
-- consents the situation requires (Clients' rules: `general`, the payer kind: IVAC, PAE, and, once
-- matched, the professional's status: an intern, i.e. one with a supervisor, from Professionnels'
-- `professional_receipt_facts`) with
-- their state: signed, resign (« À signer de nouveau »), pending, overdue (a request past its due
-- date, from `client_consents_status`), missing. Read each time, never copied onto the request:
-- it never blocks a match (R-47).
create function public.demande_consents(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.demandes;
  v_payer text;
  v_status text;
begin
  perform private.demandes_require('demandes.view');
  select * into v_row from public.demandes d where d.id = p_id and d.org_id = v_org;
  if v_row.id is null then
    return null;
  end if;
  v_payer := case v_row.payer_kind when 'eap' then 'pae' when 'ivac' then 'ivac' end;
  if v_row.state = 'matched' and v_row.matched_professional_id is not null then
    select case when f.supervisor_id is not null then 'intern' end into v_status
      from private.professional_receipt_facts(v_org, array[v_row.matched_professional_id]) f;
  end if;
  return coalesce((
    with files as (
      select v_row.client_id as client_id, 0 as primary_rank, '-infinity'::timestamptz as created_at
       where v_row.client_id is not null
      union all
      select p.client_id, case when p.is_primary then 1 else 2 end, p.created_at
        from public.demande_participants p
       where p.demande_id = v_row.id and p.org_id = v_org and p.client_id is not null
    ),
    one as (
      select distinct on (f.client_id) f.client_id, f.primary_rank, f.created_at
        from files f
       order by f.client_id, f.primary_rank, f.created_at
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'client_id', o.client_id,
             'consents', coalesce((
               select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'key', r.consent_key,
                        'name', coalesce(t.name_fr, r.consent_key),
                        'state', case when r.state = 'pending' and exists (
                                        select 1 from public.client_consents_status s
                                         where s.org_id = v_org and s.client_id = o.client_id
                                           and s.consent_key = r.consent_key and s.state = 'overdue')
                                      then 'overdue' else r.state end)
                      order by t.sort_order, r.consent_key)
                 from private.required_consents_for(v_org, o.client_id, null, v_payer, v_status, '{}') r
                 left join public.client_consent_types t on t.org_id = v_org and t.key = r.consent_key), '[]'::jsonb))
           order by o.primary_rank, o.created_at, o.client_id)
      from one o), '[]'::jsonb);
end;
$$;
revoke all on function public.demande_consents(uuid) from public, anon, authenticated;
grant execute on function public.demande_consents(uuid) to authenticated;
