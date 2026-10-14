-- Rapports, parity audit L6 (migrations *_billing_revenue_refunds, *_reports_revenue_refunds):
-- the refunds in « Revenus » par paiement.
-- Covers: the published helper for no role; a refund recorded in the period as a negative row of
-- its payment's mode (dated by the clinic day it was recorded, even for an older payment); one
-- recorded outside, one still with Stripe and one refused left out; the totals and each mode
-- (received, refunded, net); the filters (mode, professional) through the payment and invoice;
-- the other views unchanged; the reason never published.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select function_privs_are('private', 'billing_revenue_refunds', array['uuid', 'date', 'date'], r, array[]::text[],
                          'billing_revenue_refunds: nothing for ' || r)
  from (values ('authenticated'), ('service_role')) as x(r);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',
        '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Deux', 'p2@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Essai');

-- 2026-1 Alice, Pro Un, 175 $, paid 175 $ by card on Aug 28; 50 $ refunded on Sep 3 (recorded),
--   20 $ still with Stripe, 10 $ refused.
-- 2026-2 Bruno, Pro Deux, 100 $, paid 100 $ Interac on Sep 10; 30 $ refunded on Sep 30 at 23:30
--   clinic time (Oct 1 03:30Z: September's), 15 $ on Oct 2 (outside).
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents,
                             paid_cents, finalized_at)
values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-1', 2026, 1, 'issued',
   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-08-28', 17500, 17500, 12500, now()),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '2026-2', 2026, 2, 'issued',
   'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '2026-09-10', 10000, 10000, 5500, now());
insert into public.invoice_lines (org_id, invoice_id, position, line_type, professional_id, description, unit_price_cents, subtotal_cents,
                                  total_cents, credited)
values
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 1, 'adjustment', 'c0000000-0000-0000-0000-000000000001',
   'Séance', 17500, 17500, 17500, false),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 1, 'adjustment', 'c0000000-0000-0000-0000-000000000002',
   'Séance', 10000, 10000, 10000, false);
insert into public.payments (id, org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on) values
  ('90000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001', 'stripe', 17500, '2026-08-28'),
  ('90000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000002', 'interac', 10000, '2026-09-10');
insert into public.refunds (id, org_id, payment_id, invoice_id, amount_cents, reason, status, created_at, processed_at) values
  ('91000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 5000, 'Séance annulée à temps', 'recorded', '2026-09-03 14:00Z', '2026-09-03 14:00Z'),
  ('91000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 2000, 'Erreur de montant', 'pending_provider', '2026-09-04 14:00Z', null),
  ('91000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 1000, 'Erreur de montant', 'failed', '2026-09-05 14:00Z', '2026-09-05 14:05Z'),
  ('91000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000002', 3000, 'Geste commercial', 'recorded', '2026-10-01 03:30Z', '2026-10-01 03:30Z'),
  ('91000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000002', 1500, 'Geste commercial', 'recorded', '2026-10-02 14:00Z', '2026-10-02 14:00Z');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$ select r ->> 'kind', r ->> 'paid_on', r ->> 'number', r ->> 'mode_code', (r ->> 'amount_cents')::int, r ->> 'reference'
                       from pg_catalog.jsonb_array_elements(public.report_revenue('payment', '2026-09-01', '2026-09-30') -> 'rows') r $$,
  $$ values ('refund'::text, '2026-09-30'::text, '2026-2'::text, 'interac'::text, -3000, null::text),
            ('payment', '2026-09-10', '2026-2', 'interac', 10000, null),
            ('refund', '2026-09-03', '2026-1', 'stripe', -5000, null) $$,
  'the refunds recorded in the period, negative, dated by the clinic day they were recorded; pending, refused and later ones left out');
select ok((select pg_catalog.bool_and(r ? 'row_id') from pg_catalog.jsonb_array_elements(public.report_revenue('payment', '2026-09-01', '2026-09-30') -> 'rows') r),
  'each row has its id');
select ok(position('Geste' in public.report_revenue('payment', '2026-09-01', '2026-09-30')::text) = 0
          and position('annulée' in public.report_revenue('payment', '2026-09-01', '2026-09-30')::text) = 0,
  'the reason is never published');
select is(public.report_revenue('payment', '2026-09-01', '2026-09-30') -> 'totals',
  '{"count": 1, "amount_cents": 10000, "refunds_count": 2, "refunds_cents": 8000, "net_cents": 2000}'::jsonb,
  'the totals: received, refunded, net');
select results_eq($$ select g ->> 'mode_code', (g ->> 'count')::int, (g ->> 'amount_cents')::int, (g ->> 'refunds_count')::int,
                            (g ->> 'refunds_cents')::int, (g ->> 'net_cents')::int
                       from pg_catalog.jsonb_array_elements(public.report_revenue('payment', '2026-09-01', '2026-09-30') -> 'by_mode') g $$,
  $$ values ('interac'::text, 1, 10000, 1, 3000, 7000), ('stripe', 0, 0, 1, 5000, -5000) $$,
  '… per mode (a refund of an older payment under its mode)');
select is(public.report_revenue('payment', '2026-09-01', '2026-09-30', null, null, 'stripe') -> 'totals',
  '{"count": 0, "amount_cents": 0, "refunds_count": 1, "refunds_cents": 5000, "net_cents": -5000}'::jsonb, '… by mode');
select is((public.report_revenue('payment', '2026-09-01', '2026-09-30', 'c0000000-0000-0000-0000-000000000002') -> 'totals' ->> 'net_cents')::int,
  7000, '… by professional (the invoice''s)');
select is(public.report_revenue('payment', '2026-10-01', '2026-10-31') -> 'totals',
  '{"count": 0, "amount_cents": 0, "refunds_count": 1, "refunds_cents": 1500, "net_cents": -1500}'::jsonb, 'October: the later refund only');
select is((public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'totals' ->> 'paid_cents')::int, 5500,
  'the invoice view unchanged (what the invoice says is paid)');
reset role;

select * from finish();
rollback;
