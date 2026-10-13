-- Facturation, batch FPay (migration *_billing_payroll.sql).
-- Covers: privileges (select only; the RPCs; the service RPCs); a finished month only; the
-- build: every completed session paid once at the grid (IVAC at the regular price, a couple's
-- session once, an « Entente particulière »), the clinic month (a session at 23:30 on the 31st
-- is that month's), a discovery call never, a late cancellation not until the client paid (the
-- F3 stub), then at the clinic's rate in the month the payment is in; reports at « Autres frais »
-- from issued invoice lines (a credited one never); a line to complete blocks the send; drafts
-- hidden from the professional; correction, adjustment, send, validation, the lock, the next
-- month's build picking up what came late (counted once), the invoice and the payment; the rules
-- and the export by specialty; the job; another clinic's period and the other roles refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- Privileges.
select table_privs_are('public', t, 'authenticated', array['SELECT'], t || ': select only')
  from (values ('payout_periods'), ('payout_lines'), ('professional_invoices'), ('payout_service_rules')) as x(t);
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': authenticated')
  from (values ('build_payout_month', array['date']), ('send_payout_periods', array['uuid[]']),
               ('validate_payout_period', array['uuid']), ('attach_professional_invoice', array['uuid', 'uuid', 'text', 'date']),
               ('mark_period_paid', array['uuid', 'date', 'text'])) as x(f, a);
select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': not for users')
  from (values ('prepare_professional_invoice', array['uuid', 'uuid']),
               ('record_generated_professional_invoice', array['uuid', 'uuid', 'text', 'date', 'uuid'])) as x(f, a);
select function_privs_are('private', 'billing_paid_fees', array['uuid', 'timestamp with time zone'], 'authenticated', array[]::text[],
  'billing_paid_fees: no role');

-- Org A: an admin, an adjointe, a conseillère, two professionals with accounts. Org B: an admin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000002', 'adjointe@a.test'),
               ('a0000000-0000-0000-0000-000000000003', 'p1@a.test'), ('a0000000-0000-0000-0000-000000000004', 'conseillere@a.test'),
               ('a0000000-0000-0000-0000-000000000005', 'p2@a.test'), ('a0000000-0000-0000-0000-000000000009', 'admin@b.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, o::uuid, n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test'),
               ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test'),
               ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro Un', 'p1@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test'),
               ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro Deux', 'p2@a.test'),
               ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test')) as v(u, o, n, e);
insert into public.user_roles (user_id, org_id, role)
select u::uuid, o::uuid, r
  from (values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
               ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
               ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
               ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
               ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
               ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'admin')) as v(u, o, r);
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'p1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'Pro', 'Deux', 'p2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Pro Un at 28 %; Pro Deux without a rate (« Taux de départ à fixer »).
insert into public.professional_retention (org_id, professional_id, retention_pct, decision, effective_from) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 28, 'initial', '2026-07-01');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Essai'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Essai');
-- Chloé: an agreement with Pro Un, 50 min at 100 $ for her.
insert into public.professional_client_agreements
  (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'CE', 'd0000000-0000-0000-0000-000000000003',
        50, 10000, 15000, '2026-07-01');

create function pg_temp.svc(p_code int) returns uuid language sql as $$
  select id from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = p_code $$;
select set_config('test.call', pg_temp.svc(50601)::text, true);

