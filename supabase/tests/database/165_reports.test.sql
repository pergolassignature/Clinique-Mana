-- Rapports, batch RP1 (migrations *_billing_report_facts, *_appointments_report_facts, *_reports_module).
-- Covers: privileges (the three RPCs for users; the published facts for no role); registry and
-- role defaults; « Revenus » by invoice (issued in the period, a credited one counted apart, a
-- draft never), by service (the lines, per service), by payment (made in the period, per mode)
-- with the filters (professional, service, mode); the period's rules; « Annulations et absences »
-- (per reason, late, absences, a couple's appointment once, never a personal one, the clinic's
-- day bounds) with the filters; « Clients à relancer » (nothing booked after, a closed file
-- never); the permissions (the conseillère none, the adjointe the revenue only), the module off,
-- another clinic.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Privileges.
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': users')
  from (values ('report_revenue', array['text', 'date', 'date', 'uuid', 'uuid', 'text']),
               ('report_cancellations', array['date', 'date', 'uuid', 'uuid', 'text']),
               ('report_clients_to_follow_up', array['date', 'date', 'uuid'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('billing_revenue_lines', array['uuid', 'date', 'date']), ('billing_revenue_payments', array['uuid', 'date', 'date']),
               ('billing_payment_mode_names', array['uuid']),
               ('appointment_absence_facts', array['uuid', 'timestamp with time zone', 'timestamp with time zone']),
               ('cancellation_reason_names', array['uuid'])) as x(f, a);

-- Registry.
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'reports' order by depends_on $$,
  $$ values ('appointments'::text), ('billing') $$, 'reports depends on appointments and billing');
select results_eq($$ select role, pg_catalog.array_agg(permission_key order by permission_key) from public.role_permissions
                      where permission_key like 'reports.%' group by role order by role $$,
  $$ values ('admin'::text, array['reports.finance', 'reports.payroll', 'reports.view']), ('admin_assistant', array['reports.finance']) $$,
  'role defaults: the admin both, the adjointe the revenue');

-- Org A: an admin, an adjointe, a conseillère. Org B: an admin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000002', 'adjointe@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'conseillere@a.test'), ('a0000000-0000-0000-0000-000000000009', 'admin@b.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, o::uuid, n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
               ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test'),
               ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test')) as v(u, o, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports')) as y(m);

insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Deux', 'p2@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Essai'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Essai'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Denis', 'Essai');
update public.clients set archived_at = now() where id = 'd0000000-0000-0000-0000-000000000004';
create function pg_temp.svc(p_code int) returns uuid language sql as $$
  select id from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = p_code $$;
create function pg_temp.reason(p_key text) returns uuid language sql as $$
  select id from public.cancellation_reasons where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = p_key $$;

-- September 2026's invoices:
--   2026-1 Alice, Pro Un 50 min, 175 $, issued Sep 5, paid 100 $ Interac Sep 6 and 30 $ cheque Oct 1
--   2026-2 Bruno, Pro Deux 50 min 175 $ and an adjustment of 45 $, issued Sep 10, paid 220 $ Stripe Sep 11
--   2026-3 Alice, Pro Un, 90 $, issued Sep 12, credited
--   2026-4 Alice, issued Oct 2 (outside); a draft (never)
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents,
                             paid_cents, finalized_at, credited_at)
values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-1', 2026, 1, 'issued',
   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-09-05', 17500, 17500, 13000, now(), null),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '2026-2', 2026, 2, 'issued',
   'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '2026-09-10', 22000, 22000, 22000, now(), null),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', '2026-3', 2026, 3, 'credited',
   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-09-12', 9000, 9000, 0, now(), now()),
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', '2026-4', 2026, 4, 'issued',
   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-10-02', 5000, 5000, 0, now(), null),
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', null, null, null, 'draft',
   'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', null, 8000, 8000, 0, null, null);
insert into public.invoice_lines (org_id, invoice_id, position, line_type, professional_id, service_id, service_code, description,
                                  unit_price_cents, subtotal_cents, total_cents, credited)
values
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 1, 'service', 'c0000000-0000-0000-0000-000000000001',
   pg_temp.svc(10150), 10150, 'Consultation 50 min', 17500, 17500, 17500, false),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 1, 'service', 'c0000000-0000-0000-0000-000000000002',
   pg_temp.svc(10150), 10150, 'Consultation 50 min', 17500, 17500, 17500, false),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 2, 'adjustment', null, null, null, 'Frais', 4500, 4500, 4500, false),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003', 1, 'service', 'c0000000-0000-0000-0000-000000000001',
   pg_temp.svc(10130), 10130, 'Consultation 30 min', 9000, 9000, 9000, true),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 1, 'service', 'c0000000-0000-0000-0000-000000000001',
   pg_temp.svc(10130), 10130, 'Consultation 30 min', 5000, 5000, 5000, false),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000005', 1, 'service', 'c0000000-0000-0000-0000-000000000002',
   pg_temp.svc(10130), 10130, 'Consultation 30 min', 8000, 8000, 8000, false);
insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on) values
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'interac', 10000, '2026-09-06'),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'cheque', 3000, '2026-10-01'),
  ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'stripe', 22000, '2026-09-11');

-- September's appointments (clinic time):
--   e1 Alice, Pro Un, cancelled late « Plus requis » (Sep 8); Alice has e4 booked after it
--   e2 Bruno, Pro Deux, absent (Sep 9), nothing after
--   e3 Chloé and Bruno (couple), Pro Un, cancelled « Urgence familiale » (Sep 15), on time
--   e4 Alice, Pro Un, booked (Oct 20)
--   e5 Denis (archived), Pro Deux, absent (Sep 16)
--   e6 Pro Un's personal appointment, cancelled (never)
--   e7 Chloé, Pro Deux, cancelled Sep 30 at 23:30 clinic time (Oct 1 03:30Z): September's
--   e8 Chloé, Pro Deux, cancelled Oct 1 at 00:30 clinic time: October's
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, is_personal,
                                 cancelled_at, cancel_reason_id, cancel_late)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10150),
   '2026-09-08 14:00Z', '2026-09-08 14:50Z', '2026-09-08 15:00Z', 'cancelled', false, '2026-09-08 10:00Z', pg_temp.reason('no_longer_needed'), true),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', pg_temp.svc(10150),
   '2026-09-09 14:00Z', '2026-09-09 14:50Z', '2026-09-09 15:00Z', 'booked', false, null, null, null),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(20160),
   '2026-09-15 14:00Z', '2026-09-15 15:00Z', '2026-09-15 15:00Z', 'cancelled', false, '2026-09-10 10:00Z', pg_temp.reason('family_emergency'), false),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10150),
   '2026-10-20 14:00Z', '2026-10-20 14:50Z', '2026-10-20 15:00Z', 'booked', false, null, null, null),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', pg_temp.svc(10150),
   '2026-09-16 14:00Z', '2026-09-16 14:50Z', '2026-09-16 15:00Z', 'booked', false, null, null, null),
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', null,
   '2026-09-17 14:00Z', '2026-09-17 15:00Z', '2026-09-17 15:00Z', 'cancelled', true, '2026-09-17 10:00Z', null, false),
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', pg_temp.svc(10150),
   '2026-10-01 03:30Z', '2026-10-01 04:20Z', '2026-10-01 04:30Z', 'cancelled', false, '2026-09-29 10:00Z', pg_temp.reason('other'), false),
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', pg_temp.svc(10150),
   '2026-10-01 04:30Z', '2026-10-01 05:20Z', '2026-10-01 05:30Z', 'cancelled', false, '2026-09-29 10:00Z', pg_temp.reason('other'), false);
insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'client', 'absent'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'second', 'expected'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'client', 'absent'),
  ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected'),
  ('e0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected');

-- Ids for the calls made as a user (a pg_temp function called under another role crashes the server).
select set_config('test.svc30', pg_temp.svc(10130)::text, true), set_config('test.no_longer_needed', pg_temp.reason('no_longer_needed')::text, true);
set local role authenticated;
-- The admin.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- « Revenus » by invoice.
select results_eq($$ select r ->> 'number', (r ->> 'total_cents')::int, (r ->> 'paid_cents')::int, (r ->> 'balance_cents')::int, r ->> 'professional_names'
                       from pg_catalog.jsonb_array_elements(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'rows') r $$,
  $$ values ('2026-2'::text, 22000, 22000, 0, 'Pro Deux'::text), ('2026-1', 17500, 13000, 4500, 'Pro Un') $$,
  'by invoice: those issued in the period and not credited, newest first (never a draft)');
select is(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'totals',
  '{"count": 2, "subtotal_cents": 39500, "gst_cents": 0, "qst_cents": 0, "total_cents": 39500, "paid_cents": 35000, "balance_cents": 4500}'::jsonb,
  '… their totals');
select is(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'credited', '{"count": 1, "total_cents": 9000}'::jsonb,
  '… the credited invoice counted apart');
