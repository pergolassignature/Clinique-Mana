-- Storage (migration *_core_storage.sql, plan Phase 3 Task 3.24, design §7, P3-14, P3-17, P3-20,
-- P3-30, inconsistencies #8 and #12).
-- Covers: the three private buckets and their limits; the MIME → extension map (every bucket type
-- maps; _shared/storage-map.test.ts ties it to the TypeScript map); privileges (catalogue and
-- registry select-only, RPCs per role, private helpers for no client role except can_read_object);
-- the purpose catalogue checks (bucket size and types, a module purpose needs a view permission)
-- and the seeded org_logo / org_signature (PNG and JPEG only, 4000 px a side, staged 1 day);
-- the stored_files checks (original_name, path shape); can_read_object as each fixture user (view
-- null, view permission, another org, pending / deleted / purged, the owner branch and its module
-- gate, a disabled user); storage.objects through the one select policy, and no client write;
-- stored_files through its policy; create_pending_upload (size and type messages, permission,
-- unknown purpose, path format, ext from the MIME type, owner and retain_until from the purpose);
-- get_pending_upload (uploader only, while pending, with the purpose's caps); confirm / reject;
-- register_system_file; set_org_asset (happy path, replace, remove, guards); list_files_to_purge
-- and mark_files_purged (per org, the three purge rules, never a live file); confirm refusing a
-- pending file older than 24 h; attach_stored_file; soft_delete_stored_file; signatory_email;
-- the core.storage_cleanup job; audit rows (original_name redacted, logo_file_id on organizations).
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(114);

-- =============================================================================
-- Buckets and the MIME map
-- =============================================================================
select results_eq($$
  select id::text, public, file_size_limit, allowed_mime_types from storage.buckets
   where id in ('org-assets', 'documents', 'signed-documents') order by id
$$, $$ values
  ('documents'::text, false, 10485760::bigint, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
     'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('org-assets', false, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('signed-documents', false, 20971520, array['application/pdf'])
$$, 'three private buckets with their size and type limits');

select results_eq($$
  select m, private.mime_extension(m) from unnest(array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpg', 'image/svg+xml', 'IMAGE/PNG', 'text/html']) m
$$, $$ values ('application/pdf'::text, 'pdf'::text), ('image/png', 'png'), ('image/jpeg', 'jpg'), ('image/webp', 'webp'),
  ('application/msword', 'doc'), ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'),
  ('image/jpg', null), ('image/svg+xml', null), ('IMAGE/PNG', null), ('text/html', null) $$,
  'mime_extension: the fixed map, exact strings only (no alias, no upper case)');
select is_empty($$
  select m from storage.buckets b, unnest(b.allowed_mime_types) m
   where b.id in ('org-assets', 'documents', 'signed-documents') and private.mime_extension(m) is null
$$, 'every type a bucket accepts has an extension');

-- =============================================================================
-- Privileges, indexes, job
-- =============================================================================
select table_privs_are('public', 'upload_purposes', 'anon', array[]::text[], 'anon: nothing on upload_purposes');
select table_privs_are('public', 'upload_purposes', 'authenticated', array['SELECT'], 'authenticated: select upload_purposes');
select table_privs_are('public', 'stored_files', 'anon', array[]::text[], 'anon: nothing on stored_files');
select table_privs_are('public', 'stored_files', 'authenticated', array['SELECT'], 'authenticated: select stored_files (no client write)');
select is_empty($$
  select 1 from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('upload_purposes', 'stored_files')
     and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
$$, 'no column write privilege on the storage tables');
select column_privs_are('public', 'organizations', 'signatory_email', 'authenticated', array['SELECT', 'UPDATE'],
  'signatory_email is updatable (settings.manage through organizations_update)');
select column_privs_are('public', 'organizations', 'logo_file_id', 'authenticated', array['SELECT'],
  'logo_file_id is read-only (set_org_asset)');
select column_privs_are('public', 'organizations', 'signature_file_id', 'authenticated', array['SELECT'],
  'signature_file_id is read-only (set_org_asset)');

select results_eq($$
  select p.oid::regprocedure::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'),
         p.prosecdef
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_pending_upload', 'get_pending_upload', 'confirm_stored_file', 'reject_stored_file',
                       'register_system_file', 'list_files_to_purge', 'mark_files_purged', 'set_org_asset')
   order by 1
$$, $$ values
  ('confirm_stored_file(uuid,text,integer)'::text, false, false, true, true),
  ('create_pending_upload(text,text,uuid,text,text,integer)', false, true, false, true),
  ('get_pending_upload(uuid)', false, true, false, true),
  ('list_files_to_purge(uuid,integer)', false, false, true, true),
  ('mark_files_purged(uuid,uuid[])', false, false, true, true),
  ('register_system_file(uuid,text,text,text,text,uuid,text,integer,text,text,text)', false, false, true, true),
  ('reject_stored_file(uuid)', false, false, true, true),
  ('set_org_asset(text,uuid)', false, true, false, true)
$$, 'user RPCs for authenticated only, service RPCs for service_role only, all definer');
select results_eq($$
  select p.oid::regprocedure::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('can_read_object', 'mime_extension', 'attach_stored_file', 'soft_delete_stored_file',
                       'check_upload_purpose')
   order by 1
$$, $$ values
  ('private.attach_stored_file(uuid,text,uuid,text,uuid,text)'::text, false, false, false),
  ('private.can_read_object(text,text)', false, true, false),
  ('private.check_upload_purpose()', false, false, false),
  ('private.mime_extension(text)', false, false, false),
  ('private.soft_delete_stored_file(uuid,uuid)', false, false, false)
$$, 'only can_read_object is callable, by authenticated (the object policy); the module helpers by no client role');
select results_eq($$
  select l.lanname::text collate "default", p.provolatile::text collate "default", p.prosecdef
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'private.can_read_object(text, text)'::regprocedure
$$, $$ values ('sql'::text, 's'::text, true) $$, 'can_read_object is a stable definer SQL function');

select results_eq($$
  select polname::text collate "default", polcmd::text collate "default", polroles::regrole[]::text collate "default"
    from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'core_objects_select'
$$, $$ values ('core_objects_select'::text, 'r'::text, '{authenticated}'::text) $$,
  'one select policy on storage.objects for authenticated');
select is_empty($$
  select 1 from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polcmd <> 'r'
     and pg_get_expr(p.polqual, p.polrelid) ~ '(org-assets|documents|signed-documents)'
$$, 'no insert, update or delete policy on the core buckets');

select results_eq($$
  select indexname::text collate "default" from pg_indexes
   where schemaname = 'public' and tablename = 'stored_files' order by 1
$$, array['stored_files_deleted_by_idx', 'stored_files_object_path_key', 'stored_files_owner_permission_idx',
          'stored_files_owner_profile_id_idx', 'stored_files_pkey', 'stored_files_purge_idx', 'stored_files_purpose_idx',
          'stored_files_subject_idx', 'stored_files_uploaded_by_idx', 'stored_files_view_permission_idx'],
  'path, subject, purge and FK indexes exist');
select is((select pg_get_indexdef(i.indexrelid) from pg_index i where i.indexrelid = 'public.stored_files_subject_idx'::regclass),
  'CREATE INDEX stored_files_subject_idx ON public.stored_files USING btree (org_id, module_key, subject_type, subject_id)',
  'a subject''s files, also the org FK and the RLS org predicate');

select results_eq($$
  select j.key, j.module_key, j.kind, j.function_name, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'core.storage_cleanup'
$$, $$ values ('core.storage_cleanup'::text, 'core'::text, 'function'::text, 'storage-cleanup'::text,
               true, '40 8 * * *'::text, 'select private.invoke_job_function(''core.storage_cleanup'')'::text) $$,
  'core.storage_cleanup is a maintenance function job, daily at 08:40 UTC');

-- =============================================================================
-- Purpose catalogue
-- =============================================================================
select results_eq($$
  select key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types,
         max_image_side, retain_days
    from public.upload_purposes where key in ('org_logo', 'org_signature') order by key
$$, $$ values
  ('org_logo'::text, 'core'::text, 'org-assets'::text, 'settings.manage'::text, null::text, null::text, 2097152,
   array['image/png', 'image/jpeg'], 4000, 1),
  ('org_signature', 'core', 'org-assets', 'settings.manage', 'settings.manage', null, 2097152,
   array['image/png', 'image/jpeg'], 4000, 1)
$$, 'org_logo (any member) and org_signature (settings.manage): PNG and JPEG only, 4000 px a side, staged 1 day');
select throws_ok($$ insert into public.upload_purposes (key, module_key, bucket, upload_permission, max_bytes, mime_types)
                    values ('test_big', 'core', 'org-assets', 'settings.manage', 2097153, array['image/png']) $$,
  '23514', null, 'max_bytes cannot exceed the bucket limit');
select throws_ok($$ insert into public.upload_purposes (key, module_key, bucket, upload_permission, max_bytes, mime_types)
                    values ('test_type', 'core', 'signed-documents', 'settings.manage', 1000, array['image/png']) $$,
  '23514', null, 'mime_types must be accepted by the bucket');
select throws_ok($$ insert into public.upload_purposes (key, module_key, bucket, upload_permission, max_bytes, mime_types)
                    values ('test_gate', 'professionals', 'documents', 'professionals.view', 1000, array['application/pdf']) $$,
  '23514', null, 'a module purpose needs a view permission (null = any member is for core only: the module gate)');

-- =============================================================================
-- Fixtures
--   files (org A unless noted; subject d…01):
--     e01 ready, view null           e02 ready, view settings.manage    e03 org B, ready, view null
--     e04 pending                    e05 deleted 1 day ago              e06 purged
--     e07 ready, test_pro_doc, view settings.manage, owner provider with professionals.view
--   purge candidates (org A unless noted):
--     e11 pending, 25 h old (listed)         e12 pending, 1 h old
--     e13 ready, retain_until passed (listed) e14 deleted 31 days ago (listed)
--     e15 ready, retain_until in a day        e16 org B, pending, 25 h old
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
-- The provider holds professionals.view (a fixture grant; the role gives nothing by default).
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view', true);

insert into public.upload_purposes
  (key, module_key, bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types, retain_days)
values
  ('test_core_doc', 'core', 'documents', 'settings.manage', null, null, 10485760, array['application/pdf', 'image/png'], null),
  ('test_pro_doc', 'professionals', 'documents', 'professionals.view', 'settings.manage', 'professionals.view', 1048576,
   array['application/pdf'], 60);

insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until,
   created_at, confirmed_at, deleted_at)
select f.id, f.org, 'documents', f.org || '/' || f.module || '/d0000000-0000-0000-0000-000000000001/' || f.id || '.pdf',
       f.module, f.purpose, 'test_subject', 'd0000000-0000-0000-0000-000000000001', 'Fichier.pdf', 'application/pdf', 'pdf',
       1000, case when f.status <> 'pending' then repeat('a', 64) end, f.status, f.view, f.owner, f.owner_perm, f.retain,
       f.created, case when f.status <> 'pending' then f.created end, f.deleted
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'core', 'test_core_doc', 'ready', null::text, null::uuid, null::text, null::timestamptz, now(), null::timestamptz),
    ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'ready', 'settings.manage', null, null, null, now(), null),
    ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'core', 'test_core_doc', 'ready', null, null, null, null, now(), null),
    ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'pending', null, null, null, null, now(), null),
    ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'deleted', null, null, null, null, now() - interval '2 days', now() - interval '1 day'),
    ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'purged', null, null, null, null, now(), null),
    ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'test_pro_doc', 'ready', 'settings.manage', 'a0000000-0000-0000-0000-000000000004', 'professionals.view', null, now(), null),
    ('e0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'pending', null, null, null, null, now() - interval '25 hours', null),
    ('e0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'pending', null, null, null, null, now() - interval '1 hour', null),
    ('e0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'ready', null, null, null, now() - interval '1 hour', now() - interval '2 days', null),
    ('e0000000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'deleted', null, null, null, null, now() - interval '40 days', now() - interval '31 days'),
    ('e0000000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-00000000000a', 'core', 'test_core_doc', 'ready', null, null, null, now() + interval '1 day', now() - interval '3 days', null),
    ('e0000000-0000-0000-0000-000000000016', 'b0000000-0000-0000-0000-00000000000b', 'core', 'test_core_doc', 'pending', null, null, null, null, now() - interval '25 hours', null)
  ) as f (id, org, module, purpose, status, view, owner, owner_perm, retain, created, deleted);

insert into storage.objects (bucket_id, name)
select 'documents', object_path from public.stored_files
 where id between 'e0000000-0000-0000-0000-000000000001' and 'e0000000-0000-0000-0000-000000000007';

create temp table t (step text primary key, id uuid, path text) on commit drop;
grant select, insert on t to authenticated, service_role;
insert into t (step, id, path)
select 'e' || right(id::text, 2), id, object_path from public.stored_files
 where id between 'e0000000-0000-0000-0000-000000000001' and 'e0000000-0000-0000-0000-000000000016';

-- =============================================================================
-- Table checks
-- =============================================================================
select throws_ok($$ insert into public.stored_files (org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
                      original_name, mime_type, ext, size_bytes)
                    values ('b0000000-0000-0000-0000-00000000000a', 'documents',
                      'b0000000-0000-0000-0000-00000000000b/core/d0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-0000000000ff.pdf',
                      'core', 'test_core_doc', 'test_subject', 'd0000000-0000-0000-0000-000000000001', 'x.pdf', 'application/pdf', 'pdf', 1) $$,
  '23514', null, 'the first path segment is the row''s org');
select throws_ok($$ insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
                      original_name, mime_type, ext, size_bytes)
                    values ('e0000000-0000-0000-0000-0000000000ff', 'b0000000-0000-0000-0000-00000000000a', 'documents',
                      'b0000000-0000-0000-0000-00000000000a/core/d0000000-0000-0000-0000-000000000001/Dossier de Marie.pdf',
                      'core', 'test_core_doc', 'test_subject', 'd0000000-0000-0000-0000-000000000001', 'x.pdf', 'application/pdf', 'pdf', 1) $$,
  '23514', null, 'the last path segment is {file_id}.{ext}: no file name in a path');
select throws_ok($$ insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
                      original_name, mime_type, ext, size_bytes)
                    values ('e0000000-0000-0000-0000-0000000000ff', 'b0000000-0000-0000-0000-00000000000a', 'documents',
                      'b0000000-0000-0000-0000-00000000000a/core/d0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-0000000000ff.pdf',
                      'core', 'test_core_doc', 'test_subject', 'd0000000-0000-0000-0000-000000000001', E'a\tb.pdf', 'application/pdf', 'pdf', 1) $$,
  '23514', null, 'original_name has no control character');

-- =============================================================================
-- can_read_object, as each fixture user
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.can_read_object('documents', (select path from t where step = 'e01')), 'conseillère: own org, ready, view null → true');
select ok(not private.can_read_object('documents', (select path from t where step = 'e02')), 'conseillère: view settings.manage → false');
select ok(not private.can_read_object('org-assets', (select path from t where step = 'e01')), 'conseillère: the right path in another bucket → false');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(private.can_read_object('documents', (select path from t where step = 'e02')), 'admin: view settings.manage → true');
select ok(not private.can_read_object('documents', (select path from t where step = 'e03')), 'admin A: another org''s file → false');
select ok(not private.can_read_object('documents', (select path from t where step = 'e04')), 'admin: pending → false');
select ok(not private.can_read_object('documents', (select path from t where step = 'e05')), 'admin: deleted → false');
select ok(not private.can_read_object('documents', (select path from t where step = 'e06')), 'admin: purged → false');
select is((select count(*)::int from storage.objects where bucket_id = 'documents' and name in (select path from t)), 3,
  'admin A selects only the readable objects through the policy (e01, e02, e07)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(not private.can_read_object('documents', (select path from t where step = 'e02')), 'adjointe (settings.view only): view settings.manage → false');
select results_eq($$ select name::text from storage.objects where bucket_id = 'documents' and name in (select path from t) $$,
  $$ select path from t where step = 'e01' $$, 'the adjointe selects only the view-null object');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(private.can_read_object('documents', (select path from t where step = 'e07')), 'provider: owner branch with professionals.view → true');
select results_eq($$ select id from public.stored_files where id in (select id from t) order by id $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid), ('e0000000-0000-0000-0000-000000000007'::uuid),
            ('e0000000-0000-0000-0000-000000000013'::uuid), ('e0000000-0000-0000-0000-000000000015'::uuid) $$,
  'provider: stored_files policy shows ready view-null rows and the owned row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(not private.can_read_object('documents', (select path from t where step = 'e01')), 'disabled admin → false');
select is((select count(*)::int from public.stored_files where id in (select id from t)), 0, 'disabled admin: no stored_files row');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(private.can_read_object('documents', (select path from t where step = 'e03')), 'admin B: own org''s file → true');
select results_eq($$ select id from public.stored_files where id in (select id from t) $$,
  $$ values ('e0000000-0000-0000-0000-000000000003'::uuid) $$, 'admin B: stored_files shows only org B''s ready row');

-- No client write on storage.objects.
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('documents', 'b0000000-0000-0000-0000-00000000000b/core/x/y.pdf') $$,
  '42501', null, 'authenticated cannot insert an object (no insert policy)');
