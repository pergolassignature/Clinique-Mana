-- The image consent sent through Documenso (migration *_professionals_image_consent.sql,
-- decisions P4-480 …). Covers: privileges; the template seeded per clinic (draft v1, nothing
-- published, the banner line, no initials, the professional as the only signer) and for a new
-- clinic; the printed values; prepare_professional_image_consent (professionals.manage, arguments,
-- no published template, the snapshot, a draft resumed under its own key, one out at a time,
-- resend, regenerate, an inactive file, a renewal after a signature, empty values); the card
-- (get_professional_image_consent for the conseillère, another clinic, the provider); the signed
-- consent becoming a verified « Consentement droit à l'image » document (12 months, the
-- provider's file, readiness, idempotent, a contract creates none); reject refused and delete
-- keeping the signed file; the history.
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated;

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'prepare_professional_image_consent', array['uuid', 'uuid', 'text', 'text'], 'service_role', array['EXECUTE'],
  'service_role may prepare a consent');
select function_privs_are('public', 'prepare_professional_image_consent', array['uuid', 'uuid', 'text', 'text'], 'authenticated', array[]::text[],
  'a client may not (the function names the actor)');
select function_privs_are('public', 'prepare_professional_image_consent', array['uuid', 'uuid', 'text', 'text'], 'anon', array[]::text[],
  'anon may not prepare a consent');
select function_privs_are('public', 'get_professional_image_consent', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may read the consent card');
select function_privs_are('public', 'get_professional_image_consent', array['uuid'], 'service_role', array[]::text[],
  'service_role may not (user-scoped)');
select function_privs_are('public', 'get_professional_image_consent', array['uuid'], 'anon', array[]::text[],
  'anon may not read the consent card');
select function_privs_are('private', 'professional_image_consent_terms', array['uuid', 'uuid'], 'authenticated', array[]::text[],
  'no client calls the values builder');
select function_privs_are('private', 'professional_image_consent_terms', array['uuid', 'uuid'], 'service_role', array[]::text[],
  'nor the service role (prepare_professional_image_consent does)');
select function_privs_are('private', 'professional_signing_values_check', array['uuid', 'uuid', 'jsonb', 'text'], 'authenticated', array[]::text[],
  'no client calls the values check');
select function_privs_are('private', 'professional_image_consent_signed', array[]::text[], 'authenticated', array[]::text[],
  'no client calls the completion trigger');
select function_privs_are('private', 'seed_professionals_image_consent_template', array['uuid'], 'authenticated', array[]::text[],
  'no client calls the template seed');
select function_privs_are('public', 'prepare_my_image_consent', array['uuid', 'text', 'text'], 'service_role', array['EXECUTE'],
  'service_role may prepare the professional''s own consent');
select function_privs_are('public', 'prepare_my_image_consent', array['uuid', 'text', 'text'], 'authenticated', array[]::text[],
  'a client may not (the function names the actor)');
select function_privs_are('public', 'get_my_image_consent', array[]::text[], 'authenticated', array['EXECUTE'],
  'the professional reads her consent step');
select function_privs_are('public', 'get_my_image_consent', array[]::text[], 'anon', array[]::text[],
  'anon may not');

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a conseillère and a provider (linked
-- to P3); org B with an admin. P1 has no account; P3 is the provider's file; P4 is org B's.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, signatory_name, signatory_title, signatory_email) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'Dominique Exemple', 'présidente', 'direction@clinique-a.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', null, null, null);
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

