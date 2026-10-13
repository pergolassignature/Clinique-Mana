-- Facturation, batch F3 (migrations *_services_billing_facts, *_appointments_fee_facts, *_billing_follow_up).
-- Covers: privileges; the reminders' settings (billing.settings); the balance rule (off without
-- « Relances à partir du », on at the blocking day, not before); the reminders (the latest due
-- step once, missed steps recorded, never an invoice issued before the start date, the reminder's
-- document); the notice once; « Impayés »; cancellation fees (late cancellations and absences
-- listed once, the professional decides her own, the staff for her, never the conseillère; the
-- fee line at the first then the next percent; waived); lane C's paid fees; refunds (recorded
-- at once, a card one waits for the provider, never more than the payment, the paid amount and
-- QuickBooks' outbox follow, a credit note once refunded); the queue's drafts get the file opening.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f)
  from (values ('set_billing_dunning', array['date', 'integer[]', 'integer']),
               ('decide_cancellation_fee', array['uuid', 'boolean', 'text']),
               ('list_fee_decisions', array['text']),
               ('list_overdue_invoices', array[]::text[]),
               ('refund_payment', array['uuid', 'integer', 'text'])) as x(f, a);
select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': service role only')
  from (values ('refunds_for_service', array['uuid', 'integer']),
               ('finish_refund_for_service', array['uuid', 'uuid', 'boolean', 'text', 'text'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('billing_policy_for', array['uuid', 'date']),
               ('service_id_by_key', array['uuid', 'text']),
               ('appointments_fee_candidates', array['uuid', 'timestamp with time zone', 'timestamp with time zone']),
               ('billing_paid_fees', array['uuid', 'timestamp with time zone']),
               ('client_has_balance', array['uuid', 'uuid'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro1@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro2@a.test',        '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro Un',        'pro1@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro Deux',      'pro2@a.test',        'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'pro1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p.id, t.id, 'L-' || right(p.id::text, 1), true
  from public.professionals p cross join public.profession_titles t
 where p.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.org_id = p.org_id and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Essai', 'zoe@a.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Nadia', 'Essai', 'nadia@a.test');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.price', private.grid_client_price('b0000000-0000-0000-0000-00000000000a',
  (select t.id from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'),
  50::smallint, ((now() at time zone 'America/Toronto')::date - 2))::text, true);
-- e1 Léa (completed, 20 days ago: an old invoice); e2 Zoé (cancelled late, yesterday); e3 Zoé (absent, 2 days ago);
-- e4 Léa with Pro Deux (cancelled late, 3 days ago); e5 Nadia (completed, yesterday: the queue's file opening).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at, cancelled_at, cancel_late)
select x.id, 'b0000000-0000-0000-0000-00000000000a', x.pro, current_setting('test.s50')::uuid,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', x.state,
       case when x.state = 'completed' then t.s + interval '50 minutes' end,
       case when x.state = 'cancelled' then t.s - interval '2 hours' end, x.state = 'cancelled'
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 20, 9, 'completed'),
    ('e0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1, 9, 'cancelled'),
    ('e0000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 2, 9, 'booked'),
    ('e0000000-0000-0000-0000-000000000004'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 3, 9, 'cancelled'),
    ('e0000000-0000-0000-0000-000000000005'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1, 13, 'completed')
  ) as x(id, pro, d, h, state)
  cross join lateral (select (((now() at time zone 'America/Toronto')::date - x.d + pg_catalog.make_time(x.h, 0, 0))
                               at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'expected'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'absent'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'expected'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'present');

-- Léa's old invoice: issued and due 12 days ago, unpaid.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.old', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select public.finalize_invoice(current_setting('test.old')::uuid);
reset role;
update public.invoices set issued_on = (now() at time zone 'America/Toronto')::date - 12, due_on = (now() at time zone 'America/Toronto')::date - 12
 where id = current_setting('test.old')::uuid;

-- The balance rule is off until the reminders start.
select is(private.client_has_balance('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001'), false,
  'no « Relances à partir du »: no balance blocks');
set local role authenticated;
select throws_ok($$ select public.set_billing_dunning(current_date - 30, array[3, 5, 7, 10], 10) $$,
  '42501', 'Permission refusée : billing.settings', 'the reminders: billing.settings');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_billing_dunning(current_date - 30, array[0, 5], 10) $$,
  'P0001', 'Indiquez de 1 à 6 jours de relance, entre 1 et 60 jours après l''échéance.', 'the days: 1 to 60');
select lives_ok($$ select public.set_billing_dunning((now() at time zone 'America/Toronto')::date - 30, array[10, 3, 5, 7], 10) $$,
  'reminders from 30 days ago, at 3, 5, 7 and 10 days');
select is(public.get_billing_settings() -> 'dunning_days', '[3, 5, 7, 10]'::jsonb, '… the days sorted');
select lives_ok($$ select public.set_billing_queue_from((now() at time zone 'America/Toronto')::date - 5) $$, 'the queue starts 5 days ago');
reset role;
select is(private.client_has_balance('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001'), true,
  'unpaid 12 days after its due date: the balance blocks a booking');
update public.billing_settings set block_after_days = 15 where org_id = 'b0000000-0000-0000-0000-00000000000a';
select is(private.client_has_balance('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001'), false,
  '… not before the blocking day');
update public.billing_settings set block_after_days = 10 where org_id = 'b0000000-0000-0000-0000-00000000000a';

-- The follow-up job: the latest due reminder once, the missed ones recorded; the fees to decide.
select is(private.job_billing_follow_up(), 'fees=3 reminders=1', 'three fees to decide, one reminder');
select results_eq($$ select step, delivery_id is not null from public.billing_dunning_runs where invoice_id = current_setting('test.old')::uuid order by step $$,
  $$ values (3::smallint, false), (5::smallint, false), (7::smallint, false), (10::smallint, true) $$,
  'the 10-day reminder sent, 3, 5 and 7 recorded (never sent late)');
select is(private.job_billing_follow_up(), 'fees=0 reminders=0', '… once');
select is((select count(*)::int from public.notifications where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'billing.balance_due'
             and recipient_permission = 'billing.view'), 1, 'the staff told once that the balance blocks');
select is((select count(*)::int from public.notifications where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'billing.balance_due'
             and recipient_user_id = 'a0000000-0000-0000-0000-000000000003'), 1, '… and the invoice''s professional');
select set_config('test.dl', (select delivery_id::text from public.billing_dunning_runs where invoice_id = current_setting('test.old')::uuid and step = 10), true);
select ok(current_setting('test.dl')::uuid = any (public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 50)), 'the reminder is delivered by billing-documents');
select results_eq($$ select d ->> 'kind', d #>> '{document,kind}', (d #>> '{reminder,days}')::int, (d #>> '{reminder,step}')::int, d #>> '{email,to}'
                       from (select public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl')::uuid) d) x $$,
  $$ values ('reminder'::text, 'invoice'::text, 12, 10, 'lea@a.test'::text) $$, '… the invoice''s document, its days and step, to Léa');
-- An invoice issued before « Relances à partir du »: never reminded.
update public.billing_settings set dunning_from = (now() at time zone 'America/Toronto')::date - 11 where org_id = 'b0000000-0000-0000-0000-00000000000a';
delete from public.billing_dunning_runs where invoice_id = current_setting('test.old')::uuid;
select is(private.billing_run_dunning('b0000000-0000-0000-0000-00000000000a', (now() at time zone 'America/Toronto')::date), 0,
  'an invoice issued before the reminders'' start: none');
select is(private.client_has_balance('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001'), false, '… nor a block');
update public.billing_settings set dunning_from = (now() at time zone 'America/Toronto')::date - 30 where org_id = 'b0000000-0000-0000-0000-00000000000a';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select (x ->> 'days')::int, (x ->> 'blocking')::boolean from pg_catalog.jsonb_array_elements(public.list_overdue_invoices()) x $$,
  $$ values (12, true) $$, '« Impayés »: 12 days, blocking');

-- Cancellation fees: the professional decides her own; never the conseillère, never another's.
select results_eq($$ select x ->> 'kind', x ->> 'status' from pg_catalog.jsonb_array_elements(public.list_fee_decisions()) x order by x ->> 'starts_at' $$,
  $$ values ('late_cancellation'::text, 'pending'::text), ('no_show', 'pending'), ('late_cancellation', 'pending') $$,
  'three to decide: two late cancellations and an absence');
select throws_ok($$ select public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000002', true) $$,
  '42501', 'Permission refusée : billing.manage', 'the conseillère does not decide');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(pg_catalog.jsonb_array_length(public.list_fee_decisions()), 1, 'Pro Deux sees her own decision only');
select throws_ok($$ select public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000002', true) $$,
  '42501', 'Permission refusée : billing.manage', '… and never decides another''s');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((x ->> 'fee_percent')::numeric, 50::numeric, 'the first fee: the policy''s first percent')
  from pg_catalog.jsonb_array_elements(public.list_fee_decisions()) x where x ->> 'appointment_id' = 'e0000000-0000-0000-0000-000000000003';
select set_config('test.fee1', public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000003', true)::text, true);
reset role;
select results_eq($$ select l.line_type, l.service_code, l.unit_price_cents, l.professional_id, i.queue_day is not null, i.client_id
                       from public.invoice_lines l join public.invoices i on i.id = l.invoice_id where i.id = current_setting('test.fee1')::uuid $$,
  $$ values ('cancellation_fee'::text, 70300, pg_catalog.round(current_setting('test.price')::int * 0.5)::int, 'c0000000-0000-0000-0000-000000000001'::uuid,
             true, 'd0000000-0000-0000-0000-000000000002'::uuid) $$,
  'applied: a draft in the morning queue, one fee line at 50 % of the session');
select results_eq($$ select status, decided_as, fee_percent from public.cancellation_fee_decisions where appointment_id = 'e0000000-0000-0000-0000-000000000003' $$,
  $$ values ('applied'::text, 'professional'::text, 50.00::numeric) $$, '… decided by the professional');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000003', false) $$,
  'P0001', 'Les frais de ce rendez-vous sont déjà décidés.', 'decided once');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.fee2', public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000002', true, 'Pour la professionnelle')::text, true);
reset role;
select results_eq($$ select c.decided_as, c.fee_percent, l.unit_price_cents from public.cancellation_fee_decisions c
                       join public.invoice_lines l on l.invoice_id = c.invoice_id where c.appointment_id = 'e0000000-0000-0000-0000-000000000002' $$,
  $$ values ('staff'::text, 100.00::numeric, current_setting('test.price')::int) $$, 'the staff for her: Zoé''s second fee, at the next percent');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.decide_cancellation_fee('e0000000-0000-0000-0000-000000000004', false, 'Urgence familiale'), null, '« Ne pas facturer »');
reset role;
select results_eq($$ select status, decided_as, invoice_id is null from public.cancellation_fee_decisions where appointment_id = 'e0000000-0000-0000-0000-000000000004' $$,
  $$ values ('waived'::text, 'professional'::text, true) $$, '… waived, nothing billed');

-- Lane C's paid fees: once paid in full.
select is((select count(*)::int from private.billing_paid_fees('b0000000-0000-0000-0000-00000000000a', now() + interval '1 day')), 0, 'no fee paid yet');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.finalize_invoice(current_setting('test.fee1')::uuid);
select set_config('test.fee1_total', (select total_cents::text from public.invoices where id = current_setting('test.fee1')::uuid), true);
select public.record_payment(current_setting('test.fee1')::uuid, 'interac', current_setting('test.fee1_total')::int);
reset role;
select results_eq($$ select appointment_id, professional_id, amount_cents, service_id = private.service_id_by_key('b0000000-0000-0000-0000-00000000000a', 'late_cancellation_individual')
                       from private.billing_paid_fees('b0000000-0000-0000-0000-00000000000a', now() + interval '1 day') $$,
  $$ values ('e0000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid,
             pg_catalog.round(current_setting('test.price')::int * 0.5)::int, true) $$,
  'paid in full: the fee for the professional''s payroll (before taxes)');

-- Refunds.
select set_config('test.fee1_fr', private.billing_format_money(current_setting('test.fee1_total')::int), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.pay1', (select id::text from public.payments where invoice_id = current_setting('test.fee1')::uuid), true);
select throws_ok($$ select public.refund_payment(current_setting('test.pay1')::uuid, current_setting('test.fee1_total')::int + 1, 'Erreur') $$,
  'P0001', 'Le remboursement va de 0,01 $ à ce qui reste du paiement (' || current_setting('test.fee1_fr') || ').',
  'never more than the payment');
select throws_ok($$ select public.refund_payment(current_setting('test.pay1')::uuid, 100, 'x') $$,
  'P0001', 'La raison du remboursement compte de 3 à 500 caractères.', 'a reason');
select lives_ok($$ select public.refund_payment(current_setting('test.pay1')::uuid, 100, 'Geste commercial') $$, 'a part refunded (Interac: at once)');
reset role;
select results_eq($$ select paid_cents, payment_status from public.invoices where id = current_setting('test.fee1')::uuid $$,
  $$ values (current_setting('test.fee1_total')::int - 100, 'partial'::text) $$, '… the paid amount follows');
select is((select count(*)::int from public.billing_sync_events where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'payment_refunded'), 1,
  '… and QuickBooks'' outbox');
select is((select count(*)::int from private.billing_paid_fees('b0000000-0000-0000-0000-00000000000a', now() + interval '1 day')), 0,
  'a fee refunded in part is not paid in full any more');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.issue_credit_note(current_setting('test.fee1')::uuid, 'Erreur') $$,
  'P0001', 'Cette facture a des paiements : remboursez-les avant de la créditer.', 'not credited while paid');
select lives_ok($$ select public.refund_payment(current_setting('test.pay1')::uuid, current_setting('test.fee1_total')::int - 100, 'Le reste') $$,
  'the rest refunded');
select lives_ok($$ select public.issue_credit_note(current_setting('test.fee1')::uuid, 'Frais annulés') $$, '… then credited');
-- A card payment's refund waits for the provider.
select public.finalize_invoice(current_setting('test.fee2')::uuid);
select set_config('test.fee2_total', (select total_cents::text from public.invoices where id = current_setting('test.fee2')::uuid), true);
select public.record_payment(current_setting('test.fee2')::uuid, 'stripe', current_setting('test.fee2_total')::int);
select set_config('test.r2', public.refund_payment((select id from public.payments where invoice_id = current_setting('test.fee2')::uuid),
  1000, 'Remboursement par carte')::text, true);
reset role;
select results_eq($$ select r.status, i.paid_cents from public.refunds r join public.invoices i on i.id = r.invoice_id where r.id = current_setting('test.r2')::uuid $$,
  $$ values ('pending_provider'::text, current_setting('test.fee2_total')::int) $$, 'a Stripe refund waits for the provider; nothing moves yet');
select results_eq($$ select id from public.refunds_for_service('b0000000-0000-0000-0000-00000000000a', 25) $$,
  $$ values (current_setting('test.r2')::uuid) $$, '… listed for FS');
select lives_ok($$ select public.finish_refund_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r2')::uuid, true, 're_123', null) $$,
  'the provider refunded it');
select results_eq($$ select r.status, r.provider_ref, i.paid_cents from public.refunds r join public.invoices i on i.id = r.invoice_id
                      where r.id = current_setting('test.r2')::uuid $$,
  $$ values ('recorded'::text, 're_123'::text, current_setting('test.fee2_total')::int - 1000) $$, '… recorded, the paid amount lowered');
select throws_ok($$ select public.finish_refund_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.r2')::uuid, true, 're_123', null) $$,
  '22023', 'Unknown or settled refund', 'settled once');

-- The morning queue's drafts now get the file opening (the policy of the clinic named).
select ok(private.job_billing_build_drafts() like 'built=%', 'the queue''s job');
select is((select count(*)::int from public.invoice_lines l join public.billing_queue_items q on q.invoice_id = l.invoice_id
            where q.appointment_id = 'e0000000-0000-0000-0000-000000000005' and l.line_type = 'file_opening'), 1,
  'Nadia''s first draft has the file-opening fee');

select * from finish();
rollback;
