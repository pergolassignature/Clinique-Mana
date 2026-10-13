-- Facturation, batch FQ part 1 (migration *_billing_quickbooks.sql), on F1's module: the
-- QuickBooks connection (encrypted tokens, one company per clinic, rotation), the chart of
-- accounts with Christine's defaults, the customers read and matched with Clients' rules, the
-- report and its decisions, Clients' merge and anonymisation handlers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(94);

-- =============================================================================
-- Fixtures (as postgres): org A (billing on; admin 01, counselor 02), org B (admin 05).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@fq.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@fq.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@fq.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@fq.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('services'), ('billing')) m(key);
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Martin', null, '+15145550101'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Roy', 'chloe@exemple.test', null),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Alice', 'Tremblay', 'alice@exemple.test', null);

-- =============================================================================
-- Registry and privileges
-- =============================================================================
select is((select count(*)::int from public.modules where key = 'billing'), 1, 'the billing module is registered (F1)');
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'billing' order by 1 $$,
  $$ values ('appointments'), ('clients'), ('professionals'), ('services') $$, 'it depends on F1''s four modules');
select results_eq($$ select role from public.role_permissions where permission_key = 'billing.settings' order by 1 $$,
  $$ values ('admin') $$, 'billing.settings: the admin by default');
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': authenticated reads only')
  from (values ('qbo_connections'), ('qbo_accounts'), ('qbo_account_map'), ('qbo_customers'), ('qbo_customer_matches'), ('qbo_links')) t(name);
select table_privs_are('public', 'qbo_connection_tokens', r.role, array[]::text[], 'qbo_connection_tokens: nothing for ' || r.role)
  from (values ('anon'), ('authenticated'), ('service_role')) r(role);
select is_empty($$ select 1 from pg_policies where schemaname = 'public' and tablename = 'qbo_connection_tokens' $$,
  'the tokens have no policy: the service RPCs are the only path');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('store_qbo_connection', 'disconnect_qbo_connection', 'get_qbo_credentials', 'set_qbo_tokens',
                       'set_qbo_connection_status', 'finish_qbo_sync', 'replace_qbo_accounts', 'upsert_qbo_customers',
                       'prune_qbo_customers', 'match_qbo_customers')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the service RPCs: service_role only');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('get_qbo_settings', 'set_qbo_account_map', 'qbo_customer_match_counts', 'list_qbo_customer_matches',
                       'decide_qbo_customer_match')
     and (not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the user RPCs: authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and (p.proname like 'qbo\_%' or p.proname like 'billing\_%')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the module''s private helpers are granted to no role');
select results_eq($$ select function_name from public.client_merge_handlers where module_key = 'billing' $$,
  $$ values ('private.billing_reassign_client') $$, 'a merge handler is registered');
select results_eq($$ select function_name from public.client_anonymize_handlers where module_key = 'billing' $$,
  $$ values ('private.billing_anonymize_client') $$, 'an anonymisation handler is registered');
select results_eq($$ select is_maintenance, kind, function_name from public.scheduled_jobs where key = 'billing.qbo_token_refresh' $$,
  $$ values (true, 'function', 'qbo-token-refresh') $$, 'the keep-alive job: a maintenance function job');

-- =============================================================================
-- The connection, as the service role (the functions)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.store_qbo_connection('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days') $$,
  '42501', null, 'the counselor (no billing.settings) cannot connect');
select throws_ok($$ select public.store_qbo_connection('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days') $$,
  '42501', null, 'nor an admin of another clinic');
select throws_ok($$ select public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  'abc', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', null) $$,
  '22023', null, 'a realm is digits');
