-- Professionnels: reviewers see their work on Accueil (migration
-- *_professionals_review_notices_important.sql, gap audit V11, P4-506). Covers: « Mise à jour à
-- réviser » (submit_my_submission) and « Document à vérifier » (attach_professional_document by
-- the professional) are important notices, still addressed to the reviewers only, so they reach
-- Accueil's list of important notices and the bell's important count; others never see them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, conseillère 02, provider 03 linked to P1, active).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'u3@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'u3@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id) values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_matching_profiles (org_id, professional_id) values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
-- Her own upload, ready (as storage-confirm leaves it).
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until, uploaded_by, confirmed_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-000000000001.pdf',
        'professionals', 'professional_self_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'cv.pdf',
        'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view', 'a0000000-0000-0000-0000-000000000003',
        'professionals.self', now() + interval '1 day', 'a0000000-0000-0000-0000-000000000003', now());

-- =============================================================================
-- « Mise à jour à réviser »
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.request_professional_update('c0000000-0000-0000-0000-000000000001', array['availability']) is not null, 'an update is asked');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select public.save_my_submission_draft('availability', '{"accepting_new_clients": false, "availability_periods": ["weekend"]}');
select lives_ok($$ select public.submit_my_submission() $$, 'she sends it');
-- « Document à vérifier »: her own upload waits for review.
select ok(public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv', 'e0000000-0000-0000-0000-000000000001') is not null,
  'she uploads a document');
reset role;

select results_eq($$ select n.kind, n.importance, n.recipient_permission from public.notifications n
                      where n.org_id = 'b0000000-0000-0000-0000-00000000000a' order by n.kind $$,
  $$ values ('professionals.document_to_review'::text, 'important'::text, 'professionals.documents.review'::text),
            ('professionals.submission_received', 'important', 'professionals.review') $$,
  'both notices are important, for the reviewers');

-- Accueil reads the important unread ones; the conseillère (no review permission) sees none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select n.title from public.list_my_notifications(null, 20, 'important', true) n order by n.title $$,
  $$ values ('Document à vérifier'::text), ('Mise à jour à réviser') $$, 'the reviewer finds both on Accueil');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_my_notifications(null, 20, 'important', true) $$, 'the conseillère does not');
reset role;

select * from finish();
rollback;
