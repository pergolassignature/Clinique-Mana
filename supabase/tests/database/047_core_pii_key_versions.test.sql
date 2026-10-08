-- PII key versions, canary and deploy health check (migration *_core_pii_key_versions.sql,
-- ADR 0004 « Before Phase 4 », plan Task 4a.16):
-- private.pii_key(int) / encrypt_pii(text, int) / decrypt_pii(bytea, int), the one-argument forms
-- (version 1), private.pii_current_key_version(), private.pii_canary, public.pii_health_check(),
-- organization_bank_details.key_version, and the rotation runbook's re-encryption statement.
-- Key values are never selected: only compared or used inside expressions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

-- =============================================================================
-- Fixtures (as postgres): org A and org B, each with an admin (settings.bank_manage).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- =============================================================================
-- Privileges: the helpers are granted to no role; the health check to service_role only
-- =============================================================================
select function_privs_are('private', 'pii_key',     array['integer'],          'authenticated', array[]::text[], 'authenticated has no EXECUTE on pii_key(int)');
select function_privs_are('private', 'pii_key',     array['integer'],          'service_role',  array[]::text[], 'service_role has no EXECUTE on pii_key(int)');
select function_privs_are('private', 'encrypt_pii', array['text', 'integer'],  'authenticated', array[]::text[], 'authenticated has no EXECUTE on encrypt_pii(text, int)');
select function_privs_are('private', 'encrypt_pii', array['text', 'integer'],  'service_role',  array[]::text[], 'service_role has no EXECUTE on encrypt_pii(text, int)');
select function_privs_are('private', 'decrypt_pii', array['bytea', 'integer'], 'authenticated', array[]::text[], 'authenticated has no EXECUTE on decrypt_pii(bytea, int)');
select function_privs_are('private', 'decrypt_pii', array['bytea', 'integer'], 'service_role',  array[]::text[], 'service_role has no EXECUTE on decrypt_pii(bytea, int)');
select function_privs_are('private', 'pii_current_key_version', array[]::text[], 'authenticated', array[]::text[], 'authenticated has no EXECUTE on pii_current_key_version');
select function_privs_are('private', 'pii_current_key_version', array[]::text[], 'service_role',  array[]::text[], 'service_role has no EXECUTE on pii_current_key_version');
-- The one-argument forms keep their Phase 2 grants (none).
select function_privs_are('private', 'encrypt_pii', array['text'],  'service_role', array[]::text[], 'service_role still has no EXECUTE on encrypt_pii(text)');
select function_privs_are('private', 'decrypt_pii', array['bytea'], 'service_role', array[]::text[], 'service_role still has no EXECUTE on decrypt_pii(bytea)');

select function_privs_are('public', 'pii_health_check', array[]::text[], 'anon',          array[]::text[],  'anon cannot call pii_health_check');
select function_privs_are('public', 'pii_health_check', array[]::text[], 'authenticated', array[]::text[],  'authenticated cannot call pii_health_check');
select function_privs_are('public', 'pii_health_check', array[]::text[], 'service_role',  array['EXECUTE'], 'service_role can call pii_health_check');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.pii_health_check()'::regprocedure), true,
  'pii_health_check is security definer');
select is((select p.prorettype::regtype::text from pg_proc p where p.oid = 'public.pii_health_check()'::regprocedure), 'boolean',
  'pii_health_check returns a boolean only');

select has_table('private', 'pii_canary', 'the canary table lives in the private schema');
select table_privs_are('private', 'pii_canary', 'anon',          array[]::text[], 'anon: no privileges on pii_canary');
select table_privs_are('private', 'pii_canary', 'authenticated', array[]::text[], 'authenticated: no privileges on pii_canary');
select table_privs_are('private', 'pii_canary', 'service_role',  array[]::text[], 'service_role: no privileges on pii_canary');
select is((select c.relrowsecurity from pg_class c where c.oid = 'private.pii_canary'::regclass), true,
  'pii_canary has RLS on (no policy)');

select col_type_is('public', 'organization_bank_details', 'key_version', 'smallint', 'bank details carry a key_version (smallint)');
select col_not_null('public', 'organization_bank_details', 'key_version', 'key_version is not null');
select is((select c.column_default from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = 'organization_bank_details' and c.column_name = 'key_version'),
  '1', 'key_version defaults to 1');

