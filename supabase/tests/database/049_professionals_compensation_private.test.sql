-- Professionnels: encrypted private data (migration *_professionals_compensation_private.sql,
-- plan Phase 4 Task 4a.17). The retention program of the same migration: 050.
-- Covers: privileges (table, RPCs, helpers, over pg_proc); the three card saves
-- (set_professional_tax_numbers, set_professional_bank, set_professional_sin: encryption at rest,
-- masks, collect_sin, Luhn, normalisation, validation messages that never repeat a value, blank
-- keeps the account and clears the plain fields, a card never touches another card's fields,
-- optimistic concurrency with HINT stale); reveal (audited read rows with the field name only,
-- nothing stored → null and no row, an unreadable value writes none); clear; collect_sin off
-- (reveal and clear allowed, a new SIN refused); audit redaction of every value column and no
-- plaintext anywhere in audit_log; permissions (adjointe, provider, conseillère, module off,
-- another clinic with org A's ids on every RPC); the history (private rows without values, reads
-- by known field name only); key versions
-- (pii_encrypted_values, one version per row during a rotation on every card, the clean P0001
-- for an unreadable kept value, the health check).
-- Plaintexts are only compared, never stored outside the RPCs' own writes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

-- The HINT of the error p_sql raises (null when none): throws_ok checks only the code and message.
create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated;

-- The updated_at a card read before saving (P4-148), through the RPC the UI uses.
create function private.test_seen(p_id uuid) returns timestamptz
language sql set search_path = '' as $$
  select g.updated_at from public.get_professional_private(p_id) g
$$;
grant execute on function private.test_seen(uuid) to authenticated;

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider (linked to P2) and a
-- conseillère; org B with an admin. P1, P2 in org A, P3 in org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.test');
select set_config('test.p1', 'c0000000-0000-0000-0000-000000000001', true);
select set_config('test.p2', 'c0000000-0000-0000-0000-000000000002', true);
select set_config('test.p3', 'c0000000-0000-0000-0000-000000000003', true);

-- =============================================================================
-- Privileges (as postgres)
-- =============================================================================
select table_privs_are('public', 'professional_private', 'anon',          array[]::text[], 'anon: no privileges on professional_private');
select table_privs_are('public', 'professional_private', 'authenticated', array[]::text[], 'authenticated: no privileges on professional_private');
select table_privs_are('public', 'professional_private', 'service_role',  array[]::text[], 'service_role: no privileges on professional_private (revoked)');
select is((select c.relrowsecurity from pg_class c where c.oid = 'public.professional_private'::regclass), true,
  'professional_private has RLS on');
select is((select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'professional_private'), 0,
  'professional_private has no policy');

-- The six RPCs: EXECUTE for authenticated only (never anon, PUBLIC or service_role).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('get_professional_private', 'reveal_professional_private', 'set_professional_tax_numbers',
                                'set_professional_bank', 'set_professional_sin', 'clear_professional_private_field')),
  6, 'the six RPCs exist, none overloaded');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_professional_private', 'reveal_professional_private', 'set_professional_tax_numbers',
                       'set_professional_bank', 'set_professional_sin', 'clear_professional_private_field')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute')
          or not has_function_privilege('authenticated', p.oid, 'execute')
          or not p.prosecdef)
$$, 'the RPCs are security definer and executable by authenticated only');
select function_privs_are('public', 'reveal_professional_private', array['uuid', 'text'], 'anon', array[]::text[], 'anon cannot reveal');
select function_privs_are('public', 'reveal_professional_private', array['uuid', 'text'], 'service_role', array[]::text[], 'service_role cannot reveal');
select function_privs_are('public', 'set_professional_bank', array['uuid', 'text', 'text', 'text', 'timestamp with time zone'],
  'authenticated', array['EXECUTE'], 'authenticated may call set_professional_bank (its RPC checks the permission)');
select hasnt_function('public', 'set_professional_private', 'the whole-form save is gone (one RPC per card, P4-148)');

-- Helpers: granted to no role.
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('is_valid_sin', 'raise_unreadable_private_value', 'unreadable_private_field', 'assert_private_not_stale',
                       'pii_encrypted_values', 'professional_history_tables')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private helpers are granted to no role');

