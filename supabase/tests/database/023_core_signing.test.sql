-- Signing (migration *_core_signing.sql, plan Phase 3 Task 3.31, design §6.2, P3-3, P3-19, P3-26,
-- P3-30, inconsistencies #9 and #11).
-- Covers: privileges (the tables select-only for authenticated, signers without `email`, nothing
-- for anon and service_role; user RPCs for authenticated, service RPCs for service_role; the
-- private helpers for no client role); indexes; the signing_source / signing_signed purposes;
-- the core.signing_reconcile job; signing_settings (seeded per org, base_url forms: public https
-- only, P3-34; the per-field patch; the API key cleared when the origin changes; expiry
-- range, permission, visibility; no origin change while a request is open); document templates (create needs settings.manage, the module
-- gate of their permissions, visibility through view_permission, a disabled module's template
-- invisible, set_document_template_active); versions (one draft, one published, publish
-- archives the previous one, draft-only edits, undeclared placeholders in any body string,
-- publish readiness and structure, the immutability and delete guards, archive);
-- get_signing_context; create_signature_request (idempotency, signers returned, the same key
-- with other signers refused, one open request per record and purpose, every guard);
-- begin_signature_request_send (one claim at a time, a stale one taken over, drafts only;
-- last_send_at stamped, never cleared);
-- mark_signature_request_sent (recipients keyed by role) / _failed (both release the claim; a
-- re-send's earlier envelope superseded); apply_signing_event (monotonic transitions, terminal
-- states, drafts: retry or ignored, a superseded envelope ignored, a disabled module, another
-- org, unknown events, nothing undoes a completion; the request id required: no lookup by
-- envelope id alone); complete_signature_request; list_subject_signature_requests (visibility, signers
-- without addresses, keyset paging); get_signature_request; list_signature_requests_to_reconcile,
-- expire_signature_request and cancel_signature_request; audit rows (signers' email and name,
-- requests' title, versions' body redacted).
-- The RPCs are the envelope versions of *_core_signing_envelope.sql (more in 026).
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(297);

-- =============================================================================
-- Privileges, indexes, purposes, job
-- =============================================================================
select table_privs_are('public', t, 'anon', array[]::text[], 'anon: nothing on ' || t)
  from unnest(array['signing_settings', 'document_templates', 'document_template_versions',
                    'signature_requests', 'signature_request_signers']) t;
select table_privs_are('public', t, 'authenticated', array['SELECT'], 'authenticated: select only on ' || t)
  from unnest(array['signing_settings', 'document_templates', 'document_template_versions',
                    'signature_requests']) t;
select table_privs_are('public', 'signature_request_signers', 'authenticated', array[]::text[],
  'authenticated: no table-wide privilege on signature_request_signers (column grants)');
select results_eq($$
  select a.attname::text collate "default", has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
    from pg_attribute a
   where a.attrelid = 'public.signature_request_signers'::regclass and a.attnum > 0 and not a.attisdropped
     and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
$$, $$ values ('email'::text, false) $$, 'authenticated reads every signer column but email');
select table_privs_are('public', t, 'service_role', array[]::text[], 'service_role: RPCs only on ' || t)
  from unnest(array['signing_settings', 'document_templates', 'document_template_versions',
                    'signature_requests', 'signature_request_signers']) t;
select is_empty($$
  select 1 from information_schema.column_privileges
   where table_schema = 'public'
     and table_name in ('signing_settings', 'document_templates', 'document_template_versions',
                        'signature_requests', 'signature_request_signers')
     and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
$$, 'no column write privilege on the signing tables');

select results_eq($$
  select p.oid::regprocedure::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'),
         p.prosecdef
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('set_signing_settings', 'create_document_template', 'create_template_version',
                       'begin_signature_request_send',
                       'update_template_version', 'publish_template_version', 'archive_template_version',
                       'list_document_templates', 'list_subject_signature_requests', 'get_signature_request',
                       'get_signing_context', 'create_signature_request', 'mark_signature_request_sent',
                       'mark_signature_request_failed', 'apply_signing_event', 'complete_signature_request',
                       'list_signature_requests_to_reconcile', 'expire_signature_request',
                       'set_document_template_active', 'cancel_signature_request')
   order by p.proname collate "C"
$$, $$ values
  ('apply_signing_event(uuid,uuid,text,text,text,timestamp with time zone,text)'::text, false, false, true, true),
  ('archive_template_version(uuid)', false, true, false, true),
  ('begin_signature_request_send(uuid,uuid,interval)', false, false, true, true),
  ('cancel_signature_request(uuid,uuid)', false, false, true, true),
  ('complete_signature_request(uuid,uuid,text)', false, false, true, true),
  ('create_document_template(text,text,text,text,text,text)', false, true, false, true),
  ('create_signature_request(jsonb)', false, false, true, true),
  ('create_template_version(uuid)', false, true, false, true),
  ('expire_signature_request(uuid)', false, false, true, true),
  ('get_signature_request(uuid)', false, true, false, false),
  ('get_signing_context(uuid,uuid)', false, false, true, true),
  ('list_document_templates(text)', false, true, false, false),
  ('list_signature_requests_to_reconcile(uuid,integer)', false, false, true, true),
  ('list_subject_signature_requests(text,uuid,integer,timestamp with time zone,uuid)', false, true, false, false),
  ('mark_signature_request_failed(uuid,text,text)', false, false, true, true),
  ('mark_signature_request_sent(uuid,text,uuid,jsonb,timestamp with time zone,integer)', false, false, true, true),
  ('publish_template_version(uuid)', false, true, false, true),
  ('set_document_template_active(uuid,boolean)', false, true, false, true),
  ('set_signing_settings(jsonb)', false, true, false, true),
  ('update_template_version(uuid,jsonb,jsonb,jsonb,text,text)', false, true, false, true)
$$, 'user RPCs for authenticated (reads are invoker: RLS applies), service RPCs for service_role only');
select results_eq($$
  select p.oid::regprocedure::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('signing_signers_valid', 'seed_org_signing_settings', 'guard_template_version',
                       'guard_template_version_delete', 'signing_recipients_valid', 'signing_superseded',
                       'signing_base_url_valid', 'signing_base_url_origin')
   order by p.proname collate "C"
$$, $$ values
  ('private.guard_template_version()'::text, false, false, false),
  ('private.guard_template_version_delete()', false, false, false),
  ('private.seed_org_signing_settings()', false, false, false),
  ('private.signing_base_url_origin(text)', false, false, false),
  ('private.signing_base_url_valid(text)', false, false, false),
  ('private.signing_recipients_valid(uuid,jsonb)', false, false, false),
  ('private.signing_signers_valid(jsonb)', false, false, false),
  ('private.signing_superseded(text[],text,text)', false, false, false)
$$, 'the private helpers are callable by no client role');

select is((select pg_get_indexdef('public.signature_requests_subject_idx'::regclass)),
  'CREATE INDEX signature_requests_subject_idx ON public.signature_requests USING btree (org_id, subject_type, subject_id, created_at DESC, id DESC)',
  'a subject''s requests, newest first (list_subject_signature_requests keyset, the org FK and RLS predicate)');
select is((select pg_get_indexdef('public.signature_requests_open_idx'::regclass)),
  'CREATE INDEX signature_requests_open_idx ON public.signature_requests USING btree (org_id, created_at) WHERE ((status = ANY (ARRAY[''sent''::text, ''viewed''::text])) OR ((status = ''draft''::text) AND (COALESCE(last_error, ''''::text) <> ''abandoned''::text)))',
  'the open requests of an org (reconcile), abandoned drafts left out');
select is((select pg_get_indexdef('public.signature_requests_open_subject_idx'::regclass)),
  'CREATE UNIQUE INDEX signature_requests_open_subject_idx ON public.signature_requests USING btree (org_id, subject_type, subject_id, purpose) WHERE (((status = ANY (ARRAY[''sent''::text, ''viewed''::text])) OR ((status = ''draft''::text) AND (COALESCE(last_error, ''''::text) <> ''abandoned''::text))) AND (purpose <> ''core.signing_test''::text))',
  'one open request per record and purpose (the built-in test document excepted)');
select is((select pg_get_indexdef('public.document_template_versions_published_idx'::regclass)),
  'CREATE UNIQUE INDEX document_template_versions_published_idx ON public.document_template_versions USING btree (template_id) WHERE (status = ''published''::text)',
  'one published version per template');
select is((select pg_get_indexdef('public.document_template_versions_draft_idx'::regclass)),
  'CREATE UNIQUE INDEX document_template_versions_draft_idx ON public.document_template_versions USING btree (template_id) WHERE (status = ''draft''::text)',
  'one draft per template');

select results_eq($$
  select key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
         max_image_side, retain_days
    from public.upload_purposes where key in ('signing_signed', 'signing_source') order by key
$$, $$ values
  ('signing_signed'::text, 'core'::text, 'signed-documents'::text, 'settings.integrations_manage'::text,
   'settings.integrations_manage'::text, null::text, 20971520, array['application/pdf'], null::int, 1),
  ('signing_source', 'core', 'documents', 'settings.integrations_manage', 'settings.integrations_manage', null,
   10485760, array['application/pdf'], null, 1)
$$, 'signing_source and signing_signed: PDF, staged one day until the request takes them');

select results_eq($$
  select j.key, j.module_key, j.kind, j.function_name, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'core.signing_reconcile'
$$, $$ values ('core.signing_reconcile'::text, 'core'::text, 'function'::text, 'signing-sync'::text,
               true, '50 * * * *'::text, 'select private.invoke_job_function(''core.signing_reconcile'')'::text) $$,
  'core.signing_reconcile is a maintenance function job, hourly at :50 (daily at 08:50 UTC until *_core_signing_capture)');

-- =============================================================================
-- Fixtures
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
-- Professionnels seeds « Contrat de service » (a draft) in every new clinic (4d.1): these tests list
-- their own templates only.
delete from public.document_templates where key = 'professionals.service_contract';
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',         'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D',      'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C',   'c@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Professionnel P', 'p@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Admin désactivé', 'x@a.test',        'disabled'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',         'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
update public.organizations
   set signatory_name = 'Christine Signataire', signatory_title = 'Directrice', signatory_email = 'direction@a.test'
 where id = 'b0000000-0000-0000-0000-00000000000a';

-- The org A signature image (ready, set as the asset).
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'org-assets',
  'b0000000-0000-0000-0000-00000000000a/core/b0000000-0000-0000-0000-00000000000a/e0000000-0000-0000-0000-000000000001.png',
  'core', 'org_signature', 'organization', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage', 'signature.png',
  'image/png', 'png', 1000, repeat('a', 64), 'ready', now());
