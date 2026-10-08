-- Professionnels: encrypted private data and compensation terms (migration
-- *_professionals_compensation_private.sql, plan Phase 4 Task 4a.17).
-- Covers: privileges (table, RPCs, helpers, over pg_proc); the three card saves
-- (set_professional_tax_numbers, set_professional_bank, set_professional_sin: encryption at rest,
-- masks, collect_sin, Luhn, normalisation, validation messages that never repeat a value, blank
-- keeps the account and clears the plain fields, a card never touches another card's fields,
-- optimistic concurrency with HINT stale); reveal (audited read rows with the field name only,
-- nothing stored → null and no row, an unreadable value writes none); clear; collect_sin off
-- (reveal and clear allowed, a new SIN refused); audit redaction of every value column and no
-- plaintext anywhere in audit_log; permissions (adjointe, provider, conseillère, module off,
-- another clinic with org A's ids on every RPC); the history (private rows without values, reads
-- by known field name only, compensation rows for compensation holders only); key versions
-- (pii_encrypted_values, one version per row during a rotation on every card, the clean P0001
-- for an unreadable kept value, the health check); compensation (kinds, seeded defaults and rules,
-- dated margins and levels, date bounds, warning, overlaps, the four deletes and their windows,
-- the read model, isolation, the provider refused).
-- Plaintexts are only compared, never stored outside the RPCs' own writes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(269);

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

select table_privs_are('public', 'compensation_kinds',        'authenticated', array['SELECT'], 'authenticated: select only on compensation_kinds');
select table_privs_are('public', 'compensation_defaults',     'authenticated', array['SELECT'], 'authenticated: select only on compensation_defaults');
select table_privs_are('public', 'professional_compensation', 'authenticated', array['SELECT'], 'authenticated: select only on professional_compensation');
select table_privs_are('public', 'recognition_rules',         'authenticated', array['SELECT'], 'authenticated: select only on recognition_rules');
select table_privs_are('public', 'professional_recognition',  'authenticated', array['SELECT'], 'authenticated: select only on professional_recognition');
select is_empty($$
  select t from unnest(array['compensation_kinds', 'compensation_defaults', 'professional_compensation',
                             'recognition_rules', 'professional_recognition']) t
   where has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
$$, 'anon: no privileges on the compensation tables');

-- The fifteen RPCs: EXECUTE for authenticated only (never anon, PUBLIC or service_role).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('get_professional_private', 'reveal_professional_private', 'set_professional_tax_numbers',
                                'set_professional_bank', 'set_professional_sin', 'clear_professional_private_field',
                                'set_compensation_default', 'delete_compensation_default', 'set_professional_margin',
                                'delete_professional_margin', 'set_recognition_rule', 'delete_recognition_rule',
                                'set_professional_recognition', 'delete_professional_recognition', 'get_professional_compensation')),
  15, 'the fifteen RPCs exist, none overloaded');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_professional_private', 'reveal_professional_private', 'set_professional_tax_numbers',
                       'set_professional_bank', 'set_professional_sin', 'clear_professional_private_field',
                       'set_compensation_default', 'delete_compensation_default', 'set_professional_margin',
                       'delete_professional_margin', 'set_recognition_rule', 'delete_recognition_rule',
                       'set_professional_recognition', 'delete_professional_recognition', 'get_professional_compensation')
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
select function_privs_are('public', 'delete_recognition_rule', array['uuid'], 'service_role', array[]::text[], 'service_role cannot delete a rule');
select function_privs_are('public', 'delete_professional_recognition', array['uuid'], 'anon', array[]::text[], 'anon cannot delete a level');
select hasnt_function('public', 'set_professional_private', 'the whole-form save is gone (one RPC per card, P4-148)');