-- Luhn (as postgres).
select ok(private.is_valid_sin('046454286'), 'Luhn: 046 454 286 is valid');
select ok(not private.is_valid_sin('123456789'), 'Luhn: 123 456 789 is not');
select ok(not private.is_valid_sin('04645428'), 'Luhn: 8 digits are not a SIN');
select ok(not coalesce(private.is_valid_sin(null), false), 'Luhn: null is not a SIN');

-- =============================================================================
-- The three card saves / get_professional_private (admin A, P1)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$ select * from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values (null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::text) $$,
  'nothing stored: one row of nulls');
select throws_ok($$ select * from public.get_professional_private(current_setting('test.p3')::uuid) $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is not found');

select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid,
  '123456789', '123456789RT0001', '1234567890TQ0001', null) $$, 'admin A stores P1''s tax numbers (nothing stored: expected null)');
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid,
  '815', '30000', '1234567', private.test_seen(current_setting('test.p1')::uuid)) $$, 'admin A stores P1''s bank details');
select results_eq($$ select sin_last3, business_number, gst_number, qst_number, bank_institution, bank_transit, bank_account_last4, updated_by_name
                       from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values (null::text, '123456789'::text, '123456789RT0001'::text, '1234567890TQ0001'::text, '815'::text, '30000'::text, '4567'::text, 'Admin A'::text) $$,
  'get returns the plain numbers and the masks only');

select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046 454 286', private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'La collecte du NAS n''est pas activée.', 'a SIN is refused while collect_sin is off');
select is(public.set_professionals_settings('{"collect_sin": true}') -> 'collect_sin', 'true'::jsonb, 'admin A turns SIN collection on');
select lives_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046 454 286', private.test_seen(current_setting('test.p1')::uuid)) $$,
  'a valid SIN is stored');
select results_eq($$ select sin_last3, business_number, bank_account_last4 from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values ('286'::text, '123456789'::text, '4567'::text) $$, 'sin_last3 is the last three digits; the SIN save touched nothing else');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '123456789', private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'NAS invalide.', 'a SIN failing Luhn is refused, without repeating it');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046-454-28A', private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'NAS invalide.', 'a SIN with a letter is refused (never stripped)');
select is(private.test_error_hint($$ select public.set_professional_sin('c0000000-0000-0000-0000-000000000001', '123456789', null) $$),
  'Le NAS compte 9 chiffres, et son dernier chiffre doit correspondre aux huit autres.', 'the Luhn refusal hints without a value');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, ' - ', private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Saisissez le NAS au complet.', 'a blank SIN is refused (clearing is its own RPC)');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, null, private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Saisissez le NAS au complet.', '… a null SIN too');

-- Storage (as postgres): ciphertexts, never the plaintext; version 1.
reset role;
select is((select pg_typeof(pp.bank_account)::text from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid),
  'bytea', 'the account is stored as bytea');
select is((select position('1234567' in encode(pp.bank_account, 'escape')) + position('046454286' in encode(pp.sin, 'escape'))
             from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid),
  0, 'neither plaintext appears in the ciphertexts');
select is((select pp.key_version::int from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid),
  1, 'key_version is 1');
select results_eq($$ select e.column_name, e.row_key, e.key_version from private.pii_encrypted_values() e
                      where e.table_name = 'professional_private' order by 1 $$,
  $$ values ('bank_account'::text, current_setting('test.p1'), 1), ('sin'::text, current_setting('test.p1'), 1) $$,
  'pii_encrypted_values lists both ciphertexts with their row key and version');
select ok(exists (select 1 from private.pii_key_versions_in_use() u where u.table_name = 'professional_private' and u.key_version = 1 and u.value_count = 2),
  'pii_key_versions_in_use lists professional_private');
select ok(public.pii_health_check(), 'the health check reads the new values');
select set_config('test.account_bytes', (select encode(pp.bank_account, 'hex') from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid), true);
select set_config('test.audit_before', (select coalesce(max(a.id), 0)::text from public.audit_log a), true);

-- =============================================================================
-- Reveal
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account'), '1234567', 'reveal returns the account');
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'sin'), '046454286', 'reveal returns the SIN (digits only)');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'email') $$,
  '22023', 'Champ inconnu (attendu : sin ou bank_account).', 'another field is refused (and not echoed)');