update public.organizations set signature_file_id = 'e0000000-0000-0000-0000-000000000001'
 where id = 'b0000000-0000-0000-0000-00000000000a';

create temp table t (step text primary key, id uuid) on commit drop;
grant select, insert, update on t to authenticated, service_role;

-- A complete body, its variables and signers.
create temp table fx (k text primary key, v jsonb) on commit drop;
grant select on fx to authenticated, service_role;
insert into fx (k, v) values
  ('body', $j${"title": "Contrat {{clinic.name}}", "header": {"text": "Contrat", "initialsFor": ["professional"]},
    "footer": {"text": "{{clinic.name}}"},
    "blocks": [{"type": "paragraph", "runs": [{"text": "Entre {{clinic.name}} et "}, {"text": "{{ professional.name }}", "bold": true}]},
               {"type": "signaturePage", "signers": [{"role": "professional", "label": "Le professionnel"},
                                                     {"role": "clinic", "label": "La clinique"}]}]}$j$),
  ('variables', $j$[{"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
                    {"path": "professional.name", "label": "Nom du professionnel", "sample": "Marie Tremblay", "required": true, "kind": "text"}]$j$),
  ('signers', $j$[{"role": "professional", "label": "Professionnel", "order": 1, "required": true},
                  {"role": "clinic", "label": "Clinique", "order": 2, "required": false}]$j$);

-- =============================================================================
-- signing_settings
-- =============================================================================
select results_eq($$
  select org_id, base_url, expiry_days from public.signing_settings
   where org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') order by org_id
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, null::text, 7),
              ('b0000000-0000-0000-0000-00000000000b'::uuid, null::text, 7) $$,
  'every new org gets its signing settings (no instance, 7 days)');

-- The check itself, whoever writes (P3-34).
select throws_ok($$ update public.signing_settings set base_url = 'https://127.0.0.1'
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' $$, '23514', null,
  'signing_settings_base_url_check refuses an IP literal, whoever writes');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- Every form the server must not call (P3-34: SSRF and key exfiltration).
select throws_ok(pg_catalog.format('select public.set_signing_settings(%L::jsonb)', pg_catalog.jsonb_build_object('base_url', u)),
                 '23514', null, 'base_url refused: ' || why)
  from (values
    ('http://evil.test', 'plain http to any host but the local fake'),
    ('http://host.docker.internal', 'the local fake needs its port'),
    ('http://host.docker.internal.evil.test:80', 'the local fake''s exact host only'),
    ('https://sign.test/?x=1', 'a query string'),
    ('https://sign.test/#top', 'a fragment'),
    ('https://127.0.0.1', 'an IPv4 literal'),
    ('https://10.0.0.8:8443/api', 'an IPv4 literal with a port and path'),
    ('https://169.254.169.254', 'the metadata address'),
    ('https://127.1', 'a shortened IPv4 literal'),
    ('https://2130706433', 'an all-digit host'),
    ('https://0x7f000001', 'a hex host'),
    ('https://0x7f.0.0.1', 'a hex-looking IPv4 literal'),
    ('https://sign.0x7f', 'a hex last label'),
    ('https://[::1]', 'an IPv6 literal'),
    ('https://[fd00::1]:8443', 'an IPv6 literal with a port'),
    ('https://[::ffff:127.0.0.1]', 'an IPv4-mapped IPv6 literal'),
    ('https://documenso', 'a single-label host'),
    ('https://localhost', 'localhost'),
    ('https://localhost:8443', 'localhost with a port'),
    ('https://sign.localhost', 'a host under .localhost'),
    ('https://documenso.internal', 'a host ending in .internal'),
    ('https://host.docker.internal:55390', 'the local fake''s host over https (.internal)'),
    ('https://sign.local', 'a host ending in .local'),
    ('https://-sign.cliniquemana.com', 'a label starting with a hyphen'),
    ('https://sign..cliniquemana.com', 'an empty label'),
    ('https://sign.cliniquemana.com.', 'a trailing dot'),
    ('https://sign.cliniquemana.com:123456', 'a port over 5 digits')
  ) v(u, why);
select throws_ok($$ select public.set_signing_settings('{"base_url": "https://127.0.0.1"}') $$, '23514',
  'L''adresse de l''instance doit être une adresse https:// publique (un nom de domaine complet, sans adresse IP).',
  'base_url: refused with its own French message');
select throws_ok($$ select public.set_signing_settings('{"expiry_days": 61}') $$, '23514', null,
  'expiry_days: at most 60');
select throws_ok($$ select public.set_signing_settings('{"expiry_days": null}') $$, '23514',
  'Le délai d''expiration est obligatoire.', 'expiry_days: null refused (23514, like the other checks)');
select throws_ok($$ select public.set_signing_settings('{"expiry_days": "7"}') $$, '23514', null,
  'expiry_days: a JSON number only');
select throws_ok($$ select public.set_signing_settings('{"expiry_days": 7.5}') $$, '23514', null,
  'expiry_days: whole days only');
select throws_ok($$ select public.set_signing_settings('{"base_url": 5}') $$, '22023', null,
  'base_url: a string or null only');
select throws_ok($$ select public.set_signing_settings('{}') $$, '22023', null, 'an empty patch → 22023');
select throws_ok($$ select public.set_signing_settings('{"base_url": null, "webhook": "x"}') $$, '22023', null,
  'an unknown field → 22023 (nothing applied)');
select throws_ok($$ select public.set_signing_settings('[]') $$, '22023', null, 'not an object → 22023');
select throws_ok($$ select public.set_signing_settings(null) $$, '22023', null, 'null → 22023');
select results_eq($$ select base_url, expiry_days from public.signing_settings $$,
  $$ values (null::text, 7) $$, 'nothing refused was applied');

select is(public.set_signing_settings('{"base_url": " http://host.docker.internal:55390/ "}'),
  '{"api_key_cleared": false}'::jsonb, 'base_url: the local fake form (no key to clear)');
select is(public.set_signing_settings('{"base_url": "https://sign.cliniquemana.com/"}'),
  '{"api_key_cleared": false}'::jsonb, 'base_url: https');
select results_eq($$ select base_url, expiry_days, updated_by from public.signing_settings $$,
  $$ values ('https://sign.cliniquemana.com'::text, 7, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'trimmed, trailing slash removed, the expiry left as it was; admin A reads only her org''s row');

-- Per field (P3-34): each card sends only its own field.
select is(public.set_signing_settings('{"expiry_days": 14}'), '{"api_key_cleared": false}'::jsonb, 'the expiry alone');
select results_eq($$ select base_url, expiry_days from public.signing_settings $$,
  $$ values ('https://sign.cliniquemana.com'::text, 14) $$, 'the expiry changed, the address kept');

-- A new address needs its key again (P3-34).
do $$ begin
  perform public.set_org_secret('documenso_api_key', 'local-dev-documenso-key');
  perform public.set_org_secret('documenso_webhook_secret', 'local-dev-webhook-secret');
end $$;
select is(public.set_signing_settings('{"base_url": "https://sign.cliniquemana.com/api/"}'),
  '{"api_key_cleared": false}'::jsonb, 'another path on the same origin keeps the key');
select is(public.set_signing_settings('{"base_url": "https://sign.cliniquemana.com:443/api"}'),
  '{"api_key_cleared": false}'::jsonb, 'the explicit default port is the same origin');
select is(public.set_signing_settings('{"expiry_days": 14}'), '{"api_key_cleared": false}'::jsonb,
  'saving the expiry keeps the key');
select results_eq($$ select key from public.list_org_secret_keys() $$,
  $$ values ('documenso_api_key'::text), ('documenso_webhook_secret') $$, 'the key is still there');
select is(public.set_signing_settings('{"base_url": "https://autre.cliniquemana.com"}'),
  '{"api_key_cleared": true}'::jsonb, 'another host clears the key');
select results_eq($$ select key from public.list_org_secret_keys() $$,
  $$ values ('documenso_webhook_secret'::text) $$, 'the API key is gone; the webhook secret stays');
do $$ begin perform public.set_org_secret('documenso_api_key', 'local-dev-documenso-key'); end $$;
select is(public.set_signing_settings('{"base_url": "https://autre.cliniquemana.com:8443"}'),
  '{"api_key_cleared": true}'::jsonb, 'another port clears the key');
do $$ begin perform public.set_org_secret('documenso_api_key', 'local-dev-documenso-key'); end $$;
select is(public.set_signing_settings('{"base_url": "http://host.docker.internal:55390"}'),
  '{"api_key_cleared": true}'::jsonb, 'another scheme clears the key');
do $$ begin perform public.set_org_secret('documenso_api_key', 'local-dev-documenso-key'); end $$;
select is(public.set_signing_settings('{"base_url": null}'), '{"api_key_cleared": true}'::jsonb,
  'clearing the address clears the key');
do $$ begin perform public.set_org_secret('documenso_api_key', 'local-dev-documenso-key'); end $$;
select is(public.set_signing_settings('{"base_url": "https://sign.cliniquemana.com"}'), '{"api_key_cleared": true}'::jsonb,
  'an address set where there was none clears a key typed before it');
select results_eq($$ select key from public.list_org_secret_keys() $$,
  $$ values ('documenso_webhook_secret'::text) $$, 'no API key left for the new address');
select results_eq($$ select base_url, expiry_days, updated_by from public.signing_settings $$,
  $$ values ('https://sign.cliniquemana.com'::text, 14, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the expiry kept through every address change');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_signing_settings('{"base_url": null}') $$, '42501', null,
  'the adjointe (no settings.integrations_manage) cannot change them');
select is((select count(*)::int from public.signing_settings), 1, 'the adjointe reads them (settings.view)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.signing_settings), 0, 'the conseillère does not (no settings.view)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.set_signing_settings('{"base_url": "", "expiry_days": 30}'), '{"api_key_cleared": false}'::jsonb,
  'admin B: an empty address clears it, both fields in one patch');
select results_eq($$ select org_id, base_url, expiry_days from public.signing_settings $$,
  $$ values ('b0000000-0000-0000-0000-00000000000b'::uuid, null::text, 30) $$, 'admin B changes and reads only her org''s row');
reset role;
select is((select count(*)::int from public.org_secrets
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'documenso_api_key'), 0,
  'org A''s API key row is gone (and its Vault entry with it, through org_secrets_delete_vault)');
select is((select count(*)::int from public.audit_log
            where table_name = 'org_secrets' and action = 'delete'
              and org_id = 'b0000000-0000-0000-0000-00000000000a'), 5,
  'each key deletion is audited');

-- =============================================================================
-- Document templates
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into t (step, id)
values ('t1', public.create_document_template('core.test_contract', 'core', ' Contrat test ', 'Pour les tests',
                                              'settings.view', 'settings.manage'));
select results_eq($$
  select key, module_key, title, description, view_permission, edit_permission, is_active, created_by
    from public.document_templates where id = (select id from t where step = 't1')
$$, $$ values ('core.test_contract'::text, 'core'::text, 'Contrat test'::text, 'Pour les tests'::text,
               'settings.view'::text, 'settings.manage'::text, true, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'create_document_template: trimmed title, created_by');
select throws_ok($$ select public.create_document_template('core.test_contract', 'core', 'Autre', null,
                      'settings.view', 'settings.manage') $$,
  'P0001', 'Un modèle avec cette clé existe déjà.', 'a key is unique per org');
select throws_ok($$ select public.create_document_template('professionals.x', 'core', 'X', null, 'settings.view', 'settings.manage') $$,
  '23514', null, 'the key starts with the module key');
select throws_ok($$ select public.create_document_template('core.x', 'core', 'X', null, 'professionals.view', 'settings.manage') $$,
  '22023', null, 'the view permission belongs to the template''s module (the module gate)');
select throws_ok($$ select public.create_document_template('professionals.x', 'professionals', 'X', null,
                      'professionals.view', 'settings.manage') $$,
  '22023', null, 'the edit permission belongs to the template''s module');
select throws_ok($$ select public.create_document_template('core.y', 'core', '  ', null, 'settings.view', 'settings.manage') $$,
  'P0001', 'Le titre est obligatoire.', 'a title is required');
insert into t (step, id)
values ('t2', public.create_document_template('professionals.test_contract', 'professionals', 'Contrat pro', null,
                                              'professionals.view', 'professionals.view'));
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.create_document_template('core.z', 'core', 'Z', null, 'settings.view', 'settings.manage') $$,
  '42501', 'Permission refusée : settings.manage', 'creating a template needs settings.manage');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.create_document_template('professionals.y', 'professionals', 'Y', null,
                      'professionals.view', 'professionals.view') $$,
  '42501', 'Permission refusée : settings.manage',
  'a conseillère holding only professionals.view cannot create a template whose permissions she holds');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.create_document_template('core.z', 'core', 'Z', null, 'settings.view', 'settings.manage') $$,
  '42501', null, 'a disabled admin → 42501');

