-- Facturation, batch F1 (migrations *_clients_billing_facts, *_appointments_billing_facts, *_billing_module).
-- Covers: privileges; registry and role defaults; the payment modes; an invoice from an
-- appointment (the session at the grid price, the file-opening fee on the dossier's first invoice,
-- taxes per line rounded on their own); never twice; « Facturé à » (the client, a relation with the
-- right, never one without); the default payer; « Statut Indien »; an amount to type; finalising
-- (`AAAA-N`, gapless, continuing a sequence set by the settings, never backwards); credit notes
-- (the whole invoice, its appointment free again); drafts only are edited; the reads; the handlers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f)
  from (values ('create_invoice', array['uuid[]', 'uuid', 'boolean', 'text', 'text']),
               ('create_manual_invoice', array['uuid', 'uuid']),
               ('add_invoice_line', array['uuid', 'text', 'uuid', 'text', 'numeric', 'integer', 'boolean', 'uuid']),
               ('set_invoice_line_price', array['uuid', 'integer']),
               ('remove_invoice_line', array['uuid']),
               ('set_invoice_payer', array['uuid', 'uuid']),
               ('set_invoice_notes', array['uuid', 'text', 'text']),
               ('delete_invoice_draft', array['uuid']),
               ('finalize_invoice', array['uuid']),
               ('issue_credit_note', array['uuid', 'text']),
               ('set_default_payer', array['uuid', 'uuid']),
               ('set_invoice_sequence', array['integer', 'integer']),
               ('list_invoices', array['text', 'uuid', 'timestamp with time zone', 'integer']),
               ('get_invoice', array['uuid']),
               ('get_client_billing', array['uuid'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('billing_create_service_invoice', array['uuid', 'uuid', 'uuid', 'uuid', 'uuid']),
               ('billing_reassign_client', array['uuid', 'uuid']),
               ('billing_anonymize_client', array['uuid']),
               ('clients_billing_facts', array['uuid', 'uuid[]']),
               ('appointment_billing_facts', array['uuid', 'uuid[]']),
               ('client_billable_appointments', array['uuid', 'uuid', 'date'])) as x(f, a);
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'billing' order by depends_on $$,
  $$ values ('appointments'::text), ('clients'), ('professionals'), ('services') $$, 'billing depends on appointments, clients, professionals, services');
select results_eq($$ select role, pg_catalog.array_agg(permission_key order by permission_key) from public.role_permissions
                      where permission_key like 'billing.%' group by role order by role $$,
  $$ values ('admin'::text, array['billing.manage', 'billing.payroll', 'billing.self', 'billing.settings', 'billing.view']),
            ('admin_assistant', array['billing.manage', 'billing.view']),
            ('counselor', array['billing.view']),
            ('provider', array['billing.self']) $$, 'role defaults');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
select results_eq($$ select code, is_deposit from public.payment_modes where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order $$,
  $$ values ('interac'::text, true), ('stripe', true), ('qbo_payments_card', true), ('bank_transfer', true), ('cheque', true), ('credit_note', false) $$,
  'a new clinic gets the payment modes');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- The psychologue's seeded grid price for 50 minutes in October 2026.
select set_config('test.price', private.grid_client_price('b0000000-0000-0000-0000-00000000000a',
  (select t.id from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'),
  50::smallint, '2026-10-05')::text, true);
-- Léa (the dossier), her parents Camille (the right to receive invoices) and Marc (not), Nadia (« Statut Indien »).
insert into public.clients (id, org_id, first_name, last_name, tax_exempt) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', false),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', false),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', false),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Nadia', 'Essai', true);
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, b_receives_invoices) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'child', 'parent', false),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'child', 'parent', true);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.entered', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a'
                                     and price_source = 'entered' and is_active order by code limit 1), true);