select set_config('test.conn', public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days')::text, true);
reset role;
select ok((select t.access_token <> convert_to('acc-1', 'UTF8') and t.refresh_token <> convert_to('ref-1', 'UTF8')
             and position(convert_to('ref-1', 'UTF8') in t.refresh_token) = 0
             from public.qbo_connection_tokens t where t.connection_id = current_setting('test.conn')::uuid),
  'the tokens are stored encrypted');
select is((select count(*)::int from private.pii_encrypted_values() where table_name = 'qbo_connection_tokens'), 2,
  'both token columns are in the encrypted-values list');
select ok((select d like '%organization_bank_details%' and d like '%professional_private%'
                 and d like '%professional_submission_private%' and d like '%mail_connection_tokens%'
            from (select pg_catalog.pg_get_functiondef('private.pii_encrypted_values()'::regprocedure) d) x),
  'the list keeps the other modules'' columns');
select is((select bool_or(changed_fields::text like '%acc-1%' or changed_fields::text like '%ref-1%')
             from audit_log where table_name = 'qbo_connection_tokens'), false,
  'the journal never holds a token');
set local role service_role;
select results_eq($$ select realm_id, environment, access_token, refresh_token from public.get_qbo_credentials('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('123145', 'sandbox', 'acc-1', 'ref-1') $$, 'get_qbo_credentials decrypts for the functions');
select is_empty($$ select 1 from public.get_qbo_credentials('b0000000-0000-0000-0000-00000000000b') $$, 'another clinic has none');
select throws_ok($$ select public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '999999', 'sandbox', 'Autre', 'acc-x', 'ref-x', now() + interval '1 hour', null) $$,
  'P0001', 'La clinique est déjà reliée à une autre entreprise QuickBooks. Déconnectez-la d''abord.',
  'another company while connected: refused');
select is(public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', null, 'acc-2', 'ref-2', now() + interval '1 hour', now() + interval '100 days'),
  current_setting('test.conn')::uuid, 'the same company reconnects on the same row');

-- Rotation: a refresh records the new pair only when it used the stored refresh token.
select is(public.set_qbo_tokens('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'ref-1',
  'acc-3', 'ref-3', now() + interval '1 hour', now() + interval '100 days'), false,
  'a refresh with a refresh token already rotated is not written');
select is(public.set_qbo_tokens('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'ref-2',
  'acc-3', 'ref-3', now() + interval '1 hour', now() + interval '99 days'), true, 'the right one is');
select results_eq($$ select access_token, refresh_token from public.get_qbo_credentials('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('acc-3', 'ref-3') $$, '… both tokens rotated');
select lives_ok($$ select public.set_qbo_connection_status('b0000000-0000-0000-0000-00000000000a', 'needs_reconnect', 'invalid_grant') $$,
  'Intuit refused a refresh: needs_reconnect');
reset role;
select results_eq($$ select status, status_reason from public.qbo_connections where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('needs_reconnect', 'invalid_grant') $$, '… with its reason');
set local role service_role;
select is(public.set_qbo_tokens('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'ref-3',
  'acc-4', 'ref-4', now() + interval '1 hour', now() + interval '100 days'), true, 'a later refresh that works …');
reset role;
select results_eq($$ select status from public.qbo_connections where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('connected') $$, '… puts it back to connected');

-- =============================================================================
-- The chart of accounts and Christine's defaults
-- =============================================================================
set local role service_role;
select set_config('test.psy', (select id::text from public.profession_titles_catalog
                                where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'psychologue'), true);
select ok(current_setting('test.psy') <> '', 'fixture: the clinic''s psychologist title');
select lives_ok($$ select public.replace_qbo_accounts('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"10","name":"Services","account_type":"Income","classification":"Revenue","active":true},
  {"id":"11","name":"Ventes","account_type":"Income","classification":"Revenue","active":true},
  {"id":"20","name":"Virement bancaire à recevoir","acct_num":"1075","account_type":"Other Current Asset","active":true},
  {"id":"21","name":"Banque Stripe","acct_num":"1070","account_type":"Bank","active":true},
  {"id":"22","name":"Fonds non déposés","account_type":"Other Current Asset","account_sub_type":"UndepositedFunds","active":true},
  {"id":"23","name":"Compte courant","account_type":"Bank","active":true},
  {"id":"30","name":"Honoraires - Psychologues","account_type":"Expense","active":true},
  {"id":"31","name":"Services aux entreprises","account_type":"Expense","active":true},
  {"id":"99","name":"Ancien","account_type":"Income","active":false}
]$j$) $$, 'the accounts are read');
reset role;
select results_eq($$
  select map_key, qbo_account_id, suggested from public.qbo_account_map
   where org_id = 'b0000000-0000-0000-0000-00000000000a' and map_key <> 'expense' order by map_key
$$, $$ values ('deposit.bank_transfer', '23', true), ('deposit.cheque', '23', true), ('deposit.interac', '20', true),
              ('deposit.qbo_payments_card', '22', true), ('deposit.stripe', '21', true),
              ('revenue.file_opening', '11', true), ('revenue.services', '10', true) $$,
  'Christine''s defaults: 1075, 1070, « Fonds non déposés », « Compte courant », « Services », « Ventes »');
select is((select qbo_account_id from public.qbo_account_map where profession_title_id = current_setting('test.psy')::uuid), '30',
  'an expense account by specialty, by the title''s name');
select is_empty($$ select 1 from public.qbo_account_map where map_key = 'deposit.credit_note' $$,
  'a credit note lands no money: no deposit account (F1''s is_deposit = false)');
select ok((select count(*) from public.qbo_account_map where org_id = 'b0000000-0000-0000-0000-00000000000a' and map_key = 'expense')
          = (select count(*) from public.profession_titles_catalog where org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'one expense row per active title');

-- A person's choice is final; the type must fit; a vanished account is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_qbo_account_map('deposit.cheque', null, '21') $$, 'the admin chooses another account');
select throws_ok($$ select public.set_qbo_account_map('revenue.services', null, '21') $$,
  'P0001', 'Ce type de compte ne convient pas à cette ligne.', 'a bank account is not revenue');
select throws_ok($$ select public.set_qbo_account_map('revenue.services', null, '99') $$,
  'P0001', 'Ce compte n''existe plus dans QuickBooks. Synchronisez, puis choisissez-en un autre.', 'an inactive account is refused');
select throws_ok($$ select public.set_qbo_account_map('expense', null, '30') $$, '22023', null, 'an expense names a title');
select throws_ok($$ select public.set_qbo_account_map('deposit.credit_note', null, '21') $$, '22023', null,
  'only a payment mode that lands money has a deposit account');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select public.replace_qbo_accounts('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"10","name":"Services","account_type":"Income","active":true},
  {"id":"11","name":"Ventes","account_type":"Income","active":true},
  {"id":"21","name":"Banque Stripe","acct_num":"1070","account_type":"Bank","active":true},
  {"id":"23","name":"Compte courant","account_type":"Bank","active":true}
]$j$) $$, 'a later read without 1075');
reset role;
select results_eq($$ select map_key, qbo_account_id, suggested from public.qbo_account_map
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' and map_key in ('deposit.cheque', 'deposit.interac') order by 1 $$,
  $$ values ('deposit.cheque', '21', false), ('deposit.interac', null::text, false) $$,
  'the choice stays; a suggestion whose account is gone is emptied');
select is((select count(*)::int from public.qbo_accounts where connection_id = current_setting('test.conn')::uuid), 4,
  'the accounts not in the chart any more are removed');

-- =============================================================================
-- The customers and their matching (Clients' rules)
-- =============================================================================
set local role service_role;
select set_config('test.started', now()::text, true);
select is(public.upsert_qbo_customers('b0000000-0000-0000-0000-00000000000a', now(), $j$[
  {"id":"501","display_name":"Alice Tremblay","given_name":"Alice","family_name":"Tremblay","email":"Alice@Exemple.test","hash":"h1"},
  {"id":"502","display_name":"Robert Gagnon","given_name":"Robert","family_name":"Gagnon","phones":["(514) 555-0101"],"hash":"h2"},
  {"id":"503","display_name":"Chloé Roy","hash":"h3"},
  {"id":"504","display_name":"Entreprise XYZ","company_name":"Entreprise XYZ","hash":"h4"},
  {"id":"505","display_name":"Alice Tremblay (2)","given_name":"Alice","family_name":"Tremblay","email":"alice@exemple.test","hash":"h5"},
  {"id":"506","display_name":"N° 1 · Alice T.","is_job":true,"parent_id":"501","email":"alice@exemple.test","hash":"h6"}
]$j$), 6, 'six customers read, all to match');
select is(public.match_qbo_customers('b0000000-0000-0000-0000-00000000000a', 2), 2, 'matching runs in pages');
select is(public.match_qbo_customers('b0000000-0000-0000-0000-00000000000a'), 4, '… until done');
select is(public.match_qbo_customers('b0000000-0000-0000-0000-00000000000a'), 0, '… then nothing is left');
reset role;
select results_eq($$
  select qbo_id, status, level, client_id::text from public.qbo_customer_matches
   where connection_id = current_setting('test.conn')::uuid order by qbo_id
$$, $$ values ('501', 'linked', 'high', 'd0000000-0000-0000-0000-000000000001'),
              ('502', 'to_decide', 'medium', null),
              ('503', 'no_match', 'none', null),
              ('504', 'no_match', 'none', null),
              ('505', 'to_decide', 'high', null),
              ('506', 'no_match', 'none', null) $$,
  'HIGH → linked; a shared phone under another name → à décider; a name alone, a company or a sub-customer → nothing; a second customer of a linked client → à décider');
select results_eq($$ select candidate_client_ids from public.qbo_customer_matches where qbo_id = '502' $$,
  $$ values (array['d0000000-0000-0000-0000-000000000002'::uuid]) $$, 'the candidate is kept for the report');
select results_eq($$ select kind, payer_client_id::text, qbo_customer_id, source from public.qbo_links
                     where connection_id = current_setting('test.conn')::uuid $$,
  $$ values ('payer', 'd0000000-0000-0000-0000-000000000001', '501', 'matched') $$,
  'the linked customer is the payer''s parent customer');

-- An unchanged customer is not matched again; a changed one is.
set local role service_role;
select is(public.upsert_qbo_customers('b0000000-0000-0000-0000-00000000000a', now(), $j$[
  {"id":"501","display_name":"Alice Tremblay","given_name":"Alice","family_name":"Tremblay","email":"alice@exemple.test","hash":"h1"},
  {"id":"504","display_name":"Entreprise XYZ inc.","company_name":"Entreprise XYZ","hash":"h4b"}
]$j$), 1, 'a read of the same customers: only the changed one is to match');

-- =============================================================================
-- The report and its decisions, as the admin
-- =============================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select status, customers from public.qbo_customer_match_counts() order by status $$,
  $$ values ('ignored', 0::bigint), ('linked', 1::bigint), ('no_match', 3::bigint), ('to_decide', 2::bigint) $$, 'the counts per status');
select results_eq($$ select qbo_id, client->>'display_name' from public.list_qbo_customer_matches('linked') $$,
  $$ values ('501', 'Alice Tremblay') $$, 'the linked list names the file');
select results_eq($$ select qbo_id, jsonb_array_length(candidates), candidates->0->>'display_name'
                     from public.list_qbo_customer_matches('to_decide') where qbo_id = '502' $$,
  $$ values ('502', 1, 'Bruno Martin') $$, 'à décider: the candidates with their name');
select results_eq($$ select qbo_id from public.list_qbo_customer_matches('no_match', 'chloe') $$,
  $$ values ('503') $$, 'the search folds accents');
select throws_ok($$ select public.decide_qbo_customer_match('505', 'link', 'd0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Ce dossier est déjà rattaché à un autre client QuickBooks.', 'one customer per file');
select throws_ok($$ select public.decide_qbo_customer_match('502', 'link', 'd0000000-0000-0000-0000-000000000009') $$,
  'P0001', 'Ce dossier client n''existe pas ou a été fusionné.', 'another clinic''s file is refused');
select is(public.decide_qbo_customer_match('502', 'link', 'd0000000-0000-0000-0000-000000000002'), 'linked', 'the admin links 502 to Bruno');
select is(public.decide_qbo_customer_match('505', 'ignore'), 'ignored', 'and ignores 505');
reset role;
select results_eq($$ select qbo_id, source, decided_by::text from public.qbo_customer_matches where qbo_id in ('502', '505') order by 1 $$,
  $$ values ('502', 'manual', 'a0000000-0000-0000-0000-000000000001'), ('505', 'manual', 'a0000000-0000-0000-0000-000000000001') $$,
  'decisions are the admin''s, recorded');
select is((select count(*)::int from public.qbo_links where qbo_customer_id = '502' and payer_client_id = 'd0000000-0000-0000-0000-000000000002'), 1,
  'a manual link is a payer link too');

-- A changed customer keeps a person's decision.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.upsert_qbo_customers('b0000000-0000-0000-0000-00000000000a', now(), $j$[
  {"id":"502","display_name":"Robert Gagnon","given_name":"Robert","family_name":"Gagnon","phones":["514 555 9999"],"hash":"h2b"}
]$j$), 1, '502 changed in QuickBooks');
select is(public.match_qbo_customers('b0000000-0000-0000-0000-00000000000a'), 2, 'matched again (502 and 504)');
reset role;
select results_eq($$ select status, client_id::text from public.qbo_customer_matches where qbo_id = '502' $$,
  $$ values ('linked', 'd0000000-0000-0000-0000-000000000002') $$, 'the manual link stands');