-- Versions
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into t (step, id) values ('v1', public.create_template_version((select id from t where step = 't1')));
select results_eq($$
  select version, status, body, variables, signers, email_subject, email_message, created_by
    from public.document_template_versions where id = (select id from t where step = 'v1')
$$, $$ values (1, 'draft'::text, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, ''::text, ''::text,
               'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the first version is an empty draft');
select throws_ok($$ select public.create_template_version((select id from t where step = 't1')) $$,
  'P0001', 'Une version brouillon existe déjà.', 'one draft at a time');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v1')) $$,
  'P0001', 'Le modèle doit avoir un titre.', 'an empty draft cannot be published');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      (select v from fx where k = 'body'), '[]', (select v from fx where k = 'signers'), 'Votre contrat', 'Merci') $$,
  'P0001', 'Variable inconnue : {{clinic.name}}', 'an undeclared placeholder in the body → the email message');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      '{"title": "x", "footer": {"text": "{{clinic.name"}, "blocks": []}', (select v from fx where k = 'variables'),
                      '[]', 's', 'm') $$,
  'P0001', 'Accolades non fermées dans le texte.', 'an unclosed placeholder in any string');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      (select v from fx where k = 'body'), (select v from fx where k = 'variables'),
                      (select v from fx where k = 'signers'), 'Contrat de {{professional.nom}}', 'Merci') $$,
  'P0001', 'Variable inconnue : {{professional.nom}}', 'the email subject and message follow the same rule');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      jsonb_build_object('title', repeat('x', 270000)), '[]', '[]', 's', 'm') $$,
  'P0001', 'Le modèle dépasse la taille permise (256 Ko).', 'a body over 256 KB');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      '[]', '[]', '[]', 's', 'm') $$,
  '22023', null, 'the body is an object');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      '{}', '[]', '[{"role": "notary", "label": "Notaire", "order": 1, "required": true}]', 's', 'm') $$,
  '22023', null, 'signer roles are professional, clinic or client');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      '{}', '[]', '[]', E'a\nb', 'm') $$,
  'P0001', 'L''objet du courriel de signature doit tenir sur une seule ligne.', 'the subject is one line');
select lives_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      (select v from fx where k = 'body'), (select v from fx where k = 'variables'),
                      '[{"role": "professional", "label": "Professionnel", "order": 1, "required": true}]',
                      ' Votre contrat ', 'Merci de signer.') $$,
  'update_template_version: a draft with declared placeholders');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v1')) $$,
  'P0001', 'Les signataires du modèle et ceux de la page de signature doivent être les mêmes.',
  'publish: every signer has a place on the signature page, and only them');
select lives_ok($$ select public.update_template_version((select id from t where step = 'v1'),
                      (select v from fx where k = 'body'), (select v from fx where k = 'variables'),
                      (select v from fx where k = 'signers'), 'Votre contrat', 'Merci de signer.') $$,
  'update_template_version again');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'), '{}', '[]', '[]', 's', 'm') $$,
  '42501', null, 'a non-holder of edit_permission cannot edit');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v1')) $$,
  '42501', null, 'nor publish');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v1')) $$,
  '22023', null, 'another org''s version is unknown');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.publish_template_version((select id from t where step = 'v1')) $$, 'publish v1');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v1')) $$,
  'P0001', 'Seule une version brouillon peut être publiée.', 'a version is published once');
select throws_ok($$ select public.update_template_version((select id from t where step = 'v1'), '{}', '[]', '[]', 's', 'm') $$,
  'P0001', 'Seule une version brouillon peut être modifiée.', 'a published version cannot be edited');

insert into t (step, id) values ('v2', public.create_template_version((select id from t where step = 't1')));
select results_eq($$
  select v2.version, v2.status, v2.body = v1.body, v2.variables = v1.variables, v2.signers = v1.signers,
         v2.email_subject, v2.email_message
    from public.document_template_versions v1, public.document_template_versions v2
   where v1.id = (select id from t where step = 'v1') and v2.id = (select id from t where step = 'v2')
$$, $$ values (2, 'draft'::text, true, true, true, 'Votre contrat'::text, 'Merci de signer.'::text) $$,
  'a new version copies the published one');
select lives_ok($$ select public.publish_template_version((select id from t where step = 'v2')) $$, 'publish v2');
select results_eq($$
  select id, status, published_by is not null, archived_at is not null from public.document_template_versions
   where template_id = (select id from t where step = 't1') order by version
$$, $$ select (select id from t where step = 'v1'), 'archived'::text, true, true
       union all select (select id from t where step = 'v2'), 'published', true, false $$,
  'publishing v2 archives v1: one published version per template');
insert into t (step, id) values ('v3', public.create_template_version((select id from t where step = 't1')));
select lives_ok($$ select public.archive_template_version((select id from t where step = 'v3')) $$,
  'archive_template_version discards a draft');
select throws_ok($$ select public.archive_template_version((select id from t where step = 'v3')) $$,
  'P0001', 'Cette version est déjà archivée.', 'a version is archived once');

-- Publish checks what the renderer requires (model.ts), on draft v4.
insert into t (step, id) values ('v4', public.create_template_version((select id from t where step = 't1')));
create temp table pb (k text primary key, body jsonb) on commit drop;
grant select on pb to authenticated;
insert into pb (k, body)
select k, case k
    when 'no_title' then b - 'title'
    when 'no_footer' then b - 'footer'
    when 'bad_block' then jsonb_set(b, '{blocks,0,type}', '"video"')
    when 'two_pages' then jsonb_set(b, '{blocks,0}', b -> 'blocks' -> 1)
    when 'dup_role' then jsonb_set(b, '{blocks,1,signers}',
      '[{"role": "professional", "label": "A"}, {"role": "professional", "label": "B"}, {"role": "clinic", "label": "C"}]')
    when 'initials' then jsonb_set(b, '{header,initialsFor}', '["client"]')
  end
  from (select v as b from fx where k = 'body') f,
       unnest(array['no_title', 'no_footer', 'bad_block', 'two_pages', 'dup_role', 'initials']) k;
