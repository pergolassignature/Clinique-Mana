-- « L'entente d'abord » (migration *_professionals_contract_first.sql, decision P4-565, Jonathan's
-- « Suivi » of 22 October 2026, item 1). Covers: the sections the service contract needs; the
-- clinic setting, off by default, a boolean only, changed with professionals.settings; an
-- invitation asks the whole questionnaire while it is off and only the contract's sections once it
-- is on; a draft onboarding already open keeps its own sections.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- =============================================================================
-- Fixtures (as postgres): org A with its admin; Paul and Rita, two files without an account.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u1@cf.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@cf.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Paul', 'Un', 'paul@cf.test'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Rita', 'Deux', 'rita@cf.test');

select is(private.contract_submission_sections(), array['personal', 'professional'],
  'the contract needs the address and the profession: « Renseignements personnels » and « Profil professionnel »');

-- =============================================================================
-- The setting
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_professionals_settings() -> 'invitation_contract_first', 'false'::jsonb,
  '« L''entente d''abord » is off by default: the single questionnaire as before');
select throws_ok($$ select public.set_professionals_settings('{"invitation_contract_first": "oui"}') $$, '22023', null,
  'it is a yes or a no');
reset role;

-- Off: Paul is invited to the whole questionnaire.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001',
                    'c0000000-0000-0000-0000-000000000001', extensions.digest('cf-paul', 'sha256')) $$,
  'Paul is invited while the setting is off');
reset role;
select is((select s.requested_sections from public.professional_submissions s
            where s.professional_id = 'c0000000-0000-0000-0000-000000000001' and s.kind = 'onboarding'),
  private.submission_sections(), '… and his questionnaire asks every section');

-- On: Rita is asked the contract's sections only.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professionals_settings('{"invitation_contract_first": true}') -> 'invitation_contract_first', 'true'::jsonb,
  'the admin switches « L''entente d''abord » on');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001',
                    'c0000000-0000-0000-0000-000000000002', extensions.digest('cf-rita', 'sha256')) $$,
  'Rita is invited once it is on');
-- Paul's draft is already open: a new link keeps its sections.
select lives_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001',
                    'c0000000-0000-0000-0000-000000000001', extensions.digest('cf-paul-2', 'sha256')) $$,
  'Paul is sent a new link');
reset role;
select results_eq($$ select s.professional_id, s.requested_sections from public.professional_submissions s
                      where s.kind = 'onboarding' order by s.professional_id $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, private.submission_sections()),
            ('c0000000-0000-0000-0000-000000000002'::uuid, array['personal', 'professional']) $$,
  'Rita''s questionnaire asks the entente''s two sections; Paul''s draft keeps the whole questionnaire');

select * from finish();
rollback;
