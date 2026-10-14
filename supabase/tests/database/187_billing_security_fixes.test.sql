-- Facturation, the pre-cutover security review's fixes (migration *_billing_security_fixes.sql).
-- Covers: (3) the audit redaction of invoices, Interac notices, Stripe customers and payer
-- organisations; (4) the anonymisation of the payments' notes, the payer reference, the credit
-- notes' and refunds' reasons (through the dossier's invoices) and the matched Interac notices;
-- (2) a professional's invoice QuickBooks has is never replaced nor detached by a reopening;
-- (8) an imported invoice is never in the payroll nor charged the next day; (7) a Gmail transfer
-- recorded by itself only on both names; (10) a pending charge resumes only within the balance;
-- (5) the fee decision's permission before its lock; (6) the payer's lock; (1) a new QuickBooks
-- company keeps none of the old one's ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@sf.test'), ('a0000000-0000-0000-0000-000000000002', 'adjointe@sf.test'),
               ('a0000000-0000-0000-0000-000000000003', 'pro1@sf.test'), ('a0000000-0000-0000-0000-000000000004', 'conseillere@sf.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, 'b0000000-0000-0000-0000-00000000000a', n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'Admin A', 'admin@sf.test'),
               ('a0000000-0000-0000-0000-000000000002', 'Adjointe A', 'adjointe@sf.test'),
               ('a0000000-0000-0000-0000-000000000003', 'Pro Un', 'pro1@sf.test'),
               ('a0000000-0000-0000-0000-000000000004', 'Conseillère A', 'conseillere@sf.test')) as v(u, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pro', 'Un', 'pro1@sf.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@sf.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Côté', null);
create function pg_temp.svc(p_code int) returns uuid language sql as $$
  select id from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = p_code $$;
create function pg_temp.audit(p_table text, p_id text) returns jsonb language sql as $$
  select changed_fields from public.audit_log where table_name = p_table and record_id = p_id order by id desc limit 1 $$;

-- =============================================================================
-- 3. The audit log never holds the free texts nor the payment facts
-- =============================================================================
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents,
                             finalized_at, hold_note, payer_reference)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-1', 2026, 1, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', (now() at time zone 'America/Toronto')::date,
        13000, 13000, now(), 'Note de retenue', 'DOS-123');
select results_eq($$ select a ->> 'hold_note', a ->> 'payer_reference', a ->> 'number'
                       from pg_temp.audit('invoices', 'f0000000-0000-0000-0000-000000000001') a $$,
  $$ values ('[redacted]'::text, '[redacted]'::text, '2026-1'::text) $$, 'invoices: the hold note and the payer''s reference redacted');
insert into public.interac_notices (id, org_id, received_on, amount_cents, sender_name, message, reference, status, ignored_reason)
values ('f2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', current_date, 4200, 'Expéditeur Inconnu',
        'Un message', 'REF-42', 'ignored', 'Pas pour la clinique');
select results_eq($$ select a ->> 'sender_name', a ->> 'message', a ->> 'reference', a ->> 'ignored_reason', (a ->> 'amount_cents')::int
                       from pg_temp.audit('interac_notices', 'f2000000-0000-0000-0000-000000000001') a $$,
  $$ values ('[redacted]'::text, '[redacted]'::text, '[redacted]'::text, '[redacted]'::text, 4200) $$,
  'interac_notices: the sender, the message, the reference and the reason redacted');
insert into public.stripe_customers (org_id, payer_client_id, stripe_customer_id, payment_method_id, card_brand, card_last4,
                                     card_exp_month, card_exp_year, card_status, consent_at)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'cus_Alice1', 'pm_Card4242', 'visa', '4242',
        12, 2030, 'active', now() - interval '1 day');
select results_eq($$ select a ->> 'stripe_customer_id', a ->> 'payment_method_id', a ->> 'card_brand', a ->> 'card_last4',
                            a ->> 'card_exp_month', a ->> 'card_exp_year', a ->> 'card_status'
                       from pg_temp.audit('stripe_customers', 'b0000000-0000-0000-0000-00000000000a:d0000000-0000-0000-0000-000000000001') a $$,
  $$ values ('[redacted]'::text, '[redacted]'::text, '[redacted]'::text, '[redacted]'::text, '[redacted]'::text, '[redacted]'::text,
             'active'::text) $$, 'stripe_customers: the Stripe ids and the card redacted');
