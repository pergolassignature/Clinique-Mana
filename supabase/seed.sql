-- #############################################################################
-- ##                                                                         ##
-- ##   LOCAL DEVELOPMENT SEED ONLY — NEVER RUN AGAINST STAGING OR PRODUCTION ##
-- ##                                                                         ##
-- ##   Applied by `supabase db reset` on the local stack. Remote resets      ##
-- ##   always pass `--no-seed`. It creates users with a KNOWN PASSWORD.      ##
-- ##                                                                         ##
-- #############################################################################
--
-- Test logins (same password for all four: ManaLocal-2026)
--   admin@mana.test        role admin
--   conseillere@mana.test  role counselor
--   adjointe@mana.test     role admin_assistant
--   provider@mana.test     role provider
--
-- Organization: « Clinique MANA (local) », module `professionals` enabled.

select set_config('app.audit_source', 'seed', false);

-- Guard: refuse to run on a database that already holds real users.
do $$
begin
  if exists (select 1 from auth.users where email not like '%@mana.test') then
    raise exception 'seed.sql is LOCAL ONLY: auth.users already contains non-test accounts';
  end if;
end;
$$;

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Clinique MANA (local)');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
  extensions.crypt('ManaLocal-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'admin@mana.test'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'conseillere@mana.test'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'provider@mana.test'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'adjointe@mana.test')
) as u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%@mana.test';

insert into public.profiles (user_id, org_id, display_name, email) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Admin Local',        'admin@mana.test'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Conseillère Locale', 'conseillere@mana.test'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'Pro Local',          'provider@mana.test'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'Adjointe Locale',    'adjointe@mana.test');

insert into public.user_roles (user_id, org_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'counselor'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'provider'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'admin_assistant');

insert into public.org_modules (org_id, module_key, enabled, updated_by) values
  ('00000000-0000-0000-0000-000000000001', 'professionals', true, '11111111-1111-1111-1111-111111111111');
