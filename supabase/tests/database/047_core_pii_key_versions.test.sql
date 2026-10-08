-- PII key versions, canary and health check (migration *_core_pii_key_versions.sql,
-- ADR 0004 « Before Phase 4 », plan Task 4a.16):
-- private.pii_key(int) / encrypt_pii(text, int) / decrypt_pii(bytea, int), the one-argument forms
-- (version 1), private.pii_encrypted_values() / pii_key_versions_in_use() (the list of encrypted
-- columns), private.pii_current_key_version(), private.pii_seed_canary(int), private.pii_canary,
-- public.pii_health_check(), organization_bank_details.key_version (one version per row), and the
-- rotation runbook's blocks, replayed verbatim (forward, re-run, rollback, retiring a version).
-- Key values are never selected: only compared or used inside expressions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(112);

-- =============================================================================
-- Fixtures (as postgres): org A and org B, each with an admin (settings.bank_manage); org C has
-- no user (its bank row is written directly, as postgres, for the failure cases).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B'),
  ('b0000000-0000-0000-0000-00000000000c', 'Org C');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');

-- The rotation runbook's two blocks, verbatim (docs/runbooks/pii-key-rotation.md, steps 4 and 7).
create temp table runbook (step text primary key, code text not null);
insert into runbook (step, code) values
  ('batch', $runbook$do $$
declare
  v_target constant integer := 2;   -- la version vers laquelle re-chiffrer
  v_count integer;
begin
  if private.pii_current_key_version() <> v_target then
    raise exception 'La version d''écriture est %, pas % : rien n''est re-chiffré.', private.pii_current_key_version(), v_target;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'runbook:pii-key-rotation', true);

  update public.organization_bank_details b
     set account_number = private.encrypt_pii(private.decrypt_pii(b.account_number, b.key_version), v_target),
         key_version = v_target
   where b.org_id in (select x.org_id from public.organization_bank_details x
                       where x.key_version <> v_target order by x.org_id limit 500);
  get diagnostics v_count = row_count;
  raise notice 'organization_bank_details : % ligne(s) re-chiffrée(s)', v_count;

  -- À partir de la Task 4a.17 (une valeur absente reste absente) :
  -- update public.professional_private p
  --    set sin = private.encrypt_pii(private.decrypt_pii(p.sin, p.key_version), v_target),
  --        bank_account = private.encrypt_pii(private.decrypt_pii(p.bank_account, p.key_version), v_target),
  --        key_version = v_target
  --  where p.professional_id in (select x.professional_id from public.professional_private x
  --                               where x.key_version <> v_target order by x.professional_id limit 500);
  -- get diagnostics v_count = row_count;
  -- raise notice 'professional_private : % ligne(s) re-chiffrée(s)', v_count;
end;
$$;$runbook$),
  ('retire', $runbook$do $$
declare
  v_old constant integer := 1;   -- la version à retirer
  -- version 1 : pii_encryption_key (sans suffixe) ; version n ≥ 2 : pii_encryption_key_v<n>
  v_name constant text := case when v_old = 1 then 'pii_encryption_key' else 'pii_encryption_key_v' || v_old end;
  v_deleted integer;
begin
  if v_old = private.pii_current_key_version() then
    raise exception 'La version % est la version d''écriture : rien n''est retiré.', v_old;
  end if;
  if exists (select 1 from private.pii_key_versions_in_use() u where u.key_version = v_old) then
    raise exception 'Des valeurs sont encore chiffrées avec la version % (étape 4) : rien n''est retiré.', v_old;
  end if;
  if not public.pii_health_check() then
    raise exception 'pii_health_check() est déjà faux : rien n''est retiré.';
  end if;

  delete from private.pii_canary where key_version = v_old;
  if not public.pii_health_check() then
    raise exception 'pii_health_check() serait faux sans le témoin de la version % : rien n''est retiré.', v_old;
  end if;

  delete from vault.secrets where name = v_name;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'Secret % introuvable : rien n''est retiré.', v_name;
  end if;
  if not public.pii_health_check() then
    raise exception 'pii_health_check() serait faux sans le secret % : rien n''est retiré.', v_name;
  end if;
  raise notice 'Version % retirée (témoin et secret %).', v_old, v_name;
end;
$$;$runbook$);

