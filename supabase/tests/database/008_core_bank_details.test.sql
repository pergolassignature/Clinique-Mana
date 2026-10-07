-- Encrypted clinic bank details (migration *_core_bank_details.sql, ADR 0004):
-- Vault key, private.pii_key / encrypt_pii / decrypt_pii, organization_bank_details,
-- get_bank_details / reveal_bank_account_number / set_bank_details, audit action 'read'.
-- Covers: privileges, key presence (never its value), encryption at rest, masking,
-- audited reveal, redaction, validation, settings.manage is not enough, org isolation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(73);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin and an adjointe who is granted
-- settings.manage by override (to prove it is not enough); org B with an admin.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage', true);

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'organization_bank_details', 'anon', array[]::text[], 'anon: no privileges on organization_bank_details');
select table_privs_are('public', 'organization_bank_details', 'authenticated', array[]::text[], 'authenticated: no privileges on organization_bank_details');
select table_privs_are('public', 'organization_bank_details', 'service_role', array[]::text[], 'service_role: no privileges on organization_bank_details');

select function_privs_are('private', 'pii_key',     array[]::text[], 'authenticated', array[]::text[], 'authenticated has no EXECUTE on pii_key');
select function_privs_are('private', 'pii_key',     array[]::text[], 'service_role',  array[]::text[], 'service_role has no EXECUTE on pii_key');
select function_privs_are('private', 'encrypt_pii', array['text'],   'authenticated', array[]::text[], 'authenticated has no EXECUTE on encrypt_pii');
select function_privs_are('private', 'encrypt_pii', array['text'],   'service_role',  array[]::text[], 'service_role has no EXECUTE on encrypt_pii');
select function_privs_are('private', 'decrypt_pii', array['bytea'],  'authenticated', array[]::text[], 'authenticated has no EXECUTE on decrypt_pii');
select function_privs_are('private', 'decrypt_pii', array['bytea'],  'service_role',  array[]::text[], 'service_role has no EXECUTE on decrypt_pii');

