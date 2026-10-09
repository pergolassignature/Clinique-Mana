-- =============================================================================
-- Professionnels: a service contract signed outside the app, and a signed contract renewed
-- =============================================================================
-- Decisions: P4-520 … P4-527 (docs/plans/2026-10-07-decisions-log.md; the features decided by
-- Jonathan 2026-10-09). Module doc: docs/modules/professionals.md, « Service contract (4d) ».
-- Needs:   the contract (…_professionals_contracts.sql, …_professionals_contract_signed_files.sql),
--          the history tables (…_professionals_invitation_delivery.sql), core storage.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * « Contrat signé hors application » (P4-520): the imported professionals signed paper
--   contracts. A dedicated table, professional_paper_contracts (the signed PDF, the signature
--   date, who uploaded it), read beside the Documenso requests; core's signature_requests is never
--   written by the module. Rows are never updated nor deleted by any RPC: « Remplacer » adds a
--   newer one and the older stays, listed under « Contrats précédents » (P4-523).
-- * Upload (P4-521): purpose `professional_contract` (PDF, 20 Mo, bucket signed-documents, staged
--   a day), uploaded with professionals.contracts.send, the file read with
--   professionals.compensation (it prints the pay, as the Documenso PDF, P4-435). The RPC
--   record_professional_paper_contract checks both permissions (P4-436), the date (a calendar
--   date, from 2000-01-01 to the clinic's today), the file (the caller's, ready, of that purpose,
--   used once) and that no request is open (one live contract), then attaches the file to the
--   professional.
-- * The contract in force (P4-522): the most recently recorded among the signed requests (by
--   completion) and the paper contracts (by upload). Readiness's `contract_signed` is now « a
--   contract is in force »: any signed request or any paper contract
--   (private.professional_signed_contracts, same signature and grants). Before this migration a
--   signed request was always the latest one (P4-438 refused any send after it), so the rule only
--   differs once a renewal exists: a renewal out for signature, refused or expired never undoes the
--   signed contract.
-- * « Préparer un nouveau contrat » (P4-524): prepare_professional_contract gains the action
--   `renew` (the professionals-contract-send function passes it through, preview included):
--   allowed only when a contract is in force, refused while another one is out, resumes an open
--   draft under its own key like `send`. `send` is refused once a contract is in force (unless it
--   resumes an open draft: « Réessayer l'envoi » of a renewal); `regenerate` is refused when no
--   request was made after the contract in force (P4-438 kept: a signed contract is never
--   regenerated). Only open requests are ever cancelled, so the contract in force never is.
-- * The card (P4-525): get_professional_contract adds `current` (the contract in force: a signed
--   request, or a paper contract with its date, uploader and file), `previous` (the earlier ones,
--   newest first, each with its PDF for compensation readers) and narrows `request` to the request
--   at work: the latest one when nothing is in force (as before), else the latest one made after
--   the contract in force (a renewal), else null.
-- * History (P4-526): professional_paper_contracts joins private.professional_history_tables();
--   the renewal's status moves were already listed.
-- * « Mes documents » is unchanged (P4-527, Jonathan): the professional never sees her contract.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_contract_paper_renew', true);

-- -----------------------------------------------------------------------------
-- Upload purpose
-- -----------------------------------------------------------------------------
insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
   max_image_side, retain_days)
values
  ('professional_contract', 'professionals', 'signed-documents', 'professionals.contracts.send', 'professionals.compensation',
   null, 20971520, array['application/pdf'], null, 1)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- The paper contracts
-- -----------------------------------------------------------------------------
create table public.professional_paper_contracts (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  -- The signed PDF (purpose professional_contract, read with professionals.compensation).
  stored_file_id uuid not null references public.stored_files(id),
  -- The day the paper was signed: a calendar date, never converted (CLAUDE.md §9).
  signed_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  -- PK starts with professional_id: audit record ids start with it (P4-36), so Historique finds them.
  constraint professional_paper_contracts_pkey primary key (professional_id, id),
  constraint professional_paper_contracts_id_key unique (id),
  constraint professional_paper_contracts_file_key unique (stored_file_id),
  constraint professional_paper_contracts_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_paper_contracts_signed_on_check check (signed_on between date '2000-01-01' and date '2100-12-31')
);
create index professional_paper_contracts_org_idx on public.professional_paper_contracts (org_id, professional_id);
create index professional_paper_contracts_created_by_idx on public.professional_paper_contracts (created_by);