select is_empty($$ update storage.objects set name = name || 'x' where bucket_id = 'documents' returning 1 $$,
  'authenticated updates no object (no update policy)');
-- As the Storage API does for a delete (storage.protect_delete blocks direct SQL otherwise).
select set_config('storage.allow_delete_query', 'true', true);
select is_empty($$ delete from storage.objects where bucket_id = 'documents' returning 1 $$,
  'authenticated deletes no object, even through the Storage API (no delete policy)');
select set_config('storage.allow_delete_query', 'false', true);
reset role;

-- The owner branch keeps the module gate.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(not private.can_read_object('documents', (select path from t where step = 'e07')), 'provider: owner branch with the module disabled → false');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- create_pending_upload / get_pending_upload
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.png', 'image/png', 2097153) $$,
  'P0001', 'Ce fichier dépasse la taille permise (2 Mo).', 'too big → the French size message');
select throws_ok($$ select * from public.create_pending_upload('test_pro_doc', 'professional', 'd0000000-0000-0000-0000-000000000001',
                      'cv.pdf', 'application/pdf', 1048577) $$,
  'P0001', 'Ce fichier dépasse la taille permise (1 Mo).', 'the size message names the purpose''s limit');
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.webp', 'image/webp', 1000) $$,
  'P0001', 'Ce type de fichier n''est pas accepté.', 'WebP is refused for the logo (pdfmake cannot embed it)');
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.svg', 'image/svg+xml', 1000) $$,
  'P0001', 'Ce type de fichier n''est pas accepté.', 'SVG is refused');
