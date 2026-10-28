-- =============================================================================
-- Clients consents: the assigned professional signs too (CC-22)
-- =============================================================================
-- Asked by Jonathan, « Suivi - application » of 22 October 2026, item 2: « Le contrat sera signé
-- par moi mais les autres formulaires de consentement qui seront envoyé aux clients devront être
-- signé par le professionnel assigné au dossier. » The professional's own service contract
-- (module Professionnels) is unchanged: this is about the client consents of C5.
-- Needs:   *_clients_consents.sql, *_clients_consents_handlers.sql,
--          *_clients_imports_security_fixes.sql, *_clients_consent_french_fallback.sql,
--          *_professionals_core.sql (professionals, private.current_professional_id).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6.
--
-- Revises R-48 and CC-4 (both « Déléguée — révisable »): a client consent is signed by the client
-- side (the client from 14, else the parents or guardians) AND by the professional assigned to the
-- file (`clients.primary_professional_id`). CC-1's three boxes hold: `client`, `client_2`,
-- `professional` is exactly three.
--
-- Key choices
-- * Every client consent needs the professional: no per-consent opt-out. A file without an
--   assigned professional, or whose professional is not active, refuses the send with a French
--   P0001 (HINT `professional_required`); the clinic assigns one in the file and sends again.
-- * The professional signs **in the app**, authenticated (role `provider`, `clients.self`), like
--   her own « Consentement au droit à l'image » (P4-487): no secure link, no email, no identity
--   check — so `prepare_client_consent_request_for_service` keeps its two token hashes, one per
--   client-side signer, and its returned `signers` still lists only the people who get an email.
--   The professional comes back separately, as `professional`.
-- * The professional signs **second**: the clauses printed in the document are the client's
--   answers (R-46), so no envelope can be rendered before the client has answered. Her surface
--   resumes the envelope already out and never creates one — which keeps the renderer out of
--   `clients-consent-professional-sign` (ADR 0008).
-- * `signer_client_id` becomes nullable: a signer row names either a client or a professional,
--   never both and never neither.
-- * The seeded draft templates gain a third signature box and a `professional.full_name`
--   variable. Only DRAFT versions are touched, and only where the box is missing, so a text
--   already being written is not clobbered.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_professional_signer', true);

-- -----------------------------------------------------------------------------
-- The signer row may name a professional
-- -----------------------------------------------------------------------------
alter table public.client_consent_request_signers
  add column if not exists signer_professional_id uuid;

comment on column public.client_consent_request_signers.signer_professional_id is
  'The professional assigned to the file, for role `professional` (CC-22); null for a client-side signer.';

alter table public.client_consent_request_signers
  alter column signer_client_id drop not null;

alter table public.client_consent_request_signers
  drop constraint if exists client_consent_request_signers_role_check;
alter table public.client_consent_request_signers
  add constraint client_consent_request_signers_role_check
  check (role in ('client', 'client_2', 'professional'));

-- Either a client or a professional signs on this row, and the professional role is the only one
-- that names a professional.
alter table public.client_consent_request_signers
  add constraint client_consent_request_signers_identity_check
  check (((signer_client_id is not null)::int + (signer_professional_id is not null)::int) = 1
         and (role = 'professional') = (signer_professional_id is not null));

alter table public.client_consent_request_signers
  add constraint client_consent_request_signers_professional_fkey
  foreign key (org_id, signer_professional_id) references public.professionals (org_id, id) on delete cascade;

create index client_consent_request_signers_professional_idx
  on public.client_consent_request_signers (org_id, signer_professional_id);

