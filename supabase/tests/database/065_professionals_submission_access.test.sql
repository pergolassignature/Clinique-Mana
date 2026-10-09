-- Professionnels: who reads a submission's answers, « Fermer la demande », staged files (migration
-- *_professionals_submission_access.sql, plan Phase 4 Task 4b.7, P4-420 – P4-422). Covers: the
-- answer columns of professional_submissions refused to table reads (the conseillère and the
-- provider see the rows and their states, never prefill, submitted_values nor decision_note); no
-- provider policy on professional_consents (a re-linked account never reads the previous holder's
-- signature); get_my_submission still answers; cancel_professional_submission:
-- privileges, professionals.invite required, an update closed (its private row deleted), an
-- onboarding refused, a closed one refused, another clinic's unknown.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03 linked to P1), org B (admin 04).
-- P1: an approved onboarding (d1) and an open update draft (d2) with a private row.
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
   'Pia', 'Un', 'u3@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_matching_profiles (org_id, professional_id)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_submissions
  (id, org_id, professional_id, kind, status, requested_sections, prefill, submitted_values,
   submitted_at, reviewed_at, reviewed_by, decision_note, applied_fields, requested_by)
values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'onboarding', 'approved', array['portrait'], '{}', '{"portrait": {"bio": "Bonjour"}}',
   now() - interval '3 days', now() - interval '2 days', 'a0000000-0000-0000-0000-000000000001', null, array['bio'],
   'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   'update', 'draft', array['portrait', 'tax_bank'], '{}', '{"portrait": {"bio": "Mise à jour"}}',
   null, null, null, 'Précisez votre présentation.', null, 'a0000000-0000-0000-0000-000000000001');
insert into public.professional_submission_private (org_id, professional_id, submission_id, bank_institution, bank_transit)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', '815', '30000');

-- =============================================================================
-- Privileges (as postgres)
-- =============================================================================
select column_privs_are('public', 'professional_submissions', 'status', 'authenticated', array['SELECT'],
  'authenticated reads a submission''s state');
select column_privs_are('public', 'professional_submissions', 'submitted_values', 'authenticated', array[]::text[],
  '… never its answers through the table (P4-420)');
select column_privs_are('public', 'professional_submissions', 'prefill', 'authenticated', array[]::text[], '… nor its prefill');
select column_privs_are('public', 'professional_submissions', 'decision_note', 'authenticated', array[]::text[], '… nor the clinic''s note');
select policies_are('public', 'professional_submissions',
  array['professional_submissions_select_staff', 'professional_submissions_select_self'],
  'professional_submissions: the staff and the provider policies (columns without answers)');
select policies_are('public', 'professional_consents', array['professional_consents_select_staff'],
  'professional_consents: staff policy only (no provider policy)');
select is_definer('public', 'cancel_professional_submission', array['uuid'], 'cancel_professional_submission is security definer');
select function_privs_are('public', 'cancel_professional_submission', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may close an update');
select function_privs_are('public', 'cancel_professional_submission', array['uuid'], 'anon', array[]::text[], 'anon may not');
select function_privs_are('public', 'cancel_professional_submission', array['uuid'], 'service_role', array[]::text[], 'the service role may not');

-- =============================================================================
-- The conseillère (professionals.view, not invite)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select s.id::text, s.status from public.professional_submissions s order by s.created_at, s.id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001', 'approved'), ('d0000000-0000-0000-0000-000000000002', 'draft') $$,
  'the conseillère sees the file''s submissions and their states');
select throws_ok($$ select s.submitted_values from public.professional_submissions s $$, '42501', null,
  '… but not their answers');
select throws_ok($$ select s.decision_note from public.professional_submissions s $$, '42501', null, '… nor the clinic''s note');
select throws_ok($$ select public.cancel_professional_submission('d0000000-0000-0000-0000-000000000002') $$, '42501', null,
  'without professionals.invite, no « Fermer la demande »');

-- =============================================================================
-- The provider: her file's states, never the answers; her questionnaire through the RPC
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select s.prefill from public.professional_submissions s $$, '42501', null,
  'the provider reads no answer through the table (only through get_my_submission)');
select is((select count(*)::int from public.professional_consents), 0, '… nor any consent row');
select is(public.get_my_submission() ->> 'id', 'd0000000-0000-0000-0000-000000000002', 'get_my_submission still answers her open update');

-- =============================================================================
-- « Fermer la demande » (admin A, then admin B)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_professional_submission('d0000000-0000-0000-0000-000000000002') $$, 'P0001',
  'Soumission introuvable.', 'another clinic''s submission is unknown');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_professional_submission('d0000000-0000-0000-0000-000000000001') $$, 'P0001',
  'Le questionnaire d''accueil ne se ferme pas : révoquez l''invitation ou renvoyez le profil au professionnel.',
  'an onboarding questionnaire is never closed this way');
select lives_ok($$ select public.cancel_professional_submission('d0000000-0000-0000-0000-000000000002') $$, 'the update is closed');
select throws_ok($$ select public.cancel_professional_submission('d0000000-0000-0000-0000-000000000002') $$, 'P0001',
  'Cette mise à jour est déjà fermée ou appliquée.', 'a closed update cannot be closed again');
reset role;
select is((select s.status from public.professional_submissions s where s.id = 'd0000000-0000-0000-0000-000000000002'), 'cancelled',
  'its status is cancelled');
select is((select count(*)::int from public.professional_submission_private sp where sp.submission_id = 'd0000000-0000-0000-0000-000000000002'), 0,
  'its private row is deleted');
select is((select s.status from public.professional_submissions s where s.id = 'd0000000-0000-0000-0000-000000000001'), 'approved',
  'the approved onboarding is untouched');

select * from finish();
rollback;