select public.update_template_version((select id from t where step = 'v4'), (select body from pb where k = 'no_title'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v4')) $$,
  'P0001', 'Le modèle doit avoir un titre.', 'publish: a title');
select public.update_template_version((select id from t where step = 'v4'), (select body from pb where k = 'no_footer'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v4')) $$,
  'P0001', 'Le modèle doit avoir un pied de page.', 'publish: a footer');
select public.update_template_version((select id from t where step = 'v4'), (select body from pb where k = 'bad_block'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v4')) $$,
  '22023', 'Unknown block type', 'publish: block types of the model''s closed set');
select public.update_template_version((select id from t where step = 'v4'), (select body from pb where k = 'two_pages'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v4')) $$,
  'P0001', 'Le modèle doit se terminer par une page de signature.', 'publish: one signature page, last');
select public.update_template_version((select id from t where step = 'v4'), (select body from pb where k = 'dup_role'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v4')) $$,
  'P0001', 'Chaque signataire ne figure qu''une fois sur la page de signature.', 'publish: unique roles on the signature page');
select public.update_template_version((select id from t where step = 'v4'), (select body from pb where k = 'initials'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select throws_ok($$ select public.publish_template_version((select id from t where step = 'v4')) $$,
  'P0001', 'Seuls les signataires du modèle peuvent parapher les pages.', 'publish: initialsFor among the signer roles');
select lives_ok($$ select public.archive_template_version((select id from t where step = 'v4')) $$, 'discard v4');

-- A template with a published version, deleted with its versions below (the cascade).
insert into t (step, id)
values ('t3', public.create_document_template('core.cascade_test', 'core', 'Cascade', null, 'settings.view', 'settings.manage'));
insert into t (step, id) values ('v5', public.create_template_version((select id from t where step = 't3')));
select public.update_template_version((select id from t where step = 'v5'), (select v from fx where k = 'body'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select public.publish_template_version((select id from t where step = 'v5'));

-- The professionals template, published.
insert into t (step, id) values ('vp', public.create_template_version((select id from t where step = 't2')));
select public.update_template_version((select id from t where step = 'vp'), (select v from fx where k = 'body'),
  (select v from fx where k = 'variables'), (select v from fx where k = 'signers'), 'Votre contrat', 'Merci');
select public.publish_template_version((select id from t where step = 'vp'));
reset role;

-- The immutability trigger holds for every role, the owner included.
select throws_ok($$ update public.document_template_versions set body = '{}' where id = (select id from t where step = 'v2') $$,
  'P0001', 'Seule une version brouillon peut être modifiée.', 'a published version is immutable, even for the owner');
select throws_ok($$ update public.document_template_versions set published_at = now() - interval '1 day'
                     where id = (select id from t where step = 'v2') $$,
  'P0001', 'Seule une version brouillon peut être modifiée.', 'its metadata too');
select throws_ok($$ update public.document_template_versions set archived_at = now() - interval '1 day'
                     where id = (select id from t where step = 'v1') $$,
  'P0001', 'Seule une version brouillon peut être modifiée.', 'an archived version keeps its archived_at');
select lives_ok($$ update public.document_template_versions set created_by = null where id = (select id from t where step = 'v1') $$,
  'created_by may become null (its foreign key''s on delete set null)');
select throws_ok($$ delete from public.document_template_versions where id = (select id from t where step = 'v1') $$,
  'P0001', 'Une version publiée ou archivée ne peut pas être supprimée.', 'an archived version cannot be deleted');
select throws_ok($$ delete from public.document_template_versions where id = (select id from t where step = 'v5') $$,
  'P0001', 'Une version publiée ou archivée ne peut pas être supprimée.', 'nor a published one');
select lives_ok($$ delete from public.document_templates where id = (select id from t where step = 't3') $$,
  'deleting the template deletes its versions (the cascade)');
select is_empty($$ select 1 from public.document_template_versions where id = (select id from t where step = 'v5') $$,
  'the published version went with its template');
select throws_ok($$ update public.document_template_versions set status = 'draft' where id = (select id from t where step = 'v2') $$,
  '22023', null, 'a version never goes back to draft');
select throws_ok($$ update public.document_template_versions set status = 'published' where id = (select id from t where step = 'v1') $$,
  '22023', null, 'an archived version stays archived');

-- Visibility
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select key, can_edit, published_version, draft_version_id from public.list_document_templates() $$,
  $$ values ('core.test_contract'::text, false, 2, null::uuid), ('professionals.test_contract', true, 1, null) $$,
  'the adjointe (settings.view, professionals.view) lists both; she edits only the one whose edit permission she holds');
select is((select count(*)::int from public.document_template_versions
            where template_id = (select id from t where step = 't1')), 4, 'the adjointe reads the core versions');
select throws_ok($$ select public.set_document_template_active((select id from t where step = 't1'), false) $$,
  '42501', 'Permission refusée : settings.manage', 'set_document_template_active needs settings.manage');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select key from public.list_document_templates() $$,
  $$ values ('professionals.test_contract'::text) $$, 'the conseillère (no settings.view) sees only the professionals template');
select is((select count(*)::int from public.document_template_versions
            where template_id = (select id from t where step = 't1')), 0, 'nor its versions');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select key, can_edit, published_version_id from public.list_document_templates('core') $$,
  $$ values ('core.test_contract'::text, true, (select id from t where step = 'v2')) $$, 'admin: filtered by module, editable');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_document_templates() $$, 'org B sees none of org A''s templates');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.document_templates $$, 'a template with a disabled module''s permission is invisible');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- Service role: context and creation
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$
  select c -> 'version' ->> 'id', c -> 'version' ->> 'template_key', c -> 'version' -> 'signers',
         c -> 'version' ->> 'email_subject', c ->> 'module_key', c ->> 'module_enabled', c ->> 'timezone',
         c -> 'settings', c -> 'clinic' ->> 'signatory_email', c -> 'logo', c -> 'signature'
    from public.get_signing_context('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'v2')) c
$$, $$ select (select id::text from t where step = 'v2'), 'core.test_contract'::text, (select v from fx where k = 'signers'),
              'Votre contrat'::text, 'core'::text, 'true'::text, 'America/Toronto'::text,
              '{"base_url": "https://sign.cliniquemana.com", "expiry_days": 14}'::jsonb, 'direction@a.test'::text,
              'null'::jsonb,
              jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000001', 'bucket', 'org-assets',
                'object_path', 'b0000000-0000-0000-0000-00000000000a/core/b0000000-0000-0000-0000-00000000000a/e0000000-0000-0000-0000-000000000001.png') $$,
  'get_signing_context: version, settings, clinic, module state, assets as {bucket, object_path}');
select results_eq($$
  select c -> 'version', c ->> 'module_key', c -> 'clinic' ->> 'signatory_name'
    from public.get_signing_context('b0000000-0000-0000-0000-00000000000a', null) c
$$, $$ values ('null'::jsonb, 'core'::text, 'Christine Signataire'::text) $$,
  'get_signing_context without a version (the built-in test document)');
select throws_ok($$ select public.get_signing_context('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'v1')) $$,
  '22023', null, 'an archived version gives no context');
select throws_ok($$ select public.get_signing_context('b0000000-0000-0000-0000-00000000000b', (select id from t where step = 'v2')) $$,
  '22023', null, 'another org''s version gives no context');

-- A retired template sends nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.set_document_template_active((select id from t where step = 't1'), false) $$,
  '22023', null, 'another org''s template is unknown');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_document_template_active((select id from t where step = 't1'), false) $$,
  'set_document_template_active: retire a template');
select results_eq($$ select is_active from public.list_document_templates('core') $$, $$ values (false) $$,
  'the template is inactive');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.get_signing_context('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'v2')) $$,
  '22023', null, 'an inactive template gives no context');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_document_template_active((select id from t where step = 't1'), true);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Requests on subject d…01 (users.view) and others.
create temp table rq (k text primary key, p jsonb) on commit drop;
grant select on rq to service_role, authenticated;
insert into rq (k, p)
select k, jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'core', 'purpose', 'core.contract_' || k,
  'template_version_id', (select id from t where step = 'v2'), 'subject_type', 'test_subject',
  'subject_id', 'd0000000-0000-0000-0000-000000000001', 'title', 'Contrat de service — Marie Tremblay',
  'view_permission', 'users.view', 'idempotency_key', 'key-' || k, 'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', jsonb_build_array(
    jsonb_build_object('role', 'professional', 'name', 'Marie Tremblay', 'email', 'marie@pro.test', 'order', 1),
    jsonb_build_object('role', 'clinic', 'name', 'Christine Signataire', 'email', 'direction@a.test', 'order', 2)))
  from unnest(array['r1', 'r2', 'r3', 'r4']) k;

-- What create_signature_request returned, per call.
create temp table cr (k text primary key, id uuid, existing boolean, status text, signers jsonb, last_error text,
  created_at timestamptz, documenso_document_id text, envelope_id text) on commit drop;
grant select, insert on cr to service_role;
insert into cr select 'r1', c.* from public.create_signature_request((select p from rq where k = 'r1')) c;
reset role;
insert into t (step, id) select 'r1', id from public.signature_requests where idempotency_key = 'key-r1';
select results_eq($$ select existing, status, last_error, created_at, signers from cr where k = 'r1' $$,
  $$ select false, 'draft'::text, null::text, now(),
            (select jsonb_agg(jsonb_build_object('role', s.role, 'signer_id', s.id) order by s.signing_order)
               from public.signature_request_signers s where s.request_id = (select id from t where step = 'r1')) $$,
  'create_signature_request: a new draft, with its signers'' roles and ids');
set local role service_role;
insert into cr select 'r1_again', c.* from public.create_signature_request((select p from rq where k = 'r1')) c;
select results_eq($$ select id, existing, status, signers = (select signers from cr where k = 'r1') from cr where k = 'r1_again' $$,
  $$ select (select id from t where step = 'r1'), true, 'draft'::text, true $$,
  'the same idempotency key → the existing row, with the same signers');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"signers": [{"role": "professional", "name": "Marie Tremblay", "email": "marie@pro.test", "order": 2},
                                       {"role": "clinic", "name": "Christine Signataire", "email": "direction@a.test", "order": 1}]}') $$,
  'P0001', 'Les signataires ne correspondent pas à la demande existante.',
  'the same key with other signing orders → refused (a re-send must give Documenso the stored orders)');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"signers": [{"role": "professional", "name": "Marie Gagnon", "email": "marie@pro.test", "order": 1},
                                       {"role": "clinic", "name": "Christine Signataire", "email": "direction@a.test", "order": 2}]}') $$,
  'P0001', 'Les signataires ne correspondent pas à la demande existante.', 'the same key with another name → refused');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"signers": [{"role": "professional", "name": "Marie Tremblay", "email": "autre@pro.test", "order": 1},
                                       {"role": "clinic", "name": "Christine Signataire", "email": "direction@a.test", "order": 2}]}') $$,
  'P0001', 'Les signataires ne correspondent pas à la demande existante.', 'the same key with another address → refused');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"signers": [{"role": "professional", "name": "Marie Tremblay", "email": "marie@pro.test", "order": 1}]}') $$,
  'P0001', 'Les signataires ne correspondent pas à la demande existante.', 'the same key with a signer fewer → refused');
select results_eq($$ select c.id, c.existing from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"signers": [{"role": "clinic", "name": " Christine Signataire ", "email": "Direction@A.test ", "order": 2},
                                       {"role": "professional", "name": "Marie Tremblay", "email": "marie@pro.test", "order": 1}]}') c $$,
  $$ select (select id from t where step = 'r1'), true $$,
  'the same signers in another list order, outer spaces, an address in another case → the existing row');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1') || '{"idempotency_key": "k-open"}') $$,
  'P0001', 'Une demande de signature est déjà en cours pour ce dossier.',
  'a new key while the record has an open request of this purpose → refused');
insert into t (step, id) select k, r.id from rq, lateral public.create_signature_request(rq.p) r where rq.k in ('r2', 'r3', 'r4');
insert into t (step, id)
select 'rp', r.id from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.test_contract',
  'template_version_id', (select id from t where step = 'vp'), 'subject_type', 'professional',
  'subject_id', 'd0000000-0000-0000-0000-000000000002', 'title', 'Contrat', 'view_permission', 'professionals.view',
  'idempotency_key', 'key-rp', 'sent_by', null,
  'signers', '[{"role": "professional", "name": "Paul", "email": "paul@pro.test", "order": 1}]'::jsonb)) r;
