-- Professionnels: notices that say who and stay true, « À surveiller » for documents, the contract's
-- preparation in Historique (migration *_professionals_notices_watch_history.sql; gap audit V7,
-- V18, V19, T3, T4; P4-540 – P4-545).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- =============================================================================
-- Fixtures (as postgres): org A. Admin 01 is also the professional of P2 (her own file); adjointe
-- 02 reviews documents; provider 03 is P1 (female).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
   'Ada', 'Deux', 'u1@a.test', 'draft', null);
insert into public.professional_public_profiles (org_id, professional_id)
select org_id, id from public.professionals where org_id = 'b0000000-0000-0000-0000-00000000000a';
insert into public.professional_matching_profiles (org_id, professional_id)
select org_id, id from public.professionals where org_id = 'b0000000-0000-0000-0000-00000000000a';
-- Ready uploads, as storage-confirm leaves them: e1, e2 hers (P1), e3 the admin's for P2.
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until, uploaded_by, confirmed_at)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-00000000000' || n || '.pdf',
       'professionals',
       case when n < 3 then 'professional_self_document' else 'professional_document' end,
       'professional', case when n < 3 then 'c0000000-0000-0000-0000-000000000001' else 'c0000000-0000-0000-0000-000000000002' end::uuid,
       'cv.pdf', 'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view',
       case when n < 3 then 'a0000000-0000-0000-0000-000000000003' else 'a0000000-0000-0000-0000-000000000001' end::uuid,
       'professionals.self', now() + interval '1 day',
       case when n < 3 then 'a0000000-0000-0000-0000-000000000003' else 'a0000000-0000-0000-0000-000000000001' end::uuid, now()
  from generate_series(1, 3) n;

-- =============================================================================
-- V18: the notice names who uploaded
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.d1', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
  'e0000000-0000-0000-0000-000000000001')::text, true);
-- The admin on her own file: pending (nobody verifies her own document, P4-304).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d3', public.attach_professional_document('c0000000-0000-0000-0000-000000000002', 'cv',
  'e0000000-0000-0000-0000-000000000003')::text, true);
reset role;

select is((select n.body from public.notifications n where n.subject_id = current_setting('test.d1')::uuid),
  'Pia Un · CV · téléversé par la professionnelle.', 'her own upload: « téléversé par la professionnelle »');
select is((select n.body from public.notifications n where n.subject_id = current_setting('test.d3')::uuid),
  'Ada Deux · CV · téléversé par Admin A.', 'a staff upload names the staff member');

-- =============================================================================
-- T3: the owner of a file is not alerted by it (P4-543)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.list_my_notifications(null, 20, 'important', true) n
            where n.body like 'Ada Deux%'), 0, 'the admin is not alerted by her own file''s document');
select is((select count(*)::int from public.list_my_notifications(null, 20, 'important', true) n
            where n.body like 'Pia Un%'), 1, '… but is by another file''s');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.list_my_notifications(null, 20, 'important', true)), 2,
  'the other reviewer sees both');
reset role;

-- =============================================================================
-- T3: a newer document of the type closes the older one's notice; deactivation closes them all
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.d2', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
  'e0000000-0000-0000-0000-000000000002')::text, true);
reset role;
select results_eq($$ select n.subject_id::text, n.expires_at is null from public.notifications n
                      where n.subject_id in (current_setting('test.d1')::uuid, current_setting('test.d2')::uuid)
                      order by n.subject_id = current_setting('test.d2')::uuid $$,
  $$ values (current_setting('test.d1'), false), (current_setting('test.d2'), true) $$,
  'the newer CV keeps the notice, the older one''s is closed');

-- The list and the record count her documents waiting for review (both still pending).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select l.documents_to_review from public.professionals_list l where l.id = 'c0000000-0000-0000-0000-000000000001'),
  2, 'the list counts the pending documents');
select is((public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') ->> 'documents_to_review')::int,
  2, 'so does the record''s readiness');
reset role;

update public.professionals
   set status = 'inactive', status_changed_at = now(),
       deactivation_reason_id = (select r.id from public.deactivation_reasons r
                                  where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'other'),
       deactivation_note = 'Test'
 where id = 'c0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notifications n
            where n.kind = 'professionals.document_to_review' and n.subject_id = current_setting('test.d2')::uuid
              and (n.expires_at is null or n.expires_at > now())), 0,
  'an inactive file''s review notices close');