-- Reset: back to the automatic match.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.decide_qbo_customer_match('505', 'reset'), 'to_decide', 'reset: 505 is « à décider » again');

-- Other people read nothing.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.get_qbo_settings() $$, '42501', null, 'the counselor cannot read the settings');
select throws_ok($$ select * from public.list_qbo_customer_matches('linked') $$, '42501', null, '… nor the report');
select is((select count(*)::int from public.qbo_connections) + (select count(*)::int from public.qbo_customers)
          + (select count(*)::int from public.qbo_customer_matches) + (select count(*)::int from public.qbo_links)
          + (select count(*)::int from public.qbo_accounts) + (select count(*)::int from public.qbo_account_map), 0,
  '… nor any table');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select get_qbo_settings()->'connection') , 'null'::jsonb, 'another clinic''s admin sees no connection');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((select (s->'connection'->>'company_name') = 'Clinique A' and s::text not like '%acc-4%' and s::text not like '%ref-4%'
             from public.get_qbo_settings() s), 'the admin reads the connection, never a token');

-- =============================================================================
-- Pruning, merge and anonymisation
-- =============================================================================
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.prune_qbo_customers('b0000000-0000-0000-0000-00000000000a', now() + interval '1 second'), 4,
  'a full read that saw none of them: the unlinked customers go, the payers'' stay');
