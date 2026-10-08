-- Secure links (migration *_core_secure_links.sql, plan Phase 3 Task 3.17, P3-7, P3-16).
-- Covers: no client privilege on either table (service_role included), peek_secure_link for
-- service_role only, the private functions for no role; indexes and the purge job's cron entry;
-- the purpose handler contract for every seeded purpose (resolve_rpc / accept_rpc signatures,
-- definer, service role only; view_permission of the purpose's module); catalogue checks;
-- issue_secure_link (defaults from the purpose, TTL bounds, unknown purpose, creator outside
-- the org, scope and hash checks, one live link per subject and purpose, as a constraint too);
-- audit redaction of token_hash; consume_secure_link (single use within one transaction, purpose
-- mismatch, expired, revoked, unknown, multi-use); peek_secure_link (exact answers, unknown and
-- revoked byte-identical, used before expired, last_opened_at only for a valid link);
-- revoke_secure_links; core.secure_links_purge (12 months after use, revocation or expiry).
-- The whole file is one transaction, so now() is constant. Token hashes are computed as
-- _shared/links.ts does: SHA-256 over the token string's UTF-8 bytes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

-- =============================================================================
-- Privileges, indexes, job
-- =============================================================================
select table_privs_are('public', 'secure_links', 'anon', array[]::text[], 'anon: nothing on secure_links');
select table_privs_are('public', 'secure_links', 'authenticated', array[]::text[], 'authenticated: nothing on secure_links');
select table_privs_are('public', 'secure_links', 'service_role', array[]::text[], 'service_role: nothing on secure_links (RPCs only)');
select table_privs_are('public', 'secure_link_purposes', 'anon', array[]::text[], 'anon: nothing on secure_link_purposes');
select table_privs_are('public', 'secure_link_purposes', 'authenticated', array[]::text[], 'authenticated: nothing on secure_link_purposes');
select table_privs_are('public', 'secure_link_purposes', 'service_role', array[]::text[], 'service_role: nothing on secure_link_purposes (migrations only)');
select is_empty($$
  select 1 from pg_policy where polrelid in ('public.secure_links'::regclass, 'public.secure_link_purposes'::regclass)
$$, 'neither table has a policy');
select is_empty($$
  select 1 from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('secure_links', 'secure_link_purposes')
     and grantee in ('anon', 'authenticated', 'service_role')
$$, 'no column privilege on the link tables');

select function_privs_are('public', 'peek_secure_link', array['bytea', 'boolean'], 'anon', array[]::text[], 'anon cannot peek');
select function_privs_are('public', 'peek_secure_link', array['bytea', 'boolean'], 'authenticated', array[]::text[], 'authenticated cannot peek');
select function_privs_are('public', 'peek_secure_link', array['bytea', 'boolean'], 'service_role', array['EXECUTE'], 'service_role peeks');
select is((select prosecdef from pg_proc where oid = 'public.peek_secure_link(bytea, boolean)'::regprocedure), true,
  'peek_secure_link is security definer');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('issue_secure_link', 'consume_secure_link', 'revoke_secure_links', 'job_secure_links_purge')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private link functions are callable by no client role');
select results_eq($$
  select p.oid::regprocedure::text collate "default" from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('issue_secure_link', 'consume_secure_link', 'revoke_secure_links', 'job_secure_links_purge')
   order by 1
$$, array[
  'private.consume_secure_link(bytea,text)',
  'private.issue_secure_link(uuid,text,text,uuid,bytea,uuid,interval,jsonb)',
  'private.job_secure_links_purge()',
  'private.revoke_secure_links(uuid,text,text,uuid,uuid)'
], 'the private link functions exist with their signatures');

select results_eq($$
  select indexname::text collate "default" from pg_indexes
   where schemaname = 'public' and tablename = 'secure_links'
   order by 1
$$, array['secure_links_created_by_idx', 'secure_links_live_key', 'secure_links_org_id_idx', 'secure_links_pkey',
          'secure_links_purge_idx', 'secure_links_purpose_idx', 'secure_links_revoked_by_idx', 'secure_links_token_hash_key'],
  'token, live-link, purge and FK indexes exist');
select is((select i.indisunique and pg_get_expr(i.indpred, i.indrelid) is not null
             from pg_index i where i.indexrelid = 'public.secure_links_live_key'::regclass),
  true, 'the live-link index is unique and partial');

select results_eq($$
  select j.key, j.module_key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'core.secure_links_purge'
$$, $$ values ('core.secure_links_purge'::text, 'core'::text, 'sql'::text, 'private.job_secure_links_purge'::text,
               true, '25 8 * * *'::text, 'select private.run_sql_job(''core.secure_links_purge'')'::text) $$,
  'core.secure_links_purge is catalogued and scheduled daily');

-- =============================================================================
-- Purpose handler contract, for every purpose seeded by a migration (before any fixture).
-- accept-invite and resolve-link call these by name through PostgREST, with named arguments.
-- =============================================================================
select is_empty($$
  select p.key from public.secure_link_purposes p
    left join pg_proc f on f.oid = pg_catalog.to_regprocedure('public.' || p.resolve_rpc || '(uuid)')
   where f.oid is null
      or f.prorettype <> 'jsonb'::regtype
      or f.proargnames is distinct from array['p_link_id']
      or not f.prosecdef
      or has_function_privilege('anon', f.oid, 'execute')
      or has_function_privilege('authenticated', f.oid, 'execute')
      or not has_function_privilege('service_role', f.oid, 'execute')
$$, 'every resolve_rpc is public.<name>(p_link_id uuid) returns jsonb, definer, service role only');
select is_empty($$
  select p.key from public.secure_link_purposes p
    left join pg_proc f on f.oid = pg_catalog.to_regprocedure('public.' || p.accept_rpc || '(bytea, uuid, jsonb)')
   where p.accept_rpc is not null
     and (f.oid is null
          or f.prorettype <> 'jsonb'::regtype
          or f.proargnames is distinct from array['p_token_hash', 'p_user_id', 'p_payload']
          or not f.prosecdef
          or has_function_privilege('anon', f.oid, 'execute')
          or has_function_privilege('authenticated', f.oid, 'execute')
          or not has_function_privilege('service_role', f.oid, 'execute'))
$$, 'every accept_rpc is public.<name>(p_token_hash bytea, p_user_id uuid, p_payload jsonb) returns jsonb, definer, service role only');
select is_empty($$
  select p.key from public.secure_link_purposes p
    join public.permissions perm on perm.key = p.view_permission
   where perm.module_key <> p.module_key
$$, 'every purpose''s view_permission belongs to the purpose''s module');

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A. Org B: admin B.
-- Purposes: test_invite (7 days, at most 14, 1 use, creates an account), test_multi (1 day,
-- at most 2, 2 uses, no accept handler).
-- Table t: token name → hash (as _shared/links.ts computes it) → link id once issued.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');

insert into public.secure_link_purposes
  (key, module_key, default_ttl, max_ttl, max_uses, creates_account, resolve_rpc, accept_rpc, view_permission)
values
  ('test_invite', 'core', interval '7 days', interval '14 days', 1, true, 'test_resolve', 'test_accept', 'users.view'),
  ('test_multi', 'core', interval '1 day', interval '2 days', 2, false, 'test_resolve_multi', null, 'users.view');

create temp table t (name text primary key, hash bytea not null, id uuid) on commit drop;
grant select on t to service_role;
insert into t (name, hash)
select n, extensions.digest(convert_to(n, 'UTF8'), 'sha256')
  from unnest(array['first', 'second', 'other_subject', 'multi', 'expired', 'used_expired', 'revoked',
                    'purge_old', 'purge_recent', 'purge_revoked', 'unknown']) n;

-- =============================================================================
-- Catalogue checks (as postgres)
-- =============================================================================
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, resolve_rpc, view_permission)
  values ('test_long', 'core', interval '7 days', interval '31 days', 'test_resolve', 'users.view') $$,
  '23514', null, 'max_ttl is at most 30 days');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, resolve_rpc, view_permission)
  values ('test_order', 'core', interval '8 days', interval '7 days', 'test_resolve', 'users.view') $$,
  '23514', null, 'default_ttl is at most max_ttl');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, resolve_rpc, view_permission)
  values ('test_zero', 'core', interval '0', interval '7 days', 'test_resolve', 'users.view') $$,
  '23514', null, 'default_ttl is positive');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, max_uses, resolve_rpc, view_permission)
  values ('test_uses', 'core', interval '1 day', interval '1 day', 11, 'test_resolve', 'users.view') $$,
  '23514', null, 'max_uses is at most 10');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, resolve_rpc, view_permission)
  values ('Bad-Key', 'core', interval '1 day', interval '1 day', 'test_resolve', 'users.view') $$,
  '23514', null, 'a malformed purpose key is refused');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, resolve_rpc, view_permission)
  values ('test_rpc', 'core', interval '1 day', interval '1 day', 'auth.uid', 'users.view') $$,
  '23514', null, 'a handler name cannot name a schema');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, creates_account, resolve_rpc, view_permission)
  values ('test_no_accept', 'core', interval '1 day', interval '1 day', true, 'test_resolve', 'users.view') $$,
  '23514', null, 'a purpose that creates an account names its accept handler');