select throws_ok($$ select * from public.create_pending_upload('nope', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.png', 'image/png', 1000) $$,
  '22023', null, 'an unknown purpose → 22023');
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'a/b.png', 'image/png', 1000) $$,
  '23514', null, 'original_name with / → 23514');
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.png', 'image/png', 0) $$,
  '22023', null, 'a size of 0 → 22023');

insert into t (step, id, path)
select 'logo1', u.file_id, u.object_path
  from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                                    'Logo Clinique.png', 'image/png', 1000) u;
select matches((select path from t where step = 'logo1'),
  '^b0000000-0000-0000-0000-00000000000a/core/b0000000-0000-0000-0000-00000000000a/' || (select id from t where step = 'logo1') || '\.png$',
  'the path is {org}/{module}/{subject}/{file_id}.{ext}, no file name');
insert into t (step, id, path)
select 'logo2', u.file_id, u.object_path
  from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                                    'photo.jpeg', 'image/jpeg', 1000) u;
select matches((select path from t where step = 'logo2'), '/' || (select id from t where step = 'logo2') || '\.jpg$',
  'image/jpeg → .jpg: the extension comes from the MIME type, never from the name');
select results_eq($$ select * from public.get_pending_upload((select id from t where step = 'logo1')) $$,
  $$ select 'org-assets'::text, path, 'image/png'::text, 1000, 2097152, 4000 from t where step = 'logo1' $$,
  'get_pending_upload: the uploader gets the bucket, path, type, size and the purpose''s caps');
