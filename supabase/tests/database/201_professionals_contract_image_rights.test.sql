-- Professionnels: the service contract carries the image rights (migration
-- *_professionals_contract_image_rights.sql, decisions P4-557 … P4-560).
-- Covers: privileges (the withdrawals table closed, the helpers); the published contract's mark;
-- a signed contract granting the rights counts as the consent (valid_until, readiness for a
-- reader and for a job, get_professional_documents, get_my_image_consent, the review sheet); a
-- newer paper contract does not grant; the withdrawal (recorded on the professional, a notice
-- period corrected, it wins over a later contract, a separate consent signed later is in force,
-- nothing to withdraw); the questionnaire (no consent section for a new professional once the
-- contract grants; an older draft's consent section complete); history; the backfill.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'professional_image_rights_withdrawals', 'authenticated', array[]::text[],
  'authenticated: nothing on the withdrawals (read through the definer RPCs)');
select table_privs_are('public', 'professional_image_rights_withdrawals', 'anon', array[]::text[], 'anon: nothing');
select function_privs_are('private', 'professional_contract_image_rights', array[]::text[], 'authenticated', array['EXECUTE'],
  'the invoker readiness view calls the contract-rights helper');
select function_privs_are('private', 'contract_image_rights', array['uuid'], 'authenticated', array[]::text[],
  'no client calls the per-clinic helper');
select function_privs_are('private', 'service_contract_grants_image_rights', array['uuid'], 'authenticated', array[]::text[],
  'no client calls the published-contract helper');
select function_privs_are('private', 'image_rights_by_next_contract', array['uuid', 'uuid'], 'authenticated', array[]::text[],
  'no client calls the next-contract helper');
select function_privs_are('private', 'professionals_image_rights_backfill', array[]::text[], 'authenticated', array[]::text[],
  'no client runs the backfill');

