-- Facturation, batch FQ part 2 (migration *_billing_qbo_push.sql): the push to QuickBooks — the
-- switch (paused by default), F2's outbox read event by event (an invoice, its payment waiting for
-- it, a missing map), the items and tax codes, the outcome and its backoff, « Réessayer », an
-- invoice's state, the professionals' bills (FPay), privileges.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('qbo_push_state_for_service', 'prepare_qbo_push_for_service', 'record_qbo_push_for_service',
                       'record_qbo_link_for_service', 'record_qbo_item_for_service', 'qbo_bills_to_push_for_service',
                       'record_qbo_vendor_for_service', 'replace_qbo_items', 'replace_qbo_tax_codes')
     and (not p.prosecdef or has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the push''s RPCs: SECURITY DEFINER, the service role only');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('set_qbo_push_paused', 'list_qbo_pushes', 'retry_qbo_push', 'qbo_invoice_push_status')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the user RPCs: SECURITY DEFINER, authenticated, not anon');
select table_privs_are('public', 'qbo_pushes', 'authenticated', array[]::text[], 'qbo_pushes: read through the RPCs only');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@qp.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@qp.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@qp.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@qp.test');
insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Psy', 'pro1@qp.test', 'active', 'female');

-- A connected company, its chart, its tax codes and one item (a service code GOrendezvous made).
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.conn', public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days')::text, true);
select public.replace_qbo_accounts('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"10","name":"Services","account_type":"Income","active":true},
  {"id":"11","name":"Ventes","account_type":"Income","active":true},
  {"id":"20","name":"Virement bancaire à recevoir","acct_num":"1075","account_type":"Other Current Asset","active":true},
  {"id":"23","name":"Compte courant","account_type":"Bank","active":true},
  {"id":"30","name":"Honoraires - Psychologues","account_type":"Expense","active":true}
]$j$);
select public.replace_qbo_tax_codes('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"4","name":"TPS/TVQ QC - 9,975","taxable":true,"active":true},
  {"id":"8","name":"Exonéré","taxable":false,"active":true},
  {"id":"9","name":"Hors champ","taxable":false,"active":true}
]$j$);
select is(public.replace_qbo_items('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"501","name":"10150 Consultation individuelle","sku":"10150","item_type":"Service","income_account_id":"10","active":true}
]$j$), 1, 'the items are read');
reset role;
select results_eq($$ select map_key, qbo_account_id, suggested from public.qbo_account_map
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and map_key like 'tax.%' order by 1 $$,
  $$ values ('tax.exempt', '8', true), ('tax.taxable', '4', true) $$, 'the tax codes suggested: « TPS/TVQ QC », « Exonéré »');

-- An invoice issued and paid in the app: F2 puts both in its outbox.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.inv', public.create_manual_invoice('d0000000-0000-0000-0000-000000000001')::text, true);
select public.add_invoice_line(current_setting('test.inv')::uuid, 'adjustment', null, 'Rédaction de rapport', 1, 8000, true);
select ok(public.finalize_invoice(current_setting('test.inv')::uuid) is not null, 'fixture: the invoice issued');
select set_config('test.total', (select total_cents::text from public.invoices where id = current_setting('test.inv')::uuid), true);
select set_config('test.pay', public.record_payment(current_setting('test.inv')::uuid, 'interac', current_setting('test.total')::int)::text, true);
reset role;
select set_config('test.pay_id', (select id::text from public.payments where invoice_id = current_setting('test.inv')::uuid), true);
select results_eq($$ select kind from public.billing_sync_events where org_id = 'b0000000-0000-0000-0000-00000000000a' order by id $$,
  $$ values ('invoice_issued'), ('payment_recorded') $$, 'fixture: F2''s outbox holds both');

-- =============================================================================
-- The switch: paused by default
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select (s ->> 'paused')::boolean, s ->> 'status' from public.qbo_push_state_for_service('b0000000-0000-0000-0000-00000000000a') s $$,
  $$ values (true, 'connected') $$, 'nothing is pushed until the clinic says so');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_qbo_push_paused(false) $$, '42501', null, 'the counselor does not switch it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_qbo_push_paused(false) $$, 'the admin starts the push (the go/no-go)');
