-- The service contract signed outside the app and the contract's renewal (migration
-- *_professionals_contract_paper_renew.sql, decisions P4-520 … P4-527).
-- Covers: privileges and the upload purpose; record_professional_paper_contract (permissions, the
-- date, the file, another clinic, an open request, the stored file attached); readiness (a paper
-- contract counts, a renewal out or refused never undoes a signed one); the card (current,
-- request, previous, by reader); prepare_professional_contract's `renew` and the send /
-- regenerate rules once a contract is in force; the history.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

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
-- Privileges and the upload purpose
-- =============================================================================
select function_privs_are('public', 'record_professional_paper_contract', array['uuid', 'uuid', 'date'], 'authenticated', array['EXECUTE'],
  'authenticated may record a paper contract (the RPC checks the permissions)');
select function_privs_are('public', 'record_professional_paper_contract', array['uuid', 'uuid', 'date'], 'anon', array[]::text[],
  'anon may not');
select function_privs_are('public', 'record_professional_paper_contract', array['uuid', 'uuid', 'date'], 'service_role', array[]::text[],
  'nor the service role (user-scoped)');
select table_privs_are('public', 'professional_paper_contracts', 'authenticated', array[]::text[],
  'authenticated: nothing on the paper contracts (read through get_professional_contract)');
select table_privs_are('public', 'professional_paper_contracts', 'anon', array[]::text[], 'anon: nothing');
select results_eq($$ select u.module_key, u.bucket, u.upload_permission, u.view_permission, u.owner_permission, u.max_bytes, u.mime_types, u.retain_days
                       from public.upload_purposes u where u.key = 'professional_contract' $$,
  $$ values ('professionals'::text, 'signed-documents'::text, 'professionals.contracts.send'::text, 'professionals.compensation'::text,
             null::text, 20971520, array['application/pdf']::text[], 1) $$,
  'purpose professional_contract: PDF, 20 Mo, uploaded by contract senders, read with professionals.compensation, staged a day');

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a conseillère; org B with an admin.
-- P1 psychologue (licence, address, a retention rate): the renewal; P2: the paper contract;
-- P3: nothing; P4: org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, legal_name, address_line1, city, province, postal_code, signatory_name, signatory_title, signatory_email) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'Clinique A inc.', '100, rue Principale', 'Québec', 'QC', 'G1A 1A1', 'Dominique Exemple', 'présidente', 'direction@clinique-a.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', null, null, null, null, null, null, null, null);
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

select set_config('test.psy', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.tpl', (select t.id::text from public.document_templates t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.service_contract'), true);
select set_config('test.v1',  (select v.id::text from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid), true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, gender, address_line1, city, province, postal_code, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Un', 'pia@exemple.ca', 'female',
   '200, avenue Exemple', 'Lévis', 'QC', 'G6V 1A1', 'invited'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Paule', 'Deux', 'paule@exemple.ca', null, null, null, 'QC', null, 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', null, 'Noé', 'Trois', 'noe@exemple.ca', null, null, null, 'QC', null, 'draft'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Quatre', 'pat@exemple.ca', null, null, null, 'QC', null, 'draft');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.psy')::uuid, '12345-67', true);
insert into public.professional_retention (org_id, professional_id, retention_pct, decision, effective_from) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 27.5, 'initial', date '2026-07-01');

-- The template published (as the admin), as Mise en service will.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.publish_template_version(current_setting('test.v1')::uuid);
reset role;

-- Staged uploads (as storage-confirm leaves them): f1, f2 contracts by the admin for P2; f3 by
-- the admin of org B; fd a document of another purpose.
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, retain_until, uploaded_by, confirmed_at)
select f.id::uuid, f.org::uuid, f.bucket, f.org || '/professionals/' || f.subject || '/' || f.id || '.pdf',
       'professionals', f.purpose, 'professional', f.subject::uuid, f.name, 'application/pdf', 'pdf',
       2000, repeat('b', 64), 'ready', f.view, now() + interval '1 day', f.by::uuid, now()
  from (values
    ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'professional_contract',
     'c0000000-0000-0000-0000-000000000002', 'Contrat papier 2023.pdf', 'professionals.compensation', 'a0000000-0000-0000-0000-000000000001'),
    ('f1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'professional_contract',
     'c0000000-0000-0000-0000-000000000002', 'Contrat papier 2025.pdf', 'professionals.compensation', 'a0000000-0000-0000-0000-000000000001'),
    ('f1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'signed-documents', 'professional_contract',
     'c0000000-0000-0000-0000-000000000004', 'Contrat B.pdf', 'professionals.compensation', 'a0000000-0000-0000-0000-000000000005'),
    ('f1000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-00000000000a', 'documents', 'professional_document',
     'c0000000-0000-0000-0000-000000000002', 'CV.pdf', 'professionals.view', 'a0000000-0000-0000-0000-000000000001')
  ) as f(id, org, bucket, purpose, subject, name, view, by);

