-- The contract card's signed-PDF downloads (migration *_professionals_contract_signed_files.sql,
-- P4-500). Covers: get_professional_contract returns the request's title, source file and page
-- count to a caller holding the request's view permission (the admin), never to one without it
-- (the conseillère: the keys are there, null), and is unchanged otherwise (privileges).
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select function_privs_are('public', 'get_professional_contract', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may read the contract card');
select function_privs_are('public', 'get_professional_contract', array['uuid'], 'anon', array[]::text[],
  'anon may not read the contract card');

-- =============================================================================
-- Fixtures (as postgres): org A with an admin and a conseillère; P1 with a contract sent (7 pages,
-- its source file stored).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, first_name, last_name, email, province, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pia', 'Un', 'pia@exemple.ca', 'QC', 'invited');

insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id,
  title, status, idempotency_key, view_permission)
select 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professionals',
       'professionals.service_contract', v.id, 'professional', 'c0000000-0000-0000-0000-000000000001',
       'Contrat de service — Pia Un', 'draft', 'professionals.service_contract:p1:k1', 'professionals.compensation'
  from public.document_template_versions v
  join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.service_contract';
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order)
values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pia Un', 'pia@exemple.ca', 1);
create temp table t (step text primary key, id uuid) on commit drop;
grant select, insert on t to service_role;
grant select on t to authenticated;
set local role service_role;
insert into t (step, id)
select 'src', f.file_id
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'signing_source',
         'signature_request', 'd0000000-0000-0000-0000-000000000001', 'application/pdf', 5000, repeat('c', 64),
         'professionals.compensation', 'Document à signer.pdf') f;
select public.mark_signature_request_sent('d0000000-0000-0000-0000-000000000001', 'envelope_pia1',
  (select id from t where step = 'src'), '[{"role": "professional", "recipient_id": "301"}]', now() + interval '7 days', 7);
reset role;

-- =============================================================================
-- The card
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r ->> 'title', (r ->> 'page_count')::int, (r ->> 'source_file_id')::uuid = (select id from t where step = 'src'),
                            (r ->> 'can_read')::boolean
                       from (select public.get_professional_contract('c0000000-0000-0000-0000-000000000001') -> 'request' r) x $$,
  $$ values ('Contrat de service — Pia Un'::text, 7, true, true) $$,
  'the admin (professionals.compensation) reads the title, N and the source file (the downloads)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.card', (public.get_professional_contract('c0000000-0000-0000-0000-000000000001') -> 'request')::text, true);
select ok(current_setting('test.card')::jsonb ?& array['title', 'page_count', 'source_file_id'],
  'the conseillère''s card has the keys');
select results_eq($$ select r -> 'title', r -> 'page_count', r -> 'source_file_id', (r ->> 'can_read')::boolean
                       from (select current_setting('test.card')::jsonb r) x $$,
  $$ values ('null'::jsonb, 'null'::jsonb, 'null'::jsonb, false) $$,
  'but all null: the contract prints the pay (P4-435)');
reset role;
select is((select status from public.signature_requests where id = 'd0000000-0000-0000-0000-000000000001'), 'sent',
  'the fixture request is sent');

select * from finish();
rollback;
