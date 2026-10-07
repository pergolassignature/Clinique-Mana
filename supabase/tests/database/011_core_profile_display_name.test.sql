-- profiles.display_name length (migration *_core_profile_display_name.sql): 1 to 80 characters
-- once spaces, tabs and line breaks are stripped, as the « Mon compte » form (Zod) checks.
-- Covers: a single named check on the column, its bounds, and a self-rename through RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- =============================================================================
-- Fixtures (as postgres): one org, one active admin.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');

-- =============================================================================
-- One named check on the column
-- =============================================================================
select is(
  (select count(*)::int from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%display_name%'),
  1, 'display_name has exactly one check constraint');
select col_has_check('public', 'profiles', 'display_name', 'the check is on display_name');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_display_name_check'),
  'the check is named profiles_display_name_check');

-- =============================================================================
-- Bounds, as the caller renaming themselves (self-update policy + column grant)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok($$ update public.profiles set display_name = repeat('a', 80) where user_id = auth.uid() $$,
  '80 characters are accepted');
select lives_ok($$ update public.profiles set display_name = ' ' || repeat('a', 80) || E'\n' where user_id = auth.uid() $$,
  'surrounding spaces and line breaks do not count');
select throws_ok($$ update public.profiles set display_name = repeat('a', 81) where user_id = auth.uid() $$,
  '23514', null, '81 characters are refused');
select throws_ok($$ update public.profiles set display_name = E' \t\r\n' where user_id = auth.uid() $$,
  '23514', null, 'a blank name (spaces, tab, line breaks) is refused');
select throws_ok($$ update public.profiles set display_name = '' where user_id = auth.uid() $$,
  '23514', null, 'an empty name is refused');
select lives_ok($$ update public.profiles set display_name = 'Camille Tremblay' where user_id = auth.uid() $$,
  'an ordinary name is accepted');

select * from finish();
rollback;