select is(public.reveal_professional_private(current_setting('test.p2')::uuid, 'bank_account'), null, 'nothing stored: null');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p3')::uuid, 'sin') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is not found');
reset role;
select results_eq($$ select a.org_id, a.record_id, a.action, a.changed_fields, a.actor_id, a.actor_role, a.source
                      from public.audit_log a
                     where a.id > current_setting('test.audit_before')::bigint and a.table_name = 'professional_private'
                     order by a.id $$,
  $$ values
       ('b0000000-0000-0000-0000-00000000000a'::uuid, current_setting('test.p1'), 'read'::text, '{"fields": ["bank_account"]}'::jsonb,
        'a0000000-0000-0000-0000-000000000001'::uuid, 'admin'::text, 'rpc:reveal_professional_private'::text),
       ('b0000000-0000-0000-0000-00000000000a'::uuid, current_setting('test.p1'), 'read'::text, '{"fields": ["sin"]}'::jsonb,
        'a0000000-0000-0000-0000-000000000001'::uuid, 'admin'::text, 'rpc:reveal_professional_private'::text) $$,
  'each reveal writes one read row naming the field; nothing stored writes none');

-- =============================================================================
-- Blank keeps / clears, one card never touches another's fields
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', '', '1234567890TQ0001',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'a blank TPS');
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', '  ',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'a blank account');
select results_eq($$ select sin_last3, gst_number, bank_account_last4 from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values ('286'::text, null::text, '4567'::text) $$, 'a blank TPS clears it; a blank account keeps it; the SIN stays');
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account'), '1234567', 'the kept account still reveals');
reset role;
select is((select encode(pp.bank_account, 'hex') from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid),
  current_setting('test.account_bytes'), 'a current row keeps its kept ciphertext byte for byte');
select is_empty($$ select 1 from public.audit_log a where a.id > current_setting('test.audit_before')::bigint
                     and a.table_name = 'professional_private' and a.action = 'update'
                     and (a.changed_fields ? 'bank_account' or a.changed_fields ? 'sin' or a.changed_fields ? 'key_version') $$,
  'keeping the encrypted fields on a current row logs no change to them');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, null, ' ', null,
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'an all-blank « Fiscalité » save');
select results_eq($$ select sin_last3, business_number, gst_number, qst_number, bank_institution, bank_transit, bank_account_last4
                      from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values ('286'::text, null::text, null::text, null::text, '815'::text, '30000'::text, '4567'::text) $$,
  '… clears the NE, TPS and TVQ only (the bank card''s fields and the SIN stay)');
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, null, null, null,
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'an all-blank « Banque » save');
select results_eq($$ select sin_last3, bank_institution, bank_transit, bank_account_last4
                      from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values ('286'::text, null::text, null::text, '4567'::text) $$,
  '… clears the institution and the transit, keeps the account and the SIN');
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', '123456789RT0001', '1234567890TQ0001',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'the tax numbers are entered again');
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', null,
  private.test_seen(current_setting('test.p1')::uuid)) $$, '… and the institution and transit');

-- Optimistic concurrency (P4-148).
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', null, null, '2020-01-01 00:00+00') $$,
  'P0001', 'Ces renseignements ont été modifiés depuis leur affichage.', 'a save based on an older read is refused');
select is(private.test_error_hint($$ select public.set_professional_bank('c0000000-0000-0000-0000-000000000001', '815', '30000', null, '2020-01-01 00:00+00') $$),
  'stale', '… with the HINT stale');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', null, null) $$,
  'P0001', 'Ces renseignements ont été modifiés depuis leur affichage.', 'expected null (nothing seen) while a row exists: refused');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046454286', '2020-01-01 00:00+00') $$,
  'P0001', 'Ces renseignements ont été modifiés depuis leur affichage.', 'the SIN save checks it too');
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', '123456789RT0001', '1234567890TQ0001',
  date_trunc('milliseconds', private.test_seen(current_setting('test.p1')::uuid))) $$,
  'a value read to the millisecond (through a JavaScript Date) still matches');
select is(public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', '123456789RT0001', '1234567890TQ0001',
  private.test_seen(current_setting('test.p1')::uuid)), now(), 'a save returns the row''s new updated_at');
select is(public.set_professional_bank(current_setting('test.p2')::uuid, '', null, ' ', null), null,
  'an all-blank save with no row yet returns null');