reset role;
select is(private.qbo_push_paused('b0000000-0000-0000-0000-00000000000a'), false, '… no longer paused');

-- =============================================================================
-- The outbox, event by event
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_recorded',
            current_setting('test.pay_id')::uuid, current_setting('test.inv')::uuid) ->> 'reason',
  'invoice_not_pushed', 'a payment waits for its invoice');
select set_config('test.prep', public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice_issued',
  current_setting('test.inv')::uuid, current_setting('test.inv')::uuid)::text, true);
select results_eq($$ select p ->> 'action', p ->> 'push_kind', p -> 'payer' ->> 'first_name', p -> 'dossier' ->> 'last_name',
                            p ->> 'tax_taxable', p ->> 'tax_exempt', p ->> 'payer_customer_id'
                       from (select current_setting('test.prep')::jsonb p) x $$,
  $$ values ('push', 'invoice', 'Léa', 'Essai', '4', '8', null::text) $$,
  'an invoice to push: the payer and the dossier by name, the tax codes, no customer yet');
select results_eq($$ select l ->> 'item_id', l ->> 'income_account_id', (l ->> 'taxable')::boolean, (l ->> 'subtotal_cents')::int
                       from (select current_setting('test.prep')::jsonb -> 'lines' -> 0 l) x $$,
  $$ values (null::text, '10', true, 8000) $$, 'a line with no service code: an item to make on « Services », taxable');
select lives_ok($$ select public.record_qbo_link_for_service('b0000000-0000-0000-0000-00000000000a', 'payer',
  'd0000000-0000-0000-0000-000000000001', null, '700') $$, 'the payer''s parent made');
select lives_ok($$ select public.record_qbo_link_for_service('b0000000-0000-0000-0000-00000000000a', 'dossier',
  'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '701') $$, '… and the dossier''s sub-customer');
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice', current_setting('test.inv')::uuid,
  current_setting('test.inv')::uuid, 1, '900', '701', null), 'pushed', 'the invoice pushed');
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice_issued',
            current_setting('test.inv')::uuid, current_setting('test.inv')::uuid) ->> 'action', 'done',
  'never twice: the event is only closed');
select results_eq($$ select p ->> 'action', p ->> 'invoice_qbo_id', p ->> 'invoice_customer_id', p ->> 'deposit_account_id'
                       from (select public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_recorded',
                               current_setting('test.pay_id')::uuid, current_setting('test.inv')::uuid) p) x $$,
  $$ values ('push', '900', '701', '20') $$, 'then its payment: on the invoice, deposited to Interac''s account (1075)');

-- A failure waits (backoff), then « Réessayer ».
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment', current_setting('test.pay_id')::uuid,
  current_setting('test.inv')::uuid, 2, null, null, 'provider_error'), 'pending', 'a failure: tried again later');
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_recorded',
            current_setting('test.pay_id')::uuid, current_setting('test.inv')::uuid) ->> 'reason', 'backoff',
  '… not before its next try');
reset role;
select ok((select next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes'
             from public.qbo_pushes where entity_id = current_setting('test.pay_id')::uuid), '… five minutes later');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment', current_setting('test.pay_id')::uuid,
  current_setting('test.inv')::uuid, 2, null, null, 'provider_error') from generate_series(1, 7);
reset role;
select results_eq($$ select status, attempts from public.qbo_pushes where entity_id = current_setting('test.pay_id')::uuid $$,
  $$ values ('failed', 8) $$, 'eight tries: failed, it waits for a person');
select set_config('test.qp', (select id::text from public.qbo_pushes where entity_id = current_setting('test.pay_id')::uuid), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (r ->> 'paused')::boolean, (r -> 'counts' ->> 'pushed')::int, (r -> 'counts' ->> 'failed')::int,
                            r -> 'pushes' -> 0 ->> 'last_error_code'
                       from public.list_qbo_pushes() r $$,
  $$ values (false, 1, 1, 'provider_error') $$, '« Envois à QuickBooks »: the counts and what failed');