-- September 2026 (clinic time), Pro Un unless said:
--   e1 50 min, Alice, completed           → 175 $ less 28 % = 126 $
--   e2 couple 60 min, Alice and Bruno     → once: 200 $ less 28 % = 144 $
--   e3 IVAC 50 min (part du client)       → the regular price: 126 $
--   e4 50 min, Alice, cancelled late      → nothing until the client pays the fee
--   e5 50 min, Aug 31 23:30 (Sep 1 03:30Z): August's
--   e6 Pro Deux 50 min, completed         → no rate: to complete
--   e7 discovery call, completed          → never paid
--   e9 50 min, Chloé (agreement)          → 100 $
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at, cancelled_at, cancel_late)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10150),
   '2026-09-03 14:00Z', '2026-09-03 14:50Z', '2026-09-03 15:00Z', 'completed', '2026-09-03 15:20Z', null, null),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(20160),
   '2026-09-04 14:00Z', '2026-09-04 15:00Z', '2026-09-04 15:00Z', 'completed', '2026-09-04 15:20Z', null, null),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(30150),
   '2026-09-08 14:00Z', '2026-09-08 14:50Z', '2026-09-08 15:00Z', 'completed', '2026-09-08 15:20Z', null, null),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10150),
   '2026-09-09 14:00Z', '2026-09-09 14:50Z', '2026-09-09 15:00Z', 'cancelled', null, '2026-09-09 10:00Z', true),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10150),
   '2026-09-01 03:30Z', '2026-09-01 04:20Z', '2026-09-01 04:30Z', 'completed', '2026-09-01 04:40Z', null, null),
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', pg_temp.svc(10150),
   '2026-09-10 14:00Z', '2026-09-10 14:50Z', '2026-09-10 15:00Z', 'completed', '2026-09-10 15:20Z', null, null),
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(50601),
   '2026-09-11 14:00Z', '2026-09-11 14:15Z', '2026-09-11 14:15Z', 'completed', '2026-09-11 14:20Z', null, null),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10150),
   '2026-09-14 14:00Z', '2026-09-14 14:50Z', '2026-09-14 15:00Z', 'completed', '2026-09-14 15:20Z', null, null);
insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'second', 'present'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present'),
  ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present'),
  ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present'),
  ('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present');
-- A report (200 $) on an issued invoice; another on a credited one.
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on,
                             subtotal_cents, total_cents, credited_at) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-1', 2026, 1, 'issued',
   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-09-15', 20000, 20000, null),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '2026-2', 2026, 2, 'credited',
   'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '2026-09-16', 20000, 20000, '2026-09-17');
insert into public.invoice_lines (id, org_id, invoice_id, position, line_type, professional_id, service_id, service_code, description,
                                  unit_price_cents, price_source, subtotal_cents, total_cents, credited) values
  ('f1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 1, 'service',
   'c0000000-0000-0000-0000-000000000001', pg_temp.svc(50400), 50400, 'Rédaction de rapport', 20000, 'entered', 20000, 20000, false),
  ('f1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 1, 'service',
   'c0000000-0000-0000-0000-000000000001', pg_temp.svc(50400), 50400, 'Rédaction de rapport', 20000, 'entered', 20000, 20000, true);

set local role authenticated;
-- Who may build.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.build_payout_month('2026-09-01') $$, '42501', 'Permission refusée : billing.payroll', 'a conseillère builds nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_payout_periods('2026-09-01') $$, '42501', 'Permission refusée : billing.payroll',
  'the adjointe (billing.manage) reads no payroll');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.build_payout_month(date_trunc('month', now() at time zone 'America/Toronto')::date) $$, 'P0001',
  'Le mois n''est pas terminé : la paie se calcule à partir du 1er du mois suivant.', 'the current month is not finished');
select throws_ok($$ select public.build_payout_month('2026-09-15') $$, 'P0001', 'Choisissez un mois.', 'a month is its 1st');

-- The build.
select is(public.build_payout_month('2026-09-01'), '{"locked": 0, "created": 2, "removed": 0, "rebuilt": 0}'::jsonb,
  'September: a period for each professional with something to pay');
select set_config('test.p1', (select id::text from public.payout_periods where professional_id = 'c0000000-0000-0000-0000-000000000001'), true);
select set_config('test.p2', (select id::text from public.payout_periods where professional_id = 'c0000000-0000-0000-0000-000000000002'), true);
select results_eq($$ select kind, appointment_id, invoice_line_id, base_cents, retention_pct, amount_cents, pricing
                       from public.payout_lines where period_id = current_setting('test.p1')::uuid
                      order by occurred_on, kind $$,
  $$ values ('session'::text, 'e0000000-0000-0000-0000-000000000001'::uuid, null::uuid, 17500, 28.00::numeric, 12600, 'grid'::text),
            ('session', 'e0000000-0000-0000-0000-000000000002', null, 20000, 28.00, 14400, 'grid'),
            ('session', 'e0000000-0000-0000-0000-000000000003', null, 17500, 28.00, 12600, 'grid'),
            ('session', 'e0000000-0000-0000-0000-000000000009', null, 15000, null, 10000, 'agreement'),
            ('other_fees', null, 'f1000000-0000-0000-0000-000000000001', 20000, 15.00, 17000, 'rate') $$,
  'Pro Un: each session once at the grid (IVAC at the regular price, the couple once), the agreement, the report at 15 %');