-- Validation (before the lock).
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '12345678', null, null, null) $$,
  'P0001', 'Le numéro d''entreprise (NE) compte 9 chiffres.', 'business number: 9 digits');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, null, '123456789TQ0001', null, null) $$,
  'P0001', 'Numéro de TPS : format attendu 123456789 RT 0001.', 'TPS format');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, null, null, '123456789TQ0001', null) $$,
  'P0001', 'Numéro de TVQ : format attendu 1234567890 TQ 0001.', 'TVQ format');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '81', '30000', null, null) $$,
  'P0001', 'Le numéro d''institution compte 3 chiffres.', 'institution: 3 digits');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '3000', null, null) $$,
  'P0001', 'Le numéro de transit compte 5 chiffres.', 'transit: 5 digits');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', '123456', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'account: at least 7 digits');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', '12345a7', null) $$,
  'P0001', 'Le numéro de compte compte de 7 à 12 chiffres.', 'account: a letter is refused, never stripped');
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid,
  '123 456 789', '123456789 rt 0001', '1234567890-tq-0001', private.test_seen(current_setting('test.p1')::uuid)) $$,
  'spaces, hyphens and lower case are tidied');
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, E' 815\t', '30-000', null,
  private.test_seen(current_setting('test.p1')::uuid)) $$, '… on the bank card too');
select results_eq($$ select business_number, gst_number, qst_number, bank_institution, bank_transit from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values ('123456789'::text, '123456789RT0001'::text, '1234567890TQ0001'::text, '815'::text, '30000'::text) $$, 'numbers are stored normalised');

-- Clear.
select lives_ok($$ select public.clear_professional_private_field(current_setting('test.p1')::uuid, 'bank_account') $$, 'clear the account');
select results_eq($$ select sin_last3, bank_institution, bank_account_last4 from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  $$ values ('286'::text, '815'::text, null::text) $$, 'the account and its last 4 are gone; the SIN and the institution stay');
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account'), null, 'a cleared account reveals nothing');
select set_config('test.audit_mid', (select coalesce(max(a.id), 0)::text from public.audit_log a where a.table_name = 'professional_private'), true);
select lives_ok($$ select public.clear_professional_private_field(current_setting('test.p1')::uuid, 'bank_account') $$, 'clearing again is a no-op');
select throws_ok($$ select public.clear_professional_private_field(current_setting('test.p1')::uuid, 'gst_number') $$,
  '22023', 'Champ inconnu (attendu : sin ou bank_account).', 'clear: only sin or bank_account');
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', '1234567',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'the account is entered again');
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p2')::uuid, null, null, null, null) $$,
  'an all-blank call with no row yet');
reset role;
select is((select count(*)::int from public.professional_private pp where pp.professional_id = current_setting('test.p2')::uuid), 0,
  '… creates no empty row');
select is((select count(*)::int from public.audit_log a where a.table_name = 'professional_private' and a.id > current_setting('test.audit_mid')::bigint
            and a.changed_fields ? 'bank_account' and a.action = 'update'), 1, 'the second clear wrote nothing (only the re-entry changed the account)');

-- collect_sin off (P4-143): a stored SIN still reveals and clears; a new one is refused. P2.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_sin(current_setting('test.p2')::uuid, '130 692 544', null) $$, 'P2''s SIN is stored');
select is(public.set_professionals_settings('{"collect_sin": false}') -> 'collect_sin', 'false'::jsonb, 'admin A turns SIN collection off');
select is(public.reveal_professional_private(current_setting('test.p2')::uuid, 'sin'), '130692544', 'collect_sin off: the stored SIN still reveals');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p2')::uuid, '046454286', private.test_seen(current_setting('test.p2')::uuid)) $$,
  'P0001', 'La collecte du NAS n''est pas activée.', 'collect_sin off: a new SIN is refused');
select lives_ok($$ select public.clear_professional_private_field(current_setting('test.p2')::uuid, 'sin') $$, 'collect_sin off: the SIN can be cleared');
select is((select sin_last3 from public.get_professional_private(current_setting('test.p2')::uuid)), null, '… and is gone');
select is(public.set_professionals_settings('{"collect_sin": true}') -> 'collect_sin', 'true'::jsonb, 'admin A turns SIN collection back on');
reset role;

-- =============================================================================
-- Redaction: no value, mask or ciphertext in audit_log
-- =============================================================================
select is((select count(*)::int from public.audit_log a, jsonb_each(a.changed_fields) f
            where a.table_name = 'professional_private' and a.record_id = current_setting('test.p1') and a.action = 'insert'
              and f.key in ('sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number', 'bank_institution',
                            'bank_transit', 'bank_account', 'bank_account_last4')
              and f.value = '"[redacted]"'), 9, 'the insert row redacts all nine value columns');
