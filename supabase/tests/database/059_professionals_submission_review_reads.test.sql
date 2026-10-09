-- Professionnels: the submissions of a file and « Mon profil »'s read (migration
-- *_professionals_submission_review_reads.sql, plan Phase 4 Task 4b.5). Covers: privileges of the
-- two RPCs; list_professional_submissions (newest first, no answers, the reviewer's name without
-- users.view, the count of fields applied, who started each one, another clinic's file empty,
-- professionals.view required; the sent-back note for professionals.review only, redacted from the
-- audit); get_my_professional_record (the provider's own record, its gender,
-- the clinic's two notes on her row as on the record, null without a linked file,
-- professionals.self required); the provider reads both notes on her own row and nothing of
-- another's (P4-373, Loi 25); get_my_submission's gender and started_by_me (in place in
-- *_professionals_questionnaire_consent_answer.sql); requested_by from its three callers: the
-- invitation (the inviter), « Demander une mise à jour » (the staff member) and « Mettre mon profil
-- à jour » (the professional) (in place in *_professionals_onboarding.sql, P4-375);
-- get_my_access().has_professional_file (P4-376). Apply's hints are executed in 051 (P4-369).
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03 linked to P1, provider 05
-- linked to P2, P3 without an account), org B (admin 04, P9).
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
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Paul Deux', 'u5@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true), ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, gender, deactivation_note, activation_override_reason) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'in_review', 'female', 'Note interne de la clinique', 'Activée avant la fin du questionnaire'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005',
   'Paul', 'Deux', 'u5@a.test', 'active', 'male', 'Note sur Paul', 'Raison pour Paul'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', null, 'Léa', 'Trois', 'p3@a.test', 'draft', null, null, null),
  ('c0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', null, 'Bea', 'Neuf', 'b9@b.test', 'draft', null, null, null);
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-%';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-%';
-- P1's submissions: an approved onboarding (invited by the admin, reviewed by her), a cancelled
-- update the clinic asked for, an open one Pia started herself and the clinic sent back.
insert into public.professional_submissions
  (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values,
   submitted_at, reviewed_at, reviewed_by, decision_note, applied_fields, created_at, requested_by)
values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'onboarding', 'approved', array['personal', 'portrait'], '{}', '{"portrait": {"bio": "Bonjour"}}',
   now() - interval '3 days', now() - interval '2 days', 'a0000000-0000-0000-0000-000000000001', null,
   array['bio', 'personal_phone'], now() - interval '5 days', 'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'cancelled', array['motifs'], '{}', '{}', null, null, null, null, null, now() - interval '1 day',
   'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'draft', array['languages'], '{}', '{}', now() - interval '2 hours', now() - interval '1 hour',
   'a0000000-0000-0000-0000-000000000001', 'Précisez vos langues.', null, now(), 'a0000000-0000-0000-0000-000000000003');
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
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') -> 0 ->> 'decision_note', null,
  'never the note of a profile sent back without professionals.review (P4-420, P4-474)');
