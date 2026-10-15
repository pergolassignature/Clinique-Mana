-- Demandes and Facturation (migrations *_billing_source_hooks, *_demandes_waitlist_fee_invoice):
-- « Facturer l'inscription ». Covers: privileges; Facturation disabled → refused; the invoice (the
-- registration service, taxable, the dossier's payer, issued and sent; P3-40: the email held while
-- reserved); twice → refused once; the entry follows its invoice
-- (paid → paid and active; refunded → invoiced, still active; credited → back to « À facturer »).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select function_privs_are('public', 'invoice_waitlist_fee', array['uuid'], 'authenticated', array['EXECUTE'], 'invoice_waitlist_fee: authenticated');
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('billing_create_waitlist_fee_invoice', array['uuid', 'uuid', 'uuid', 'uuid']),
               ('demandes_waitlist_billing_changed', array['uuid', 'uuid', 'uuid', 'text'])) as x(f, a);
select results_eq($$ select module_key, function_name from public.billing_source_hooks where source_type = 'waitlist_fee' $$,
  $$ values ('demandes'::text, 'private.demandes_waitlist_billing_changed'::text) $$, 'Demandes'' hook is registered');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@wf.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@wf.test',  '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@wf.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@wf.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('demandes'), ('appointments')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Attente', 'alice@wf.test');
select set_config('test.psy', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order, key limit 1), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000001"}')::text, true);
select set_config('test.e', (public.register_waitlist(current_setting('test.d')::uuid,
  format('[{"title_id": "%s"}]', current_setting('test.psy'))::jsonb))[1]::text, true);
select throws_ok(format($$ select public.invoice_waitlist_fee(%L) $$, current_setting('test.e')),
  'P0001', 'La Facturation n''est pas activée : notez les frais à la main (payés ou exonérés).', 'Facturation disabled: refused');
reset role;
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'billing', true);
-- Facturation reserved for its testers: the invoice is made, its email held (P3-40).
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
insert into public.org_module_testers (org_id, module_key, user_id) values ('b0000000-0000-0000-0000-00000000000a', 'billing', 'a0000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.invoice_waitlist_fee(current_setting('test.e')::uuid) ->> 'number' ~ '^[0-9]{4}-1$', '« Facturer l''inscription »: the year''s first number');
select throws_ok(format($$ select public.invoice_waitlist_fee(%L) $$, current_setting('test.e')),
  'P0001', 'Les frais de cette inscription ne sont pas « À facturer ».', 'a second click: refused');
reset role;
select set_config('test.i', (select fee_invoice_id::text from public.waitlist_entries where id = current_setting('test.e')::uuid), true);
select results_eq($$ select fee_status, state from public.waitlist_entries where id = current_setting('test.e')::uuid $$,
  $$ values ('invoiced'::text, 'incomplete'::text) $$, 'the entry holds its invoice');
select results_eq($$ select l.service_code, l.unit_price_cents, l.tax_rule, i.status, i.source_type, i.payer_client_id, i.total_cents > l.unit_price_cents
                       from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where i.id = current_setting('test.i')::uuid $$,
  $$ values (50100, 1891, 'taxable'::text, 'issued'::text, 'waitlist_fee'::text, 'd0000000-0000-0000-0000-000000000001'::uuid, true) $$,
  'the registration service, 18,91 $ plus taxes, issued to the dossier''s payer');
select is((select count(*)::int from public.invoices where source_type = 'waitlist_fee' and source_id = current_setting('test.e')::uuid), 1, 'one invoice');
select is((select count(*)::int from public.billing_deliveries where invoice_id = current_setting('test.i')::uuid and kind = 'invoice' and send_email), 1,
  'sent to the payer');
select ok(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25) is not null, 'the delivery claimed');
select is(public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a',
            (select id from public.billing_deliveries where invoice_id = current_setting('test.i')::uuid)) ->> 'skip_reason',
  'reserved', 'P3-40: its email held while Facturation is reserved');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';

-- Paid: the entry is paid and, its consent not required, active.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.total', (select total_cents::text from public.invoices where id = current_setting('test.i')::uuid), true);
select public.record_payment(current_setting('test.i')::uuid, 'interac', current_setting('test.total')::int);
reset role;
select results_eq($$ select fee_status, state from public.waitlist_entries where id = current_setting('test.e')::uuid $$,
  $$ values ('paid'::text, 'active'::text) $$, 'paid: the fee paid, the entry active');
-- The hook again for `paid` (idempotent).
select lives_ok(format($$ select private.demandes_waitlist_billing_changed('b0000000-0000-0000-0000-00000000000a', %L, %L, 'paid') $$,
  current_setting('test.e'), current_setting('test.i')), 'the hook twice');
select results_eq($$ select fee_status, state from public.waitlist_entries where id = current_setting('test.e')::uuid $$,
  $$ values ('paid'::text, 'active'::text) $$, '… nothing more');
-- Refunded: back to invoiced, the promotion stays (a person decides).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.refund_payment((select id from public.payments where invoice_id = current_setting('test.i')::uuid),
  current_setting('test.total')::int, 'Inscription annulée');
reset role;
select results_eq($$ select fee_status, state from public.waitlist_entries where id = current_setting('test.e')::uuid $$,
  $$ values ('invoiced'::text, 'active'::text) $$, 'refunded: invoiced again, still active');
-- Credited: back to « À facturer », free to invoice again.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.issue_credit_note(current_setting('test.i')::uuid, 'Frais exonérés');
reset role;
select results_eq($$ select fee_status, fee_invoice_id is null from public.waitlist_entries where id = current_setting('test.e')::uuid $$,
  $$ values ('to_invoice'::text, true) $$, 'credited: « À facturer » again');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.invoice_waitlist_fee(current_setting('test.e')::uuid) ->> 'number' ~ '^[0-9]{4}-2$', 'invoiced again: the next number');
reset role;

select * from finish();
rollback;