-- Helpers: granted to no role.
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('is_valid_sin', 'raise_unreadable_private_value', 'unreadable_private_field', 'assert_private_not_stale',
                       'seed_professionals_compensation', 'seed_professionals_compensation_on_org',
                       'assert_compensation_access', 'assert_compensation_kind', 'compensation_note',
                       'assert_compensation_date', 'assert_starts_after',
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
select lives_ok($$ select private.assert_compensation_date('2000-01-01', 'x'), private.assert_compensation_date('2100-12-31', 'x'),
                         private.assert_compensation_date(null, 'x') $$, 'date bounds: 2000-01-01 and 2100-12-31 pass, null is left to the caller');

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
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p1')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'module off: no compensation');
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

-- =============================================================================
-- Compensation: catalogue and seeded terms
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select k.key, k.name from public.compensation_kinds k order by k.sort_order $$,
  $$ values ('consultation'::text, 'Consultation'::text), ('workshop', 'Atelier'), ('late_cancellation', 'Annulation tardive'), ('other_fees', 'Autres frais') $$,
  'the four kinds, in order');
select results_eq($$ select d.kind, d.margin_min_pct, d.margin_max_pct, d.effective_from, d.effective_to
                      from public.compensation_defaults d order by d.kind $$,
  $$ values ('consultation'::text, 25.00::numeric, 30.00::numeric, '2017-01-01'::date, null::date),
            ('late_cancellation', 30.00, 30.00, '2017-01-01', null),
            ('other_fees', 15.00, 15.00, '2017-01-01', null),
            ('workshop', 25.00, 25.00, '2017-01-01', null) $$,
  'org A is seeded with the legacy default ranges (and sees only its own)');
select results_eq($$ select r.effective_from, r.effective_to, r.step_sessions, r.bonus_per_50min_cents, r.bonus_per_30min_cents, r.cap_pct, r.cap_basis
                      from public.recognition_rules r $$,
  $$ values ('2017-01-01'::date, null::date, 50, 50, 25, 25.00::numeric, 'unconfirmed'::text) $$,
  'org A is seeded with the recognition rule (cap basis unconfirmed, P4-8)');
reset role;
select is((select count(*)::int from public.compensation_defaults d where d.org_id = 'b0000000-0000-0000-0000-00000000000b'), 4,
  'org B has its own defaults');
select is((select count(*)::int from public.audit_log a where a.org_id = 'b0000000-0000-0000-0000-00000000000a'
            and a.table_name in ('compensation_defaults', 'recognition_rules') and a.source = 'seed:professionals_compensation'), 5,
  'the seeded rows are audited as the seed');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.compensation_kinds), 0, 'the conseillère reads no kinds (RLS)');
select is((select count(*)::int from public.compensation_defaults), 0, 'the conseillère reads no defaults');
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p1')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the conseillère cannot read the terms');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 28, '2026-11-01', null) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the conseillère cannot set a margin');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_compensation_default('consultation', 20, 30, '2027-01-01') $$,
  '42501', 'Permission refusée : professionals.compensation', 'the adjointe cannot change a default');
select throws_ok($$ select public.set_professional_recognition(current_setting('test.p1')::uuid, 1, 60, '2026-10-01', null) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the adjointe cannot set a level');

-- =============================================================================
-- Margins
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.m1', (public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 28, '2026-11-01', null)) ->> 'id', true);
select is((select c.margin_pct from public.professional_compensation c where c.id = current_setting('test.m1')::uuid), 28.00::numeric,
  'a margin is stored');
select is(public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 29, '2027-01-01', 'Renouvellement') ->> 'warning',
  'false', 'a margin inside the default range: no warning');
select is((select c.effective_to from public.professional_compensation c where c.id = current_setting('test.m1')::uuid), '2027-01-01'::date,
  'the next margin closes the open one on its start date');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 27, '2027-01-01', null) $$,
  'P0001', 'La nouvelle marge doit commencer après le 2027-01-01.', 'a margin must start after the open one');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', -1, '2027-06-01', null) $$,
  'P0001', 'La marge est comprise entre 0 et 100 %.', 'a negative margin is refused');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 101, '2027-06-01', null) $$,
  'P0001', 'La marge est comprise entre 0 et 100 %.', 'a margin above 100 % is refused');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 30, null, null) $$,
  'P0001', 'La date d''entrée en vigueur est requise.', 'a start date is required');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 30, 'infinity', null) $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'an infinite start date is refused');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 30, '0044-03-15 BC', null) $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'a BC start date is refused');
