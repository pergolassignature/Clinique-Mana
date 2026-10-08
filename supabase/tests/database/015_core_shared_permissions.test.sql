-- Shared-services permissions and one permission source
-- (migration *_core_shared_permissions.sql, plan Phase 3 P3-12 and P3-21).
-- Covers: settings.email_manage and settings.integrations_manage (catalogue, template, every
-- org's admin), private.current_permission_keys (per user, disabled user, module gate,
-- privileges), parity with has_permission for every user and key, get_my_access reading the
-- same source, set_org_secret / delete_org_secret gated by settings.integrations_manage.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A (professionals on): admin A, adjointe D (override settings.manage granted,
-- professionals.view revoked), conseillère C, provider P, disabled admin X, and K in a custom
-- role whose only default is settings.view.
-- Org B (professionals off): admin B, and provider Q granted professionals.view by override.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'k@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'q@b.test',        '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',         'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D',      'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C',   'c@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Provider P',      'p@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Admin désactivé', 'x@a.test',        'disabled'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',         'admin@b.test',    'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Rôle perso K',    'k@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000b', 'Provider Q',      'q@b.test',        'active');
insert into public.roles (key, name, org_id) values ('custom_0000000a', 'Lecture seule', 'b0000000-0000-0000-0000-00000000000a');
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'custom_0000000a', 'settings.view');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'custom_0000000a'),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000b', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage',    true),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view', false),
  ('a0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000b', 'professionals.view', true);

-- =============================================================================
-- Catalogue and template
-- =============================================================================
select results_eq(
  $$ select key, module_key, description from public.permissions
      where key in ('settings.email_manage', 'settings.integrations_manage') order by key $$,
  $$ values ('settings.email_manage'::text, 'core'::text, 'Gérer les courriels de la clinique'::text),
            ('settings.integrations_manage', 'core', 'Gérer les clés d''intégration') $$,
  'settings.email_manage and settings.integrations_manage are core permissions');
select results_eq(
  $$ select role, permission_key from public.role_permissions
      where permission_key in ('settings.email_manage', 'settings.integrations_manage') order by permission_key $$,
  $$ values ('admin'::text, 'settings.email_manage'::text), ('admin', 'settings.integrations_manage') $$,
  'the template gives both to admin only');
select results_eq(
  $$ select org_id, role, permission_key from public.org_role_permissions
      where permission_key in ('settings.email_manage', 'settings.integrations_manage')
        and org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')
      order by org_id, permission_key $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'admin'::text, 'settings.email_manage'::text),
            ('b0000000-0000-0000-0000-00000000000a', 'admin', 'settings.integrations_manage'),
            ('b0000000-0000-0000-0000-00000000000b', 'admin', 'settings.email_manage'),
            ('b0000000-0000-0000-0000-00000000000b', 'admin', 'settings.integrations_manage') $$,
  'org A and org B admins hold both (Task 2.20 template)');
-- Every org, the seed's included (new orgs copy the template; existing ones get the propagated rows).
select is_empty($$
  select o.id from public.organizations o
   where not exists (select 1 from public.org_role_permissions x
                      where x.org_id = o.id and x.role = 'admin' and x.permission_key = 'settings.integrations_manage')
      or not exists (select 1 from public.org_role_permissions x
                      where x.org_id = o.id and x.role = 'admin' and x.permission_key = 'settings.email_manage')
$$, 'every org''s admin holds both');

-- =============================================================================
-- private.current_permission_keys(): privileges
-- =============================================================================
select function_privs_are('private', 'current_permission_keys', array[]::text[], 'anon', array[]::text[],
  'anon cannot call current_permission_keys');
select function_privs_are('private', 'current_permission_keys', array[]::text[], 'authenticated', array['EXECUTE'],
  'authenticated can call current_permission_keys (policies run as the caller)');
select function_privs_are('private', 'current_permission_keys', array[]::text[], 'service_role', array['EXECUTE'],
  'service_role can call current_permission_keys');
select is(
  (select p.provolatile::text || p.prosecdef::text from pg_proc p
     where p.oid = 'private.current_permission_keys()'::regprocedure),
  'strue', 'current_permission_keys is stable and security definer');