select throws_ok($$ insert into public.secure_link_purposes (key, module_key, default_ttl, max_ttl, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission)
  values ('test_both', 'core', interval '1 day', interval '1 day', true, true, 'test_resolve', 'test_accept', 'users.view') $$,
  '23514', null, 'a purpose cannot both require a session and create an account');

-- =============================================================================
-- issue_secure_link (as postgres, as a definer RPC would call it)
-- =============================================================================
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000001', t.hash, 'a0000000-0000-0000-0000-000000000001')
 where t.name = 'first';
select results_eq($$
  select l.org_id, l.purpose, l.subject_type, l.subject_id, l.max_uses, l.use_count, l.expires_at, l.created_by,
         l.scope, l.used_at, l.revoked_at, l.last_opened_at
    from public.secure_links l join t on t.id = l.id where t.name = 'first'
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'test_invite'::text, 'test_subject'::text,
               'd0000000-0000-0000-0000-000000000001'::uuid, 1, 0, now() + interval '7 days',
               'a0000000-0000-0000-0000-000000000001'::uuid, '{}'::jsonb,
               null::timestamptz, null::timestamptz, null::timestamptz) $$,
  'a new link takes the purpose''s default TTL and max_uses, with an empty scope');

update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000002', t.hash, 'a0000000-0000-0000-0000-000000000001', interval '1 day',
  '{"sections": ["identity"]}')
 where t.name = 'other_subject';
