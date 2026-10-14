-- Professionnels, R-86 (migration *_professionals_receipt_signature): the professional's signature
-- image, printed on her receipts.
-- Covers: privileges; the upload purpose; professionals.manage; a file of the purpose, ready and
-- staged, attached to the professional (no longer staged, the manage permission to read it);
-- a file of another purpose, another clinic's, or another professional's signature refused;
-- the same file again is a no-op; replacing soft-deletes the previous file; removing; the
-- published facts (ready files only, the clinic named only).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select function_privs_are('public', 'set_professional_signature', array['uuid', 'uuid'], 'authenticated', array['EXECUTE'],
  'set_professional_signature: authenticated');
select function_privs_are('public', 'set_professional_signature', array['uuid', 'uuid'], 'anon', array[]::text[],
  'set_professional_signature: not anon');
select function_privs_are('private', 'professional_signature_files', array['uuid', 'uuid[]'], 'authenticated', array[]::text[],
  'professional_signature_files: no role');
select results_eq($$ select module_key, bucket, upload_permission, view_permission, max_bytes, mime_types, retain_days
                      from public.upload_purposes where key = 'professional_signature' $$,
  $$ values ('professionals'::text, 'documents'::text, 'professionals.manage'::text, 'professionals.manage'::text, 2097152,
             array['image/png', 'image/jpeg']::text[], 1) $$,
  'the upload purpose: a PNG or JPEG of 2 Mo, uploaded and read with professionals.manage, staged a day');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o, 'professionals', true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Un', 'pro1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Simon', 'Deux', 'pro2@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Iris', 'Autre', 'pro9@b.test', 'active');
-- f1, f2 signatures for Hélène (staged); f3 another purpose; f4 Org B's; f5 a signature for Simon.
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, retain_until, uploaded_by, confirmed_at)
select f.id, f.org, 'documents', f.org || '/professionals/' || f.subject || '/' || f.id || '.png',
       'professionals', f.purpose, 'professional', f.subject, 'signature.png', 'image/png', 'png', 2048,
       repeat('a', 64), 'ready', f.view, now() + interval '1 day', f.uploader, now()
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'professional_signature', 'c0000000-0000-0000-0000-000000000001'::uuid, 'professionals.manage', 'a0000000-0000-0000-0000-000000000001'::uuid),
    ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professional_signature', 'c0000000-0000-0000-0000-000000000001', 'professionals.manage', 'a0000000-0000-0000-0000-000000000001'),
    ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professional_document', 'c0000000-0000-0000-0000-000000000001', 'professionals.view', 'a0000000-0000-0000-0000-000000000001'),
    ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'professional_signature', 'c0000000-0000-0000-0000-000000000009', 'professionals.manage', 'a0000000-0000-0000-0000-000000000009'),
    ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'professional_signature', 'c0000000-0000-0000-0000-000000000002', 'professionals.manage', 'a0000000-0000-0000-0000-000000000001')
  ) as f(id, org, purpose, subject, view, uploader);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'a counselor (no professionals.manage) is refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Fichier introuvable.', 'a file of another purpose is refused');
select throws_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Fichier introuvable.', 'another clinic''s file is refused');
select throws_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is refused');
select lives_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001') $$,
  'the admin sets Hélène''s signature');
select lives_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000005') $$,
  '… and Simon''s');
select throws_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Fichier introuvable.', 'another professional''s signature is refused');
select lives_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001') $$,
  'the same file again: nothing to do');
reset role;

select is((select p.signature_file_id from public.professionals p where p.id = 'c0000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid, 'Hélène''s record holds the file');
select results_eq($$ select f.subject_id, f.view_permission, f.retain_until is null, f.status from public.stored_files f
                      where f.id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'professionals.manage'::text, true, 'ready'::text) $$,
  '… attached: her file, read with professionals.manage, no longer staged');
select results_eq($$ select s.professional_id, s.file_id, s.bucket from private.professional_signature_files('b0000000-0000-0000-0000-00000000000a',
                        array['c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000009']::uuid[]) s
                      order by s.professional_id $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'documents'::text),
            ('c0000000-0000-0000-0000-000000000002'::uuid, 'e0000000-0000-0000-0000-000000000005'::uuid, 'documents'::text) $$,
  'the published facts: each professional''s ready signature, this clinic''s only');
select is((select s.object_path from private.professional_signature_files('b0000000-0000-0000-0000-00000000000a',
             array['c0000000-0000-0000-0000-000000000001']::uuid[]) s),
  'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-000000000001.png',
  '… with the object path the renderer downloads');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002') $$,
  'replaced by a new image');
reset role;
select results_eq($$ select f.id, f.status from public.stored_files f
                      where f.id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002') order by f.id $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 'deleted'::text), ('e0000000-0000-0000-0000-000000000002'::uuid, 'ready'::text) $$,
  '… the previous file soft-deleted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_signature('c0000000-0000-0000-0000-000000000001', null) $$, 'removed');
reset role;
select ok((select p.signature_file_id is null from public.professionals p where p.id = 'c0000000-0000-0000-0000-000000000001')
          and (select f.status = 'deleted' from public.stored_files f where f.id = 'e0000000-0000-0000-0000-000000000002'),
  '… the record empty, the file soft-deleted');
select is_empty($$ select 1 from private.professional_signature_files('b0000000-0000-0000-0000-00000000000a',
                     array['c0000000-0000-0000-0000-000000000001']::uuid[]) $$,
  '… nothing to print for her');
select ok(exists (select 1 from public.audit_log a
                   where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.table_name = 'professionals'
                     and a.record_id = 'c0000000-0000-0000-0000-000000000001' and a.changed_fields ? 'signature_file_id'),
  'each change is in the journal');

select * from finish();
rollback;