select set_config('test.tpl', (select t.id::text from public.document_templates t
                                where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.image_consent'), true);
select set_config('test.v1', (select v.id::text from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid), true);
select set_config('test.type', (select t.id::text from public.document_types t
                                 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent'), true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Un', 'pia@exemple.ca', 'invited'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Deux', 'paul@exemple.ca', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Nora', 'Trois', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Quatre', 'pat@exemple.ca', 'draft');

-- =============================================================================
-- The template: one draft per clinic, nothing published
-- =============================================================================
select results_eq($$ select t.title, t.module_key, t.view_permission, t.edit_permission, t.is_active
                       from public.document_templates t where t.id = current_setting('test.tpl')::uuid $$,
  $$ values ('Consentement au droit à l''image'::text, 'professionals'::text, 'professionals.view'::text, 'professionals.settings'::text, true) $$,
  'org A has « Consentement au droit à l''image » (view professionals.view, edit professionals.settings)');
select results_eq($$ select v.version, v.status from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid $$,
  $$ values (1, 'draft'::text) $$, 'one draft version 1, nothing published');
select is((select v.body -> 'blocks' -> 0 -> 'runs' -> 0 ->> 'text' from public.document_template_versions v where v.id = current_setting('test.v1')::uuid),
  'Texte à faire valider par la direction avant publication', 'the draft opens with the validation banner');
select is((select v.body -> 'header' -> 'initialsFor' from public.document_template_versions v where v.id = current_setting('test.v1')::uuid),
  null::jsonb, 'no initials: a short form signed once');
select results_eq($$ select s ->> 'role', (s ->> 'required')::boolean from public.document_template_versions v,
                            jsonb_array_elements(v.signers) s where v.id = current_setting('test.v1')::uuid $$,
  $$ values ('professional'::text, true) $$, 'the professional is the only signer (as the legacy consent)');
select ok((select v.body::text ~ 'renouvelé automatiquement' and v.body::text ~ 'préavis écrit de '
             from public.document_template_versions v where v.id = current_setting('test.v1')::uuid),
  'the legacy text: 12 months renewed automatically, 3 months'' notice');
select is_empty($$ select 1 from public.document_template_versions v
                    where v.id = current_setting('test.v1')::uuid and (v.body::text ~ 'MANA|DocuSeal|Christine' or v.email_message ~ 'MANA') $$,
  'no clinic name, no provider name: variables only');
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000c', 'Org C');
select is((select count(*)::int from public.document_templates t join public.document_template_versions v on v.template_id = t.id
            where t.org_id = 'b0000000-0000-0000-0000-00000000000c' and t.key = 'professionals.image_consent' and v.status = 'draft'), 1,
  'a new clinic gets the draft');

-- =============================================================================
-- The printed values (as postgres)
-- =============================================================================
select set_config('test.terms', private.professional_image_consent_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001')::text, true);
select is(current_setting('test.terms')::jsonb -> 'values' -> 'professional',
  '{"full_name": "Pia Un", "first_name": "Pia", "email": "pia@exemple.ca"}'::jsonb, 'the professional''s name and login address');
select ok((current_setting('test.terms')::jsonb -> 'values' ->> 'today')::date = (now() at time zone 'America/Toronto')::date,
  'today is the clinic''s date');
select is(current_setting('test.terms')::jsonb ->> 'title', 'Consentement au droit à l''image — Pia Un', 'the request title names the professional');
select is(current_setting('test.terms')::jsonb -> 'signers',
  '[{"role": "professional", "name": "Pia Un", "email": "pia@exemple.ca", "order": 1}]'::jsonb,
  'the professional signs alone, even with a clinic signatory configured');

-- =============================================================================
-- prepare_professional_image_consent (as postgres: the function's service client)
-- =============================================================================
select throws_ok($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') $$,
  '42501', null, 'the conseillère (no professionals.manage) is refused');
select throws_ok($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s admin finds nothing');
select throws_ok($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'sign', 'k1') $$,
  '22023', null, 'an unknown action');
select throws_ok($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'a b') $$,
  '22023', null, 'a key outside [A-Za-z0-9_-]');
select is(private.test_error_hint($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') $$),
  'template', 'nothing published: refused (HINT template)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.publish_template_version(current_setting('test.v1')::uuid) $$, 'the seeded draft can be published');
reset role;

-- The adjointe (professionals.manage, no compensation) may send it: it prints no pay.
select set_config('test.prep1', public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1')::text, true);
select results_eq($$ select p ->> 'idempotency_key', (p ->> 'template_version_id')::uuid, p -> 'cancel', p ? 'annexe'
                       from (select current_setting('test.prep1')::jsonb p) x $$,
  $$ values ('professionals.image_consent:c0000000-0000-0000-0000-000000000001:k1'::text, current_setting('test.v1')::uuid, 'null'::jsonb, false) $$,
  'send: the request key, the published version, nothing to cancel, no Annexe A');
select results_eq($$ select s.created_by, s.title, s.annexe from public.professional_contract_snapshots s
                      where s.idempotency_key = 'professionals.image_consent:c0000000-0000-0000-0000-000000000001:k1' $$,
  $$ values ('a0000000-0000-0000-0000-000000000002'::uuid, 'Consentement au droit à l''image — Pia Un'::text, '{}'::jsonb) $$,
  'the snapshot is written once, by the actor');

select set_config('test.r1', (select r.id::text from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.image_consent',
  'template_version_id', current_setting('test.v1'), 'subject_type', 'professional', 'subject_id', 'c0000000-0000-0000-0000-000000000001',
  'title', 'Consentement au droit à l''image — Pia Un', 'view_permission', 'professionals.view',
  'idempotency_key', 'professionals.image_consent:c0000000-0000-0000-0000-000000000001:k1',
  'sent_by', 'a0000000-0000-0000-0000-000000000002',
  'signers', current_setting('test.prep1')::jsonb -> 'signers')) r), true);
update public.signature_requests set last_error = 'provider_unavailable' where id = current_setting('test.r1')::uuid;
select is(public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k2') ->> 'idempotency_key',
  'professionals.image_consent:c0000000-0000-0000-0000-000000000001:k1', 'send with an open draft resumes it under its own key');
select is(private.test_error_hint($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'resend', null) $$),
  'consent', 'resend: nothing out yet (a draft)');

update public.signature_requests set status = 'sent', envelope_id = 'envelope_consentone', sent_at = now(), last_error = null,
       expires_at = now() + interval '7 days'
 where id = current_setting('test.r1')::uuid;
update public.signature_request_signers set documenso_recipient_id = '21' where request_id = current_setting('test.r1')::uuid;
select is(private.test_error_hint($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k3') $$),
  'consent', 'send while a consent is out: refused (HINT consent)');
select is(public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'resend', null),
  jsonb_build_object('resend', jsonb_build_object('request_id', current_setting('test.r1'), 'envelope_id', 'envelope_consentone', 'recipient_ids', '["21"]'::jsonb)),
  'resend: the envelope and the professional''s recipient');
select is(public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'k4') -> 'cancel',
  jsonb_build_object('request_id', current_setting('test.r1'), 'envelope_id', 'envelope_consentone', 'status', 'sent'),
  'regenerate: the open request to close first');
-- A service contract out for the same file is another purpose: it neither blocks nor is cancelled.
select is((select count(*)::int from public.signature_requests r
            where r.subject_id = 'c0000000-0000-0000-0000-000000000001' and r.purpose = 'professionals.service_contract'), 0,
  'the consent''s requests are its own purpose');

-- Values: an empty required value is refused naming its label (HINT values).
select throws_ok($$ select private.professional_signing_values_check('b0000000-0000-0000-0000-00000000000a', current_setting('test.v1')::uuid,
                                    '{"professional": {"first_name": "Pia"}, "today": "2026-10-09"}'::jsonb, 'Le consentement') $$,
  'P0001', 'Le consentement ne peut pas être préparé : « Nom du professionnel » est vide. Complétez le dossier ou les paramètres, puis réessayez.',
  'an empty required value: refused, naming its label');
select lives_ok($$ select private.professional_signing_values_check('b0000000-0000-0000-0000-00000000000a', current_setting('test.v1')::uuid,
                                   current_setting('test.prep1')::jsonb -> 'values', 'Le consentement') $$,
  'the seeded version with the file''s values passes');

-- An inactive file gets no consent.
update public.professionals set status = 'inactive',
       deactivation_reason_id = (select r.id from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave')
 where id = 'c0000000-0000-0000-0000-000000000002';
select is(private.test_error_hint($$ select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'send', 'k6') $$),
  'status', 'an inactive file gets no consent');

-- =============================================================================
-- The card (get_professional_image_consent)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.card', public.get_professional_image_consent('c0000000-0000-0000-0000-000000000001')::text, true);
select results_eq($$ select c -> 'request' ->> 'id', c -> 'request' ->> 'status', (c -> 'request' ->> 'can_read')::boolean,
                            (c -> 'template' ->> 'published_version')::int
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values (current_setting('test.r1'), 'sent'::text, true, 1) $$,
  'the conseillère sees the latest consent request and may read it (view permission professionals.view)');
select is(current_setting('test.card')::jsonb -> 'request' -> 'signers' -> 0 ->> 'role', 'professional', 'its signer''s progress');
select ok(public.get_professional_image_consent('c0000000-0000-0000-0000-000000000002') -> 'request' = 'null'::jsonb,
  'a file without a consent request: no request');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(public.get_professional_image_consent('c0000000-0000-0000-0000-000000000001') is null, 'another clinic reads null');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_image_consent('c0000000-0000-0000-0000-000000000003') $$, '42501', null,
  'the provider (no professionals.view) has no card');
reset role;

-- =============================================================================
-- Signed: the consent becomes a verified « Consentement droit à l'image » document
-- =============================================================================
-- Nora's (P3, the provider's file) consent, signed and its PDF stored (complete_signature_request).
select set_config('test.r3', (select r.id::text from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.image_consent',
  'template_version_id', current_setting('test.v1'), 'subject_type', 'professional', 'subject_id', 'c0000000-0000-0000-0000-000000000003',
  'title', 'Consentement au droit à l''image — Nora Trois', 'view_permission', 'professionals.view',
  'idempotency_key', 'professionals.image_consent:c0000000-0000-0000-0000-000000000003:n1',
  'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', '[{"role": "professional", "name": "Nora Trois", "email": "provider@a.test", "order": 1}]'::jsonb)) r), true);