-- =============================================================================
-- Privileges: every PII helper and the health check are granted to no role
-- =============================================================================
select is_empty($$
  select p.oid::regprocedure::text || ' → ' || r.rolname
    from pg_proc p
    cross join (values ('public'), ('anon'), ('authenticated'), ('service_role')) r(rolname)
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('pii_key', 'encrypt_pii', 'decrypt_pii', 'pii_encrypted_values', 'pii_key_versions_in_use',
                       'pii_current_key_version', 'pii_seed_canary')
     and (case when r.rolname = 'public'
               then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0 and a.privilege_type = 'EXECUTE')
               else has_function_privilege(r.rolname, p.oid, 'EXECUTE') end)
$$, 'no PII helper (versioned or not) is executable by PUBLIC, anon, authenticated or service_role');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace
              and p.proname in ('pii_key', 'encrypt_pii', 'decrypt_pii', 'pii_encrypted_values', 'pii_key_versions_in_use',
                                'pii_current_key_version', 'pii_seed_canary')),
  10, 'the privilege check above sees all ten PII helpers');
select function_privs_are('private', 'pii_key',     array['integer'],          'anon',          array[]::text[], 'anon has no EXECUTE on pii_key(int)');
select function_privs_are('private', 'encrypt_pii', array['text', 'integer'],  'anon',          array[]::text[], 'anon has no EXECUTE on encrypt_pii(text, int)');
select function_privs_are('private', 'decrypt_pii', array['bytea', 'integer'], 'anon',          array[]::text[], 'anon has no EXECUTE on decrypt_pii(bytea, int)');
select function_privs_are('private', 'pii_seed_canary', array['integer'],      'service_role',  array[]::text[], 'service_role has no EXECUTE on pii_seed_canary');
select function_privs_are('private', 'pii_encrypted_values', array[]::text[],  'service_role',  array[]::text[], 'service_role has no EXECUTE on pii_encrypted_values');

select function_privs_are('public', 'pii_health_check', array[]::text[], 'anon',          array[]::text[], 'anon cannot call pii_health_check');
select function_privs_are('public', 'pii_health_check', array[]::text[], 'authenticated', array[]::text[], 'authenticated cannot call pii_health_check');
select function_privs_are('public', 'pii_health_check', array[]::text[], 'service_role',  array[]::text[], 'service_role cannot call pii_health_check (postgres, its owner, runs it)');
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

select is(public.pii_health_check(), true, 'the health check passes on a fresh database');

create temp table canary_v1 as select ciphertext from private.pii_canary where key_version = 1;
select is(private.pii_seed_canary(1), false, 'pii_seed_canary refuses a version that already has a canary');
select ok((select c.ciphertext = s.ciphertext from private.pii_canary c, canary_v1 s where c.key_version = 1),
  '… and leaves that canary unchanged');
select throws_ok($$ select private.pii_seed_canary(0) $$, '22023', null, 'pii_seed_canary rejects a version below 1');

-- Failures: the check returns false, it never raises. Each damage is undone by writing a fresh
-- canary, not by a savepoint: rolling back to a savepoint also rolls back pgTAP's test counter.
update private.pii_canary set ciphertext = extensions.pgp_sym_encrypt('mana-pii-canary', 'pas-la-bonne-cle', 'cipher-algo=aes256')
 where key_version = 1;
select is(public.pii_health_check(), false, 'a canary encrypted with another key fails the check');

update private.pii_canary set ciphertext = '\xdeadbeef' where key_version = 1;
select is(public.pii_health_check(), false, 'a corrupt canary fails the check');

update private.pii_canary set ciphertext = private.encrypt_pii('autre valeur', 1) where key_version = 1;
select is(public.pii_health_check(), false, 'a canary that decrypts to another value fails the check');

delete from private.pii_canary;
select is(public.pii_health_check(), false, 'no canary row fails the check (nothing proven)');
select is(private.pii_current_key_version(), 1, 'without a canary the write version falls back to 1');