select is(private.test_error_hint($$ select public.set_professional_margin('c0000000-0000-0000-0000-000000000001', 'consultation', 30, '20270-01-01', null) $$),
  'effective_from', '… a five-digit year too, with the HINT effective_from');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'tips', 30, '2027-06-01', null) $$,
  '22023', 'Type de rémunération inconnu.', 'an unknown kind is refused');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p3')::uuid, 'consultation', 30, '2027-06-01', null) $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is not found');
select is(public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 35, '2027-06-01', null) ->> 'warning',
  'true', 'a margin outside the default range is stored with a warning');
select is(public.set_professional_margin(current_setting('test.p1')::uuid, 'workshop', 25, '2026-11-01', ' Atelier   de groupe ') ->> 'warning',
  'false', 'a margin equal to a one-value range: no warning');
select is((select c.note from public.professional_compensation c where c.professional_id = current_setting('test.p1')::uuid and c.kind = 'workshop'),
  'Atelier de groupe', 'the note is tidied');

reset role;
select throws_ok($$ insert into public.professional_compensation (org_id, professional_id, kind, margin_pct, effective_from)
                    values ('b0000000-0000-0000-0000-00000000000a', current_setting('test.p1')::uuid, 'consultation', 20, '2026-12-01') $$,
  '23P01', null, 'overlapping margins are refused by the exclusion constraint');
select throws_ok($$ insert into public.compensation_defaults (org_id, kind, margin_min_pct, margin_max_pct, effective_from)
                    values ('b0000000-0000-0000-0000-00000000000a', 'consultation', 20, 30, '2020-01-01') $$,
  '23P01', null, 'overlapping default ranges are refused too');

-- Deletes: only the open row, only before it is in force or within 24 hours of its creation.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.delete_professional_margin(current_setting('test.m1')::uuid) $$,
  'P0001', 'Seule la dernière marge peut être supprimée.', 'a closed margin cannot be deleted');
select lives_ok($$ select public.delete_professional_margin((select c.id from public.professional_compensation c
                     where c.professional_id = current_setting('test.p1')::uuid and c.kind = 'consultation' and c.effective_to is null)) $$,
  'the open (future) margin is deleted');
select results_eq($$ select c.margin_pct, c.effective_to from public.professional_compensation c
                      where c.professional_id = current_setting('test.p1')::uuid and c.kind = 'consultation' and c.effective_from = '2027-01-01' $$,
  $$ values (29.00::numeric, null::date) $$, '… and the previous one is open again');
select set_config('test.m_past', (public.set_professional_margin(current_setting('test.p1')::uuid, 'other_fees', 15, (current_date - 30), null)) ->> 'id', true);
reset role;
update public.professional_compensation set created_at = now() - interval '2 days' where id = current_setting('test.m_past')::uuid;
set local role authenticated;
select throws_ok($$ select public.delete_professional_margin(current_setting('test.m_past')::uuid) $$,
  'P0001', 'Une marge déjà en vigueur ne peut pas être supprimée.', 'a margin in force for more than 24 hours stays');
select set_config('test.m_fresh', (public.set_professional_margin(current_setting('test.p1')::uuid, 'late_cancellation', 30, (current_date - 10), null)) ->> 'id', true);
select lives_ok($$ select public.delete_professional_margin(current_setting('test.m_fresh')::uuid) $$,
  'a margin in force, created under 24 hours ago, can be deleted (typo window)');
select is((select count(*)::int from public.professional_compensation c
            where c.professional_id = current_setting('test.p1')::uuid and c.kind = 'late_cancellation'), 0, '… and is gone');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.delete_professional_margin(current_setting('test.m1')::uuid) $$,
  'P0001', 'Marge introuvable.', 'admin B cannot delete org A''s margin');

-- Default ranges.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_compensation_default('consultation', 31, 30, (current_date + 400)) $$,
  'P0001', 'La marge minimale ne peut pas dépasser la marge maximale.', 'min above max is refused');
select throws_ok($$ select public.set_compensation_default('consultation', 20, 101, (current_date + 400)) $$,
  'P0001', 'La marge est comprise entre 0 et 100 %.', 'max above 100 % is refused');
select throws_ok($$ select public.set_compensation_default('consultation', 20, 30, '2017-01-01') $$,
  'P0001', 'La nouvelle fourchette doit commencer après le 2017-01-01.', 'a range must start after the open one');
