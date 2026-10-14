-- Facturation, refunds of imported card payments (migration *_billing_imported_stripe_refunds.sql,
-- BI-29). Covers: refund_payment refuses an imported Stripe payment (never a pending Stripe refund
-- that fails); record_refund_outside_app records it at once with its reference (status
-- `recorded`, paid_cents lowered, audited, the same outbox path as the other manual refunds:
-- skipped for an imported invoice); its guards (billing.manage first, the clinic's payment, only
-- an imported card payment, the amount, the reason, the reference); get_invoice says which
-- payments are imported and gives a refund's reference.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@isr.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@isr.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adj@isr-b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adj@isr.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@isr.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Adjointe B', 'adj@isr-b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o),
       (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, email, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'ce@isr.test', 'gorendezvous:101');

-- An imported invoice paid by card (Stripe, in GOrendezvous) and by Interac.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.import_invoice($${
  "gorendezvous_number": "2025-0000700", "issued_on": "2025-03-04", "client_ref": "gorendezvous:101",
  "subtotal_cents": 10000, "gst_cents": 0, "qst_cents": 0, "total_cents": 10000,
  "lines": [{"description": "Consultation", "quantity": 1, "unit_price_cents": 10000, "total_cents": 10000}],
  "payments": [
    {"paid_on": "2025-03-04", "mode_code": "stripe", "amount_cents": 6000},
    {"paid_on": "2025-03-05", "mode_code": "interac", "amount_cents": 3999}
  ]
}$$::jsonb, false)::text, true);
select is(current_setting('test.r')::jsonb ->> 'status', 'ok', 'an imported invoice paid by card and Interac');
reset role;
select set_config('test.i', current_setting('test.r')::jsonb ->> 'id', true);
select set_config('test.card', (select id::text from public.payments where invoice_id = current_setting('test.i')::uuid and mode_code = 'stripe'), true);
select set_config('test.ia', (select id::text from public.payments where invoice_id = current_setting('test.i')::uuid and mode_code = 'interac'), true);

-- A card payment made in the app (its PaymentIntent as ref), on the same invoice for the test.
insert into public.payments (id, org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, external_ref)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', current_setting('test.i')::uuid,
        'd0000000-0000-0000-0000-000000000001', 'stripe', 1, '2025-03-06', 'pi_test1');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- refund_payment: never an online refund of an imported card payment.
select throws_ok(format('select public.refund_payment(%L::uuid, 1000, %L)', current_setting('test.card'), 'Erreur de saisie'),
  'P0001', 'Ce paiement par carte vient de GOrendezvous : l''app ne peut pas le rembourser par Stripe. Remboursez-le hors de l''app, puis enregistrez-le avec « Remboursement fait hors de l''app ».',
  'refund_payment: an imported card payment is refused');
select is((select count(*)::int from public.refunds where payment_id = current_setting('test.card')::uuid), 0, '… no refund row left behind');

-- record_refund_outside_app: recorded at once, with its reference.
select set_config('test.rf', public.record_refund_outside_app(current_setting('test.card')::uuid, 2500, '  Séance annulée  ', '  VIR-2026-10-14  ')::text, true);
select results_eq(format($$ select status, amount_cents, reason, provider_ref, processed_at is not null from public.refunds where id = %L $$, current_setting('test.rf')),
  $$ values ('recorded'::text, 2500, 'Séance annulée'::text, 'VIR-2026-10-14'::text, true) $$,
  'record_refund_outside_app: recorded at once, trimmed, the reference kept');
select results_eq(format($$ select paid_cents, payment_status from public.invoices where id = %L $$, current_setting('test.i')),
  $$ values (7500, 'partial'::text) $$, '… the invoice''s paid amount lowered');
reset role;
select is((select count(*)::int from public.audit_log where table_name = 'refunds' and record_id = current_setting('test.rf') and action = 'insert'), 1,
  '… audited');
select is((select count(*)::int from public.billing_sync_events where entity_id = current_setting('test.rf')::uuid), 0,
  '… no QuickBooks event: the outbox skips an imported invoice, as for every manual refund of one');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- get_invoice: which payments are imported; a refund's reference.
select set_config('test.bundle', public.get_invoice(current_setting('test.i')::uuid)::text, true);
select results_eq($$ select p ->> 'mode_code', (p ->> 'imported')::boolean from pg_catalog.jsonb_array_elements(current_setting('test.bundle')::jsonb -> 'payments') p
                      order by p ->> 'paid_on' $$,
  $$ values ('stripe'::text, true), ('interac'::text, true), ('stripe'::text, false) $$,
  'get_invoice: each payment says whether it was imported');
select is((select r ->> 'reference' from pg_catalog.jsonb_array_elements(current_setting('test.bundle')::jsonb -> 'payments') p,
                  pg_catalog.jsonb_array_elements(p -> 'refunds') r where r ->> 'id' = current_setting('test.rf')),
  'VIR-2026-10-14', '… and a refund''s reference');

-- Its guards.
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 3501, %L, %L)', current_setting('test.card'), 'Trop', 'VIR-1'),
  'P0001', 'Le remboursement va de 0,01 $ à ce qui reste du paiement (35,00 $).', 'more than what is left: refused');
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 100, %L, %L)', current_setting('test.card'), ' a ', 'VIR-1'),
  'P0001', 'La raison du remboursement compte de 3 à 500 caractères.', 'a reason too short: refused');
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 100, %L, %L)', current_setting('test.card'), 'Séance annulée', '  '),
  'P0001', 'Indiquez la référence du remboursement (virement, Stripe…), de 3 à 200 caractères.', 'no reference: refused');
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 100, %L, %L)', current_setting('test.card'), 'Séance annulée', repeat('x', 201)),
  'P0001', 'Indiquez la référence du remboursement (virement, Stripe…), de 3 à 200 caractères.', 'a reference too long: refused');
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 100, %L, %L)', current_setting('test.ia'), 'Séance annulée', 'VIR-1'),
  'P0001', 'Seul un paiement par carte importé de GOrendezvous se rembourse ici hors de l''app ; les autres passent par « Rembourser ».',
  'an imported Interac payment: refused (« Rembourser » records it already)');
select throws_ok('select public.record_refund_outside_app(''e0000000-0000-0000-0000-000000000001''::uuid, 1, ''Séance annulée'', ''VIR-1'')',
  'P0001', 'Seul un paiement par carte importé de GOrendezvous se rembourse ici hors de l''app ; les autres passent par « Rembourser ».',
  'a card payment made in the app: refused (Stripe refunds it)');
select lives_ok(format('select public.refund_payment(%L::uuid, 1000, %L)', current_setting('test.ia'), 'Erreur de saisie'),
  'refund_payment: an imported Interac payment is still refunded as before');

-- billing.manage first; another clinic's payment is not found.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 100, %L, %L)', current_setting('test.card'), 'Séance annulée', 'VIR-1'),
  '42501', null, 'a professional: permission refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.record_refund_outside_app(%L::uuid, 100, %L, %L)', current_setting('test.card'), 'Séance annulée', 'VIR-1'),
  'P0001', 'Paiement introuvable.', 'another clinic''s payment: not found');
reset role;
select is((select count(*)::int from public.refunds where payment_id = current_setting('test.card')::uuid), 1, '… nothing recorded by the refused calls');

-- Not callable by anon.
select ok(not has_function_privilege('anon', 'public.record_refund_outside_app(uuid, integer, text, text)', 'execute'),
  'anon cannot execute record_refund_outside_app');

select * from finish();
rollback;