select is_empty($$ select * from public.get_pending_upload('e0000000-0000-0000-0000-000000000004') $$,
  'get_pending_upload: nothing for a file someone else uploaded');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.png', 'image/png', 1000) $$,
  '42501', null, 'the adjointe has no upload_permission (settings.manage) → 42501');
select is_empty($$ select * from public.get_pending_upload((select id from t where step = 'logo1')) $$,
  'get_pending_upload: nothing for another user');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select * from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a',
                      'logo.png', 'image/png', 1000) $$,
  '42501', null, 'a disabled admin → 42501');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
insert into t (step, id, path)
select 'pro1', u.file_id, u.object_path
  from public.create_pending_upload('test_pro_doc', 'professional_submission', 'd0000000-0000-0000-0000-000000000009',
                                    'Assurance.pdf', 'application/pdf', 5000) u;
reset role;

select results_eq($$
  select bucket, module_key, purpose, subject_type, subject_id, status, mime_type, ext, size_bytes, view_permission,
         owner_profile_id, owner_permission, retain_until, uploaded_by, sha256, original_name
    from public.stored_files where id = (select id from t where step = 'logo1')
$$, $$ values ('org-assets'::text, 'core'::text, 'org_logo'::text, 'organization'::text,
               'b0000000-0000-0000-0000-00000000000a'::uuid, 'pending'::text, 'image/png'::text, 'png'::text, 1000,
               null::text, null::uuid, null::text, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000001'::uuid,
               null::text, 'Logo Clinique.png'::text) $$,
  'a pending row with the purpose''s view permission, no owner, retain_until = now() + retain_days');