select results_eq($$
  select l.expires_at, l.scope from public.secure_links l join t on t.id = l.id where t.name = 'other_subject'
$$, $$ values (now() + interval '1 day', '{"sections": ["identity"]}'::jsonb) $$,
  'an explicit TTL and scope are kept');

update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_multi', 'test_subject',
  'd0000000-0000-0000-0000-000000000001', t.hash, null)
 where t.name = 'multi';
select is((select l.max_uses from public.secure_links l join t on t.id = l.id where t.name = 'multi'), 2,
  'max_uses comes from the purpose');
set local role service_role;
select is(public.peek_secure_link((select hash from t where name = 'multi'), false) -> 'accept_rpc', 'null'::jsonb,
  'a purpose without an accept handler answers accept_rpc null');
reset role;

select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'unknown'), null, interval '15 days') $$,
  '22023', null, 'a TTL above max_ttl is refused');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'unknown'), null, interval '-1 day') $$,
  '22023', null, 'a non-positive TTL is refused');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'nope', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'unknown'), null) $$,
  '22023', null, 'an unknown purpose is refused');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'unknown'), 'a0000000-0000-0000-0000-000000000006') $$,
  '22023', null, 'the creator must belong to the link''s org');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'unknown'), null, null, '[]') $$,
  '23514', null, 'the scope is an object');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'unknown'), null, null,
  jsonb_build_object('x', repeat('y', 5000))) $$,
  '23514', null, 'the scope is at most 4 KB');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', '\x0011'::bytea, null) $$,
  '23514', null, 'a token hash is 32 bytes');