insert into public.payer_organisations (id, org_id, kind, name, cadence, contact_name, billing_email, note)
values ('f3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'PAE Essai', 'monthly',
        'Contact Essai', 'factures@pae.test', 'Une note');
select results_eq($$ select a ->> 'contact_name', a ->> 'billing_email', a ->> 'note', a ->> 'name'
                       from pg_temp.audit('payer_organisations', 'f3000000-0000-0000-0000-000000000001') a $$,
  $$ values ('[redacted]'::text, '[redacted]'::text, '[redacted]'::text, 'PAE Essai'::text) $$,
  'payer_organisations: the contact and the billing address redacted');

-- =============================================================================
-- 4. Anonymising Alice clears what her dossier's invoices hold, whoever paid them
-- =============================================================================
-- Alice's invoice paid by Bruno (a relation): his payment's note, its refund, its credit note, the matched transfer.
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_kind, payer_client_id, issued_on,
                             subtotal_cents, total_cents, finalized_at, payer_reference)
values ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '2026-2', 2026, 2, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'relation', 'd0000000-0000-0000-0000-000000000002',
        (now() at time zone 'America/Toronto')::date, 5000, 5000, now(), 'DOS-9');
insert into public.payments (id, org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on, reference, note)
values ('f4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002',
        'd0000000-0000-0000-0000-000000000002', 'interac', 5000, current_date, 'REF-1', 'Payé pour sa fille');
insert into public.refunds (org_id, payment_id, invoice_id, amount_cents, reason, status)
values ('b0000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002',
        1000, 'Séance annulée par Alice', 'recorded');
insert into public.credit_notes (org_id, invoice_id, number, year, seq, reason, issued_on, subtotal_cents, gst_cents, qst_cents, total_cents)
values ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002', 'NC-2026-1', 2026, 1,
        'Erreur sur la facture d''Alice', current_date, 5000, 0, 0, 5000);
insert into public.interac_notices (id, org_id, received_on, amount_cents, sender_name, message, reference, status, invoice_id,
                                    payment_id, matched_at)
values ('f2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', current_date, 5000, 'Bruno Côté',
        'Pour Alice', 'R-1', 'matched', 'f0000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', now());
select ok(private.billing_anonymize_client('d0000000-0000-0000-0000-000000000001') >= 5, 'Alice anonymised');
select results_eq($$ select payer_reference, hold_note from public.invoices where id in ('f0000000-0000-0000-0000-000000000001',
                       'f0000000-0000-0000-0000-000000000002') order by id $$,
  $$ values (null::text, null::text), (null, null) $$, 'her invoices: no payer reference, no hold note');
select results_eq($$ select reference, note from public.payments where id = 'f4000000-0000-0000-0000-000000000001' $$,
  $$ values (null::text, null::text) $$, 'the payment Bruno made for her dossier: no reference, no note');
select is((select reason from public.refunds where payment_id = 'f4000000-0000-0000-0000-000000000001'), 'Anonymisé',
  'its refund''s reason (through her invoice)');
select is((select reason from public.credit_notes where invoice_id = 'f0000000-0000-0000-0000-000000000002'), 'Anonymisé',
  'her credit note''s reason');
select results_eq($$ select sender_name, message, reference from public.interac_notices where id = 'f2000000-0000-0000-0000-000000000002' $$,
  $$ values ('Anonymisé'::text, null::text, null::text) $$, 'the transfer matched to her invoice: no sender, message or reference');
select results_eq($$ select sender_name, message from public.interac_notices where id = 'f2000000-0000-0000-0000-000000000001' $$,
  $$ values ('Expéditeur Inconnu'::text, 'Un message'::text) $$, '… a notice matched to nobody of hers is left alone');

