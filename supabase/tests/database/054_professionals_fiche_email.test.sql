-- Professionnels: the fiche PDF, by email (migration *_professionals_fiche_email.sql, plan Phase 4
-- Task 4c.5). Covers: the upload purpose professional_fiche (row, caps, view permission, staged one
-- day, who may upload); get_professional_fiche_upload (the caller's own ready upload for that
-- active professional; every mismatch « Fichier introuvable. »: another professional, uploader,
-- purpose, clinic, pending, past its staging, unknown; professionals not active or of another
-- clinic; permissions, module off); the email template professionals.fiche (free recipient,
-- attachments, view permission, no button, variables).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a conseillère; org B with
-- an admin. P1 (active), P2 (draft) and P4 (active) in org A; P3 (active) in org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
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
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Paul', 'Un',     'p1@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pia',  'Deux',   'p2@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Pat',  'Trois',  'p3@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Pénélope', 'Quatre', 'p4@exemple.test', 'active');

-- =============================================================================
-- Privileges and catalogue rows (as postgres)
-- =============================================================================
select function_privs_are('public', 'get_professional_fiche_upload', array['uuid', 'uuid'], 'anon', array[]::text[], 'anon cannot check a fiche upload');
select function_privs_are('public', 'get_professional_fiche_upload', array['uuid', 'uuid'], 'authenticated', array['EXECUTE'], 'authenticated may check a fiche upload (the RPC checks the permission)');
select function_privs_are('public', 'get_professional_fiche_upload', array['uuid', 'uuid'], 'service_role', array[]::text[], 'service_role cannot check a fiche upload (no caller)');
select ok((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'get_professional_fiche_upload'),
  'get_professional_fiche_upload is security definer');

select results_eq(
  $$ select module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types, max_image_side, retain_days
       from public.upload_purposes where key = 'professional_fiche' $$,
  $$ values ('professionals', 'documents', 'professionals.view', 'professionals.view', null::text, 10485760,
             array['application/pdf'], null::int, 1) $$,
  'professional_fiche: a PDF of at most 10 MB in documents, uploaded and read with professionals.view, staged one day');

select results_eq(
  $$ select module_key, view_permission, recipient_mode, allows_attachments, button_label, subject
       from public.email_template_defaults where key = 'professionals.fiche' $$,
  $$ values ('professionals', 'professionals.view', 'free', true, null::text, 'Fiche {{professional.of_name}}') $$,
  'professionals.fiche: free recipient, attachments allowed, logged under professionals.view, no button');
select results_eq(
  $$ select v ->> 'path', (v ->> 'required')::boolean
       from public.email_template_defaults d, jsonb_array_elements(d.variables) v
      where d.key = 'professionals.fiche' order by 1 $$,
  $$ values ('message', false), ('professional.name', true), ('professional.of_name', true) $$,
  'professionals.fiche declares the name (required) and an optional message');