select is_empty($$ select a.id, f.key from public.audit_log a, jsonb_each(a.changed_fields) f
                    where a.table_name = 'professional_private' and a.action <> 'read'
                      and f.key in ('sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number', 'bank_institution',
                                    'bank_transit', 'bank_account', 'bank_account_last4')
                      and f.value <> '"[redacted]"' $$, 'no audit row of professional_private shows a value');
select ok((select count(*) from public.audit_log a where a.table_name = 'professional_private' and a.action = 'update') >= 4,
  'the updates are logged (as « [redacted] »)');
select is_empty($$ select a.id from public.audit_log a
                    where a.org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')
                      and a.changed_fields::text ~ '(046454286|130692544|1234567|123456789RT0001|1234567890TQ0001)' $$,
  'no plaintext number appears anywhere in the fixtures'' audit_log');

-- =============================================================================
-- Permissions
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_professional_private(current_setting('test.p1')::uuid) $$,
  '42501', 'Permission refusée : professionals.private', 'the adjointe cannot read the private data');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'sin') $$,
  '42501', 'Permission refusée : professionals.private', 'the adjointe cannot reveal');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, null, null, null, null) $$,
  '42501', 'Permission refusée : professionals.private', 'the adjointe cannot save the tax numbers');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, null, null, null, null) $$,
  '42501', 'Permission refusée : professionals.private', 'the adjointe cannot save the bank details');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046454286', null) $$,
  '42501', 'Permission refusée : professionals.private', 'the adjointe cannot save a SIN');
select throws_ok($$ select public.clear_professional_private_field(current_setting('test.p1')::uuid, 'sin') $$,
  '42501', 'Permission refusée : professionals.private', 'the adjointe cannot clear');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_professional_private(current_setting('test.p2')::uuid) $$,
  '42501', 'Permission refusée : professionals.private', 'the provider cannot read even their own private data');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p2')::uuid, 'sin') $$,
  '42501', 'Permission refusée : professionals.private', 'the provider cannot reveal');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p2')::uuid, null, null, null, null) $$,
  '42501', 'Permission refusée : professionals.private', 'the provider cannot save the tax numbers');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p2')::uuid, null, null, null, null) $$,
  '42501', 'Permission refusée : professionals.private', 'the provider cannot save the bank details');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p2')::uuid, '046454286', null) $$,
  '42501', 'Permission refusée : professionals.private', 'the provider cannot save a SIN');
select throws_ok($$ select public.clear_professional_private_field(current_setting('test.p2')::uuid, 'sin') $$,
  '42501', 'Permission refusée : professionals.private', 'the provider cannot clear');

-- Another clinic: admin B, with org A's ids.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.set_professionals_settings('{"collect_sin": true}') -> 'collect_sin', 'true'::jsonb, 'admin B turns SIN collection on in org B');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'sin') $$,
  'P0001', 'Professionnel introuvable.', 'admin B cannot reveal org A''s SIN');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account') $$,
  'P0001', 'Professionnel introuvable.', '… nor its account');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '987654321', null, null, null) $$,
  'P0001', 'Professionnel introuvable.', 'admin B cannot write org A''s tax numbers');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, null, null, null, null) $$,
  'P0001', 'Professionnel introuvable.', '… nor clear them with an all-blank save');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, null, null, null, null) $$,
  'P0001', 'Professionnel introuvable.', '… nor the bank details (all blank)');
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '001', '12345', '7777777', null) $$,
  'P0001', 'Professionnel introuvable.', '… nor a new account');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046454286', null) $$,
  'P0001', 'Professionnel introuvable.', '… nor a SIN');
select throws_ok($$ select public.clear_professional_private_field(current_setting('test.p1')::uuid, 'sin') $$,
  'P0001', 'Professionnel introuvable.', '… nor clear one');
reset role;
select results_eq($$ select pp.sin_last3, pp.business_number, pp.bank_institution, pp.bank_account_last4
                      from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('286'::text, '123456789'::text, '815'::text, '4567'::text) $$, 'org A''s row is untouched by admin B');