-- An old request of P2's that expired unsigned, an hour before anything else.
insert into public.signature_requests (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, expired_at, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract', current_setting('test.v1')::uuid,
        'professional', 'c0000000-0000-0000-0000-000000000002', 'Contrat de service — Paule Deux', 'expired', 'envelope_paule_old',
        'paule-old', 'professionals.compensation', now() - interval '1 hour', now() - interval '50 minutes', now() - interval '1 hour');

-- =============================================================================
-- « Préparer un nouveau contrat » needs a contract in force
-- =============================================================================
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'renew', 'p1') $$),
  'contract', 'renew without a contract in force: refused (HINT contract)');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'renew', 'p1') $$,
  'P0001', 'Aucun contrat signé à remplacer : utilisez « Préparer le contrat ».', 'said in words');

-- =============================================================================
-- record_professional_paper_contract
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', date '2023-05-01') $$,
  '42501', null, 'the adjointe (no professionals.contracts.send, no .compensation) is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', date '2023-05-01') $$,
  '42501', null, 'the conseillère is refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001',
                                                                                     ((now() at time zone 'America/Toronto')::date + 1)) $$),
  'signed_on', 'a signature date in the future: refused (HINT signed_on)');
select throws_ok($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', ((now() at time zone 'America/Toronto')::date + 1)) $$,
  'P0001', 'La date de signature ne peut pas être dans le futur.', 'said in words');
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', date '1999-12-31') $$),
  'signed_on', 'before 2000: refused (HINT signed_on)');
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', null) $$),
  'signed_on', 'no date: refused (HINT signed_on)');
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-00000000000d', date '2023-05-01') $$),
  'file', 'a file of another purpose: refused (HINT file)');
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003', date '2023-05-01') $$),
  'file', 'another clinic''s file: refused (HINT file)');
select throws_ok($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000001', date '2023-05-01') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is unknown');

select set_config('test.pc1', public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', date '2023-05-01')::text, true);
reset role;
select results_eq($$ select c.org_id, c.professional_id, c.stored_file_id, c.signed_on, c.created_by
                       from public.professional_paper_contracts c where c.id = current_setting('test.pc1')::uuid $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 'f1000000-0000-0000-0000-000000000001'::uuid,
             date '2023-05-01', 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the paper contract is recorded: the file, the signature date, who uploaded it');
select results_eq($$ select f.subject_type, f.subject_id, f.view_permission, f.retain_until, f.owner_profile_id
                       from public.stored_files f where f.id = 'f1000000-0000-0000-0000-000000000001' $$,
  $$ values ('professional'::text, 'c0000000-0000-0000-0000-000000000002'::uuid, 'professionals.compensation'::text, null::timestamptz, null::uuid) $$,
  'its file is kept (no deadline), read with professionals.compensation only, owned by no one');
select is((select count(*)::int from public.audit_log a where a.table_name = 'professional_paper_contracts' and a.action = 'insert'
            and a.record_id = 'c0000000-0000-0000-0000-000000000002:' || current_setting('test.pc1')), 1,
  'audited under the professional''s record prefix');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', date '2023-05-01') $$),
  'file', 'the same file twice: refused (HINT file)');

-- Readiness: the paper contract counts, for every reader.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select r.contract_signed from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000002'), true,
  'a paper contract makes « Contrat de service signé » done (the conseillère)');
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000002') -> 'items' -> 4,
  '{"key": "contract_signed", "done": true, "missing": []}'::jsonb, 'and in get_professional_readiness');

-- The card for the conseillère: the paper contract in force, never its file; the old expired
-- request is history, not « the request ».
select set_config('test.card', public.get_professional_contract('c0000000-0000-0000-0000-000000000002')::text, true);
select results_eq($$ select c -> 'current' ->> 'kind', c -> 'current' ->> 'id', c -> 'current' ->> 'signed_on', (c -> 'current' ->> 'can_read')::boolean,
                            c -> 'current' -> 'file', c -> 'current' ->> 'uploaded_by_name', c -> 'request', c -> 'previous'
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values ('paper'::text, current_setting('test.pc1'), '2023-05-01'::text, false, 'null'::jsonb, 'Admin A'::text, 'null'::jsonb, '[]'::jsonb) $$,
  'the conseillère: the paper contract in force, its date and uploader, no file; the older expired request is not shown as current work');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_professional_contract('c0000000-0000-0000-0000-000000000002') -> 'current' -> 'file',
  '{"id": "f1000000-0000-0000-0000-000000000001", "name": "Contrat papier 2023.pdf", "mime_type": "application/pdf", "size_bytes": 2000}'::jsonb,
  'the admin gets the file to open');