update public.signature_requests set status = 'sent', envelope_id = 'envelope_consentnora', sent_at = now(), expires_at = now() + interval '7 days'
 where id = current_setting('test.r3')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003'), false,
  'out for signature: the consent does not count yet');
reset role;

insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, retain_until)
values ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/' || current_setting('test.r3') || '/f0000000-0000-0000-0000-000000000003.pdf',
        'core', 'signing_signed', 'signature_request', current_setting('test.r3')::uuid, 'professionals.view',
        'Consentement signé.pdf', 'application/pdf', 'pdf', 1000, repeat('b', 64), 'ready', now(), now() + interval '1 day');
update public.signature_request_signers set status = 'signed', signed_at = now() where request_id = current_setting('test.r3')::uuid;
-- As the webhook does it: the service role, no user.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select public.complete_signature_request(current_setting('test.r3')::uuid, 'f0000000-0000-0000-0000-000000000003', repeat('b', 64)) $$,
  'core''s completion runs with the module''s hook');

select results_eq($$ select d.status, d.expires_on, d.stored_file_id, d.document_type_id, d.uploaded_by, d.reviewed_at is not null
                       from public.professional_documents d where d.signature_request_id = current_setting('test.r3')::uuid $$,
  $$ values ('verified'::text, ((now() at time zone 'America/Toronto')::date + interval '12 months')::date,
             'f0000000-0000-0000-0000-000000000003'::uuid, current_setting('test.type')::uuid, null::uuid, true) $$,
  'a verified image-consent document, valid 12 months from the clinic date of the signature (the type''s rule)');
