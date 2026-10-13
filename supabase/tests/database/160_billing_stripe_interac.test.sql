-- Facturation, batch FS (migrations *_core_webhook_events_stripe_provider.sql, *_billing_stripe_interac.sql).
-- Covers: privileges (service RPCs for the functions only); `stripe` among the webhook providers;
-- one way to record a payment (record_payment unchanged, the private one idempotent on its
-- reference); Stripe not set refuses the card link; the card on file (customer, card, consent,
-- its link revoked, removed); « Payer en ligne » only without a card and with a balance, its
-- checkout for the balance, « paid » once paid; the next-day charge once per invoice, its success
-- recorded once (job and webhook), a refusal told and the invoice left unpaid, nothing while the
-- module is reserved for testers (P3-40); a payment above the balance told; Interac « À
-- rapprocher » (typed, suggested by amount then name, matched once, ignored; from Gmail once per
-- message); the conseillère reads, never writes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': not for users')
  from (values ('begin_billing_checkout_for_service', array['bytea']),
               ('record_stripe_payment_for_service', array['uuid', 'uuid', 'text', 'integer', 'timestamp with time zone']),
               ('begin_stripe_charge_for_service', array['uuid', 'uuid', 'text', 'uuid']),
               ('finish_stripe_charge_for_service', array['uuid', 'uuid', 'text', 'text', 'text']),
               ('record_interac_notice_for_service', array['uuid', 'text', 'date', 'integer', 'text', 'text', 'text'])) as x(f, a);
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': users')
  from (values ('get_client_stripe', array['uuid']), ('list_interac_notices', array['text', 'integer']),
               ('match_interac_notice', array['uuid', 'uuid'])) as x(f, a);
select function_privs_are('private', 'billing_record_payment', array['uuid', 'uuid', 'text', 'integer', 'date', 'text', 'text', 'uuid'],
  'service_role', array[]::text[], 'billing_record_payment: no role');

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
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
select lives_ok($$ select public.claim_webhook_event('stripe', 'b0000000-0000-0000-0000-00000000000a:evt_1',
                                                     'b0000000-0000-0000-0000-00000000000a', 'checkout.session.completed', '{}') $$,
  'stripe is a webhook provider');
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Côté', null);
-- Three issued invoices of Alice (130 $, 175 $, 200 $), one of Bruno (90 $).
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents, finalized_at)
select i::uuid, 'b0000000-0000-0000-0000-00000000000a', n, 2026, s, 'issued', c::uuid, c::uuid,
       (now() at time zone 'America/Toronto')::date, t, t, now()
  from (values ('f0000000-0000-0000-0000-000000000001', '2026-1', 1, 'd0000000-0000-0000-0000-000000000001', 13000),
               ('f0000000-0000-0000-0000-000000000002', '2026-2', 2, 'd0000000-0000-0000-0000-000000000001', 17500),
               ('f0000000-0000-0000-0000-000000000003', '2026-3', 3, 'd0000000-0000-0000-0000-000000000001', 20000),
               ('f0000000-0000-0000-0000-000000000004', '2026-4', 4, 'd0000000-0000-0000-0000-000000000002', 9000)) as v(i, n, s, c, t);
-- One of Alice's finalised the day before her card is saved.
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents, finalized_at)
values ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', '2026-5', 2026, 5, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
        (now() at time zone 'America/Toronto')::date - 1, 5000, 5000, now() - interval '1 day');

-- One way to record a payment.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.record_payment('f0000000-0000-0000-0000-000000000004', 'interac', 9001) $$, 'P0001',
  'Le montant va de 0,01 $ au solde de la facture (90,00 $).', 'record_payment: its checks unchanged');
reset role;
select is(private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 'interac',
            1000, null, null, 'test:ref-1', null),
          private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000004', 'interac',
            1000, null, null, 'test:ref-1', null), 'the same reference: the same receipt');
select is((select count(*)::int from public.payments where invoice_id = 'f0000000-0000-0000-0000-000000000004'), 1, '… one payment');
select is((select count(*)::int from public.billing_deliveries where receipt_id is not null), 1, '… one receipt delivery');