-- Closed: written by record_professional_paper_contract, read by get_professional_contract and
-- the readiness helper (definer). No update or delete path: a contract is replaced, never removed.
revoke all on public.professional_paper_contracts from anon, authenticated;
alter table public.professional_paper_contracts enable row level security;
create trigger professional_paper_contracts_audit
  after insert or update or delete on public.professional_paper_contracts
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- « Téléverser un contrat signé » / « Remplacer »
-- -----------------------------------------------------------------------------
-- Records the signed paper contract `p_file_id` (uploaded by the caller through storage-upload,
-- purpose professional_contract), signed on `p_signed_on`, for professional `p_id`; returns its
-- id. Refused: without professionals.contracts.send and professionals.compensation → 42501; bad
-- arguments → 22023; another clinic's professional → « Professionnel introuvable. »; the date
-- missing, in the future (the clinic's today) or before 2000 (HINT signed_on); a request open
-- (draft not abandoned, sent, viewed: HINT contract); a file that is not the caller's ready
-- upload of that purpose, or already recorded (HINT file).
create function public.record_professional_paper_contract(p_id uuid, p_file_id uuid, p_signed_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
begin
  if not (private.has_permission('professionals.contracts.send') and private.has_permission('professionals.compensation')) then
    raise exception 'Permission refusée : professionals.contracts.send' using errcode = '42501';
  end if;
  if p_id is null or p_file_id is null then
    raise exception 'Professionnel et fichier requis.' using errcode = '22023';
  end if;
  perform private.lock_professional(p_id);

  if p_signed_on is null then
    raise exception 'La date de signature est requise.' using errcode = 'P0001', hint = 'signed_on';
  end if;
  if p_signed_on > private.clinic_today() then
    raise exception 'La date de signature ne peut pas être dans le futur.' using errcode = 'P0001', hint = 'signed_on';
  end if;
  if p_signed_on < date '2000-01-01' then
    raise exception 'La date de signature doit être le 1er janvier 2000 ou plus tard.' using errcode = 'P0001', hint = 'signed_on';
  end if;

  -- One live contract: a contract being sent or waiting for a signature is settled first.
  if exists (select 1 from public.signature_requests r
              where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
                and r.purpose = 'professionals.service_contract'
                and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))) then
    raise exception 'Un contrat attend une signature ou est en cours d''envoi : attendez sa signature ou utilisez « Régénérer » avant de téléverser un contrat signé.'
      using errcode = 'P0001', hint = 'contract';
  end if;

  -- The file (attach_stored_file re-checks purpose, uploader, clinic, status and staging).
  if not exists (select 1 from public.stored_files f
                  where f.id = p_file_id and f.org_id = v_org and f.purpose = 'professional_contract' and f.status = 'ready'
                    and (f.retain_until is null or f.retain_until > pg_catalog.now())
                    and f.uploaded_by = auth.uid())
     or exists (select 1 from public.professional_paper_contracts c where c.stored_file_id = p_file_id) then
    raise exception 'Fichier introuvable. Téléversez-le de nouveau.' using errcode = 'P0001', hint = 'file';
  end if;
  perform private.attach_stored_file(p_file_id, array['professional_contract'], 'professional', p_id,
    'professionals.compensation', null, null, auth.uid());

  insert into public.professional_paper_contracts (org_id, professional_id, stored_file_id, signed_on, created_by)
  values (v_org, p_id, p_file_id, p_signed_on, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_professional_paper_contract(uuid, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.record_professional_paper_contract(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Readiness: a contract in force (same signature and grants as *_professionals_contracts.sql)
-- -----------------------------------------------------------------------------
-- The professionals of the caller's clinic with a signed service-contract request or a paper
-- contract, for the invoker views: every professional for professionals.view, else the caller's
-- own file (professionals.self).
create or replace function private.professional_signed_contracts()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 50
as $$
  select r.subject_id
    from public.signature_requests r
   where r.org_id = (select private.current_user_org_id())
     and r.subject_type = 'professional'
     and r.purpose = 'professionals.service_contract'
     and r.status = 'signed'
     and ((select private.has_permission('professionals.view'))
          or (r.subject_id = (select private.current_professional_id())
              and (select private.has_permission('professionals.self'))))
  union
  select c.professional_id
    from public.professional_paper_contracts c
   where c.org_id = (select private.current_user_org_id())
     and ((select private.has_permission('professionals.view'))
          or (c.professional_id = (select private.current_professional_id())
              and (select private.has_permission('professionals.self'))))
$$;

-- -----------------------------------------------------------------------------
-- prepare_professional_contract: `renew` (same signature and grants)
-- -----------------------------------------------------------------------------
-- As *_professionals_contracts.sql (its comment), with p_action `renew` (« Préparer un nouveau
-- contrat ») and the rules once a contract is in force (header, P4-524):
--   renew       a contract in force is required (HINT contract); otherwise as `send`: refused
--               while a contract is sent or viewed, an open draft resumed under its own key;
--   send        refused once a contract is in force, unless it resumes an open draft;
--   regenerate  refused when no request was made after the contract in force.
create or replace function public.prepare_professional_contract(p_actor uuid, p_id uuid, p_action text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_keys text[];
  v_row public.professionals;
  v_open public.signature_requests;
  v_latest_created timestamptz;
  v_in_force_since timestamptz;
  v_key text;
  v_cancel jsonb;
  v_snapshot public.professional_contract_snapshots;
  v_version uuid;
  v_terms jsonb;
  v_recipients jsonb;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_actor is null or p_id is null or p_action is null or p_action not in ('send', 'renew', 'regenerate', 'resend')
     or (p_action <> 'resend' and coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9_-]{1,100}$') then
    raise exception 'Arguments invalides : acteur, professionnel, action et clé attendus.' using errcode = '22023';
  end if;
  -- The actor's org unlocked, the professional's lock, then the actor's permissions (Task 3.18).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org for no key update;
  v_keys := private.permission_keys_for(p_actor);
  if not (v_keys @> array['professionals.contracts.send', 'professionals.compensation'])
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active') then
    raise exception 'Permission refusée : professionals.contracts.send' using errcode = '42501';
  end if;
  if v_row.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;

  select * into v_open from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'));

  if p_action = 'resend' then
    if v_open.id is null or v_open.status not in ('sent', 'viewed') then
      raise exception 'Aucun contrat n''attend de signature.' using errcode = 'P0001', hint = 'contract';
    end if;
    if v_open.envelope_id is null then
      raise exception 'Ce contrat n''a pas d''envoi Documenso à renvoyer : utilisez « Régénérer ».'
        using errcode = 'P0001', hint = 'contract';
    end if;
    v_recipients := coalesce((select pg_catalog.jsonb_agg(s.documenso_recipient_id)
                                from (select x.documenso_recipient_id from public.signature_request_signers x
                                       where x.request_id = v_open.id and x.status in ('pending', 'viewed')
                                         and x.documenso_recipient_id is not null
                                       order by x.signing_order limit 1) s), '[]'::jsonb);
    if pg_catalog.jsonb_array_length(v_recipients) = 0 then
      raise exception 'Personne n''attend ce courriel : utilisez « Synchroniser » pour mettre le contrat à jour.'
        using errcode = 'P0001', hint = 'contract';
    end if;
    return pg_catalog.jsonb_build_object('resend', pg_catalog.jsonb_build_object(
      'request_id', v_open.id,
      'envelope_id', v_open.envelope_id,
      'recipient_ids', v_recipients));
  end if;

  if v_row.status = 'inactive' then
    raise exception 'Un dossier inactif ne peut pas recevoir de contrat.' using errcode = 'P0001', hint = 'status';
  end if;

  -- The contract in force (P4-522): since when, if any; and the latest request.
  select max(x.since) into v_in_force_since
    from (select coalesce(r.completed_at, r.completed_event_at, r.created_at) as since
            from public.signature_requests r
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose = 'professionals.service_contract' and r.status = 'signed'
          union all
          select c.created_at from public.professional_paper_contracts c
           where c.org_id = v_org and c.professional_id = p_id) x;
  select r.created_at into v_latest_created from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
   order by r.created_at desc, r.id desc
   limit 1;
  if p_action = 'renew' and v_in_force_since is null then
    raise exception 'Aucun contrat signé à remplacer : utilisez « Préparer le contrat ».' using errcode = 'P0001', hint = 'contract';
  end if;
  if (p_action = 'send' and v_in_force_since is not null and v_open.id is null)
     or (p_action = 'regenerate' and v_in_force_since is not null
         and (v_latest_created is null or v_latest_created <= v_in_force_since)) then
    raise exception 'Le contrat de service de ce professionnel est déjà signé : utilisez « Préparer un nouveau contrat ».'
      using errcode = 'P0001', hint = 'contract';
  end if;

  v_key := 'professionals.service_contract:' || p_id || ':' || p_idempotency_key;
  if p_action in ('send', 'renew') then
    if v_open.status in ('sent', 'viewed') then
      raise exception 'Un contrat attend déjà la signature. Utilisez « Renvoyer » ou « Régénérer ».'
        using errcode = 'P0001', hint = 'contract';
    end if;
    -- A draft is the same request sent again (its send failed, or is under way: the send claim
    -- decides), under its own key.
    if v_open.id is not null then
      v_key := v_open.idempotency_key;
    end if;
  elsif v_open.id is not null and v_open.idempotency_key <> v_key then
    -- Another send of the open draft is under way (its claim younger than the functions'
    -- STALE_SEND_MS, 10 minutes): cancelling now would race it.
    if v_open.status = 'draft' and v_open.send_started_at > pg_catalog.now() - interval '10 minutes' then
      raise exception 'Un envoi est déjà en cours.' using errcode = 'P0001', hint = 'contract';
    end if;
    v_cancel := pg_catalog.jsonb_build_object('request_id', v_open.id, 'envelope_id', v_open.envelope_id,
                                              'status', v_open.status);
  end if;

  select * into v_snapshot from public.professional_contract_snapshots s
   where s.org_id = v_org and s.idempotency_key = v_key;
  if v_snapshot.id is not null then
    if not exists (select 1 from public.document_template_versions v
                    join public.document_templates t on t.id = v.template_id
                   where v.id = v_snapshot.template_version_id and v.status = 'published' and t.is_active) then
      raise exception 'Le modèle de contrat a changé depuis cet envoi. Utilisez « Régénérer ».'
        using errcode = 'P0001', hint = 'regenerate';
    end if;
    perform private.professional_contract_check(v_org, v_snapshot.template_version_id, v_snapshot.template_values);
  else
    select v.id into v_version
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where t.org_id = v_org and t.key = 'professionals.service_contract' and t.is_active;
    if v_version is null then
      raise exception 'Aucun modèle de contrat publié. Publiez « Contrat de service » dans Paramètres → Contrats.'
        using errcode = 'P0001', hint = 'template';
    end if;
    v_terms := private.professional_contract_terms(v_org, p_id);
    perform private.professional_contract_check(v_org, v_version, v_terms -> 'values');

    perform pg_catalog.set_config('app.audit_source', 'rpc:prepare_professional_contract', true);
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
    insert into public.professional_contract_snapshots as s
      (org_id, professional_id, idempotency_key, template_version_id, title, template_values, annexe, signers, created_by)
    values
      (v_org, p_id, v_key, v_version, v_terms ->> 'title', v_terms -> 'values', v_terms -> 'annexe',
       v_terms -> 'signers', p_actor)
    returning * into v_snapshot;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
    perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  end if;

  return pg_catalog.jsonb_build_object(
    'idempotency_key', v_snapshot.idempotency_key,
    'template_version_id', v_snapshot.template_version_id,
    'title', v_snapshot.title,
    'values', v_snapshot.template_values,
    'annexe', v_snapshot.annexe,
    'signers', v_snapshot.signers,
    'cancel', v_cancel);
end;
$$;

-- -----------------------------------------------------------------------------
-- The card: current, request, previous (P4-525)
-- -----------------------------------------------------------------------------
-- A service-contract request as the card reads it (*_professionals_contract_signed_files.sql's
-- shape): the state, dates and signers' progress for every reader; the title, files, page count
-- and rejection reason only to a caller holding its view permission (`p_perms`). Called from the
-- definer RPC below only.
create function private.professional_contract_request_json(p_request_id uuid, p_perms text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'id', r.id, 'status', r.status, 'last_error', r.last_error, 'template_version', v.version,
           'created_at', r.created_at, 'send_started_at', r.send_started_at, 'last_send_at', r.last_send_at,
           'sent_at', r.sent_at, 'viewed_at', r.viewed_at,
           'completed_at', r.completed_at, 'rejected_at', r.rejected_at, 'cancelled_at', r.cancelled_at,
           'expired_at', r.expired_at, 'expires_at', r.expires_at,
           'can_read', r.view_permission = any (p_perms),
           'title', case when r.view_permission = any (p_perms) then r.title end,
           'signed_file_id', case when r.view_permission = any (p_perms) then r.signed_file_id end,
           'source_file_id', case when r.view_permission = any (p_perms) then r.source_file_id end,
           'page_count', case when r.view_permission = any (p_perms) then r.page_count end,
           'rejection_reason', case when r.view_permission = any (p_perms) then r.rejection_reason end,
           'signers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                         'role', s.role, 'name', s.name, 'status', s.status,
                                         'signing_order', s.signing_order, 'viewed_at', s.viewed_at,
                                         'signed_at', s.signed_at, 'rejected_at', s.rejected_at)
                                       order by s.signing_order)
                                  from public.signature_request_signers s where s.request_id = r.id), '[]'::jsonb))
    from public.signature_requests r
    left join public.document_template_versions v on v.id = r.template_version_id
   where r.id = p_request_id