select results_eq($$ select f.owner_profile_id, f.owner_permission, f.view_permission, f.status from public.stored_files f
                      where f.id = 'f0000000-0000-0000-0000-000000000003' $$,
  $$ values ('a0000000-0000-0000-0000-000000000003'::uuid, 'professionals.self'::text, 'professionals.view'::text, 'ready'::text) $$,
  'the signed PDF belongs to the professional''s account (« Mes documents »), still read with professionals.view');
select results_eq($$ select a.source, a.actor_id from public.audit_log a
                      where a.table_name = 'professional_documents' and a.action = 'insert'
                        and a.changed_fields ->> 'signature_request_id' = current_setting('test.r3') $$,
  $$ values ('trigger:professional_image_consent_signed'::text, null::uuid) $$, 'audited as the system');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select r.consent_ok, 'image_consent' = any (r.documents_missing)
                       from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003' $$,
  $$ values (true, false) $$, 'readiness counts the signed consent');
select is((public.get_professional_documents('c0000000-0000-0000-0000-000000000003') -> 'documents' -> 0 ->> 'signature_request_id'),
  current_setting('test.r3'), 'the documents read says it came from a signature');
select is(public.get_professional_image_consent('c0000000-0000-0000-0000-000000000003') -> 'request' ->> 'signed_file_id',
  'f0000000-0000-0000-0000-000000000003', 'the card has the signed file for a reader of the request');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select d ->> 'status', d -> 'file' ->> 'id'
                       from jsonb_array_elements(public.get_professional_documents() -> 'documents') d $$,
  $$ values ('verified'::text, 'f0000000-0000-0000-0000-000000000003'::text) $$, '« Mes documents »: the provider reads it');