-- -----------------------------------------------------------------------------
-- Who signs (R-48 revised by CC-22): the client side, then the assigned professional
-- -----------------------------------------------------------------------------
-- Latest body: 20261013031103_clients_consents_handlers.sql.
-- Each element is {role, signer_client_id, signer_professional_id, relation_id}: the client-side
-- signers as before (`client`, then `client_2` under shared custody), then `professional`.
create or replace function private.clients_consent_signers(p_org uuid, p_client_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_age int;
  v_people jsonb;
  v_needed int;
  v_out jsonb;
  v_pro public.professionals%rowtype;
begin
  select * into v_client from public.clients c where c.org_id = p_org and c.id = p_client_id;
  if v_client.id is null then
    raise exception 'Client introuvable.' using errcode = 'P0001', hint = 'client';
  end if;
  v_age := private.clients_age_on(v_client.birthday, private.clients_org_today(p_org));
  if v_age is null or v_age >= 14 then
    v_out := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'client', 'signer_client_id', v_client.id, 'signer_professional_id', null, 'relation_id', null));
  else
    -- The people who manage this client's appointments and forms, as parent or guardian, with a
    -- file still active; the main contact first.
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_client_id', k.client_id, 'relation_id', r.id)
                                         order by k.is_main_contact desc, r.created_at, k.client_id), '[]')
      into v_people
      from private.client_contacts_for(p_org, p_client_id, 'appointments') k
      join public.clients o on o.org_id = p_org and o.id = k.client_id and o.archived_at is null
      left join public.client_relations r
        on r.org_id = p_org
       and ((r.client_a_id = p_client_id and r.client_b_id = k.client_id) or (r.client_b_id = p_client_id and r.client_a_id = k.client_id))
     where not k.is_self and k.relation_type in ('parent', 'guardian');
    v_needed := case when v_client.shared_custody then 2 else 1 end;
    if pg_catalog.jsonb_array_length(v_people) < v_needed then
      raise exception '%', case when v_client.shared_custody
        then 'Ce client a moins de 14 ans et sa garde est partagée : ses deux parents doivent signer. Ajoutez-les dans ses proches avec le droit « Gérer les rendez-vous et formulaires ».'
        else 'Ce client a moins de 14 ans : un parent ou un tuteur doit signer. Ajoutez-le dans ses proches avec le droit « Gérer les rendez-vous et formulaires ».' end
        using errcode = 'P0001', hint = 'signer_required';
    end if;
    v_out := (select pg_catalog.jsonb_agg(p.value
                       || pg_catalog.jsonb_build_object('role', case when p.ordinality = 1 then 'client' else 'client_2' end,
                                                        'signer_professional_id', null)
                       order by p.ordinality)
                from pg_catalog.jsonb_array_elements(v_people) with ordinality p
               where p.ordinality <= v_needed);
  end if;

  -- CC-22: the professional assigned to the file signs too.
  if v_client.primary_professional_id is null then
    raise exception 'Ce dossier n''a pas de professionnel attitré : le consentement doit être signé par le professionnel assigné au dossier. Choisissez-le dans la fiche du client, puis envoyez la demande.'
      using errcode = 'P0001', hint = 'professional_required';
  end if;
  select * into v_pro from public.professionals p
   where p.org_id = p_org and p.id = v_client.primary_professional_id;
  if v_pro.id is null or v_pro.status <> 'active' then
    raise exception 'Le professionnel attitré à ce dossier n''est pas actif : il ne peut pas signer le consentement. Changez-le dans la fiche du client, puis envoyez la demande.'
      using errcode = 'P0001', hint = 'professional_required';
  end if;
  return v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'role', 'professional', 'signer_client_id', null,
    'signer_professional_id', v_pro.id, 'relation_id', null));
end;
$$;
revoke all on function private.clients_consent_signers(uuid, uuid) from public, anon, authenticated, service_role;

