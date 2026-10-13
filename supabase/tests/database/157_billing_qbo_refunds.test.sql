-- Facturation, FQ follow-up (migration *_billing_qbo_refunds.sql): a refund (F3) goes to QuickBooks
-- as a journal entry once its payment is there (debit Accounts Receivable for the payment's
-- customer, credit the mode's deposit account), the chart without a receivable account names it,
-- a cancellation fee line keeps its text and finds its item by code (FQ-11, FQ-12).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('billing_refund_for_sync', 'qbo_receivable_account', 'qbo_line_kind_name')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u1@qr.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@qr.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@qr.test');

-- A connected company: its chart (with « Comptes clients »), its tax codes, the fee's item.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days');
select public.replace_qbo_accounts('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"10","name":"Services","account_type":"Income","active":true},
  {"id":"11","name":"Ventes","account_type":"Income","active":true},
  {"id":"12","name":"Comptes clients","account_type":"Accounts Receivable","account_sub_type":"AccountsReceivable","active":true},
  {"id":"20","name":"Virement bancaire à recevoir","acct_num":"1075","account_type":"Other Current Asset","active":true},
  {"id":"23","name":"Compte courant","account_type":"Bank","active":true}
]$j$);
select public.replace_qbo_tax_codes('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"4","name":"TPS/TVQ QC - 9,975","taxable":true,"active":true},
  {"id":"8","name":"Exonéré","taxable":false,"active":true}
]$j$);
select public.replace_qbo_items('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"530","name":"70300 Annulation tardive / absence - individuel","sku":"70300","item_type":"Service","income_account_id":"10","active":true}
]$j$);
reset role;

-- An invoice with a cancellation fee line, issued, then paid by Interac.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.inv', public.create_manual_invoice('d0000000-0000-0000-0000-000000000001')::text, true);
select set_config('test.line', public.add_invoice_line(current_setting('test.inv')::uuid, 'adjustment', null, 'Frais', 1, 5000, false)::text, true);
reset role;
update public.invoice_lines set line_type = 'cancellation_fee', service_code = 70300,
       description = 'Annulation tardive (50 %) — 12 octobre 2026'
 where id = current_setting('test.line')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.finalize_invoice(current_setting('test.inv')::uuid) is not null, 'fixture: the invoice issued');
select public.record_payment(current_setting('test.inv')::uuid, 'interac',
  (select total_cents from public.invoices where id = current_setting('test.inv')::uuid));
select set_config('test.pay', (select id::text from public.payments where invoice_id = current_setting('test.inv')::uuid), true);
select set_config('test.refund', public.refund_payment(current_setting('test.pay')::uuid, 2000, 'Trop payé par erreur')::text, true);
reset role;
select results_eq($$ select kind from public.billing_sync_events where org_id = 'b0000000-0000-0000-0000-00000000000a' order by id $$,
  $$ values ('invoice_issued'), ('payment_recorded'), ('payment_refunded') $$, 'fixture: F3 put the refund in the outbox');

-- =============================================================================
-- The fee line (FQ-12)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select l ->> 'line_type', l ->> 'item_id', l ->> 'description', l ->> 'income_account_id'
                       from (select public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice_issued',
                               current_setting('test.inv')::uuid, current_setting('test.inv')::uuid) -> 'lines' -> 0 l) x $$,
  $$ values ('cancellation_fee', '530', 'Annulation tardive (50 %) — 12 octobre 2026', '10') $$,
  'a cancellation fee: the item of its code (70300), its own text, « Services »');
reset role;
select is(private.qbo_line_kind_name('cancellation_fee'), 'Frais d''annulation', 'a fee line without a service is named plainly');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- =============================================================================
-- The refund (FQ-11)
-- =============================================================================
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_refunded',
            current_setting('test.refund')::uuid, current_setting('test.inv')::uuid) ->> 'reason',
  'payment_not_pushed', 'a refund waits for its payment');
select public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'invoice', current_setting('test.inv')::uuid,
  current_setting('test.inv')::uuid, 1, '900', '701', null);
select public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment', current_setting('test.pay')::uuid,
  current_setting('test.inv')::uuid, 2, '901', '701', null);
select set_config('test.prep', public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_refunded',
  current_setting('test.refund')::uuid, current_setting('test.inv')::uuid)::text, true);
select results_eq($$ select p ->> 'action', p ->> 'push_kind', p ->> 'invoice_customer_id', p ->> 'receivable_account_id',
                            p ->> 'deposit_account_id', (p -> 'refund' ->> 'amount_cents')::int, p -> 'refund' ->> 'invoice_number' is not null
                       from (select current_setting('test.prep')::jsonb p) x $$,
  $$ values ('push', 'refund', '701', '12', '20', 2000, true) $$,
  'then pushed: on the payment''s customer, Accounts Receivable and Interac''s deposit account');
reset role;
select is((current_setting('test.prep')::jsonb -> 'refund' ->> 'refunded_on')::date, private.billing_today('b0000000-0000-0000-0000-00000000000a'),
  '… dated the clinic''s day of the refund');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'refund', current_setting('test.refund')::uuid,
  current_setting('test.inv')::uuid, 3, '902', '701', null), 'pushed', 'a refund is a kind of push');
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_refunded',
            current_setting('test.refund')::uuid, current_setting('test.inv')::uuid) ->> 'action', 'done', 'never twice');
select is(public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_refunded',
            gen_random_uuid(), current_setting('test.inv')::uuid) ->> 'action', 'gone', 'a refund that is not (or no longer) recorded: gone');

-- A chart without a receivable account: the push names it, nothing sent.
reset role;
delete from public.qbo_pushes where kind = 'refund';
update public.qbo_accounts set active = false where qbo_id = '12';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$ select p ->> 'action', p -> 'keys' ->> 0
                       from (select public.prepare_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'payment_refunded',
                               current_setting('test.refund')::uuid, current_setting('test.inv')::uuid) p) x $$,
  $$ values ('missing_map', 'receivable') $$, 'no Accounts Receivable account: named, nothing pushed');
reset role;
select throws_ok($$ insert into public.qbo_pushes (org_id, kind, entity_id) values ('b0000000-0000-0000-0000-00000000000a', 'refund_receipt', gen_random_uuid()) $$,
  '23514', null, 'the kinds stay a closed list');

select * from finish();
rollback;