-- =============================================================================
-- Fixtures (as postgres): org A (identity complete). 01 admin, 02 adjointe (reviews documents),
-- 03 conseillère, 04 provider linked to P3. P1 Pia, P2 Paul, P3 Nora, P4 Lou, P5 Max.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name, legal_name, address_line1, city, province, postal_code, signatory_name, signatory_title) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'Clinique A inc.', '100, rue Principale', 'Québec', 'QC', 'G1A 1A1', 'Dominique Exemple', 'présidente');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u3@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Nora Trois', 'u4@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Un', 'p1@a.test', 'invited'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Deux', 'p2@a.test', 'invited'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'Nora', 'Trois', 'u4@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', null, 'Lou', 'Quatre', 'p4@a.test', 'invited'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', null, 'Max', 'Cinq', 'p5@a.test', 'invited');
insert into public.professional_public_profiles (org_id, professional_id)
select org_id, id from public.professionals where org_id = 'b0000000-0000-0000-0000-00000000000a';
insert into public.professional_matching_profiles (org_id, professional_id)
select org_id, id from public.professionals where org_id = 'b0000000-0000-0000-0000-00000000000a';
select set_config('test.v1', (select v.id::text from public.document_templates t
                                join public.document_template_versions v on v.template_id = t.id
                               where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.service_contract'), true);
-- The separate « Consentement au droit à l'image » is published (so the questionnaire's step has something to sign).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.publish_template_version((select v.id from public.document_templates t
                                          join public.document_template_versions v on v.template_id = t.id
                                         where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.image_consent'));
reset role;

-- =============================================================================
-- Before publication: nothing grants, the questionnaire still asks for the consent
-- =============================================================================
select is(private.service_contract_grants_image_rights('b0000000-0000-0000-0000-00000000000a'), false,
  'no published contract: the contract grants nothing yet');
select set_config('test.sub4', private.create_professional_submission('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004',
                                                                       'onboarding', private.submission_sections(), null, 'a0000000-0000-0000-0000-000000000001')::text, true);
select ok((select 'consent' = any (s.requested_sections) from public.professional_submissions s
            where s.id = current_setting('test.sub4')::uuid),
  'an invitation before publication still asks for the consent');
select ok((select private.submission_gaps(s) @> array['consent'] from public.professional_submissions s
            where s.id = current_setting('test.sub4')::uuid),
  '… and the step is to complete (the separate form is published)');

-- The admin publishes the 2026 contract (the seeded draft).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.publish_template_version(current_setting('test.v1')::uuid);
reset role;
select is(private.service_contract_grants_image_rights('b0000000-0000-0000-0000-00000000000a'), true,
  'the published 2026 contract grants the image rights');
select set_config('test.sub5', private.create_professional_submission('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005',
                                                                       'onboarding', private.submission_sections(), null, 'a0000000-0000-0000-0000-000000000001')::text, true);
select ok((select not ('consent' = any (s.requested_sections)) and pg_catalog.cardinality(s.requested_sections) = 10
             from public.professional_submissions s
            where s.id = current_setting('test.sub5')::uuid),
  'an invitation now: no consent section (the contract carries it)');
-- Lou's draft opened before: its consent section is complete (nothing to sign there).
select is((select private.submission_gaps(s) from public.professional_submissions s
            where s.id = current_setting('test.sub4')::uuid) @> array['consent'], false,
  'an older draft''s consent section no longer blocks');

-- =============================================================================
-- A signed contract granting the rights counts as the consent
-- =============================================================================
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
select ('f2000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
       'b0000000-0000-0000-0000-00000000000a/core/d0000000-0000-0000-0000-00000000000' || n || '/f2000000-0000-0000-0000-00000000000' || n || '.pdf',
       'core', 'signing_signed', 'signature_request', ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'professionals.compensation',
       'Contrat signé.pdf', 'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now()
  from generate_series(1, 5) n;
-- d1 Pia, d3 Nora, d4 Lou: signed on the 2026 version; d5 Pia's renewal (later); d2 is unused.
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, completed_event_at, completed_at,
                                       signed_file_id, signed_sha256, created_at)
select ('d0000000-0000-0000-0000-00000000000' || x.n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract',
       current_setting('test.v1')::uuid, 'professional', x.pid, 'Contrat de service', 'signed', 'envelope_' || x.n, 'key-' || x.n,
       'professionals.compensation', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days',
       ('f2000000-0000-0000-0000-00000000000' || x.n)::uuid, repeat('a', 64), now() - interval '3 days'
  from (values (1, 'c0000000-0000-0000-0000-000000000001'::uuid), (3, 'c0000000-0000-0000-0000-000000000003'::uuid),
               (4, 'c0000000-0000-0000-0000-000000000004'::uuid)) x(n, pid);

select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  date '2100-12-31', 'Pia''s signed 2026 contract counts as her image consent (no end date)');
-- As a job reads it: no user.
select set_config('request.jwt.claims', '', true);
select results_eq($$ select r.consent_ok, 'image_consent' = any (r.documents_missing) from public.professionals_readiness r
                      where r.professional_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')
                      order by r.professional_id $$,
  $$ values (true, false), (false, true) $$, 'readiness for a job (no user): Pia''s consent is the contract; Paul has none');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001'),
  true, 'the same for the conseillère (who cannot read the contract itself)');
select results_eq($$ select (d -> 'image_rights_contract' ->> 'in_force')::boolean, d -> 'image_rights_contract' ? 'signed_at',
                            (d ->> 'image_rights_next_contract')::boolean, d -> 'image_rights_withdrawal'
                       from (select public.get_professional_documents('c0000000-0000-0000-0000-000000000001') d) x $$,
  $$ values (true, true, false, 'null'::jsonb) $$, 'the Documents tab reads the contract''s rights (in force, signed when)');
select results_eq($$ select d -> 'image_rights_contract', (d ->> 'image_rights_next_contract')::boolean
                       from (select public.get_professional_documents('c0000000-0000-0000-0000-000000000002') d) x $$,
  $$ values ('null'::jsonb, true) $$, 'Paul: no contract yet, so his next one will carry them');
-- Nora, on her own file.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select (c ->> 'by_contract')::boolean, (c ->> 'next_contract_grants')::boolean, c ->> 'valid_until'
                       from (select public.get_my_image_consent() c) x $$,
  $$ values (true, false, '2100-12-31'::text) $$, 'her « Consentement » step: carried by her signed contract');
select is((public.get_professional_documents() -> 'image_rights_contract' ->> 'in_force')::boolean, true,
  '« Mes documents » reads it too');
reset role;

-- The review sheet: an update asking for the consent shows the contract as what is on file.
select set_config('test.sub1', private.create_professional_submission('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                                                                       'update', array['consent'], null, 'a0000000-0000-0000-0000-000000000001')::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_submission_review(current_setting('test.sub1')::uuid) -> 'sections' -> 0 -> 'fields' -> 0 -> 'current' ->> 'source',
  'contract', 'the review sheet: the consent on file is the contract');
reset role;
select is(private.submission_gaps(s), '{}'::text[], 'an update asking for the consent: complete (on file through the contract)')
  from public.professional_submissions s where s.id = current_setting('test.sub1')::uuid;

-- A paper contract recorded later is the contract in force: it grants nothing (Lou).
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
values ('f3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000004/f3000000-0000-0000-0000-000000000001.pdf',
        'professionals', 'professional_contract', 'professional', 'c0000000-0000-0000-0000-000000000004', 'professionals.compensation',
        'Contrat papier.pdf', 'application/pdf', 'pdf', 1000, repeat('b', 64), 'ready', now());
insert into public.professional_paper_contracts (org_id, professional_id, stored_file_id, signed_on, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', 'f3000000-0000-0000-0000-000000000001',
        current_date - 1, now());
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004'),
  null, 'a newer paper contract is the contract in force: no image rights through it');
select ok((select private.submission_gaps(s) @> array['consent'] from public.professional_submissions s
            where s.id = current_setting('test.sub4')::uuid),
  '… so her consent step is to complete again (her next contract is not the one that will carry it)');

-- =============================================================================
-- The withdrawal wins over the contract
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000002', private.clinic_today()) $$,
  'P0001', 'Aucun consentement au droit à l''image en vigueur dans ce dossier.', 'Paul: nothing in force to withdraw');