select is(public.get_professional_contract('c0000000-0000-0000-0000-000000000003') - 'template' - 'clinic_signer',
  '{"current": null, "request": null, "previous": []}'::jsonb, 'a file without any contract: nothing in force, no request, no previous');
reset role;

-- « Remplacer »: a second paper contract (a moment later) becomes the one in force; the first is
-- previous. (The first is dated back by hand: one transaction makes now() constant.)
update public.professional_paper_contracts set created_at = now() - interval '5 minutes' where id = current_setting('test.pc1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.pc2', public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', date '2025-01-15')::text, true);
select set_config('test.card', public.get_professional_contract('c0000000-0000-0000-0000-000000000002')::text, true);
select results_eq($$ select c -> 'current' ->> 'id', c -> 'current' ->> 'signed_on', jsonb_array_length(c -> 'previous'),
                            c -> 'previous' -> 0 ->> 'kind', c -> 'previous' -> 0 ->> 'id', c -> 'previous' -> 0 ->> 'signed_on',
                            c -> 'previous' -> 0 -> 'file' ->> 'id'
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values (current_setting('test.pc2'), '2025-01-15'::text, 1, 'paper'::text, current_setting('test.pc1'), '2023-05-01'::text,
             'f1000000-0000-0000-0000-000000000001'::text) $$,
  'replaced: the new paper contract is in force; the first one is listed under the previous contracts, its file kept');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_contract('c0000000-0000-0000-0000-000000000002') -> 'previous' -> 0 -> 'file', 'null'::jsonb,
  'a previous contract''s file is for compensation readers only');
reset role;

-- =============================================================================
-- The renewal (P1): a Documenso contract signed, then a new one
-- =============================================================================
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
values ('f2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/d0000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001.pdf',
        'core', 'signing_signed', 'signature_request', 'd0000000-0000-0000-0000-000000000001', 'professionals.compensation',
        'Contrat signé.pdf', 'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now());
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, completed_event_at, completed_at,
                                       signed_file_id, signed_sha256, created_at)
values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract',
        current_setting('test.v1')::uuid, 'professional', 'c0000000-0000-0000-0000-000000000001', 'Contrat de service — Pia Un', 'signed',
        'envelope_pia_one', 'pia-one', 'professionals.compensation', now() - interval '10 minutes', now() - interval '2 minutes',
        now() - interval '2 minutes', 'f2000000-0000-0000-0000-000000000001', repeat('a', 64), now() - interval '10 minutes');

select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'q1') $$),
  'contract', 'send once a contract is signed: refused (HINT contract)');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'q1') $$,
  'P0001', 'Le contrat de service de ce professionnel est déjà signé : utilisez « Préparer un nouveau contrat ».', 'said in words, naming the action');
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'q1') $$),
  'contract', 'a signed contract is still never regenerated (P4-438)');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'renew', 'q1') $$,
  '42501', null, 'renew needs professionals.contracts.send and .compensation (the adjointe is refused)');

select set_config('test.prep', public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'renew', 'q1')::text, true);
select results_eq($$ select p ->> 'idempotency_key', p -> 'cancel', p ->> 'title' from (select current_setting('test.prep')::jsonb p) x $$,
  $$ values ('professionals.service_contract:c0000000-0000-0000-0000-000000000001:q1'::text, 'null'::jsonb, 'Contrat de service — Pia Un'::text) $$,
  'renew: a new request key, nothing to cancel (the signed contract stays), today''s terms');
select is((select count(*)::int from public.professional_contract_snapshots s where s.idempotency_key like '%:q1'), 1, 'its snapshot is written once');

-- The renewal sent (as the function would).
select set_config('test.r2', (select r.id::text from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.service_contract',
  'template_version_id', current_setting('test.v1'), 'subject_type', 'professional', 'subject_id', 'c0000000-0000-0000-0000-000000000001',
  'title', 'Contrat de service — Pia Un', 'view_permission', 'professionals.compensation',
  'idempotency_key', 'professionals.service_contract:c0000000-0000-0000-0000-000000000001:q1',
  'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', current_setting('test.prep')::jsonb -> 'signers')) r), true);
select lives_ok($$ select 1 $$, 'a renewal coexists with the signed request (one open request per record and purpose)');
update public.signature_requests set status = 'sent', envelope_id = 'envelope_pia_two', sent_at = now(), expires_at = now() + interval '7 days',
       created_at = now() - interval '1 minute'
 where id = current_setting('test.r2')::uuid;

select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'renew', 'q2') $$),
  'contract', 'renew while the new one is out: refused (one live contract)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select r.contract_signed from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001'), true,
  'while the new one is out for signature, the signed one keeps the item done');