-- =============================================================================
-- 2. A professional's invoice QuickBooks has: never replaced, its period never reopened
-- =============================================================================
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
select f::uuid, 'b0000000-0000-0000-0000-00000000000a', u.bucket,
       'b0000000-0000-0000-0000-00000000000a/billing/c0000000-0000-0000-0000-000000000001/' || f || '.pdf',
       'billing', u.key, 'payout_period', 'c0000000-0000-0000-0000-000000000001', 'billing.payroll', 'facture.pdf',
       'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now()
  from public.upload_purposes u
 cross join (values ('e0000000-0000-0000-0000-000000000001'), ('e0000000-0000-0000-0000-000000000002'),
                    ('e0000000-0000-0000-0000-000000000003')) as x(f)
 where u.key = 'billing_professional_invoice';
insert into public.payout_periods (id, org_id, professional_id, month, state, validated_at, lines_count, total_cents) values
  ('f5000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   date '2026-09-01', 'validated', now(), 1, 345000),
  ('f5000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
   date '2026-09-01', 'validated', now(), 1, 120000);
insert into public.professional_invoices (id, org_id, period_id, source, file_id, number, issued_on, amount_cents) values
  ('f6000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001',
   'uploaded', 'e0000000-0000-0000-0000-000000000001', 'PU-2026-09', date '2026-10-01', 345000),
  ('f6000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000002',
   'uploaded', 'e0000000-0000-0000-0000-000000000003', 'PD-2026-09', date '2026-10-01', 120000);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select isnt(public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '123145', 'sandbox', 'Clinique A', 'acc-1', 'ref-1', now() + interval '1 hour', now() + interval '100 days'), null,
  'fixture: a QuickBooks company');
-- Pro Un's bill: tried once (pending).
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'bill', 'f6000000-0000-0000-0000-000000000001',
  null, null, null, null, 'provider_error'), 'pending', 'fixture: her bill''s push is pending');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.reopen_payout_period('f5000000-0000-0000-0000-000000000001', 'Erreur de calcul') $$, 'P0001',
  'La facture de cette période est déjà envoyée à QuickBooks : la période ne se rouvre plus. Annulez d''abord la facture fournisseur dans QuickBooks, puis corrigez l''écart par un ajustement sur la paie du mois suivant.',
  'a period whose bill is being pushed is not reopened');
reset role;
select throws_ok($$ select private.payroll_record_invoice((select p from public.payout_periods p where p.id = 'f5000000-0000-0000-0000-000000000001'),
                     'uploaded', 'e0000000-0000-0000-0000-000000000002', 'PU-2026-09b', date '2026-10-02', 'a0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'La facture de cette période est déjà envoyée à QuickBooks : elle ne se remplace plus. Annulez d''abord la facture fournisseur dans QuickBooks, puis corrigez l''écart par un ajustement sur la paie du mois suivant.',
  '… nor its invoice replaced');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.record_qbo_push_for_service('b0000000-0000-0000-0000-00000000000a', 'bill', 'f6000000-0000-0000-0000-000000000001',
  null, null, '901', null, null), 'pushed', 'her bill pushed');
reset role;
select is((select qbo_bill_id from public.professional_invoices where id = 'f6000000-0000-0000-0000-000000000001'), '901', '… its Bill id kept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.reopen_payout_period('f5000000-0000-0000-0000-000000000001', 'Erreur de calcul') $$, 'P0001', null,
  'a pushed bill: the period is not reopened (one Bill per invoice)');
select lives_ok($$ select public.reopen_payout_period('f5000000-0000-0000-0000-000000000002', 'Erreur de calcul') $$,
  'a period whose invoice QuickBooks has not: reopened as before');
reset role;
select is((select count(*)::int from public.professional_invoices where period_id = 'f5000000-0000-0000-0000-000000000002'), 0,
  '… its invoice detached');
select ok(exists (select 1 from public.professional_invoices where id = 'f6000000-0000-0000-0000-000000000001'),
  'the pushed one stays');

-- =============================================================================
-- 8. An imported invoice is never in the payroll nor charged the next day
-- =============================================================================
-- Two reports (Autres frais, 50400) by Pro Un in August: one imported from GOrendezvous, one made in the app.
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents,
                             source_type, external_ref, finalized_at)
values ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', '2026-3', 2026, 3, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', date '2026-08-15', 20000, 20000,
        'import', 'gorendezvous:2026-0000001', now()),
       ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', '2026-4', 2026, 4, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', date '2026-08-16', 20000, 20000,
        'manual', null, now());
insert into public.invoice_lines (id, org_id, invoice_id, position, line_type, professional_id, service_id, service_code, description,
                                  unit_price_cents, price_source, subtotal_cents, total_cents, credited) values
  ('f1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003', 1, 'service',
   'c0000000-0000-0000-0000-000000000001', pg_temp.svc(50400), 50400, 'Rédaction de rapport', 20000, 'import', 20000, 20000, false),
  ('f1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 1, 'service',
   'c0000000-0000-0000-0000-000000000001', pg_temp.svc(50400), 50400, 'Rédaction de rapport', 20000, 'entered', 20000, 20000, false);
select lives_ok($$ select private.payroll_build('b0000000-0000-0000-0000-00000000000a', date '2026-08-01', 'a0000000-0000-0000-0000-000000000001') $$,
  'August''s payroll built');
select results_eq($$ select l.invoice_line_id from public.payout_lines l join public.payout_periods p on p.id = l.period_id
                      where p.month = date '2026-08-01' and l.invoice_line_id is not null order by 1 $$,
  $$ values ('f1000000-0000-0000-0000-000000000004'::uuid) $$, 'the report made in the app is paid, the imported one never');
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000a', 'stripe_secret_key', vault.create_secret('sk_test_x', 'org:test:stripe_secret_key'));
-- Alice's card (consent yesterday); an imported invoice of today and one made in the app.
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents,
                             source_type, external_ref, finalized_at)
values ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', '2026-5', 2026, 5, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', (now() at time zone 'America/Toronto')::date,
        7000, 7000, 'import', 'gorendezvous:2026-0000002', now());
select is((select count(*)::int from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a')
            where invoice_id = 'f0000000-0000-0000-0000-000000000005'), 0, 'the next-day charge never takes an imported invoice');
select is((select count(*)::int from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a')
            where invoice_id = 'f0000000-0000-0000-0000-000000000001'), 1, '… it still takes the one made in the app');

-- =============================================================================
-- 10. A pending charge resumes only when the invoice could be charged now
-- =============================================================================
select set_config('test.c1', (public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-000000000001', 'auto', null) ->> 'charge_id'), true);
select results_eq($$ select x ->> 'charge_id', (x ->> 'resume')::boolean
                       from public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
                              'f0000000-0000-0000-0000-000000000001', 'auto', null) x $$,
  $$ values (current_setting('test.c1'), true) $$, 'a charge in flight is resumed while the invoice still owes it');
-- Paid in part meanwhile (50 $ by Interac): the 130 $ charge is no longer resumed.
update public.invoices set paid_cents = 5000, payment_status = 'partial' where id = 'f0000000-0000-0000-0000-000000000001';
select is(public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'auto', null),
  null, 'the balance fell below the charge: the job does not resume it');
select throws_ok($$ select public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
                     'f0000000-0000-0000-0000-000000000001', 'manual', 'a0000000-0000-0000-0000-000000000002') $$, 'P0001', null,
  '… nor « Prélever maintenant »');
update public.invoices set paid_cents = 0, payment_status = 'unpaid', status = 'credited', credited_at = now()
 where id = 'f0000000-0000-0000-0000-000000000001';
select is(public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'auto', null),
  null, 'a credited invoice: never resumed');
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
update public.invoices set status = 'issued', credited_at = null where id = 'f0000000-0000-0000-0000-000000000001';
select is(public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'auto', null),
  null, 'reserved for testers: never resumed (P3-40)');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';

-- =============================================================================
-- 7. A Gmail transfer is recorded by itself only on both names
-- =============================================================================
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents, finalized_at)
values ('f0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', '2026-6', 2026, 6, 'issued',
        'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', (now() at time zone 'America/Toronto')::date,
        9100, 9100, now());