$$;

-- A contract that was in force: {kind: 'signed', request} or {kind: 'paper', id, signed_on,
-- created_at, uploaded_by_name, can_read, file: {id, name, mime_type, size_bytes} | null (the file
-- only to a caller holding its view permission, and while it is kept)}.
create function private.professional_contract_entry(p_kind text, p_id uuid, p_perms text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case p_kind
    when 'signed' then pg_catalog.jsonb_build_object('kind', 'signed', 'request', private.professional_contract_request_json(p_id, p_perms))
    else (select pg_catalog.jsonb_build_object(
                   'kind', 'paper', 'id', c.id, 'signed_on', c.signed_on, 'created_at', c.created_at,
                   'uploaded_by_name', pr.display_name,
                   'can_read', f.view_permission = any (p_perms),
                   'file', case when f.view_permission = any (p_perms) and f.status = 'ready' then
                             pg_catalog.jsonb_build_object('id', f.id, 'name', f.original_name, 'mime_type', f.mime_type,
                                                           'size_bytes', f.size_bytes) end)
            from public.professional_paper_contracts c
            join public.stored_files f on f.id = c.stored_file_id
            left join public.profiles pr on pr.user_id = c.created_by and pr.org_id = c.org_id
           where c.id = p_id)
  end
$$;

revoke all on function
  private.professional_contract_request_json(uuid, text[]),
  private.professional_contract_entry(text, uuid, text[])
from public, anon, authenticated, service_role;

-- {template, clinic_signer (as before), current: the contract in force | null, request: the
-- request at work | null, previous: [the earlier contracts in force, newest first]} (header).
-- Null for a professional the caller cannot read (another clinic's).
create or replace function public.get_professional_contract(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_perms text[] := private.current_permission_keys()::text[];
  v_current jsonb;
  v_since timestamptz;
  v_previous jsonb;
  v_request jsonb;
begin
  if not ('professionals.view' = any (v_perms)) then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    return null;
  end if;

  -- The contracts that were in force, newest first (P4-522): signed requests by completion, paper
  -- contracts by upload.
  with c as (
    select 'signed'::text as kind, r.id, coalesce(r.completed_at, r.completed_event_at, r.created_at) as since
      from public.signature_requests r
     where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
       and r.purpose = 'professionals.service_contract' and r.status = 'signed'
    union all
    select 'paper'::text, pc.id, pc.created_at
      from public.professional_paper_contracts pc
     where pc.org_id = v_org and pc.professional_id = p_id
  ), ranked as (
    select c.kind, c.id, c.since, pg_catalog.row_number() over (order by c.since desc, c.id desc) as n from c
  )
  select (select private.professional_contract_entry(x.kind, x.id, v_perms) from ranked x where x.n = 1),
         (select x.since from ranked x where x.n = 1),
         coalesce((select pg_catalog.jsonb_agg(private.professional_contract_entry(x.kind, x.id, v_perms) order by x.n)
                     from ranked x where x.n > 1), '[]'::jsonb)
    into v_current, v_since, v_previous;

  -- The request at work: the latest one, made after the contract in force when there is one.
  select private.professional_contract_request_json(r.id, v_perms)
    into v_request
    from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
     and (v_since is null or r.created_at > v_since)
   order by r.created_at desc, r.id desc
   limit 1;

  return pg_catalog.jsonb_build_object(
    'template', (select pg_catalog.jsonb_build_object(
                          'id', t.id, 'published_version_id', p.id, 'published_version', p.version,
                          'published_at', p.published_at, 'draft_version_id', d.id)
                   from public.document_templates t
                   left join public.document_template_versions p on p.template_id = t.id and p.status = 'published'
                   left join public.document_template_versions d on d.template_id = t.id and d.status = 'draft'
                  where t.org_id = v_org and t.key = 'professionals.service_contract' and t.is_active),
    'clinic_signer', (select nullif(pg_catalog.btrim(o.signatory_name), '') is not null
                             and nullif(pg_catalog.btrim(o.signatory_email), '') is not null
                        from public.organizations o where o.id = v_org),
    'current', v_current,
    'request', v_request,
    'previous', v_previous);
end;
$$;

-- -----------------------------------------------------------------------------
-- History (P4-526): the paper contracts' rows (same body as *_professionals_invitation_delivery.sql)
-- -----------------------------------------------------------------------------
create or replace function private.professional_history_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
               'professional_matching_notes',
               'professional_professions', 'professional_clienteles',
               'professional_motifs', 'professional_languages', 'professional_payer_numbers',
               'professional_private', 'professional_retention', 'professional_session_counts',
               'professional_client_agreements', 'professional_submissions', 'professional_consents',
               'professional_documents', 'professional_invitation_deliveries', 'professional_paper_contracts']
$$;