-- Stripe not set.
select throws_ok($$ select public.stripe_card_link_context_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001') $$, 'P0001',
  'Stripe n''est pas configuré : entrez la clé dans Paramètres → Paiements en ligne.', 'no key: no card link');
select is(public.issue_billing_link_for_service('b0000000-0000-0000-0000-00000000000a', 'billing_pay', 'f0000000-0000-0000-0000-000000000001',
            decode(repeat('01', 32), 'hex'), null), false, 'no key: no « Payer en ligne »');
insert into public.org_secrets (org_id, key, vault_secret_id)
values ('b0000000-0000-0000-0000-00000000000a', 'stripe_secret_key', vault.create_secret('sk_test_x', 'org:test:stripe_secret_key'));

-- The card on file.
select throws_ok($$ select public.stripe_card_link_context_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001') $$, '42501',
  'Permission refusée : billing.manage', 'the conseillère sends no card link');
select throws_ok($$ select public.stripe_card_link_context_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002') $$, 'P0001',
  'Ce payeur n''a pas d''adresse courriel : ajoutez-la à son dossier.', 'a payer without an address');
select results_eq($$ select x ->> 'email', x ->> 'first_name', x ->> 'customer_id' from public.stripe_card_link_context_for_service(
                       'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001') x $$,
  $$ values ('alice@exemple.test'::text, 'Alice'::text, null::text) $$, 'the card link''s context');
select lives_ok($$ select public.save_stripe_customer_for_service('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'cus_Alice1') $$,
  'her Stripe customer');
select is(public.issue_billing_link_for_service('b0000000-0000-0000-0000-00000000000a', 'billing_card_setup', 'd0000000-0000-0000-0000-000000000001',
            decode(repeat('02', 32), 'hex'), 'a0000000-0000-0000-0000-000000000002'), true, 'the card link is issued');
select is(public.resolve_billing_card_link((select id from public.secure_links where purpose = 'billing_card_setup')) ->> 'first_name', 'Alice',
  'its page names her');
select results_eq($$ select x ->> 'state', x ->> 'mode', x ->> 'customer_id' from public.begin_billing_checkout_for_service(decode(repeat('02', 32), 'hex')) x $$,
  $$ values ('valid'::text, 'setup'::text, 'cus_Alice1'::text) $$, 'the card link opens a setup checkout');
select is(public.record_stripe_card_for_service('b0000000-0000-0000-0000-00000000000a', 'cus_Alice1', 'pm_Card4242', 'visa', '4242', 12, 2030) ->> 'payer_client_id',
  'd0000000-0000-0000-0000-000000000001', 'Stripe brings back her card');
select results_eq($$ select card_status, card_brand, card_last4, consent_at is not null from public.stripe_customers $$,
  $$ values ('active'::text, 'visa'::text, '4242'::text, true) $$, '… on file, with her consent, never the number');
select is((select count(*)::int from public.secure_links where purpose = 'billing_card_setup' and revoked_at is null), 0,
  '… her card link revoked');
select is(public.record_stripe_card_for_service('b0000000-0000-0000-0000-00000000000a', 'cus_Unknown', 'pm_X', 'visa', '1111', 1, 2030), null,
  'an unknown customer: nothing');

-- « Payer en ligne »: not with a card on file.
select is(public.issue_billing_link_for_service('b0000000-0000-0000-0000-00000000000a', 'billing_pay', 'f0000000-0000-0000-0000-000000000001',
            decode(repeat('03', 32), 'hex'), null), false, 'a card on file: no « Payer en ligne »');

-- The next-day charge.
select results_eq($$ select invoice_id from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a') order by 1 $$,
  $$ values ('f0000000-0000-0000-0000-000000000001'::uuid), ('f0000000-0000-0000-0000-000000000002'), ('f0000000-0000-0000-0000-000000000003') $$,
  'due: her three invoices finalised since her consent (not the one of the day before)');
select throws_ok($$ select public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
                     'f0000000-0000-0000-0000-000000000005', 'manual', 'a0000000-0000-0000-0000-000000000002') $$, 'P0001',
  'Cette facture ne peut pas être prélevée : elle est payée, émise avant l''autorisation de la carte, sans carte au dossier, ou Facturation est réservé aux testeurs.',
  '« Prélever maintenant »: never an invoice from before the consent');
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
select is((select count(*)::int from public.stripe_charges_due_for_service('b0000000-0000-0000-0000-00000000000a')), 0,
  'reserved for testers: nothing charged (P3-40)');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
