-- Core signing: redacting a person from a signature request (migration *_core_signing_redact_signers.sql,
-- CC-10). Covers: the helper callable by no role; the signers of the roles given get a neutral name
-- and an address that receives nothing, with redacted_at, the others untouched; with a title, the
-- request's title and its stored files' names replaced; once only; another clinic's request
-- untouched; the journal never gets the old name or address; Clients' anonymisation handler
-- redacts her requests' title and her own signer rows, on her requests and another client's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select function_privs_are('private', 'signing_redact', array['uuid', 'uuid', 'text[]', 'text'], 'authenticated', array[]::text[], 'signing_redact: no role');
select column_privs_are('public', 'signature_request_signers', 'redacted_at', 'authenticated', array['SELECT'], 'redacted_at: readable like the other columns');

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true), ('b0000000-0000-0000-0000-00000000000a', 'clients', true);

-- Léa (10) and her parents Paul and Inès; Léa's consent signed by both; Paul also signed his own.
insert into public.clients (id, org_id, first_name, last_name, birthday, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Gagnon', (current_date - interval '10 years')::date, null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Paul', 'Gagnon', '1980-01-01', 'paul@exemple.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Inès', 'Roy', '1982-01-01', 'ines@exemple.test');
create temporary table v as
select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr';
insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, state, signed_at) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', (select id from v), 'signed', now()),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'fr', (select id from v), 'signed', now());
insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'client', 'd0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'client_2', 'd0000000-0000-0000-0000-000000000003'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000002', 'client', 'd0000000-0000-0000-0000-000000000002');
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at)
values
  ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'clients', 'clients.consent', (select id from v),
   'client_consent_request', 'e1000000-0000-0000-0000-000000000001', 'Consentement général — Léa Gagnon', 'sent', 'envelope_r1', 'k-1', 'clients.view', now()),
  ('f1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'clients', 'clients.consent', (select id from v),
   'client_consent_request', 'e1000000-0000-0000-0000-000000000002', 'Consentement général — Paul Gagnon', 'sent', 'envelope_r2', 'k-2', 'clients.view', now());
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order, documenso_recipient_id) values
  ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'Paul Gagnon', 'paul@exemple.test', 1, '91'),
  ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client_2', 'Inès Roy', 'ines@exemple.test', 2, '92'),
  ('f1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'client', 'Paul Gagnon', 'paul@exemple.test', 1, '93');
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, retain_until)
values ('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/f1000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001.pdf',
        'core', 'signing_signed', 'signature_request', 'f1000000-0000-0000-0000-000000000001', 'clients.view',
        'Consentement général — Léa Gagnon — signé.pdf', 'application/pdf', 'pdf', 1000, repeat('c', 64), 'ready', now(), now() + interval '1 day');

-- =============================================================================
-- The helper
-- =============================================================================
select is(private.signing_redact('b0000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000002', array['client'], null), 0,
  'another clinic''s request: nothing changes');
select is(private.signing_redact('b0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', array['client'], 'Consentement — anonymisé'), 2,
  'the signer and the title (no file stored for this request)');
select results_eq($$ select name, email ~ '^anonymise\+[0-9a-f]{12}@redacted\.invalid$', redacted_at is not null
                       from public.signature_request_signers where request_id = 'f1000000-0000-0000-0000-000000000002' $$,
  $$ values ('Personne anonymisée', true, true) $$, 'a neutral name, an address that receives nothing, when');
select ok(private.is_mailbox((select email from public.signature_request_signers where request_id = 'f1000000-0000-0000-0000-000000000002')),
  '… still a mailbox for the table''s check');
select is(private.signing_redact('b0000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', array['client'], 'Consentement — anonymisé'), 0,
  'once only');
select is((select count(*)::int from public.audit_log a where a.table_name = 'signature_request_signers'
             and (strpos(a::text, 'paul@exemple.test') > 0 or strpos(a::text, 'Paul Gagnon') > 0)), 0,
  'the journal never holds the old name or address');

-- =============================================================================
-- Clients' anonymisation: Paul (who signed Léa's consent and his own)
-- =============================================================================
update public.signature_request_signers set name = 'Paul Gagnon', email = 'paul@exemple.test', redacted_at = null
 where request_id = 'f1000000-0000-0000-0000-000000000002';
update public.signature_requests set title = 'Consentement général — Paul Gagnon' where id = 'f1000000-0000-0000-0000-000000000002';
select ok(private.clients_consents_anonymize_client('d0000000-0000-0000-0000-000000000002') > 0, 'Paul''s anonymisation runs');
select results_eq($$ select role, name from public.signature_request_signers where request_id = 'f1000000-0000-0000-0000-000000000001' order by role $$,
  $$ values ('client', 'Personne anonymisée'), ('client_2', 'Inès Roy') $$, 'Léa''s request: his row redacted, the other parent''s kept');
select is((select title from public.signature_requests where id = 'f1000000-0000-0000-0000-000000000001'), 'Consentement général — Léa Gagnon',
  '… its title (Léa''s, not his) kept');
select results_eq($$ select r.title, s.name from public.signature_requests r join public.signature_request_signers s on s.request_id = r.id
                      where r.id = 'f1000000-0000-0000-0000-000000000002' $$,
  $$ values ('Consentement — client anonymisé', 'Personne anonymisée') $$, 'his own request: the title and his row');

-- Léa anonymised: her request's title and its stored file's name go; her parents' rows stay (they are other people).
select ok(private.clients_consents_anonymize_client('d0000000-0000-0000-0000-000000000001') >= 0, 'Léa''s anonymisation runs');
select results_eq($$ select (select title from public.signature_requests where id = 'f1000000-0000-0000-0000-000000000001'),
                            (select original_name from public.stored_files where id = 'a1000000-0000-0000-0000-000000000001') $$,
  $$ values ('Consentement — client anonymisé', 'Consentement — client anonymisé — signé.pdf') $$, 'her request''s title and its PDF''s name no longer name her');

select * from finish();
rollback;
