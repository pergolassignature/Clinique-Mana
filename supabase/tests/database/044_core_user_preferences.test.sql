-- Per-user preferences (migration *_core_user_preferences.sql, plan Phase 4 Task 4a.10, remembered
-- filters, P4-39).
-- Covers: shape (columns, primary key, composite FK to profiles, named checks, updated_at
-- trigger), privileges (select only on the table, the two RPCs for authenticated only), the one
-- select policy; set_user_preference (insert, upsert, keys with « : » and « - », the key format,
-- object-only values, the 16 KB cap, null arguments, the 50-key cap with updates still allowed at
-- the cap); delete_user_preference; isolation (another user of the same org, another org: no
-- read, no write, no direct table write); a disabled user (rows hidden, both RPCs refused);
-- cascade when the profile is deleted; no audit row (UI state, 000_invariants exception).
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- =============================================================================
-- Fixtures (as postgres): org A with user U1, user U2, disabled user X and user D (deleted at the
-- end); org B with user B1. X already has a saved preference.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@a.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'U1',          'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'U2',          'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Désactivé X', 'x@a.test',  'disabled'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'D',           'd@a.test',  'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'B1',          'b1@b.test', 'active');
insert into public.user_preferences (user_id, org_id, key, value) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals.list_filters', '{"q": "x"}');

-- =============================================================================
-- Shape
-- =============================================================================
select has_table('public', 'user_preferences', 'user_preferences exists');
select columns_are('public', 'user_preferences',
  array['user_id', 'org_id', 'key', 'value', 'created_at', 'updated_at'], 'exact columns');
select col_is_pk('public', 'user_preferences', array['user_id', 'key'], 'primary key (user_id, key)');
select fk_ok('public', 'user_preferences', array['user_id', 'org_id'],
             'public', 'profiles', array['user_id', 'org_id'], 'composite FK to profiles (user_id, org_id)');
select is(
  (select c.confdeltype::text from pg_constraint c
    where c.conrelid = 'public.user_preferences'::regclass and c.contype = 'f'),
  'c', 'the profile FK cascades on delete');
select bag_eq(
  $$ select c.conname::text from pg_constraint c
      where c.conrelid = 'public.user_preferences'::regclass and c.contype = 'c' $$,
  $$ values ('user_preferences_key_format'), ('user_preferences_value_object'), ('user_preferences_value_size') $$,
  'named checks: key format, object value, size');
select has_trigger('public', 'user_preferences', 'user_preferences_set_updated_at', 'updated_at trigger');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.user_preferences'::regclass),
  'RLS is enabled');

-- =============================================================================
-- Privileges and policies
-- =============================================================================
select table_privs_are('public', 'user_preferences', 'anon', array[]::text[], 'anon: nothing');
select table_privs_are('public', 'user_preferences', 'authenticated', array['SELECT'],
  'authenticated: select only (writes go through the RPCs)');
select policies_are('public', 'user_preferences', array['user_preferences_select'], 'one select policy');
select function_privs_are('public', 'set_user_preference', array['text', 'jsonb'], 'anon', array[]::text[],
  'anon cannot call set_user_preference');
select function_privs_are('public', 'set_user_preference', array['text', 'jsonb'], 'authenticated', array['EXECUTE'],
  'authenticated may call set_user_preference');
select function_privs_are('public', 'set_user_preference', array['text', 'jsonb'], 'service_role', array[]::text[],
  'service_role cannot call set_user_preference (acts for auth.uid())');
select function_privs_are('public', 'delete_user_preference', array['text'], 'anon', array[]::text[],
  'anon cannot call delete_user_preference');