insert into t (step, id)
select 'rt', r.id from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'core', 'purpose', 'core.signing_test',
  'template_version_id', null, 'subject_type', 'signing_test', 'subject_id', 'a0000000-0000-0000-0000-000000000001',
  'title', 'Document test', 'view_permission', 'settings.integrations_manage', 'idempotency_key', 'key-rt',
  'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', '[{"role": "clinic", "name": "Admin A", "email": "admin@a.test", "order": 1}]'::jsonb)) r;
select is((select count(*)::int from t where step in ('r1', 'r2', 'r3', 'r4', 'rp', 'rt') and id is not null), 6,
  'six requests created');

select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "template_version_id": null}') $$,
  '22023', null, 'only the built-in test document has no template version');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || jsonb_build_object('idempotency_key', 'k-x', 'template_version_id', (select id from t where step = 'v1'))) $$,
  '22023', null, 'the template version must be published');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "view_permission": "professionals.view"}') $$,
  '22023', null, 'the view permission belongs to the request''s module (the module gate)');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "purpose": "professionals.test_contract"}') $$,
  '22023', null, 'the purpose starts with the module key');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "signers": [{"role": "clinic", "name": "C", "email": "c@a.test", "order": 1}]}') $$,
  '22023', null, 'every required signer of the version is present');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "signers": [{"role": "professional", "name": "M", "email": "m@a.test", "order": 1},
                                                                 {"role": "client", "name": "C", "email": "c@a.test", "order": 2}]}') $$,
  '22023', null, 'a signer''s role must be one of the version''s');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "signers": [{"role": "professional", "name": "M", "email": "pas une adresse", "order": 1}]}') $$,
  '22023', null, 'a signer''s address is one mailbox');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "signers": [{"role": "professional", "name": "M", "email": "Same@a.test", "order": 1},
                                                                 {"role": "clinic", "name": "C", "email": "same@a.test", "order": 2}]}') $$,
  'P0001', 'Chaque signataire doit avoir sa propre adresse courriel.', 'two signers cannot share an address');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "signers": [{"role": "professional", "name": "M", "email": "m@a.test", "order": 1},
                                                                 {"role": "clinic", "name": "C", "email": "c@a.test", "order": 1}]}') $$,
  '22023', null, 'one signing order per signer');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "sent_by": "a0000000-0000-0000-0000-000000000006"}') $$,
  '22023', null, 'the sender is a member of the org');
select throws_ok($$ select * from public.create_signature_request((select p from rq where k = 'r1')
                      || '{"idempotency_key": "k-x", "org_id": "b0000000-0000-0000-0000-00000000000b"}') $$,
  '22023', null, 'the template version belongs to the org');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role service_role;
select throws_ok($$ select * from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.test_contract',
  'template_version_id', (select id from t where step = 'vp'), 'subject_type', 'professional',
  'subject_id', 'd0000000-0000-0000-0000-000000000002', 'title', 'Contrat', 'view_permission', 'professionals.view',
  'idempotency_key', 'key-rp2', 'sent_by', null,
  'signers', '[{"role": "professional", "name": "Paul", "email": "paul@pro.test", "order": 1}]'::jsonb)) $$,
  '22023', null, 'a disabled module cannot create a request');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

select results_eq($$
  select r.status, r.module_key, r.purpose, r.view_permission, r.sent_by, r.envelope_id, r.last_error,
         (select jsonb_agg(jsonb_build_array(s.role, s.name, s.email, s.signing_order, s.status) order by s.signing_order)
            from public.signature_request_signers s where s.request_id = r.id)
    from public.signature_requests r where r.id = (select id from t where step = 'r1')
$$, $$ values ('draft'::text, 'core'::text, 'core.contract_r1'::text, 'users.view'::text,
               'a0000000-0000-0000-0000-000000000001'::uuid, null::text, null::text,
               '[["professional", "Marie Tremblay", "marie@pro.test", 1, "pending"],
                 ["clinic", "Christine Signataire", "direction@a.test", 2, "pending"]]'::jsonb) $$,
  'the request and its signers are inserted together');
select is((select count(*)::int from public.signature_requests where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and idempotency_key = 'key-r1'), 1, 'one row per idempotency key');

-- =============================================================================
-- Sent / failed
-- =============================================================================
-- An org B request already sent (envelope 900).
insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  envelope_id, idempotency_key, view_permission, sent_at, expires_at)
values ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'core', 'core.signing_test',
  'signing_test', 'a0000000-0000-0000-0000-000000000006', 'Document test', 'sent', 'envelope_900', 'key-b1',
  'settings.integrations_manage', now(), now() + interval '7 days');

set local role service_role;
insert into t (step, id)
select 'src_' || k, f.file_id
  from unnest(array['r1', 'r2', 'r3', 'rp']) k,
       lateral public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'signing_source',
         'signature_request', (select id from t where step = k), 'application/pdf', 5000, repeat('c', 64),
         case k when 'rp' then 'professionals.view' else 'users.view' end, 'Contrat.pdf') f;
insert into t (step, id)
select 'src_bad', f.file_id
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'signing_source',
         'signature_request', (select id from t where step = 'r4'), 'application/pdf', 5000, repeat('c', 64),
         'settings.view', 'Contrat.pdf') f;
reset role;

-- The recipients map of each request, keyed by role: professional → <n>01, clinic → <n>02.
create temp table rc (k text primary key, p jsonb) on commit drop;
grant select on rc to service_role;
insert into rc (k, p)
select k, (select jsonb_agg(jsonb_build_object('role', s.role,
                              'recipient_id', n || case s.role when 'professional' then '01' else '02' end))
             from public.signature_request_signers s where s.request_id = (select id from t where step = k))
  from (values ('r1', '1'), ('r2', '2'), ('r3', '3'), ('r4', '4'), ('rp', '5')) v (k, n);

set local role service_role;
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r1'), (select p from rc where k = 'r1') - 1, now() + interval '14 days') $$,
  '22023', null, 'mark_sent: every signer gets a recipient id');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r1'),
                      '[{"role": "professional", "recipient_id": "101"}, {"role": "client", "recipient_id": "102"}]',
                      now() + interval '14 days') $$,
  '22023', null, 'mark_sent: a role that is not one of the request''s signers');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r1'),
                      '[{"role": "professional", "recipient_id": "101"}, {"role": "professional", "recipient_id": "102"}]',
                      now() + interval '14 days') $$,
  '22023', null, 'mark_sent: one recipient per role');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r1'),
                      '[{"role": "professional", "recipient_id": "101"}, {"role": "clinic", "recipient_id": "101"}]',
                      now() + interval '14 days') $$,
  '22023', null, 'mark_sent: distinct recipient ids');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r2'), (select p from rc where k = 'r1'), now() + interval '14 days') $$,
  '22023', null, 'mark_sent: the source file is this request''s');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r4'), 'envelope_14',
                      (select id from t where step = 'src_bad'), (select p from rc where k = 'r4'), now() + interval '14 days') $$,
  '22023', null, 'mark_sent: the source file has the request''s view permission');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), '11',
                      (select id from t where step = 'src_r1'), (select p from rc where k = 'r1'), now() + interval '14 days') $$,
  '22023', null, 'mark_sent: an envelope id, never a numeric document id');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r1'), (select p from rc where k = 'r1'), now() - interval '1 minute') $$,
  '22023', null, 'mark_sent: the expiry is in the future');
select lives_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                     (select id from t where step = 'src_r1'), (select p from rc where k = 'r1'), now() + interval '14 days') $$,
  'mark_signature_request_sent');
select throws_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r1'), 'envelope_11',
                      (select id from t where step = 'src_r1'), (select p from rc where k = 'r1'), now() + interval '14 days') $$,
  '22023', null, 'mark_sent: only a draft');
select public.mark_signature_request_sent((select id from t where step = k), 'envelope_' || n,
         (select id from t where step = 'src_' || k), (select p from rc where k = v.k), now() + interval '7 days')
  from (values ('r2', '12'), ('r3', '13'), ('rp', '15')) v (k, n);
select throws_ok($$ select public.mark_signature_request_failed((select id from t where step = 'r4'), 'Bad Code') $$,
  '22023', null, 'mark_failed: the error is a code');
select lives_ok($$ select public.mark_signature_request_failed((select id from t where step = 'r4'), 'provider_error', 'envelope_14') $$,
  'mark_signature_request_failed keeps the envelope Documenso created');
select throws_ok($$ select public.mark_signature_request_failed((select id from t where step = 'r1'), 'provider_error') $$,
  '22023', null, 'mark_failed: only a draft');
insert into cr select 'r4_again', c.* from public.create_signature_request((select p from rq where k = 'r4')) c;
select results_eq($$ select id, existing, status, last_error, created_at, documenso_document_id, envelope_id
                      from cr where k = 'r4_again' $$,
  $$ select (select id from t where step = 'r4'), true, 'draft'::text, 'provider_error'::text, now(), null::text,
            'envelope_14'::text $$,
  'an existing draft comes back with last_error, created_at and its earlier envelope (a re-send settles it first; the deprecated document id is null)');
reset role;

select results_eq($$
  select r.status, r.envelope_id, r.documenso_document_id, r.source_file_id = (select id from t where step = 'src_r1'),
         r.sent_at, r.expires_at, r.last_error,
         (select array_agg(s.documenso_recipient_id order by s.signing_order) from public.signature_request_signers s where s.request_id = r.id),
         (select f.retain_until from public.stored_files f where f.id = r.source_file_id)
    from public.signature_requests r where r.id = (select id from t where step = 'r1')
$$, $$ values ('sent'::text, 'envelope_11'::text, null::text, true, now(), now() + interval '14 days', null::text,
               array['101', '102'], null::timestamptz) $$,
  'sent: envelope (no document id), recipients, expiry; the source file is no longer staged');
select results_eq($$ select status, envelope_id, last_error from public.signature_requests
                      where id = (select id from t where step = 'r4') $$,
  $$ values ('draft'::text, 'envelope_14'::text, 'provider_error'::text) $$,
  'failed: stays a draft with last_error and the envelope id (reconcile cancels it)');

-- =============================================================================
-- apply_signing_event
-- =============================================================================
set local role service_role;
select results_eq($$ select outcome, request_id, module_key, needs_download from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_OPENED', '101', now(), null) $$,
  $$ select 'applied'::text, (select id from t where step = 'r1'), 'core'::text, false $$, 'opened → applied');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_OPENED', '101', now(), null) $$,
  $$ values ('ignored'::text) $$, 'opened twice → ignored');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_SIGNED', '101', now(), null) $$,
  $$ values ('applied'::text) $$, 'a recipient signed → applied');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_OPENED', '101', now(), null) $$,
  $$ values ('ignored'::text) $$, 'opened after signed → ignored');