select isnt(public.record_interac_notice_for_service('b0000000-0000-0000-0000-00000000000a', 'msg-a', current_date, 9100, 'M CÔTÉ', null, null),
  null, 'a transfer from « M CÔTÉ » (his last name only)');
select results_eq($$ select status, invoice_id from public.interac_notices where source_ref = 'msg-a' $$,
  $$ values ('to_match'::text, null::uuid) $$, '… waits « À rapprocher » (suggested, never recorded by itself)');
select is((select payment_status from public.invoices where id = 'f0000000-0000-0000-0000-000000000006'), 'unpaid', '… the invoice unpaid');
select isnt(public.record_interac_notice_for_service('b0000000-0000-0000-0000-00000000000a', 'msg-b', current_date, 9100, 'Bruno Côté', null, null),
  null, 'a transfer from « Bruno Côté »');
select results_eq($$ select n.status, i.payment_status from public.interac_notices n join public.invoices i on i.id = n.invoice_id
                      where n.source_ref = 'msg-b' $$,
  $$ values ('matched'::text, 'paid'::text) $$, '… both names: recorded at once');

-- =============================================================================
-- 5. The fee decision: the permission before the lock; 6. the payer's lock
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000099', true) $$, '42501',
  'Permission refusée : billing.manage', 'the conseillère decides no fee');
reset role;
select ok((select strpos(d, 'has_permission(''billing.self'')') < strpos(d, 'for update')
             from (select pg_get_functiondef('public.decide_cancellation_fee(uuid, boolean, text)'::regprocedure) d) x),
  '… refused before any row is locked');
select ok((select pg_get_functiondef('private.billing_apply_payer_shares(uuid, uuid)'::regprocedure)
             ~ 'pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(''billing\.payer:'' \|\| t\.client_payer_id::text, 0\)\)'),
  'the payer''s shares are computed under the payer''s lock');

-- =============================================================================
-- 1. A new QuickBooks company keeps none of the old one's ids
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.replace_qbo_items('b0000000-0000-0000-0000-00000000000a', $j$[
  {"id":"501","name":"10150 Consultation individuelle","sku":"10150","item_type":"Service","income_account_id":"10","active":true}]$j$);
select public.replace_qbo_tax_codes('b0000000-0000-0000-0000-00000000000a', $j$[{"id":"4","name":"TPS/TVQ","taxable":true,"active":true}]$j$);
select public.record_qbo_vendor_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '77');
select public.record_qbo_organisation_link_for_service('b0000000-0000-0000-0000-00000000000a', 'organisation',
  'f3000000-0000-0000-0000-000000000001', null, '88', 'created');
select is(public.disconnect_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'), true,
  '« Déconnecter »');
reset role;
select results_eq($$ select (select count(*) from public.qbo_vendor_links)::int, (select count(*) from public.qbo_organisation_links)::int,
                            (select count(*) from public.qbo_items)::int, (select count(*) from public.qbo_tax_codes)::int,
                            (select count(*) from public.qbo_pushes)::int $$,
  $$ values (1, 1, 1, 1, 1) $$, 'fixture: the old company''s vendor, organisation, item, tax code and push');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select public.store_qbo_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '999999', 'production', 'Clinique A (vraie)', 'acc-2', 'ref-2', now() + interval '1 hour', now() + interval '100 days') $$,
  'connected to another company');
reset role;
select results_eq($$ select (select count(*) from public.qbo_vendor_links)::int, (select count(*) from public.qbo_organisation_links)::int,
                            (select count(*) from public.qbo_items)::int, (select count(*) from public.qbo_tax_codes)::int,
                            (select count(*) from public.qbo_pushes)::int $$,
  $$ values (0, 0, 0, 0, 0) $$, '… none of the old company''s vendors, organisations, items, tax codes or pushes stays');
select results_eq($$ select qbo_bill_id, exported_at from public.professional_invoices where id = 'f6000000-0000-0000-0000-000000000001' $$,
  $$ values (null::text, null::timestamptz) $$, '… nor the old company''s Bill id on her invoice');

select * from finish();
rollback;
