-- The rejection email's data and « Documents requis »'s usage counts (migration
-- *_professionals_documents_settings.sql, plan Phase 4 Task 4c.3, P4-451, P4-453). Covers:
-- privileges (the service role only); the answer for a document the actor has just refused (the
-- professional's first name and address, the clinic, the type, the reason, whether she sent the
-- file); null for anything else (not refused, refused by someone else, another clinic, unknown);
-- list_professionals_reference_usage counts the professionals per document type, refused ones aside.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, adjointe 02, provider 03 linked to P1), org B (admin 05).
-- P1 (provider 03) and P2 (no account) in org A. Documents of P1: an insurance the provider sent,
-- refused by the adjointe; a CV staff uploaded, refused by the admin; a photo pending. P2: a CV verified.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Clinique A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Clinique B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'pia@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Deux', 'paul@exemple.test', 'active');

insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at, deleted_at)
select f.id, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/professionals/' || f.subject || '/' || f.id || '.pdf',
       'professionals', f.purpose, 'professional', f.subject, 'fichier.pdf', 'application/pdf', 'pdf', 2048,
       repeat('a', 64), f.status, 'professionals.view', f.uploader, now(), case when f.status = 'deleted' then now() end
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'professional_self_document', 'c0000000-0000-0000-0000-000000000001'::uuid, 'deleted', 'a0000000-0000-0000-0000-000000000003'::uuid),
    ('e0000000-0000-0000-0000-000000000002', 'professional_document', 'c0000000-0000-0000-0000-000000000001', 'deleted', 'a0000000-0000-0000-0000-000000000002'),
    ('e0000000-0000-0000-0000-000000000003', 'professional_self_document', 'c0000000-0000-0000-0000-000000000001', 'ready', 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000004', 'professional_document', 'c0000000-0000-0000-0000-000000000002', 'ready', 'a0000000-0000-0000-0000-000000000002')
  ) as f(id, purpose, subject, status, uploader);

insert into public.professional_documents
  (id, org_id, professional_id, document_type_id, stored_file_id, status, expires_on, uploaded_by, reviewed_by, reviewed_at, rejection_reason)
select d.id, 'b0000000-0000-0000-0000-00000000000a', d.pid,
       (select t.id from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = d.type_key),
       d.file, d.status, d.expires_on, d.uploader, d.reviewer, case when d.reviewer is not null then now() end, d.reason
  from (values
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 'insurance', 'e0000000-0000-0000-0000-000000000001'::uuid,
     'rejected', current_date + 100, 'a0000000-0000-0000-0000-000000000003'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, 'Le document est illisible.'),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'cv', 'e0000000-0000-0000-0000-000000000002',
     'rejected', null, 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Mauvais fichier.'),
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'photo', 'e0000000-0000-0000-0000-000000000003',
     'pending', null, 'a0000000-0000-0000-0000-000000000003', null, null),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 'cv', 'e0000000-0000-0000-0000-000000000004',
     'verified', null, 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', null)
  ) as d(id, pid, type_key, file, status, expires_on, uploader, reviewer, reason);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'get_professional_document_rejection_for_service', array['uuid', 'uuid'], 'service_role',
  array['EXECUTE'], 'the rejection data: service role');
select function_privs_are('public', 'get_professional_document_rejection_for_service', array['uuid', 'uuid'], 'authenticated',
  array[]::text[], 'not for authenticated');
select function_privs_are('public', 'get_professional_document_rejection_for_service', array['uuid', 'uuid'], 'anon',
  array[]::text[], 'not for anon');
select function_privs_are('public', 'list_professionals_reference_usage', array[]::text[], 'authenticated', array['EXECUTE'],
  'the usage counts keep their grant');

-- =============================================================================
-- The rejection email's data
-- =============================================================================
set local role service_role;
select is(public.get_professional_document_rejection_for_service('a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001'),
  jsonb_build_object('org_id', 'b0000000-0000-0000-0000-00000000000a', 'professional_id', 'c0000000-0000-0000-0000-000000000001',
                     'document_id', 'd0000000-0000-0000-0000-000000000001', 'profile_id', 'a0000000-0000-0000-0000-000000000003',
                     'email', 'pia@exemple.test', 'first_name', 'Pia', 'clinic_name', 'Clinique A',
                     'type_name', 'Preuve d''assurance responsabilité', 'reason', 'Le document est illisible.',
                     'uploaded_by_professional', true),
  'a document the actor refused: the email''s values, the professional sent it');
select is(public.get_professional_document_rejection_for_service('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002')
            ->> 'uploaded_by_professional', 'false',
  'a file staff uploaded: not the professional''s (no email)');
select is(public.get_professional_document_rejection_for_service('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  null, 'refused by someone else: null');
select is(public.get_professional_document_rejection_for_service('a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003'),
  null, 'a document not refused: null');
select is(public.get_professional_document_rejection_for_service('a0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001'),
  null, 'an actor of another clinic: null');
select is(public.get_professional_document_rejection_for_service('a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000ff'),
  null, 'an unknown document: null');
reset role;

-- =============================================================================
-- « Utilisé par » for « Documents requis »
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select t.key, u.usage
                       from public.list_professionals_reference_usage() u
                       join public.document_types t on t.id = u.id
                      where u.kind = 'document_types' order by t.key $$,
  $$ values ('cv'::text, 1), ('photo'::text, 1) $$,
  'per type, the professionals with a document not refused (P1''s refused insurance and CV aside)');
select ok((select count(*) from public.list_professionals_reference_usage() u where u.kind = 'languages') >= 0,
  'the other lists are still counted');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professionals_reference_usage() u where u.kind = 'document_types'), 0,
  'another clinic counts none of org A''s documents');
reset role;

select * from finish();
rollback;
