-- Professionnels: the questionnaire's consent answer (migration *_professionals_questionnaire_consent_answer.sql,
-- review of plan Phase 4 Task 4b.4). Covers: sign_my_consent's new return type and privileges, the
-- server time it answers (the one stored in the draft), get_my_submission's signed_consent_version
-- (null before a signature, the signed version once a newer text is published), and the unaccent
-- folds the questionnaire mirrors in the browser (lib/questionnaire.ts, comparableName).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- =============================================================================
-- Fixtures (as postgres): org A, the provider 03 linked to P2 (active), an update asking for the consent.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id) values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002');
insert into public.professional_matching_profiles (org_id, professional_id) values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002');
select private.create_professional_submission('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
  'update', array['consent'], null);
select set_config('test.v1', (select c.id::text from public.consent_versions c
                               where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'image_rights' and c.version = 1), true);

-- =============================================================================
-- Shape and privileges (as postgres)
-- =============================================================================
select function_returns('public', 'sign_my_consent', array['uuid', 'text'], 'timestamp with time zone', 'sign_my_consent answers the signature''s time');
select is_definer('public', 'sign_my_consent', array['uuid', 'text'], 'sign_my_consent is security definer');
select function_privs_are('public', 'sign_my_consent', array['uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may sign');
select function_privs_are('public', 'sign_my_consent', array['uuid', 'text'], 'anon', array[]::text[], 'anon may not sign');
select function_privs_are('public', 'sign_my_consent', array['uuid', 'text'], 'service_role', array[]::text[], 'the service role may not sign');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'sign_my_consent'), 1, 'one sign_my_consent, not overloaded');

-- =============================================================================
-- As the provider
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.get_my_submission() ? 'signed_consent_version' and public.get_my_submission() -> 'signed_consent_version' = 'null'::jsonb,
  'no version signed before the signature');
select is(public.sign_my_consent(current_setting('test.v1')::uuid, 'pia  DEUX'), now(), 'the signature answers the server''s time');
select is((public.get_my_submission() -> 'values' -> 'consent' ->> 'signed_at')::timestamptz, now(), '… the time stored in the draft');
select is((public.get_my_submission() ->> 'signed_consent_version')::int, 1, 'the version signed is named');
reset role;

-- A newer text published after the signature: the version signed still reads 1.
insert into public.consent_versions (org_id, key, version, title, body, published_at)
values ('b0000000-0000-0000-0000-00000000000a', 'image_rights', 2, 'Consentement au droit à l''image', 'Texte 2', now());
set local role authenticated;
select results_eq($$ select (public.get_my_submission() -> 'consent' ->> 'version')::int, (public.get_my_submission() ->> 'signed_consent_version')::int $$,
  $$ values (2, 1) $$, 'a newer text: the latest is 2, the signature names 1');
reset role;

-- The folds the browser mirrors before it asks (comparableName).
select is(lower(extensions.unaccent('extensions.unaccent'::regdictionary, 'ß ẞ Ł Ø Đ Ħ ı Ŀ Ŋ Œ Æ Þ Ð ĸ ſ Ĳ ŉ Ŧ ’ é Ç ü')),
  'ss ss l o d h i l n oe ae th d q s ij ''n t '' e c u', 'unaccent folds as comparableName does');

select * from finish();
rollback;