-- A security definer `language sql` wrapper is never inlined: plpgsql caches its plan.
select is(
  (select l.lanname || p.provolatile::text || p.prosecdef::text from pg_proc p join pg_language l on l.oid = p.prolang
     where p.oid = 'private.has_permission(text)'::regprocedure),
  'plpgsqlstrue', 'has_permission is plpgsql, stable and security definer');

-- =============================================================================
-- private.current_permission_keys(): per user
-- =============================================================================
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.current_permission_keys(),
  (select array_agg(pm.key order by pm.key) from public.permissions pm where pm.module_key in ('core', 'professionals')),
  'admin A: every core key and professionals.view');
select ok('settings.integrations_manage' = any (private.current_permission_keys()), 'admin A holds settings.integrations_manage');
select is(public.get_my_access() -> 'permissions', to_jsonb(private.current_permission_keys()),
  'admin A: get_my_access permissions read the same source');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(private.current_permission_keys(), array['settings.manage', 'settings.view'],
  'adjointe D: role defaults, plus the granted override, minus the revoked one');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(private.current_permission_keys(), array['professionals.view'], 'conseillère: {professionals.view}');
select is(public.get_my_access() -> 'permissions', to_jsonb(private.current_permission_keys()),
  'conseillère: get_my_access permissions read the same source');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(private.current_permission_keys(), array[]::text[], 'provider: nothing by default');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(private.current_permission_keys(), array[]::text[], 'disabled admin: {}');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(private.current_permission_keys(),
  (select array_agg(pm.key order by pm.key) from public.permissions pm where pm.module_key = 'core'),
  'admin B: core keys only (professionals is off in org B)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is(private.current_permission_keys(), array['settings.view'], 'custom role K: the org''s defaults for that role');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(private.current_permission_keys(), array[]::text[],
  'provider Q: a granted override on a module that is off in org B gives nothing');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
select is(private.current_permission_keys(), array[]::text[], 'a user without a profile: {}');
select is(private.has_permission(null), false, 'has_permission(null) is still false');

-- =============================================================================
-- Parity: has_permission(k) = (k = any(current_permission_keys())), every user, every key
-- (plus an unknown key). Inline do block, no helper function (conventions §10 traps).
-- =============================================================================
reset role;
create temp table parity_mismatches (user_id uuid, permission_key text) on commit drop;
do $$
declare
  v_user uuid;
  v_key text;
begin
  foreach v_user in array array[
    'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000008']::uuid[]
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    for v_key in select pm.key from public.permissions pm union all select 'nope.unknown' loop
      if private.has_permission(v_key) is distinct from (v_key = any (private.current_permission_keys())) then
        insert into parity_mismatches values (v_user, v_key);
      end if;
    end loop;
  end loop;
end $$;
select is_empty('select * from parity_mismatches', 'has_permission agrees with current_permission_keys for every user and key');

-- =============================================================================
-- set_org_secret / delete_org_secret need settings.integrations_manage
-- =============================================================================
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_org_secret('resend_api_key', 'x') $$, 'admin A stores a secret');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_org_secret('resend_api_key', 'x') $$, '42501',
  'Permission refusée : settings.integrations_manage', 'settings.manage is not enough to write a secret');
select throws_ok($$ select public.delete_org_secret('resend_api_key') $$, '42501',
  'Permission refusée : settings.integrations_manage', 'settings.manage is not enough to delete a secret');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select results_eq($$ select key from public.list_org_secret_keys() $$, array['resend_api_key'],
  'list_org_secret_keys needs settings.view only (custom role K holds nothing else)');

-- The permission itself is the gate, not the admin role nor settings.manage.
reset role;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'settings.integrations_manage', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.set_org_secret('resend_api_key', 'y') $$,
  'a conseillère granted settings.integrations_manage (no settings.manage) rotates a secret');
select lives_ok($$ select public.delete_org_secret('resend_api_key') $$,
  'a conseillère granted settings.integrations_manage deletes a secret');

select * from finish();
rollback;