reset role;
select results_eq($$
  select r.status, r.viewed_at,
         (select jsonb_agg(jsonb_build_array(s.status, s.viewed_at is not null, s.signed_at is not null) order by s.signing_order)
            from public.signature_request_signers s where s.request_id = r.id)
    from public.signature_requests r where r.id = (select id from t where step = 'r1')
$$, $$ values ('viewed'::text, now(), '[["signed", true, true], ["pending", false, false]]'::jsonb) $$,
  'sent → viewed; the signer viewed then signed, never back');

set local role service_role;
select results_eq($$ select outcome, request_id, needs_download from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_COMPLETED', null, now(), null) $$,
  $$ select 'applied'::text, (select id from t where step = 'r1'), true $$,
  'completed → needs_download');
select results_eq($$ select outcome, needs_download from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_COMPLETED', null, now(), null) $$,
  $$ values ('applied'::text, true) $$, 'completed again before the download is stored → needs_download again');
insert into t (step, id)
select 'signed_r1', f.file_id
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'core', 'signing_signed',
         'signature_request', (select id from t where step = 'r1'), 'application/pdf', 6000, repeat('d', 64),
         'users.view', 'Contrat signé.pdf') f;
select throws_ok($$ select public.complete_signature_request((select id from t where step = 'r1'),
                      (select id from t where step = 'signed_r1'), repeat('e', 64)) $$,
  '22023', null, 'complete: the hash is the stored file''s');
select throws_ok($$ select public.complete_signature_request((select id from t where step = 'r2'),
                      (select id from t where step = 'signed_r1'), repeat('d', 64)) $$,
  '22023', null, 'complete: the file is this request''s');
select lives_ok($$ select public.complete_signature_request((select id from t where step = 'r1'),
                     (select id from t where step = 'signed_r1'), repeat('d', 64)) $$, 'complete_signature_request');
select lives_ok($$ select public.complete_signature_request((select id from t where step = 'r1'),
                     (select id from t where step = 'signed_r1'), repeat('d', 64)) $$, 'complete is idempotent');
select results_eq($$ select outcome, needs_download from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_11', 'DOCUMENT_COMPLETED', null, now(), null) $$,
  $$ values ('ignored'::text, false) $$, 'completed after signed → ignored');
reset role;
select results_eq($$
  select r.status, r.completed_at, r.signed_sha256, r.signed_file_id = (select id from t where step = 'signed_r1'),
         (select array_agg(s.status order by s.signing_order) from public.signature_request_signers s where s.request_id = r.id),
         (select f.retain_until from public.stored_files f where f.id = r.signed_file_id)
    from public.signature_requests r where r.id = (select id from t where step = 'r1')
$$, $$ values ('signed'::text, now(), repeat('d', 64), true, array['signed', 'signed'], null::timestamptz) $$,
  'signed: completed_at, the hash, every signer signed, the signed file kept');

set local role service_role;
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r2'), 'envelope_12', 'DOCUMENT_REJECTED', '201', now(),
    E'Je refuse\u0007 ' || repeat('x', 600)) $$,
  $$ values ('applied'::text) $$, 'rejected → applied');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r2'), 'envelope_12', 'DOCUMENT_SIGNED', '202', now(), null) $$,
  $$ values ('ignored'::text) $$, 'an event after rejected → ignored');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r3'), 'envelope_13', 'DOCUMENT_CANCELLED', null, now(), null) $$,
  $$ values ('applied'::text) $$, 'cancelled → applied');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r3'), 'envelope_13', 'DOCUMENT_OPENED', '301', now(), null) $$,
  $$ values ('ignored'::text) $$, 'a cancelled request ignores later events');
select throws_ok($$ select * from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', null, 'envelope_11', 'DOCUMENT_OPENED', null, now(), null) $$,
  '22023', null, 'the request id is required: no lookup by envelope id alone (ids are per Documenso instance)');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000b', (select id from t where step = 'r2'), null, 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('not_found'::text) $$, 'a request of another org than the hinted one → not_found');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'), 'envelope_12', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('not_found'::text) $$, 'the request id and the envelope id name two different requests → not_found');
select results_eq($$ select outcome, request_id, needs_download from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'), 'envelope_14', 'DOCUMENT_OPENED', '401', now(), null) $$,
  $$ select 'retry'::text, (select id from t where step = 'r4'), false $$,
  'a failed draft with its Documenso envelope → retry (the webhook answers 409)');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'rp'), 'envelope_15', 'DOCUMENT_SENT', null, now(), null) $$,
  $$ values ('ignored'::text) $$, 'an event without an effect → ignored');
select throws_ok($$ select * from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a', null, 'envelope_15', null, null, now(), null) $$,
  '22023', null, 'an event name is required');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role service_role;
select results_eq($$ select outcome, module_key from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'rp'), 'envelope_15', 'DOCUMENT_OPENED', '501', now(), null) $$,
  $$ values ('ignored'::text, 'professionals'::text) $$, 'a disabled module → ignored');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
select results_eq($$
  select k, r.status, r.rejected_at is not null, r.cancelled_at is not null, length(r.rejection_reason),
         left(r.rejection_reason, 10),
         (select array_agg(s.status order by s.signing_order) from public.signature_request_signers s where s.request_id = r.id)
    from (values ('r2'), ('r3'), ('rp')) v (k)
    join public.signature_requests r on r.id = (select id from t where step = v.k)
   order by k
$$, $$ values ('r2'::text, 'rejected'::text, true, false, 500, 'Je refuse '::text, array['rejected', 'pending']),
              ('r3', 'cancelled', false, true, null, null, array['pending', 'pending']),
              ('rp', 'sent', false, false, null, null, array['pending']) $$,
  'rejected keeps a reason cut to 500 characters, control characters removed; cancelled; the disabled module''s request unchanged');

-- =============================================================================
-- Send claims and re-sends (r4: a failed draft whose envelope 14 exists)
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000b',
                      (select id from t where step = 'r4'), interval '10 minutes') $$,
  '22023', null, 'begin_send: a request of another org is unknown');
select throws_ok($$ select public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a',
                      (select id from t where step = 'r4'), null) $$,
  '22023', null, 'begin_send: a staleness is required');
select ok(public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'),
            interval '10 minutes'), 'begin_send claims a failed draft');
select ok(not public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'),
                interval '10 minutes'), 'a second claim while the first is fresh → false (one send at a time)');
reset role;
select results_eq($$ select send_started_at, last_error from public.signature_requests where id = (select id from t where step = 'r4') $$,
  $$ values (now(), null::text) $$, 'the claim stamps send_started_at and clears last_error');
select is((select last_send_at from public.signature_requests where id = (select id from t where step = 'r4')), now(),
  'the claim stamps last_send_at too (the reconcile''s clock for drafts)');
update public.signature_requests set send_started_at = now() - interval '11 minutes' where id = (select id from t where step = 'r4');
set local role service_role;
select ok(public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'),
            interval '10 minutes'), 'a claim older than the staleness (a send that died) is taken over');
select ok(not public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r2'),
                interval '0'), 'begin_send: a closed request → false');
select ok(not public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r1'),
                interval '0'), 'begin_send: a signed request → false');
-- The re-send cancelled envelope 14 at Documenso; its new envelope 24 fails part way.
select lives_ok($$ select public.mark_signature_request_failed((select id from t where step = 'r4'), 'provider_unavailable', 'envelope_24') $$,
  'mark_failed with the re-send''s new envelope');
reset role;
select results_eq($$ select last_error, send_started_at, envelope_id, superseded_envelope_ids
                      from public.signature_requests where id = (select id from t where step = 'r4') $$,
  $$ values ('provider_unavailable'::text, null::timestamptz, 'envelope_24'::text, array['envelope_14']) $$,
  'mark_failed releases the claim; the earlier envelope is superseded');
select is((select last_send_at from public.signature_requests where id = (select id from t where step = 'r4')), now(),
  'mark_failed keeps last_send_at: a failed send still counts from when it started');
set local role service_role;
select ok(public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'),
            interval '10 minutes'), 'released: « Renvoyer » claims it again at once');
select results_eq($$ select outcome, request_id from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'), 'envelope_14', 'DOCUMENT_CANCELLED', null, now(), null) $$,
  $$ select 'ignored'::text, (select id from t where step = 'r4') $$, 'a superseded envelope''s late event → ignored, not unknown');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', (select id from t where step = 'r4'), 'envelope_34', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('retry'::text) $$, 'the re-send''s new envelope, before mark_sent records it → retry');
insert into t (step, id)
select 'src_r4', f.file_id
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'signing_source',
         'signature_request', (select id from t where step = 'r4'), 'application/pdf', 5000, repeat('c', 64),
         'users.view', 'Contrat.pdf') f;
select lives_ok($$ select public.mark_signature_request_sent((select id from t where step = 'r4'), 'envelope_34',
                     (select id from t where step = 'src_r4'), (select p from rc where k = 'r4'), now() + interval '7 days') $$,
  'the re-send succeeds with envelope 34');
select results_eq($$ select e.d, a.outcome
                      from (values (1, 'envelope_14'), (2, 'envelope_24'), (3, 'envelope_44')) e (n, d),
                           lateral public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                             (select id from t where step = 'r4'), e.d, 'DOCUMENT_OPENED', null, now(), null) a
                     order by e.n $$,
  $$ values ('envelope_14'::text, 'ignored'::text), ('envelope_24', 'ignored'), ('envelope_44', 'not_found') $$,
  'sent: both superseded envelopes are ignored; another envelope is unknown');
reset role;
select results_eq($$ select status, envelope_id, superseded_envelope_ids, send_started_at, last_error
                      from public.signature_requests where id = (select id from t where step = 'r4') $$,
  $$ values ('sent'::text, 'envelope_34'::text, array['envelope_14', 'envelope_24'], null::timestamptz, null::text) $$,
  'mark_sent releases the claim and supersedes the failed attempt''s envelope');
select is((select last_send_at from public.signature_requests where id = (select id from t where step = 'r4')), now(),
  'mark_sent keeps last_send_at');
select is(private.signing_superseded(array(select 'envelope_' || g from generate_series(1, 20) g), 'envelope_21', 'envelope_22'),
  array(select 'envelope_' || g from generate_series(2, 21) g), 'signing_superseded keeps the latest 20');