select is(private.pii_seed_canary(1), true, 'pii_seed_canary recreates the version 1 canary (its key reads every stored value)');
select is(public.pii_health_check(), true, 'the health check passes again once the canary is restored');

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
select ok(exists (select 1 from private.pii_encrypted_values() e
                   where e.table_name = 'organization_bank_details' and e.column_name = 'account_number' and e.key_version = 1),
  'pii_encrypted_values lists the stored account numbers with their version');
select results_eq($$ select distinct key_version from private.pii_key_versions_in_use() $$, $$ values (1) $$,
  'only version 1 holds data');

-- One version per row: a write that keeps the account on a row already on the current version
-- does not rewrite the ciphertext (no « changed » audit entry for it).
create temp table account_a as
  select account_number from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('815', '30002', null, null) $$, 'admin A changes the transit only (version 1 is current)');
reset role;
select ok((select b.account_number = s.account_number from public.organization_bank_details b, account_a s
            where b.org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'a row already on the current version keeps its ciphertext when the account is kept');

-- =============================================================================
-- The check covers the stored data (org C's row, written as postgres, with a version 3 key)
-- =============================================================================
select lives_ok(
  $$ select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'pii_encryption_key_v3', 'test 047') $$,
  'a version 3 key exists (no canary)');
insert into public.organization_bank_details (org_id, institution_number, transit_number, account_number, account_last4, key_version)
values ('b0000000-0000-0000-0000-00000000000c', '002', '22222', private.encrypt_pii('99990000', 3), '0000', 3);
select is(public.pii_health_check(), false, 'a version in use with no canary fails the check');

select is(private.pii_seed_canary(3), true, 'pii_seed_canary seeds a version whose key reads every value stored with it');
select is(public.pii_health_check(), true, '… and the check passes');
delete from private.pii_canary where key_version = 3;
select is(private.pii_current_key_version(), 1, 'without the version 3 canary the write version is 1 again');

-- The key is replaced after rows were written with it (« edited in the dashboard »).
select lives_ok(
  $$ select vault.update_secret(s.id, encode(extensions.gen_random_bytes(32), 'base64')) from vault.secrets s where s.name = 'pii_encryption_key_v3' $$,
  'the version 3 key is replaced after data was written with it');
select is(private.pii_seed_canary(3), false, 'a replaced key: the canary is not seeded');
select is_empty($$ select 1 from private.pii_canary where key_version = 3 $$, '… no version 3 canary exists');
select is(public.pii_health_check(), false, '… and the check stays false');

delete from vault.secrets where name = 'pii_encryption_key_v3';
select is(public.pii_health_check(), false, 'a version in use with no key fails the check');

delete from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000c';
select is(public.pii_health_check(), true, 'once no data uses version 3, the check passes again');

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
select throws_ok((select code from runbook where step = 'batch'), 'P0001',
  'La version d''écriture est 1, pas 2 : rien n''est re-chiffré.',
  'step 4 refuses to run before the version 2 canary exists');

select is(private.pii_seed_canary(2), true, 'step 3: add the version 2 canary');
select is(private.pii_current_key_version(), 2, 'the write version is now 2 (highest canary)');
select is(public.pii_health_check(), true, 'the health check passes with both versions');

-- Writes leave the whole row on the current version; reads follow each row's version.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('815', '30001', null, null) $$, 'admin A changes the transit only');
select is(public.reveal_bank_account_number(), '1234567', 'admin A still reveals the same account');
reset role;
select is((select key_version from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  2::smallint, 'keeping the account re-encrypts it with the current version (one version per row)');
select ok((select private.decrypt_pii(account_number, 2) = '1234567' from public.organization_bank_details
            where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'the kept account now decrypts with the version 2 key');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_bank_details('815', '30001', '7654321', null) $$, 'admin A replaces the account');
select is(public.reveal_bank_account_number(), '7654321', 'admin A reveals the new account');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.reveal_bank_account_number(), '11112222', 'admin B still reveals a version 1 account (mixed versions)');
reset role;
select is((select key_version from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  2::smallint, 'a replaced account is written with the current version');

-- Step 4: the runbook's batch block, run until nothing is left on version 1.
select lives_ok((select code from runbook where step = 'batch'), 'step 4: the batch re-encrypts the remaining rows to version 2');
select set_config('app.audit_source', '', true);
select is((select count(*)::int from public.organization_bank_details where key_version <> 2), 0,
  'no bank row is left on another version');
select results_eq($$ select distinct key_version from private.pii_key_versions_in_use() $$, $$ values (2) $$,
  'the inventory shows only version 2');
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

-- Re-running the batch once everything is on version 2 updates no row.
create temp table before_rerun as select org_id, account_number, key_version from public.organization_bank_details;
create temp table audit_before_rerun as
  select count(*)::int as n from public.audit_log where table_name = 'organization_bank_details';
select lives_ok((select code from runbook where step = 'batch'), 're-running the batch is harmless');
select set_config('app.audit_source', '', true);
select is_empty($$
  select b.org_id from public.organization_bank_details b join before_rerun s using (org_id)
   where b.account_number is distinct from s.account_number or b.key_version <> s.key_version
$$, '… it rewrote no row');
select is((select count(*)::int from public.audit_log where table_name = 'organization_bank_details'),
  (select n from audit_before_rerun), '… and wrote no audit row');

select is(public.pii_health_check(), true, 'step 5: the health check passes after the re-encryption');

-- =============================================================================
-- Rollback (before step 7): back to version 1, then forward again
-- =============================================================================
select throws_ok((select replace(code, 'v_target constant integer := 2', 'v_target constant integer := 1') from runbook where step = 'batch'),
  'P0001', 'La version d''écriture est 2, pas 1 : rien n''est re-chiffré.',
  'rollback: the batch towards version 1 refuses while version 2 is the write version');
delete from private.pii_canary where key_version = 2;
select is(private.pii_current_key_version(), 1, 'rollback point 1: without the version 2 canary, writes go back to version 1');
select is(public.pii_health_check(), false, 'rollback point 1: version 2 still holds data without a canary, the check is false');
select lives_ok((select replace(code, 'v_target constant integer := 2', 'v_target constant integer := 1') from runbook where step = 'batch'),
  'rollback point 2: the batch re-encrypts back to version 1');
select set_config('app.audit_source', '', true);
select results_eq($$ select distinct key_version from private.pii_key_versions_in_use() $$, $$ values (1) $$,
  'rollback: the inventory shows only version 1');
select is(public.pii_health_check(), true, 'rollback point 3: the check passes');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.reveal_bank_account_number(), '7654321', 'rollback: admin A reveals the account');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.reveal_bank_account_number(), '11112222', 'rollback: admin B reveals the account');
reset role;