select is((select count(*)::int from public.stored_files f where f.id = 'f0000000-0000-0000-0000-000000000003'), 1,
  'and may sign a read URL for it (the stored_files policy: her own file)');
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003'), true,
  'her own readiness agrees');
reset role;

-- Idempotent: the completion again changes nothing, and the hook never runs twice.
select lives_ok($$ select public.complete_signature_request(current_setting('test.r3')::uuid, 'f0000000-0000-0000-0000-000000000003', repeat('b', 64)) $$,
  'a second completion is a no-op');
select is((select count(*)::int from public.professional_documents d where d.professional_id = 'c0000000-0000-0000-0000-000000000003'), 1,
  'one document per signed consent');

-- A renewal: once signed, a new consent may be sent (P4-48x), under a new key.
select results_eq($$ select p ->> 'idempotency_key', p -> 'cancel'
                       from (select public.prepare_professional_image_consent('a0000000-0000-0000-0000-000000000001',
                                     'c0000000-0000-0000-0000-000000000003', 'send', 'n2') p) x $$,
  $$ values ('professionals.image_consent:c0000000-0000-0000-0000-000000000003:n2'::text, 'null'::jsonb) $$,
  'after a signature, « Envoyer » prepares a renewal');

-- A signed service contract creates no document.
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
values ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/d0000000-0000-0000-0000-000000000009/f0000000-0000-0000-0000-000000000009.pdf',
        'core', 'signing_signed', 'signature_request', 'd0000000-0000-0000-0000-000000000009', 'professionals.compensation',
        'Contrat signé.pdf', 'application/pdf', 'pdf', 1000, repeat('c', 64), 'ready', now());
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at)
values ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract',
        (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
          where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.service_contract'),
        'professional', 'c0000000-0000-0000-0000-000000000003', 'Contrat de service — Nora Trois', 'sent', 'envelope_contractnora',
        'contract-nora', 'professionals.compensation', now());
update public.signature_requests set status = 'signed', completed_at = now(), completed_event_at = now(),
       signed_file_id = 'f0000000-0000-0000-0000-000000000009', signed_sha256 = repeat('c', 64)
 where id = 'd0000000-0000-0000-0000-000000000009';
