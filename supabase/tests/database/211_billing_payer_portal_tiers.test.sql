-- Facturation: a payer organisation's upload portal (R-84) and a PAE's tiers in the split (R-85)
-- (migration *_billing_payer_portal_tiers.sql, after *_clients_payer_event_tiers.sql). Covers:
-- privileges (the new `save_payer_organisation`); the portal (https only, listed, no « Payeur
-- sans adresse courriel » hold for an organisation with a portal); IVAC's invoice gets the client's
-- event date (`billing_invoice_payer`); the tiers in the split: each tier's boundary across two
-- invoices (the issued shares counted), the agreement's maximum of sessions and of dollars, the
-- prior use counted, the renewal starting the tiers over; an agreement without tiers unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select has_column('public', 'payer_organisations', 'portal_url', 'payer_organisations.portal_url');
select function_privs_are('public', 'save_payer_organisation',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'boolean', 'boolean', 'text', 'text'],
  'authenticated', array['EXECUTE'], 'save_payer_organisation (with the portal): users');
select function_privs_are('public', 'save_payer_organisation',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'boolean', 'boolean', 'text', 'text'],
  'anon', array[]::text[], '… never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a3000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@r85.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b3000000-0000-0000-0000-00000000000a', 'Org R85', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
values ('a3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-00000000000a', 'Adjointe', 'adjointe@r85.test', 'active');
insert into public.user_roles (user_id, org_id, role)
values ('a3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b3000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
select set_config('test.ivac', (select id::text from public.payer_organisations where org_id = 'b3000000-0000-0000-0000-00000000000a' and kind = 'ivac'), true);

insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-00000000000a', 'Hélène', 'Pro', 'pro1@r85.test', 'active', 'female');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b3000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- The 11th of last month (clinic time): the PAE agreements renew on that day each year, so the
-- 7th–11th close a year and the 12th–13th open the next.
select set_config('test.base', (pg_catalog.date_trunc('month', (now() at time zone 'America/Toronto')::date) - interval '1 month' + interval '10 days')::date::text, true);
select set_config('test.m', extract(month from current_setting('test.base')::date)::int::text, true);
-- Ivan (IVAC, an event date), Tess (2 sessions at 100 %, then 50 %, at most 4 sessions a year),
-- Uma (1 session at 80 $, then 30 $, at most 100 $), Vic (3 sessions at 100 %, then 50 %, 2 already
-- used before the app this year).
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-00000000000a', 'Ivan', 'Essai', 'ivan@r85.test'),
  ('d3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-00000000000a', 'Tess', 'Essai', 'tess@r85.test'),
  ('d3000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-00000000000a', 'Uma', 'Essai', 'uma@r85.test'),
  ('d3000000-0000-0000-0000-000000000004', 'b3000000-0000-0000-0000-00000000000a', 'Vic', 'Essai', 'vic@r85.test'),
  ('d3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-00000000000a', 'Wes', 'Essai', 'wes@r85.test'),
  ('d3000000-0000-0000-0000-000000000006', 'b3000000-0000-0000-0000-00000000000a', 'Xan', 'Essai', 'xan@r85.test');
insert into public.client_payers (id, client_id, org_id, kind, organisation_name, file_number, event_on, coverage_percent, session_amount_cents,
                                  max_sessions, max_amount_cents, renewal_month, renewal_day, prior_used_sessions, prior_used_on, coverage_tiers)
values
  ('f3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-00000000000a', 'ivac', null, 'IV-85',
   date '2026-02-14', null, null, null, null, null, null, null, null, '[]'),
  ('f3000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur T', 'PT-1',
   null, 50, null, 4, null, current_setting('test.m')::int, 11, null, null, '[{"sessions": 2, "coverage_percent": 100}]'),
  ('f3000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000003', 'b3000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur T', 'PU-1',
   null, null, 3000, null, 10000, null, null, null, null, '[{"sessions": 1, "session_amount_cents": 8000}]'),
  ('f3000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000004', 'b3000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur T', 'PV-1',
   null, 50, null, null, null, current_setting('test.m')::int, 11, 2, current_setting('test.base')::date - 10, '[{"sessions": 3, "coverage_percent": 100}]'),
  -- Wes: 1 session at 100 %, then 0 $ (the open-ended last coverage may be nothing; a tier may not).
  ('f3000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur T', 'PW-1',
   null, null, 0, null, null, null, null, null, null, '[{"sessions": 1, "coverage_percent": 100}]'),
  -- Xan: 1 session at 100 %, then 50 %; 4 sessions used before the app on the last renewal day a
  -- year ago, so in the year before: they do not count in this one.
  ('f3000000-0000-0000-0000-000000000006', 'd3000000-0000-0000-0000-000000000006', 'b3000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur T', 'PX-1',
   null, 50, null, null, null, current_setting('test.m')::int, 11, 4, (current_setting('test.base')::date - interval '1 year')::date,
   '[{"sessions": 1, "coverage_percent": 100}]');
-- Sessions: g = the day's offset from the 11th.
select set_config('test.s50', (select id::text from public.services where org_id = 'b3000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select x.id, 'b3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', 'completed', t.s + interval '50 minutes'
  from (values ('e3000000-0000-0000-0000-000000000001'::uuid, -4, 8),
               ('e3000000-0000-0000-0000-000000000021'::uuid, -4, 9), ('e3000000-0000-0000-0000-000000000022'::uuid, -3, 9),
               ('e3000000-0000-0000-0000-000000000023'::uuid, -2, 9), ('e3000000-0000-0000-0000-000000000024'::uuid, -1, 9),
               ('e3000000-0000-0000-0000-000000000025'::uuid, 0, 9), ('e3000000-0000-0000-0000-000000000026'::uuid, 1, 9),
               ('e3000000-0000-0000-0000-000000000027'::uuid, 2, 9),
               ('e3000000-0000-0000-0000-000000000031'::uuid, -4, 10), ('e3000000-0000-0000-0000-000000000032'::uuid, -3, 10),
               ('e3000000-0000-0000-0000-000000000033'::uuid, -2, 10),
               ('e3000000-0000-0000-0000-000000000041'::uuid, -4, 11), ('e3000000-0000-0000-0000-000000000042'::uuid, -3, 11),
               ('e3000000-0000-0000-0000-000000000051'::uuid, -4, 12), ('e3000000-0000-0000-0000-000000000052'::uuid, -3, 12),
               ('e3000000-0000-0000-0000-000000000061'::uuid, -4, 13)) as x(id, g, h)
  cross join lateral (select ((current_setting('test.base')::date + x.g + pg_catalog.make_time(x.h, 0, 0)) at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id)
select a.id, ('d3000000-0000-0000-0000-00000000000' || substr(a.id::text, 35, 1))::uuid, 'b3000000-0000-0000-0000-00000000000a'
  from public.appointments a where a.org_id = 'b3000000-0000-0000-0000-00000000000a' and substr(a.id::text, 35, 1) <> '0';
insert into public.appointment_participants (appointment_id, client_id, org_id)
values ('e3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- R-84: the upload portal (https only).
select throws_ok($$ select public.save_payer_organisation(null, 'pae', 'Fournisseur T', null, null, 'fr', null, 'monthly', 30, false, true, null,
                   'http://depot.example.test/') $$,
  'P0001', 'L''adresse du portail de dépôt commence par https:// (une seule adresse, sans espace).', 'a portal over http is refused');
select set_config('test.pt', public.save_payer_organisation(null, 'pae', 'Fournisseur T', 'factures@t.test', null, 'fr', null, 'monthly', 30, false,
  true, null)::text, true);
select set_config('test.i_ivan', public.create_invoice(array['e3000000-0000-0000-0000-000000000001'::uuid], null, false)::text, true);
select lives_ok(format($$ select public.finalize_invoice(%L) $$, current_setting('test.i_ivan')), 'Ivan''s session invoiced');
select set_config('test.p_ivan', (select x::text from pg_catalog.unnest(public.prepare_payer_invoices(current_setting('test.ivac')::uuid)) x), true);
reset role;
select is(private.billing_hold_now((select i from public.invoices i where i.id = current_setting('test.p_ivan')::uuid)), 'payer_missing',
  'IVAC without an address nor a portal: « Payeur sans adresse courriel »');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(format($$ select public.save_payer_organisation(%L, null, 'IVAC', null, null, 'fr', 'FOURN-85', 'monthly', 30, false, true, null,
                         ' https://depot.example.test/ivac ') $$, current_setting('test.ivac')), 'IVAC''s upload portal saved');
select is((select o ->> 'portal_url' from pg_catalog.jsonb_array_elements(public.list_payer_organisations()) o where o ->> 'kind' = 'ivac'),
  'https://depot.example.test/ivac', '… listed, trimmed');
reset role;
select is(private.billing_hold_now((select i from public.invoices i where i.id = current_setting('test.p_ivan')::uuid)), null,
  '… and its invoice is no longer held: it is uploaded, not emailed');
select results_eq($$ select p ->> 'event_on', p ->> 'portal_url', p ->> 'provider_number'
                      from private.billing_invoice_payer((select i from public.invoices i where i.id = current_setting('test.p_ivan')::uuid)) p $$,
  $$ values ('2026-02-14'::text, 'https://depot.example.test/ivac'::text, 'FOURN-85'::text) $$,
  'IVAC''s invoice carries the client''s event date, the portal and the provider number');
select is(private.billing_invoice_payer((select i from public.invoices i where i.id = current_setting('test.i_ivan')::uuid)) ->> 'event_on', null,
  'a client''s own invoice has no event date');

-- R-85: the tiers in the split.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.i_tess_a', public.create_invoice(array['e3000000-0000-0000-0000-000000000021'::uuid, 'e3000000-0000-0000-0000-000000000022'::uuid],
  null, false)::text, true);
reset role;
select set_config('test.price', (select unit_price_cents::text from public.invoice_lines
                                  where invoice_id = current_setting('test.i_tess_a')::uuid and line_type = 'service' limit 1), true);
select ok(current_setting('test.price')::int > 8000, 'the session''s grid price is above 80 $');
select results_eq($$ select -total_cents from public.invoice_lines where invoice_id = current_setting('test.i_tess_a')::uuid and line_type = 'payer_share'
                      order by service_on $$,
  $$ values (current_setting('test.price')::int), (current_setting('test.price')::int) $$, 'Tess: her first two sessions at 100 %');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(format($$ select public.finalize_invoice(%L) $$, current_setting('test.i_tess_a')), '… issued');
select set_config('test.i_tess_b', public.create_invoice(array['e3000000-0000-0000-0000-000000000023'::uuid, 'e3000000-0000-0000-0000-000000000024'::uuid,
  'e3000000-0000-0000-0000-000000000025'::uuid, 'e3000000-0000-0000-0000-000000000026'::uuid, 'e3000000-0000-0000-0000-000000000027'::uuid],
  null, false)::text, true);
reset role;
select results_eq($$ select service_on - current_setting('test.base')::date, -total_cents from public.invoice_lines
                      where invoice_id = current_setting('test.i_tess_b')::uuid and line_type = 'payer_share' order by service_on $$,
  $$ values (-2, round(current_setting('test.price')::int * 0.5)::int), (-1, round(current_setting('test.price')::int * 0.5)::int),
            (1, current_setting('test.price')::int), (2, current_setting('test.price')::int) $$,
  'Tess''s next invoice: the issued sessions counted (3rd and 4th at 50 %), none past the 4 sessions of the year, then the renewal starts the tiers over');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(format($$ select public.finalize_invoice(%L) $$, current_setting('test.i_tess_b')), '… issued with the same shares');
reset role;
select is((select count(*)::int from public.invoice_lines where invoice_id = current_setting('test.i_tess_b')::uuid and line_type = 'payer_share'), 4,
  '… computed again when finalised');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.i_uma', public.create_invoice(array['e3000000-0000-0000-0000-000000000031'::uuid, 'e3000000-0000-0000-0000-000000000032'::uuid,
  'e3000000-0000-0000-0000-000000000033'::uuid], null, false)::text, true);