select results_eq($$ select lines_count, unpriced_count, total_cents, state, title_name from public.payout_periods
                      where id = current_setting('test.p1')::uuid $$,
  $$ values (5, 0, 66600, 'draft'::text, 'Psychologue'::text) $$, '… her total, a draft');
select is((select count(*)::int from public.payout_lines where appointment_id in ('e0000000-0000-0000-0000-000000000004',
           'e0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000007')), 0,
  'no line for the unpaid late cancellation, August''s session at 23:30 on the 31st, the discovery call');
select results_eq($$ select pricing, amount_cents is null from public.payout_lines where period_id = current_setting('test.p2')::uuid $$,
  $$ values ('no_rate'::text, true) $$, 'Pro Deux: no rate yet, the line is to complete');
select is(public.build_payout_month('2026-09-01'), '{"locked": 0, "created": 0, "removed": 0, "rebuilt": 2}'::jsonb,
  'a second build rebuilds');
select is((select total_cents from public.payout_periods where id = current_setting('test.p1')::uuid), 66600, '… to the same total');

-- Drafts are the administration's.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.list_my_payout_periods()), 0, 'the professional sees no draft');
select throws_ok(format('select public.get_payout_period(%L)', current_setting('test.p1')), 'P0001', 'Période de paie introuvable.',
  '… nor reads it');
select is((select count(*)::int from public.payout_lines), 0, '… nor its lines');

-- Send.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.send_payout_periods(array[current_setting('test.p1')::uuid, current_setting('test.p2')::uuid]),
  '{"sent": 1, "unpriced": 1}'::jsonb, 'send: Pro Un''s goes, Pro Deux''s waits for her rate');
reset role;
select is((select count(*)::int from public.notifications where kind = 'billing.payout_ready'
            and recipient_user_id = 'a0000000-0000-0000-0000-000000000003'), 1, 'Pro Un is told');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select month, state, total_cents from public.list_my_payout_periods() $$,
  $$ values ('2026-09-01'::date, 'to_validate'::text, 66600) $$, '« Ma paie »: her summary to validate');
select results_eq($$ select l ->> 'client_name', l ->> 'service_code', (l ->> 'amount_cents')::int
                       from jsonb_array_elements(public.get_payout_period(current_setting('test.p1')::uuid) -> 'lines') l
                      order by l ->> 'occurred_on' limit 2 $$,
  $$ values ('Alice Essai'::text, '10150'::text, 12600), ('Alice Essai', '20160', 14400) $$, '… with her clients and services');
select is((select count(*)::int from public.payout_lines), 5, '… and its lines');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(format('select public.validate_payout_period(%L)', current_setting('test.p1')), 'P0001', 'Période de paie introuvable.',
  'another professional cannot validate it');

-- Correction, adjustment, send again.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(format('select public.request_payout_correction(%L, %L)', current_setting('test.p1'), 'Il manque le déplacement du 12.'),
  '« Signaler une correction »');
select throws_ok(format('select public.validate_payout_period(%L)', current_setting('test.p1')), 'P0001', 'Ce sommaire n''est pas à valider.',
  '… then it is not to validate');
reset role;
select is((select count(*)::int from public.notifications where kind = 'billing.payout_correction' and recipient_permission = 'billing.payroll'), 1,
  'the administration is told');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format('select public.add_payout_adjustment(%L, 0, %L)', current_setting('test.p1'), 'Rien'), 'P0001',
  'Le montant de l''ajustement est requis.', 'an adjustment needs an amount');
select isnt(public.add_payout_adjustment(current_setting('test.p1')::uuid, 4500, 'Déplacement du 12 septembre'), null, 'an adjustment');
select is(public.send_payout_periods(array[current_setting('test.p1')::uuid]), '{"sent": 1, "unpriced": 0}'::jsonb, 'sent again');
select is((select total_cents from public.payout_periods where id = current_setting('test.p1')::uuid), 71100, '… with the adjustment');