select set_config('test.d_new', public.set_compensation_default('consultation', 26, 31, (current_date + 400))::text, true);
select results_eq($$ select d.margin_min_pct, d.margin_max_pct, d.effective_to from public.compensation_defaults d
                      where d.kind = 'consultation' order by d.effective_from $$,
  $$ values (25.00::numeric, 30.00::numeric, (current_date + 400)), (26.00, 31.00, null) $$,
  'a new range closes the open one');
select lives_ok($$ select public.delete_compensation_default(current_setting('test.d_new')::uuid) $$, 'a future range is deleted');
select is((select count(*)::int from public.compensation_defaults d where d.kind = 'consultation' and d.effective_to is null), 1,
  '… and the previous one is open again');
select throws_ok($$ select public.delete_compensation_default((select d.id from public.compensation_defaults d where d.kind = 'consultation')) $$,
  'P0001', 'La première fourchette d''un type ne peut pas être supprimée.', 'the first range of a kind stays');
select throws_ok($$ select public.set_compensation_default('consultation', 25, 30, '2101-01-01') $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'a range starting after 2100 is refused');
select set_config('test.d_fresh', public.set_compensation_default('workshop', 25, 26, (current_date - 10))::text, true);
select lives_ok($$ select public.delete_compensation_default(current_setting('test.d_fresh')::uuid) $$,
  'a range in force, created under 24 hours ago, is deleted (typo window)');
select set_config('test.d_old', public.set_compensation_default('workshop', 25, 27, (current_date - 10))::text, true);
reset role;
update public.compensation_defaults set created_at = now() - interval '2 days' where id = current_setting('test.d_old')::uuid;
set local role authenticated;
select throws_ok($$ select public.delete_compensation_default(current_setting('test.d_old')::uuid) $$,
  'P0001', 'Une fourchette déjà en vigueur ne peut pas être supprimée.', 'a range in force for more than 24 hours stays');

-- =============================================================================
-- Recognition
-- =============================================================================
select set_config('test.r1', public.set_professional_recognition(current_setting('test.p1')::uuid, 2, 117, '2026-10-01', 'Compté dans GOrendezvous')::text, true);
select results_eq($$ select r.level, r.sessions_counted, r.effective_from, r.note from public.professional_recognition r
                      where r.id = current_setting('test.r1')::uuid $$,
  $$ values (2, 117, '2026-10-01'::date, 'Compté dans GOrendezvous'::text) $$, 'a recognition level is stored');
select lives_ok($$ select public.set_professional_recognition(current_setting('test.p1')::uuid, 3, 160, '2027-01-01', null) $$, 'a later level');
select is((select r.effective_to from public.professional_recognition r where r.id = current_setting('test.r1')::uuid), '2027-01-01'::date,
  '… closes the open one');
select throws_ok($$ select public.set_professional_recognition(current_setting('test.p1')::uuid, 4, 210, '2026-12-01', null) $$,
  'P0001', 'Le nouveau niveau doit commencer après le 2027-01-01.', 'a level must start after the open one');
select throws_ok($$ select public.set_professional_recognition(current_setting('test.p1')::uuid, -1, 0, '2027-06-01', null) $$,
  'P0001', 'Le niveau est compris entre 0 et 1 000.', 'a negative level is refused');
select throws_ok($$ select public.set_recognition_rule(50, 50, 25, 25, 'guess', '2027-01-01', null) $$,
  '22023', 'Base du plafond inconnue.', 'an unknown cap basis is refused');
select throws_ok($$ select public.set_recognition_rule(50, 50, 25, 101, 'unconfirmed', '2027-01-01', null) $$,
  'P0001', 'Le plafond est compris entre 0 et 100 %.', 'a cap above 100 % is refused');
select throws_ok($$ select public.set_recognition_rule(0, 50, 25, 25, 'unconfirmed', '2027-01-01', null) $$,
  'P0001', 'Le palier compte de 1 à 1 000 séances.', 'a step of 0 sessions is refused');
select throws_ok($$ select public.set_recognition_rule(50, 50, 25, 25, 'unconfirmed', '1999-12-31', null) $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'a rule starting before 2000 is refused');
select throws_ok($$ select public.set_professional_recognition(current_setting('test.p1')::uuid, 1, 1, '-infinity', null) $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'a level starting at -infinity is refused');
select lives_ok($$ select public.set_recognition_rule(50, 60, 30, 25, 'margin_reduction', '2027-01-01', 'Confirmé par la comptable') $$,
  'a new rule');