-- =============================================================================
-- Keys and helpers (as postgres)
-- =============================================================================
select ok(private.pii_key(1) is not null and private.pii_key(1) = private.pii_key(),
  'version 1 is the Vault secret pii_encryption_key (same as pii_key())');
select ok(private.pii_key(2) is null, 'no version 2 key yet: null');
select ok(private.pii_key(0) is null and private.pii_key(-1) is null and private.pii_key(null) is null,
  'versions below 1 (and null) have no key');

select is(private.decrypt_pii(private.encrypt_pii('046 454 286', 1), 1), '046 454 286', 'version 1 round trip');
select is(private.decrypt_pii(private.encrypt_pii('1234567'), 1), '1234567', 'the one-argument encrypt is version 1');
select is(private.decrypt_pii(private.encrypt_pii('1234567', 1)), '1234567', 'the one-argument decrypt is version 1');
select ok(private.encrypt_pii(null, 1) is null and private.decrypt_pii(null, 7) is null,
  'null stays null (no key needed)');
select throws_ok($$ select private.encrypt_pii('x', 7) $$, '55000', 'Clé de chiffrement introuvable (version 7)',
  'an unknown version has no key: encrypt_pii raises 55000');
select throws_ok($$ select private.decrypt_pii(private.encrypt_pii('x', 1), 7) $$, '55000', 'Clé de chiffrement introuvable (version 7)',
  'an unknown version has no key: decrypt_pii raises 55000');
-- OpenPGP symmetric-key session packet: cipher id at byte 3 (9 = AES-256), S2K digest at byte 5 (8 = SHA-256).
select results_eq(
  $$ select get_byte(c, 3), get_byte(c, 5) from (select private.encrypt_pii('x', 1) as c) e $$,
  $$ values (9, 8) $$,
  'versioned encryption keeps AES-256 with a SHA-256 key derivation');

-- =============================================================================
-- Canary (seeded by the migration for version 1)
-- =============================================================================
select results_eq($$ select key_version from private.pii_canary order by 1 $$, $$ values (1::smallint) $$,
  'the migration seeds one canary row, for version 1');
select is((select private.decrypt_pii(ciphertext, key_version) from private.pii_canary where key_version = 1),
  'mana-pii-canary', 'the version 1 canary decrypts to the fixed test value');
select is((select position('mana-pii-canary' in encode(ciphertext, 'escape')) from private.pii_canary where key_version = 1),
  0, 'the canary is not stored in clear text');
select is(private.pii_current_key_version(), 1, 'the current (write) key version is 1');
select throws_ok($$ insert into private.pii_canary (key_version, ciphertext) values (0, '\x00') $$,
  '23514', null, 'a canary version is at least 1');

set local role service_role;
select is(public.pii_health_check(), true, 'the health check passes on a fresh database');
reset role;

-- Failures: the check returns false, it never raises. Each damage is undone by writing a fresh
-- canary, not by a savepoint: rolling back to a savepoint also rolls back pgTAP's test counter.
update private.pii_canary set ciphertext = extensions.pgp_sym_encrypt('mana-pii-canary', 'pas-la-bonne-cle', 'cipher-algo=aes256')
 where key_version = 1;
set local role service_role;
select is(public.pii_health_check(), false, 'a canary encrypted with another key fails the check');
reset role;

update private.pii_canary set ciphertext = '\xdeadbeef' where key_version = 1;
set local role service_role;
select is(public.pii_health_check(), false, 'a corrupt canary fails the check');
reset role;

update private.pii_canary set ciphertext = private.encrypt_pii('autre valeur', 1) where key_version = 1;
set local role service_role;
select is(public.pii_health_check(), false, 'a canary that decrypts to another value fails the check');
reset role;

delete from private.pii_canary;
set local role service_role;
select is(public.pii_health_check(), false, 'no canary row fails the check (nothing proven)');
reset role;
select is(private.pii_current_key_version(), 1, 'without a canary the write version falls back to 1');

insert into private.pii_canary (key_version, ciphertext) values (1, private.encrypt_pii('mana-pii-canary', 1));
set local role service_role;
select is(public.pii_health_check(), true, 'the health check passes again once the canary is restored');
reset role;