select is((select count(*)::int from public.professional_documents d where d.professional_id = 'c0000000-0000-0000-0000-000000000003'), 1,
  'a signed contract is not an image consent');

-- =============================================================================
-- Reviewer actions on a signed consent (the admin)
-- =============================================================================
select set_config('test.doc', (select d.id::text from public.professional_documents d where d.signature_request_id = current_setting('test.r3')::uuid), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.reject_professional_document(current_setting('test.doc')::uuid, 'Mauvais fichier') $$),
  'status', 'a consent signed through Documenso cannot be refused (HINT status)');
select lives_ok($$ select public.delete_professional_document(current_setting('test.doc')::uuid) $$, 'it can be deleted');
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003'), false,
  'deleted: the consent no longer counts');
reset role;
select is((select f.status from public.stored_files f where f.id = 'f0000000-0000-0000-0000-000000000003'), 'ready',
  'the signed PDF stays: it is the signature''s own copy (Journal, ADR 0005)');

-- =============================================================================
-- The questionnaire's consent through Documenso (P4-487, P4-488): Nora (P3, the provider)
-- =============================================================================
select throws_ok($$ select public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000004', 'start', 's1') $$,
  '42501', null, 'the conseillère (no professionals.self) is refused');
select throws_ok($$ select public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000001', 'start', 's1') $$,
  'P0001', 'Aucun dossier professionnel n''est lié à ce compte.', 'an account without a file is refused');
select results_eq($$ select p ->> 'idempotency_key', (p ->> 'professional_id')::uuid, p -> 'signers' -> 0 ->> 'role', p -> 'signers' -> 0 ->> 'email'
                       from (select public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000003', 'start', 's1') p) x $$,
  $$ values ('professionals.image_consent:c0000000-0000-0000-0000-000000000003:s1'::text, 'c0000000-0000-0000-0000-000000000003'::uuid,
             'professional'::text, 'provider@a.test'::text) $$,
  'start: her own file only, the snapshot to send, herself as the signer');
select set_config('test.r5', (select r.id::text from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.image_consent',
  'template_version_id', current_setting('test.v1'), 'subject_type', 'professional', 'subject_id', 'c0000000-0000-0000-0000-000000000003',
  'title', 'Consentement au droit à l''image — Nora Trois', 'view_permission', 'professionals.view',
  'idempotency_key', 'professionals.image_consent:c0000000-0000-0000-0000-000000000003:s1',
  'sent_by', 'a0000000-0000-0000-0000-000000000003',
  'signers', '[{"role": "professional", "name": "Nora Trois", "email": "provider@a.test", "order": 1}]'::jsonb)) r), true);
select is(public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000003', 'start', 's2') ->> 'idempotency_key',
  'professionals.image_consent:c0000000-0000-0000-0000-000000000003:s1', 'a draft is resumed under its own key (never a second request)');
-- One transaction makes now() constant: the new request is dated a minute later, as in real life.
update public.signature_requests set status = 'sent', envelope_id = 'envelope_consentself', sent_at = now(), expires_at = now() + interval '7 days',
       created_at = now() + interval '1 minute'
 where id = current_setting('test.r5')::uuid;
update public.signature_request_signers set documenso_recipient_id = '31' where request_id = current_setting('test.r5')::uuid;
select is(public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000003', 'start', 's3'),
  jsonb_build_object('resume', jsonb_build_object('request_id', current_setting('test.r5'), 'envelope_id', 'envelope_consentself', 'recipient_id', '31')),
  'out for signature: the same request is resumed (its signing link read again)');
select is(public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000003', 'sync', null) -> 'sync' ->> 'request_id',
  current_setting('test.r5'), 'sync: her latest consent request');

-- The step's read, and the questionnaire's gap.
insert into public.professional_submissions (id, org_id, professional_id, kind, status, requested_sections)
values ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003',
        'update', 'draft', array['consent']);
