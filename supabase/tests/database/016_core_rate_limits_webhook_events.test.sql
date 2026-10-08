-- Rate limits and the shared webhook claim
-- (migration *_core_rate_limits_webhook_events.sql, plan Phase 3 Task 3.2).
-- Covers: privileges on rate_limits / webhook_events and the five RPCs; consume_rate_limit
-- (fixed window, independent keys, argument checks); claim_webhook_event (claimed,
-- in_progress, duplicate, lease takeover, retry after a failure, another org);
-- complete_webhook_event / fail_webhook_event (token match, payload cleared or kept, error
-- codes only); last_webhook_event_at (settings.view, caller's org and provider only).
-- The whole file is one transaction, so now() is constant: every hit lands in one window.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A, conseillère C. Org B: admin B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',     '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C', 'c@a.test',     'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- Claim results, kept across statements (written as service_role).
create temp table claims (step text primary key, status text, id uuid, claim_token uuid) on commit drop;
grant select, insert on claims to service_role;

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'rate_limits', 'anon', array[]::text[], 'anon: nothing on rate_limits');
select table_privs_are('public', 'rate_limits', 'authenticated', array[]::text[], 'authenticated: nothing on rate_limits');
select table_privs_are('public', 'webhook_events', 'anon', array[]::text[], 'anon: nothing on webhook_events');
select table_privs_are('public', 'webhook_events', 'authenticated', array[]::text[], 'authenticated: nothing on webhook_events');

select function_privs_are('public', 'consume_rate_limit', array['text', 'bytea', 'integer', 'integer'], 'anon', array[]::text[],
  'anon cannot call consume_rate_limit');
select function_privs_are('public', 'consume_rate_limit', array['text', 'bytea', 'integer', 'integer'], 'authenticated', array[]::text[],
  'authenticated cannot call consume_rate_limit');
select function_privs_are('public', 'consume_rate_limit', array['text', 'bytea', 'integer', 'integer'], 'service_role', array['EXECUTE'],
  'service_role calls consume_rate_limit');
select function_privs_are('public', 'claim_webhook_event', array['text', 'text', 'uuid', 'text', 'jsonb', 'integer'], 'anon', array[]::text[],
  'anon cannot call claim_webhook_event');
select function_privs_are('public', 'claim_webhook_event', array['text', 'text', 'uuid', 'text', 'jsonb', 'integer'], 'authenticated', array[]::text[],
  'authenticated cannot call claim_webhook_event');
select function_privs_are('public', 'claim_webhook_event', array['text', 'text', 'uuid', 'text', 'jsonb', 'integer'], 'service_role', array['EXECUTE'],
  'service_role calls claim_webhook_event');
select function_privs_are('public', 'complete_webhook_event', array['uuid', 'uuid'], 'anon', array[]::text[],
  'anon cannot call complete_webhook_event');
select function_privs_are('public', 'complete_webhook_event', array['uuid', 'uuid'], 'authenticated', array[]::text[],
  'authenticated cannot call complete_webhook_event');
select function_privs_are('public', 'complete_webhook_event', array['uuid', 'uuid'], 'service_role', array['EXECUTE'],
  'service_role calls complete_webhook_event');
select function_privs_are('public', 'fail_webhook_event', array['uuid', 'uuid', 'text'], 'anon', array[]::text[],
  'anon cannot call fail_webhook_event');