-- =============================================================================
-- Bank details written before a rotation (version 1)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('815', '30000', '1234567', null) $$, 'admin A saves bank details');
select is(public.reveal_bank_account_number(), '1234567', 'admin A reveals the account (version 1)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('001', '12345', '11112222', null) $$, 'admin B saves bank details');
reset role;

select results_eq(
  $$ select org_id, key_version from public.organization_bank_details
      where org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') order by 1 $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 1::smallint), ('b0000000-0000-0000-0000-00000000000b'::uuid, 1::smallint) $$,
  'both rows are written with key version 1');
select throws_ok($$ update public.organization_bank_details set key_version = 0 where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'a key version is at least 1');

-- =============================================================================
-- Rotation to version 2 (the runbook's steps, as postgres)
-- =============================================================================
select lives_ok(
  $$ select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'pii_encryption_key_v2', 'test 047') $$,
  'step 1: create the Vault secret pii_encryption_key_v2');
select ok(private.pii_key(2) is not null and private.pii_key(2) <> private.pii_key(1),
  'version 2 resolves to pii_encryption_key_v2, a different key');
select is(private.decrypt_pii(private.encrypt_pii('046 454 286', 2), 2), '046 454 286', 'version 2 round trip');
select throws_ok($$ select private.decrypt_pii(private.encrypt_pii('x', 2), 1) $$, '39000', null,
  'a version 2 ciphertext does not decrypt with the version 1 key');
select is(private.pii_current_key_version(), 1, 'a key alone does not change the write version');

select lives_ok(
  $$ insert into private.pii_canary (key_version, ciphertext) values (2, private.encrypt_pii('mana-pii-canary', 2)) $$,
  'step 2: add the version 2 canary');
select is(private.pii_current_key_version(), 2, 'the write version is now 2 (highest canary)');
set local role service_role;
select is(public.pii_health_check(), true, 'the health check passes with both versions');
reset role;

-- Writes follow the current version; reads follow each row's version.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('815', '30001', null, null) $$, 'admin A changes the transit only');
reset role;
select is((select key_version from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  1::smallint, 'keeping the account does not re-encrypt it');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('815', '30001', '7654321', null) $$, 'admin A replaces the account');
select is(public.reveal_bank_account_number(), '7654321', 'admin A reveals the new account');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.reveal_bank_account_number(), '11112222', 'admin B still reveals a version 1 account (mixed versions)');
reset role;
select is((select key_version from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  2::smallint, 'a replaced account is written with the current version');

-- Step 3: the runbook's batch statement, run until it updates no row.
select set_config('app.audit_source', 'runbook:pii-key-rotation', true);
select lives_ok($$
  update public.organization_bank_details b
     set account_number = private.encrypt_pii(private.decrypt_pii(b.account_number, b.key_version), 2),
         key_version = 2
   where b.org_id in (select x.org_id from public.organization_bank_details x
                       where x.key_version < 2 order by x.org_id limit 500)
$$, 'step 3: re-encrypt the remaining rows to version 2');
select set_config('app.audit_source', '', true);
select is((select count(*)::int from public.organization_bank_details where key_version < 2), 0,
  'no bank row is left on version 1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.reveal_bank_account_number(), '11112222', 'admin B reveals the same account after re-encryption');
reset role;
select results_eq(
  $$ select source, changed_fields -> 'account_number', changed_fields -> 'key_version' from public.audit_log
      where table_name = 'organization_bank_details' and action = 'update'
        and org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  $$ values ('runbook:pii-key-rotation'::text, '"[redacted]"'::jsonb, '{"before": 1, "after": 2}'::jsonb) $$,
  'the re-encryption is audited: account redacted, key version visible, source named');

-- Step 4: the health check.
set local role service_role;
select is(public.pii_health_check(), true, 'step 4: the health check passes after the re-encryption');
reset role;

-- Step 5: retire version 1 (its canary, then its secret).
delete from private.pii_canary where key_version = 1;
delete from vault.secrets where name = 'pii_encryption_key';
set local role service_role;
select is(public.pii_health_check(), true, 'step 5: with only version 2 left the check still passes');
reset role;
select is(private.pii_current_key_version(), 2, 'the write version stays 2');

-- The key loss the check guards against (last: it leaves the version 2 data unreadable).
delete from vault.secrets where name = 'pii_encryption_key_v2';
set local role service_role;
select is(public.pii_health_check(), false, 'losing the version 2 key fails the check');
reset role;

select * from finish();
rollback;
