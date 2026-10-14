-- Facturation, imported « Note de crédit » payments (migration *_billing_import_credit_notes.sql,
-- BI-27). Covers: import_invoice accepts mode credit_note, stored with its `gorendezvous:`
-- external_ref, counted in paid_cents (paid in full); no receipt, no QuickBooks event; no other path
-- creates one (record_payment refuses the mode, a row without the import's ref breaks the check);
-- refund_payment refuses it; billing_payment_for_sync never returns it (a QuickBooks push is
-- `gone`); an imported refund goes on a payment of its own mode first; the #171 guards (inactive
-- mode, future date) still hold for it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@cn.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@cn.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'ce@cn.test', 'gorendezvous:101');

select set_config('test.row', $${
  "gorendezvous_number": "2025-0000500", "issued_on": "2025-03-04", "client_ref": "gorendezvous:101",
  "subtotal_cents": 10000, "gst_cents": 0, "qst_cents": 0, "total_cents": 10000,
  "lines": [{"description": "Consultation", "quantity": 1, "unit_price_cents": 10000, "total_cents": 10000}],
  "payments": [
    {"paid_on": "2025-03-04", "mode_code": "interac", "amount_cents": 4000},
    {"paid_on": "2025-03-05", "mode_code": "credit_note", "amount_cents": 6000}
  ]
}$$, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.import_invoice(current_setting('test.row')::jsonb, false)::text, true);
select is(current_setting('test.r')::jsonb ->> 'status', 'ok', 'an invoice partly paid by « Note de crédit »: imported');
reset role;
select set_config('test.i', current_setting('test.r')::jsonb ->> 'id', true);
select set_config('test.cn', (select id::text from public.payments where invoice_id = current_setting('test.i')::uuid and mode_code = 'credit_note'), true);
select set_config('test.ia', (select id::text from public.payments where invoice_id = current_setting('test.i')::uuid and mode_code = 'interac'), true);
select is((select external_ref from public.payments where id = current_setting('test.cn')::uuid), 'gorendezvous:2025-0000500:2',
  '… the credit stored as a payment, marked by the import''s ref');
select results_eq($$ select paid_cents, payment_status from public.invoices where id = current_setting('test.i')::uuid $$,
  $$ values (10000, 'paid'::text) $$, '… it counts in paid_cents: paid in full, as in GOrendezvous');
select is((select count(*)::int from public.receipts where invoice_id = current_setting('test.i')::uuid), 0, '… no receipt');
select is((select count(*)::int from public.billing_sync_events where invoice_id = current_setting('test.i')::uuid), 0, '… no QuickBooks event');

-- QuickBooks never gets it, even if an event were queued: the payment's read is null (push `gone`).
select ok(private.billing_payment_for_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.cn')::uuid) is null,
  'billing_payment_for_sync: never the imported credit');
select ok(private.billing_payment_for_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.ia')::uuid) is not null,
  '… the Interac payment of the same invoice still is');

-- Never refundable.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format('select public.refund_payment(%L::uuid, 1000, %L)', current_setting('test.cn'), 'Erreur de saisie'),
  'P0001', 'Un crédit importé de GOrendezvous (note de crédit) ne se rembourse pas.', 'refund_payment: the imported credit is refused');
select lives_ok(format('select public.refund_payment(%L::uuid, 1000, %L)', current_setting('test.ia'), 'Erreur de saisie'),
  '… the Interac payment is still refundable');

-- No other path creates one.
select throws_ok(format('select public.record_payment(%L::uuid, %L, 100)', current_setting('test.i'), 'credit_note'),
  'P0001', 'Choisissez un mode de paiement.', 'record_payment: « Note de crédit » refused');
reset role;
select throws_ok(format($$ insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, external_ref)
                           values ('b0000000-0000-0000-0000-00000000000a', %L, 'd0000000-0000-0000-0000-000000000001', 'credit_note', 100, '2025-03-06', null) $$,
                        current_setting('test.i')),
  '23514', null, 'a « Note de crédit » payment without the import''s ref breaks the check');
select throws_ok(format($$ insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, external_ref)
                           values ('b0000000-0000-0000-0000-00000000000a', %L, 'd0000000-0000-0000-0000-000000000001', 'credit_note', 100, '2025-03-06', 'stripe:pi_1') $$,
                        current_setting('test.i')),
  '23514', null, '… nor with another ref');

-- An imported refund goes on a payment of its own mode first.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r2', public.import_invoice($${
  "gorendezvous_number": "2025-0000501", "issued_on": "2025-03-04", "client_ref": "gorendezvous:101",
  "subtotal_cents": 10000, "gst_cents": 0, "qst_cents": 0, "total_cents": 10000,
  "lines": [{"description": "Consultation", "quantity": 1, "unit_price_cents": 10000, "total_cents": 10000}],
  "payments": [
    {"paid_on": "2025-03-04", "mode_code": "credit_note", "amount_cents": 5000},
    {"paid_on": "2025-03-05", "mode_code": "interac", "amount_cents": 5000}
  ],
  "refunds": [
    {"paid_on": "2025-03-06", "mode_code": "credit_note", "amount_cents": 2000},
    {"paid_on": "2025-03-07", "amount_cents": 1000}
  ]
}$$::jsonb, false)::text, true);
select is(current_setting('test.r2')::jsonb ->> 'status', 'ok', 'an invoice with refunds: imported');
reset role;
select results_eq(format($$ select p.mode_code, r.amount_cents from public.refunds r join public.payments p on p.id = r.payment_id
                            where r.invoice_id = %L order by r.amount_cents desc $$, current_setting('test.r2')::jsonb ->> 'id'),
  $$ values ('credit_note'::text, 2000), ('interac'::text, 1000) $$,
  '… a negative « Note de crédit » on the credit; a refund without mode on the latest payment, as before');
select is((select paid_cents from public.invoices where id = (current_setting('test.r2')::jsonb ->> 'id')::uuid), 7000, '… paid_cents net of the refunds');

-- The #171 guards still hold for it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0000502",
            "payments": [{"paid_on": "2099-03-04", "mode_code": "credit_note", "amount_cents": 10000}]}', true) -> 'errors' -> 0 ->> 'message',
  'Paiement 1 : la date de paiement est dans le futur.', 'a « Note de crédit » in the future: refused');
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0000503",
            "payments": [{"paid_on": "2025-03-04", "mode_code": "credit_note", "amount_cents": 10001}]}', true) -> 'errors' -> 0 ->> 'message',
  'Les paiements dépassent le total de la facture.', '… more than the invoice: refused');
reset role;
update public.payment_modes set is_active = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 'credit_note';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_invoice(current_setting('test.row')::jsonb || '{"gorendezvous_number": "2025-0000504"}', true) -> 'errors' -> 0 ->> 'message',
  'Paiement 2 : mode de paiement inconnu ou inactif.', '« Note de crédit » deactivated by the clinic: refused');
reset role;

select * from finish();
rollback;