-- Validation and the lock.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(format('select public.validate_payout_period(%L)', current_setting('test.p1')), '« Valider le sommaire »');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format('select public.add_payout_adjustment(%L, 100, %L)', current_setting('test.p1'), 'Encore'), 'P0001',
  'Cette période de paie est verrouillée.', 'a validated period takes no adjustment');
select throws_ok(format('select public.mark_period_paid(%L, %L)', current_setting('test.p1'), '2026-10-05'), 'P0001',
  'La facture du professionnel est requise avant le versement.', 'no payment without her invoice');
reset role;
select throws_ok(format('delete from public.payout_lines where period_id = %L', current_setting('test.p1')), 'P0001',
  'Cette période de paie est verrouillée.', 'the lock holds against any write');

-- Late items: e8 completed in September after the validation; Alice pays e4's fee (50 $) on Oct 2.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
values ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', pg_temp.svc(10130),
        '2026-09-29 14:00Z', '2026-09-29 14:30Z', '2026-09-29 14:30Z', 'completed', '2026-09-29 14:40Z');
insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence) values
  ('e0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'present');
select is(private.payroll_build('b0000000-0000-0000-0000-00000000000a', '2026-09-01', null) -> 'locked', '1'::jsonb,
  'September again: Pro Un''s period is locked and left alone');
select is((select count(*)::int from public.payout_lines where appointment_id = 'e0000000-0000-0000-0000-000000000008'), 0, '… e8 waits');
create or replace function private.billing_paid_fees(p_org uuid, p_paid_before timestamptz)
returns table (appointment_id uuid, professional_id uuid, service_id uuid, amount_cents int, paid_at timestamptz)
language sql stable set search_path = '' as $$
  select 'e0000000-0000-0000-0000-000000000004'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid,
         (select s.id from public.services s where s.org_id = p_org and s.code = 70300), 5000, timestamptz '2026-10-02 15:00Z'
   where timestamptz '2026-10-02 15:00Z' < p_paid_before
$$;
select is(private.payroll_build('b0000000-0000-0000-0000-00000000000a', '2026-09-01', null) -> 'created', '0'::jsonb,
  'September: the fee paid in October is not September''s');
select is(private.payroll_build('b0000000-0000-0000-0000-00000000000a', '2026-10-01', null) -> 'created', '1'::jsonb,
  'October: a period for Pro Un');
select results_eq($$ select l.kind, l.appointment_id, l.occurred_on, l.paid_on, l.base_cents, l.retention_pct, l.amount_cents
                       from public.payout_lines l join public.payout_periods p on p.id = l.period_id
                      where p.month = '2026-10-01' order by l.kind $$,
  $$ values ('late_cancellation'::text, 'e0000000-0000-0000-0000-000000000004'::uuid, '2026-09-09'::date, '2026-10-02'::date, 5000, 30.00::numeric, 3500),
            ('session', 'e0000000-0000-0000-0000-000000000008', '2026-09-29', null, 13000, 28.00, 9360) $$,
  'October takes the fee once paid (less the clinic''s 30 %) and the late September session, dated as they happened');
select is((select count(*)::int from public.payout_lines where appointment_id = 'e0000000-0000-0000-0000-000000000005'), 0,
  'never a month before the first period (August)');
select is(private.payroll_build('b0000000-0000-0000-0000-00000000000a', '2026-10-01', null) -> 'rebuilt', '1'::jsonb, 'October again');
select is((select count(*)::int from public.payout_lines where appointment_id in ('e0000000-0000-0000-0000-000000000004',
           'e0000000-0000-0000-0000-000000000008')), 2, '… each counted once');

-- The invoice and the payment.
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 owner_profile_id, owner_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, retain_until, uploaded_by)
values ('f2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/billing/c0000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001.pdf', 'billing', 'billing_professional_invoice',
        'payout_period', current_setting('test.p1')::uuid, 'billing.payroll', 'a0000000-0000-0000-0000-000000000003', 'billing.self',
        'Facture.pdf', 'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now(), now() + interval '1 day', 'a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.attach_professional_invoice(%L, %L, %L, %L)', current_setting('test.p1'),
                        'f2000000-0000-0000-0000-000000000001', '2026-09', '2027-01-01'), 'P0001',
  'La date de la facture doit suivre le début du mois et ne pas être dans le futur.', 'an invoice dated in the future is refused');