select set_config('test.c1', (public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-000000000001', 'auto', null) ->> 'charge_id'), true);
select is(public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'auto', null),
  null, 'once per invoice');
select is((select amount_cents from public.stripe_charges where id = current_setting('test.c1')::uuid), 13000, '… for its balance');
select is(public.finish_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 'succeeded',
            'pi_Charge1', null) ->> 'status', 'succeeded', 'the charge succeeds');
select results_eq($$ select payment_status, paid_cents from public.invoices where id = 'f0000000-0000-0000-0000-000000000001' $$,
  $$ values ('paid'::text, 13000) $$, '… the invoice paid');
select is(public.record_stripe_payment_for_service('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
            'pi_Charge1', 13000, now()) ->> 'recorded_cents', '13000', 'the webhook''s copy: the same payment');
select is((select count(*)::int from public.payments where external_ref = 'pi_Charge1'), 1, '… recorded once');
select results_eq($$ select mode_code, amount_cents from public.payments where external_ref = 'pi_Charge1' $$,
  $$ values ('stripe'::text, 13000) $$, '… in mode Stripe');

-- A refusal.
select throws_ok($$ select public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
                     'f0000000-0000-0000-0000-000000000002', 'manual', 'a0000000-0000-0000-0000-000000000004') $$, '42501',
  'Permission refusée : billing.manage', '« Prélever maintenant »: not the conseillère');
select set_config('test.c2', (public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
  'f0000000-0000-0000-0000-000000000002', 'manual', 'a0000000-0000-0000-0000-000000000002') ->> 'charge_id'), true);
select results_eq($$ select x ->> 'charge_id', (x ->> 'resume')::boolean from public.begin_stripe_charge_for_service('b0000000-0000-0000-0000-00000000000a',
                       'f0000000-0000-0000-0000-000000000002', 'manual', 'a0000000-0000-0000-0000-000000000002') x $$,
  $$ values (current_setting('test.c2'), true) $$, 'never two charges in flight: the pending one is resumed (its idempotency key)');
select lives_ok($$ select public.stripe_payment_failed_for_service('b0000000-0000-0000-0000-00000000000a', 'pi_Charge2', 'card_declined',
                     current_setting('test.c2')::uuid) $$, 'the webhook finds the charge by its id (its PaymentIntent never stored)');
select results_eq($$ select status, payment_intent_id, failure_code from public.stripe_charges where id = current_setting('test.c2')::uuid $$,
  $$ values ('failed'::text, 'pi_Charge2'::text, 'card_declined'::text) $$, 'the charge is refused');
select results_eq($$ select payment_status from public.invoices where id = 'f0000000-0000-0000-0000-000000000002' $$,
  $$ values ('unpaid'::text) $$, '… the invoice stays unpaid');
select is((select count(*)::int from public.notifications where kind = 'billing.charge_failed' and recipient_permission = 'billing.manage'), 1,
  '… and the billing staff are told');

-- Card removed: « Payer en ligne » again, for the balance.
select lives_ok($$ select public.stripe_card_removed_for_service('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
                     'a0000000-0000-0000-0000-000000000002') $$, '« Retirer la carte »');
select is(public.issue_billing_link_for_service('b0000000-0000-0000-0000-00000000000a', 'billing_pay', 'f0000000-0000-0000-0000-000000000003',
            decode(repeat('04', 32), 'hex'), null), true, 'without a card: « Payer en ligne »');