select set_config('test.card', public.get_professional_contract('c0000000-0000-0000-0000-000000000001')::text, true);
select results_eq($$ select c -> 'current' ->> 'kind', c -> 'current' -> 'request' ->> 'id', c -> 'current' -> 'request' ->> 'status',
                            c -> 'current' -> 'request' -> 'signed_file_id', c -> 'request' ->> 'id', c -> 'request' ->> 'status', c -> 'previous'
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values ('signed'::text, 'd0000000-0000-0000-0000-000000000001'::text, 'signed'::text, 'null'::jsonb,
             current_setting('test.r2'), 'sent'::text, '[]'::jsonb) $$,
  'the card: the signed contract in force (no file for the conseillère), the new one as the request at work');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_professional_contract('c0000000-0000-0000-0000-000000000001') -> 'current' -> 'request' ->> 'signed_file_id',
  'f2000000-0000-0000-0000-000000000001', 'the admin gets the signed PDF of the contract in force');
select is(private.test_error_hint($$ select public.record_professional_paper_contract('c0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', date '2024-01-01') $$),
  'contract', 'no paper contract while a contract waits for a signature (HINT contract)');
reset role;

-- « Régénérer » the renewal: it names the renewal to cancel, never the signed one.
select is(public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'q3') -> 'cancel',
  jsonb_build_object('request_id', current_setting('test.r2'), 'envelope_id', 'envelope_pia_two', 'status', 'sent'),
  'regenerate during a renewal cancels the renewal only');

-- The renewal refused: the signed contract stays in force.
update public.signature_requests set status = 'rejected', rejected_at = now() where id = current_setting('test.r2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select r.contract_signed from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001'), true,
  'a refused renewal never undoes the signed contract');
select results_eq($$ select c -> 'current' -> 'request' ->> 'id', c -> 'request' ->> 'status'
                       from (select public.get_professional_contract('c0000000-0000-0000-0000-000000000001') c) x $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::text, 'rejected'::text) $$,
  'the card shows the refused renewal beside the contract in force');
reset role;
select is(public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'q4') -> 'cancel',
  'null'::jsonb, 'after a refused renewal, « Régénérer » prepares another one, nothing to cancel');

-- A renewal signed: it becomes the contract in force; the first one is previous.
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, completed_event_at, completed_at,
                                       signed_file_id, signed_sha256, page_count, created_at)
values ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract',
        current_setting('test.v1')::uuid, 'professional', 'c0000000-0000-0000-0000-000000000001', 'Contrat de service — Pia Un', 'signed',
        'envelope_pia_three', 'pia-three', 'professionals.compensation', now(), now(), now(),
        'f2000000-0000-0000-0000-000000000001', repeat('a', 64), 4, now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.card', public.get_professional_contract('c0000000-0000-0000-0000-000000000001')::text, true);
select results_eq($$ select c -> 'current' -> 'request' ->> 'id', c -> 'request', jsonb_array_length(c -> 'previous'),
                            c -> 'previous' -> 0 ->> 'kind', c -> 'previous' -> 0 -> 'request' ->> 'id',
                            c -> 'previous' -> 0 -> 'request' ->> 'signed_file_id'
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values ('d0000000-0000-0000-0000-000000000003'::text, 'null'::jsonb, 1, 'signed'::text, 'd0000000-0000-0000-0000-000000000001'::text,
             'f2000000-0000-0000-0000-000000000001'::text) $$,
  'signed: the new contract is in force, nothing at work, the first one listed under the previous contracts with its PDF');
select ok(position(current_setting('test.r2') in current_setting('test.card')) = 0,
  'a refused renewal is never a previous contract (it never was in force)');
reset role;

-- A paper contract in force can be renewed through Documenso too.
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'renew', 'p2') $$),
  'profession', 'renew a paper contract: allowed (the next refusal is the terms'': Paule has no title yet)');
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'regenerate', 'p3') $$),
  'contract', 'regenerate with nothing after the paper contract in force: refused');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'cancel', 'p3') $$,
  '22023', null, 'an unknown action is still refused');

-- =============================================================================
-- History
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select h.action, h.changed_fields ->> 'signed_on'
                       from public.list_professional_history('c0000000-0000-0000-0000-000000000002', null, 200) h
                      where h.table_name = 'professional_paper_contracts' and h.action = 'insert' order by h.id $$,
  $$ values ('insert'::text, '2023-05-01'::text), ('insert'::text, '2025-01-15'::text) $$,
  'Historique lists each paper contract uploaded, with its signature date (professionals.view)');
select is_empty($$ select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
                    where h.table_name = 'professional_paper_contracts' $$,
  'another professional''s history holds none of them');
reset role;

select * from finish();
rollback;