select results_eq($$ select r.effective_to, r.cap_basis from public.recognition_rules r order by r.effective_from $$,
  $$ values ('2027-01-01'::date, 'unconfirmed'::text), (null::date, 'margin_reduction'::text) $$, '… closes the seeded one');
select set_config('test.rule_seed', (select r.id::text from public.recognition_rules r where r.effective_from = '2017-01-01'), true);

-- =============================================================================
-- get_professional_compensation
-- =============================================================================
select set_config('test.on_dec', public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-12-01')::text, true);
select is((select m from jsonb_array_elements(current_setting('test.on_dec')::jsonb -> 'margins') m where m ->> 'kind' = 'consultation')
            - 'id' - 'name' - 'note',
  '{"kind": "consultation", "source": "professional", "margin_pct": 28, "min": 25, "max": 30, "effective_from": "2026-11-01"}'::jsonb,
  'on 2026-12-01: the professional''s consultation margin, with the default range');
select is((select m from jsonb_array_elements(current_setting('test.on_dec')::jsonb -> 'margins') m where m ->> 'kind' = 'late_cancellation')
            - 'name',
  '{"kind": "late_cancellation", "source": "default", "margin_pct": null, "min": 30, "max": 30, "effective_from": "2017-01-01", "id": null, "note": null}'::jsonb,
  '… the default range where the professional has none');
select is((select array_agg(m ->> 'kind' order by ord) from jsonb_array_elements(current_setting('test.on_dec')::jsonb -> 'margins') with ordinality as x(m, ord)),
  array['consultation', 'workshop', 'late_cancellation', 'other_fees'], '… every kind, in catalogue order');
select is((current_setting('test.on_dec')::jsonb -> 'recognition') - 'id' - 'rule',
  '{"level": 2, "sessions_counted": 117, "effective_from": "2026-10-01", "note": "Compté dans GOrendezvous"}'::jsonb,
  '… the recognition level in force');
select is((current_setting('test.on_dec')::jsonb -> 'recognition' -> 'rule') - 'id',
  '{"step_sessions": 50, "bonus_per_50min_cents": 50, "bonus_per_30min_cents": 25, "cap_pct": 25, "cap_basis": "unconfirmed", "effective_from": "2017-01-01"}'::jsonb,
  '… with the rule in force (cap basis unconfirmed)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2027-02-01') #>> '{recognition,level}', '3',
  'on 2027-02-01: the later level');
select is((select m ->> 'margin_pct' from jsonb_array_elements(public.get_professional_compensation(current_setting('test.p1')::uuid, '2027-02-01') -> 'margins') m
            where m ->> 'kind' = 'consultation'), '29.00', '… and the later margin');
select is((select m ->> 'source' from jsonb_array_elements(public.get_professional_compensation(current_setting('test.p2')::uuid) -> 'margins') m
            where m ->> 'kind' = 'consultation'), 'default', 'P2 today: the default range');
select is(public.get_professional_compensation(current_setting('test.p2')::uuid) #> '{recognition,level}', 'null'::jsonb,
  'P2 has no level (the rule is still given)');
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p3')::uuid) $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is not found');
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p1')::uuid, 'infinity') $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'the read model refuses an infinite date');
select is(private.test_error_hint($$ select public.get_professional_compensation('c0000000-0000-0000-0000-000000000001', '0001-01-01 BC') $$),
  'on', '… and a BC date, with the HINT on');

-- Isolation: admin B.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_compensation c where c.professional_id = current_setting('test.p1')::uuid), 0,
  'admin B sees none of org A''s margins');
select is((select count(*)::int from public.professional_recognition r where r.professional_id = current_setting('test.p1')::uuid), 0,
  'admin B sees none of org A''s levels');
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p1')::uuid) $$,
  'P0001', 'Professionnel introuvable.', 'admin B cannot read org A''s terms');
