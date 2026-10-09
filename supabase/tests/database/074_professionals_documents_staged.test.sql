-- Professionnels: the questionnaire's documents while it waits (migration
-- *_professionals_documents_staged.sql, P4-495). get_professional_documents returns `staged`: per
-- type key (photo, insurance, image_consent), the open submission's item { type_key, kind,
-- submission_id, status, submitted_at }, never a file id, a name or the signer. Covers: a submitted
-- update with the three items (the provider, the admin, the conseillère); a draft (status draft);
-- a staged file not ready, past its staging or uploaded by someone else (the provider's view: her
-- own file only); a section not requested; sent back (draft again); approved (nothing staged);
-- another clinic; another professional.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03 linked to P1, provider 05
-- linked to P2), org B (admin 04).
-- P1: an update submitted with photo, insurance and consent. P2: an onboarding draft with a photo
-- (hers), an insurance uploaded by the admin, a consent not signed yet, and a portrait.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u4@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Paz Deux', 'u5@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true), ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005',
   'Paz', 'Deux', 'u5@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';

-- Staged questionnaire files (as storage-confirm leaves them: subject the submission).
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until, uploaded_by, confirmed_at)
select f.id, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/professionals/' || f.subject || '/' || f.id || '.' || f.ext,
       'professionals', 'professional_submission_file', 'professional_submission', f.subject::uuid, 'fichier.' || f.ext, f.mime, f.ext,
       2048, repeat('a', 64), 'ready', 'professionals.review', f.owner, 'professionals.self', now() + interval '30 days', f.uploader, now()
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000001', 'image/png', 'png',
     'a0000000-0000-0000-0000-000000000003'::uuid, 'a0000000-0000-0000-0000-000000000003'::uuid),
    ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'application/pdf', 'pdf',
     'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'image/png', 'png',
     'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005'),
    ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'application/pdf', 'pdf',
     'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001')
  ) as f(id, subject, mime, ext, owner, uploader);

insert into public.professional_submissions
  (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values, submitted_at, requested_by)
values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'submitted', array['photo', 'insurance', 'consent'], '{}',
   jsonb_build_object(
     'photo', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000001'),
     'insurance', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000002', 'expires_on', '2099-03-31'),
     'consent', jsonb_build_object('consent_version_id', 'f0000000-0000-0000-0000-000000000001', 'signer_name', 'Pia Un',
                                   'signed_at', now())),
   '2026-10-08 14:00:00+00', 'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
   'onboarding', 'draft', array['portrait', 'photo', 'insurance', 'consent'], '{}',
   jsonb_build_object(
     'portrait', jsonb_build_object('bio', 'Bonjour'),
     'photo', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000003'),
     'insurance', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000004', 'expires_on', '2099-03-31')),
   null, 'a0000000-0000-0000-0000-000000000001');

-- The staged items, as text rows ordered by type key: `type_key:kind:status`.
create function private.test_staged(p_id uuid default null) returns text
language sql set search_path = '' as $$
  select pg_catalog.string_agg((x ->> 'type_key') || ':' || (x ->> 'kind') || ':' || (x ->> 'status'), ',' order by x ->> 'type_key')
    from pg_catalog.jsonb_array_elements(public.get_professional_documents(p_id) -> 'staged') x
$$;
grant execute on function private.test_staged(uuid) to authenticated;

-- =============================================================================
-- The provider (03): her submitted update
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(private.test_staged(), 'image_consent:consent:submitted,insurance:insurance:submitted,photo:photo:submitted',
  'the provider: photo, insurance and consent sent with her questionnaire');
select is((select x ->> 'submission_id' from jsonb_array_elements(public.get_professional_documents() -> 'staged') x
            where x ->> 'type_key' = 'photo'), 'd0000000-0000-0000-0000-000000000001', '… with the submission');
select is((select (x ->> 'submitted_at')::timestamptz from jsonb_array_elements(public.get_professional_documents() -> 'staged') x
            where x ->> 'type_key' = 'insurance'), '2026-10-08 14:00:00+00'::timestamptz, '… and when it was sent');
select is((select array_agg(k order by k) from jsonb_array_elements(public.get_professional_documents() -> 'staged') x,
                  jsonb_object_keys(x) k where x ->> 'type_key' = 'photo'),
  array['kind', 'status', 'submission_id', 'submitted_at', 'type_key'],
  'an item holds no file id, name, date of the insurance nor signer');
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000002'), null, 'never another professional''s');

-- =============================================================================
-- Staff: the admin and the conseillère (professionals.view)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_staged('c0000000-0000-0000-0000-000000000001'),
  'image_consent:consent:submitted,insurance:insurance:submitted,photo:photo:submitted', 'the admin reads the same three items');
select is(private.test_staged('c0000000-0000-0000-0000-000000000002'), 'insurance:insurance:draft,photo:photo:draft',
  'a draft: its staged files, status draft (the consent not signed yet, the portrait is no document)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(private.test_staged('c0000000-0000-0000-0000-000000000001'),
  'image_consent:consent:submitted,insurance:insurance:submitted,photo:photo:submitted', 'the conseillère too');

-- =============================================================================
-- The provider (05): her draft; a file someone else uploaded is not hers
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(private.test_staged(), 'photo:photo:draft', 'the provider: her own staged file only (the insurance was uploaded by the admin)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001'), null, 'another clinic: null');

-- =============================================================================
-- Files that no longer count, a section not requested, sent back, approved
-- =============================================================================
reset role;
update public.stored_files set retain_until = now() - interval '1 hour' where id = 'e0000000-0000-0000-0000-000000000003';
update public.stored_files set status = 'pending', confirmed_at = null where id = 'e0000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_staged('c0000000-0000-0000-0000-000000000002'), null, 'a file past its staging or not ready is not staged');

reset role;
update public.professional_submissions set requested_sections = array['photo', 'consent']
 where id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(private.test_staged('c0000000-0000-0000-0000-000000000001'), 'image_consent:consent:submitted,photo:photo:submitted',
  'a section not requested is not staged');

reset role;
update public.professional_submissions
   set status = 'draft', decision_note = 'Précisez votre assurance.', reviewed_at = now(), reviewed_by = 'a0000000-0000-0000-0000-000000000001'
 where id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(private.test_staged('c0000000-0000-0000-0000-000000000001'), 'image_consent:consent:draft,photo:photo:draft',
  'sent back: the items read draft again');
select ok((select bool_and(x ->> 'submitted_at' is not null)
             from jsonb_array_elements(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'staged') x),
  '… still with the earlier sending''s date');

reset role;
update public.professional_submissions
   set status = 'approved', reviewed_at = now(), reviewed_by = 'a0000000-0000-0000-0000-000000000001', applied_fields = array['photo']
 where id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'staged', '[]'::jsonb,
  'approved: nothing staged (the documents are real now)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_professional_documents() -> 'staged', '[]'::jsonb, '… for the provider too');

select * from finish();
rollback;