-- Module off: the permission disappears.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'sin') $$,
  '42501', 'Permission refusée : professionals.private', 'module off: no reveal');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- Key versions: one version per row during a rotation, unreadable kept values
-- =============================================================================
-- Version 2 key and canary (as postgres, as the rotation runbook's steps 1 and 3).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'pii_encryption_key_v2', 'test');
select ok(private.pii_seed_canary(2), 'rotation: version 2 gets its canary');
select is(private.pii_current_key_version(), 2, 'rotation: writes switch to version 2');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', '7654321',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'rotation: a new account while the SIN is kept');
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'sin'), '046454286', 'rotation: the kept SIN still reveals');
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account'), '7654321', 'rotation: the new account reveals');
reset role;
select is((select pp.key_version::int from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid),
  2, 'rotation: the row moves to version 2');
select is((select private.decrypt_pii(pp.sin, 2) = '046454286' from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid),
  true, 'rotation: the kept SIN was re-encrypted with version 2 in the same update');
select results_eq($$ select u.key_version, u.value_count from private.pii_key_versions_in_use() u where u.table_name = 'professional_private' $$,
  $$ values (2, 2::bigint) $$, 'rotation: the inventory shows professional_private on version 2 only');
select ok(public.pii_health_check(), 'rotation: the health check stays true');

-- The « Fiscalité » card re-encrypts both kept values (row back on version 1 by hand).
update public.professional_private
   set sin = private.encrypt_pii('046454286', 1), bank_account = private.encrypt_pii('7654321', 1), key_version = 1
 where professional_id = current_setting('test.p1')::uuid;
set local role authenticated;
select lives_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', '123456789RT0001', '1234567890TQ0001',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'rotation: a tax-number save on a version 1 row');
reset role;
select results_eq($$ select pp.key_version::int, private.decrypt_pii(pp.sin, 2), private.decrypt_pii(pp.bank_account, 2)
                      from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (2, '046454286'::text, '7654321'::text) $$, '… moves both encrypted values to version 2 in the same update');

-- A kept SIN that does not decrypt (written with another key, row left on version 1).
update public.professional_private
   set sin = extensions.pgp_sym_encrypt('000000000', 'not-this-environment-key'),
       bank_account = private.encrypt_pii('7654321', 1),
       key_version = 1
 where professional_id = current_setting('test.p1')::uuid;
select ok(not public.pii_health_check(), 'an unreadable SIN turns the health check false');
select set_config('test.audit_unreadable', (select coalesce(max(a.id), 0)::text from public.audit_log a), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_bank(current_setting('test.p1')::uuid, '815', '30000', '7654321',
  private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Le NAS enregistré ne peut pas être lu avec la clé de cet environnement.', 'a kept SIN that does not decrypt: clean P0001 (bank card)');
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', null, null,
  private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Le NAS enregistré ne peut pas être lu avec la clé de cet environnement.', '… and on the « Fiscalité » card');
select is(private.test_error_hint($$ select public.set_professional_bank('c0000000-0000-0000-0000-000000000001', null, null, '7654321',
  private.test_seen('c0000000-0000-0000-0000-000000000001')) $$),
  'Le NAS enregistré peut être retiré. Il ne peut être saisi de nouveau que si la collecte du NAS est activée.', '… with a hint');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'sin') $$,
  'P0001', 'Le NAS enregistré ne peut pas être lu avec la clé de cet environnement.', 'revealing it: the same clean P0001');
reset role;
select is_empty($$ select 1 from public.audit_log a where a.id > current_setting('test.audit_unreadable')::bigint
                     and a.table_name = 'professional_private' and a.action = 'read' $$,
  'an unreadable reveal writes no read row');
set local role authenticated;
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account'), '7654321', 'the readable account still reveals');
select lives_ok($$ select public.clear_professional_private_field(current_setting('test.p1')::uuid, 'sin') $$,
  'the unreadable SIN can be cleared (the account is re-encrypted)');
reset role;
select results_eq($$ select pp.key_version::int, pp.sin is null, pp.sin_last3 is null, private.decrypt_pii(pp.bank_account, 2)
                       from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (2, true, true, '7654321'::text) $$, '… leaving the row on version 2 with the account');
select ok(public.pii_health_check(), 'the health check is true again');