select function_privs_are('public', 'fail_webhook_event', array['uuid', 'uuid', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot call fail_webhook_event');
select function_privs_are('public', 'fail_webhook_event', array['uuid', 'uuid', 'text'], 'service_role', array['EXECUTE'],
  'service_role calls fail_webhook_event');
select function_privs_are('public', 'last_webhook_event_at', array['text'], 'anon', array[]::text[],
  'anon cannot call last_webhook_event_at');
select function_privs_are('public', 'last_webhook_event_at', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated calls last_webhook_event_at (settings.view inside)');
select function_privs_are('public', 'last_webhook_event_at', array['text'], 'service_role', array[]::text[],
  'service_role cannot call last_webhook_event_at (scoped to the calling user)');

-- =============================================================================
-- consume_rate_limit (service role)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select results_eq($$ select allowed, hits from public.consume_rate_limit('test.bucket', sha256('k'), 2, 60) $$,
  $$ values (true, 1) $$, 'first hit is allowed');
select results_eq($$ select allowed, hits, retry_after_seconds from public.consume_rate_limit('test.bucket', sha256('k'), 2, 60) $$,
  $$ values (true, 2, 0) $$, 'second hit is allowed, no wait');
select results_eq(
  $$ select allowed, hits, retry_after_seconds between 1 and 60 from public.consume_rate_limit('test.bucket', sha256('k'), 2, 60) $$,
  $$ values (false, 3, true) $$, 'third hit is refused with a wait inside the window');
select results_eq($$ select allowed, hits from public.consume_rate_limit('test.bucket', sha256('other'), 2, 60) $$,
  $$ values (true, 1) $$, 'another key is counted on its own');
select results_eq($$ select allowed, hits from public.consume_rate_limit('test.other_bucket', sha256('k'), 2, 60) $$,
  $$ values (true, 1) $$, 'another bucket is counted on its own');

select throws_ok($$ select * from public.consume_rate_limit('test.bucket', sha256('k'), 0, 60) $$, '22023', null,
  'p_max = 0 is refused');
select throws_ok($$ select * from public.consume_rate_limit('test.bucket', '\x00'::bytea, 2, 60) $$, '22023', null,
  'a key that is not 32 bytes is refused');
select throws_ok($$ select * from public.consume_rate_limit('test.bucket', sha256('k'), 2, 90000) $$, '22023', null,
  'a window over one day is refused');
select throws_ok($$ select * from public.consume_rate_limit('Bad Bucket', sha256('k'), 2, 60) $$, '22023', null,
  'a malformed bucket is refused');

-- =============================================================================
-- claim / complete
-- =============================================================================
insert into claims
  select 'first', * from public.claim_webhook_event('resend', 'test-evt-1', 'b0000000-0000-0000-0000-00000000000a',
                                                    'email.delivered', '{"email_id":"e1"}');
select results_eq($$ select status, claim_token is not null from claims where step = 'first' $$,
  $$ values ('claimed'::text, true) $$, 'a new event is claimed with a token');

insert into claims
  select 'again', * from public.claim_webhook_event('resend', 'test-evt-1', 'b0000000-0000-0000-0000-00000000000a',
                                                    'email.delivered', '{"email_id":"e1"}');
select results_eq($$ select status, id, claim_token from claims where step = 'again' $$,
  $$ values ('in_progress'::text, null::uuid, null::uuid) $$, 'the same event under a live lease is in_progress, without a token');

select is(public.complete_webhook_event((select id from claims where step = 'first'), gen_random_uuid()), false,
  'complete with a wrong token is refused');
select is(public.complete_webhook_event((select id from claims where step = 'first'), (select claim_token from claims where step = 'first')),
  true, 'complete with the claim token succeeds');

reset role;
select results_eq(
  $$ select status, payload is null, claim_token is null, completed_at is not null, attempts
       from public.webhook_events where provider = 'resend' and event_id = 'test-evt-1' $$,
  $$ values ('completed'::text, true, true, true, 1) $$, 'a completed event loses its payload and token');
set local role service_role;

insert into claims
  select 'after_complete', * from public.claim_webhook_event('resend', 'test-evt-1', 'b0000000-0000-0000-0000-00000000000a',
                                                            'email.delivered', '{"email_id":"e1"}');
select results_eq($$ select status, claim_token from claims where step = 'after_complete' $$,
  $$ values ('duplicate'::text, null::uuid) $$, 'a completed event is a duplicate');
select is(public.complete_webhook_event((select id from claims where step = 'first'), (select claim_token from claims where step = 'first')),
  false, 'a used token cannot complete twice');

select throws_ok($$ select * from public.claim_webhook_event('resend', 'test-evt-1', 'b0000000-0000-0000-0000-00000000000b',
                                                             'email.delivered', '{}') $$,
  '22023', null, 'an event id that belongs to another org is refused');

-- =============================================================================
-- Lease takeover, failure, retry
-- =============================================================================
insert into claims
  select 'lease_1', * from public.claim_webhook_event('resend', 'test-evt-2', 'b0000000-0000-0000-0000-00000000000a',
                                                      'email.bounced', '{"email_id":"e2"}');
reset role;
update public.webhook_events set lease_expires_at = now() - interval '1 second'
 where provider = 'resend' and event_id = 'test-evt-2';
set local role service_role;

insert into claims
  select 'lease_2', * from public.claim_webhook_event('resend', 'test-evt-2', 'b0000000-0000-0000-0000-00000000000a',
                                                      'email.bounced', '{"email_id":"e2"}');
select results_eq(
  $$ select l2.status, l2.id = l1.id, l2.claim_token <> l1.claim_token
       from claims l1, claims l2 where l1.step = 'lease_1' and l2.step = 'lease_2' $$,
  $$ values ('claimed'::text, true, true) $$, 'a lapsed lease is taken over with a new token');
select is(public.complete_webhook_event((select id from claims where step = 'lease_1'), (select claim_token from claims where step = 'lease_1')),
  false, 'the previous holder can no longer complete');

select throws_ok($$ select public.fail_webhook_event((select id from claims where step = 'lease_2'),
                                                     (select claim_token from claims where step = 'lease_2'), 'Download failed for x@y.test') $$,
  '22023', null, 'a free-text error is refused (codes only)');
select throws_ok($$ select public.fail_webhook_event((select id from claims where step = 'lease_2'),
                                                     (select claim_token from claims where step = 'lease_2'), null) $$,
  '22023', null, 'a null error code is refused');
select is(public.fail_webhook_event((select id from claims where step = 'lease_1'), (select claim_token from claims where step = 'lease_1'),
  'documenso_download_failed'), false, 'fail with a lapsed token is refused');
select is(public.fail_webhook_event((select id from claims where step = 'lease_2'), (select claim_token from claims where step = 'lease_2'),
  'documenso_download_failed'), true, 'fail with the claim token succeeds');

reset role;
select results_eq(
  $$ select status, last_error, payload, claim_token is null, attempts
       from public.webhook_events where provider = 'resend' and event_id = 'test-evt-2' $$,
  $$ values ('failed'::text, 'documenso_download_failed'::text, '{"email_id":"e2"}'::jsonb, true, 2) $$,
  'a failed event keeps its payload for the retry and counts both attempts');
set local role service_role;

insert into claims
  select 'retry', * from public.claim_webhook_event('resend', 'test-evt-2', 'b0000000-0000-0000-0000-00000000000a',
                                                    'email.bounced', '{"email_id":"e2"}');
select results_eq($$ select status, claim_token is not null from claims where step = 'retry' $$,
  $$ values ('claimed'::text, true) $$, 'the next delivery of a failed event takes it over');
reset role;
select is((select attempts from public.webhook_events where provider = 'resend' and event_id = 'test-evt-2'), 3,
  'the retry is the third attempt');
set local role service_role;

-- =============================================================================
-- claim_webhook_event: argument checks
-- =============================================================================
select throws_ok($$ select * from public.claim_webhook_event('stripe', 'test-evt-3', 'b0000000-0000-0000-0000-00000000000a', 'x', '{}') $$,
  '22023', null, 'an unknown provider is refused');
select throws_ok($$ select * from public.claim_webhook_event('resend', '', 'b0000000-0000-0000-0000-00000000000a', 'x', '{}') $$,
  '22023', null, 'an empty event id is refused');
select throws_ok($$ select * from public.claim_webhook_event('resend', 'test-evt-3', null, 'x', '{}') $$,
  '22023', null, 'a missing org is refused');
select throws_ok($$ select * from public.claim_webhook_event('resend', 'test-evt-3', 'b0000000-0000-0000-0000-00000000000a', 'x', '[]') $$,
  '22023', null, 'a payload that is not an object is refused');
select throws_ok($$ select * from public.claim_webhook_event('resend', 'test-evt-3', 'b0000000-0000-0000-0000-00000000000a', 'x',
                                                             jsonb_build_object('pad', repeat('x', 70000))) $$,
  '22023', null, 'a payload over 64 KB is refused');
select throws_ok($$ select * from public.claim_webhook_event('resend', 'test-evt-3', 'b0000000-0000-0000-0000-00000000000a', 'x', '{}', 0) $$,
  '22023', null, 'a lease under one second is refused');

-- =============================================================================
-- last_webhook_event_at (caller's org, settings.view)
-- =============================================================================
reset role;
insert into public.webhook_events (provider, event_id, org_id, event_type, status, received_at) values
  ('documenso', 'test-doc-a1', 'b0000000-0000-0000-0000-00000000000a', 'DOCUMENT_COMPLETED', 'completed', now() - interval '2 hours'),
  ('documenso', 'test-doc-a2', 'b0000000-0000-0000-0000-00000000000a', 'DOCUMENT_COMPLETED', 'completed', now() - interval '1 hour'),
  ('documenso', 'test-doc-b1', 'b0000000-0000-0000-0000-00000000000b', 'DOCUMENT_COMPLETED', 'completed', now() - interval '30 minutes');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.last_webhook_event_at('documenso'), now() - interval '1 hour',
  'admin A: the latest documenso event of org A, not the newer one of org B');
select is(public.last_webhook_event_at('resend'), now(), 'admin A: the latest resend event of org A');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.last_webhook_event_at('resend'), null, 'admin B: no resend event in org B (org A''s are not visible)');
select is(public.last_webhook_event_at('documenso'), now() - interval '30 minutes', 'admin B: the latest documenso event of org B');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.last_webhook_event_at('resend') $$, '42501', 'Permission refusée : settings.view',
  'the conseillère (no settings.view) is refused');

select * from finish();
rollback;