select lives_ok($$ select public.retry_qbo_push(current_setting('test.qp')::uuid) $$, '« Réessayer »');
reset role;
select results_eq($$ select status, next_attempt_at <= now() from public.qbo_pushes where entity_id = current_setting('test.pay_id')::uuid $$,
  $$ values ('pending', true) $$, '… tried at the next pass');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select r -> 'pushes' -> 0 ->> 'kind', r -> 'pushes' -> 0 ->> 'status' from public.qbo_invoice_push_status(current_setting('test.inv')::uuid) r $$,
  $$ values ('invoice', 'pushed') $$, 'the invoice''s page says it is in QuickBooks (billing.view)');
select throws_ok($$ select public.list_qbo_pushes() $$, '42501', null, 'the report is billing.settings''');

-- A mode without an account: the push says which line of the map is missing.
reset role;
update public.qbo_account_map set qbo_account_id = null, suggested = false
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and map_key = 'deposit.interac';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select p ->> 'action', p -> 'keys' ->> 0
                       from (select public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_recorded',
                               current_setting('test.pay_id')::uuid, current_setting('test.inv')::uuid) p) x $$,
  $$ values ('missing_map', 'deposit.interac') $$, 'a mode with no account: nothing pushed, the map named');
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_refunded',
            current_setting('test.pay_id')::uuid, current_setting('test.inv')::uuid) ->> 'action', 'gone',
  'a refund event that names no recorded refund: gone (refunds: 157)');

-- =============================================================================
-- The professionals' bills (FPay)
-- =============================================================================
reset role;
update public.qbo_account_map m set qbo_account_id = '30', suggested = false
  from public.profession_titles_catalog t
 where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.map_key = 'expense' and t.id = m.profession_title_id and t.key = 'psychologue';
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
select 'e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', u.bucket,
       'b0000000-0000-0000-0000-00000000000a/billing/c0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-000000000001.pdf',
       'billing', u.key, 'payout_period', 'c0000000-0000-0000-0000-000000000001', 'billing.payroll', 'facture.pdf',
       'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now()
  from public.upload_purposes u where u.key = 'billing_professional_invoice';
insert into public.payout_periods (id, org_id, professional_id, month, state, title_name, validated_at)
select 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
       date '2026-09-01', 'validated', t.name, now()
  from public.profession_titles_catalog t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.professional_invoices (id, org_id, period_id, source, file_id, number, issued_on, amount_cents)
values ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
        'uploaded', 'e0000000-0000-0000-0000-000000000001', 'HP-2026-09', date '2026-10-01', 345000);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select number, amount_cents, vendor_id, expense_account_id
                       from public.qbo_bills_to_push_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('HP-2026-09', 345000, null::text, '30') $$, 'a validated period''s invoice to bill, on her specialty''s account');
select lives_ok($$ select public.record_qbo_vendor_for_service('b0000000-0000-0000-0000-00000000000a',
  'c0000000-0000-0000-0000-000000000001', '800') $$, 'her vendor made');
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'bill', 'f1000000-0000-0000-0000-000000000001',
  null, null, '950', null, null), 'pushed', 'the bill pushed');
reset role;
select is((select qbo_bill_id from public.professional_invoices where id = 'f1000000-0000-0000-0000-000000000001'), '950',
  '… FPay''s invoice notes it');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is_empty($$ select 1 from public.qbo_bills_to_push_for_service('b0000000-0000-0000-0000-00000000000a') $$, '… and it is not listed again');
select throws_ok($$ select public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'bill', 'f1000000-0000-0000-0000-000000000001',
  null, null, '950', null, 'provider_error') $$, '22023', null, 'an outcome is an id or a code, not both');
reset role;

-- The tax codes in the map: only the company's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_qbo_account_map('tax.exempt', null, '9') $$, 'the admin chooses « Hors champ » for exempt lines');
select throws_ok($$ select public.set_qbo_account_map('tax.exempt', null, '77') $$, 'P0001',
  'Ce code de taxe n''existe plus dans QuickBooks. Synchronisez, puis choisissez-en un autre.', 'an unknown tax code is refused');
select is((select (s -> 'push' ->> 'paused')::boolean from public.get_qbo_settings() s), false, 'the settings show the switch');

select * from finish();
rollback;
