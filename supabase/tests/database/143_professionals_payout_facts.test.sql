-- Professionnels and Services et tarifs, batch FPay (migrations *_professionals_payout_facts.sql,
-- *_services_payout_facts.sql). Covers: no role executes the helpers; a session's pay by the
-- grid (price less the retention in force on its date, a later decision not applied), by an
-- « Entente particulière », and the reasons it cannot be priced; the other kinds' rates; the
-- payroll's facts of a professional (never the SIN nor the bank); a service's facts, a retired
-- one included; another clinic's ids answer nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select function_privs_are('private', f, a, r, array[]::text[], f || ': ' || r)
  from (values ('professional_session_pay', array['uuid', 'uuid', 'uuid', 'smallint', 'date']),
               ('professional_compensation_rate', array['uuid', 'text', 'date']),
               ('professional_payout_facts', array['uuid', 'uuid[]']),
               ('service_payout_facts', array['uuid', 'uuid[]'])) as x(f, a)
  cross join (values ('authenticated'), ('service_role')) as y(r);

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@a.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Deux', 'p2@a.test', 'active', null),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Trois', 'p3@a.test', 'active', null);
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000003'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Pro Un: 28 % from July, 27.5 % from 2026-11-15.
insert into public.professional_retention (org_id, professional_id, retention_pct, decision, effective_from, effective_to) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 28, 'initial', '2026-07-01', '2026-11-15'),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 27.5, 'suggested', '2026-11-15', null);
insert into public.professional_private (professional_id, org_id, gst_number) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '123456789RT0001');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai');
insert into public.professional_client_agreements
  (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'AE', 'd0000000-0000-0000-0000-000000000001',
        50, 10000, 15000, '2026-07-01');

select results_eq($$ select client_price_cents, retention_pct, pay_cents, source
                       from private.professional_session_pay('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                                                             null, 50::smallint, '2026-11-10') $$,
  $$ values (17500, 28.00::numeric, 12600, 'grid'::text) $$, 'the grid: 175 $ less 28 % on the session''s date');
select results_eq($$ select retention_pct, pay_cents
                       from private.professional_session_pay('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                                                             null, 30::smallint, '2026-11-20') $$,
  $$ values (27.50::numeric, 9425) $$, '… the rate in force on that date (27.5 % on a 130 $ session)');
select results_eq($$ select client_price_cents, retention_pct, pay_cents, source
                       from private.professional_session_pay('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                                                             'd0000000-0000-0000-0000-000000000001', 50::smallint, '2026-11-10') $$,
  $$ values (15000, null::numeric, 10000, 'agreement'::text) $$, 'an « Entente particulière » for that client and duration first');
select results_eq($$ select source from private.professional_session_pay('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                                                                         'd0000000-0000-0000-0000-000000000001', 60::smallint, '2026-11-10') $$,
  $$ values ('grid'::text) $$, '… another duration: the grid');
select results_eq($$ select x.source, x.pay_cents is null
                       from (values ('c0000000-0000-0000-0000-000000000002'::uuid, 50::smallint, date '2026-11-10'),
                                    ('c0000000-0000-0000-0000-000000000003', 50, '2026-11-10'),
                                    ('c0000000-0000-0000-0000-000000000001', 50, '2026-06-10')) v(p, d, o)
                      cross join lateral private.professional_session_pay('b0000000-0000-0000-0000-00000000000a'::uuid, v.p, null::uuid, v.d::smallint, v.o::date) x $$,
  $$ values ('no_title'::text, true), ('no_rate', true), ('no_price', true) $$,
  'no primary title, no rate decided, no grid in force on that date: not priced');
select is((select count(*)::int from private.professional_session_pay('b0000000-0000-0000-0000-00000000000b',
           'c0000000-0000-0000-0000-000000000001', null, 50::smallint, '2026-11-10')), 0, 'another clinic''s professional: nothing');
select results_eq($$ select private.professional_compensation_rate('b0000000-0000-0000-0000-00000000000a', k, '2026-11-10')
                       from (values ('late_cancellation'), ('other_fees'), ('workshop')) as x(k) $$,
  $$ values (30.00::numeric), (15.00), (25.00) $$, 'the other kinds'' rates in force');
select is(private.professional_compensation_rate('b0000000-0000-0000-0000-00000000000a', 'other_fees', '2026-06-01'), null,
  '… none before the program');
select results_eq($$ select display_name, title_name, title_label, gst_number, qst_number
                       from private.professional_payout_facts('b0000000-0000-0000-0000-00000000000a',
                              array['c0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000002']) order by 1 $$,
  $$ values ('Pro Deux'::text, null::text, null::text, null::text, null::text),
            ('Pro Un', 'Psychologue', 'Psychologue', '123456789RT0001', null) $$,
  'her name, primary title and tax numbers');
select ok(not exists (select 1 from pg_catalog.pg_proc p where p.proname = 'professional_payout_facts' and p.proargnames && array['sin', 'sin_last3', 'bank_account', 'bank_account_last4']), 'never the SIN nor the bank account');
select is((select count(*)::int from private.service_payout_facts('b0000000-0000-0000-0000-00000000000a', null)),
          (select count(*)::int from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a'),
          'every service of the clinic when no id is given');
select results_eq($$ select code, kind, duration_minutes, grid_duration, is_active, family_code
                       from private.service_payout_facts('b0000000-0000-0000-0000-00000000000a',
                              (select array_agg(id) from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a'
                                                                         and code in (10150, 10157, 30150)))
                      order by code $$,
  $$ values (10150, 'session'::text, 50, 50, true, 10), (10157, 'session', 50, 50, false, 10), (30150, 'session', 50, null, true, 30) $$,
  'a service''s facts, a retired one included');

select * from finish();
rollback;
