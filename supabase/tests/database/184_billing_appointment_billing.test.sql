-- Facturation, parity audit L10 (migration *_billing_appointment_billing): an appointment's billing
-- for Rendez-vous' sheet.
-- Covers: the RPC for users; an appointment not
-- invoiced (invoiceable, the price create_invoice would put, its taxes, the file-opening fee for a
-- first invoice); a professional refused (billing.view first); once invoiced (its line, the invoice's state and payment, no longer invoiceable,
-- no preview); a credited line kept and invoiceable again; a cancelled late appointment (not
-- invoiceable, its fee decision); a personal appointment and another clinic's: null.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select function_privs_are('public', 'get_appointment_billing', array['uuid'], 'authenticated', array['EXECUTE'], 'get_appointment_billing: users');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Adjointe B',    'adjointe@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Essai', 'zoe@a.test');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.price', private.grid_client_price('b0000000-0000-0000-0000-00000000000a',
  (select t.id from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'),
  50::smallint, ((now() at time zone 'America/Toronto')::date - 2))::text, true);
-- e1 Léa (completed, 2 days ago); e2 Zoé (cancelled late, yesterday); e3 Pro Un's personal one.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at, cancelled_at,
                                 cancel_late, is_personal, personal_label)
select x.id, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
       case when x.personal then null else current_setting('test.s50')::uuid end,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', x.state,
       case when x.state = 'completed' then t.s + interval '50 minutes' end,
       case when x.state = 'cancelled' then t.s - interval '2 hours' end, x.state = 'cancelled', x.personal,
       case when x.personal then 'Formation' end
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 2, 9, 'completed', false),
    ('e0000000-0000-0000-0000-000000000002'::uuid, 1, 9, 'cancelled', false),
    ('e0000000-0000-0000-0000-000000000003'::uuid, 1, 13, 'booked', true)
  ) as x(id, d, h, state, personal)
  cross join lateral (select (((now() at time zone 'America/Toronto')::date - x.d + pg_catalog.make_time(x.h, 0, 0))
                               at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'expected');
insert into public.cancellation_fee_decisions (org_id, appointment_id, client_id, professional_id, kind, status, fee_percent, amount_cents)
values ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000001', 'late_cancellation', 'pending', 50, 8750);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') $$, '42501', null,
  'a professional (billing.self, not billing.view) is refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') ->> 'invoiceable')::boolean, true,
  'not invoiced yet: invoiceable');
select is((public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') -> 'preview' ->> 'subtotal_cents')::int,
  current_setting('test.price')::int, '… the price create_invoice would put (Services et tarifs)');
select is((public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') -> 'preview' ->> 'missing')::boolean, false, '… fixed');
select ok(public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') -> 'preview' ? 'file_opening',
  '… the file-opening fee said for a first invoice (or null without one)');
select is(public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') -> 'lines', '[]'::jsonb, '… no line');

select set_config('test.inv', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select results_eq($$ select l ->> 'line_type', l ->> 'status', (l ->> 'credited')::boolean, l ->> 'client_name', (l ->> 'line_total_cents')::int
                       from pg_catalog.jsonb_array_elements(public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') -> 'lines') l $$,
  $$ values ('service'::text, 'draft'::text, false, 'Léa Essai'::text, current_setting('test.price')::int) $$,
  'invoiced: its session line on the draft, the client billed');
select is(public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') -> 'preview', 'null'::jsonb, '… no preview');
select is((public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') ->> 'invoiceable')::boolean, false, '… no longer invoiceable');

select lives_ok($$ select public.finalize_invoice(current_setting('test.inv')::uuid) $$, 'the invoice issued');
select lives_ok($$ select public.issue_credit_note(current_setting('test.inv')::uuid, 'Erreur de service') $$, '… then credited');
select is((public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') ->> 'invoiceable')::boolean, true,
  'a credited line: invoiceable again, the credited line kept in the list');

select results_eq($$ select (b ->> 'invoiceable')::boolean, b -> 'fee' ->> 'kind', b -> 'fee' ->> 'status', (b -> 'fee' ->> 'amount_cents')::int
                       from (select public.get_appointment_billing('e0000000-0000-0000-0000-000000000002') b) x $$,
  $$ values (false, 'late_cancellation'::text, 'pending'::text, 8750) $$, 'cancelled late: not invoiceable, its fee to decide');

select ok(public.get_appointment_billing('e0000000-0000-0000-0000-000000000003') is null
          and public.get_appointment_billing('e0000000-0000-0000-0000-0000000000ff') is null,
  'a personal appointment, an unknown one: null');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select ok(public.get_appointment_billing('e0000000-0000-0000-0000-000000000001') is null, 'another clinic: null');
reset role;

select * from finish();
rollback;
