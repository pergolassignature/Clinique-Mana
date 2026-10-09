-- Professionnels: the list's photos (migration *_professionals_list_photo.sql). Covers:
-- professionals_list.photo_file_id appended last (the earlier columns unchanged); the verified
-- photo's stored file; none without a photo, and none for a photo that is not verified (the
-- safeguard); list_professionals carries it; the conseillère reads it; the provider, another
-- clinic and a disabled module read no row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03), org B (admin 04).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u4@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

-- P1: a verified photo; P2: no photo; P3 (the provider's file): a photo still pending.
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Ana', 'Avec', 'ana@exemple.test'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Bea', 'Sans', 'bea@exemple.test'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test');

insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
select f.id, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/professionals/' || f.subject || '/' || f.id || '.png',
       'professionals', 'professional_document', 'professional', f.subject,
       'photo.png', 'image/png', 'png', 2048, repeat('a', 64), 'ready', 'professionals.view',
       'a0000000-0000-0000-0000-000000000001', now()
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid),
               ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003')) f(id, subject);
insert into public.professional_documents (id, org_id, professional_id, document_type_id, stored_file_id, status, reviewed_by, reviewed_at)
select d.id, 'b0000000-0000-0000-0000-00000000000a', d.pid, t.id, d.file, d.status, d.reviewer, d.reviewed_at
  from (values ('d0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid,
                'e0000000-0000-0000-0000-000000000001'::uuid, 'verified', 'a0000000-0000-0000-0000-000000000001'::uuid, now()),
               ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003',
                'e0000000-0000-0000-0000-000000000003', 'pending', null, null)) d(id, pid, file, status, reviewer, reviewed_at)
  join public.document_types t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'photo';
-- The public profiles point at both (the pending one only through this fixture: the safeguard).
insert into public.professional_public_profiles (professional_id, org_id, photo_document_id) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003');

create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- =============================================================================
-- Shape (as postgres)
-- =============================================================================
select is((select a.attname::text from pg_catalog.pg_attribute a
            where a.attrelid = 'public.professionals_list'::regclass and a.attnum > 0 and not a.attisdropped
            order by a.attnum desc limit 1),
  'photo_file_id', 'photo_file_id is the view''s last column');
select is((select pg_catalog.array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
            where a.attrelid = 'public.professionals_list'::regclass and a.attnum > 0 and not a.attisdropped
              and a.attname <> 'photo_file_id'),
  array['id', 'org_id', 'first_name', 'last_name', 'email', 'status', 'status_changed_at', 'deactivation_reason_id',
        'has_account', 'primary_title_id', 'primary_licence_number', 'gender', 'language_ids', 'clientele_ids',
        'motif_ids', 'accepting_new_clients', 'matching_complete', 'ready', 'email_matches_login', 'created_at',
        'updated_at', 'documents_done', 'documents_required', 'insurance_status', 'insurance_expires_on'],
  'the earlier columns are unchanged, in order');

-- =============================================================================
-- The admin of org A
-- =============================================================================
set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');

select is((select photo_file_id from public.professionals_list where id = 'c0000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid, 'a verified photo: its stored file');
select is((select photo_file_id from public.professionals_list where id = 'c0000000-0000-0000-0000-000000000002'),
  null, 'no photo: null');
select is((select photo_file_id from public.professionals_list where id = 'c0000000-0000-0000-0000-000000000003'),
  null, 'a photo not verified: null');
select is((select l.photo_file_id from public.list_professionals() l where l.id = 'c0000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid, 'list_professionals carries it');

-- =============================================================================
-- The conseillère, the provider, another clinic, the module off
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select is((select photo_file_id from public.professionals_list where id = 'c0000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid, 'the conseillère reads it');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.professionals_list $$, 'the provider reads no row of the list');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.professionals_list where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'another clinic reads none of org A''s rows');
select is_empty($$ select 1 from public.professionals_list where photo_file_id is not null $$,
  'nor any photo');

reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select is_empty($$ select 1 from public.professionals_list $$, 'the module off: no row');

select * from finish();
rollback;