select results_eq($$
  select t.path ~ '^b0000000-0000-0000-0000-00000000000a/professionals/d0000000-0000-0000-0000-000000000009/', f.view_permission,
         f.owner_profile_id, f.owner_permission, f.retain_until
    from public.stored_files f join t on t.id = f.id where t.step = 'pro1'
$$, $$ values (true, 'settings.manage'::text, 'a0000000-0000-0000-0000-000000000004'::uuid, 'professionals.view'::text,
               now() + interval '60 days') $$,
  'a purpose with an owner_permission makes the uploader the owner; staged for retain_days (P3-17)');

-- =============================================================================
-- Service role: confirm, reject, register
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.confirm_stored_file((select id from t where step = 'logo1'), repeat('A', 64), 1000) $$,
  '22023', null, 'sha256 must be 64 lower-case hex characters');
select lives_ok($$ select public.confirm_stored_file((select id from t where step = 'logo1'), repeat('b', 64), 1200) $$,
  'confirm_stored_file');
select throws_ok($$ select public.confirm_stored_file((select id from t where step = 'logo1'), repeat('b', 64), 1200) $$,
  '22023', null, 'a file is confirmed once');
select throws_ok($$ select public.confirm_stored_file('e0000000-0000-0000-0000-000000000011', repeat('b', 64), 1000) $$,
  '22023', null, 'a pending file older than 24 h cannot be confirmed (storage-cleanup may be removing it)');