select is(private.submission_gaps((select s from public.professional_submissions s where s.id = 'e0000000-0000-0000-0000-000000000003')),
  array['consent'], 'a published form not yet signed: the consent section is a gap');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select (c ->> 'available')::boolean, c -> 'valid_until', c -> 'request' ->> 'status' from (select public.get_my_image_consent() c) x $$,
  $$ values (true, 'null'::jsonb, 'sent'::text) $$, 'her step: a form to sign, nothing in force, her request out');
reset role;
-- Signed (as the webhook would): in force, no gap, and a second start is refused.
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
values ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/' || current_setting('test.r5') || '/f0000000-0000-0000-0000-000000000005.pdf',
        'core', 'signing_signed', 'signature_request', current_setting('test.r5')::uuid, 'professionals.view',
        'Consentement signé.pdf', 'application/pdf', 'pdf', 1000, repeat('d', 64), 'ready', now());
update public.signature_request_signers set status = 'signed', signed_at = now() where request_id = current_setting('test.r5')::uuid;
select set_config('request.jwt.claims', '', true);
select public.complete_signature_request(current_setting('test.r5')::uuid, 'f0000000-0000-0000-0000-000000000005', repeat('d', 64));
select is(private.submission_gaps((select s from public.professional_submissions s where s.id = 'e0000000-0000-0000-0000-000000000003')),
  array[]::text[], 'signed through Documenso: the consent section is complete');
select is(private.test_error_hint($$ select public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000003', 'start', 's4') $$),
  'signed', 'a consent in force: nothing to sign again (HINT signed)');
-- No published form: never a block.
update public.professional_documents set status = 'expired', expires_on = date '2020-01-01'
 where signature_request_id = current_setting('test.r5')::uuid;
update public.document_templates set is_active = false where id = current_setting('test.tpl')::uuid;
select is(private.submission_gaps((select s from public.professional_submissions s where s.id = 'e0000000-0000-0000-0000-000000000003')),
  array[]::text[], 'no published form: the consent section does not block the sending');
select is(private.test_error_hint($$ select public.prepare_my_image_consent('a0000000-0000-0000-0000-000000000003', 'start', 's5') $$),
  'template', 'and « Signer » says the clinic will send it later (HINT template)');
update public.document_templates set is_active = true where id = current_setting('test.tpl')::uuid;

-- The professional never uploads her consent (P4-489); staff may (a paper one).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000003', 'image_consent',
                                                                'f0000000-0000-0000-0000-0000000000a1') $$,
  'P0001', 'Le consentement se remplit et se signe en ligne.', '« Mes documents » refuses an uploaded consent');
reset role;

-- =============================================================================
-- History (the admin)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((select coalesce(jsonb_agg(jsonb_build_object('t', h.table_name, 's', h.changed_fields -> 'status' -> 'after',
                                                         'p', h.changed_fields -> 'purpose') order by h.id), '[]')
             from public.list_professional_history('c0000000-0000-0000-0000-000000000003', null, 200) h
            where h.table_name in ('signature_requests', 'signature_request_signers'))
          @> '[{"t": "signature_requests", "s": "signed", "p": "professionals.image_consent"},
               {"t": "signature_request_signers", "s": "signed", "p": "professionals.image_consent"},
               {"t": "signature_requests", "s": "signed", "p": "professionals.service_contract"}]'::jsonb,
  'the history lists both forms'' status moves, each naming its purpose');
select is_empty($$ select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000003', null, 200) h
                    where h.table_name in ('signature_requests', 'signature_request_signers')
                      and (h.action <> 'update' or not (h.changed_fields ? 'status') or not (h.changed_fields ? 'purpose')
                           or (h.table_name = 'signature_request_signers' and not (h.changed_fields ? 'role'))) $$,
  'never an insert, a claim or a stamp; every row names its purpose, a signer''s its role');
reset role;

select * from finish();
rollback;
