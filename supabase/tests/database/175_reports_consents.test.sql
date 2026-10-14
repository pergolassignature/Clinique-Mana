-- Rapports: « Consentements » (migration *_reports_consents.sql, CC-19). Covers: the app executes
-- it; reports.view (the counselor refused); the states per consent as the tabs count them; per
-- professional (the « à obtenir » without « jamais demandé »); per month (app, import,
-- withdrawals); the send → sign delay; the professional filter; the period's rules; another clinic.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select function_privs_are('public', 'report_consents', array['date', 'date', 'uuid'], 'authenticated', array['EXECUTE'], 'report_consents: users');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000004', 'conseillere@a.test'),
               ('a0000000-0000-0000-0000-000000000009', 'admin@b.test')) as x(u, e);
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'), ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, primary_professional_id) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Kim', 'Un', 'c0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Lou', 'Deux', 'c0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Sam', 'Trois', null);
create temporary table v as
select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr';
insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, state, signed_at, due_at, created_at) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', (select id from v), 'signed', '2026-09-05 12:00 America/Toronto', null, '2026-09-01 12:00 America/Toronto'),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'general', 'fr', (select id from v), 'signed', '2026-08-31 12:00 America/Toronto', null, '2026-08-30 12:00 America/Toronto'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'fr', (select id from v), 'pending', null, now() + interval '5 days', now() - interval '2 days');
insert into public.client_consents (org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by, request_id, source, withdrawn_at) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', (select id from v), 'v1', '2026-09-05 12:00 America/Toronto', '[]', 'e1000000-0000-0000-0000-000000000001', 'app', null),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'general', 'fr', (select id from v), 'v1', '2026-08-31 12:00 America/Toronto', '[]', 'e1000000-0000-0000-0000-000000000003', 'app', null),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'coaching', 'fr', null, 'GOrendezvous', '2026-09-12 12:00 America/Toronto', '[]', null, 'import', '2026-10-02 12:00 America/Toronto');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.report_consents('2026-09-01', '2026-10-31') $$, '42501', null, 'the counselor: reports.view');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.report_consents('2026-09-01', '2026-10-31')::text, true);
select is((select g from jsonb_array_elements(current_setting('test.r')::jsonb -> 'gaps') g where g ->> 'consent_key' = 'general'),
  '{"consent_key": "general", "consent_name": "Consentement général", "signed": 2, "resign": 0, "pending": 1, "overdue": 0, "withdrawn": 0, "none": 0}'::jsonb,
  'the general consent today: Kim and Sam signed, Lou pending');
select is((select (g ->> 'withdrawn')::int from jsonb_array_elements(current_setting('test.r')::jsonb -> 'gaps') g where g ->> 'consent_key' = 'coaching'),
  1, 'coaching: Kim''s withdrawn');
select is(jsonb_array_length(current_setting('test.r')::jsonb -> 'gaps'), 7, 'every active consent');
select results_eq($$ select b ->> 'professional_name', b ->> 'consent_key', (b ->> 'signed')::int, (b ->> 'to_obtain')::int
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'by_professional') b
                      order by 1 nulls last, 2 $$,
  $$ values ('Pro Un'::text, 'coaching'::text, 0, 1), ('Pro Un', 'general', 1, 1), (null, 'general', 1, 0) $$,
  'per professional: signed and « à obtenir », « jamais demandé » left out');
select is(current_setting('test.r')::jsonb -> 'months',
  '[{"month": "2026-09", "signed": 1, "imported": 1, "withdrawn": 0}, {"month": "2026-10", "signed": 0, "imported": 0, "withdrawn": 1}]'::jsonb,
  'per month: September''s signature in the app and the import, October''s withdrawal');
select is(current_setting('test.r')::jsonb -> 'delays',
  '[{"consent_key": "general", "consent_name": "Consentement général", "count": 1, "average_days": 4.0, "median_days": 4.0}]'::jsonb,
  'the delay: Kim''s 4 days from the send (Sam''s, signed in August, out of the period)');
select is(current_setting('test.r')::jsonb -> 'totals', '{"clients": 3, "signed": 2, "withdrawn": 1}'::jsonb, 'the totals');

select is((select (g ->> 'signed')::int from jsonb_array_elements(public.report_consents('2026-09-01', '2026-10-31', 'c0000000-0000-0000-0000-000000000001') -> 'gaps') g
            where g ->> 'consent_key' = 'general'), 1, 'the professional filter: her clients only');
select throws_ok($$ select public.report_consents('2026-10-31', '2026-09-01') $$, 'P0001', null, 'a period the wrong way round');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(public.report_consents('2026-09-01', '2026-10-31') -> 'totals', '{"clients": 0, "signed": 0, "withdrawn": 0}'::jsonb,
  'another clinic sees none of it');

select * from finish();
rollback;