-- Whether a signer row and a computed signer element name the same person, whichever side signs:
-- the rebuild comparisons key on this, since `signer_client_id` is null for the professional and
-- `null = null` is null (the old comparison would rebuild on every send).
create function private.clients_consent_signer_key(p_client_id uuid, p_professional_id uuid)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_client_id, p_professional_id)
$$;
revoke all on function private.clients_consent_signer_key(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Sending: the professional is a signer row, but gets no link and no email
-- -----------------------------------------------------------------------------
-- Latest body: 20261014155938_clients_consent_french_fallback.sql. Same signature (grants kept):
-- still two token hashes, one per client-side signer. `signers` still lists only the people who
-- receive an email, so `clients-consent-send` needs no change there; the professional comes back
-- separately as `professional` ({professional_id, signer_id, full_name, email}, or null).
create or replace function public.prepare_client_consent_request_for_service(
  p_org_id uuid,
  p_actor uuid,
  p_client_id uuid,
  p_consent_key text,
  p_context_type text,
  p_context_id uuid,
  p_due_at timestamptz,
  p_token_hash_1 bytea,
  p_token_hash_2 bytea,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_type public.client_consent_types%rowtype;
  v_req public.client_consent_requests%rowtype;
  v_version uuid;
  v_lang text;
  v_signers jsonb;
  v_signer jsonb;
  v_signer_id uuid;
  v_link uuid;
  v_person public.clients%rowtype;
  v_out jsonb := '[]';
  v_i int := 0;
  v_resent boolean := false;
  v_expires timestamptz;
  v_pro jsonb;
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_org_id is null or p_token_hash_1 is null or p_token_hash_2 is null or p_token_hash_1 = p_token_hash_2 then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'clients') then
    raise exception 'Module disabled' using errcode = '22023';
  end if;
  -- P3-40: nothing leaves for a client while the module is reserved for its testers.
  if not public.module_open_to_all_for_org(p_org_id, 'clients') then
    raise exception 'Le module Clients est réservé aux testeurs : aucune demande de consentement ne part aux clients avant son ouverture à tous.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  if p_actor is not null then
    if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
       or not ('clients.manage' = any (private.permission_keys_for(p_actor))) then
      raise exception 'Permission refusée : clients.manage' using errcode = '42501';
    end if;
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  elsif p_request_id is null then
    raise exception 'A new request needs an actor' using errcode = '22023';
  end if;

  if p_request_id is not null then
    select * into v_req from public.client_consent_requests r where r.org_id = p_org_id and r.id = p_request_id for update;
    if v_req.id is null or v_req.state <> 'pending' then
      raise exception 'Cette demande de consentement n''est plus en attente.' using errcode = 'P0001', hint = 'state';
    end if;
    p_client_id := v_req.client_id;
    p_consent_key := v_req.consent_key;
  end if;

  select * into v_client from public.clients c where c.org_id = p_org_id and c.id = p_client_id for update;
  if v_client.id is null or v_client.archived_at is not null or v_client.anonymized_at is not null then
    raise exception 'Ce dossier client n''est pas actif.' using errcode = 'P0001', hint = 'client';
  end if;
  select * into v_type from public.client_consent_types t where t.org_id = p_org_id and t.key = p_consent_key and t.is_active;
  if v_type.id is null then
    raise exception 'Ce consentement n''existe pas.' using errcode = 'P0001', hint = 'consent_key';
  end if;

  if v_req.id is null then
    -- An open request for the same consent is sent again rather than doubled.
    select * into v_req from public.client_consent_requests r
     where r.org_id = p_org_id and r.client_id = p_client_id and r.consent_key = p_consent_key and r.state = 'pending'
     for update;
  end if;

  if v_req.id is null then
    -- R-75: the text published in the client's language, else the published French text (the
    -- clinic has no English texts for now); the request records the language actually used.
    select v.id, pg_catalog.right(t.key, 2) into v_version, v_lang
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where t.org_id = p_org_id and t.is_active
       and t.key in ('clients.consent_' || p_consent_key || '_' || v_client.language, 'clients.consent_' || p_consent_key || '_fr')
     order by (t.key = 'clients.consent_' || p_consent_key || '_' || v_client.language) desc
     limit 1;
    if v_version is null then
      raise exception 'Le texte de ce consentement n''est pas encore publié en français. Publiez-le dans Paramètres → Consentements.'
        using errcode = 'P0001', hint = 'template';
    end if;
    if (p_context_type is not null and p_context_type not in ('appointment', 'demande', 'waitlist_entry', 'record'))
       or ((p_context_type is null) <> (p_context_id is null)) then
      raise exception 'Invalid context' using errcode = '22023';
    end if;
    v_signers := private.clients_consent_signers(p_org_id, p_client_id);
    insert into public.client_consent_requests
      (org_id, client_id, consent_key, language, template_version_id, clauses, context_type, context_id, due_at, requested_by)
    values
      (p_org_id, p_client_id, p_consent_key, v_lang, v_version, v_type.clauses, p_context_type,
       p_context_id, p_due_at, p_actor)
    returning * into v_req;
    for v_signer in select s from pg_catalog.jsonb_array_elements(v_signers) s loop
      insert into public.client_consent_request_signers
        (org_id, request_id, role, signer_client_id, signer_professional_id, relation_id)
      values (p_org_id, v_req.id, v_signer ->> 'role', (v_signer ->> 'signer_client_id')::uuid,
              (v_signer ->> 'signer_professional_id')::uuid, (v_signer ->> 'relation_id')::uuid);
    end loop;
  else
    v_resent := true;
    -- Who signs may have changed since (a right removed, a relation deleted, a birthday, the
    -- custody, the assigned professional): without an envelope out, the signers are rebuilt and
    -- the former ones' links revoked; with one out, the signature runs to its end with its signers.
    if not exists (select 1 from public.signature_requests s
                    where s.org_id = p_org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                      and s.subject_id = v_req.id and s.status in ('draft', 'sent', 'viewed')) then
      v_signers := private.clients_consent_signers(p_org_id, v_req.client_id);
      if exists (select 1 from public.client_consent_request_signers x
                  where x.request_id = v_req.id
                    and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                     where s ->> 'role' = x.role
                                       and private.clients_consent_signer_key((s ->> 'signer_client_id')::uuid,
                                                                              (s ->> 'signer_professional_id')::uuid)
                                           = private.clients_consent_signer_key(x.signer_client_id, x.signer_professional_id)))
         or pg_catalog.jsonb_array_length(v_signers)
            <> (select pg_catalog.count(*) from public.client_consent_request_signers x where x.request_id = v_req.id) then
        perform private.clients_consent_close_links(p_org_id, v_req.id, p_actor);
        delete from public.client_consent_request_signers x where x.request_id = v_req.id;
        for v_signer in select s from pg_catalog.jsonb_array_elements(v_signers) s loop
          insert into public.client_consent_request_signers
            (org_id, request_id, role, signer_client_id, signer_professional_id, relation_id)
          values (p_org_id, v_req.id, v_signer ->> 'role', (v_signer ->> 'signer_client_id')::uuid,
                  (v_signer ->> 'signer_professional_id')::uuid, (v_signer ->> 'relation_id')::uuid);
        end loop;
      end if;
    end if;
    update public.client_consent_requests r
       set last_sent_at = pg_catalog.now(),
           reminded_at = case when p_actor is null then pg_catalog.now() else r.reminded_at end,
           due_at = coalesce(p_due_at, r.due_at)
     where r.id = v_req.id;
  end if;

  -- One link per client-side signer (`client` sorts before `client_2`): the professional signs in
  -- the app, so she gets neither a link nor an email.
  for v_signer_id in
    select s.id from public.client_consent_request_signers s
     where s.request_id = v_req.id and s.role in ('client', 'client_2') order by s.role
  loop
    v_i := v_i + 1;
    select c.* into v_person from public.clients c
      join public.client_consent_request_signers s on s.signer_client_id = c.id and s.org_id = c.org_id
     where s.id = v_signer_id;
    if v_person.email is null or v_person.anonymized_at is not null then
      raise exception 'La personne qui doit signer n''a pas d''adresse courriel : ajoutez-la à son dossier.'
        using errcode = 'P0001', hint = 'signer_email';
    end if;
    v_link := private.issue_secure_link(p_org_id, 'client_consent', 'client_consent_signer', v_signer_id,
                                        case when v_i = 1 then p_token_hash_1 else p_token_hash_2 end, p_actor, null, '{}');
    select l.expires_at into v_expires from public.secure_links l where l.id = v_link;
    update public.client_consent_request_signers s set link_id = v_link, last_sent_at = pg_catalog.now()
     where s.id = v_signer_id;
    v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', (select s.role from public.client_consent_request_signers s where s.id = v_signer_id),
      'signer_id', v_signer_id,
      'first_name', v_person.first_name,
      'full_name', v_person.first_name || ' ' || v_person.last_name,
      'email', v_person.email,
      'link_id', v_link));
  end loop;

  -- CC-22: who countersigns, for the answer and the staff screen. Her `last_sent_at` is stamped
  -- too, so « Demandé le » reads the same for every signer of the request.
  update public.client_consent_request_signers s set last_sent_at = pg_catalog.now()
   where s.request_id = v_req.id and s.role = 'professional';
  select pg_catalog.jsonb_build_object('professional_id', p.id, 'signer_id', s.id,
                                       'full_name', p.first_name || ' ' || p.last_name, 'email', p.email)
    into v_pro
    from public.client_consent_request_signers s
    join public.professionals p on p.org_id = s.org_id and p.id = s.signer_professional_id
   where s.request_id = v_req.id and s.role = 'professional';

  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'request_id', v_req.id,
    'resent', v_resent,
    'language', v_req.language,
    'consent_name', case when v_req.language = 'en' then v_type.name_en else v_type.name_fr end,
    'client_first_name', v_client.first_name,
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'expires_at', v_expires,
    'signers', v_out,
    'professional', v_pro);