select results_eq($$ select private.signing_superseded(array['envelope_1'], o, n)
                      from (values (1, null, 'envelope_2'), (2, 'envelope_3', null), (3, 'envelope_3', 'envelope_3'),
                                   (4, 'envelope_1', 'envelope_2')) v (k, o, n) order by k $$,
  $$ values (array['envelope_1']), (array['envelope_1']), (array['envelope_1']), (array['envelope_1']) $$,
  'signing_superseded: nothing replaced, the same envelope, or one already superseded → unchanged');

-- =============================================================================
-- User reads
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$
  select l.status, l.template_version, l.title, jsonb_path_query_array(l.signers, '$[*].role'),
         jsonb_path_query_array(l.signers, '$[*].status'), jsonb_path_query_array(l.signers, '$[*].name')
    from public.list_subject_signature_requests('test_subject', 'd0000000-0000-0000-0000-000000000001') l
   where l.id = (select id from t where step = 'r2')
$$, $$ values ('rejected'::text, 2, 'Contrat de service — Marie Tremblay'::text, '["professional", "clinic"]'::jsonb,
              '["rejected", "pending"]'::jsonb, '["Marie Tremblay", "Christine Signataire"]'::jsonb) $$,
  'list_subject_signature_requests: status, template version, signers in signing order');
select is((select count(*)::int from public.list_subject_signature_requests('test_subject', 'd0000000-0000-0000-0000-000000000001')),
  4, 'admin A lists the subject''s four requests (users.view)');
select ok(not exists (
  select 1 from public.list_subject_signature_requests('test_subject', 'd0000000-0000-0000-0000-000000000001') l,
         jsonb_array_elements(l.signers) s where s ? 'email'), 'the signers carry roles and statuses, never an address');
select results_eq($$ select id from public.list_subject_signature_requests('test_subject', 'd0000000-0000-0000-0000-000000000001', 2) $$,
  $$ select id from t where step in ('r1', 'r2', 'r3', 'r4') order by id desc limit 2 $$, 'newest first, limit 2');
select results_eq($$ select id from public.list_subject_signature_requests('test_subject', 'd0000000-0000-0000-0000-000000000001', 2,
                      now(), (select id from t where step in ('r1', 'r2', 'r3', 'r4') order by id desc offset 1 limit 1)) $$,
  $$ select id from t where step in ('r1', 'r2', 'r3', 'r4') order by id desc offset 2 $$, 'keyset: the next page after (created_at, id)');
select results_eq($$ select id, org_id, module_key, status, documenso_document_id, envelope_id
                      from public.get_signature_request((select id from t where step = 'r1')) $$,
  $$ select (select id from t where step = 'r1'), 'b0000000-0000-0000-0000-00000000000a'::uuid, 'core'::text, 'signed'::text,
            null::text, 'envelope_11'::text $$, 'get_signature_request: one row (the deprecated document id null)');
select is((select count(*)::int from public.signature_request_signers
            where request_id in (select id from t where step in ('r1', 'r2'))), 4, 'admin A reads the signers through the request');
select throws_ok($$ select email from public.signature_request_signers where request_id = (select id from t where step = 'r1') $$,
  '42501', null, 'but never their addresses, even directly (column grant)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_subject_signature_requests('test_subject', 'd0000000-0000-0000-0000-000000000001') $$,
  'the conseillère (no users.view) sees none of them');
select is_empty($$ select 1 from public.get_signature_request((select id from t where step = 'r1')) $$,
  'nor through get_signature_request');
select is_empty($$ select 1 from public.signature_request_signers where request_id = (select id from t where step = 'r1') $$,
  'nor their signers');
select results_eq($$ select id from public.list_subject_signature_requests('professional', 'd0000000-0000-0000-0000-000000000002') $$,
  $$ select id from t where step = 'rp' $$, 'she sees the professionals request (professionals.view)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is_empty($$ select 1 from public.signature_requests where id in (select id from t) $$, 'org B sees none of org A''s requests');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select 1 from public.signature_requests $$, 'a disabled admin sees nothing');
reset role;

-- =============================================================================
-- cancel_signature_request and one open request per record and purpose (Phase 4)
-- =============================================================================
create temp table rp2 (p jsonb) on commit drop;
grant select on rp2 to service_role;
insert into rp2 values (jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.test_contract',
  'template_version_id', (select id from t where step = 'vp'), 'subject_type', 'professional',
  'subject_id', 'd0000000-0000-0000-0000-000000000002', 'title', 'Contrat', 'view_permission', 'professionals.view',
  'idempotency_key', 'key-rp2', 'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', '[{"role": "professional", "name": "Paul", "email": "paul@pro.test", "order": 1}]'::jsonb));
set local role service_role;
select throws_ok($$ select * from public.create_signature_request((select p from rp2)) $$,
  'P0001', 'Une demande de signature est déjà en cours pour ce dossier.', 'the professional''s contract is still open (sent)');
select throws_ok($$ select public.cancel_signature_request((select id from t where step = 'rp'), 'a0000000-0000-0000-0000-000000000006') $$,
  '22023', null, 'cancel: the canceller is a member of the org');
select throws_ok($$ select public.cancel_signature_request('c0000000-0000-0000-0000-0000000000ff', null) $$,
  '22023', null, 'cancel: an unknown request');
select ok(public.cancel_signature_request((select id from t where step = 'rp'), 'a0000000-0000-0000-0000-000000000001'),
  'cancel_signature_request closes a sent request');
select ok(not public.cancel_signature_request((select id from t where step = 'rp'), null), 'a closed request stays closed (false)');
insert into t (step, id) select 'rp2', c.id from public.create_signature_request((select p from rp2)) c;
select ok((select id from t where step = 'rp2') is not null, 'once cancelled, a new request for the record can be created');
select ok(public.cancel_signature_request((select id from t where step = 'rp2'), null), 'a draft is cancelled too (abandoned)');
select throws_ok($$ select public.cancel_signature_request((select id from t where step = 'r1'), null) $$,
  'P0001', 'Ce document a déjà été signé : la demande ne peut plus être annulée.', 'a signed request cannot be cancelled');
reset role;
select results_eq($$
  select r.status, r.cancelled_at is not null, r.cancelled_by, r.last_error
    from (values (1, 'rp'), (2, 'rp2')) v (n, k) join public.signature_requests r on r.id = (select id from t where step = v.k)
   order by v.n
$$, $$ values ('cancelled'::text, true, 'a0000000-0000-0000-0000-000000000001'::uuid, null::text),
              ('draft', false, null, 'abandoned') $$,
  'cancelled: status, cancelled_at, cancelled_by; the draft abandoned');

-- =============================================================================
-- Reconcile, expiry, and drafts or completions under way
--   x1 sent 2 days ago (sync)                x2 draft 2 days old, with an envelope (sync)
--   x3 abandoned draft (not listed)          x4 viewed, past its expiry (expire; its
--   x5 sent an hour ago (sync: every sent or    DOCUMENT_COMPLETED was lost)
--      viewed request at each hourly run since *_core_signing_capture; 045 covers it; r4,
--      sent earlier in this file, is listed for the same reason)
--   x6 org B, sent 2 days ago                x7 sent, past its expiry (expire)
--   x8 draft 2 days old, no envelope (abandon)
--   x9 draft 3 days old with an envelope, re-sent 30 minutes ago, still sending (not listed:
--      staleness counts from last_send_at)  x10 draft 2 hours old, with an envelope (sync)
--   x11 draft 2 hours old, no envelope (not listed: a day for those)
--   x12 draft 3 days old, no envelope, re-sent 2 hours ago (not listed)
--   x13 draft 3 days old with an envelope, re-sent 30 minutes ago and failed (claim released;
--       not listed: last_send_at stays)
--   x14 draft 3 days old, no envelope, re-sent 2 hours ago and failed (not listed)
--   x15 draft 3 days old with an envelope, re-sent 2 hours ago and failed (sync)
-- =============================================================================
insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  envelope_id, idempotency_key, view_permission, last_error, created_at, sent_at, expires_at,
  send_started_at, last_send_at)
select x.id, x.org, 'core', 'core.signing_test', 'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Test', x.status,
       'envelope_' || x.n, 'key-' || x.id, 'settings.integrations_manage',
       x.err, x.created, x.sent, x.expires, case when x.err is null then x.last_send end, x.last_send
  from (values
    ('c0000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'sent', '601', null::text,
     now() - interval '2 days', now() - interval '2 days', now() + interval '5 days', null::timestamptz),
    ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'draft', '602', 'provider_error',
     now() - interval '2 days', null, null, null),
    ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'draft', null, 'abandoned',
     now() - interval '3 days', null, null, null),
    ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'viewed', '604', null,
     now() - interval '8 days', now() - interval '8 days', now() - interval '1 hour', null),
    ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'sent', '605', null,
     now() - interval '1 hour', now() - interval '1 hour', now() + interval '7 days', null),
    ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'sent', '606', null,
     now() - interval '2 days', now() - interval '2 days', now() + interval '5 days', null),
    ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'sent', '607', null,
     now() - interval '9 days', now() - interval '9 days', now() - interval '2 hours', null),
    ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'draft', null, 'provider_error',
     now() - interval '2 days', null, null, null),
    ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'draft', '609', null,
     now() - interval '3 days', null, null, now() - interval '30 minutes'),
    ('c0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000a', 'draft', '610', 'provider_error',
     now() - interval '2 hours', null, null, null),
    ('c0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'draft', null, 'provider_error',
     now() - interval '2 hours', null, null, null),
    ('c0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'draft', null, null,
     now() - interval '3 days', null, null, now() - interval '2 hours'),
    ('c0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-00000000000a', 'draft', '613', 'provider_unavailable',
     now() - interval '3 days', null, null, now() - interval '30 minutes'),
    ('c0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-00000000000a', 'draft', null, 'render_failed',
     now() - interval '3 days', null, null, now() - interval '2 hours'),
    ('c0000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-00000000000a', 'draft', '615', 'provider_unavailable',
     now() - interval '3 days', null, null, now() - interval '2 hours')
  ) as x (id, org, status, n, err, created, sent, expires, last_send);