select throws_ok($$ select public.confirm_stored_file((select id from t where step = 'logo2'), repeat('b', 64), 2097153) $$,
  '22023', null, 'the real size must be within the purpose''s limit');
select lives_ok($$ select public.reject_stored_file((select id from t where step = 'logo2')) $$, 'reject_stored_file');
select throws_ok($$ select public.reject_stored_file((select id from t where step = 'logo2')) $$,
  '22023', null, 'only a pending file can be rejected');

insert into t (step, id, path)
select 'sys1', r.file_id, r.object_path
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'test_core_doc',
         'signature_request', 'd0000000-0000-0000-0000-000000000003', 'application/pdf', 5000, repeat('c', 64),
         'settings.manage', 'Contrat.pdf') r;
select throws_ok($$ select * from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'core',
         'test_core_doc', 'signature_request', 'd0000000-0000-0000-0000-000000000003', 'application/pdf', 5000, repeat('c', 64),
         'settings.manage', 'Contrat.pdf') $$,
  '22023', null, 'register_system_file: the bucket must be the purpose''s');
select throws_ok($$ select * from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core',
         'test_core_doc', 'signature_request', 'd0000000-0000-0000-0000-000000000003', 'image/webp', 5000, repeat('c', 64),
         'settings.manage', 'Contrat.webp') $$,
  '22023', null, 'register_system_file: the type must be the purpose''s');
select throws_ok($$ select * from public.register_system_file('b0000000-0000-0000-0000-00000000000b', 'documents', 'professionals',
         'test_pro_doc', 'professional', 'd0000000-0000-0000-0000-000000000003', 'application/pdf', 5000, repeat('c', 64),
         'professionals.view', 'Contrat.pdf') $$,
  '22023', null, 'register_system_file: the module must be enabled for the org');
reset role;
select results_eq($$
  select t.path ~ ('^b0000000-0000-0000-0000-00000000000a/core/d0000000-0000-0000-0000-000000000003/' || f.id || '\.pdf$'),
         f.status, f.sha256, f.size_bytes, f.view_permission, f.uploaded_by, f.confirmed_at
    from public.stored_files f join t on t.id = f.id where t.step = 'sys1'
$$, $$ values (true, 'ready'::text, repeat('c', 64), 5000, 'settings.manage'::text, null::uuid, now()) $$,
  'register_system_file inserts a ready row at a path the caller then uploads to');
select results_eq($$
  select f.status, f.sha256, f.size_bytes, f.confirmed_at from public.stored_files f join t on t.id = f.id where t.step = 'logo1'
$$, $$ values ('ready'::text, repeat('b', 64), 1200, now()) $$, 'confirm_stored_file records the hash and the real size');
select is((select f.status from public.stored_files f join t on t.id = f.id where t.step = 'logo2'), 'deleted',
  'reject_stored_file → deleted');

-- =============================================================================
-- set_org_asset
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
insert into t (step, id, path)
select 'logob', u.file_id, u.object_path
  from public.create_pending_upload('org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000b', 'b.png', 'image/png', 1000) u;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into t (step, id, path)
select v.s, u.file_id, u.object_path
  from (values ('logo3', 'org_logo'), ('logo4', 'org_logo'), ('sig1', 'org_signature')) v (s, p),
       lateral public.create_pending_upload(v.p, 'organization', 'b0000000-0000-0000-0000-00000000000a', 'x.png', 'image/png', 1000) u;