select is(private.pii_seed_canary(2), true, 'forward again: step 3 re-adds the version 2 canary');

-- =============================================================================
-- Step 7: retire version 1 (one block; nothing is deleted unless every check passes)
-- =============================================================================
select throws_ok((select code from runbook where step = 'retire'), 'P0001',
  'Des valeurs sont encore chiffrées avec la version 1 (étape 4) : rien n''est retiré.',
  'step 7 refuses while values are still encrypted with version 1');
select ok(exists (select 1 from private.pii_canary where key_version = 1) and private.pii_key(1) is not null,
  '… and deletes nothing (version 1 canary and secret still there)');
select throws_ok((select replace(code, 'v_old constant integer := 1', 'v_old constant integer := 2') from runbook where step = 'retire'),
  'P0001', 'La version 2 est la version d''écriture : rien n''est retiré.',
  'step 7 refuses to retire the write version');

select lives_ok((select code from runbook where step = 'batch'), 'step 4 again: the batch re-encrypts to version 2');
select set_config('app.audit_source', '', true);
select lives_ok((select code from runbook where step = 'retire'), 'step 7: the block retires version 1');
select results_eq($$ select key_version from private.pii_canary order by 1 $$, $$ values (2::smallint) $$,
  'only the version 2 canary is left');
select ok(private.pii_key(1) is null, 'the pii_encryption_key secret is gone');
select is(public.pii_health_check(), true, 'with only version 2 left the check passes');
select is(private.pii_current_key_version(), 2, 'the write version stays 2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.reveal_bank_account_number(), '11112222', 'admin B reveals the account after version 1 is retired');
reset role;

-- The key loss the check guards against (last: it leaves the version 2 data unreadable).
delete from vault.secrets where name = 'pii_encryption_key_v2';
select is(public.pii_health_check(), false, 'losing the version 2 key fails the check');

select * from finish();
rollback;