-- =============================================================================
-- Uploads of purpose professional_fiche
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.f1', (select u.file_id::text from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche - Paul Un.pdf', 'application/pdf', 52000) u), true);
select set_config('test.f_pending', (select u.file_id::text from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche - Paul Un.pdf', 'application/pdf', 52000) u), true);
select set_config('test.f_p4', (select u.file_id::text from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000004', 'Fiche - Pénélope Quatre.pdf', 'application/pdf', 52000) u), true);
select set_config('test.f_old', (select u.file_id::text from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche - Paul Un.pdf', 'application/pdf', 52000) u), true);
select throws_ok($$ select * from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche.png', 'image/png', 1000) $$,
  'P0001', 'Ce type de fichier n''est pas accepté.', 'a fiche is a PDF');
select throws_ok($$ select * from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche.pdf', 'application/pdf', 10485761) $$,
  'P0001', 'Ce fichier dépasse la taille permise (10 Mo).', 'a fiche is at most 10 MB');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.f_adjointe', (select u.file_id::text from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche - Paul Un.pdf', 'application/pdf', 52000) u), true);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.create_pending_upload('professional_fiche', 'professional',
  'c0000000-0000-0000-0000-000000000001', 'Fiche.pdf', 'application/pdf', 1000) $$,
  '42501', null, 'the provider cannot upload a fiche');

reset role;
select results_eq(
  $$ select view_permission, owner_profile_id, retain_until between now() + interval '23 hours' and now() + interval '25 hours'
       from public.stored_files where id = current_setting('test.f1')::uuid $$,
  $$ values ('professionals.view', null::uuid, true) $$,
  'an upload is read with professionals.view, owned by no one, staged for a day');
-- storage-confirm's part: the content checked, the file ready. f_pending stays pending; f_old's
-- staging is over.
update public.stored_files set status = 'ready', sha256 = repeat('a', 64), confirmed_at = now()
 where id in (current_setting('test.f1')::uuid, current_setting('test.f_p4')::uuid,
              current_setting('test.f_old')::uuid, current_setting('test.f_adjointe')::uuid);
update public.stored_files set retain_until = now() - interval '1 minute' where id = current_setting('test.f_old')::uuid;
-- A ready file of another purpose, uploaded by the conseillère for P1.
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, retain_until, confirmed_at)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'org-assets',
   'b0000000-0000-0000-0000-00000000000a/core/c0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-000000000001.png',
   'core', 'org_logo', 'professional', 'c0000000-0000-0000-0000-000000000001', 'logo.png', 'image/png', 'png',
   1000, repeat('b', 64), 'ready', null, 'a0000000-0000-0000-0000-000000000004', now() + interval '1 day', now());

-- =============================================================================
-- get_professional_fiche_upload
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', current_setting('test.f1')::uuid),
  jsonb_build_object('first_name', 'Paul', 'last_name', 'Un', 'bucket', 'documents',
    'object_path', 'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/' || current_setting('test.f1') || '.pdf',
    'size_bytes', 52000),
  'the conseillère''s own ready upload for an active professional: the name and where the file is');
select is(public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000004', current_setting('test.f_p4')::uuid) ->> 'first_name',
  'Pénélope', 'another professional, with the upload made for them');
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000004', %L) $$, current_setting('test.f1')),
  'P0001', 'Fichier introuvable.', 'an upload made for another professional');
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', %L) $$, current_setting('test.f_adjointe')),
  'P0001', 'Fichier introuvable.', 'someone else''s upload');
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', %L) $$, current_setting('test.f_pending')),
  'P0001', 'Fichier introuvable.', 'an upload never confirmed');
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', %L) $$, current_setting('test.f_old')),
  'P0001', 'Fichier introuvable.', 'an upload past its staging');
select throws_ok($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Fichier introuvable.', 'a file of another purpose');
select throws_ok($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000ff') $$,
  'P0001', 'Fichier introuvable.', 'an unknown file');
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000002', %L) $$, current_setting('test.f1')),
  'P0001', 'Seuls les professionnels actifs peuvent être proposés.', 'a professional who is not active is never sent');
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000003', %L) $$, current_setting('test.f1')),
  'P0001', 'Professionnel introuvable.', 'a professional of another clinic');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000003', %L) $$, current_setting('test.f1')),
  'P0001', 'Fichier introuvable.', 'another clinic''s admin cannot use org A''s upload, even for her own professional');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', %L) $$, current_setting('test.f1')),
  '42501', null, 'the provider cannot');

reset role;
update public.professionals set status = 'in_review' where id = 'c0000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000004', %L) $$, current_setting('test.f_p4')),
  'P0001', 'Seuls les professionnels actifs peuvent être proposés.', 'no longer active after the upload: refused');

reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(format($$ select public.get_professional_fiche_upload('c0000000-0000-0000-0000-000000000001', %L) $$, current_setting('test.f1')),
  '42501', null, 'module off: refused');
select is_empty(format($$ select 1 from public.stored_files where id = %L $$, current_setting('test.f1')),
  'module off: the upload is no longer readable either');

reset role;
select * from finish();
rollback;