select is(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'rows' -> 0 ->> 'client_name', 'Bruno Essai', '… the client named');
select results_eq($$ select r ->> 'number' from pg_catalog.jsonb_array_elements(public.report_revenue('invoice', '2026-09-01', '2026-09-30',
                       'c0000000-0000-0000-0000-000000000001') -> 'rows') r $$,
  $$ values ('2026-1'::text) $$, '… by professional');
select is(pg_catalog.jsonb_array_length(public.report_revenue('invoice', '2026-09-01', '2026-09-30', null, current_setting('test.svc30')::uuid) -> 'rows'), 0,
  '… by service (the credited one never)');
select is((select pg_catalog.jsonb_agg(p ->> 'name' order by p ->> 'name')
             from pg_catalog.jsonb_array_elements(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'options' -> 'professionals') p),
  '["Pro Deux", "Pro Un"]'::jsonb, '… the professionals of the period to filter');
select is(pg_catalog.jsonb_array_length(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'options' -> 'modes'), 6,
  '… the clinic''s payment modes');

-- By service.
select results_eq($$ select r ->> 'number', r ->> 'line_type', (r ->> 'service_code')::int, (r ->> 'total_cents')::int, r ->> 'professional_name'
                       from pg_catalog.jsonb_array_elements(public.report_revenue('service', '2026-09-01', '2026-09-30') -> 'rows') r $$,
  $$ values ('2026-2'::text, 'service'::text, 10150, 17500, 'Pro Deux'::text), ('2026-2', 'adjustment', null, 4500, null),
            ('2026-1', 'service', 10150, 17500, 'Pro Un') $$, 'by service: the lines of the invoices not credited');
select results_eq($$ select (g ->> 'service_code')::int, g ->> 'line_type', (g ->> 'lines')::int, (g ->> 'total_cents')::int
                       from pg_catalog.jsonb_array_elements(public.report_revenue('service', '2026-09-01', '2026-09-30') -> 'by_service') g $$,
  $$ values (10150, null::text, 2, 35000), (null, 'adjustment', 1, 4500) $$, '… per service, the largest first');
select is((public.report_revenue('service', '2026-09-01', '2026-09-30', 'c0000000-0000-0000-0000-000000000002') -> 'totals' ->> 'total_cents')::int,
  17500, '… a professional''s lines only');

-- By payment.
select results_eq($$ select r ->> 'paid_on', r ->> 'number', r ->> 'mode_name', (r ->> 'amount_cents')::int
                       from pg_catalog.jsonb_array_elements(public.report_revenue('payment', '2026-09-01', '2026-09-30') -> 'rows') r $$,
  $$ values ('2026-09-11'::text, '2026-2'::text, 'Carte (Stripe)'::text, 22000), ('2026-09-06', '2026-1', 'Virement Interac', 10000) $$,
  'by payment: the payments made in the period');
select results_eq($$ select g ->> 'mode_code', (g ->> 'count')::int, (g ->> 'amount_cents')::int
                       from pg_catalog.jsonb_array_elements(public.report_revenue('payment', '2026-09-01', '2026-10-31') -> 'by_mode') g $$,
  $$ values ('stripe'::text, 1, 22000), ('interac', 1, 10000), ('cheque', 1, 3000) $$, '… per mode');
select is((public.report_revenue('payment', '2026-09-01', '2026-10-31', null, null, 'cheque') -> 'totals'),
  '{"count": 1, "amount_cents": 3000}'::jsonb, '… by mode');
select is((public.report_revenue('payment', '2026-09-01', '2026-09-30', 'c0000000-0000-0000-0000-000000000001') -> 'totals' ->> 'amount_cents')::int,
  10000, '… by professional (the invoice''s)');

-- The period.
select throws_ok($$ select public.report_revenue('invoice', '2026-09-30', '2026-09-01') $$, 'P0001',
  'Choisissez une période : du … au …, la fin après le début.', 'the end before the start: refused');
select throws_ok($$ select public.report_revenue('invoice', '2025-01-01', '2026-09-01') $$, 'P0001',
  'La période va jusqu''à un an : choisissez-en une plus courte.', 'more than a year: refused');
select throws_ok($$ select public.report_revenue('daily', '2026-09-01', '2026-09-30') $$, 'P0001',
  'Vue inconnue : par facture, par service ou par paiement.', 'an unknown view: refused');
select lives_ok($$ select public.report_revenue('invoice', '2026-01-01', '2026-12-31') $$, 'a whole year');