set local role service_role;
select results_eq($$
  select id, status, documenso_document_id, envelope_id, action
    from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a')
$$, $$ values
  ('c0000000-0000-0000-0000-000000000007'::uuid, 'sent'::text, null::text, 'envelope_607'::text, 'expire'::text),
  ('c0000000-0000-0000-0000-000000000004', 'viewed', null, 'envelope_604', 'expire'),
  ('c0000000-0000-0000-0000-000000000008', 'draft', null, null, 'abandon'),
  ('c0000000-0000-0000-0000-000000000001', 'sent', null, 'envelope_601', 'sync'),
  ('c0000000-0000-0000-0000-000000000005', 'sent', null, 'envelope_605', 'sync'),
  ((select id from t where step = 'r4'), 'sent', null, 'envelope_34', 'sync'),
  ('c0000000-0000-0000-0000-000000000015', 'draft', null, 'envelope_615', 'sync'),
  ('c0000000-0000-0000-0000-000000000002', 'draft', null, 'envelope_602', 'sync'),
  ('c0000000-0000-0000-0000-000000000010', 'draft', null, 'envelope_610', 'sync')
$$, 'org A: expire and abandon first, then sync, each by expiry; a draft with a Documenso envelope after an hour → sync (read it before settling), one without after a day; both counted from the last send (last_send_at, kept after a failed send; else created_at)');
select results_eq($$ select id from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a', 1) $$,
  $$ values ('c0000000-0000-0000-0000-000000000007'::uuid) $$, 'p_limit pages the list');

-- Drafts: one with an envelope retries, one without ignores; a late failure keeps `abandoned`.
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', 'envelope_602', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('retry'::text) $$, 'a draft that has its Documenso envelope → retry');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000008', 'envelope_608', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('retry'::text) $$, 'a draft under way (the event names its envelope before mark_sent) → retry');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000008', null, 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('ignored'::text) $$, 'a draft with no envelope anywhere → ignored');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', null, 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('ignored'::text) $$, 'an abandoned draft → ignored');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-000000000008', 'abandoned') $$,
  'reconcile abandons the stale draft');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-000000000008', 'provider_error', 'envelope_608') $$,
  'a late failure of the same send');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000008', 'envelope_608', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('ignored'::text) $$, 'once abandoned, its events are ignored');

-- x4: the sync first finds the lost DOCUMENT_COMPLETED; from then on nothing undoes it.
select results_eq($$ select outcome, needs_download from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', 'envelope_604', 'DOCUMENT_COMPLETED', null, now(), null) $$,
  $$ values ('applied'::text, true) $$, 'the overdue request''s lost completion, applied by the sync');
select results_eq($$ select action from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a')
                      where id = 'c0000000-0000-0000-0000-000000000004' $$,
  $$ values ('sync'::text) $$, 'completed at Documenso, overdue: reconcile says sync (download), not expire');
select ok(not public.expire_signature_request('c0000000-0000-0000-0000-000000000004'),
  'a request Documenso completed is not expired, even overdue');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', 'envelope_604', 'DOCUMENT_CANCELLED', null, now(), null) $$,
  $$ values ('ignored'::text) $$, 'completed, then cancelled → ignored');
select results_eq($$ select outcome from public.apply_signing_event(
    'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', 'envelope_604', 'DOCUMENT_REJECTED', null, now(), 'Non') $$,
  $$ values ('ignored'::text) $$, 'completed, then rejected → ignored');
select throws_ok($$ select public.cancel_signature_request('c0000000-0000-0000-0000-000000000004', null) $$,
  'P0001', 'Ce document a déjà été signé : la demande ne peut plus être annulée.',
  'cancel_signature_request refuses a request Documenso completed');
insert into t (step, id)
select 'signed_x4', f.file_id
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'core', 'signing_signed',
         'signature_request', 'c0000000-0000-0000-0000-000000000004', 'application/pdf', 6000, repeat('f', 64),
         'settings.integrations_manage', 'Document test signé.pdf') f;
select lives_ok($$ select public.complete_signature_request('c0000000-0000-0000-0000-000000000004',
                     (select id from t where step = 'signed_x4'), repeat('f', 64)) $$,
  'complete_signature_request still works, past the expiry');

select ok(public.expire_signature_request('c0000000-0000-0000-0000-000000000007'), 'expire an overdue request');
select ok(not public.expire_signature_request('c0000000-0000-0000-0000-000000000001'), 'a request not yet overdue is left as is');
select ok(not public.expire_signature_request('c0000000-0000-0000-0000-000000000007'), 'an expired request stays expired');
select results_eq($$ select id from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000005'),
            ((select id from t where step = 'r4')), ('c0000000-0000-0000-0000-000000000015'),
            ('c0000000-0000-0000-0000-000000000002'), ('c0000000-0000-0000-0000-000000000010') $$,
  'signed, expired and abandoned requests leave the list');
reset role;
select results_eq($$
  select id, status, expired_at, completed_event_at, completed_at, last_error, envelope_id
    from public.signature_requests where id in ('c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000007',
                                                'c0000000-0000-0000-0000-000000000008')
   order by id
$$, $$ values ('c0000000-0000-0000-0000-000000000004'::uuid, 'signed'::text, null::timestamptz, now(), now(), null::text, 'envelope_604'::text),
              ('c0000000-0000-0000-0000-000000000007', 'expired', now(), null, null, null, 'envelope_607'),
              ('c0000000-0000-0000-0000-000000000008', 'draft', null, null, null, 'abandoned', 'envelope_608') $$,
  'x4 signed (completed_event_at, completed_at); x7 expired; x8 stays abandoned, its late envelope id recorded');

-- =============================================================================
-- Audit
-- =============================================================================
select results_eq($$
  select l.action, l.changed_fields -> 'email', l.changed_fields -> 'name', l.changed_fields ->> 'role'
    from public.audit_log l
   where l.table_name = 'signature_request_signers' and l.action = 'insert'
     and l.record_id in (select s.id::text from public.signature_request_signers s where s.request_id = (select id from t where step = 'r1'))
   order by l.changed_fields ->> 'signing_order'
$$, $$ values ('insert'::text, '"[redacted]"'::jsonb, '"[redacted]"'::jsonb, 'professional'::text),
              ('insert', '"[redacted]"'::jsonb, '"[redacted]"'::jsonb, 'clinic') $$,
  'the signers'' audit rows redact the address and the name: the timeline shows roles');
select results_eq($$
  select l.changed_fields -> 'title' from public.audit_log l
   where l.table_name = 'signature_requests' and l.record_id = (select id::text from t where step = 'r1') and l.action = 'insert'
$$, $$ values ('"[redacted]"'::jsonb) $$, 'a request''s title (it names the person) is redacted');
select results_eq($$
  select l.changed_fields -> 'status' from public.audit_log l
   where l.table_name = 'signature_requests' and l.record_id = (select id::text from t where step = 'r1') and l.action = 'update'
     and l.changed_fields ? 'status'
   order by l.id
$$, $$ values ('{"before": "draft", "after": "sent"}'::jsonb), ('{"before": "sent", "after": "viewed"}'::jsonb),
              ('{"before": "viewed", "after": "signed"}'::jsonb) $$,
  'signature_requests is audited: draft → sent → viewed → signed');
select results_eq($$
  select l.action, l.changed_fields -> 'body', l.actor_id from public.audit_log l
   where l.table_name = 'document_template_versions' and l.record_id = (select id::text from t where step = 'v1')
     and l.changed_fields ? 'body'
   order by l.id
$$, $$ values ('insert'::text, '"[redacted]"'::jsonb, 'a0000000-0000-0000-0000-000000000001'::uuid),
              ('update', '"[redacted]"'::jsonb, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'versions are audited with the body redacted (the immutable version is the record)');
select ok(exists (
  select 1 from public.audit_log l
   where l.table_name = 'signing_settings' and l.record_id = 'b0000000-0000-0000-0000-00000000000a' and l.action = 'update'
     and l.changed_fields -> 'expiry_days' = '{"before": 7, "after": 14}'), 'signing_settings is audited');

-- =============================================================================
-- No origin change while a request is open at the current instance (final Phase 3 review)
-- =============================================================================
-- Org B: an address, and one test document sent there (its earlier requests closed first).
update public.signing_settings set base_url = 'https://sign.b.test' where org_id = 'b0000000-0000-0000-0000-00000000000b';
update public.signature_requests set status = 'cancelled', cancelled_at = now()
 where org_id = 'b0000000-0000-0000-0000-00000000000b' and status in ('draft', 'sent', 'viewed');
insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  envelope_id, idempotency_key, view_permission, sent_at, expires_at)
values ('c0000000-0000-0000-0000-0000000000e9', 'b0000000-0000-0000-0000-00000000000b', 'core', 'core.signing_test',
        'signing_test', 'a0000000-0000-0000-0000-000000000006', 'Document test', 'sent', 'envelope_71', 'key-b9',
        'settings.integrations_manage', now(), now() + interval '7 days');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.set_signing_settings('{"base_url": "https://autre.b.test"}') $$, 'P0001',
  'Des demandes de signature sont encore en cours avec l''instance actuelle. Changez l''adresse une fois qu''elles sont signées, refusées, annulées ou expirées.',
  'a sent request blocks another origin');
select throws_ok($$ select public.set_signing_settings('{"base_url": null}') $$, 'P0001', null,
  'a sent request blocks clearing the address');
select is(public.set_signing_settings('{"base_url": "https://sign.b.test/api", "expiry_days": 10}'),
  '{"api_key_cleared": false}'::jsonb, 'the same origin and the expiry stay editable');
reset role;
update public.signature_requests set status = 'draft', sent_at = null, expires_at = null, last_error = 'provider_error'
 where id = 'c0000000-0000-0000-0000-0000000000e9';
set local role authenticated;
select throws_ok($$ select public.set_signing_settings('{"base_url": "https://autre.b.test"}') $$, 'P0001', null,
  'a draft holding a Documenso envelope blocks it');
reset role;
update public.signature_requests set last_error = 'abandoned' where id = 'c0000000-0000-0000-0000-0000000000e9';
set local role authenticated;
select is(public.set_signing_settings('{"base_url": "https://autre.b.test"}'), '{"api_key_cleared": false}'::jsonb,
  'an abandoned draft does not (its envelope was cancelled)');
reset role;
update public.signature_requests set last_error = null, envelope_id = null
 where id = 'c0000000-0000-0000-0000-0000000000e9';
set local role authenticated;
select is(public.set_signing_settings('{"base_url": "https://sign.b.test"}'), '{"api_key_cleared": false}'::jsonb,
  'nor does a draft without an envelope');
reset role;
select results_eq($$ select base_url, expiry_days from public.signing_settings where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  $$ values ('https://sign.b.test'::text, 10) $$, 'only the allowed changes were applied');

select * from finish();
rollback;
