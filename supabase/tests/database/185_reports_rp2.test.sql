-- Rapports RP2 (migrations *_billing_rp2_report_facts, *_reports_rp2).
-- Covers: privileges (the two RPCs for users, the published facts for no role); the new
-- permission's defaults; « IVAC »: each session IVAC covers in the period in its state (to claim,
-- on a payer draft, claimed, paid in part, paid) and a line billed to IVAC by hand, with the client's file
-- number, the professional's IVAC number, the service and both invoices; the totals per state
-- whatever the state filter; the state and professional filters; an unknown state; « Paie »: the
-- payroll summaries per month and professional with paid and not validated; the permissions (the
-- adjointe IVAC but not the payroll, the conseillère neither), another clinic.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Privileges.
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': users')
  from (values ('report_ivac', array['date', 'date', 'text', 'uuid']), ('report_payouts', array['date', 'date', 'uuid'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('billing_payer_claim_facts', array['uuid', 'date', 'date']), ('billing_payout_facts', array['uuid', 'date', 'date'])) as x(f, a);
select results_eq($$ select role from public.role_permissions where permission_key = 'reports.payroll' order by role $$,
  $$ values ('admin'::text) $$, 'reports.payroll: the admin only by default');

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
select o::uuid, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'), ('b0000000-0000-0000-0000-00000000000b')) as x(o)
  cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports')) as y(m);

insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Pro', 'pro1@a.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Pro', 'pro2@a.test', 'active', 'male');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.professional_payer_numbers (org_id, professional_id, payer_type, number) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'ivac', 'IVAC-123');
-- Four IVAC clients, a session each in the middle of last month: Anne (left on IVAC's draft),
-- Béa (claimed), Cléo (paid), Dina (invoiced after IVAC's invoices were prepared: to claim).
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Anne', 'Ivac', 'anne@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Béa', 'Ivac', 'bea@a.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Cléo', 'Ivac', 'cleo@a.test'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Dina', 'Ivac', 'dina@a.test');
insert into public.client_payers (id, client_id, org_id, kind, file_number)
select ('f9000000-0000-0000-0000-00000000000' || n)::uuid, ('d0000000-0000-0000-0000-00000000000' || n)::uuid,
       'b0000000-0000-0000-0000-00000000000a', 'ivac', 'IV-' || n
  from pg_catalog.generate_series(1, 4) n;
select set_config('test.day', (pg_catalog.date_trunc('month', (now() at time zone 'America/Toronto')::date) - interval '15 days')::date::text, true);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
       current_setting('test.s50')::uuid, t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', 'completed', t.s + interval '50 minutes'
  from pg_catalog.generate_series(1, 4) n
  cross join lateral (select ((current_setting('test.day')::date + pg_catalog.make_time(8 + n, 0, 0)) at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a'
  from pg_catalog.generate_series(1, 4) n;
select set_config('test.ivac', (select id::text from public.payer_organisations where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'ivac'), true);

-- The adjointe bills: the clients' invoices sent, IVAC's prepared, Béa's and Cléo's sent, then Dina's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.save_payer_organisation(current_setting('test.ivac')::uuid, 'ivac', 'IVAC', 'ivac@qc.test', null, 'fr', 'FOURN-1', 'monthly', 30, false, true, null);
select is((select count(*)::int from public.send_invoices(array(
            select public.create_invoice(array[('e0000000-0000-0000-0000-00000000000' || n)::uuid]) from pg_catalog.generate_series(1, 3) n)) s
            where s.error is null), 3, 'Anne''s, Béa''s and Cléo''s invoices sent (IVAC''s share under each)');
select is(pg_catalog.cardinality(public.prepare_payer_invoices(current_setting('test.ivac')::uuid)), 3, 'IVAC''s three invoices prepared');
reset role;
select set_config('test.p2', (select id::text from public.invoices where payer_kind = 'organisation' and client_id = 'd0000000-0000-0000-0000-000000000002'), true);
select set_config('test.p3', (select id::text from public.invoices where payer_kind = 'organisation' and client_id = 'd0000000-0000-0000-0000-000000000003'), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
-- A report billed to IVAC by hand, on Dina's file (Anne's open draft would take it: one draft per payer).
select set_config('test.manual', public.create_payer_invoice('f9000000-0000-0000-0000-000000000004')::text, true);
select set_config('test.report_line', public.add_invoice_line(current_setting('test.manual')::uuid, 'adjustment', null, 'Rédaction de rapport', 1, 5000)::text, true);
select is((select count(*)::int from public.send_invoices(array[current_setting('test.p2')::uuid, current_setting('test.p3')::uuid,
                                                               current_setting('test.manual')::uuid]) s where s.error is null), 3,
  'Béa''s and Cléo''s IVAC invoices and the report sent');
select is((select count(*)::int from public.send_invoices(array[public.create_invoice(array['e0000000-0000-0000-0000-000000000004'::uuid])]) s
            where s.error is null), 1, 'Dina''s invoice sent after');
reset role;
select lives_ok($$ select private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', current_setting('test.p3')::uuid, 'cheque',
                     9450, null, 'Chèque IVAC', null, null) $$, 'IVAC pays Cléo''s');
select lives_ok($$ select private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', current_setting('test.p2')::uuid, 'cheque',
                     4000, null, 'Acompte IVAC', null, null) $$, '… and part of Béa''s');
select set_config('test.report_cents', (select total_cents::text from public.invoice_lines where id = current_setting('test.report_line')::uuid), true);
select set_config('test.from', (current_setting('test.day')::date - 5)::text, true);
select set_config('test.to', (now() at time zone 'America/Toronto')::date::text, true);

-- « IVAC » for the adjointe.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.r', public.report_ivac(current_setting('test.from')::date, current_setting('test.to')::date)::text, true);
select results_eq($$ select x ->> 'client_name', x ->> 'state', (x ->> 'amount_cents')::int, x ->> 'file_number', x ->> 'professional_ivac_number',
                            x ->> 'service_name' is not null, x ->> 'client_invoice_number' is not null, x ->> 'payer_invoice_number' is not null
                       from pg_catalog.jsonb_array_elements(current_setting('test.r')::jsonb -> 'rows') x
                      where not (x ->> 'by_hand')::boolean order by x ->> 'client_name' $$,
  $$ values ('Anne Ivac'::text, 'draft'::text, 9450, 'IV-1'::text, 'IVAC-123'::text, true, true, false),
            ('Béa Ivac', 'partial', 9450, 'IV-2', 'IVAC-123', true, true, true),
            ('Cléo Ivac', 'paid', 9450, 'IV-3', 'IVAC-123', true, true, true),
            ('Dina Ivac', 'to_claim', 9450, 'IV-4', 'IVAC-123', true, true, false) $$,
  'each session IVAC covers: its state, IVAC''s share, the file number, the professional''s IVAC number, the service and the invoices');
select results_eq($$ select x ->> 'client_name', x ->> 'state', (x ->> 'amount_cents')::int, x ->> 'file_number', x ->> 'client_invoice_number',
                            x ->> 'payer_invoice_number' is not null, x ->> 'service_name'
                       from pg_catalog.jsonb_array_elements(current_setting('test.r')::jsonb -> 'rows') x where (x ->> 'by_hand')::boolean $$,
  $$ values ('Dina Ivac'::text, 'claimed'::text, current_setting('test.report_cents')::int, 'IV-4'::text, null::text, true, 'Rédaction de rapport'::text) $$,
  'the report billed by hand: claimed, with its file number');
select is(current_setting('test.r')::jsonb -> 'by_state',
  pg_catalog.jsonb_build_object('to_claim', pg_catalog.jsonb_build_object('count', 1, 'amount_cents', 9450),
                                'draft', pg_catalog.jsonb_build_object('count', 1, 'amount_cents', 9450),
                                'claimed', pg_catalog.jsonb_build_object('count', 1, 'amount_cents', current_setting('test.report_cents')::int),
                                'partial', pg_catalog.jsonb_build_object('count', 1, 'amount_cents', 9450),
                                'paid', pg_catalog.jsonb_build_object('count', 1, 'amount_cents', 9450)),
  'the totals per state');
select is(current_setting('test.r')::jsonb -> 'totals',
  pg_catalog.jsonb_build_object('count', 5, 'amount_cents', 4 * 9450 + current_setting('test.report_cents')::int), 'the totals');
select is((select pg_catalog.jsonb_array_length(r -> 'rows') || '/' || (r -> 'totals' ->> 'count')
             from (select public.report_ivac(current_setting('test.from')::date, current_setting('test.to')::date, 'paid') as r) x),
  '1/5', '« Payée » only: one row, the totals still count everything');
select is(pg_catalog.jsonb_array_length(public.report_ivac(current_setting('test.from')::date, current_setting('test.to')::date, null,
                                                          'c0000000-0000-0000-0000-000000000002') -> 'rows'), 0,
  'another professional: nothing');
select is(pg_catalog.jsonb_array_length(public.report_ivac(current_setting('test.day')::date - 60, current_setting('test.day')::date - 30) -> 'rows'), 0,
  'an earlier period: nothing');
select throws_ok(format($$ select public.report_ivac(%L, %L, 'reported') $$, current_setting('test.from'), current_setting('test.to')),
  'P0001', 'État inconnu : à facturer, en préparation, facturée, payée en partie ou payée.', 'an unknown state');
select throws_ok($$ select public.report_payouts('2026-09-01', '2026-09-30') $$, '42501', null, 'the adjointe: reports.payroll needed');

-- « Paie »: two summaries last month, Hélène's paid, Marc's to validate.
reset role;
insert into public.payout_periods (id, org_id, professional_id, month, state, title_name, lines_count, total_cents) values
  ('a9000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   pg_catalog.date_trunc('month', current_setting('test.day')::date)::date, 'draft', 'Psychologue', 3, 14000),
  ('a9000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
   pg_catalog.date_trunc('month', current_setting('test.day')::date)::date, 'to_validate', null, 0, 30000);
insert into public.payout_lines (org_id, period_id, kind, appointment_id, occurred_on, amount_cents, pricing, note) values
  ('b0000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-000000000001', 'session', 'e0000000-0000-0000-0000-000000000001',
   current_setting('test.day')::date, 6000, 'grid', null),
  ('b0000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-000000000001', 'session', 'e0000000-0000-0000-0000-000000000002',
   current_setting('test.day')::date, 6000, 'grid', null),
  ('b0000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-000000000001', 'adjustment', null,
   current_setting('test.day')::date, 2000, 'manual', 'Prime');
update public.payout_periods set state = 'paid', validated_at = now(), paid_at = now(), paid_on = current_date
 where id = 'a9000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.p', public.report_payouts(current_setting('test.day')::date - 20, current_setting('test.day')::date)::text, true);
select results_eq($$ select x ->> 'professional_name', x ->> 'state', (x ->> 'sessions')::int, (x ->> 'session_cents')::int,
                            (x ->> 'adjustment_cents')::int, (x ->> 'total_cents')::int, x ->> 'paid_on' is not null
                       from pg_catalog.jsonb_array_elements(current_setting('test.p')::jsonb -> 'rows') x order by x ->> 'professional_name' $$,
  $$ values ('Hélène Pro'::text, 'paid'::text, 2, 12000, 2000, 14000, true), ('Marc Pro', 'to_validate', 0, 0, 0, 30000, false) $$,
  'one row per summary: sessions, adjustments, total, paid');
select is(current_setting('test.p')::jsonb -> 'totals',
  '{"periods": 2, "sessions": 2, "total_cents": 44000, "paid_cents": 14000, "to_pay_cents": 0, "not_validated": 1}'::jsonb, 'the totals');
select results_eq($$ select (x ->> 'professionals')::int, (x ->> 'total_cents')::int, (x ->> 'paid_cents')::int, (x ->> 'not_validated')::int
                       from pg_catalog.jsonb_array_elements(current_setting('test.p')::jsonb -> 'by_month') x $$,
  $$ values (2, 44000, 14000, 1) $$, 'per month');
select is(pg_catalog.jsonb_array_length(public.report_payouts(current_setting('test.day')::date - 20, current_setting('test.day')::date,
                                                             'c0000000-0000-0000-0000-000000000002') -> 'rows'), 1, 'one professional');
select throws_ok($$ select public.report_payouts('2025-01-01', '2026-06-30') $$, 'P0001',
  'La période va jusqu''à un an : choisissez-en une plus courte.', 'a year at most');

-- The conseillère neither; another clinic's admin sees nothing of Org A.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(format($$ select public.report_ivac(%L, %L) $$, current_setting('test.from'), current_setting('test.to')), '42501', null,
  'the conseillère: reports.finance needed');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is((public.report_ivac(current_setting('test.from')::date, current_setting('test.to')::date) -> 'totals' ->> 'count')::int
          + (public.report_payouts(current_setting('test.day')::date - 20, current_setting('test.day')::date) -> 'totals' ->> 'periods')::int, 0,
  'another clinic: nothing');

select * from finish();
rollback;
