-- Facturation FS-9: Stripe refunds (migration *_billing_stripe_refunds.sql, over F3's refunds).
-- Covers: privileges (service role only); a Stripe payment's refund waits, an Interac one is
-- recorded at once (F3); the waiting list with the PaymentIntent; one refund's context; settled
-- once (done: the invoice's paid amount lowered; again: false), failed (nothing refunded, the
-- billing staff told); reserved for testers: nothing moves (P3-40); the job and its schedule.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': not for users')
  from (values ('stripe_refunds_due_for_service', array['uuid', 'integer']),
               ('stripe_refund_for_service', array['uuid', 'uuid']),
               ('settle_stripe_refund_for_service', array['uuid', 'uuid', 'boolean', 'text', 'text'])) as x(f, a);
select function_privs_are('public', 'settle_stripe_refund_for_service', array['uuid', 'uuid', 'boolean', 'text', 'text'],
  'service_role', array['EXECUTE'], 'settle_stripe_refund_for_service: the service role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',
        '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
values ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test', 'active');
insert into public.user_roles (user_id, org_id, role)
values ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai');
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, subtotal_cents, total_cents, finalized_at)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-1', 2026, 1, 'issued',
        'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
        (now() at time zone 'America/Toronto')::date, 30000, 30000, now());
-- 200 $ by card through Stripe (the PaymentIntent as reference), 100 $ by Interac.
select set_config('test.p_card', private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
  'stripe', 20000, null, null, 'pi_Paid1', null)::text, true);
select set_config('test.p_card', (select id::text from public.payments where external_ref = 'pi_Paid1'), true);
select lives_ok($$ select private.billing_record_payment('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
  'interac', 10000, null, null, 'interac:test', null) $$, 'paid in full');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.r1', public.refund_payment(current_setting('test.p_card')::uuid, 5000, 'Séance annulée')::text, true);
select set_config('test.r2', public.refund_payment(current_setting('test.p_card')::uuid, 3000, 'Deuxième essai')::text, true);
select lives_ok($$ select public.refund_payment((select id from public.payments where external_ref = 'interac:test'), 1000, 'Trop payé') $$,
  'an Interac refund');
reset role;
select results_eq($$ select status, pg_catalog.count(*)::int from public.refunds group by status order by status $$,
  $$ values ('pending_provider'::text, 2), ('recorded', 1) $$, 'the card''s refunds wait for Stripe; the Interac one is recorded at once');

select results_eq($$ select refund_id::text, amount_cents, payment_intent_id from public.stripe_refunds_due_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values (current_setting('test.r1'), 5000, 'pi_Paid1'::text), (current_setting('test.r2'), 3000, 'pi_Paid1') $$,
  'waiting: the card''s refunds, oldest first, with the PaymentIntent');
select results_eq($$ select x ->> 'payment_intent_id', (x ->> 'amount_cents')::int, (x ->> 'module_open')::boolean
                       from public.stripe_refund_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r1')::uuid) x $$,
  $$ values ('pi_Paid1'::text, 5000, true) $$, 'one refund''s context');
select is(public.stripe_refund_for_service('b0000000-0000-0000-0000-00000000000a',
            (select id from public.refunds where status = 'recorded')), null, 'never an Interac refund');

-- Settled once.
select is(public.settle_stripe_refund_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r1')::uuid, true, 're_Done1', null),
  true, 'Stripe refunded: settled');
select results_eq($$ select status, provider_ref from public.refunds where id = current_setting('test.r1')::uuid $$,
  $$ values ('recorded'::text, 're_Done1'::text) $$, '… recorded with Stripe''s refund');
select is((select paid_cents from public.invoices where id = 'f0000000-0000-0000-0000-000000000001'), 24000,
  '… the invoice''s paid amount lowered (300 $ less 50 $ and 10 $)');
select is(public.settle_stripe_refund_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r1')::uuid, true, 're_Done1', null),
  false, 'the webhook''s copy: already settled');

-- Failed.
select is(public.settle_stripe_refund_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r2')::uuid, false, 're_Bad1',
            'expired_or_canceled_card'), true, 'Stripe refused: settled');
select results_eq($$ select status, error_code from public.refunds where id = current_setting('test.r2')::uuid $$,
  $$ values ('failed'::text, 'expired_or_canceled_card'::text) $$, '… failed, with Stripe''s reason');
select is((select pg_catalog.count(*)::int from public.notifications where kind = 'billing.refund_failed' and recipient_permission = 'billing.manage'), 1,
  '… and the billing staff are told');

-- Reserved for testers: nothing moves.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.r3', public.refund_payment(current_setting('test.p_card')::uuid, 2000, 'Troisième essai')::text, true);
reset role;
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
select is((select pg_catalog.count(*)::int from public.stripe_refunds_due_for_service('b0000000-0000-0000-0000-00000000000a')), 0,
  'reserved for testers: nothing refunded (P3-40)');

select results_eq($$ select j.kind, j.function_name, c.schedule from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
                      where j.key = 'billing.stripe_refunds' $$,
  $$ values ('function'::text, 'billing-stripe-refunds'::text, '*/10 * * * *'::text) $$, 'the job: every 10 minutes');

select * from finish();
rollback;