end;
$$;

-- -----------------------------------------------------------------------------
-- The public page: the envelope carries the professional too
-- -----------------------------------------------------------------------------
-- Latest body: 20261014042305_clients_imports_security_fixes.sql. Same signature (grants kept).
-- Changes: the Documenso signers now include the `professional` (order 3, her name and address
-- from `professionals`), the rendered values gain `professional.full_name`, and the signer
-- comparison keys on `private.clients_consent_signer_key` so a professional signer (whose
-- `signer_client_id` is null) does not look like a change on every open.
create or replace function public.start_client_consent_signing_for_service(
  p_token_hash bytea,
  p_first_name text,
  p_birth_year int,
  p_answers jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
  v_req public.client_consent_requests%rowtype;
  v_client public.clients%rowtype;
  v_clause jsonb;
  v_answer text;
  v_sig record;
  v_signers jsonb;
  v_tz text;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  select * into v_link from private.clients_consent_link(p_token_hash);
  if v_link.link_id is null or not public.module_open_to_all_for_org(v_link.org_id, 'clients') then
    return '{"state": "invalid"}'::jsonb;
  end if;
  if not private.clients_consent_identity_ok(v_link.org_id, v_link.request_id, p_first_name, p_birth_year) then
    return private.clients_consent_identity_failed(v_link.org_id, v_link.signer_id);
  end if;
  select * into v_req from public.client_consent_requests r where r.id = v_link.request_id for update;

  if v_req.answers is null then
    if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'object' then
      raise exception 'Répondez à chaque question avant de signer.' using errcode = 'P0001', hint = 'answers';
    end if;
    for v_clause in select c from pg_catalog.jsonb_array_elements(v_req.clauses) c loop
      v_answer := p_answers ->> (v_clause ->> 'key');
      if v_answer is null or v_answer not in ('yes', 'no') then
        raise exception 'Répondez à chaque question avant de signer.' using errcode = 'P0001', hint = 'answers';
      end if;
      if v_clause ->> 'kind' = 'agree' and v_answer <> 'yes' then
        raise exception 'Pour signer ce consentement, vous devez accepter chaque clause marquée « Accord requis ».'
          using errcode = 'P0001', hint = 'answers';
      end if;
    end loop;
    if exists (select 1 from pg_catalog.jsonb_object_keys(p_answers) k
                where not exists (select 1 from pg_catalog.jsonb_array_elements(v_req.clauses) c where c ->> 'key' = k)) then
      raise exception 'Invalid answers' using errcode = '22023';
    end if;
    update public.client_consent_requests r set answers = p_answers, answered_at = pg_catalog.now()
     where r.id = v_req.id returning * into v_req;
  end if;

  -- An envelope already out: this signer resumes it.
  if not exists (select 1 from public.signature_requests s
                  where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                    and s.subject_id = v_req.id and s.status in ('draft', 'sent', 'viewed')) then
    -- Before any envelope: the signers must still be the ones the rules name (R-48, CC-22), else
    -- the links are revoked and the clinic sends again; the text is the one published now.
    begin
      v_signers := private.clients_consent_signers(v_req.org_id, v_req.client_id);
    exception when others then
      v_signers := '[]'::jsonb;
    end;
    if pg_catalog.jsonb_array_length(v_signers)
         <> (select pg_catalog.count(*) from public.client_consent_request_signers x where x.request_id = v_req.id)
       or exists (select 1 from public.client_consent_request_signers x
                   where x.request_id = v_req.id
                     and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                      where s ->> 'role' = x.role
                                        and private.clients_consent_signer_key((s ->> 'signer_client_id')::uuid,
                                                                               (s ->> 'signer_professional_id')::uuid)
                                            = private.clients_consent_signer_key(x.signer_client_id, x.signer_professional_id))) then
      perform private.clients_consent_close_links(v_req.org_id, v_req.id, null);
      return '{"state": "invalid"}'::jsonb;
    end if;
    update public.client_consent_requests r
       set template_version_id = v.id
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where r.id = v_req.id and t.org_id = r.org_id
       and t.key = 'clients.consent_' || r.consent_key || '_' || r.language
       and r.template_version_id <> v.id
    returning r.* into v_req;
    if v_req.id is null then
      select * into v_req from public.client_consent_requests r where r.id = v_link.request_id;
    end if;
  end if;
  select s.id, s.envelope_id, x.documenso_recipient_id into v_sig
    from public.signature_requests s
    join public.signature_request_signers x on x.request_id = s.id and x.role = v_link.role
   where s.org_id = v_req.org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
     and s.subject_id = v_req.id and s.status in ('sent', 'viewed')
   order by s.created_at desc limit 1;
  if v_sig.id is not null and v_sig.envelope_id is not null and v_sig.documenso_recipient_id is not null then
    return pg_catalog.jsonb_build_object('state', 'resume', 'org_id', v_req.org_id, 'request_id', v_sig.id,
                                         'envelope_id', v_sig.envelope_id, 'recipient_id', v_sig.documenso_recipient_id);
  end if;

  select * into v_client from public.clients c where c.id = v_req.client_id;
  select o.timezone into v_tz from public.organizations o where o.id = v_req.org_id;
  -- The client side from `clients`, the professional from `professionals`: orders 1, 2 and 3
  -- (PARALLEL signing, so the order never gates anyone).
  select pg_catalog.jsonb_agg(x.signer order by x.ord) into v_signers
    from (select pg_catalog.jsonb_build_object(
                   'role', s.role, 'name', c.first_name || ' ' || c.last_name, 'email', c.email,
                   'order', case when s.role = 'client' then 1 else 2 end) as signer,
                 case when s.role = 'client' then 1 else 2 end as ord
            from public.client_consent_request_signers s
            join public.clients c on c.id = s.signer_client_id and c.org_id = s.org_id
           where s.request_id = v_req.id and s.role in ('client', 'client_2')
          union all
          select pg_catalog.jsonb_build_object(
                   'role', 'professional', 'name', p.first_name || ' ' || p.last_name, 'email', p.email,
                   'order', 3) as signer,
                 3 as ord
            from public.client_consent_request_signers s
            join public.professionals p on p.id = s.signer_professional_id and p.org_id = s.org_id
           where s.request_id = v_req.id and s.role = 'professional') x;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'email' is null) then
    raise exception 'La personne qui doit signer n''a pas d''adresse courriel : communiquez avec la clinique.'
      using errcode = 'P0001', hint = 'signer_email';
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'prepared',
    'org_id', v_req.org_id,
    'consent_request_id', v_req.id,
    'role', v_link.role,
    'template_version_id', v_req.template_version_id,
    'title', (select case when v_req.language = 'en' then t.name_en else t.name_fr end
                from public.client_consent_types t where t.org_id = v_req.org_id and t.key = v_req.consent_key)
             || ' — ' || v_client.first_name || ' ' || v_client.last_name,
    'values', pg_catalog.jsonb_build_object(
      'client', pg_catalog.jsonb_build_object('full_name', v_client.first_name || ' ' || v_client.last_name,
                                              'first_name', v_client.first_name),
      'signer', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'client')),
      'signer_2', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'client_2')),
      'professional', pg_catalog.jsonb_build_object('full_name', (select s ->> 'name' from pg_catalog.jsonb_array_elements(v_signers) s where s ->> 'role' = 'professional')),
      'today', (pg_catalog.now() at time zone v_tz)::date),
    'signers', v_signers,
    'clauses', v_req.clauses,
    'answers', v_req.answers,
    'language', v_req.language,
    'sent_by', v_req.requested_by,
    'idempotency_key', 'client-consent:' || v_req.id::text || ':' || p_idempotency_key);