select throws_ok($$ select private.issue_secure_link('b0000000-0000-0000-0000-00000000000b', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', (select hash from t where name = 'first'), null) $$,
  '23505', null, 'a token hash is unique');

-- One live link per (org, purpose, subject).
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000001', t.hash, 'a0000000-0000-0000-0000-000000000001')
 where t.name = 'second';
select results_eq($$
  select t.name, l.revoked_at, l.revoked_by from public.secure_links l join t on t.id = l.id
   where t.name in ('first', 'second', 'other_subject', 'multi') order by t.name
$$, $$ values ('first'::text, now(), 'a0000000-0000-0000-0000-000000000001'::uuid),
              ('multi', null, null), ('other_subject', null, null), ('second', null, null) $$,
  'a second link for the same subject and purpose revokes the first, by its creator; other subjects and purposes are untouched');
select throws_ok($$ insert into public.secure_links (org_id, purpose, subject_type, subject_id, token_hash, max_uses, expires_at)
  values ('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject', 'd0000000-0000-0000-0000-000000000001',
          (select hash from t where name = 'unknown'), 1, now() + interval '1 day') $$,
  '23505', null, 'two live links for one subject and purpose violate a unique index');

-- =============================================================================
-- Audit (token_hash redacted)
-- =============================================================================
select is((select a.changed_fields ->> 'token_hash' from public.audit_log a
            where a.table_name = 'secure_links' and a.action = 'insert'
              and a.record_id = (select id::text from t where name = 'first')),
  '[redacted]', 'the insert''s audit row redacts token_hash');

-- =============================================================================
-- consume_secure_link (as postgres, as a handler RPC calls it)
-- =============================================================================
select is((private.consume_secure_link((select hash from t where name = 'second'), 'test_invite')).id,
  (select id from t where name = 'second'), 'the first consumption returns the link');
select is((private.consume_secure_link((select hash from t where name = 'second'), 'test_invite')).id,
  null, 'a second consumption in the same transaction returns null');
select results_eq($$
  select l.use_count, l.used_at from public.secure_links l join t on t.id = l.id where t.name = 'second'
$$, $$ values (1, now()) $$, 'consumption counts the use and dates it');
select is((private.consume_secure_link((select hash from t where name = 'other_subject'), 'test_multi')).id,
  null, 'a purpose mismatch returns null');
select is((select l.use_count from public.secure_links l join t on t.id = l.id where t.name = 'other_subject'), 0,
  'a purpose mismatch consumes nothing');
select is((private.consume_secure_link((select hash from t where name = 'first'), 'test_invite')).id,
  null, 'a revoked link returns null');
select is((private.consume_secure_link((select hash from t where name = 'unknown'), 'test_invite')).id,
  null, 'an unknown hash returns null');
select is((private.consume_secure_link(null, 'test_invite')).id, null, 'a null hash returns null');
select is((private.consume_secure_link((select hash from t where name = 'multi'), 'test_multi')).use_count,
  1, 'a two-use link: first use');
select is((private.consume_secure_link((select hash from t where name = 'multi'), 'test_multi')).use_count,
  2, 'a two-use link: second use');
select is((private.consume_secure_link((select hash from t where name = 'multi'), 'test_multi')).id,
  null, 'a two-use link: the third use returns null');

-- Expired: issued, then dated in the past.
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000004', t.hash, null)
 where t.name = 'expired';
update public.secure_links l set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
  from t where t.name = 'expired' and l.id = t.id;
select is((private.consume_secure_link((select hash from t where name = 'expired'), 'test_invite')).id,
  null, 'an expired link returns null');

-- Used, then expired.
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000005', t.hash, null)
 where t.name = 'used_expired';
select is((private.consume_secure_link((select hash from t where name = 'used_expired'), 'test_invite')).id,
  (select id from t where name = 'used_expired'), 'the used_expired link is consumed');
update public.secure_links l set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
  from t where t.name = 'used_expired' and l.id = t.id;

-- =============================================================================
-- revoke_secure_links (as postgres)
-- =============================================================================
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000006', t.hash, null)
 where t.name = 'revoked';
select is(private.revoke_secure_links('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001'), 1, 'revoking a live link counts it');
select results_eq($$
  select l.revoked_at, l.revoked_by from public.secure_links l join t on t.id = l.id where t.name = 'revoked'
$$, $$ values (now(), 'a0000000-0000-0000-0000-000000000001'::uuid) $$, 'the revocation is dated and attributed');
select is(private.revoke_secure_links('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000006', null), 0, 'revoking again changes nothing');
select is(private.revoke_secure_links('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000001', null), 0, 'a used link is not revoked (its answer stays « used »)');
select is(private.revoke_secure_links('b0000000-0000-0000-0000-00000000000b', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000002', null), 0, 'another org''s revocation does not reach org A''s link');
select throws_ok($$ select private.revoke_secure_links('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006') $$,
  '22023', null, 'the revoker must belong to the link''s org');
select is((private.consume_secure_link((select hash from t where name = 'revoked'), 'test_invite')).id,
  null, 'a revoked link cannot be consumed');

-- =============================================================================
-- peek_secure_link (as service_role)
-- =============================================================================
reset role;
set local role service_role;

select is(public.peek_secure_link((select hash from t where name = 'other_subject'), false),
  jsonb_build_object(
    'state', 'valid', 'link_id', (select id from t where name = 'other_subject'),
    'org_id', 'b0000000-0000-0000-0000-00000000000a'::uuid, 'purpose', 'test_invite', 'module_key', 'core',
    'subject_type', 'test_subject', 'subject_id', 'd0000000-0000-0000-0000-000000000002'::uuid,
    'scope', '{"sections": ["identity"]}'::jsonb, 'expires_at', now() + interval '1 day',
    'requires_session', false, 'creates_account', true, 'resolve_rpc', 'test_resolve', 'accept_rpc', 'test_accept'),
  'a valid link answers every field the functions need');
select is(public.peek_secure_link((select hash from t where name = 'second'), true),
  '{"state": "used", "purpose": "test_invite"}'::jsonb, 'a used link answers used and its purpose only');
select is(public.peek_secure_link((select hash from t where name = 'expired'), true),
  '{"state": "expired", "purpose": "test_invite"}'::jsonb, 'an expired link answers expired and its purpose only');
select is(public.peek_secure_link((select hash from t where name = 'used_expired'), false),
  '{"state": "used", "purpose": "test_invite"}'::jsonb, 'a used link that has since expired answers used');
select is(public.peek_secure_link((select hash from t where name = 'multi'), false) ->> 'state', 'used',
  'a multi-use link with no use left answers used');
select is(public.peek_secure_link((select hash from t where name = 'revoked'), true),
  '{"state": "invalid"}'::jsonb, 'a revoked link answers invalid only');
select is(public.peek_secure_link((select hash from t where name = 'revoked'), true)::text,
  public.peek_secure_link((select hash from t where name = 'unknown'), true)::text,
  'a revoked and an unknown link give byte-identical answers');
select is(public.peek_secure_link(null, true)::text, '{"state": "invalid"}', 'a null hash answers invalid');
select is(public.peek_secure_link('\x0011'::bytea, true)::text, '{"state": "invalid"}', 'a short hash answers invalid');

-- last_opened_at: not with p_mark_opened false, then set by a valid peek with true.
select is(public.peek_secure_link((select hash from t where name = 'other_subject'), null) ->> 'state', 'valid',
  'a null p_mark_opened peeks without marking');
reset role;
select is((select l.last_opened_at from public.secure_links l join t on t.id = l.id where t.name = 'other_subject'),
  null, 'peeking without p_mark_opened leaves last_opened_at null');
set local role service_role;
select is(public.peek_secure_link((select hash from t where name = 'other_subject'), true) ->> 'state', 'valid',
  'a valid link peeked with p_mark_opened');
reset role;
select results_eq($$
  select t.name, l.last_opened_at from public.secure_links l join t on t.id = l.id
   where t.name in ('other_subject', 'second', 'expired', 'revoked') order by t.name
$$, $$ values ('expired'::text, null::timestamptz), ('other_subject', now()), ('revoked', null), ('second', null) $$,
  'p_mark_opened marks only a valid link');

-- =============================================================================
-- core.secure_links_purge (as postgres)
-- =============================================================================
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000007', t.hash, null)
 where t.name = 'purge_old';
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000008', t.hash, null)
 where t.name = 'purge_recent';
update t set id = private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'test_invite', 'test_subject',
  'd0000000-0000-0000-0000-000000000009', t.hash, null)
 where t.name = 'purge_revoked';
-- Expired 13 months ago; expired 11 months ago; expired 14 months ago but revoked 11 months ago.
update public.secure_links l set created_at = now() - d.created, expires_at = now() - d.expired, revoked_at = now() - d.revoked
  from t join (values ('purge_old', interval '13 months 7 days', interval '13 months', null::interval),
                      ('purge_recent', interval '11 months 7 days', interval '11 months', null),
                      ('purge_revoked', interval '14 months 7 days', interval '14 months', interval '11 months')) d(name, created, expired, revoked)
         on d.name = t.name
 where l.id = t.id;

create temp table purge_expected on commit drop as
  select count(*)::int as n from public.secure_links l
   where greatest(l.used_at, l.revoked_at, l.expires_at) < now() - interval '12 months';
select is(private.job_secure_links_purge(), 'deleted=' || (select n from purge_expected),
  'the purge reports how many links it deleted');
select results_eq($$
  select t.name from t join public.secure_links l on l.id = t.id
   where t.name in ('purge_old', 'purge_recent', 'purge_revoked') order by 1
$$, array['purge_recent', 'purge_revoked'],
  'a link expired 13 months ago is deleted; one expired 11 months ago, or revoked 11 months ago, is kept');

-- After inserts, consumptions, revocations, peeks and the purge's deletes.
select is_empty($$
  select a.id from public.audit_log a, t
   where a.table_name = 'secure_links' and a.changed_fields::text like '%' || encode(t.hash, 'hex') || '%'
$$, 'no audit row holds a token hash');
select is((select count(*)::int from public.audit_log a
            where a.table_name = 'secure_links' and a.action = 'delete'
              and a.record_id = (select id::text from t where name = 'purge_old')), 1,
  'the purge''s deletion is audited');

select * from finish();
rollback;