reset role;
set local role service_role;
select public.confirm_stored_file(id, repeat('d', 64), 1000) from t where step in ('logob', 'logo3', 'sig1');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_org_asset('logo', (select id from t where step = 'logo1')) $$, 'set_org_asset: the logo');
select is((select logo_file_id from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  (select id from t where step = 'logo1'), 'organizations.logo_file_id is set');
select lives_ok($$ select public.set_org_asset('logo', (select id from t where step = 'logo3')) $$, 'set_org_asset: « Remplacer »');
select lives_ok($$ select public.set_org_asset('signature', (select id from t where step = 'sig1')) $$, 'set_org_asset: the signature');
select throws_ok($$ select public.set_org_asset('logo', (select id from t where step = 'logo4')) $$,
  'P0001', 'Fichier introuvable.', 'a pending file → « Fichier introuvable. »');
select throws_ok($$ select public.set_org_asset('logo', (select id from t where step = 'logob')) $$,
  'P0001', 'Fichier introuvable.', 'another org''s file → « Fichier introuvable. »');
select throws_ok($$ select public.set_org_asset('logo', 'e0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Fichier introuvable.', 'a file of another purpose → « Fichier introuvable. »');
select throws_ok($$ select public.set_org_asset('signature', (select id from t where step = 'logo3')) $$,
  'P0001', 'Fichier introuvable.', 'a logo cannot become the signature');
select throws_ok($$ select public.set_org_asset('banner', null) $$, '22023', null, 'an unknown kind → 22023');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_org_asset('logo', null) $$, '42501', null, 'the adjointe cannot change the logo');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(private.can_read_object('org-assets', (select path from t where step = 'logo3')), 'the conseillère can read the logo (view null)');
select ok(not private.can_read_object('org-assets', (select path from t where step = 'sig1')), 'the conseillère cannot read the signature image');
reset role;

select results_eq($$
  select t.step, f.status, f.deleted_by, f.retain_until from public.stored_files f join t on t.id = f.id
   where t.step in ('logo1', 'logo3', 'sig1') order by t.step
$$, $$ values ('logo1'::text, 'deleted'::text, 'a0000000-0000-0000-0000-000000000001'::uuid, null::timestamptz),
              ('logo3', 'ready', null, null), ('sig1', 'ready', null, null) $$,
  'replacing soft-deletes the old logo; the assets in use are no longer staged');
select results_eq($$ select logo_file_id, signature_file_id from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ select (select id from t where step = 'logo3'), (select id from t where step = 'sig1') $$, 'both assets are set');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_org_asset('logo', null) $$, 'set_org_asset: « Retirer »');
reset role;
select results_eq($$
  select o.logo_file_id, f.status from public.organizations o, public.stored_files f
   where o.id = 'b0000000-0000-0000-0000-00000000000a' and f.id = (select id from t where step = 'logo3')
$$, $$ values (null::uuid, 'deleted'::text) $$, '« Retirer » clears the column and soft-deletes the file');

-- =============================================================================
-- attach_stored_file / soft_delete_stored_file (module RPC helpers, as admin A)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select private.attach_stored_file('e0000000-0000-0000-0000-000000000015', 'professional',
                      'd0000000-0000-0000-0000-000000000002', 'professionals.view', 'a0000000-0000-0000-0000-000000000004',
                      'professionals.view') $$, 'attach_stored_file');
select results_eq($$
  select subject_type, subject_id, view_permission, owner_profile_id, owner_permission, retain_until, object_path
    from public.stored_files where id = 'e0000000-0000-0000-0000-000000000015'
$$, $$ select 'professional'::text, 'd0000000-0000-0000-0000-000000000002'::uuid, 'professionals.view'::text,
              'a0000000-0000-0000-0000-000000000004'::uuid, 'professionals.view'::text, null::timestamptz, path
         from t where step = 'e15' $$,
  'attach re-points the subject, permissions and owner, clears retain_until, and never moves the object');
select throws_ok($$ select private.attach_stored_file('e0000000-0000-0000-0000-000000000013', 'professional',
                      'd0000000-0000-0000-0000-000000000002', 'professionals.view', null, null) $$,
  'P0001', 'Fichier introuvable.', 'a staged file past its retain_until cannot be attached (it is listed for purge)');
select throws_ok($$ select private.attach_stored_file('e0000000-0000-0000-0000-000000000014', 'professional',
                      'd0000000-0000-0000-0000-000000000002', 'professionals.view', null, null) $$,
  'P0001', 'Fichier introuvable.', 'a deleted file cannot be attached');
select throws_ok($$ select private.attach_stored_file('e0000000-0000-0000-0000-000000000003', 'professional',
                      'd0000000-0000-0000-0000-000000000002', 'professionals.view', null, null) $$,
  'P0001', 'Fichier introuvable.', 'another org''s file cannot be attached');