select function_privs_are('public', 'get_bank_details',           array[]::text[], 'anon', array[]::text[], 'anon cannot call get_bank_details');
select function_privs_are('public', 'reveal_bank_account_number', array[]::text[], 'anon', array[]::text[], 'anon cannot call reveal_bank_account_number');
select function_privs_are('public', 'set_bank_details', array['text', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call set_bank_details');
select function_privs_are('public', 'get_bank_details',           array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can call get_bank_details');
select function_privs_are('public', 'reveal_bank_account_number', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can call reveal_bank_account_number');
select function_privs_are('public', 'set_bank_details', array['text', 'text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated can call set_bank_details');
select function_privs_are('public', 'get_bank_details',           array[]::text[], 'service_role', array[]::text[], 'service_role has no grant on get_bank_details');
select function_privs_are('public', 'reveal_bank_account_number', array[]::text[], 'service_role', array[]::text[], 'service_role has no grant on reveal_bank_account_number');
select function_privs_are('public', 'set_bank_details', array['text', 'text', 'text', 'text'], 'service_role', array[]::text[], 'service_role has no grant on set_bank_details');

-- =============================================================================
-- Key and storage (as postgres). The key value is never selected.
-- =============================================================================
select is((select count(*)::int from vault.secrets where name = 'pii_encryption_key'), 1,
  'exactly one Vault secret pii_encryption_key exists');
select col_type_is('public', 'organization_bank_details', 'account_number', 'bytea', 'account_number is stored as bytea');

-- Audit action 'read' (probe rows are rolled back with the test).
select lives_ok($$ insert into public.audit_log (table_name, record_id, action) values ('zz_probe', 'x', 'read') $$,
  'audit_log accepts action read');
select throws_ok($$ insert into public.audit_log (table_name, record_id, action) values ('zz_probe', 'x', 'select') $$,
  '23514', null, 'audit_log still rejects unknown actions');

-- =============================================================================
-- Admin A
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is_empty($$ select * from public.get_bank_details() $$, 'no bank details yet');
select is(public.reveal_bank_account_number(), null, 'nothing to reveal yet');

select lives_ok($$ select public.set_bank_details('815', '30000', '1234567', 'paiement@clinique.test') $$,
  'admin saves the bank details');
select results_eq(
  $$ select institution_number, transit_number, account_last4, etransfer_email from public.get_bank_details() $$,
  $$ values ('815'::text, '30000'::text, '4567'::text, 'paiement@clinique.test'::text) $$,
  'get_bank_details returns the masked view');
select is((select updated_by_name from public.get_bank_details()), 'Admin A', 'get_bank_details names who saved them');
select is(public.reveal_bank_account_number(), '1234567', 'reveal returns the full account number');
select results_eq(
  $$ select action, source, actor_id, actor_role, record_id, changed_fields from public.audit_log
      where table_name = 'organization_bank_details' and action = 'read' $$,
  $$ values ('read'::text, 'rpc:reveal_bank_account_number'::text, 'a0000000-0000-0000-0000-000000000001'::uuid,
             'admin'::text, 'b0000000-0000-0000-0000-00000000000a'::text, '{"fields": ["account_number"]}'::jsonb) $$,
  'the reveal writes one read row to the audit log');

select lives_ok($$ select public.set_bank_details('815', '30001', null, null) $$,
  'admin changes the transit without retyping the account');
select results_eq(
  $$ select institution_number, transit_number, account_last4, etransfer_email from public.get_bank_details() $$,
  $$ values ('815'::text, '30001'::text, '4567'::text, null::text) $$,
  'transit changed, account kept, Interac email cleared');
select is(public.reveal_bank_account_number(), '1234567', 'the stored account is unchanged');

select lives_ok($$ select public.set_bank_details('815', '30001', ' 765-4321 ', '  paiement@clinique.test  ') $$,
  'admin replaces the account (spaces and hyphens are accepted)');
select results_eq(
  $$ select account_last4, etransfer_email from public.get_bank_details() $$,
  $$ values ('4321'::text, 'paiement@clinique.test'::text) $$,
  'the new account is masked and the email trimmed');
select is(public.reveal_bank_account_number(), '7654321', 'the new account is stored as digits only');

select lives_ok($$ select public.set_bank_details(' 815 ', E'\t30001\n', '   ', '  PAIEMENT@Clinique.TEST ') $$,
  'admin saves with padded numbers, a blank account and a mixed-case email');
select results_eq(
  $$ select institution_number, transit_number, account_last4, etransfer_email from public.get_bank_details() $$,
  $$ values ('815'::text, '30001'::text, '4321'::text, 'paiement@clinique.test'::text) $$,
  'numbers are trimmed, a blank account keeps the stored one, the email is lowercased');
select lives_ok($$ select public.set_bank_details('815', '30001', null, E' \t ') $$,
  'admin saves a whitespace-only Interac email');
select is((select etransfer_email from public.get_bank_details()), null, 'a whitespace-only email is stored as null');

select throws_ok($$ select public.set_bank_details('81', '30000', '1234567', null) $$,
  'P0001', 'Le numéro d''institution compte 3 chiffres.', 'institution number has 3 digits');
select throws_ok($$ select public.set_bank_details('815', '3000', '1234567', null) $$,
  'P0001', 'Le numéro de transit compte 5 chiffres.', 'transit number has 5 digits');
select throws_ok($$ select public.set_bank_details('815', '30000', '123', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'account number has 7 to 12 digits');
select throws_ok($$ select public.set_bank_details('815', '30000', '1234567890123', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'account number has at most 12 digits');
select throws_ok($$ select public.set_bank_details('815', '30000', '1234567', 'x') $$,
  'P0001', 'Courriel Interac invalide.', 'Interac email must look like an email');
select throws_ok($$ select public.set_bank_details('815', '30000', '12a34567', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'letters in the account are refused, not stripped');
select throws_ok($$ select public.set_bank_details('815', '30000', 'abc', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'a non-numeric account is refused, not taken as « keep »');
select throws_ok($$ select public.set_bank_details('815', '30000', '１２３４５６７', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'fullwidth digits are refused in the account');
select throws_ok($$ select public.set_bank_details('８１５', '30000', '1234567', null) $$,
  'P0001', 'Le numéro d''institution compte 3 chiffres.', 'fullwidth digits are refused in the institution');
select is(public.reveal_bank_account_number(), '7654321', 'refused saves changed nothing');

-- =============================================================================
-- Adjointe A: settings.manage (by override) is not settings.bank_manage
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select ok(private.has_permission('settings.manage'), 'the adjointe has settings.manage by override');
select throws_ok($$ select * from public.get_bank_details() $$, '42501', null, 'adjointe cannot read bank details');
select throws_ok($$ select public.reveal_bank_account_number() $$, '42501', null, 'adjointe cannot reveal the account');
select throws_ok($$ select public.set_bank_details('815', '30000', '1234567', null) $$, '42501', null, 'adjointe cannot save bank details');
select throws_ok($$ select count(*) from public.organization_bank_details $$, '42501', null, 'the table is unreadable for clients');

-- =============================================================================
-- Admin B: sees nothing of org A, writes only org B
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select is_empty($$ select * from public.get_bank_details() $$, 'org B admin gets no row (org A data stays out of reach)');
select is(public.reveal_bank_account_number(), null, 'org B admin reveals nothing');
select throws_ok($$ select public.set_bank_details('815', '30000', null, null) $$,
  'P0001', 'Le numéro de compte est requis.', 'a first save needs the account number');
select lives_ok($$ select public.set_bank_details('001', '12345', '11112222', null) $$, 'org B admin saves org B details');
select results_eq(
  $$ select institution_number, transit_number, account_last4 from public.get_bank_details() $$,
  $$ values ('001'::text, '12345'::text, '2222'::text) $$,
  'org B admin sees only org B details');

-- =============================================================================
-- As postgres: encryption at rest, audit, org A untouched
-- =============================================================================
reset role;

select is((select position('7654321' in encode(account_number, 'escape'))
             from public.organization_bank_details where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  0, 'the stored account number is not in clear text');
-- OpenPGP symmetric-key session packet: tag 3, version 4, then the cipher id (9 = AES-256).
select is((select get_byte(account_number, 3) from public.organization_bank_details
            where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  9, 'the account number is encrypted with AES-256');
-- Then the S2K specifier: type 3 (iterated and salted), then the digest id (8 = SHA-256).
select is((select get_byte(account_number, 5) from public.organization_bank_details
            where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  8, 'the key derivation uses SHA-256');
select is((select extensions.pgp_sym_decrypt(account_number, private.pii_key()) from public.organization_bank_details
            where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  '7654321', 'the ciphertext decrypts with the Vault key');
select is(private.decrypt_pii(extensions.pgp_sym_encrypt('7654321', private.pii_key(), 'cipher-algo=aes256')),
  '7654321', 'values written with the earlier options (SHA-1 S2K) still decrypt');
select results_eq(
  $$ select transit_number, account_last4 from public.organization_bank_details
      where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('30001'::text, '4321'::text) $$,
  'org A details are untouched by org B');
select is((select count(*)::int from public.audit_log
            where table_name = 'organization_bank_details' and action = 'read'
              and org_id = 'b0000000-0000-0000-0000-00000000000a' and source = 'rpc:reveal_bank_account_number'),
  4, 'each reveal of a stored account is audited (4 reveals)');
select is((select changed_fields -> 'account_number' from public.audit_log
            where table_name = 'organization_bank_details' and action = 'insert'
              and org_id = 'b0000000-0000-0000-0000-00000000000a'),
  '"[redacted]"'::jsonb, 'the insert audit row redacts the account number');
select is((select changed_fields -> 'account_number' from public.audit_log
            where table_name = 'organization_bank_details' and action = 'update'
              and org_id = 'b0000000-0000-0000-0000-00000000000a' and changed_fields ? 'account_number'),
  '"[redacted]"'::jsonb, 'the update audit row redacts the account number');
select is((select changed_fields -> 'transit_number' from public.audit_log
            where table_name = 'organization_bank_details' and action = 'update'
              and org_id = 'b0000000-0000-0000-0000-00000000000a' and changed_fields ? 'transit_number'),
  '"[redacted]"'::jsonb, 'a transit change is visible but its value is redacted');
select results_eq(
  $$ select changed_fields -> 'account_last4', changed_fields -> 'institution_number',
            changed_fields -> 'transit_number', changed_fields -> 'etransfer_email'
       from public.audit_log
      where table_name = 'organization_bank_details' and action = 'insert'
        and org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('"[redacted]"'::jsonb, '"[redacted]"'::jsonb, '"[redacted]"'::jsonb, '"[redacted]"'::jsonb) $$,
  'every bank value is redacted from the audit trail');
select is((select count(*)::int from public.audit_log
            where changed_fields::text like '%1234567%' or changed_fields::text like '%7654321%'
               or changed_fields::text like '%11112222%'
               or changed_fields::text ~* '[0-9a-f]{32,}'),
  0, 'no account number or ciphertext (long hex run) reaches the audit log');

-- =============================================================================
-- Org secrets cannot reach the PII key through a forged row (as postgres)
-- =============================================================================
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000a', 'forged',
        (select id from vault.secrets where name = 'pii_encryption_key'));
set local role service_role;
select is(public.get_org_secret('b0000000-0000-0000-0000-00000000000a', 'forged'), null,
  'get_org_secret does not return a secret that is not named after the row');
reset role;
delete from public.org_secrets where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'forged';
select is((select count(*)::int from vault.secrets where name = 'pii_encryption_key'), 1,
  'deleting a forged org_secrets row leaves the PII key in place');

select * from finish();
rollback;
