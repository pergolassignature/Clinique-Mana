-- Core: one allowed hit given back (migration *_core_refund_rate_limit.sql). `places` consumes
-- the caller's limit, then the clinic's: a clinic refusal gives the caller's hit back, so a
-- refused call never spends a person's own quota.
-- Covers: privileges (service role only, security definer); the current window's count goes down
-- by one and never below zero; another key, bucket or window untouched; nothing to give back
-- (no row) is a no-op; argument checks; a refunded hit can be spent again.
-- The whole file is one transaction, so now() is constant: every hit lands in one window.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select function_privs_are('public', 'refund_rate_limit', array['text', 'bytea', 'integer'], 'service_role', array['EXECUTE'],
  'service_role gives a hit back');
select function_privs_are('public', 'refund_rate_limit', array['text', 'bytea', 'integer'], 'authenticated', array[]::text[],
  'authenticated may not');
select function_privs_are('public', 'refund_rate_limit', array['text', 'bytea', 'integer'], 'anon', array[]::text[],
  'anon may not');
select is_definer('public', 'refund_rate_limit', array['text', 'bytea', 'integer'], 'security definer (rate_limits is closed to clients)');

set local role service_role;
-- Key 1: two hits of a max of 2 (the limit reached); key 2: one hit.
select public.consume_rate_limit('test.refund', decode(repeat('11', 32), 'hex'), 2, 3600);
select public.consume_rate_limit('test.refund', decode(repeat('11', 32), 'hex'), 2, 3600);
select public.consume_rate_limit('test.refund', decode(repeat('22', 32), 'hex'), 2, 3600);
select ok(not (select allowed from public.consume_rate_limit('test.refund', decode(repeat('11', 32), 'hex'), 2, 3600)),
  'key 1 is at its limit');
reset role;
-- The refused hit above left the count at max + 1; bring it back to the limit (2), as if the third
-- call had not been made, to test the refund on its own.
update public.rate_limits set hits = 2 where bucket = 'test.refund' and key_hash = decode(repeat('11', 32), 'hex');

set local role service_role;
select lives_ok($$ select public.refund_rate_limit('test.refund', decode(repeat('11', 32), 'hex'), 3600) $$, 'key 1 gets a hit back');
reset role;
select is((select hits from public.rate_limits where bucket = 'test.refund' and key_hash = decode(repeat('11', 32), 'hex')), 1,
  'key 1''s count went down by one');
select is((select hits from public.rate_limits where bucket = 'test.refund' and key_hash = decode(repeat('22', 32), 'hex')), 1,
  'key 2 is untouched');

set local role service_role;
select ok((select allowed from public.consume_rate_limit('test.refund', decode(repeat('11', 32), 'hex'), 2, 3600)),
  'the hit given back can be spent again');
select public.refund_rate_limit('test.refund', decode(repeat('22', 32), 'hex'), 3600);
select public.refund_rate_limit('test.refund', decode(repeat('22', 32), 'hex'), 3600);
reset role;
select is((select hits from public.rate_limits where bucket = 'test.refund' and key_hash = decode(repeat('22', 32), 'hex')), 0,
  'never below zero');

set local role service_role;
select lives_ok($$ select public.refund_rate_limit('test.refund', decode(repeat('33', 32), 'hex'), 3600) $$,
  'nothing to give back: a no-op');
select lives_ok($$ select public.refund_rate_limit('test.other', decode(repeat('11', 32), 'hex'), 3600) $$,
  'another bucket: a no-op');
reset role;
select is((select count(*)::int from public.rate_limits where bucket in ('test.refund', 'test.other')), 2,
  'no row is written by a refund');

set local role service_role;
select throws_ok($$ select public.refund_rate_limit('Bad Bucket', decode(repeat('11', 32), 'hex'), 3600) $$,
  '22023', null, 'a malformed bucket is refused');
select throws_ok($$ select public.refund_rate_limit('test.refund', '\x11'::bytea, 3600) $$,
  '22023', null, 'a key hash that is not 32 bytes is refused');
reset role;

select * from finish();
rollback;
