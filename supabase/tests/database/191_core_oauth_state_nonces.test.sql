-- OAuth state nonces (migration *_core_oauth_state_nonces.sql, security review 2026-10-14).
-- Covers: privileges on oauth_state_nonces and spend_oauth_state_nonce_for_service; a nonce is
-- spent once (a replay is refused, whatever window it falls in); argument checks; rows expired
-- for over an hour are purged by the next spend, a recently expired one is kept.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'oauth_state_nonces', 'anon', array[]::text[], 'anon: nothing on oauth_state_nonces');
select table_privs_are('public', 'oauth_state_nonces', 'authenticated', array[]::text[],
  'authenticated: nothing on oauth_state_nonces');
select is((select relrowsecurity from pg_class where oid = 'public.oauth_state_nonces'::regclass), true,
  'oauth_state_nonces has RLS');
select function_privs_are('public', 'spend_oauth_state_nonce_for_service', array['bytea', 'timestamp with time zone'], 'anon',
  array[]::text[], 'anon cannot spend a nonce');
select function_privs_are('public', 'spend_oauth_state_nonce_for_service', array['bytea', 'timestamp with time zone'], 'authenticated',
  array[]::text[], 'authenticated cannot spend a nonce');
select function_privs_are('public', 'spend_oauth_state_nonce_for_service', array['bytea', 'timestamp with time zone'], 'service_role',
  array['EXECUTE'], 'service_role spends a nonce');

-- =============================================================================
-- Fixtures (as postgres): two old rows (expired over an hour ago), one recently expired.
-- =============================================================================
insert into public.oauth_state_nonces (nonce_hash, expires_at) values
  (extensions.digest('old-1', 'sha256'), now() - interval '2 hours'),
  (extensions.digest('old-2', 'sha256'), now() - interval '3 days'),
  (extensions.digest('recent', 'sha256'), now() - interval '10 minutes');

-- =============================================================================
-- Spending (as service_role)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(public.spend_oauth_state_nonce_for_service(extensions.digest('nonce-a', 'sha256'), now() + interval '10 minutes'),
  true, 'the first spend of a nonce is allowed');
select is(public.spend_oauth_state_nonce_for_service(extensions.digest('nonce-a', 'sha256'), now() + interval '10 minutes'),
  false, 'a second spend of the same nonce is refused');
select is(public.spend_oauth_state_nonce_for_service(extensions.digest('nonce-a', 'sha256'), now() + interval '20 minutes'),
  false, 'a replay with another expiry is refused too (no window to wait out)');
select is(public.spend_oauth_state_nonce_for_service(extensions.digest('nonce-b', 'sha256'), now() + interval '10 minutes'),
  true, 'another nonce is independent');

select throws_ok($$ select public.spend_oauth_state_nonce_for_service('\x0102'::bytea, now() + interval '10 minutes') $$,
  '22023', 'Arguments invalides.', 'a hash that is not 32 bytes is refused');
select throws_ok($$ select public.spend_oauth_state_nonce_for_service(null, now() + interval '10 minutes') $$,
  '22023', 'Arguments invalides.', 'a null hash is refused');
select throws_ok($$ select public.spend_oauth_state_nonce_for_service(extensions.digest('nonce-c', 'sha256'), now() + interval '2 days') $$,
  '22023', 'Arguments invalides.', 'an expiry more than a day ahead is refused');

reset role;

-- =============================================================================
-- Purge
-- =============================================================================
select is((select count(*)::int from public.oauth_state_nonces
            where nonce_hash in (extensions.digest('old-1', 'sha256'), extensions.digest('old-2', 'sha256'))),
  0, 'rows expired over an hour ago are purged by a spend');
select is((select count(*)::int from public.oauth_state_nonces where nonce_hash = extensions.digest('recent', 'sha256')),
  1, 'a recently expired row is kept (clock-skew margin)');
select is((select count(*)::int from public.oauth_state_nonces
            where nonce_hash in (extensions.digest('nonce-a', 'sha256'), extensions.digest('nonce-b', 'sha256'))),
  2, 'each spent nonce is recorded once');

select * from finish();
rollback;