select is((select d.margin_min_pct from public.compensation_defaults d where d.kind = 'consultation'), 25.00::numeric,
  'admin B''s own default is untouched by org A''s changes');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p1')::uuid, 'consultation', 30, '2027-06-01', null) $$,
  'P0001', 'Professionnel introuvable.', 'admin B cannot set org A''s margin');
select throws_ok($$ select public.set_professional_recognition(current_setting('test.p1')::uuid, 1, 1, '2027-06-01', null) $$,
  'P0001', 'Professionnel introuvable.', 'admin B cannot set org A''s level');
select throws_ok($$ select public.delete_professional_recognition(current_setting('test.r1')::uuid) $$,
  'P0001', 'Niveau introuvable.', 'admin B cannot delete org A''s level');
select throws_ok($$ select public.delete_compensation_default(current_setting('test.d_old')::uuid) $$,
  'P0001', 'Fourchette introuvable.', 'admin B cannot delete org A''s range');
select throws_ok($$ select public.delete_recognition_rule(current_setting('test.rule_seed')::uuid) $$,
  'P0001', 'Règle introuvable.', 'admin B cannot delete org A''s rule');

-- The provider (professionals.self): no compensation at all, not even their own.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select (select count(*) from public.compensation_kinds) + (select count(*) from public.compensation_defaults)
                + (select count(*) from public.professional_compensation) + (select count(*) from public.recognition_rules)
                + (select count(*) from public.professional_recognition))::int,
  0, 'the provider reads none of the five compensation tables (RLS)');
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p2')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot read their own terms');
select throws_ok($$ select public.set_professional_margin(current_setting('test.p2')::uuid, 'consultation', 20, '2027-06-01', null) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot set a margin');
select throws_ok($$ select public.delete_professional_margin(current_setting('test.m1')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot delete a margin');
select throws_ok($$ select public.set_professional_recognition(current_setting('test.p2')::uuid, 5, 300, '2027-06-01', null) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot set a level');
select throws_ok($$ select public.delete_professional_recognition(current_setting('test.r1')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot delete a level');
select throws_ok($$ select public.set_compensation_default('consultation', 10, 20, '2027-06-01') $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot change a default');
select throws_ok($$ select public.delete_compensation_default(current_setting('test.d_old')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot delete a default');
select throws_ok($$ select public.set_recognition_rule(10, 100, 50, 50, 'fee_increase', '2027-06-01', null) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot change a rule');
select throws_ok($$ select public.delete_recognition_rule(current_setting('test.rule_seed')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot delete a rule');

-- =============================================================================
-- Deleting recognition rows (P4-145): only the open one, within the window
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
reset role;
select set_config('test.audit_rec', (select coalesce(max(a.id), 0)::text from public.audit_log a), true);
set local role authenticated;
select throws_ok($$ select public.delete_professional_recognition(current_setting('test.r1')::uuid) $$,
  'P0001', 'Seul le dernier niveau peut être supprimé.', 'a closed level cannot be deleted');
select lives_ok($$ select public.delete_professional_recognition((select r.id from public.professional_recognition r
                     where r.professional_id = current_setting('test.p1')::uuid and r.effective_to is null)) $$,
  'the open (future) level is deleted');
select is((select r.effective_to from public.professional_recognition r where r.id = current_setting('test.r1')::uuid), null,
  '… and the previous one is open again');
select lives_ok($$ select public.delete_professional_recognition(current_setting('test.r1')::uuid) $$,
  'the first level may go too (created under 24 hours ago)');
select set_config('test.r_fresh', public.set_professional_recognition(current_setting('test.p1')::uuid, 1, 40, (current_date - 10), null)::text, true);
select lives_ok($$ select public.delete_professional_recognition(current_setting('test.r_fresh')::uuid) $$,
  'a level in force, created under 24 hours ago, can be deleted (typo window)');
select set_config('test.r_old', public.set_professional_recognition(current_setting('test.p1')::uuid, 1, 45, (current_date - 10), null)::text, true);
reset role;
update public.professional_recognition set created_at = now() - interval '2 days' where id = current_setting('test.r_old')::uuid;
set local role authenticated;
select throws_ok($$ select public.delete_professional_recognition(current_setting('test.r_old')::uuid) $$,
  'P0001', 'Un niveau déjà en vigueur ne peut pas être supprimé.', 'a level in force for more than 24 hours stays');
select throws_ok($$ select public.delete_professional_recognition('00000000-0000-0000-0000-000000000000') $$,
  'P0001', 'Niveau introuvable.', 'an unknown level is not found');

select throws_ok($$ select public.delete_recognition_rule(current_setting('test.rule_seed')::uuid) $$,
  'P0001', 'Seule la dernière règle peut être supprimée.', 'a closed rule cannot be deleted');
select lives_ok($$ select public.delete_recognition_rule((select r.id from public.recognition_rules r where r.effective_to is null)) $$,
  'the open (future) rule is deleted');
select is((select r.effective_to from public.recognition_rules r where r.id = current_setting('test.rule_seed')::uuid), null,
  '… and the seeded one is open again');
select throws_ok($$ select public.delete_recognition_rule(current_setting('test.rule_seed')::uuid) $$,
  'P0001', 'La première règle du programme ne peut pas être supprimée.', 'the first rule stays');
select set_config('test.rule_a', public.set_recognition_rule(50, 50, 25, 25, 'unconfirmed', (current_date - 10), null)::text, true);
select set_config('test.rule_b', public.set_recognition_rule(50, 55, 25, 25, 'unconfirmed', (current_date - 5), null)::text, true);
select lives_ok($$ select public.delete_recognition_rule(current_setting('test.rule_b')::uuid) $$,
  'a rule in force, created under 24 hours ago, is deleted (typo window)');
select is((select r.effective_to from public.recognition_rules r where r.id = current_setting('test.rule_a')::uuid), null,
  '… reopening the previous one');
reset role;
update public.recognition_rules set created_at = now() - interval '2 days' where id = current_setting('test.rule_a')::uuid;
set local role authenticated;
select throws_ok($$ select public.delete_recognition_rule(current_setting('test.rule_a')::uuid) $$,
  'P0001', 'Une règle déjà en vigueur ne peut pas être supprimée.', 'a rule in force for more than 24 hours stays');
select throws_ok($$ select public.delete_recognition_rule('00000000-0000-0000-0000-000000000000') $$,
  'P0001', 'Règle introuvable.', 'an unknown rule is not found');
reset role;
select results_eq($$ select a.table_name, count(*)::int from public.audit_log a
                      where a.id > current_setting('test.audit_rec')::bigint and a.action = 'delete'
                        and a.actor_id = 'a0000000-0000-0000-0000-000000000001'
                        and a.table_name in ('recognition_rules', 'professional_recognition')
                      group by 1 order by 1 $$,
  $$ values ('professional_recognition'::text, 3), ('recognition_rules', 2) $$,
  'each deletion is audited, by its author');
select is((select a.changed_fields ->> 'level' from public.audit_log a
            where a.table_name = 'professional_recognition' and a.action = 'delete'
              and a.record_id = current_setting('test.p1') || ':' || current_setting('test.r_fresh')),
  '1', 'a deleted level keeps its values in the log (P4-149)');
set local role authenticated;

-- =============================================================================
-- Compensation in the history and the audit
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((select count(*) from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_compensation' and h.action = 'insert') >= 4,
  'the admin''s history shows the margins');
select ok(exists (select 1 from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
                   where h.table_name = 'professional_recognition'),
  '… and the recognition levels');
select is((select h.record_id from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_compensation' and h.action = 'insert' and h.changed_fields ->> 'id' = current_setting('test.m1')),
  current_setting('test.p1') || ':' || current_setting('test.m1'), 'a margin''s record id starts with the professional');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name in ('professional_compensation', 'professional_recognition')),
  0, 'the adjointe''s history leaves the compensation out');
select ok((select count(*) from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name = 'professional_private') > 0, '… but shows the private rows (without values)');

-- The professional's deletion takes the private row with it, audited without values.
reset role;
delete from public.professionals where id = current_setting('test.p1')::uuid;
select is((select a.changed_fields ->> 'sin' from public.audit_log a
            where a.table_name = 'professional_private' and a.record_id = current_setting('test.p1') and a.action = 'delete'),
  '[redacted]', 'deleting the professional deletes the private row, redacted in the log');
select ok(public.pii_health_check(), 'the health check stays true at the end');

select * from finish();
rollback;
