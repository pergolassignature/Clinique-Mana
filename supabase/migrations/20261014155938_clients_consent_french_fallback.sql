-- =============================================================================
-- Clients: consents in French only (decision R-75)
-- =============================================================================
-- Decision: R-75 (decisions log, « Christine's answers, second series »; Jonathan, 2026-10-14:
--           « il n'y a rien en anglais »). Default for the fallback: révisable.
-- Source:   docs/research/2026-10-14-christine-answers-suite.md (« Consentements »)
--
-- The clinic has no English consent texts for now. `prepare_client_consent_request_for_service`
-- (every send: « Envoyer », Demandes and Rendez-vous through `clients-consent-send`, the
-- re-signature campaign, the reminders) refused a client whose language had no published text
-- (HINT `template`). Now:
-- * the text published in the client's language is used when there is one (unchanged);
-- * else the **published French text**, and the request records the language actually used
--   (`client_consent_requests.language = 'fr'`): the email, the consent's name, the public page,
--   the clauses and the signed consent (`client_consents.language`) are French with it;
-- * neither published: refused as before (HINT `template`), the message naming the French text.
-- A re-send keeps the request's language; a pending request is never switched to a text
-- published later (« Signer » prints the newest version of the request's own language,
-- `start_client_consent_signing_for_service`, unchanged).
-- Nothing else changes: the campaign (`start_client_consent_campaign`) and the rules
-- (`set_client_consent_rule`) already accept a text published in either language.
-- Replaced with the same signature (grants kept).
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_french_fallback', true);

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
      insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, relation_id)
      values (p_org_id, v_req.id, v_signer ->> 'role', (v_signer ->> 'signer_client_id')::uuid, (v_signer ->> 'relation_id')::uuid);
    end loop;
  else
    v_resent := true;
    -- Who signs may have changed since (a right removed, a relation deleted, a birthday, the
    -- custody): without an envelope out, the signers are rebuilt and the former ones' links
    -- revoked; with one out, the signature runs to its end with its signers.
    if not exists (select 1 from public.signature_requests s
                    where s.org_id = p_org_id and s.purpose = 'clients.consent' and s.subject_type = 'client_consent_request'
                      and s.subject_id = v_req.id and s.status in ('draft', 'sent', 'viewed')) then
      v_signers := private.clients_consent_signers(p_org_id, v_req.client_id);
      if exists (select 1 from public.client_consent_request_signers x
                  where x.request_id = v_req.id
                    and not exists (select 1 from pg_catalog.jsonb_array_elements(v_signers) s
                                     where s ->> 'role' = x.role and (s ->> 'signer_client_id')::uuid = x.signer_client_id))
         or pg_catalog.jsonb_array_length(v_signers)
            <> (select pg_catalog.count(*) from public.client_consent_request_signers x where x.request_id = v_req.id) then
        perform private.clients_consent_close_links(p_org_id, v_req.id, p_actor);
        delete from public.client_consent_request_signers x where x.request_id = v_req.id;
        for v_signer in select s from pg_catalog.jsonb_array_elements(v_signers) s loop
          insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, relation_id)
          values (p_org_id, v_req.id, v_signer ->> 'role', (v_signer ->> 'signer_client_id')::uuid, (v_signer ->> 'relation_id')::uuid);
        end loop;
      end if;
    end if;
    update public.client_consent_requests r
       set last_sent_at = pg_catalog.now(),
           reminded_at = case when p_actor is null then pg_catalog.now() else r.reminded_at end,
           due_at = coalesce(p_due_at, r.due_at)
     where r.id = v_req.id;
  end if;

  for v_signer_id in
    select s.id from public.client_consent_request_signers s where s.request_id = v_req.id order by s.role
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

  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return pg_catalog.jsonb_build_object(
    'request_id', v_req.id,
    'resent', v_resent,
    'language', v_req.language,
    'consent_name', case when v_req.language = 'en' then v_type.name_en else v_type.name_fr end,
    'client_first_name', v_client.first_name,
    'clinic_name', (select o.name from public.organizations o where o.id = p_org_id),
    'expires_at', v_expires,
    'signers', v_out);
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
