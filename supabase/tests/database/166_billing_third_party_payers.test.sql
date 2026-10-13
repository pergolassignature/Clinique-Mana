-- Facturation FP, part 1 (migrations *_clients_payer_terms, *_billing_third_party_payers).
-- Covers: privileges; the clinic's IVAC and its rate; organisations (a PAE provider added, IVAC
-- kept); Clients' terms (percentage, renewal, prior use, stubs to complete, the import's stubs);
-- the split: IVAC's rate under each session, a PAE's percentage capped by its yearly maximum (the
-- prior use counted), a stub held « à compléter » and never split; the payer invoices (IVAC
-- monthly, a PAE by threshold, each share claimed once, the file number on it, due in the
-- organisation's delay, emailed to its address); a client's invoice whose share is claimed is not
-- credited, a payer's credited frees its shares; never on the client's card, never in the client's
-- balance, a payer's receipt not emailed; a payer's invoice by hand; the April closing notice; the
-- IVAC rate (billing.settings); the conseillère refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

-- Privileges.
select table_privs_are('public', t, 'authenticated', array['SELECT'], t || ': select only')
  from (values ('payer_organisations'), ('billing_payer_rates'), ('client_payer_organisations')) as x(t);
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': users')
  from (values ('list_payer_organisations', array[]::text[]),
               ('save_payer_organisation', array['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'boolean', 'boolean', 'text']),
               ('set_client_payer_organisation', array['uuid', 'uuid']), ('get_payer_settings', array[]::text[]),
               ('set_ivac_rate', array['date', 'integer']), ('get_client_payers_billing', array['uuid']),
               ('list_payer_queue', array[]::text[]), ('prepare_payer_invoices', array['uuid', 'boolean']),
               ('create_payer_invoice', array['uuid']), ('list_client_payers_to_complete', array[]::text[]),
               ('import_client_payers', array['jsonb', 'boolean'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('client_payer_terms', array['uuid', 'uuid', 'date']), ('client_payer_facts', array['uuid', 'uuid[]']),
               ('billing_apply_payer_shares', array['uuid', 'uuid']),
               ('billing_build_payer_invoices', array['uuid', 'uuid', 'boolean', 'uuid'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000002', 'adjointe@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'conseillere@a.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, 'b0000000-0000-0000-0000-00000000000a', n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'Admin A', 'admin@a.test'),
               ('a0000000-0000-0000-0000-000000000002', 'Adjointe A', 'adjointe@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'Conseillère A', 'conseillere@a.test')) as v(u, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);

-- The clinic's IVAC, made for every clinic.
select results_eq($$ select o.kind, o.name, o.cadence, o.reminders_enabled from public.payer_organisations o
                      where o.org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('ivac'::text, 'IVAC'::text, 'monthly'::text, false) $$, 'a new clinic has its IVAC, monthly, no reminders');
select is(private.billing_ivac_rate('b0000000-0000-0000-0000-00000000000a', current_date), 9450, '… which pays 94,50 $ per session');
select set_config('test.ivac', (select id::text from public.payer_organisations where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'ivac'), true);

insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Pro', 'pro1@a.test', 'active', 'female');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Ivan (IVAC), Paula (a PAE: 80 %, 300 $ a year renewed on March 31, 20 $ used before the app),
-- Sam (a PAE stub from the import), Bob (no payer).
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Ivan', 'Essai', 'ivan@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Paula', 'Essai', 'paula@a.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Sam', 'Essai', 'sam@a.test'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Bob', 'Essai', 'bob@a.test'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Ron', 'Essai', 'ron@a.test');
select set_config('test.day', (pg_catalog.date_trunc('month', (now() at time zone 'America/Toronto')::date) - interval '15 days')::date::text, true);
insert into public.client_payers (id, client_id, org_id, kind, organisation_name, file_number, coverage_percent, max_amount_cents,
                                  renewal_month, renewal_day, prior_used_cents, prior_used_on, is_stub) values
  ('f9000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'ivac', null, 'IV-1', null, null, null, null, null, null, false),
  ('f9000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur X', 'PX-9', 80, 30000, 3, 31,
   2000, current_setting('test.day')::date, false),
  ('f9000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'pae', null, null, null, null, 3, 31, null, null, true);
-- Sessions in the middle of last month (clinic time): Ivan e1, Paula e2 e3 e4, Sam e5.
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select x.id, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', 'completed', t.s + interval '50 minutes'
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid, 9), ('e0000000-0000-0000-0000-000000000002'::uuid, 10),
               ('e0000000-0000-0000-0000-000000000003'::uuid, 11), ('e0000000-0000-0000-0000-000000000004'::uuid, 12),
               ('e0000000-0000-0000-0000-000000000005'::uuid, 13)) as x(id, h)
  cross join lateral (select ((current_setting('test.day')::date + pg_catalog.make_time(x.h, 0, 0)) at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a');

set local role authenticated;
-- The adjointe.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.save_payer_organisation(null, 'ivac', 'IVAC 2', null, null, 'fr', null, 'monthly', 30, false, true, null) $$,
  'P0001', 'Un organisme ajouté est un fournisseur de PAE (l''IVAC de la clinique existe déjà).', 'one IVAC only');
select set_config('test.px', public.save_payer_organisation(null, 'pae', 'Fournisseur X', 'factures@x.test', 'Équipe facturation', 'fr', 'F-77',
  'threshold', 45, false, true, null)::text, true);
select throws_ok($$ select public.save_payer_organisation(null, 'pae', 'fournisseur x', null, null, 'fr', null, 'monthly', 30, false, true, null) $$,
  'P0001', 'Un organisme payeur porte déjà ce nom.', 'a name once (case ignored)');
select throws_ok(format($$ select public.save_payer_organisation(%L, 'ivac', 'IVAC', null, null, 'fr', null, 'monthly', 30, false, false, null) $$,
                        current_setting('test.ivac')),
  'P0001', 'L''IVAC de la clinique reste active.', 'IVAC stays active');
select lives_ok(format($$ select public.save_payer_organisation(%L, 'ivac', 'IVAC', 'ivac@qc.test', null, 'fr', 'FOURN-1', 'monthly', 30, false, true, null) $$,
                       current_setting('test.ivac')), 'IVAC''s billing address and the clinic''s provider number');

-- The split.
select set_config('test.i_ivan', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select set_config('test.i_paula', public.create_invoice(array['e0000000-0000-0000-0000-000000000002'::uuid, 'e0000000-0000-0000-0000-000000000003'::uuid,
                                                              'e0000000-0000-0000-0000-000000000004'::uuid], null, false)::text, true);
select set_config('test.i_sam', public.create_invoice(array['e0000000-0000-0000-0000-000000000005'::uuid])::text, true);
reset role;
select set_config('test.price', (select unit_price_cents::text from public.invoice_lines
                                  where invoice_id = current_setting('test.i_ivan')::uuid and line_type = 'service'), true);
select ok(current_setting('test.price')::int > 9450, 'the session''s grid price is above IVAC''s rate');
select results_eq($$ select line_type, total_cents, coalesce(service_on = current_setting('test.day')::date, false) from public.invoice_lines
                      where invoice_id = current_setting('test.i_ivan')::uuid and line_type in ('service', 'payer_share') order by position $$,
  $$ values ('service'::text, current_setting('test.price')::int, false), ('payer_share', -9450, true) $$,
  'Ivan''s draft: the session, then IVAC''s share (94,50 $) on its day');
select alike((select description from public.invoice_lines where invoice_id = current_setting('test.i_ivan')::uuid and line_type = 'payer_share'),
  'Part payée par IVAC — dossier IV-1 (séance du %', '… named with the file number');
select is((select total_cents from public.invoices where id = current_setting('test.i_ivan')::uuid),
  current_setting('test.price')::int - 9450 + coalesce((select sum(total_cents)::int from public.invoice_lines
                                                         where invoice_id = current_setting('test.i_ivan')::uuid and line_type = 'file_opening'), 0),
  '… the client billed the gap (and the file opening)');
-- Paula: 80 % each, the year's 300 $ less the 20 $ used before: 280 $ for her three sessions.
select is((select -sum(total_cents)::int from public.invoice_lines where invoice_id = current_setting('test.i_paula')::uuid and line_type = 'payer_share'),
  least(3 * round(current_setting('test.price')::int * 0.8)::int, 28000), 'Paula''s PAE: 80 % a session, capped by the year''s maximum less the prior use');
select is((select count(*)::int from public.invoice_lines where invoice_id = current_setting('test.i_sam')::uuid and line_type = 'payer_share'), 0,
  'Sam''s stub: never split');
select is(private.billing_hold_now((select i from public.invoices i where i.id = current_setting('test.i_sam')::uuid)), 'payer_incomplete',
  '… held « Payeur tiers à compléter »');

-- Issued: the shares counted on the issued invoices.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.send_invoices(array[current_setting('test.i_ivan')::uuid, current_setting('test.i_paula')::uuid]) s
            where s.error is null), 2, 'Ivan''s and Paula''s invoices sent');
select is((select s.error from public.send_invoices(array[current_setting('test.i_sam')::uuid]) s),
  'Complétez d''abord le payeur tiers du client (IVAC ou PAE) dans son dossier : sinon la séance lui serait facturée en entier.',
  'Sam''s invoice is not sent before his payer is completed');
select results_eq($$ select (x ->> 'used_cents')::int, (x ->> 'budget_low')::boolean, x -> 'organisation' ->> 'name'
                       from pg_catalog.jsonb_array_elements(public.get_client_payers_billing('d0000000-0000-0000-0000-000000000002')) x $$,
  $$ values (least(3 * round(current_setting('test.price')::int * 0.8)::int, 28000) + 2000, true, 'Fournisseur X'::text) $$,
  'Paula''s payer: the year''s use (the prior included), « Budget bas », billed to Fournisseur X');
select is((public.get_client_billing('d0000000-0000-0000-0000-000000000001') ->> 'balance_cents')::int,
  (select total_cents from public.invoices where id = current_setting('test.i_ivan')::uuid), 'Ivan''s balance is his gap only');

-- The payer invoices: IVAC monthly (last month's sessions), the PAE past a third of its maximum.
select set_config('test.drafts', pg_catalog.array_to_string(public.prepare_payer_invoices(), ','), true);
select is(pg_catalog.cardinality(pg_catalog.string_to_array(current_setting('test.drafts'), ',')), 2, 'two payer invoices drafted');
select is(pg_catalog.cardinality(public.prepare_payer_invoices()), 0, 'again: nothing, each share claimed once');
reset role;
select set_config('test.p_ivan', (select id::text from public.invoices where payer_kind = 'organisation' and client_id = 'd0000000-0000-0000-0000-000000000001'), true);
select set_config('test.p_paula', (select id::text from public.invoices where payer_kind = 'organisation' and client_id = 'd0000000-0000-0000-0000-000000000002'), true);
select results_eq($$ select status, payer_client_id::text, payer_organisation_id::text, payer_reference, source_type, notes_client, total_cents
                      from public.invoices where id = current_setting('test.p_ivan')::uuid $$,
  $$ values ('draft'::text, 'd0000000-0000-0000-0000-000000000001'::text, current_setting('test.ivac'), 'IV-1'::text, 'payer'::text,
             'Dossier IVAC n° IV-1'::text, 9450) $$, 'IVAC''s invoice for Ivan: his file number, 94,50 $');
select results_eq($$ select count(*)::int, sum(total_cents)::int from public.invoice_lines
                      where invoice_id = current_setting('test.p_paula')::uuid and line_type = 'payer_claim' and appointment_id is not null $$,
  $$ select count(*)::int, -sum(total_cents)::int from public.invoice_lines
      where invoice_id = current_setting('test.i_paula')::uuid and line_type = 'payer_share' $$, 'the PAE''s invoice: one line per session''s share');
select ok(current_setting('test.p_paula')::uuid = any (pg_catalog.string_to_array(current_setting('test.drafts'), ',')::uuid[]), '… among the drafts made');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select pg_catalog.jsonb_array_length(o -> 'drafts') from pg_catalog.jsonb_array_elements(public.list_payer_queue()) o
            where o -> 'organisation' ->> 'name' = 'Fournisseur X'), 1, '« Payeurs » lists the draft per organisation');
select results_eq($$ select payer_kind, payer_name from public.list_invoices('draft', 'd0000000-0000-0000-0000-000000000002')
                      where id = current_setting('test.p_paula')::uuid $$,
  $$ values ('organisation'::text, 'Fournisseur X'::text) $$, '« Factures » names the organisation as the payer');
select throws_ok(format($$ select public.set_invoice_payer(%L, 'd0000000-0000-0000-0000-000000000002') $$, current_setting('test.p_paula')),
  'P0001', 'La facture d''un organisme payeur garde son payeur.', 'a payer invoice keeps its payer');
select is((select count(*)::int from public.send_invoices(array[current_setting('test.p_ivan')::uuid, current_setting('test.p_paula')::uuid]) s
            where s.error is null), 2, 'the payer invoices sent');
reset role;
select results_eq($$ select due_on - issued_on from public.invoices where id in (current_setting('test.p_ivan')::uuid, current_setting('test.p_paula')::uuid)
                      order by client_id $$,
  $$ values (30), (45) $$, 'due in each organisation''s delay (IVAC 30 days, the PAE 45)');
-- The deliveries: to the organisation's billing address.
update public.billing_deliveries set status = 'sending' where invoice_id = current_setting('test.p_paula')::uuid and kind = 'invoice';
select results_eq($$ select x -> 'email' ->> 'to', x -> 'document' -> 'payer' ->> 'name', x -> 'document' -> 'invoice' ->> 'payer_reference'
                      from public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a',
                             (select id from public.billing_deliveries where invoice_id = current_setting('test.p_paula')::uuid and kind = 'invoice')) x $$,
  $$ values ('factures@x.test'::text, 'Fournisseur X'::text, 'PX-9'::text) $$, 'emailed to the PAE''s billing address, the organisation as payer');
select is((select count(*)::int from pg_catalog.jsonb_array_elements(
              private.billing_lines('b0000000-0000-0000-0000-00000000000a', array[current_setting('test.p_paula')::uuid])) e
            where e ->> 'service_date' is null), 0, '… each line with its session''s date');

-- Credit: the client's invoice waits for the payer's; a payer's credited frees its shares.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select public.issue_credit_note(%L, 'Erreur') $$, current_setting('test.i_paula')),
  'P0001', 'La part du payeur de cette facture lui est déjà facturée : créditez d''abord la facture du payeur.', 'a client''s invoice whose share is claimed');
select lives_ok(format($$ select public.issue_credit_note(%L, 'Erreur de période') $$, current_setting('test.p_paula')), 'the PAE''s invoice credited');
select is(pg_catalog.cardinality(public.prepare_payer_invoices(current_setting('test.px')::uuid)), 1, '… its shares claimed again');

-- Never on the client's card, never in his balance; a payer's receipt is not emailed.
reset role;
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000a', 'stripe_secret_key', vault.create_secret('sk_test_x', 'org:fp:stripe_secret_key'));
insert into public.stripe_customers (org_id, payer_client_id, stripe_customer_id, payment_method_id, card_brand, card_last4,
                                     card_exp_month, card_exp_year, card_status, consent_at)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'cus_Ivan', 'pm_Ivan', 'visa', '4242', 12, 2030,
        'active', now() - interval '1 day');
select results_eq($$ select invoice_id::text from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values (current_setting('test.i_ivan')) $$, 'the card on file: Ivan''s gap only, never IVAC''s invoice');
select is(public.issue_billing_link_for_service('b0000000-0000-0000-0000-00000000000a', 'billing_pay', current_setting('test.p_ivan')::uuid,
            decode(repeat('07', 32), 'hex'), null), false, 'no « Payer en ligne » for IVAC''s invoice');
select lives_ok($$ select private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', current_setting('test.p_ivan')::uuid, 'cheque',
                     9450, null, 'Chèque IVAC', null, null) $$, 'IVAC pays');
select is((select d.send_email from public.billing_deliveries d join public.receipts r on r.id = d.receipt_id
            where r.invoice_id = current_setting('test.p_ivan')::uuid), false, '… its receipt is kept, not emailed');
select is(private.client_has_balance('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002'), false,
  'the PAE''s unpaid invoice never blocks Paula');

-- A payer invoice by hand (a report billed to IVAC).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.manual', public.create_payer_invoice('f9000000-0000-0000-0000-000000000001')::text, true);
select throws_ok($$ select public.create_payer_invoice('f9000000-0000-0000-0000-000000000003') $$, 'P0001',
  'Complétez d''abord ce payeur dans le dossier du client.', 'never for a stub');
reset role;
select results_eq($$ select payer_kind, status, payer_reference from public.invoices where id = current_setting('test.manual')::uuid $$,
  $$ values ('organisation'::text, 'draft'::text, 'IV-1'::text) $$, 'a draft to IVAC for Ivan, its lines to add');

-- Clients: the stubs to complete, the import's stubs, the terms.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select x ->> 'client_name', (x ->> 'is_stub')::boolean, x -> 'missing' from pg_catalog.jsonb_array_elements(public.list_client_payers_to_complete()) x $$,
  $$ values ('Sam Essai'::text, true, '["file_number", "organisation_name", "coverage"]'::jsonb) $$, '« Payeurs à compléter »: Sam''s stub and what it lacks');
select throws_ok($$ select public.save_client_payer('d0000000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-000000000003', 'pae', 'Fournisseur X',
                     'PX-1', 5000, null, null, null, null, null, 80) $$, 'P0001',
  'Le PAE couvre un montant par séance ou une part de la séance, pas les deux.', 'an amount or a share, not both');
select lives_ok($$ select public.save_client_payer('d0000000-0000-0000-0000-000000000003', 'f9000000-0000-0000-0000-000000000003', 'pae', 'Fournisseur X',
                    'PX-1', null, null, 50000, null, null, null, 100, 3, 31) $$, 'Sam''s PAE completed (100 %, 500 $ a year)');
select is(pg_catalog.jsonb_array_length(public.list_client_payers_to_complete()), 0, '… nothing left to complete');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_client_payers('{"client_ref": "gorendezvous:42", "payers": ["ivac"]}', true) $$, '42501',
  'Permission refusée : clients.merge', 'the import''s stubs: the import''s permissions');
reset role;
update public.clients set external_ref = 'gorendezvous:42' where id = 'd0000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_payers('{"client_ref": "gorendezvous:42", "payers": ["ivac", "pae", "ivac"]}', false) ->> 'created', '2',
  'Bob''s tags become two stubs');
