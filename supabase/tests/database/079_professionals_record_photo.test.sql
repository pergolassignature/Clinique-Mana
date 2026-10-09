-- Professionnels: the photo in the record bundle (migration *_professionals_record_photo.sql,
-- follow-up A2.1). get_professional_record (and get_my_professional_record, which reads it) carries
-- `photo_file_id`: the stored file of the public profile's photo (the newest verified photo), null
-- without one. Covers: null without a photo and while the photo waits for review; present once
-- verified, for every reader of the record (admin, conseillère) and for the provider's own record;
-- the newest verified photo wins, and the previous one comes back when it is deleted; another
-- clinic sees nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03 linked to P1), org B
-- (admin 04, P2). Files: e1 (P1, the provider's upload), e2 (P1, the admin's), e3 (P2, admin B's).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
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
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true), ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Deux', 'p2@exemple.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';

-- Uploaded PNGs, ready (as storage-confirm leaves them).
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until, uploaded_by, confirmed_at)
select f.id, f.org, 'documents', f.org || '/professionals/' || f.subject || '/' || f.id || '.png',
       'professionals', f.purpose, 'professional', f.subject, 'photo.png', 'image/png', 'png', 2048, repeat('a', 64), 'ready',
       'professionals.view', f.owner, case when f.owner is not null then 'professionals.self' end, now() + interval '1 day',
       f.uploader, now()
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid,
     'professional_self_document', 'a0000000-0000-0000-0000-000000000003'::uuid, 'a0000000-0000-0000-0000-000000000003'::uuid),
    ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
     'professional_document', null, 'a0000000-0000-0000-0000-000000000001'),
    ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000002',
     'professional_document', null, 'a0000000-0000-0000-0000-000000000004')
  ) as f(id, org, subject, purpose, owner, uploader);

-- The record's photo_file_id as the current caller reads it ('absent' when the record is unreadable).
create function private.test_photo(p_id uuid) returns text
language sql set search_path = '' as $$
  select case when r is null then 'absent' else coalesce(r ->> 'photo_file_id', 'null') end
    from (select public.get_professional_record(p_id) as r) x
$$;
grant execute on function private.test_photo(uuid) to authenticated;

set local role authenticated;

-- =============================================================================
-- No photo yet, then a photo waiting for review
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.get_professional_record('c0000000-0000-0000-0000-000000000001') ? 'photo_file_id',
  'the record bundle has photo_file_id');
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'null', 'without a photo: null');

-- The provider sends her photo herself: pending.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.d1', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'photo',
  'e0000000-0000-0000-0000-000000000001')::text, true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'null', 'a photo waiting for review: still null');

-- =============================================================================
-- Verified: every reader of the record, and the provider's own record
-- =============================================================================
select public.verify_professional_document(current_setting('test.d1')::uuid);
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'e0000000-0000-0000-0000-000000000001',
  'once verified: the photo''s stored file (admin)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'e0000000-0000-0000-0000-000000000001',
  '… the conseillère reads it too (professionals.view)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_my_professional_record() ->> 'photo_file_id', 'e0000000-0000-0000-0000-000000000001',
  '… and the provider in « Mon profil » (get_my_professional_record)');

-- =============================================================================
-- The newest verified photo wins
-- =============================================================================
-- Same transaction, same now(): the first photo is dated a day earlier (as postgres).
reset role;
update public.professional_documents
   set reviewed_at = now() - interval '1 day', created_at = now() - interval '1 day'
 where id = current_setting('test.d1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- The admin (documents.review) attaches a newer photo: verified at once.
select set_config('test.d2', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'photo',
  'e0000000-0000-0000-0000-000000000002')::text, true);
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'e0000000-0000-0000-0000-000000000002',
  'two verified photos: the newest one');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_my_professional_record() ->> 'photo_file_id', 'e0000000-0000-0000-0000-000000000002',
  '… for the provider too');

-- A verified photo deleted (the admin holds professionals.documents.delete): the previous one comes back.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.delete_professional_document(current_setting('test.d2')::uuid);
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'e0000000-0000-0000-0000-000000000001',
  'the newest photo deleted: the previous verified photo');

-- =============================================================================
-- Another clinic
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'absent', 'another clinic does not read the record (nor its photo)');
select set_config('test.d3', public.attach_professional_document('c0000000-0000-0000-0000-000000000002', 'photo',
  'e0000000-0000-0000-0000-000000000003')::text, true);
select is(private.test_photo('c0000000-0000-0000-0000-000000000002'), 'e0000000-0000-0000-0000-000000000003',
  'org B reads its own professional''s photo');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_photo('c0000000-0000-0000-0000-000000000002'), 'absent', 'org A does not read org B''s record');
select is(private.test_photo('c0000000-0000-0000-0000-000000000001'), 'e0000000-0000-0000-0000-000000000001',
  'org B''s photo never reaches org A''s record');

select * from finish();
rollback;