select throws_ok($$ select private.attach_stored_file('e0000000-0000-0000-0000-000000000002', 'professional',
                      'd0000000-0000-0000-0000-000000000002', 'professionals.view', 'a0000000-0000-0000-0000-000000000004', null) $$,
  '22023', null, 'an owner needs an owner permission');

select lives_ok($$ select private.soft_delete_stored_file('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001') $$,
  'soft_delete_stored_file');
select lives_ok($$ select private.soft_delete_stored_file('e0000000-0000-0000-0000-000000000001', null) $$,
  'soft_delete_stored_file is idempotent');
select results_eq($$ select status, deleted_by, deleted_at from public.stored_files where id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('deleted'::text, 'a0000000-0000-0000-0000-000000000001'::uuid, now()) $$, 'the file is deleted by the actor');
select throws_ok($$ select private.soft_delete_stored_file('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006') $$,
  '22023', null, 'the actor must belong to the file''s org');
select throws_ok($$ select private.soft_delete_stored_file('e0000000-0000-0000-0000-0000000000ff', null) $$,
  '22023', null, 'an unknown file → 22023');

-- =============================================================================
-- list_files_to_purge / mark_files_purged (service role, per org)
-- =============================================================================
set local role service_role;
select results_eq($$ select id, bucket, object_path from public.list_files_to_purge('b0000000-0000-0000-0000-00000000000a') $$,
  $$ select id, 'documents'::text, path from t where step in ('e14', 'e13', 'e11')
      order by case step when 'e14' then 1 when 'e13' then 2 else 3 end $$,
  'org A: deleted > 30 days, ready past retain_until, pending > 24 h; oldest first; nothing live');
select results_eq($$ select id from public.list_files_to_purge('b0000000-0000-0000-0000-00000000000a', 1) $$,
  $$ values ('e0000000-0000-0000-0000-000000000014'::uuid) $$, 'p_limit pages the list');
select results_eq($$ select id from public.list_files_to_purge('b0000000-0000-0000-0000-00000000000b') $$,
  $$ values ('e0000000-0000-0000-0000-000000000016'::uuid) $$, 'org B: its own pending file only');
select is(public.mark_files_purged('b0000000-0000-0000-0000-00000000000a', array[
    'e0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000013',
    'e0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000016']::uuid[]), 2,
  'mark_files_purged marks only the org''s purgeable files');
select throws_ok($$ select public.mark_files_purged('b0000000-0000-0000-0000-00000000000a',
                      array(select gen_random_uuid() from generate_series(1, 501))) $$,
  '22023', null, 'at most 500 ids');
reset role;
select results_eq($$ select id, status from public.stored_files where id in ('e0000000-0000-0000-0000-000000000011',
    'e0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000013', 'e0000000-0000-0000-0000-000000000016') order by id $$,
  $$ values ('e0000000-0000-0000-0000-000000000011'::uuid, 'purged'::text), ('e0000000-0000-0000-0000-000000000012', 'pending'),
            ('e0000000-0000-0000-0000-000000000013', 'purged'), ('e0000000-0000-0000-0000-000000000016', 'pending') $$,
  'purged rows are kept with their status');

-- =============================================================================
-- signatory_email, audit
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ update public.organizations set signatory_email = 'pas une adresse' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'signatory_email is checked like the other addresses');
select lives_ok($$ update public.organizations set signatory_email = 'direction@clinique.test' where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'settings.manage sets signatory_email');
select throws_ok($$ update public.organizations set logo_file_id = null where id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'logo_file_id is not client-writable');
reset role;

select results_eq($$
  select l.action, l.changed_fields -> 'original_name', l.actor_id from public.audit_log l
   where l.table_name = 'stored_files' and l.record_id = (select id::text from t where step = 'logo1') order by l.id
$$, $$ values ('insert'::text, '"[redacted]"'::jsonb, 'a0000000-0000-0000-0000-000000000001'::uuid),
              ('update', null, null), ('update', null, 'a0000000-0000-0000-0000-000000000001'),
              ('update', null, 'a0000000-0000-0000-0000-000000000001') $$,
  'stored_files is audited, original_name redacted (insert, confirm, set as the logo, replaced)');
select ok(exists (
  select 1 from public.audit_log l
   where l.table_name = 'organizations' and l.record_id = 'b0000000-0000-0000-0000-00000000000a' and l.action = 'update'
     and l.changed_fields -> 'logo_file_id' ->> 'after' = (select id::text from t where step = 'logo1')),
  'the organizations audit row records logo_file_id');

select * from finish();
rollback;