-- « Annulations et absences ».
select results_eq($$ select r ->> 'kind', r ->> 'reason_name', (r ->> 'count')::int, (r ->> 'late')::int
                       from pg_catalog.jsonb_array_elements(public.report_cancellations('2026-09-01', '2026-09-30') -> 'by_reason') r $$,
  $$ values ('absent'::text, null::text, 2, 0), ('cancelled', 'Autre', 1, 0), ('cancelled', 'Plus requis', 1, 1),
            ('cancelled', 'Urgence familiale', 1, 0) $$,
  'per reason: absences, then each reason (a couple''s once, never a personal one), the clinic''s September');
select is(public.report_cancellations('2026-09-01', '2026-09-30') -> 'totals', '{"cancelled": 3, "late": 1, "absent": 2}'::jsonb, '… the totals');
select is(pg_catalog.jsonb_array_length(public.report_cancellations('2026-09-01', '2026-09-30') -> 'rows'), 6,
  '… one row per client (the couple''s two)');
select is((select pg_catalog.count(*)::int from pg_catalog.jsonb_array_elements(public.report_cancellations('2026-09-01', '2026-09-30') -> 'rows') r
            where r ->> 'appointment_id' = 'e0000000-0000-0000-0000-000000000001' and r ->> 'later_starts_at' is not null), 1,
  '… Alice''s next appointment shown');
select is(public.report_cancellations('2026-09-01', '2026-09-30', null, null, 'absent') -> 'totals', '{"cancelled": 0, "late": 0, "absent": 2}'::jsonb,
  '… the absences only');
select is(public.report_cancellations('2026-09-01', '2026-09-30', null, current_setting('test.no_longer_needed')::uuid) -> 'totals',
  '{"cancelled": 1, "late": 1, "absent": 0}'::jsonb, '… one reason');
select is(public.report_cancellations('2026-09-01', '2026-09-30', 'c0000000-0000-0000-0000-000000000002') -> 'totals',
  '{"cancelled": 1, "late": 0, "absent": 2}'::jsonb, '… one professional');
select is(pg_catalog.jsonb_array_length(public.report_cancellations('2026-09-01', '2026-09-30') -> 'options' -> 'reasons'), 7, '… the reasons to filter');
select throws_ok($$ select public.report_cancellations('2026-09-01', '2026-09-30', null, null, 'late') $$, 'P0001',
  'Type inconnu : annulation ou absence.', 'an unknown kind: refused');

-- « Clients à relancer »: Bruno (absent, then his couple's cancellation) and Chloé (Sep 30); not
-- Alice (booked after), not Denis (archived).
select results_eq($$ select r ->> 'client_name', r ->> 'kind', (r ->> 'events')::int
                       from pg_catalog.jsonb_array_elements(public.report_clients_to_follow_up('2026-09-01', '2026-09-30') -> 'rows') r $$,
  $$ values ('Chloé Essai'::text, 'cancelled'::text, 2), ('Bruno Essai', 'cancelled', 2) $$,
  'to call back: the last cancellation or absence with nothing booked after, open files only');
select is((public.report_clients_to_follow_up('2026-09-01', '2026-09-30') ->> 'total')::int, 2, '… counted');
select results_eq($$ select r ->> 'client_name', r ->> 'kind'
                       from pg_catalog.jsonb_array_elements(public.report_clients_to_follow_up('2026-09-01', '2026-09-30',
                              'c0000000-0000-0000-0000-000000000002') -> 'rows') r $$,
  $$ values ('Chloé Essai'::text, 'cancelled'::text), ('Bruno Essai', 'absent') $$, '… one professional''s');

-- Permissions.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.report_revenue('payment', '2026-09-01', '2026-09-30') $$, 'the adjointe reads the revenue');
select throws_ok($$ select public.report_cancellations('2026-09-01', '2026-09-30') $$, '42501', 'Permission refusée : reports.view',
  '… not the cancellations');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.report_revenue('invoice', '2026-09-01', '2026-09-30') $$, '42501', 'Permission refusée : reports.finance',
  'the conseillère: no revenue');
select throws_ok($$ select public.report_clients_to_follow_up('2026-09-01', '2026-09-30') $$, '42501', 'Permission refusée : reports.view',
  '… no clients to call back');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(public.report_revenue('invoice', '2026-09-01', '2026-09-30') -> 'totals' ->> 'count', '0', 'another clinic sees nothing of it');
select is(public.report_cancellations('2026-09-01', '2026-09-30') -> 'totals' ->> 'cancelled', '0', '… nor its cancellations');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'reports';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.report_revenue('invoice', '2026-09-01', '2026-09-30') $$, '42501', 'Permission refusée : reports.finance',
  'the module off: nothing');
reset role;

select * from finish();
rollback;