end;
$$;

-- -----------------------------------------------------------------------------
-- The professional's side: what waits for her, and resuming her own signature
-- -----------------------------------------------------------------------------
-- What this professional still has to countersign (`clients.self`, her own files only, through
-- her signer rows). `state`: `waiting_client` (the client has not answered and signed yet, so
-- there is no envelope), `ready` (she can sign now), `signed` (done, the request still open for
-- someone else). Names only: she already reads her own clients' names through `my_clients`.
create function public.my_client_consent_signatures()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pro uuid;
begin
  if v_org is null or not private.has_permission('clients.self') then
    raise exception 'Permission refusée : clients.self' using errcode = '42501';
  end if;
  if not public.module_enabled_for_org(v_org, 'clients') then
    raise exception 'Module disabled' using errcode = '22023';
  end if;
  v_pro := private.current_professional_id();
  if v_pro is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'request_id', r.id,
             'consent_key', r.consent_key,
             'consent_name', case when r.language = 'en' then ct.name_en else ct.name_fr end,
             'language', r.language,
             'client_id', c.id,
             'client_name', c.first_name || ' ' || c.last_name,
             'due_at', r.due_at,
             'requested_at', s.last_sent_at,
             'state', case when x.status = 'signed' then 'signed'
                           when x.documenso_recipient_id is not null then 'ready'
                           else 'waiting_client' end)
           order by r.due_at asc nulls last, r.created_at asc)
      from public.client_consent_request_signers s
      join public.client_consent_requests r on r.id = s.request_id and r.org_id = s.org_id
      join public.clients c on c.id = r.client_id and c.org_id = r.org_id
      join public.client_consent_types ct on ct.org_id = r.org_id and ct.key = r.consent_key
      left join lateral (select sr.id from public.signature_requests sr
                          where sr.org_id = r.org_id and sr.purpose = 'clients.consent'
                            and sr.subject_type = 'client_consent_request' and sr.subject_id = r.id
                            and sr.status in ('sent', 'viewed')
                          order by sr.created_at desc limit 1) sr on true
      left join public.signature_request_signers x on x.request_id = sr.id and x.role = 'professional'
     where s.org_id = v_org and s.role = 'professional' and s.signer_professional_id = v_pro
       and r.state = 'pending'), '[]'::jsonb);