select set_config('test.i_vic', public.create_invoice(array['e3000000-0000-0000-0000-000000000041'::uuid, 'e3000000-0000-0000-0000-000000000042'::uuid],
  null, false)::text, true);
select set_config('test.i_wes', public.create_invoice(array['e3000000-0000-0000-0000-000000000051'::uuid, 'e3000000-0000-0000-0000-000000000052'::uuid],
  null, false)::text, true);
select set_config('test.i_xan', public.create_invoice(array['e3000000-0000-0000-0000-000000000061'::uuid], null, false)::text, true);
reset role;
select results_eq($$ select -total_cents from public.invoice_lines where invoice_id = current_setting('test.i_uma')::uuid and line_type = 'payer_share'
                      order by service_on $$,
  $$ values (8000), (2000) $$, 'Uma: 80 $ for her first session, then 30 $ capped by the 100 $ maximum, then nothing');
select results_eq($$ select -total_cents from public.invoice_lines where invoice_id = current_setting('test.i_vic')::uuid and line_type = 'payer_share'
                      order by service_on $$,
  $$ values (current_setting('test.price')::int), (round(current_setting('test.price')::int * 0.5)::int) $$,
  'Vic: 2 sessions used before the app, so his first is the third at 100 %, the next at 50 %');

select results_eq($$ select -total_cents from public.invoice_lines where invoice_id = current_setting('test.i_wes')::uuid and line_type = 'payer_share' $$,
  $$ values (current_setting('test.price')::int) $$, 'Wes: his first session at 100 %, then the 0 $ coverage writes no share');
select results_eq($$ select -total_cents from public.invoice_lines where invoice_id = current_setting('test.i_xan')::uuid and line_type = 'payer_share' $$,
  $$ values (current_setting('test.price')::int) $$,
  'Xan: the use before the app dated on the last renewal day belongs to the year before; this year''s tiers start over (100 %)');

select * from finish();
rollback;