select results_eq($$ select x ->> 'state', x ->> 'mode', (x ->> 'amount_cents')::int, x ->> 'invoice_number'
                       from public.begin_billing_checkout_for_service(decode(repeat('04', 32), 'hex')) x $$,
  $$ values ('valid'::text, 'payment'::text, 20000, '2026-3'::text) $$, 'its checkout: the balance of the moment');
select is(public.record_stripe_payment_for_service('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000003',
            'pi_Link1', 25000, now()) ->> 'excess_cents', '5000', 'paid above the balance: recorded up to it');
select is((select count(*)::int from public.notifications where kind = 'billing.stripe_excess'), 1, '… the excess to refund is told');
select is(public.begin_billing_checkout_for_service(decode(repeat('04', 32), 'hex')) ->> 'state', 'paid', 'the link of a paid invoice says so');

-- Interac « À rapprocher ».
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.add_interac_notice(current_date, 17500, 'Alice Tremblay') $$, '42501', 'Permission refusée : billing.manage',
  'the conseillère types no notice');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.n1', public.add_interac_notice((now() at time zone 'America/Toronto')::date, 17500, 'ALICE TREMBLAY', 'Facture 2026-2')::text, true);
select results_eq($$ select (s ->> 'number'), (s ->> 'amount_matches')::boolean, (s ->> 'name_score')::int
                       from jsonb_array_elements(public.list_interac_notices()) n, jsonb_array_elements(n -> 'suggestions') s
                      where n ->> 'id' = current_setting('test.n1') $$,
  $$ values ('2026-2'::text, true, 2) $$, 'suggested: the invoice whose balance is the amount, her name in the sender''s');
select isnt(public.match_interac_notice(current_setting('test.n1')::uuid, 'f0000000-0000-0000-0000-000000000002'), null, '« Rapprocher »');
select results_eq($$ select payment_status from public.invoices where id = 'f0000000-0000-0000-0000-000000000002' $$,
  $$ values ('paid'::text) $$, '… the invoice paid by Interac');
select throws_ok(format('select public.match_interac_notice(%L, %L)', current_setting('test.n1'), 'f0000000-0000-0000-0000-000000000004'),
  'P0001', 'Cet avis est déjà rapproché ou ignoré.', 'a notice is matched once');
select set_config('test.n2', public.add_interac_notice((now() at time zone 'America/Toronto')::date, 50000, 'Inconnu')::text, true);
select throws_ok(format('select public.match_interac_notice(%L, %L)', current_setting('test.n2'), 'f0000000-0000-0000-0000-000000000004'),
  'P0001', 'Le virement (500,00 $) dépasse le solde de la facture (80,00 $) : enregistrez-le en plusieurs paiements depuis les factures, puis ignorez l''avis.',
  'a transfer above the balance is refused');
select lives_ok(format('select public.ignore_interac_notice(%L, %L)', current_setting('test.n2'), 'Pas pour la clinique'), '« Ignorer »');
reset role;
select isnt(public.record_interac_notice_for_service('b0000000-0000-0000-0000-00000000000a', 'msg-1', current_date, 9000, 'Bruno Côté', null, null),
  null, 'from administration@: a notice');
select is(public.record_interac_notice_for_service('b0000000-0000-0000-0000-00000000000a', 'msg-1', current_date, 9000, 'Bruno Côté', null, null),
  null, '… once per message');
select isnt(public.record_interac_notice_for_service('b0000000-0000-0000-0000-00000000000a', 'msg-2', current_date, 8000, 'Bruno Côté', null, null),
  null, 'the one invoice with that balance and his name');
select results_eq($$ select n.status, i.payment_status from public.interac_notices n join public.invoices i on i.id = n.invoice_id
                      where n.source_ref = 'msg-2' $$,
  $$ values ('matched'::text, 'paid'::text) $$, '… is matched at once');
select is((select status from public.interac_notices where source_ref = 'msg-1'), 'to_match', 'no single match: it waits');

select * from finish();
rollback;
