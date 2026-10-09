-- =============================================================================
-- Professionnels: the image consent sent through Documenso (template, send, card, completion)
-- =============================================================================
-- Asked:   Jonathan, 2026-10-09: « Consentement droit à l'image », a second form made in
--          Paramètres and sent through Documenso, with the old app's text.
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md, decisions P4-480 … P4-489
-- Needs:   Phase 3 signing (…_core_signing.sql, …_core_signing_function_support.sql,
--          …_core_signing_envelope.sql), the documents of 4c (…_professionals_documents.sql) and
--          the service contract of 4d (…_professionals_contracts.sql: its snapshot table, its
--          history)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The template (P4-480): one `professionals.image_consent` « Consentement au droit à l'image » per
--   clinic (view professionals.view, edit professionals.settings), a DRAFT version 1 built from the
--   legacy questionnaire's consent v1 (_legacy/src/pages/invite.tsx, CONSENT_TEXT: « Formulaire de
--   consentement au droit à l'image », sections 1–5, 12 months renewed automatically, 3 months'
--   notice), « Clinique MANA » replaced by {{clinic.name}}, the signer named by
--   {{professional.full_name}}, its first line « Texte à faire valider par la direction avant
--   publication ». The professional is the only signer, as in the legacy app (no clinic
--   signature), and initials nothing (a short form). Nothing is published (Mise en service).
--   Seeded like the contract: directly, for every clinic and by a trigger for new ones.
-- * prepare_professional_image_consent (SERVICE ROLE, p_actor, called by
--   professionals-contract-send with `form: image_consent`, P4-482): the contract's flow without
--   Annexe A or pay, so its own RPC rather than a branch in prepare_professional_contract. The
--   actor needs professionals.manage (P4-483: not a pay document, so no .compensation and no
--   .contracts.send); one consent out at a time per file (send, resend, regenerate as the
--   contract); a signed consent may be sent again (a renewal, P4-485), unlike the contract. The
--   snapshot reuses professional_contract_snapshots (« what a request prints », per key: values,
--   signers, the version; annexe '{}').
-- * Requests carry view_permission professionals.view (P4-483): the PDF holds no pay, so every
--   reader of the file reads the request, its signed PDF and « Synchroniser ».
-- * The signed consent becomes a document (P4-484): an AFTER UPDATE OF status trigger on core's
--   signature_requests (as profiles_sync_professional_email on profiles) creates, when a request of
--   purpose professionals.image_consent becomes signed, a VERIFIED « Consentement droit à
--   l'image » professional_documents row on the signed PDF that core's capture stored
--   (signed_file_id), its last valid day by the type's rule from the clinic date of the
--   professional's signature (months_12: + 12 months, as the e-consent), and makes the file the
--   professional's (owner branch, as attach_professional_document) so « Mes documents » opens it.
--   So readiness (documents, consent_ok), the Documents tab, « Mes documents », the list and the
--   directory read it as they read any document: one rule everywhere. No reminder (P4-402: the
--   insurance's only). The hook never fails core's completion: an error is a warning and the
--   consent can still be uploaded by hand.
-- * A signed consent's document is never refused (its file is the signature's own copy:
--   reject_professional_document refuses it, HINT status) and deleting it keeps the file
--   (delete_professional_document soft-deletes only uploaded files); get_professional_documents
--   says which documents came from a signature (`signature_request_id`).
-- * The questionnaire's e-consent stays (P4-486): both satisfy consent_ok. The questionnaire
--   collects the first consent of a new professional; Documenso serves the files that never fill
--   one (the imported professionals) and the renewal every 12 months.
-- * History: list_professional_history also returns the consent's status moves, and every
--   signature row names its purpose (`purpose` beside a signer's `role`), so the page words each.
-- * Every statement is scoped to the actor's or the caller's clinic; messages never repeat a value.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_image_consent', true);

-- -----------------------------------------------------------------------------
-- The template « Consentement au droit à l'image » (a draft per clinic; nothing published)
-- -----------------------------------------------------------------------------
-- Version 1's content (a PdfDocument, supabase/functions/_shared/pdf/model.ts), its variables,
-- signer and Documenso invitation. One copy, read by the seed below and by the function's test
-- (professionals-contract-send/consent-template.test.ts reads this file).
create function private.professionals_image_consent_template()
returns jsonb
language sql
immutable
set search_path = ''
as $tpl$
  select $json${
  "body": {
    "title": "Consentement au droit à l’image",
    "header": {"text": "Consentement au droit à l’image"},
    "footer": {"text": "Formulaire de consentement au droit à l’image"},
    "blocks": [
      {"type": "paragraph", "runs": [{"text": "Texte à faire valider par la direction avant publication", "bold": true}]},
      {"type": "heading", "level": 1, "text": "Formulaire de consentement au droit à l’image"},
      {"type": "paragraph", "runs": [{"text": "Je, soussigné(e), "}, {"text": "{{professional.full_name}}", "bold": true}, {"text": ", consens à ce qui suit."}]},
      {"type": "heading", "level": 2, "text": "1. Objet"},
      {"type": "paragraph", "runs": [{"text": "Par la présente, j’autorise {{clinic.name}} à utiliser ma photo professionnelle à des fins de présentation de mon profil sur le site web et les supports de communication de la clinique."}]},
      {"type": "heading", "level": 2, "text": "2. Utilisation autorisée"},
      {"type": "paragraph", "runs": [{"text": "J’accepte que ma photo soit utilisée pour :"}]},
      {"type": "list", "ordered": false, "items": [
        [{"text": "Mon profil professionnel sur le site web de {{clinic.name}}"}],
        [{"text": "La fiche professionnelle qui me sera attribuée"}],
        [{"text": "Les communications internes de la clinique"}]
      ]},
      {"type": "heading", "level": 2, "text": "3. Durée"},
      {"type": "paragraph", "runs": [{"text": "Ce consentement est valide pour une période de "}, {"text": "12 mois", "bold": true}, {"text": " à compter de la date de signature et sera "}, {"text": "renouvelé automatiquement", "bold": true}, {"text": " pour des périodes successives de 12 mois, sauf retrait de ma part."}]},
      {"type": "heading", "level": 2, "text": "4. Droit de retrait"},
      {"type": "paragraph", "runs": [{"text": "Je comprends que je peux retirer mon consentement à tout moment en envoyant un préavis écrit de "}, {"text": "3 mois", "bold": true}, {"text": " à l’administration de {{clinic.name}}."}]},
      {"type": "heading", "level": 2, "text": "5. Protection des données"},
      {"type": "paragraph", "runs": [{"text": "Ma photo sera traitée conformément à la politique de confidentialité de {{clinic.name}} et ne sera jamais vendue à des tiers."}]},
      {"type": "paragraph", "runs": [{"text": "Je signe le présent formulaire électroniquement. Formulaire préparé le {{today}}."}]},
      {"type": "signaturePage", "signers": [{"role": "professional", "label": "Le Professionnel : {{professional.full_name}}"}]}
    ]
  },
  "variables": [
    {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
    {"path": "professional.full_name", "label": "Nom du professionnel", "sample": "Camille Exemple", "required": true, "kind": "text"},
    {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Camille", "required": true, "kind": "text"},
    {"path": "today", "label": "Date du jour", "sample": "2026-10-09", "required": true, "kind": "date"}
  ],
  "signers": [{"role": "professional", "label": "Professionnel", "order": 1, "required": true}],
  "email_subject": "Votre consentement au droit à l’image pour {{clinic.name}}",
  "email_message": "Bonjour {{professional.first_name}},\n\nVoici le formulaire de consentement au droit à l’image de {{clinic.name}} : il autorise la clinique à utiliser votre photo professionnelle sur son site web, sur votre fiche et dans ses communications internes. Prenez le temps de le lire, puis signez-le.\n\nPour toute question, communiquez avec la clinique.\n\nMerci!"
}$json$::jsonb
$tpl$;
revoke all on function private.professionals_image_consent_template() from public, anon, authenticated, service_role;

create function private.seed_professionals_image_consent_template(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_template uuid;
  v_content jsonb := private.professionals_image_consent_template();
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_image_consent', true);
  insert into public.document_templates as t
    (org_id, key, module_key, title, description, view_permission, edit_permission)
  values
    (p_org, 'professionals.image_consent', 'professionals', 'Consentement au droit à l''image',
     'Formulaire de consentement au droit à l''image envoyé au professionnel pour signature électronique.',
     'professionals.view', 'professionals.settings')
  on conflict (org_id, key) do nothing
  returning t.id into v_template;
  -- A clinic that already has the template keeps it as it is.
  if v_template is not null then
    insert into public.document_template_versions
      (template_id, org_id, version, body, variables, signers, email_subject, email_message)
    values
      (v_template, p_org, 1, v_content -> 'body', v_content -> 'variables', v_content -> 'signers',
       v_content ->> 'email_subject', v_content ->> 'email_message');
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_image_consent_template_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_image_consent_template(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_image_consent
  after insert on public.organizations
  for each row execute function private.seed_professionals_image_consent_template_on_org();

revoke all on function private.seed_professionals_image_consent_template(uuid),
                       private.seed_professionals_image_consent_template_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (staging).
select private.seed_professionals_image_consent_template(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- What a consent prints (granted to no role; prepare_professional_image_consent calls it)
-- -----------------------------------------------------------------------------
-- {title, values, signers} for p_id of p_org: values professional {full_name, first_name, email
-- (the file's address: the login's once linked)}, today (the clinic's date); the professional as
-- the only signer. « Professionnel introuvable. » (P0001) otherwise.
create function private.professional_image_consent_terms(p_org uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pro public.professionals;
  v_tz text;
  v_name text;
begin
  select * into v_pro from public.professionals p where p.id = p_id and p.org_id = p_org;
  select o.timezone into v_tz from public.organizations o where o.id = p_org;
  if v_pro.id is null or v_tz is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  v_name := v_pro.first_name || ' ' || v_pro.last_name;
  return pg_catalog.jsonb_build_object(
    'title', 'Consentement au droit à l''image — ' || v_name,
    'values', pg_catalog.jsonb_build_object(
      'professional', pg_catalog.jsonb_build_object('full_name', v_name, 'first_name', v_pro.first_name, 'email', v_pro.email),
      'today', (pg_catalog.now() at time zone v_tz)::date),
    'signers', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'professional', 'name', v_name, 'email', v_pro.email, 'order', 1)));
end;
$$;
revoke all on function private.professional_image_consent_terms(uuid, uuid) from public, anon, authenticated, service_role;

-- Every required variable of the version has a value (a non-blank string or a number, as the
-- filler's formatValue) in p_values with the clinic's identity over them, as
-- createSignatureRequest fills them; else a refusal naming the variable's French label, never a
-- value: « <p_document> ne peut pas être préparé : « … » est vide. … » (HINT values). The second
-- half of private.professional_contract_check, without Annexe A.
create function private.professional_signing_values_check(p_org uuid, p_version uuid, p_values jsonb, p_document text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_variables jsonb;
  v_all jsonb;
  v_label text;
begin
  select v.variables into v_variables
    from public.document_template_versions v where v.id = p_version and v.org_id = p_org;
  select coalesce(p_values, '{}'::jsonb) || pg_catalog.jsonb_build_object('clinic', pg_catalog.jsonb_build_object(
           'name', o.name, 'legal_name', o.legal_name, 'address_line1', o.address_line1,
           'address_line2', o.address_line2, 'city', o.city, 'province', o.province,
           'postal_code', o.postal_code, 'phone', o.phone, 'email', o.email, 'website', o.website,
           'signatory_name', o.signatory_name, 'signatory_title', o.signatory_title,
           'signatory_email', o.signatory_email))
    into v_all
    from public.organizations o where o.id = p_org;
  select x.v ->> 'label' into v_label
    from pg_catalog.jsonb_array_elements(coalesce(v_variables, '[]'::jsonb)) with ordinality as x(v, ord)
   cross join lateral (select v_all #> pg_catalog.string_to_array(x.v ->> 'path', '.') as value) val
   where coalesce((x.v ->> 'required')::boolean, false)
     and not coalesce(pg_catalog.jsonb_typeof(val.value) = 'number'
                      or (pg_catalog.jsonb_typeof(val.value) = 'string' and (val.value #>> '{}') ~ '\S'), false)
   order by x.ord
   limit 1;
  if v_label is not null then
    raise exception '% ne peut pas être préparé : « % » est vide. Complétez le dossier ou les paramètres, puis réessayez.', p_document, v_label
      using errcode = 'P0001', hint = 'values';
  end if;
end;
$$;
revoke all on function private.professional_signing_values_check(uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- What a request prints, once per key (shared by the staff's send and the professional's own)
-- -----------------------------------------------------------------------------
-- The snapshot of p_key (first write wins, P4-151): an existing one is re-checked (its version still
-- published, else p_changed_message, HINT regenerate; its values still complete), else the
-- published version, the file's values and its signer are written, under p_actor. Returns
-- {idempotency_key, template_version_id, title, values, signers}. Refused: no published template
-- (HINT template), an empty required value (HINT values).
create function private.professional_image_consent_snapshot(p_org uuid, p_pid uuid, p_key text, p_actor uuid, p_changed_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot public.professional_contract_snapshots;
  v_version uuid;
  v_terms jsonb;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  select * into v_snapshot from public.professional_contract_snapshots s
   where s.org_id = p_org and s.idempotency_key = p_key;
  if v_snapshot.id is not null then
    if not exists (select 1 from public.document_template_versions v
                    join public.document_templates t on t.id = v.template_id
                   where v.id = v_snapshot.template_version_id and v.status = 'published' and t.is_active) then
      raise exception '%', p_changed_message using errcode = 'P0001', hint = 'regenerate';
    end if;
    perform private.professional_signing_values_check(p_org, v_snapshot.template_version_id, v_snapshot.template_values, 'Le consentement');
  else
    v_version := private.published_image_consent_version(p_org);
    if v_version is null then
      raise exception 'Aucun modèle de consentement publié. Publiez « Consentement au droit à l''image » dans Paramètres → Contrats et formulaires.'
        using errcode = 'P0001', hint = 'template';
    end if;
    v_terms := private.professional_image_consent_terms(p_org, p_pid);
    perform private.professional_signing_values_check(p_org, v_version, v_terms -> 'values', 'Le consentement');

    perform pg_catalog.set_config('app.audit_source', 'rpc:prepare_professional_image_consent', true);
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
    insert into public.professional_contract_snapshots as s
      (org_id, professional_id, idempotency_key, template_version_id, title, template_values, annexe, signers, created_by)
    values
      (p_org, p_pid, p_key, v_version, v_terms ->> 'title', v_terms -> 'values', '{}'::jsonb, v_terms -> 'signers', p_actor)
    returning * into v_snapshot;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
    perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  end if;
  return pg_catalog.jsonb_build_object(
    'idempotency_key', v_snapshot.idempotency_key,
    'template_version_id', v_snapshot.template_version_id,
    'title', v_snapshot.title,
    'values', v_snapshot.template_values,
    'signers', v_snapshot.signers);
end;
$$;
revoke all on function private.professional_image_consent_snapshot(uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;

-- The published version of the clinic's « Consentement au droit à l'image », or null.
create function private.published_image_consent_version(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id
    from public.document_templates t
    join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
   where t.org_id = p_org and t.key = 'professionals.image_consent' and t.is_active
$$;
revoke all on function private.published_image_consent_version(uuid) from public, anon, authenticated, service_role;

-- The last day the professional's image consent is in force on the clinic's today: a verified
-- « Consentement droit à l'image » document (no end date: 2100-12-31) or the questionnaire's
-- e-consent (before its withdrawal takes effect), as the readiness view counts them; null when none.
create function private.professional_image_consent_valid_until(p_org uuid, p_pid uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_today date;
  v_doc date;
  v_econsent date;
  v_until date;
begin
  select (pg_catalog.now() at time zone o.timezone)::date into v_today from public.organizations o where o.id = p_org;
  select max(coalesce(x.expires_on, date '2100-12-31')) into v_doc
    from public.professional_documents x
    join public.document_types t on t.org_id = x.org_id and t.id = x.document_type_id and t.key = 'image_consent'
   where x.org_id = p_org and x.professional_id = p_pid and x.status = 'verified';
  select max(case when k.withdrawal_effective_on is null then k.expires_on
                  else least(k.expires_on, k.withdrawal_effective_on - 1) end) into v_econsent
    from public.professional_consents k
   where k.org_id = p_org and k.professional_id = p_pid;
  v_until := greatest(v_doc, v_econsent);
  return case when v_until >= v_today then v_until end;
end;
$fn$;
revoke all on function private.professional_image_consent_valid_until(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- prepare_professional_image_consent (service role; the function's one read before a send)
-- -----------------------------------------------------------------------------
-- As prepare_professional_contract (its comment), with:
--   * the actor holding professionals.manage (P4-483);
--   * the template `professionals.image_consent`, no Annexe A (no block placeholder, no terms);
--   * `send` after a signed consent: a new request (the renewal, P4-485);
--   * key 'professionals.image_consent:<id>:<p_idempotency_key>'; HINT `consent` where the contract
--     says `contract`.
-- Returns {idempotency_key, template_version_id, title, values, signers, cancel} for send and
-- regenerate, {resend: {request_id, envelope_id, recipient_ids}} for resend.
create function public.prepare_professional_image_consent(p_actor uuid, p_id uuid, p_action text, p_idempotency_key text)
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
  v_key text;
  v_cancel jsonb;
  v_snapshot jsonb;
  v_recipients jsonb;
begin
  if p_actor is null or p_id is null or p_action is null or p_action not in ('send', 'regenerate', 'resend')
     or (p_action <> 'resend' and coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9_-]{1,100}$') then
    raise exception 'Arguments invalides : acteur, professionnel, action et clé attendus.' using errcode = '22023';
  end if;
  -- The actor's org unlocked, the professional's lock, then the actor's permissions (Task 3.18).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org for no key update;
  v_keys := private.permission_keys_for(p_actor);
  if not (v_keys @> array['professionals.manage'])
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active') then
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  if v_row.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;

  select * into v_open from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.image_consent'
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'));

  if p_action = 'resend' then
    if v_open.id is null or v_open.status not in ('sent', 'viewed') then
      raise exception 'Aucun consentement n''attend de signature.' using errcode = 'P0001', hint = 'consent';
    end if;
    if v_open.envelope_id is null then
      raise exception 'Ce consentement n''a pas d''envoi Documenso à renvoyer : utilisez « Régénérer ».'
        using errcode = 'P0001', hint = 'consent';
    end if;
    v_recipients := coalesce((select pg_catalog.jsonb_agg(s.documenso_recipient_id)
                                from (select x.documenso_recipient_id from public.signature_request_signers x
                                       where x.request_id = v_open.id and x.status in ('pending', 'viewed')
                                         and x.documenso_recipient_id is not null
                                       order by x.signing_order limit 1) s), '[]'::jsonb);
    if pg_catalog.jsonb_array_length(v_recipients) = 0 then
      raise exception 'Personne n''attend ce courriel : utilisez « Synchroniser » pour mettre le consentement à jour.'
        using errcode = 'P0001', hint = 'consent';
    end if;
    return pg_catalog.jsonb_build_object('resend', pg_catalog.jsonb_build_object(
      'request_id', v_open.id,
      'envelope_id', v_open.envelope_id,
      'recipient_ids', v_recipients));
  end if;

  if v_row.status = 'inactive' then
    raise exception 'Un dossier inactif ne peut pas recevoir de consentement à signer.' using errcode = 'P0001', hint = 'status';
  end if;

  v_key := 'professionals.image_consent:' || p_id || ':' || p_idempotency_key;
  if p_action = 'send' then
    if v_open.status in ('sent', 'viewed') then
      raise exception 'Un consentement attend déjà la signature. Utilisez « Renvoyer » ou « Régénérer ».'
        using errcode = 'P0001', hint = 'consent';
    end if;
    -- A draft is the same request sent again (its send failed, or is under way: the send claim
    -- decides), under its own key.
    if v_open.id is not null then
      v_key := v_open.idempotency_key;
    end if;
  elsif v_open.id is not null and v_open.idempotency_key <> v_key then
    -- Another send of the open draft holds a fresh claim (the functions' STALE_SEND_MS, 10 minutes).
    if v_open.status = 'draft' and v_open.send_started_at > pg_catalog.now() - interval '10 minutes' then
      raise exception 'Un envoi est déjà en cours.' using errcode = 'P0001', hint = 'consent';
    end if;
    v_cancel := pg_catalog.jsonb_build_object('request_id', v_open.id, 'envelope_id', v_open.envelope_id,
                                              'status', v_open.status);
  end if;

  v_snapshot := private.professional_image_consent_snapshot(v_org, p_id, v_key, p_actor,
    'Le modèle du consentement a changé depuis cet envoi. Utilisez « Régénérer ».');

  return v_snapshot || pg_catalog.jsonb_build_object('cancel', v_cancel);
end;
$$;
revoke all on function public.prepare_professional_image_consent(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_professional_image_consent(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- The consent card (professionals.view)
-- -----------------------------------------------------------------------------
-- get_professional_contract's shape for the latest image-consent request, without clinic_signer:
-- {template: {id, published_version_id, published_version, published_at, draft_version_id} | null,
-- request: {…, can_read, signed_file_id, rejection_reason, signers} | null}. Null for a
-- professional the caller cannot read.
create function public.get_professional_image_consent(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_perms text[] := private.current_permission_keys()::text[];
  v_request jsonb;
begin
  if not ('professionals.view' = any (v_perms)) then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
           'id', r.id, 'status', r.status, 'last_error', r.last_error, 'template_version', v.version,
           'created_at', r.created_at, 'send_started_at', r.send_started_at, 'last_send_at', r.last_send_at,
           'sent_at', r.sent_at, 'viewed_at', r.viewed_at,
           'completed_at', r.completed_at, 'rejected_at', r.rejected_at, 'cancelled_at', r.cancelled_at,
           'expired_at', r.expired_at, 'expires_at', r.expires_at,
           'can_read', r.view_permission = any (v_perms),
           'signed_file_id', case when r.view_permission = any (v_perms) then r.signed_file_id end,
           'rejection_reason', case when r.view_permission = any (v_perms) then r.rejection_reason end,
           'signers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                         'role', s.role, 'name', s.name, 'status', s.status,
                                         'signing_order', s.signing_order, 'viewed_at', s.viewed_at,
                                         'signed_at', s.signed_at, 'rejected_at', s.rejected_at)
                                       order by s.signing_order)
                                  from public.signature_request_signers s where s.request_id = r.id), '[]'::jsonb))
    into v_request
    from public.signature_requests r
    left join public.document_template_versions v on v.id = r.template_version_id
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.image_consent'
   order by r.created_at desc, r.id desc
   limit 1;

  return pg_catalog.jsonb_build_object(
    'template', (select pg_catalog.jsonb_build_object(
                          'id', t.id, 'published_version_id', p.id, 'published_version', p.version,
                          'published_at', p.published_at, 'draft_version_id', d.id)
                   from public.document_templates t
                   left join public.document_template_versions p on p.template_id = t.id and p.status = 'published'
                   left join public.document_template_versions d on d.template_id = t.id and d.status = 'draft'
                  where t.org_id = v_org and t.key = 'professionals.image_consent' and t.is_active),
    'request', v_request);
end;
$$;
revoke all on function public.get_professional_image_consent(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_professional_image_consent(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- The signed consent becomes a document (P4-484)
-- -----------------------------------------------------------------------------
alter table public.professional_documents
  add column signature_request_id uuid,
  add constraint professional_documents_signature_request_key unique (signature_request_id),
  add constraint professional_documents_signature_request_fkey foreign key (signature_request_id)
    references public.signature_requests (id) on delete set null;

-- After a request of purpose professionals.image_consent becomes signed (complete_signature_request
-- sets the status and the stored PDF in one statement): a verified « Consentement droit à
-- l'image » document on that PDF, valid by the type's rule from the clinic date of the
-- professional's signature (else the completion), uploaded by nobody (the signature), reviewed at
-- the completion; the file becomes the professional's (owner professionals.self once she has an
-- account, as attach_professional_document), still read with professionals.view. Idempotent (one
-- document per request and per file). Never fails the completion: the signed PDF's capture comes
-- first (ADR 0005); on an error the consent is uploaded by hand.
create function private.professional_image_consent_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro public.professionals;
  v_type public.document_types;
  v_tz text;
  v_signed timestamptz;
  v_day date;
  v_expires date;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
begin
  if new.signed_file_id is null or new.subject_type <> 'professional' then
    return null;
  end if;
  begin
    select * into v_pro from public.professionals p where p.org_id = new.org_id and p.id = new.subject_id;
    select * into v_type from public.document_types t where t.org_id = new.org_id and t.key = 'image_consent';
    select o.timezone into v_tz from public.organizations o where o.id = new.org_id;
    if v_pro.id is null or v_type.id is null or v_tz is null then
      return null;
    end if;
    select max(s.signed_at) into v_signed
      from public.signature_request_signers s where s.request_id = new.id and s.role = 'professional';
    v_signed := coalesce(v_signed, new.completed_at, pg_catalog.now());
    v_day := (v_signed at time zone v_tz)::date;
    v_expires := private.document_default_expiry(v_type.expiry_rule, v_day);

    perform pg_catalog.set_config('app.audit_source', 'trigger:professional_image_consent_signed', true);
    update public.stored_files f
       set owner_profile_id = v_pro.profile_id,
           owner_permission = case when v_pro.profile_id is not null then 'professionals.self' end
     where f.id = new.signed_file_id and f.org_id = new.org_id and f.module_key = 'core'
       and f.purpose = 'signing_signed' and f.subject_type = 'signature_request' and f.subject_id = new.id
       and f.owner_profile_id is distinct from v_pro.profile_id;
    insert into public.professional_documents
      (org_id, professional_id, document_type_id, stored_file_id, status, expires_on, uploaded_by, uploaded_at,
       reviewed_by, reviewed_at, signature_request_id)
    values
      (new.org_id, v_pro.id, v_type.id, new.signed_file_id,
       case when v_expires < (pg_catalog.now() at time zone v_tz)::date then 'expired' else 'verified' end,
       v_expires, null, v_signed, null, pg_catalog.now(), new.id)
    on conflict do nothing;
    if found then
      perform private.after_professional_documents_change(new.org_id, v_pro.id);
    end if;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  exception when others then
    raise warning 'professional_image_consent_signed: % (request %)', sqlstate, new.id;
  end;
  return null;
end;
$$;
revoke all on function private.professional_image_consent_signed() from public, anon, authenticated, service_role;

create trigger signature_requests_professional_image_consent
  after update of status on public.signature_requests
  for each row
  when (new.status = 'signed' and old.status is distinct from new.status and new.purpose = 'professionals.image_consent')
  execute function private.professional_image_consent_signed();

-- -----------------------------------------------------------------------------
-- Reviewer actions on a signed consent (same signatures and grants as *_professionals_documents.sql)
-- -----------------------------------------------------------------------------
-- « Refuser »: as before, but a document made from a signature is refused (its file is the
-- signature's own copy, never soft-deleted; P4-484).
create or replace function public.reject_professional_document(p_doc_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_reason text := nullif(pg_catalog.btrim(p_reason, E' \t\r\n'), '');
  v_doc public.professional_documents;
begin
  if not private.has_permission('professionals.documents.review') then
    raise exception 'Permission refusée : professionals.documents.review' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Indiquez pourquoi le document est refusé.' using errcode = 'P0001', hint = 'reason';
  end if;
  if pg_catalog.char_length(v_reason) > 1000 then
    raise exception 'La raison compte au plus 1000 caractères.' using errcode = 'P0001', hint = 'reason';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);
  perform private.assert_not_own_document(v_doc.professional_id);
  if v_doc.signature_request_id is not null then
    raise exception 'Ce consentement a été signé électroniquement : il ne peut pas être refusé. Supprimez-le, ou envoyez un nouveau consentement à signer.'
      using errcode = 'P0001', hint = 'status';
  end if;
  if v_doc.status not in ('pending', 'verified') then
    raise exception 'Ce document ne peut plus être refusé.' using errcode = 'P0001', hint = 'status';
  end if;

  update public.professional_documents d
     set status = 'rejected', rejection_reason = v_reason, reviewed_by = auth.uid(), reviewed_at = pg_catalog.now()
   where d.professional_id = v_doc.professional_id and d.id = v_doc.id;
  perform private.soft_delete_stored_file(v_doc.stored_file_id, auth.uid());

  perform private.expire_notifications(v_org, 'professional_document', v_doc.id, array['professionals.document_to_review']);
  perform private.after_professional_documents_change(v_org, v_doc.professional_id);
end;
$$;

-- « Supprimer »: as before; a document made from a signature leaves its file (the signed PDF stays
-- with the signature request: « Journal », ADR 0005).
create or replace function public.delete_professional_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_doc public.professional_documents;
begin
  if not private.has_permission('professionals.documents.delete') then
    raise exception 'Permission refusée : professionals.documents.delete' using errcode = '42501';
  end if;
  v_doc := private.lock_professional_document(p_doc_id);
  perform private.assert_not_own_document(v_doc.professional_id);

  delete from public.professional_documents d where d.professional_id = v_doc.professional_id and d.id = v_doc.id;
  if v_doc.signature_request_id is null then
    perform private.soft_delete_stored_file(v_doc.stored_file_id, auth.uid());
  end if;

  perform private.expire_notifications(v_org, 'professional_document', v_doc.id, array['professionals.document_to_review']);
  perform private.after_professional_documents_change(v_org, v_doc.professional_id);
end;
$$;

-- The Documents tab and « Mes documents »: *_professionals_documents.sql's payload, each document
-- with `signature_request_id` (null for an uploaded file; set for a consent signed through
-- Documenso).
create or replace function public.get_professional_documents(p_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('professionals.view');
  v_own uuid := private.current_professional_id();
  v_pid uuid := coalesce(p_id, v_own);
  v_profile uuid;
begin
  if v_pid is null or v_org is null
     or not (v_staff or (v_pid = v_own and private.has_permission('professionals.self'))) then
    return null;
  end if;
  select p.profile_id into v_profile from public.professionals p where p.id = v_pid and p.org_id = v_org;
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'professional_id', v_pid,
    'today', private.clinic_today(),
    'photo', (
      select pg_catalog.jsonb_build_object('document_id', d.id, 'file_id', d.stored_file_id)
        from public.professional_public_profiles x
        join public.professional_documents d on d.professional_id = x.professional_id and d.id = x.photo_document_id
       where x.professional_id = v_pid and x.org_id = v_org),
    'documents', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', d.id, 'type_id', d.document_type_id, 'type_key', t.key, 'status', d.status,
               'expires_on', d.expires_on, 'metadata', d.metadata, 'uploaded_at', d.uploaded_at,
               'uploaded_by_self', d.uploaded_by is not null and d.uploaded_by is not distinct from v_profile,
               'reviewed_at', d.reviewed_at, 'reviewed_by_name', rv.display_name,
               'rejection_reason', d.rejection_reason, 'submission_id', d.submission_id,
               'signature_request_id', d.signature_request_id,
               'file', case when f.id is not null then pg_catalog.jsonb_build_object(
                         'id', f.id, 'name', f.original_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) end)
             order by d.created_at desc, d.id desc)
        from public.professional_documents d
        join public.document_types t on t.org_id = d.org_id and t.id = d.document_type_id
        left join public.stored_files f on f.id = d.stored_file_id and f.status = 'ready'
        left join public.profiles rv on v_staff and rv.user_id = d.reviewed_by and rv.org_id = v_org
       where d.professional_id = v_pid and d.org_id = v_org), '[]'::jsonb),
    'consent', (
      select pg_catalog.jsonb_build_object(
               'id', k.id, 'version', cv.version, 'signer_name', case when v_staff then k.signer_name end, 'signed_at', k.signed_at,
               'expires_on', k.expires_on, 'withdrawn_at', k.withdrawn_at, 'withdrawal_effective_on', k.withdrawal_effective_on)
        from public.professional_consents k
        join public.consent_versions cv on cv.org_id = k.org_id and cv.id = k.consent_version_id
       where k.professional_id = v_pid and k.org_id = v_org
       order by k.signed_at desc, k.id desc
       limit 1)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- History: both forms' requests and signers, each naming its purpose
-- -----------------------------------------------------------------------------
-- Same signature, grants, checks and paging as *_professionals_contracts.sql, with the
-- image-consent requests beside the service contract's, and `purpose` added to every signature
-- row's changed_fields (beside a signer's `role`), so the page says « le contrat de service » or
-- « le consentement au droit à l'image ».
create or replace function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_prefix text := p_id::text;
  v_tables text[] := private.professional_history_tables();
  v_signing_ids text[];
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.compensation') then
    v_tables := array(select t from pg_catalog.unnest(v_tables) t
                       where t <> all (private.professional_compensation_history_tables()));
  end if;
  select coalesce(pg_catalog.array_agg(x.id), '{}') into v_signing_ids
    from (select r.id::text as id
            from public.signature_requests r
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose in ('professionals.service_contract', 'professionals.image_consent')
          union all
          select s.id::text
            from public.signature_requests r
            join public.signature_request_signers s on s.request_id = r.id
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose in ('professionals.service_contract', 'professionals.image_consent')) x;

  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             -- A signer's row names its role (« par le professionnel », « par la clinique ») and the form.
             when a.table_name = 'signature_request_signers' and sr.role is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('role', sr.role, 'purpose', sr.purpose)
             when a.table_name = 'signature_requests' and rq.purpose is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('purpose', rq.purpose)
             when a.table_name = 'professional_submissions' and a.action <> 'insert' and sk.kind is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('kind', sk.kind)
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', (
                      select coalesce(pg_catalog.jsonb_agg(f.value order by f.ord), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(a.changed_fields -> 'fields') with ordinality as f(value, ord)
                       where f.value in ('"sin"'::jsonb, '"bank_account"'::jsonb)))
           end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      -- Two branches, so neither scans the clinic's whole log (P4-475): the file's own rows through
      -- audit_log_org_record_prefix_idx with the cursor, and the signature requests and signers
      -- through audit_log_record_idx. They never share a row, so union all is the OR it replaces.
      from ((select x.* from public.audit_log x
              where x.org_id = v_org
                and left(x.record_id, 36) = v_prefix
                and x.id < v_before
                and x.table_name = any (v_tables)
                and not (x.table_name = 'professional_submissions' and x.action = 'update'
                         and pg_catalog.jsonb_typeof(x.changed_fields) = 'object'
                         and not exists (select 1 from pg_catalog.jsonb_object_keys(x.changed_fields) k(key)
                                          where k.key not in ('submitted_values', 'secure_link_id')))
              order by x.id desc
              limit v_limit)
            union all
            (select x.* from public.audit_log x
              where x.org_id = v_org
                and x.table_name in ('signature_requests', 'signature_request_signers')
                and x.record_id = any (v_signing_ids)
                and x.id < v_before
                and x.action = 'update'
                and pg_catalog.jsonb_typeof(x.changed_fields) = 'object'
                and x.changed_fields ? 'status'
              order by x.id desc
              limit v_limit)) a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
      -- record_id is '<professional_id>:<submission id>' (the primary key's columns).
      left join lateral (select s.kind from public.professional_submissions s
                          where a.table_name = 'professional_submissions'
                            and s.professional_id = p_id and s.org_id = v_org
                            and s.id::text = pg_catalog.substr(a.record_id, 38)) sk on true
      left join lateral (select s.role, r.purpose from public.signature_request_signers s
                           join public.signature_requests r on r.id = s.request_id
                          where a.table_name = 'signature_request_signers' and s.org_id = v_org
                            and s.id::text = a.record_id) sr on true
      left join lateral (select r.purpose from public.signature_requests r
                          where a.table_name = 'signature_requests' and r.org_id = v_org
                            and r.id::text = a.record_id) rq on true
     order by a.id desc
     limit v_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- The questionnaire's consent through Documenso (P4-487, P4-488; decided with Jonathan 2026-10-09)
-- -----------------------------------------------------------------------------
-- The « Consentement » step: what the professional sees (professionals.self, her own file only):
-- {available: the clinic published the form, valid_until: the last day of the consent in force (a
-- signed document or the e-consent) or null, request: her latest image-consent request {status,
-- last_error, sent_at, completed_at, signed_at (her own signature)} or null}. Null without a file.
create function public.get_my_image_consent()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_pid uuid;
begin
  v_pid := private.my_professional_id();
  if v_pid is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'available', private.published_image_consent_version(v_org) is not null,
    'valid_until', private.professional_image_consent_valid_until(v_org, v_pid),
    'request', (select pg_catalog.jsonb_build_object(
                         'status', r.status, 'last_error', r.last_error, 'sent_at', r.sent_at,
                         'completed_at', r.completed_at,
                         'signed_at', (select max(x.signed_at) from public.signature_request_signers x
                                        where x.request_id = r.id and x.role = 'professional'))
                  from public.signature_requests r
                 where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_pid
                   and r.purpose = 'professionals.image_consent'
                 order by r.created_at desc, r.id desc
                 limit 1));
end;
$$;
revoke all on function public.get_my_image_consent() from public, anon, authenticated, service_role;
grant execute on function public.get_my_image_consent() to authenticated;

-- « Signer le consentement » and the return from the signing page (SERVICE ROLE, called by
-- professionals-consent-sign with p_actor = the verified caller). The actor: an active member
-- holding professionals.self (the module gate with it) whose account is linked to a file of her
-- clinic; only that file.
--   start  her open request (sent or viewed) → {resume: {request_id, envelope_id, recipient_id}}
--          (the same request, never a second one: the function reads its signing token again);
--          otherwise the snapshot to send (a live draft under its own key, else
--          'professionals.image_consent:<file>:<p_idempotency_key>'), as
--          prepare_professional_image_consent's send: {professional_id, idempotency_key,
--          template_version_id, title, values, signers}. Refused (P0001, HINT): an inactive file
--          (status), a consent already in force (signed), no published form (template), an empty
--          value (values), an open request without a signing link yet (consent).
--   sync   her latest image-consent request {sync: {request_id, status, envelope_id}} (null when
--          none), for the function's syncRequest.
create function public.prepare_my_image_consent(p_actor uuid, p_action text, p_idempotency_key text)
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
  v_recipient text;
  v_key text;
  v_snapshot jsonb;
begin
  if p_actor is null or p_action is null or p_action not in ('start', 'sync')
     or (p_action = 'start' and coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9_-]{1,100}$') then
    raise exception 'Arguments invalides : acteur, action et clé attendus.' using errcode = '22023';
  end if;
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor and p.status = 'active';
  v_keys := private.permission_keys_for(p_actor);
  if v_org is null or not (v_keys @> array['professionals.self']) then
    raise exception 'Permission refusée : professionals.self' using errcode = '42501';
  end if;
  -- Locked (the module's order: the professional first); the service role has no clinic of its own,
  -- so the actor's names it.
  select * into v_row from public.professionals p where p.profile_id = p_actor and p.org_id = v_org for no key update;
  if v_row.id is null then
    raise exception 'Aucun dossier professionnel n''est lié à ce compte.' using errcode = 'P0001';
  end if;

  if p_action = 'sync' then
    return pg_catalog.jsonb_build_object('sync', (
      select pg_catalog.jsonb_build_object('request_id', r.id, 'status', r.status, 'envelope_id', r.envelope_id)
        from public.signature_requests r
       where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_row.id
         and r.purpose = 'professionals.image_consent'
       order by r.created_at desc, r.id desc
       limit 1));
  end if;

  if v_row.status = 'inactive' then
    raise exception 'Votre dossier est inactif : communiquez avec la clinique pour le réactiver.'
      using errcode = 'P0001', hint = 'status';
  end if;
  if private.professional_image_consent_valid_until(v_org, v_row.id) is not null then
    raise exception 'Votre consentement au droit à l''image est déjà signé.' using errcode = 'P0001', hint = 'signed';
  end if;
  if private.published_image_consent_version(v_org) is null then
    raise exception 'La clinique n''a pas encore publié ce formulaire : elle vous l''enverra plus tard.'
      using errcode = 'P0001', hint = 'template';
  end if;

  select * into v_open from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = v_row.id
     and r.purpose = 'professionals.image_consent'
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'));
  if v_open.status in ('sent', 'viewed') then
    select x.documenso_recipient_id into v_recipient
      from public.signature_request_signers x
     where x.request_id = v_open.id and x.role = 'professional';
    if v_open.envelope_id is null or v_recipient is null then
      raise exception 'Le consentement vous a déjà été envoyé : ouvrez le lien reçu par courriel.'
        using errcode = 'P0001', hint = 'consent';
    end if;
    return pg_catalog.jsonb_build_object('resume', pg_catalog.jsonb_build_object(
      'request_id', v_open.id, 'envelope_id', v_open.envelope_id, 'recipient_id', v_recipient));
  end if;

  v_key := coalesce(v_open.idempotency_key, 'professionals.image_consent:' || v_row.id || ':' || p_idempotency_key);
  v_snapshot := private.professional_image_consent_snapshot(v_org, v_row.id, v_key, p_actor,
    'Le formulaire de consentement a changé depuis votre première tentative : la clinique vous l''enverra de nouveau.');
  return v_snapshot || pg_catalog.jsonb_build_object('professional_id', v_row.id);
end;
$$;
revoke all on function public.prepare_my_image_consent(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_my_image_consent(uuid, text, text) to service_role;

-- The questionnaire's completeness (*_professionals_bank_optional.sql's, P4-173 and P4-480), the
-- consent section now complete when the file holds a consent in force (signed through Documenso), or the draft
-- holds an e-consent of the current text signed before the switch, or the clinic has published no
-- form (P4-487). The rest unchanged.
create or replace function private.submission_gaps(p_sub public.professional_submissions)
returns text[]
language sql
stable
set search_path = ''
as $$
  with v as (select p_sub.submitted_values as j),
  sp as (select s.* from public.professional_submission_private s
          where s.submission_id = p_sub.id and s.org_id = p_sub.org_id),
  pp as (select x.* from public.professional_private x
          where x.professional_id = p_sub.professional_id and x.org_id = p_sub.org_id),
  bank as (
    select coalesce((select sp.bank_institution from sp), (select pp.bank_institution from pp)) is not null as has_institution,
           coalesce((select sp.bank_transit from sp), (select pp.bank_transit from pp)) is not null as has_transit,
           (exists (select 1 from sp where sp.bank_account is not null)
            or exists (select 1 from pp where pp.bank_account is not null)) as has_account
  )
  select coalesce(pg_catalog.array_agg(s.section order by s.ord), '{}')
    from pg_catalog.unnest(private.submission_sections()) with ordinality as s(section, ord), v, bank b
   where s.section = any (p_sub.requested_sections)
     and not coalesce(case s.section
       when 'personal' then
         v.j #>> '{personal,personal_phone}' is not null and v.j #>> '{personal,address_line1}' is not null
         and v.j #>> '{personal,city}' is not null and v.j #>> '{personal,province}' is not null
         and v.j #>> '{personal,postal_code}' is not null
       when 'professional' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{professional,professions}', '[]')) > 0
       when 'portrait' then v.j #>> '{portrait,bio}' is not null
       when 'languages' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{languages,language_ids}', '[]')) > 0
       when 'clienteles' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{clienteles,clienteles}', '[]')) > 0
       when 'motifs' then pg_catalog.jsonb_array_length(coalesce(v.j #> '{motifs,motif_ids}', '[]')) > 0
       when 'availability' then v.j ? 'availability'
       when 'photo' then exists (
         select 1 from public.stored_files f
          where f.id = (v.j #>> '{photo,file_id}')::uuid and f.org_id = p_sub.org_id and f.status = 'ready'
            and f.subject_type = 'professional_submission' and f.subject_id = p_sub.id
            and (f.retain_until is null or f.retain_until > pg_catalog.now()))
       when 'insurance' then (v.j #>> '{insurance,expires_on}')::date >= private.clinic_today() and exists (
         select 1 from public.stored_files f
          where f.id = (v.j #>> '{insurance,file_id}')::uuid and f.org_id = p_sub.org_id and f.status = 'ready'
            and f.subject_type = 'professional_submission' and f.subject_id = p_sub.id
            and (f.retain_until is null or f.retain_until > pg_catalog.now()))
       when 'tax_bank' then exists (select 1 from sp)
         -- All three or none (P4-480).
         and b.has_institution = b.has_transit and b.has_transit = b.has_account
         and (not coalesce((private.professionals_setting(p_sub.org_id, 'collect_sin'))::boolean, false)
              or exists (select 1 from sp where sp.sin is not null) or exists (select 1 from pp where pp.sin is not null))
       -- P4-487: signed through Documenso (a consent in force on the file), or the e-consent of a
       -- draft signed before the switch, or nothing to sign yet (no published form: the clinic
       -- sends it later, never a block).
       when 'consent' then (v.j #>> '{consent,consent_version_id}')::uuid
                             = private.current_consent_version(p_sub.org_id, 'image_rights')
                           or private.professional_image_consent_valid_until(p_sub.org_id, p_sub.professional_id) is not null
                           or private.published_image_consent_version(p_sub.org_id) is null
     end, false)
$$;
revoke all on function private.submission_gaps(public.professional_submissions) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The professional never uploads her image consent (P4-489, decided by Jonathan 2026-10-09)
-- -----------------------------------------------------------------------------
-- *_professionals_documents.sql's attach_professional_document (same signature and grants), with
-- one refusal: a file of purpose professional_self_document for the type image_consent (« Le
-- consentement se remplit et se signe en ligne. », HINT type). Staff still attach a paper consent.
create or replace function public.attach_professional_document(
  p_id uuid,
  p_type_key text,
  p_file_id uuid,
  p_expires_on date default null,
  p_metadata jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_self boolean;
  v_purpose text;
  v_row public.professionals;
  v_type public.document_types;
  v_file public.stored_files;
  v_today date;
  v_expires date;
  v_metadata jsonb := '{}';
  v_status text;
  v_id uuid;
  v_key text;
  v_value text;
begin
  if private.has_permission('professionals.manage') then
    v_self := false;
    v_purpose := 'professional_document';
  elsif private.has_permission('professionals.self') and p_id is not null and p_id = private.current_professional_id() then
    v_self := true;
    v_purpose := 'professional_self_document';
  else
    raise exception 'Permission refusée : professionals.manage' using errcode = '42501';
  end if;
  if p_id is null or p_type_key is null or p_file_id is null then
    raise exception 'Professionnel, type et fichier requis.' using errcode = '22023';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Métadonnées invalides.' using errcode = '22023';
  end if;

  perform private.lock_professional(p_id);
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org;

  select * into v_type from public.document_types t where t.org_id = v_org and t.key = p_type_key and t.is_active;
  if not found then
    raise exception 'Type de document inconnu.' using errcode = 'P0001', hint = 'type';
  end if;
  -- P4-489 (Jonathan, 2026-10-09): the professional fills in and signs her consent online (the
  -- questionnaire, « Mes documents »), never uploads one; staff may still upload a paper one.
  if v_self and v_type.key = 'image_consent' then
    raise exception 'Le consentement se remplit et se signe en ligne.' using errcode = 'P0001', hint = 'type';
  end if;

  -- The file (attach_stored_file re-checks purpose, uploader, clinic, status and staging).
  select * into v_file from public.stored_files f
   where f.id = p_file_id and f.org_id = v_org and f.purpose = v_purpose and f.status = 'ready'
     and (f.retain_until is null or f.retain_until > pg_catalog.now())
     and (not v_self or f.uploaded_by = auth.uid())
     and not exists (select 1 from public.professional_documents d where d.stored_file_id = f.id);
  if not found then
    raise exception 'Fichier introuvable. Téléversez-le de nouveau.' using errcode = 'P0001', hint = 'file';
  end if;
  if not (v_file.mime_type = any (v_type.accepted_mime)) then
    raise exception 'Ce type de fichier n''est pas accepté pour ce document.' using errcode = 'P0001', hint = 'file';
  end if;
  if v_file.size_bytes > v_type.max_bytes then
    raise exception 'Ce fichier dépasse la taille permise pour ce document (% Mo).',
      pg_catalog.replace(pg_catalog.trim_scale(pg_catalog.round(v_type.max_bytes / 1048576.0, 1))::text, '.', ',')
      using errcode = 'P0001', hint = 'file';
  end if;

  v_today := private.clinic_today();
  if v_type.expiry_rule = 'none' then
    if p_expires_on is not null then
      raise exception 'Ce type de document n''a pas d''échéance.' using errcode = 'P0001', hint = 'expires_on';
    end if;
  else
    v_expires := coalesce(p_expires_on, private.document_default_expiry(v_type.expiry_rule, v_today));
    if v_expires < v_today or v_expires > date '2100-12-31' then
      raise exception 'L''échéance doit être aujourd''hui ou plus tard.' using errcode = 'P0001', hint = 'expires_on';
    end if;
  end if;

  for v_key, v_value in select e.key, e.value from pg_catalog.jsonb_each_text(p_metadata) e loop
    if v_type.key <> 'insurance' or v_key not in ('insurer', 'policy_number')
       or pg_catalog.jsonb_typeof(p_metadata -> v_key) not in ('string', 'null') then
      raise exception 'Métadonnées invalides.' using errcode = '22023';
    end if;
    v_value := nullif(pg_catalog.btrim(v_value, E' \t\r\n'), '');
    if v_value is not null then
      if pg_catalog.char_length(v_value) > 120 or not private.is_tidy_text(v_value) then
        raise exception 'L''assureur et le numéro de police comptent au plus 120 caractères, sans caractères invisibles.'
          using errcode = 'P0001', hint = v_key;
      end if;
      v_metadata := v_metadata || pg_catalog.jsonb_build_object(v_key, v_value);
    end if;
  end loop;

  if (select count(*) from public.professional_documents d where d.professional_id = p_id and d.org_id = v_org) >= 200 then
    raise exception 'Ce dossier compte déjà 200 documents. Supprimez-en avant d''en ajouter.' using errcode = 'P0001';
  end if;

  v_status := case when not v_self and private.has_permission('professionals.documents.review')
                        and v_row.profile_id is distinct from auth.uid()
                   then 'verified' else 'pending' end;

  -- The file now belongs to the professional: read with professionals.view, and by the provider
  -- (owner branch) once they have an account.
  perform private.attach_stored_file(p_file_id, array[v_purpose], 'professional', p_id, 'professionals.view',
    v_row.profile_id, case when v_row.profile_id is not null then 'professionals.self' end,
    case when v_self then auth.uid() end);

  insert into public.professional_documents
    (org_id, professional_id, document_type_id, stored_file_id, status, expires_on, metadata, uploaded_by, reviewed_by, reviewed_at)
  values (v_org, p_id, v_type.id, p_file_id, v_status, v_expires, v_metadata, auth.uid(),
          case when v_status = 'verified' then auth.uid() end,
          case when v_status = 'verified' then pg_catalog.now() end)
  returning id into v_id;

  if v_status = 'verified' then
    perform private.after_professional_documents_change(v_org, p_id);
  else
    perform private.notify(
      v_org, 'professionals', 'professionals.document_to_review', 'normal', 'Document à vérifier',
      v_row.first_name || ' ' || v_row.last_name || ' a téléversé un document : ' || v_type.name || '.',
      '/professionnels/' || p_id || '/documents', 'professional_document', v_id,
      'professionals.documents.review', null, 'document:' || v_id || ':uploaded', null);
  end if;
  return v_id;
end;
$$;