reset role;
select results_eq($$ select qbo_id from public.qbo_customers where connection_id = current_setting('test.conn')::uuid order by 1 $$,
  $$ values ('501'), ('502') $$, '… 501 and 502 kept (billed under them later)');

select is(private.billing_reassign_client('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003') > 0, true,
  'a merge of Bruno into Chloé …');
select results_eq($$ select client_id::text from public.qbo_customer_matches where qbo_id = '502' $$,
  $$ values ('d0000000-0000-0000-0000-000000000003') $$, '… moves the match');
select is((select payer_client_id::text from public.qbo_links where qbo_customer_id = '502'), 'd0000000-0000-0000-0000-000000000003',
  '… and the payer link');
select is(private.billing_anonymize_client('d0000000-0000-0000-0000-000000000001'), 1, 'an anonymisation of Alice …');
select results_eq($$ select display_name, email, given_name from public.qbo_customers where qbo_id = '501' $$,
  $$ values ('(anonymisé)', null::text, null::text) $$, '… blanks this app''s copy of her customer');

-- =============================================================================
-- Disconnect, then another company
-- =============================================================================
set local role service_role;
select is(public.disconnect_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'), true, 'disconnected');
select is(public.disconnect_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'), false, 'once');
select is_empty($$ select 1 from public.get_qbo_credentials('b0000000-0000-0000-0000-00000000000a') $$, 'no credentials once disconnected');
reset role;
select is((select count(*)::int from public.qbo_connection_tokens), 0, 'the tokens are deleted');
select is((select count(*)::int from public.qbo_customer_matches where connection_id = current_setting('test.conn')::uuid), 2,
  'the matches stay (a reconnection to the same company keeps them)');
set local role service_role;
select is(public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '777777', 'production', 'Clinique A (réelle)', 'acc-p', 'ref-p', now() + interval '1 hour', now() + interval '100 days'),
  current_setting('test.conn')::uuid, 'after disconnecting, another company may be connected');
reset role;
select is((select count(*)::int from public.qbo_customers where connection_id = current_setting('test.conn')::uuid)
          + (select count(*)::int from public.qbo_links where connection_id = current_setting('test.conn')::uuid)
          + (select count(*)::int from public.qbo_accounts where connection_id = current_setting('test.conn')::uuid), 0,
  '… the former company''s customers, links and accounts are gone');
select is((select count(*)::int from public.qbo_account_map where org_id = 'b0000000-0000-0000-0000-00000000000a' and qbo_account_id is not null), 0,
  '… and the map emptied');

-- Module off: the RPCs refuse.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.get_qbo_settings() $$, '42501', null, 'module off: the settings are closed');

select * from finish();
rollback;
