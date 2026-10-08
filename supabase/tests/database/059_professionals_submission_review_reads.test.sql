-- Professionnels: the submissions of a file and « Mon profil »'s read (migration
-- *_professionals_submission_review_reads.sql, plan Phase 4 Task 4b.5). Covers: privileges of the
-- two RPCs; list_professional_submissions (newest first, no answers, the reviewer's name without
-- users.view, the count of fields applied, another clinic's file empty, professionals.view
-- required); get_my_professional_record (the provider's own record, its gender, the staff's notes
-- blanked, null without a linked file, professionals.self required); get_my_submission's gender
-- (in place in *_professionals_questionnaire_consent_answer.sql); the « Renvoyez le profil » hint of
-- apply (in place in *_professionals_onboarding.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03 linked to P1), org B (admin 04, P9).
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
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, gender, deactivation_note) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'in_review', 'female', 'Note interne de la clinique'),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', null, 'Bea', 'Neuf', 'b9@b.test', 'draft', null, null);
insert into public.professional_public_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000009');
insert into public.professional_matching_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000009');
-- P1's submissions: an approved onboarding (reviewed by the admin), a cancelled update, an open one sent back.
insert into public.professional_submissions
  (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values,
   submitted_at, reviewed_at, reviewed_by, decision_note, applied_fields, created_at)
values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'onboarding', 'approved', array['personal', 'portrait'], '{}', '{"portrait": {"bio": "Bonjour"}}',
   now() - interval '3 days', now() - interval '2 days', 'a0000000-0000-0000-0000-000000000001', null,
   array['bio', 'personal_phone'], now() - interval '5 days'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'cancelled', array['motifs'], '{}', '{}', null, null, null, null, null, now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'draft', array['languages'], '{}', '{}', now() - interval '2 hours', now() - interval '1 hour',
   'a0000000-0000-0000-0000-000000000001', 'Précisez vos langues.', null, now());
insert into public.professional_submissions (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values)
values ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000009',
        'onboarding', 'draft', array['personal'], '{}', '{}');

-- =============================================================================
-- Privileges (as postgres)
-- =============================================================================
select is_definer('public', 'list_professional_submissions', array['uuid'], 'list_professional_submissions is security definer');
select isnt_definer('public', 'get_my_professional_record', array[]::text[], 'get_my_professional_record runs as the caller (the record''s RLS)');
select function_privs_are('public', 'list_professional_submissions', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated may list submissions');
select function_privs_are('public', 'list_professional_submissions', array['uuid'], 'anon', array[]::text[], 'anon may not');
select function_privs_are('public', 'list_professional_submissions', array['uuid'], 'service_role', array[]::text[], 'the service role may not');
select function_privs_are('public', 'get_my_professional_record', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated may read its own record');
select function_privs_are('public', 'get_my_professional_record', array[]::text[], 'anon', array[]::text[], 'anon may not');
select function_privs_are('public', 'get_my_professional_record', array[]::text[], 'service_role', array[]::text[], 'the service role may not');

-- =============================================================================
-- The conseillère (professionals.view, no users.view, no review)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$ select e ->> 'id' from jsonb_array_elements(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001')) e $$,
  $$ values ('d0000000-0000-0000-0000-000000000003'), ('d0000000-0000-0000-0000-000000000002'), ('d0000000-0000-0000-0000-000000000001') $$,
  'the file''s submissions, newest first');
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') -> 2 ->> 'reviewed_by_name', 'Admin A',
  'the reviewer is named without users.view');
select is((public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') -> 2 ->> 'applied_count')::int, 2,
  'the number of fields applied');
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') -> 0 ->> 'decision_note', 'Précisez vos langues.',
  'the note of a profile sent back');
select ok(not exists (select 1 from jsonb_array_elements(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001')) e
                       where e ? 'prefill' or e ? 'submitted_values' or e ? 'values'),
  'never the answers');
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000009'), '[]'::jsonb, 'another clinic''s file: nothing');
select throws_ok($$ select public.get_my_professional_record() $$, '42501', 'Permission refusée : professionals.self',
  'without professionals.self, no « Mon profil »');

-- =============================================================================
-- The provider (professionals.self only)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_my_professional_record() #>> '{professional,id}', 'c0000000-0000-0000-0000-000000000001', 'the provider reads her own record');
select is(public.get_my_professional_record() #>> '{professional,gender}', 'female', '… with her gender (the titles'' form)');
select ok(public.get_my_professional_record() #> '{professional,deactivation_note}' = 'null'::jsonb, '… without the clinic''s notes on the file');
select is(public.get_my_submission() #>> '{professional,gender}', 'female', 'get_my_submission names the gender too');
select throws_ok($$ select public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') $$, '42501',
  'Permission refusée : professionals.view', 'the provider does not list submissions');

-- =============================================================================
-- An admin without a file (professionals.self by default), and org B
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_my_professional_record(), null::jsonb, 'an admin without a linked file: no record');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001'), '[]'::jsonb, 'org B''s admin lists nothing of org A');
reset role;

-- =============================================================================
-- The apply hints name the sheet's « Renvoyer au professionnel » (P4-369)
-- =============================================================================
select ok(position('Renvoyez le profil au professionnel' in pg_get_functiondef('public.apply_professional_submission(uuid, text[])'::regprocedure)) > 0,
  'apply''s hints say « Renvoyez le profil au professionnel »');
select ok(position('Refusez la soumission' in pg_get_functiondef('public.apply_professional_submission(uuid, text[])'::regprocedure)) = 0
          and position('Refusez la soumission' in pg_get_functiondef('private.apply_submission_private(uuid, uuid, uuid, text[])'::regprocedure)) = 0,
  '… never « Refusez la soumission »');

select * from finish();
rollback;