select is(public.import_client_payers('{"client_ref": "gorendezvous:42", "payers": ["ivac"]}', false) ->> 'created', '0', '… once');

-- The IVAC rate (billing.settings), from a day.
select lives_ok($$ select public.set_ivac_rate((now() at time zone 'America/Toronto')::date, 9900) $$, 'the admin sets a new IVAC rate');
select is((public.get_payer_settings() ->> 'ivac_rate_cents')::int, 9900, '… in force today');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_ivac_rate(current_date, 9000) $$, '42501', 'Permission refusée : billing.settings', 'not the adjointe');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.prepare_payer_invoices() $$, '42501', 'Permission refusée : billing.manage', 'the conseillère invoices no payer');
reset role;

-- The April closing: a PAE agreement's year ended three days ago with a share left to claim.
insert into public.client_payers (id, client_id, org_id, kind, organisation_name, file_number, coverage_percent, renewal_month, renewal_day)
values ('f9000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'pae',
        'Fournisseur Y', 'PY-1', 100,
        extract(month from (now() at time zone 'America/Toronto')::date - 3)::int, least(extract(day from (now() at time zone 'America/Toronto')::date - 3)::int, 28));
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents, finalized_at)
values ('f8000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '1999-1', 1999, 1, 'issued',
        'd0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', (now() at time zone 'America/Toronto')::date - 20, 0, 0, now());
insert into public.payer_organisations (id, org_id, kind, name, cadence) values
  ('f7000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur Y', 'closing');
insert into public.invoice_lines (org_id, invoice_id, position, line_type, description, quantity, unit_price_cents, subtotal_cents, total_cents,
                                  client_payer_id, payer_organisation_id, service_on) values
  ('b0000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-000000000001', 1, 'service', 'Séance', 1, 5000, 5000, 5000, null, null, null),
  ('b0000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-000000000001', 2, 'payer_share', 'Part', 1, -5000, -5000, -5000,
   'f9000000-0000-0000-0000-000000000009', 'f7000000-0000-0000-0000-000000000001', (now() at time zone 'America/Toronto')::date - 20);
select is(private.job_billing_payer_closing(), 'notices=1', 'the year over: one notice');
select is((select count(*)::int from public.notifications where kind = 'billing.payer_closing' and recipient_permission = 'billing.manage'), 1,
  '… to billing.manage, « Facturer les PAE »');
select is(private.job_billing_payer_closing(), 'notices=1', '… run again the same day');
select is((select count(*)::int from public.notifications where kind = 'billing.payer_closing'), 1, '… still told once');

select * from finish();
rollback;