select results_eq(
  $$ select (e ->> 'returned')::boolean from jsonb_array_elements(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001')) e $$,
  $$ values (true), (false), (false) $$,
  '… only that it was sent back with a note (« Renvoyé »)');
select results_eq(
  $$ select (e ->> 'started_by_professional')::boolean from jsonb_array_elements(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001')) e $$,
  $$ values (true), (false), (false) $$,
  'who started each one: Pia herself, then the clinic twice (P4-375)');
select ok(not exists (select 1 from jsonb_array_elements(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001')) e
                       where e ? 'prefill' or e ? 'submitted_values' or e ? 'values' or e ? 'requested_by'),
  'never the answers, nor an account id');
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000009'), '[]'::jsonb, 'another clinic''s file: nothing');
select throws_ok($$ select public.get_my_professional_record() $$, '42501', 'Permission refusée : professionals.self',
  'without professionals.self, no « Mon profil »');

-- =============================================================================
-- The provider (professionals.self only)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_my_professional_record() #>> '{professional,id}', 'c0000000-0000-0000-0000-000000000001', 'the provider reads her own record');
select is(public.get_my_professional_record() #>> '{professional,gender}', 'female', '… with her gender (the titles'' form)');
select ok(not (public.get_my_professional_record() ? 'readiness'),
  '… without readiness: her permissions would read her image consent and contract as missing (P4-473)');
select is(public.get_my_professional_record() #>> '{professional,deactivation_note}', 'Note interne de la clinique',
  '… and the clinic''s deactivation note, as on her row (Loi 25, P4-373)');
select is(public.get_my_professional_record() #>> '{professional,activation_override_reason}', 'Activée avant la fin du questionnaire',
  '… and the activation override reason');
select results_eq(
  $$ select deactivation_note, activation_override_reason from public.professionals where id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('Note interne de la clinique'::text, 'Activée avant la fin du questionnaire'::text) $$,
  'she selects both notes on her own row');
select is_empty(
  $$ select deactivation_note, activation_override_reason from public.professionals where id = 'c0000000-0000-0000-0000-000000000002' $$,
  '… and nothing of another professional''s row');
select is(public.get_my_submission() #>> '{professional,gender}', 'female', 'get_my_submission names the gender too');
select is((public.get_my_submission() ->> 'started_by_me')::boolean, true, '… and that she started this update herself');
select throws_ok($$ select public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') $$, '42501',
  'Permission refusée : professionals.view', 'the provider does not list submissions');
select is((public.get_my_access() ->> 'has_professional_file')::boolean, true, 'her access says a file is linked to her account (P4-376)');

-- =============================================================================
-- requested_by from its callers (P4-375)
-- =============================================================================
-- « Demander une mise à jour » (the admin): the clinic asked.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.asked', public.request_professional_update('c0000000-0000-0000-0000-000000000002', array['motifs']) ->> 'submission_id', true);
reset role;
select is((select s.requested_by from public.professional_submissions s where s.id = current_setting('test.asked')::uuid),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'an update request names the staff member who asked');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((public.get_my_submission() ->> 'started_by_me')::boolean, false, '… and the professional reads that the clinic asked');
reset role;
update public.professional_submissions set status = 'cancelled' where id = current_setting('test.asked')::uuid;
-- « Mettre mon profil à jour » (Paul himself).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_config('test.own', public.start_my_profile_update(array['portrait'])::text, true);
select is((public.get_my_submission() ->> 'started_by_me')::boolean, true, 'an update he starts reads as his');
reset role;
select is((select s.requested_by from public.professional_submissions s where s.id = current_setting('test.own')::uuid),
  'a0000000-0000-0000-0000-000000000005'::uuid, '… and names his account');
-- The invitation (service role, the actor named): the inviter.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000003', extensions.digest('token-059', 'sha256'))::text, true);
reset role;
select is((select s.requested_by from public.professional_submissions s
            where s.id = (current_setting('test.inv')::jsonb ->> 'submission_id')::uuid),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'the onboarding names the inviter');

-- =============================================================================
-- An admin without a file (professionals.self by default), and org B
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001') -> 0 ->> 'decision_note', 'Précisez vos langues.',
  'a reviewer (professionals.review) reads the note of a profile sent back');
select is(public.get_my_professional_record(), null::jsonb, 'an admin without a linked file: no record');
select is((public.get_my_access() ->> 'has_professional_file')::boolean, false, '… and her access says no file is linked');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.list_professional_submissions('c0000000-0000-0000-0000-000000000001'), '[]'::jsonb, 'org B''s admin lists nothing of org A');
reset role;

-- The note stays out of the audit (Historique, read with professionals.view): redacted (P4-474).
update public.professional_submissions set decision_note = 'Ajoutez une langue.' where id = 'd0000000-0000-0000-0000-000000000003';
select is((select a.changed_fields ->> 'decision_note' from public.audit_log a
            where a.table_name = 'professional_submissions' and a.record_id like '%d0000000-0000-0000-0000-000000000003%'
            order by a.id desc limit 1),
  '[redacted]', 'the audit redacts the sent-back note');

select * from finish();
rollback;