-- Three completed sessions of Léa, one of Nadia, one cancelled.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at, cancelled_at)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2026-10-05 14:00Z', '2026-10-05 14:50Z', '2026-10-05 15:00Z', 'completed', '2026-10-05 15:10Z', null),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2026-10-06 14:00Z', '2026-10-06 14:50Z', '2026-10-06 15:00Z', 'completed', '2026-10-06 15:10Z', null),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2026-10-07 14:00Z', '2026-10-07 14:50Z', '2026-10-07 15:00Z', 'completed', '2026-10-07 15:10Z', null),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2026-10-08 14:00Z', '2026-10-08 14:50Z', '2026-10-08 15:00Z', 'completed', '2026-10-08 15:10Z', null),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2026-10-09 14:00Z', '2026-10-09 14:50Z', '2026-10-09 15:00Z', 'cancelled', null, '2026-10-09 10:00Z');
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', 'Permission refusée : billing.manage', 'the conseillère reads, never bills');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- The first invoice: the session at the grid price, the file-opening fee (taxable), per-line taxes.
select set_config('test.i1', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid], null, null, 'Merci', 'Interne')::text, true);
select results_eq($$ select line_type, unit_price_cents, tax_rule, gst_cents, qst_cents, total_cents from public.invoice_lines
                      where invoice_id = current_setting('test.i1')::uuid order by position $$,
  $$ values ('service'::text, current_setting('test.price')::int, 'exempt'::text, 0, 0, current_setting('test.price')::int),
            ('file_opening', 3783, 'taxable', 189, 377, 4349) $$,
  'the session (the grid price, untaxed) and the file opening (37,83 $ + 1,89 $ + 3,77 $)');
select results_eq($$ select status, number, payer_client_id, payer_kind, subtotal_cents, gst_cents, qst_cents, total_cents, gst_rate, qst_rate
                       from public.invoices where id = current_setting('test.i1')::uuid $$,
  $$ values ('draft'::text, null::text, 'd0000000-0000-0000-0000-000000000001'::uuid, 'client'::text, current_setting('test.price')::int + 3783,
            189, 377, current_setting('test.price')::int + 4349, 0.05::numeric, 0.09975::numeric) $$,
  '… a draft billed to Léa, its totals the lines'' sums, the rates kept');
