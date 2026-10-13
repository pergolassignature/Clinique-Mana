-- Clients: each consent text version's « Oui / Non » clauses (CC-13, migration
-- *_clients_consent_clauses.sql). Covers: privileges and RLS; a version without clauses of its own
-- reads the type's (in its language), then its template's published version's; a draft's clauses
-- set, trimmed, reordered, refused in French (no text, too many) or as 22023 (a bad key or kind);
-- never a published version's; publication freezes them; a request takes its version's clauses,
-- and again when publication moves it unanswered (an answered one keeps its own).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

select table_privs_are('public', 'client_consent_version_clauses', 'authenticated', array['SELECT'], 'select only');
select table_privs_are('public', 'client_consent_version_clauses', 'anon', array[]::text[], 'nothing for anon');
select function_privs_are('public', f.name, f.args, 'anon', array[]::text[], f.name || ': not for anon')
  from (values ('get_client_consent_clauses', array['uuid']), ('set_client_consent_clauses', array['uuid', 'jsonb'])) as f(name, args);

-- Fixtures: org A (admin, provider), clients module on; the seeded drafts.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.clients (id, org_id, first_name, last_name, email, birthday) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test', date '1990-03-04'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Côté', 'zoe@exemple.test', date '1995-05-05');
select set_config('test.v1', (select v.id::text from public.document_template_versions v join public.document_templates t on t.id = v.template_id
                               where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_en' and v.version = 1), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_client_consent_clauses(current_setting('test.v1')::uuid),
  '{"clauses": [{"key": "accord", "kind": "agree", "text": "Provisional clause: I have read this consent and I agree to it."}], "editable": true}'::jsonb,
  'no clauses of its own: the type''s, in the version''s language (English); a draft is editable');
select is(public.set_client_consent_clauses(current_setting('test.v1')::uuid,
  '[{"key": "email", "kind": "yes_no", "text": "  I agree to   receive reminders by email. "},
    {"key": "accord", "kind": "agree", "text": "I have read and agree."}]'),
  '[{"key": "email", "kind": "yes_no", "text": "I agree to receive reminders by email."},
    {"key": "accord", "kind": "agree", "text": "I have read and agree."}]'::jsonb,
  'set: added, reworded, reordered, trimmed');
select throws_ok($$ select public.set_client_consent_clauses(current_setting('test.v1')::uuid, '[{"key": "a", "kind": "agree", "text": "  "}]') $$,
  'P0001', 'Chaque clause a un texte.', 'a clause without text');
select throws_ok($$ select public.set_client_consent_clauses(current_setting('test.v1')::uuid,
  (select jsonb_agg(jsonb_build_object('key', 'c' || n, 'kind', 'yes_no', 'text', 'Clause ' || n)) from generate_series(1, 21) n)) $$,
  'P0001', 'Un consentement a au plus 20 clauses.', 'at most 20');
select throws_ok($$ select public.set_client_consent_clauses(current_setting('test.v1')::uuid,
  '[{"key": "a", "kind": "agree", "text": "x"}, {"key": "a", "kind": "yes_no", "text": "y"}]') $$,
  '22023', null, 'keys are unique');
select throws_ok($$ select public.set_client_consent_clauses(current_setting('test.v1')::uuid, '[{"key": "a", "kind": "maybe", "text": "x"}]') $$,
  '22023', null, 'two kinds only');

-- A request sent on the version takes its clauses.
reset role;
insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, clauses) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'en',
   current_setting('test.v1')::uuid, '[]'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'en',
   current_setting('test.v1')::uuid, '[]');
select is((select clauses from public.client_consent_requests where id = 'e0000000-0000-0000-0000-000000000001'),
  '[{"key": "email", "kind": "yes_no", "text_en": "I agree to receive reminders by email.", "text_fr": "I agree to receive reminders by email."},
    {"key": "accord", "kind": "agree", "text_en": "I have read and agree.", "text_fr": "I have read and agree."}]'::jsonb,
  'a request takes its version''s clauses');
update public.client_consent_requests set answers = '{"email": "yes", "accord": "yes"}', answered_at = now()
 where id = 'e0000000-0000-0000-0000-000000000002';

-- Publication freezes them.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.publish_client_consent_version(current_setting('test.v1')::uuid, 'new_clients') $$, 'published');
reset role;
select is((select jsonb_array_length(clauses) from public.client_consent_version_clauses where version_id = current_setting('test.v1')::uuid), 2,
  'frozen with the version');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_client_consent_clauses(current_setting('test.v1')::uuid, '[]') $$,
  'P0001', 'Les clauses d''une version publiée ne changent plus : créez une nouvelle version du texte.', 'never a published version''s');
select is(public.get_client_consent_clauses(current_setting('test.v1')::uuid) -> 'editable', 'false'::jsonb, 'not editable');

-- A new draft reads the published clauses until it has its own.
select set_config('test.v2', public.create_template_version(
  (select template_id from public.document_template_versions where id = current_setting('test.v1')::uuid))::text, true);
select is(jsonb_array_length(public.get_client_consent_clauses(current_setting('test.v2')::uuid) -> 'clauses'), 2,
  'a new draft starts from the published clauses');
select lives_ok($$ select public.set_client_consent_clauses(current_setting('test.v2')::uuid,
  '[{"key": "accord", "kind": "agree", "text": "I agree (v2)."}]') $$, 'the draft''s own');
reset role;
select is((select jsonb_array_length(clauses) from public.client_consent_version_clauses where version_id = current_setting('test.v1')::uuid), 2,
  'the published version''s are unchanged');

-- Publishing v2 moves the unanswered request with its clauses; the answered one keeps its own.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.publish_client_consent_version(current_setting('test.v2')::uuid, 'new_clients') $$, 'v2 published');
reset role;
select is((select clauses -> 0 ->> 'text_en' from public.client_consent_requests where id = 'e0000000-0000-0000-0000-000000000001'),
  'I agree (v2).', 'the unanswered request reads v2''s clauses');
select is((select jsonb_array_length(clauses) from public.client_consent_requests where id = 'e0000000-0000-0000-0000-000000000002'), 2,
  'the answered one keeps those it was answered on');

-- Without clients.view: nothing.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_client_consent_clauses(current_setting('test.v1')::uuid) $$, '42501', null, 'the provider: no');
select is((select count(*)::int from public.client_consent_version_clauses), 0, 'and reads no row');

select * from finish();
rollback;