select is((select status from public.professional_documents where id = current_setting('test.d2')::uuid), 'pending',
  '… the document stays pending');

-- =============================================================================
-- T3 and V7: « Documents requis manquants », per count, to the filtered list
-- =============================================================================
update public.professionals
   set status = 'active', deactivation_reason_id = null, deactivation_note = null
 where id = 'c0000000-0000-0000-0000-000000000001';
set local role service_role;
select is((public.run_professionals_document_notices_for_service('b0000000-0000-0000-0000-00000000000a') ->> 'missing')::int,
  1, 'one active file misses documents');
reset role;
select results_eq($$ select n.link_path, n.body from public.notifications n
                      where n.kind = 'professionals.documents_missing' and (n.expires_at is null or n.expires_at > now()) $$,
  $$ values ('/professionnels?statut=actif&documents=incomplets'::text, '1 professionnel actif n''a pas tous ses documents requis.'::text) $$,
  'the notice opens the list on active files with incomplete documents');
set local role service_role;
select public.run_professionals_document_notices_for_service('b0000000-0000-0000-0000-00000000000a');
reset role;
select is((select count(*)::int from public.notifications n where n.kind = 'professionals.documents_missing'), 1,
  'the same count again: the same notice');

update public.professionals set status = 'active' where id = 'c0000000-0000-0000-0000-000000000002';
set local role service_role;
select public.run_professionals_document_notices_for_service('b0000000-0000-0000-0000-00000000000a');
reset role;
select results_eq($$ select n.body, n.expires_at is null or n.expires_at > now() from public.notifications n
                      where n.kind = 'professionals.documents_missing' order by n.body $$,
  $$ values ('1 professionnel actif n''a pas tous ses documents requis.'::text, false),
            ('2 professionnels actifs n''ont pas tous leurs documents requis.'::text, true) $$,
  'a new count: a new notice, the old one closed');

-- =============================================================================
-- T4: the contract's preparation in Historique, without what it prints
-- =============================================================================
select is((select 'professional_contract_snapshots' = any (private.professional_history_tables())), true,
  'snapshots are part of the history');
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields, actor_id, source) values
  ('b0000000-0000-0000-0000-00000000000a', 'professional_contract_snapshots',
   'c0000000-0000-0000-0000-000000000001:f0000000-0000-0000-0000-000000000001', 'insert',
   '{"title": "Contrat", "annexe": {"rows": [1]}, "template_values": "[redacted]"}', 'a0000000-0000-0000-0000-000000000001',
   'rpc:prepare_professional_contract'),
  ('b0000000-0000-0000-0000-00000000000a', 'professional_contract_snapshots',
   'c0000000-0000-0000-0000-000000000001:f0000000-0000-0000-0000-000000000001', 'update',
   '{"title": {"before": "a", "after": "b"}}', null, 'system');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select h.action, h.changed_fields from public.list_professional_history('c0000000-0000-0000-0000-000000000001') h
                      where h.table_name = 'professional_contract_snapshots' $$,
  $$ values ('insert'::text, '{"renewal": false}'::jsonb) $$,
  'a preparation is one event, with nothing it prints (no Annexe A)');
reset role;
insert into public.professional_paper_contracts (org_id, professional_id, stored_file_id, signed_on, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003',
        current_date, now() - interval '1 day');
set local role authenticated;
select results_eq($$ select h.changed_fields from public.list_professional_history('c0000000-0000-0000-0000-000000000001') h
                      where h.table_name = 'professional_contract_snapshots' $$,
  $$ values ('{"renewal": true}'::jsonb) $$,
  'prepared while a contract was in force: a renewal');
reset role;

-- =============================================================================
-- V19: the reviewers' email says what was sent
-- =============================================================================
select results_eq($$ select d.subject, d.variables @> '[{"path": "submission.description", "required": true}]'
                       from public.email_template_defaults d where d.key = 'professionals.submission_received' $$,
  $$ values ('{{professional.full_name}} a envoyé {{submission.description}}'::text, true) $$,
  'the default names what was sent (a declared variable)');
select ok((select d.body like '%{{submission.description}}%' from public.email_template_defaults d
            where d.key = 'professionals.submission_received'), '… in the body too');

select * from finish();
rollback;