select results_eq($$ select appointment_id, professional_id from public.invoice_lines where invoice_id = current_setting('test.i1')::uuid and line_type = 'service' $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid) $$, '… the session line names its appointment and professional');
select throws_ok($$ select public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Le rendez-vous du 5 octobre 2026 est déjà facturé.', 'an appointment is invoiced once');
select throws_ok($$ select public.create_invoice(array['e0000000-0000-0000-0000-000000000005'::uuid]) $$,
  'P0001', 'Ce rendez-vous est annulé ou en attente d''acceptation : il ne se facture pas ainsi.', 'a cancelled appointment: not like this');
select throws_ok($$ select public.create_invoice(array['e0000000-0000-0000-0000-000000000002'::uuid, 'e0000000-0000-0000-0000-000000000004'::uuid]) $$,
  'P0001', 'Une facture regroupe les rendez-vous d''un même dossier.', 'one dossier per invoice');

-- « Facturé à »: a relation with the right, never one without (R-61).
select throws_ok($$ select public.set_invoice_payer(current_setting('test.i1')::uuid, 'd0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Cette personne ne peut pas recevoir les factures de ce client : donnez-lui le droit « recevoir reçus et factures » dans ses proches.',
  'Marc has not the right: refused');
select lives_ok($$ select public.set_invoice_payer(current_setting('test.i1')::uuid, 'd0000000-0000-0000-0000-000000000003') $$, 'Camille has it');
select results_eq($$ select payer_client_id, payer_kind from public.invoices where id = current_setting('test.i1')::uuid $$,
  $$ values ('d0000000-0000-0000-0000-000000000003'::uuid, 'relation'::text) $$, '… billed to Camille');

-- Finalising: `AAAA-N`, issued today.
select set_config('test.n1', public.finalize_invoice(current_setting('test.i1')::uuid), true);
select ok(current_setting('test.n1') ~ '^[0-9]{4}-1$', 'finalised: the year''s first number');
select results_eq($$ select status, issued_on = due_on, finalized_by from public.invoices where id = current_setting('test.i1')::uuid $$,
  $$ values ('issued'::text, true, 'a0000000-0000-0000-0000-000000000002'::uuid) $$, '… issued, due on receipt, by the adjointe');
select throws_ok($$ select public.add_invoice_line(current_setting('test.i1')::uuid, 'adjustment', null, 'Rapport', 1, 1000) $$,
  'P0001', 'Cette facture est finalisée : corrigez-la par une note de crédit et une nouvelle facture.', 'a finalised invoice is not edited');
select throws_ok($$ select public.finalize_invoice(current_setting('test.i1')::uuid) $$,
  'P0001', 'Cette facture est finalisée : corrigez-la par une note de crédit et une nouvelle facture.', '… nor finalised twice');
select lives_ok($$ select public.set_invoice_notes(current_setting('test.i1')::uuid, 'Merci', 'Nouvelle note interne') $$,
  'its internal note still changes');
select throws_ok($$ select public.set_invoice_notes(current_setting('test.i1')::uuid, 'Autre', null) $$,
  'P0001', 'La note au client d''une facture finalisée ne change plus.', '… its note to the client does not');

-- The second invoice: no file-opening fee (the dossier has one), the next number.
select set_config('test.i2', public.create_invoice(array['e0000000-0000-0000-0000-000000000002'::uuid])::text, true);
select is((select count(*)::int from public.invoice_lines where invoice_id = current_setting('test.i2')::uuid), 1, 'no second file-opening fee');
select ok(public.finalize_invoice(current_setting('test.i2')::uuid) ~ '^[0-9]{4}-2$', '… and the next number, without a gap');

-- The sequence set by the settings (GOrendezvous's last number), never backwards.
select throws_ok($$ select public.set_invoice_sequence(extract(year from current_date)::int, 600) $$,
  '42501', 'Permission refusée : billing.settings', 'the sequence: billing.settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_invoice_sequence(extract(year from current_date)::int, 1) $$,
  'P0001', 'La facture ' || extract(year from current_date)::int || '-2 existe déjà : la numérotation ne peut pas reculer.', 'never below a number given');
select lives_ok($$ select public.set_invoice_sequence(extract(year from current_date)::int, 600) $$, 'continue after 600');
select set_config('test.i3', public.create_invoice(array['e0000000-0000-0000-0000-000000000003'::uuid])::text, true);
select ok(public.finalize_invoice(current_setting('test.i3')::uuid) ~ '^[0-9]{4}-601$', '… the next is 601');

-- « Statut Indien »: every line exempt.
select set_config('test.i4', public.create_invoice(array['e0000000-0000-0000-0000-000000000004'::uuid])::text, true);
select results_eq($$ select line_type, gst_cents + qst_cents from public.invoice_lines where invoice_id = current_setting('test.i4')::uuid order by position $$,
  $$ values ('service'::text, 0), ('file_opening', 0) $$, '« Statut Indien »: no tax, even on the file opening');
select is((select tax_exempt from public.invoices where id = current_setting('test.i4')::uuid), true, '… kept on the invoice');

-- Rounding per line: 3 × 33,33 $ taxable = 99,99 $ + 5,00 $ + 9,97 $.
select set_config('test.adj', public.add_invoice_line(current_setting('test.i4')::uuid, 'adjustment', null, 'Rédaction de rapport', 3, 3333, true)::text, true);
select results_eq($$ select subtotal_cents, gst_cents, qst_cents, total_cents from public.invoice_lines where id = current_setting('test.adj')::uuid $$,
  $$ values (9999, 0, 0, 9999) $$, 'a taxable adjustment for a tax-exempt client: still exempt');
select set_config('test.m', public.create_manual_invoice('d0000000-0000-0000-0000-000000000002')::text, true);
select set_config('test.adj2', public.add_invoice_line(current_setting('test.m')::uuid, 'adjustment', null, 'Rédaction de rapport', 3, 3333, true)::text, true);
select results_eq($$ select subtotal_cents, gst_cents, qst_cents, total_cents from public.invoice_lines where id = current_setting('test.adj2')::uuid $$,
  $$ values (9999, 500, 997, 11496) $$, 'per line: 99,99 $, TPS 5,00 $ (499,95 rounded), TVQ 9,97 $ (997,40 rounded)');
select throws_ok($$ select public.add_invoice_line(current_setting('test.m')::uuid, 'adjustment', null, '', 1, 100) $$,
  'P0001', 'Décrivez la ligne (300 caractères au plus).', 'an adjustment needs a description');

-- An amount to type: refused at finalising until it is.
select set_config('test.e', public.add_invoice_line(current_setting('test.m')::uuid, 'service', current_setting('test.entered')::uuid)::text, true);
select is((select unit_price_cents from public.invoice_lines where id = current_setting('test.e')::uuid), null, 'a « montant saisi » service: the amount to type');
select throws_ok($$ select public.finalize_invoice(current_setting('test.m')::uuid) $$,
  'P0001', 'Indiquez le montant de chaque ligne « montant saisi à la facture ».', '… refused at finalising');
select lives_ok($$ select public.set_invoice_line_price(current_setting('test.e')::uuid, 8400) $$, '… typed');
select lives_ok($$ select public.remove_invoice_line(current_setting('test.adj2')::uuid) $$, 'a line removed from a draft');
select is((select total_cents from public.invoices where id = current_setting('test.m')::uuid),
  (select total_cents from public.invoice_lines where id = current_setting('test.e')::uuid), '… the totals follow');
select lives_ok($$ select public.delete_invoice_draft(current_setting('test.m')::uuid) $$, 'a draft deleted');

-- A credit note: the whole invoice, its own number, its appointment free again.
select throws_ok($$ select public.issue_credit_note(current_setting('test.i1')::uuid, 'x') $$,
  'P0001', 'La raison de la note de crédit compte de 3 à 500 caractères.', 'a credit note needs a reason');
select lives_ok($$ select public.issue_credit_note(current_setting('test.i1')::uuid, 'Erreur de payeur') $$, 'credited');
select results_eq($$ select c.number ~ '^NC-[0-9]{4}-1$', c.total_cents, i.status from public.credit_notes c join public.invoices i on i.id = c.invoice_id
                      where c.invoice_id = current_setting('test.i1')::uuid $$,
  $$ values (true, current_setting('test.price')::int + 4349, 'credited'::text) $$, '… « NC-AAAA-1 » for the whole amount, the invoice credited');
select throws_ok($$ select public.issue_credit_note(current_setting('test.i1')::uuid, 'Encore') $$,
  'P0001', 'Seule une facture finalisée, pas déjà créditée, reçoit une note de crédit.', 'never twice');
select lives_ok($$ select public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid]) $$, 'its appointment is invoiced again');

-- The default payer.
select throws_ok($$ select public.set_default_payer('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Cette personne ne peut pas recevoir les factures de ce client : donnez-lui le droit « recevoir reçus et factures » dans ses proches.',
  'no default payer without the right');
select lives_ok($$ select public.set_default_payer('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003') $$, 'Camille by default');
select set_config('test.i5', public.create_manual_invoice('d0000000-0000-0000-0000-000000000001')::text, true);
select is((select payer_client_id from public.invoices where id = current_setting('test.i5')::uuid),
  'd0000000-0000-0000-0000-000000000003'::uuid, '… a new invoice goes to her');

-- Reads.
select results_eq($$ select x ->> 'id' from pg_catalog.jsonb_array_elements(public.get_invoice(current_setting('test.i2')::uuid) -> 'payer_options') x order by 1 $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::text), ('d0000000-0000-0000-0000-000000000003') $$, 'who may be billed: Léa and Camille, not Marc');
select results_eq($$ select client_name, payer_name from public.list_invoices(null, 'd0000000-0000-0000-0000-000000000004') $$,
  $$ values ('Nadia Essai'::text, 'Nadia Essai'::text) $$, 'the list names the dossier and the payer');
select is((select pg_catalog.jsonb_array_length(public.get_client_billing('d0000000-0000-0000-0000-000000000001') -> 'to_invoice')), 0,
  'Léa''s three sessions are invoiced: nothing left to invoice');
reset role;

-- Anonymisation keeps the invoices and their amounts, blanks their notes, drops the default payers.
select ok(private.billing_anonymize_client('d0000000-0000-0000-0000-000000000001') >= 1, 'anonymised');
select results_eq($$ select count(*)::int, count(*) filter (where notes_client is not null or notes_internal is not null)::int
                       from public.invoices where client_id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values (5, 0) $$, '… her invoices kept, their notes blanked');
select is((select changed_fields ->> 'notes_internal' from public.audit_log where table_name = 'invoices' and record_id = current_setting('test.i1')
             and changed_fields ? 'notes_internal' and changed_fields ->> 'notes_internal' is not null order by id limit 1),
  '[redacted]', 'the notes are redacted in the audit');

select * from finish();
rollback;