select function_privs_are('public', 'delete_user_preference', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated may call delete_user_preference');
select function_privs_are('public', 'delete_user_preference', array['text'], 'service_role', array[]::text[],
  'service_role cannot call delete_user_preference (acts for auth.uid())');

-- =============================================================================
-- U1 saves, overwrites and deletes their own preferences
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select lives_ok($$ select public.set_user_preference('professionals.list_filters', '{"q": "Tremblay", "status": "active"}') $$,
  'U1 saves a preference');
select results_eq(
  $$ select key, value from public.user_preferences $$,
  $$ values ('professionals.list_filters'::text, '{"q": "Tremblay", "status": "active"}'::jsonb) $$,
  'U1 reads it back (and nothing else)');
select is((select org_id from public.user_preferences), 'b0000000-0000-0000-0000-00000000000a'::uuid,
  'org_id comes from the caller''s profile');
select lives_ok($$ select public.set_user_preference('professionals.list_filters', '{"q": ""}') $$,
  'saving again overwrites');
select results_eq(
  $$ select key, value from public.user_preferences $$,
  $$ values ('professionals.list_filters'::text, '{"q": ""}'::jsonb) $$,
  'one row per key, new value');
select lives_ok($$ select public.set_user_preference('clients:list-v2', '{}') $$,
  'keys may contain « : » and « - »; an empty object is a value');
select lives_ok($$ select public.set_user_preference(repeat('k', 100), '{}') $$, 'a 100-character key is accepted');
select lives_ok($$ select public.set_user_preference('big', jsonb_build_object('q', repeat('x', 16000))) $$,
  'a value just under 16 KB is accepted');

-- Format and size
select throws_ok($$ select public.set_user_preference(repeat('k', 101), '{}') $$, '23514', null,
  'a 101-character key is refused');
select throws_ok($$ select public.set_user_preference('Professionals.List', '{}') $$, '23514', null,
  'upper case is refused');
select throws_ok($$ select public.set_user_preference('a b', '{}') $$, '23514', null, 'spaces are refused');
select throws_ok($$ select public.set_user_preference('', '{}') $$, '23514', null, 'an empty key is refused');
select throws_ok($$ select public.set_user_preference('k', '[]') $$, '23514', null, 'an array value is refused');
select throws_ok($$ select public.set_user_preference('k', '"text"') $$, '23514', null, 'a scalar value is refused');
select throws_ok($$ select public.set_user_preference('k', jsonb_build_object('q', repeat('x', 16400))) $$, '23514', null,
  'a value over 16 KB is refused');
select throws_ok($$ select public.set_user_preference(null, '{}') $$, '22023', null, 'a null key is refused');
select throws_ok($$ select public.set_user_preference('k', null) $$, '22023', null, 'a null value is refused');

-- Direct writes are closed (no INSERT / UPDATE / DELETE privilege)
select throws_ok($$ insert into public.user_preferences (user_id, org_id, key, value)
                    values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'k', '{}') $$,
  '42501', null, 'no direct insert');
select throws_ok($$ update public.user_preferences set value = '{}' $$, '42501', null, 'no direct update');
select throws_ok($$ delete from public.user_preferences $$, '42501', null, 'no direct delete');

select lives_ok($$ select public.delete_user_preference('big') $$, 'U1 deletes a preference');
select lives_ok($$ select public.delete_user_preference('never-saved') $$, 'deleting a missing key is a no-op');
select bag_eq(
  $$ select key from public.user_preferences $$,
  $$ values ('clients:list-v2'::text), ('professionals.list_filters'::text), (repeat('k', 100)) $$,
  'U1 keeps the other keys');

-- =============================================================================
-- Another user of the same org: no read, no write on U1's rows
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is_empty($$ select 1 from public.user_preferences $$, 'U2 sees none of U1''s rows');
select lives_ok($$ select public.delete_user_preference('professionals.list_filters') $$,
  'U2 deleting the same key touches only their own (absent) row');
select lives_ok($$ select public.set_user_preference('professionals.list_filters', '{"q": "U2"}') $$,
  'U2 saves the same key');
select results_eq($$ select value from public.user_preferences $$, $$ values ('{"q": "U2"}'::jsonb) $$,
  'U2 sees only their own row');

-- =============================================================================
-- Another org
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select 1 from public.user_preferences $$, 'org B sees nothing of org A');

-- =============================================================================
-- Disabled user: rows hidden, writes refused
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.user_preferences $$, 'a disabled user cannot read their own rows');
select throws_ok($$ select public.set_user_preference('professionals.list_filters', '{}') $$, '42501', null,
  'a disabled user cannot save');
select throws_ok($$ select public.delete_user_preference('professionals.list_filters') $$, '42501', null,
  'a disabled user cannot delete');

-- =============================================================================
-- Key cap: 50 keys per user; an existing key can still be updated at the cap
-- =============================================================================
reset role;
insert into public.user_preferences (user_id, org_id, key, value)
select 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'filler.' || i, '{}'
  from generate_series(1, 47) i;   -- U1 had 3 keys: now 50
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_user_preference('one.too.many', '{}') $$, '22023', null,
  'a 51st key is refused');
select lives_ok($$ select public.set_user_preference('professionals.list_filters', '{"q": "cap"}') $$,
  'an existing key is still updated at the cap');

-- =============================================================================
-- Not audited (UI state, 000_invariants exception)
-- =============================================================================
reset role;
select is_empty($$ select 1 from public.audit_log where table_name = 'user_preferences' $$,
  'preference writes leave no audit row');

-- =============================================================================
-- Retention: rows are deleted with the profile
-- =============================================================================
insert into public.user_preferences (user_id, org_id, key, value) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals.list_filters', '{}');
delete from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000004';
select is_empty($$ select 1 from public.user_preferences where user_id = 'a0000000-0000-0000-0000-000000000004' $$,
  'deleting a profile deletes its preferences');
select isnt_empty($$ select 1 from public.user_preferences where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'other users keep theirs');

select * from finish();
rollback;