end;
$$;
revoke all on function public.my_client_consent_signatures() from public, anon;
grant execute on function public.my_client_consent_signatures() to authenticated;

-- The professional resumes her own signature on a client consent: her signing token comes from
-- the envelope already out, so this never creates one and never renders (CC-22). Returns
-- { state: 'waiting' } while the client has not signed, else
-- { state: 'resume', org_id, request_id, envelope_id, recipient_id }.
-- Refusals (P0001, French, HINT): `professional`, `request`, `state`, `signed`.
create function public.prepare_my_client_consent_signature_for_service(
  p_org_id uuid,
  p_actor uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro uuid;
  v_req public.client_consent_requests%rowtype;
  v_sig record;
begin
  if p_org_id is null or p_actor is null or p_request_id is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'clients') then
    raise exception 'Module disabled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active')
     or not ('clients.self' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : clients.self' using errcode = '42501';
  end if;
  select p.id into v_pro from public.professionals p where p.profile_id = p_actor and p.org_id = p_org_id;
  if v_pro is null then
    raise exception 'Votre compte n''est pas lié à un dossier de professionnel.'
      using errcode = 'P0001', hint = 'professional';
  end if;
  -- Her own signer row on this request, or nothing: a professional never reaches another's.
  select r.* into v_req from public.client_consent_requests r
    join public.client_consent_request_signers s
      on s.request_id = r.id and s.org_id = r.org_id and s.role = 'professional' and s.signer_professional_id = v_pro
   where r.org_id = p_org_id and r.id = p_request_id;
  if v_req.id is null then
    raise exception 'Ce consentement ne vous attend pas.' using errcode = 'P0001', hint = 'request';
  end if;
  if v_req.state <> 'pending' then
    raise exception 'Cette demande de consentement n''est plus en attente.' using errcode = 'P0001', hint = 'state';
  end if;
  select s.id, s.envelope_id, x.documenso_recipient_id, x.status into v_sig
    from public.signature_requests s
    join public.signature_request_signers x on x.request_id = s.id and x.role = 'professional'
   where s.org_id = p_org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
     and s.subject_id = v_req.id and s.status in ('sent', 'viewed')
   order by s.created_at desc limit 1;
  if v_sig.id is null or v_sig.envelope_id is null or v_sig.documenso_recipient_id is null then
    -- CC-22: the client answers the clauses and signs first; there is nothing to countersign yet.
    return pg_catalog.jsonb_build_object('state', 'waiting');
  end if;
  if v_sig.status = 'signed' then
    raise exception 'Vous avez déjà signé ce consentement.' using errcode = 'P0001', hint = 'signed';
  end if;
  return pg_catalog.jsonb_build_object('state', 'resume', 'org_id', p_org_id, 'request_id', v_sig.id,
                                       'envelope_id', v_sig.envelope_id, 'recipient_id', v_sig.documenso_recipient_id);
end;
$$;
revoke all on function public.prepare_my_client_consent_signature_for_service(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_my_client_consent_signature_for_service(uuid, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- The templates: a third signature box
-- -----------------------------------------------------------------------------
-- Latest body: 20261013020447_clients_consents.sql. A fresh seed (a new org, `db:reset`) now
-- draws the professional's box; the drafts already seeded are updated just below.
create or replace function private.clients_consent_template(p_name text, p_lang text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_lang = 'en' then pg_catalog.jsonb_build_object(
    'body', pg_catalog.jsonb_build_object(
      'title', p_name,
      'footer', pg_catalog.jsonb_build_object('text', '{{clinic.name}} — ' || p_name),
      'blocks', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Texte provisoire — Provisional text, to be approved by the clinic''s management before publication.', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 1, 'text', p_name),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Client: '),
          pg_catalog.jsonb_build_object('text', '{{client.full_name}}', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'This provisional text stands in for the consent of {{clinic.name}}. It will be replaced by the approved text.'))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 2, 'text', 'Your answers'),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', '{{consent.clauses}}'))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Signed on {{today}} for {{client.full_name}}.'))),
        pg_catalog.jsonb_build_object('type', 'signaturePage', 'signers', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('role', 'client', 'label', '{{signer.full_name}}'),
          pg_catalog.jsonb_build_object('role', 'client_2', 'label', '{{signer_2.full_name}}'),
          pg_catalog.jsonb_build_object('role', 'professional', 'label', '{{professional.full_name}}'))))),
    'email_subject', p_name || ' — {{clinic.name}}',
    'email_message', '')
  else pg_catalog.jsonb_build_object(
    'body', pg_catalog.jsonb_build_object(
      'title', p_name,
      'footer', pg_catalog.jsonb_build_object('text', '{{clinic.name}} — ' || p_name),
      'blocks', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Texte provisoire — à faire valider par la direction avant publication.', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 1, 'text', p_name),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Client : '),
          pg_catalog.jsonb_build_object('text', '{{client.full_name}}', 'bold', true))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Ce texte provisoire tient la place du consentement de {{clinic.name}}. Il sera remplacé par le texte validé par la direction.'))),
        pg_catalog.jsonb_build_object('type', 'heading', 'level', 2, 'text', 'Vos réponses'),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', '{{consent.clauses}}'))),
        pg_catalog.jsonb_build_object('type', 'paragraph', 'runs', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'Signé le {{today}} pour {{client.full_name}}.'))),
        pg_catalog.jsonb_build_object('type', 'signaturePage', 'signers', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('role', 'client', 'label', '{{signer.full_name}}'),
          pg_catalog.jsonb_build_object('role', 'client_2', 'label', '{{signer_2.full_name}}'),
          pg_catalog.jsonb_build_object('role', 'professional', 'label', '{{professional.full_name}}'))))),
    'email_subject', p_name || ' — {{clinic.name}}',
    'email_message', '')
  end
  || pg_catalog.jsonb_build_object(
    'variables', $vars$[
      {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
      {"path": "client.full_name", "label": "Nom du client", "sample": "Camille Exemple", "required": true, "kind": "text"},
      {"path": "client.first_name", "label": "Prénom du client", "sample": "Camille", "required": true, "kind": "text"},
      {"path": "signer.full_name", "label": "Nom de la personne qui signe", "sample": "Camille Exemple", "required": true, "kind": "text"},
      {"path": "signer_2.full_name", "label": "Nom du deuxième parent (garde partagée)", "sample": "Alex Exemple", "required": false, "kind": "text"},
      {"path": "professional.full_name", "label": "Nom du professionnel attitré", "sample": "Dominique Exemple", "required": true, "kind": "text"},
      {"path": "consent.clauses", "label": "Réponses aux clauses (Oui / Non)", "sample": "Oui", "required": false, "kind": "text"},
      {"path": "today", "label": "Date du jour", "sample": "2026-10-12", "required": true, "kind": "date"}
    ]$vars$::jsonb,
    'signers', $signers$[
      {"role": "client", "label": "Client, ou parent ou tuteur", "order": 1, "required": true},
      {"role": "client_2", "label": "Deuxième parent (garde partagée)", "order": 2, "required": false},
      {"role": "professional", "label": "Professionnel attitré au dossier", "order": 3, "required": true}
    ]$signers$::jsonb)
$$;

-- The drafts already seeded: add the professional's box, variable and signer where they are
-- missing. Only DRAFT versions of `clients.consent_*`, and only the missing pieces, so a text
-- already being written keeps every edit.
do $do$
declare
  v_row record;
  v_blocks jsonb;
begin
  for v_row in
    select v.id, v.body, v.variables, v.signers
      from public.document_template_versions v
      join public.document_templates t on t.id = v.template_id
     where t.module_key = 'clients' and t.key ~ '^clients\.consent_' and v.status = 'draft'
  loop
    if not exists (select 1 from pg_catalog.jsonb_array_elements(v_row.signers) s where s ->> 'role' = 'professional') then
      update public.document_template_versions
         set signers = v_row.signers || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
               'role', 'professional', 'label', 'Professionnel attitré au dossier', 'order', 3, 'required', true))
       where id = v_row.id;
    end if;
    if not exists (select 1 from pg_catalog.jsonb_array_elements(v_row.variables) x
                    where x ->> 'path' = 'professional.full_name') then
      update public.document_template_versions
         set variables = v_row.variables || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
               'path', 'professional.full_name', 'label', 'Nom du professionnel attitré',
               'sample', 'Dominique Exemple', 'required', true, 'kind', 'text'))
       where id = v_row.id;
    end if;
    select pg_catalog.jsonb_agg(
             case when b.value ->> 'type' = 'signaturePage'
                   and not exists (select 1 from pg_catalog.jsonb_array_elements(b.value -> 'signers') s
                                    where s ->> 'role' = 'professional')
                  then pg_catalog.jsonb_set(b.value, '{signers}',
                         (b.value -> 'signers') || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                           'role', 'professional', 'label', '{{professional.full_name}}')))
                  else b.value end
             order by b.ordinality)
      into v_blocks
      from pg_catalog.jsonb_array_elements(v_row.body -> 'blocks') with ordinality b;
    if v_blocks is not null and v_blocks <> (v_row.body -> 'blocks') then
      update public.document_template_versions
         set body = pg_catalog.jsonb_set(v_row.body, '{blocks}', v_blocks)
       where id = v_row.id;
    end if;
  end loop;
end
$do$;

select pg_catalog.set_config('app.audit_source', '', true);
