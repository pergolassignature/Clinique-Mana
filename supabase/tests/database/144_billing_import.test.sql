-- Facturation, the GOrendezvous import I3 (migrations *_clients_import_match, *_services_code_lookup,
-- *_billing_import): import_invoice. Covers: privileges; the dossier by its name (any order,
-- accents) or its reference, not found and two homonyms `unmatched`; a dry run writes nothing;
-- the invoice as exported (number without its zeros, its date, its lines with the service by
-- code, taxes, payments by mode, a refund recorded, what is paid); nothing sent (no delivery, no
-- QuickBooks event, no receipt); the year's numbering after it; a re-run `skipped`; lines that do
-- not make the total, an unknown mode, an overpayment refused in French; never reminded nor
-- blocking a booking.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select function_privs_are('public', 'import_invoice', array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], 'import_invoice: authenticated');
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('clients_import_match', array['uuid', 'text', 'text']), ('clients_import_name_key', array['text', 'text']),
               ('service_id_by_code', array['uuid', 'integer'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@bi.test',  '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cons@bi.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@bi.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@bi.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Marie-Ève', 'Tremblay', 'me@bi.test', 'gorendezvous:101'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Luc', 'Homonyme', null, 'gorendezvous:102'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Luc', 'Homonyme', null, 'gorendezvous:103'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Pas', 'Importé', null, null);
-- « Relances à partir du » long ago: the import must still never be reminded.
insert into public.billing_settings (org_id, dunning_from) values ('b0000000-0000-0000-0000-00000000000a', '2020-01-01')
on conflict (org_id) do update set dunning_from = excluded.dunning_from;

select set_config('test.row', $${
  "gorendezvous_number": "2025-0001234", "issued_on": "2025-03-04", "client_name": "TREMBLAY, Marie Eve",
  "subtotal_cents": 10000, "gst_cents": 500, "qst_cents": 998, "total_cents": 11498,
  "lines": [
    {"service_code": "10150", "description": "Consultation individuelle", "quantity": 1, "unit_price_cents": 10000,
     "gst_cents": 500, "qst_cents": 998, "total_cents": 11498}
  ],
  "payments": [
    {"paid_on": "2025-03-04", "mode_code": "qbo_payments_card", "amount_cents": 10000},
    {"paid_on": "2025-03-10", "mode_code": "bank_transfer", "amount_cents": 1498}
  ],
  "refunds": [{"paid_on": "2025-03-20", "amount_cents": 1000}]
}$$, true);

-- Privileges: the conseillère has no billing.manage.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.import_invoice(current_setting('test.row')::jsonb, true) $$, '42501', null, 'the conseillère: refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_invoice(current_setting('test.row')::jsonb, true) ->> 'status', 'ok', 'a dry run: ok');
reset role;
select is((select count(*)::int from public.invoices where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing written');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.import_invoice(current_setting('test.row')::jsonb, false)::text, true);
select is(current_setting('test.r')::jsonb ->> 'number', '2025-1234', 'imported: its number without the zeros');
reset role;
select set_config('test.i', current_setting('test.r')::jsonb ->> 'id', true);
select results_eq($$ select status, client_id, payer_client_id, issued_on, due_on, source_type, external_ref, total_cents, gst_cents, qst_cents,
                            (finalized_at at time zone 'America/Toronto')::date
                       from public.invoices where id = current_setting('test.i')::uuid $$,
  $$ values ('issued'::text, 'd0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid, date '2025-03-04',
             date '2025-03-04', 'import'::text, 'gorendezvous:2025-0001234'::text, 11498, 500, 998, date '2025-03-04') $$,
  'the dossier by its name (any order, accents), issued on its GOrendezvous date, its totals');
select results_eq($$ select l.line_type, l.service_code, l.service_id is not null, l.tax_rule, l.subtotal_cents, l.total_cents
                       from public.invoice_lines l where l.invoice_id = current_setting('test.i')::uuid $$,
  $$ values ('service'::text, 10150, true, 'taxable'::text, 10000, 11498) $$, 'its line: the service by its code, taxable');
select results_eq($$ select mode_code, amount_cents, external_ref from public.payments where invoice_id = current_setting('test.i')::uuid order by external_ref $$,
  $$ values ('qbo_payments_card'::text, 10000, 'gorendezvous:2025-0001234:1'::text), ('bank_transfer'::text, 1498, 'gorendezvous:2025-0001234:2'::text) $$,
  'its payments by mode (« Argent comptant » as the card), each with its reference');
select results_eq($$ select amount_cents, status from public.refunds where invoice_id = current_setting('test.i')::uuid $$,
  $$ values (1000, 'recorded'::text) $$, 'its refund, recorded');
select results_eq($$ select paid_cents, payment_status from public.invoices where id = current_setting('test.i')::uuid $$,
  $$ values (10498, 'partial'::text) $$, 'what is paid: the payments less the refund');
select is((select count(*)::int from public.billing_deliveries where invoice_id = current_setting('test.i')::uuid), 0, 'nothing sent (no delivery)');
select is((select count(*)::int from public.billing_sync_events where invoice_id = current_setting('test.i')::uuid), 0, 'no QuickBooks event');
select is((select count(*)::int from public.receipts where invoice_id = current_setting('test.i')::uuid), 0, 'no receipt');
select is((select last_number from public.invoice_sequences where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'invoice' and year = 2025),
  1234, 'the year''s numbering goes on after it');

-- Never reminded nor blocking a booking (unpaid, long past due).
select is(private.billing_run_dunning('b0000000-0000-0000-0000-00000000000a', '2026-10-13'), 0, 'never reminded');
select is(private.client_has_balance('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001'), false, 'never blocks a booking');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_invoice(current_setting('test.row')::jsonb, false) ->> 'status', 'skipped', 'a re-run: skipped');
-- The dossier: two homonyms, none, or the reference (the tool's --clients-map).
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0001300", "client_name": "Luc Homonyme"}', true) ->> 'reason',
  'client_ambiguous', 'two homonyms: unmatched');
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0001300", "client_name": "Pas Importé"}', true) ->> 'reason',
  'client_not_found', 'a file not imported: not found');
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0001300", "client_name": "Luc Homonyme", "client_ref": "gorendezvous:103"}', true) ->> 'status',
  'ok', 'the reference settles it');
-- Refusals, in French with their field.
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0001301", "total_cents": 11499, "subtotal_cents": 10001}', true) -> 'errors' -> 0 ->> 'message',
  'Les lignes ne font pas le total de la facture.', 'lines that do not make the total: refused');
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0001302", "payments": [{"paid_on": "2025-03-04", "mode_code": "bitcoin", "amount_cents": 100}], "refunds": []}', true)
            -> 'errors' -> 0 ->> 'message',
  'Paiement 1 : mode de paiement inconnu.', 'an unknown mode: refused');
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0001303", "payments": [{"paid_on": "2025-03-04", "mode_code": "interac", "amount_cents": 20000}], "refunds": []}', true)
            -> 'errors' -> 0 ->> 'message',
  'Les paiements dépassent le total de la facture.', 'an overpayment: refused');
reset role;

select * from finish();
rollback;