-- An unreadable SIN is replaced by a new one (the SIN card never reads the old one).
update public.professional_private
   set sin = extensions.pgp_sym_encrypt('000000000', 'not-this-environment-key'), sin_last3 = '000',
       bank_account = private.encrypt_pii('7654321', 1), key_version = 1
 where professional_id = current_setting('test.p1')::uuid;
set local role authenticated;
select lives_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046 454 286',
  private.test_seen(current_setting('test.p1')::uuid)) $$, 'a new SIN replaces an unreadable one');
reset role;
select results_eq($$ select pp.key_version::int, pp.sin_last3, private.decrypt_pii(pp.sin, 2), private.decrypt_pii(pp.bank_account, 2)
                      from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (2, '286'::text, '046454286'::text, '7654321'::text) $$, '… with the kept account re-encrypted to version 2');

-- A kept account whose key is missing (version 3 has no key): 55000 → clean P0001.
update public.professional_private set key_version = 3 where professional_id = current_setting('test.p1')::uuid;
set local role authenticated;
select throws_ok($$ select public.set_professional_tax_numbers(current_setting('test.p1')::uuid, '123456789', null, null,
  private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Le NAS enregistré ne peut pas être lu avec la clé de cet environnement.', 'a row whose key is missing: the SIN is named first');
select throws_ok($$ select public.set_professional_sin(current_setting('test.p1')::uuid, '046454286',
  private.test_seen(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement.', 'a kept account with no key: clean P0001');
select is(private.test_error_hint($$ select public.set_professional_sin('c0000000-0000-0000-0000-000000000001', '046454286',
  private.test_seen('c0000000-0000-0000-0000-000000000001')) $$),
  'Retirez le numéro de compte enregistré, ou saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.', '… with a hint that mentions clearing');
select throws_ok($$ select public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account') $$,
  'P0001', 'Le numéro de compte enregistré ne peut pas être lu avec la clé de cet environnement.', 'revealing it: the same clean P0001');
reset role;
update public.professional_private set key_version = 2 where professional_id = current_setting('test.p1')::uuid;

-- =============================================================================
-- History
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok((select count(*) from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_private' and h.action <> 'read') >= 4,
  'the adjointe''s history shows the private changes');
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_private' and h.action <> 'read' and h.changed_fields is not null),
  0, '… with changed_fields null');
select is((select array_agg(distinct h.changed_fields::text order by h.changed_fields::text)
             from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_private' and h.action = 'read'),
  array['{"fields": ["bank_account"]}', '{"fields": ["sin"]}'], 'reads keep their field names only');
reset role;
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields)
values ('b0000000-0000-0000-0000-00000000000a', 'professional_private', current_setting('test.p1'), 'read',
        '{"fields": ["sin"], "value": "046454286"}');
set local role authenticated;
select is((select h.changed_fields from public.list_professional_history(current_setting('test.p1')::uuid, null, 1) h),
  '{"fields": ["sin"]}'::jsonb, 'a read row never passes anything but its field names');
reset role;
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields)
values ('b0000000-0000-0000-0000-00000000000a', 'professional_private', current_setting('test.p1'), 'read',
        '{"fields": ["sin", "046454286", 42, {"sin": "046454286"}, ["bank_account"], null, "bank_account"]}');
set local role authenticated;
select is((select h.changed_fields from public.list_professional_history(current_setting('test.p1')::uuid, null, 1) h),
  '{"fields": ["sin", "bank_account"]}'::jsonb, '… and only the strings sin and bank_account among them');
reset role;
insert into public.audit_log (org_id, table_name, record_id, action, changed_fields)
values ('b0000000-0000-0000-0000-00000000000a', 'professional_private', current_setting('test.p1'), 'read',
        '{"fields": ["046454286"]}');
set local role authenticated;
select is((select h.changed_fields from public.list_professional_history(current_setting('test.p1')::uuid, null, 1) h),
  '{"fields": []}'::jsonb, '… an unknown name alone leaves an empty list');

-- The professional's deletion takes the private row with it, audited without values.
reset role;
delete from public.professionals where id = current_setting('test.p1')::uuid;
select is((select a.changed_fields ->> 'sin' from public.audit_log a
            where a.table_name = 'professional_private' and a.record_id = current_setting('test.p1') and a.action = 'delete'),
  '[redacted]', 'deleting the professional deletes the private row, redacted in the log');
select ok(public.pii_health_check(), 'the health check stays true at the end');

select * from finish();
rollback;