-- Nora: a notice period, then corrected.
select is(public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000003', private.clinic_today() + 30, 'Avis du 14 oct.'),
  1, 'a withdrawal of the contract''s rights in 30 days is recorded');
reset role;
select isnt(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003'),
  null, '… in force until then');
set local role authenticated;
select is(public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000003', private.clinic_today()),
  1, 'a withdrawal still to come can be corrected');
reset role;
select results_eq($$ select w.withdrawn_on = private.clinic_today_for_org(w.org_id), w.withdrawal_note, w.withdrawn_by
                       from public.professional_image_rights_withdrawals w where w.professional_id = 'c0000000-0000-0000-0000-000000000003' $$,
  $$ values (true, null::text, 'a0000000-0000-0000-0000-000000000002'::uuid) $$, 'one row per professional: the date, the note, who');
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003'),
  null, 'withdrawn: the contract no longer counts');
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003'),
  false, '… readiness says the consent is missing');
set local role authenticated;
select results_eq($$ select (d -> 'image_rights_contract' ->> 'in_force')::boolean, (d -> 'image_rights_withdrawal' ->> 'withdrawn_on')::date = private.clinic_today(),
                            d -> 'image_rights_withdrawal' ->> 'withdrawn_by_name'
                       from (select public.get_professional_documents('c0000000-0000-0000-0000-000000000003') d) x $$,
  $$ values (false, true, 'Adjointe A'::text) $$, 'the Documents tab reads the withdrawal and who recorded it');
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000003', private.clinic_today()) $$,
  'P0001', 'Aucun consentement au droit à l''image en vigueur dans ce dossier.', 'nothing left in force to withdraw');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select (c ->> 'by_contract')::boolean, c ->> 'valid_until' from (select public.get_my_image_consent() c) x $$,
  $$ values (false, null::text) $$, 'her step: no longer carried by the contract');
reset role;

-- A renewal signed later on the same text does not undo the withdrawal.
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, completed_event_at, completed_at,
                                       signed_file_id, signed_sha256, created_at)
values ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract',
        current_setting('test.v1')::uuid, 'professional', 'c0000000-0000-0000-0000-000000000003', 'Contrat de service', 'signed', 'envelope_5', 'key-5',
        'professionals.compensation', now(), now(), now(), 'f2000000-0000-0000-0000-000000000005', repeat('a', 64), now());
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003'),
  null, 'a contract signed after the withdrawal does not grant again (the withdrawal wins)');
-- A separate consent signed later is in force (P4-549).
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
                                 size_bytes, sha256, status, view_permission, confirmed_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000003/e0000000-0000-0000-0000-000000000001.pdf',
        'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000003', 'consentement.pdf',
        'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view', now());
insert into public.professional_documents (org_id, professional_id, document_type_id, stored_file_id, status, reviewed_by, reviewed_at)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', t.id, 'e0000000-0000-0000-0000-000000000001',
       'verified', 'a0000000-0000-0000-0000-000000000002', now()
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003'),
  date '2100-12-31', 'a separate consent signed after the withdrawal is in force');

-- Pia: a withdrawal today marks the contract (no document) and nothing else.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', private.clinic_today()), 1,
  'Pia''s contract rights withdrawn');
reset role;
select is((select count(*)::int from public.audit_log a
            where a.table_name = 'professional_image_rights_withdrawals' and a.record_id = 'c0000000-0000-0000-0000-000000000001'),
  1, 'the recording is audited (Historique)');
select ok('professional_image_rights_withdrawals' = any (private.professional_history_tables()), 'the history reads the withdrawals');

-- =============================================================================
-- The backfill: a withdrawal recorded on a document before this migration wins over a contract
-- =============================================================================
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
                                 size_bytes, sha256, status, view_permission, confirmed_at)
values ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000002/e0000000-0000-0000-0000-000000000002.pdf',
        'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000002', 'consentement.pdf',
        'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view', now());
insert into public.professional_documents (org_id, professional_id, document_type_id, stored_file_id, status, reviewed_by, reviewed_at,
                                           withdrawn_on, withdrawn_at, withdrawn_by)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', t.id, 'e0000000-0000-0000-0000-000000000002',
       'verified', 'a0000000-0000-0000-0000-000000000002', now(), current_date - 10, now() - interval '10 days', 'a0000000-0000-0000-0000-000000000002'
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';
select is(private.professionals_image_rights_backfill(), 1, 'the backfill records Paul''s earlier withdrawal');
select results_eq($$ select w.withdrawn_on, w.withdrawn_by from public.professional_image_rights_withdrawals w
                      where w.professional_id = 'c0000000-0000-0000-0000-000000000002' $$,
  $$ values (current_date - 10, 'a0000000-0000-0000-0000-000000000002'::uuid) $$, '… with its date and who recorded it');
select is(private.professionals_image_rights_backfill(), 0, 'idempotent');

select * from finish();
rollback;