select isnt(public.attach_professional_invoice(current_setting('test.p1')::uuid, 'f2000000-0000-0000-0000-000000000001', '2026-09', '2026-10-01'),
  null, '« Téléverser ma facture »');
select results_eq($$ select source, number, amount_cents from public.professional_invoices $$,
  $$ values ('uploaded'::text, '2026-09'::text, 71100) $$, '… the period''s total');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select professional_name, specialty, invoice_number, amount_cents from public.list_payout_export('2026-09-01') $$,
  $$ values ('Pro Un'::text, 'Psychologue'::text, '2026-09'::text, 71100) $$, 'the export for QuickBooks, by specialty');
select throws_ok(format('select public.mark_period_paid(%L, %L)', current_setting('test.p1'), '2026-10-05'), 'P0001',
  'La date du versement doit suivre la validation du sommaire et ne pas être dans le futur.', 'not paid before she validated');
select lives_ok(format('select public.mark_period_paid(%L, %L)', current_setting('test.p1'), (now() at time zone 'America/Toronto')::date),
  '« Marquer comme versée »');
select throws_ok(format('select public.reopen_payout_period(%L, %L)', current_setting('test.p1'), 'Erreur de taux'), 'P0001',
  'Seule une période validée et non versée se rouvre.', 'a paid period never reopens');

-- Rules (Paramètres → Paie).
select results_eq($$ select code, rule, is_default from public.list_payout_rules() where code in (10150, 30150, 50400, 50601, 70300) order by code $$,
  $$ values (10150, 'session'::text, true), (30150, 'session', true), (50400, 'other_fees', true), (50601, 'none', true),
            (70300, 'late_cancellation', true) $$, 'the default rules');
select lives_ok(format('select public.set_payout_rule(%L, %L)', current_setting('test.call'), 'session'), 'a rule changed');
select results_eq($$ select rule, is_default from public.list_payout_rules() where code = 50601 $$,
  $$ values ('session'::text, false) $$, '… shown as not the default');

-- One file, one invoice: the paid period's file cannot serve another period.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.attach_professional_invoice((select id from public.payout_periods where month = %L), %L, %L, %L)',
                        '2026-10-01', 'f2000000-0000-0000-0000-000000000001', 'X', '2026-10-01'), 'P0001',
  'Période de paie introuvable.', 'her October draft is not hers to read yet');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.send_payout_periods(array[(select id from public.payout_periods where month = '2026-10-01')]),
  '{"sent": 1, "unpriced": 0}'::jsonb, 'October sent');
select lives_ok(format('select public.validate_payout_period((select id from public.payout_periods where month = %L))', '2026-10-01'),
  'October validated for her');
select throws_ok(format('select public.attach_professional_invoice((select id from public.payout_periods where month = %L), %L, %L, %L)',
                        '2026-10-01', 'f2000000-0000-0000-0000-000000000001', 'X', '2026-10-01'), 'P0001',
  'Fichier introuvable.', 'a file already attached to September never serves October');

-- « Supprimer les brouillons »: only drafts never sent.
reset role;
select is(private.payroll_build('b0000000-0000-0000-0000-00000000000a', '2026-09-01', null) -> 'created', '0'::jsonb, 'September once more');
set local role authenticated;
select is(public.discard_payout_drafts('2026-09-01'), 1, 'September: Pro Deux''s draft (never sent) is discarded, Pro Un''s paid one stays');

-- Another clinic.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok(format('select public.get_payout_period(%L)', current_setting('test.p1')), 'P0001', 'Période de paie introuvable.',
  'another clinic''s administration reads nothing');
reset role;

-- The job.
select matches(private.job_billing_payout_periods(), '^orgs=[0-9]+ periods=[0-9]+$', 'the job runs (it acts on the clinic''s 1st, or a missed 1st within the week)');

select * from finish();
rollback;
