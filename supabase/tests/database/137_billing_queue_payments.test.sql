-- Facturation, batch F2 (migration *_billing_queue_payments.sql).
-- Covers: privileges; the queue's start date (billing.settings); the job: yesterday's completed
-- sessions become drafts once (not today's, not before the start date, not again after a draft is
-- deleted), held for a dossier's agreement or a professional's, live holds (no address); the
-- queue's list; « Mettre en attente » / « Remettre »; « Envoyer » one or several (a refusal for one
-- leaves the others, no number lost); the deliveries (claimed once, the document with the
-- supervisor, the email only when asked and to an address, P3-40: set aside while reserved, the
-- template's module closed; tried again, then done; the PDF kept once); payments (the balance,
-- the modes, the date), receipts `R-AAAA-N`, the payment state; a credit note waits for refunds
-- on a paid invoice, and is emailed when the invoice was; statements; the agreement RPC; the reads.
begin;
create extension if not exists pgtap with schema extensions;
select plan(98);

select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f)
  from (values ('get_billing_settings', array[]::text[]),
               ('set_billing_queue_from', array['date']),
               ('set_special_agreement', array['uuid', 'text']),
               ('list_morning_queue', array[]::text[]),
               ('hold_invoice_draft', array['uuid', 'text']),
               ('release_invoice_draft', array['uuid']),
               ('send_invoices', array['uuid[]']),
               ('send_billing_document', array['text', 'uuid']),
               ('record_payment', array['uuid', 'text', 'integer', 'date', 'text']),
               ('create_statement', array['uuid', 'integer', 'uuid', 'boolean']),
               ('get_billing_document', array['text', 'uuid'])) as x(f, a);
select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': service role only')
  from (values ('billing_deliveries_for_service', array['uuid', 'integer']),
               ('billing_document_for_service', array['uuid', 'uuid']),
               ('finish_billing_delivery_for_service', array['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid', 'text']),
               ('discard_billing_file_for_service', array['uuid', 'uuid'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
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
-- Hélène supervises Simon (an intern).
insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Superviseure', 'pro1@a.test', 'active', 'female'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Simon', 'Stagiaire', 'pro2@a.test', 'active', 'male');
update public.professionals set supervisor_professional_id = 'c0000000-0000-0000-0000-000000000001' where id = 'c0000000-0000-0000-0000-000000000002';
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p.id, t.id, p.lic, true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'L-1'), ('c0000000-0000-0000-0000-000000000002'::uuid, 'S-2')) as p(id, lic)
  cross join public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Léa (an address), Zoé (an « entente particulière »), Nadia (no address), Théo (Hélène's agreement).
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Essai', 'zoe@a.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Nadia', 'Essai', null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Théo', 'Essai', 'theo@a.test');
insert into public.professional_client_agreements
  (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from, note)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'Théo E.', 'd0000000-0000-0000-0000-000000000004',
        50, 6000, 9000, '2026-01-01', null);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- Local days (the clinic's timezone): yesterday, two days ago, five days ago, today.
select set_config('test.d1', ((now() at time zone 'America/Toronto')::date - 1)::text, true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select x.id, 'b0000000-0000-0000-0000-00000000000a', x.pro, current_setting('test.s50')::uuid,
       t.s, t.s + interval '50 minutes', t.s + interval '60 minutes', x.state, t.s + interval '50 minutes'
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1, 9, 'completed'),  -- Léa, yesterday
    ('e0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1, 11, 'completed'), -- Zoé
    ('e0000000-0000-0000-0000-000000000003'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1, 13, 'completed'), -- Nadia
    ('e0000000-0000-0000-0000-000000000004'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 1, 15, 'completed'), -- Théo
    ('e0000000-0000-0000-0000-000000000005'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid, 5, 9, 'completed'),  -- Léa, before the start
    ('e0000000-0000-0000-0000-000000000006'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 2, 9, 'completed'),  -- Léa with Simon
    ('e0000000-0000-0000-0000-000000000007'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid, 0, 0, 'completed')   -- Léa, today
  ) as x(id, pro, d, h, state)
  cross join lateral (select (((now() at time zone 'America/Toronto')::date - x.d + pg_catalog.make_time(x.h, 0, 0))
                               at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');

-- The queue is off until the clinic sets its start.
select is(private.job_billing_build_drafts(), 'built=0 held=0 failed=0', 'no start date: the job builds nothing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_billing_queue_from(current_date) $$, '42501', 'Permission refusée : billing.settings', 'the start date: billing.settings');
select throws_ok($$ select public.set_special_agreement('d0000000-0000-0000-0000-000000000002', 'ok') $$,
  'P0001', 'La note de l''entente compte de 3 à 500 caractères.', 'an agreement''s note: 3 characters at least');
select lives_ok($$ select public.set_special_agreement('d0000000-0000-0000-0000-000000000002', 'Tarif convenu avec la famille') $$,
  'Zoé''s « entente particulière »');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_billing_queue_from(current_date - 30) $$, 'P0001', 'La file du matin commence au plus tôt il y a 14 jours.',
  'never more than 14 days back');
select lives_ok($$ select public.set_billing_queue_from(((now() at time zone 'America/Toronto')::date - 3)) $$, 'the queue starts three days ago');
select is((public.get_billing_settings() ->> 'queue_from')::date, (now() at time zone 'America/Toronto')::date - 3, '… read back');
reset role;

-- The job: yesterday's and the day before's sessions, once; held for an agreement.
select is(private.job_billing_build_drafts(), 'built=5 held=2 failed=0', 'five drafts, two held (Zoé''s and Théo''s agreements)');
select is(private.job_billing_build_drafts(), 'built=0 held=0 failed=0', '… once');
select results_eq($$ select q.appointment_id, i.hold_reason from public.billing_queue_items q join public.invoices i on i.id = q.invoice_id where q.org_id = 'b0000000-0000-0000-0000-00000000000a' order by q.appointment_id $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, null::text), ('e0000000-0000-0000-0000-000000000002', 'special_agreement'),
            ('e0000000-0000-0000-0000-000000000003', null), ('e0000000-0000-0000-0000-000000000004', 'client_agreement'),
            ('e0000000-0000-0000-0000-000000000006', null) $$,
  'not before the start date, not today; the holds kept');
select is((select hold_note from public.invoices i join public.billing_queue_items q on q.invoice_id = i.id
            where q.appointment_id = 'e0000000-0000-0000-0000-000000000004'),
  'Entente avec le professionnel : 90,00 $ la séance de 50 min', 'Théo''s hold names the agreement''s price');
select set_config('test.lea1', (select invoice_id::text from public.billing_queue_items where appointment_id = 'e0000000-0000-0000-0000-000000000001'), true);
select set_config('test.zoe', (select invoice_id::text from public.billing_queue_items where appointment_id = 'e0000000-0000-0000-0000-000000000002'), true);
select set_config('test.nadia', (select invoice_id::text from public.billing_queue_items where appointment_id = 'e0000000-0000-0000-0000-000000000003'), true);
select set_config('test.theo', (select invoice_id::text from public.billing_queue_items where appointment_id = 'e0000000-0000-0000-0000-000000000004'), true);
select set_config('test.lea2', (select invoice_id::text from public.billing_queue_items where appointment_id = 'e0000000-0000-0000-0000-000000000006'), true);
select is((select status from public.invoices where id = current_setting('test.lea1')::uuid), 'draft', 'the queue''s invoices are drafts');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select x ->> 'hold_reason' from pg_catalog.jsonb_array_elements(public.list_morning_queue()) x $$,
  $$ values ('payer_missing'::text), ('client_agreement'), ('special_agreement'), (null), (null) $$,
  'the queue: held first (Nadia has no address), then the ready ones');
-- A draft deleted is not built again: the session stays « à facturer ».
select lives_ok($$ select public.delete_invoice_draft(current_setting('test.lea1')::uuid) $$, 'Léa''s first draft deleted');
reset role;
select is(private.job_billing_build_drafts(), 'built=0 held=0 failed=0', '… not built again');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(public.get_client_billing('d0000000-0000-0000-0000-000000000001') -> 'to_invoice' @> '[{"appointment_id": "e0000000-0000-0000-0000-000000000001"}]',
  '… it is in Léa''s « à facturer »');

-- « Mettre en attente », « Envoyer »: a refusal for one leaves the others.
select lives_ok($$ select public.hold_invoice_draft(current_setting('test.lea2')::uuid, 'À vérifier avec Simon') $$, 'held by hand');
select results_eq($$ select number is not null, error from public.send_invoices(array[current_setting('test.zoe')::uuid, current_setting('test.lea2')::uuid,
                                                                                      current_setting('test.nadia')::uuid]) order by number nulls first, error $$,
  $$ values (false, 'Ce brouillon est en attente : remettez-le dans la file avant de l''envoyer.'::text),
            (false, 'Ce brouillon est en attente : remettez-le dans la file avant de l''envoyer.'), (true, null) $$,
  'the held two refused, Nadia''s sent');
select ok((select number from public.invoices where id = current_setting('test.nadia')::uuid) ~ '^[0-9]{4}-1$', '… the year''s first number, none lost');
select lives_ok($$ select public.release_invoice_draft(current_setting('test.lea2')::uuid) $$, 'back in the queue');
select lives_ok($$ select public.release_invoice_draft(current_setting('test.zoe')::uuid) $$, 'Zoé''s agreement validated');
select results_eq($$ select error is null, number ~ '^[0-9]{4}-[23]$' from public.send_invoices(array[current_setting('test.zoe')::uuid, current_setting('test.lea2')::uuid]) $$,
  $$ values (true, true), (true, true) $$, '« Tout envoyer »: both, the next numbers');
select is((select count(*)::int from public.billing_deliveries where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'invoice' and send_email), 3, 'three emails asked');
select ok(not exists (select 1 from pg_catalog.jsonb_array_elements(public.list_morning_queue()) x
                       where x ->> 'id' in (current_setting('test.zoe'), current_setting('test.nadia'))), 'the sent leave the queue');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select * from public.send_invoices(array[current_setting('test.theo')::uuid]) $$, '42501', 'Permission refusée : billing.manage',
  'the conseillère does not send');
reset role;

-- The deliveries: claimed once; the document; the email when asked, to the payer's address.
select set_config('test.claimed', public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25)::text, true);
select is(pg_catalog.cardinality(current_setting('test.claimed')::uuid[]), 3, 'three deliveries claimed');
select is(pg_catalog.cardinality(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25)), 0, '… once');
select set_config('test.dl_lea', (select id::text from public.billing_deliveries where invoice_id = current_setting('test.lea2')::uuid), true);
select set_config('test.dl_nadia', (select id::text from public.billing_deliveries where invoice_id = current_setting('test.nadia')::uuid), true);
select set_config('test.dl_zoe', (select id::text from public.billing_deliveries where invoice_id = current_setting('test.zoe')::uuid), true);
select set_config('test.doc', public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_lea')::uuid)::text, true);
select is(current_setting('test.doc')::jsonb -> 'email' ->> 'to', 'lea@a.test', 'Léa''s invoice: to her address');
select is(current_setting('test.doc')::jsonb #>> '{document,professionals,0,supervisor_name}', 'Hélène Superviseure',
  '… the intern''s supervisor on the document');
select ok((current_setting('test.doc')::jsonb #>> '{document,lines,0,minutes}')::int = 50, '… the session''s length');
select is(public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_nadia')::uuid) ->> 'skip_reason',
  'no_email', 'Nadia: no address, no email (the PDF still made)');
-- P3-40: Facturation reserved for its testers: no email to a client, the template's module closed.
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
select is(public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_zoe')::uuid) ->> 'skip_reason',
  'reserved', 'reserved: the email set aside');
select ok(public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_zoe')::uuid) -> 'email' = 'null'::jsonb,
  '… no recipient');
select results_eq($$ select (public.get_email_context('b0000000-0000-0000-0000-00000000000a', k) ->> 'module_open')::boolean
                       from (values ('billing.invoice'), ('billing.receipt_en'), ('billing.credit_note'), ('billing.statement')) as t(k) $$,
  $$ values (false), (false), (false), (false) $$, '… and every billing template''s module closed for the send path (CC-14)');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'billing';
-- Outcomes: an error tried again, then done; the PDF kept once.
select lives_ok($$ select public.finish_billing_delivery_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_lea')::uuid,
                     null, null, null, null, 'render_failed') $$, 'a failure');
select results_eq($$ select status, error_code, next_attempt_at > now() from public.billing_deliveries where id = current_setting('test.dl_lea')::uuid $$,
  $$ values ('pending'::text, 'render_failed'::text, true) $$, '… tried again later');
select lives_ok($$ select public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 0) $$, 'nothing more is due');
update public.billing_deliveries set next_attempt_at = now() - interval '1 second' where id = current_setting('test.dl_lea')::uuid;
select is(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 1), array[current_setting('test.dl_lea')::uuid],
  '… until the next try');
select lives_ok($$ select public.finish_billing_delivery_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_lea')::uuid,
                     null, null, null, null, 'rate_limited') $$, 'the per-address limit');
select results_eq($$ select status, attempts, next_attempt_at > now() + interval '1 minute' from public.billing_deliveries where id = current_setting('test.dl_lea')::uuid $$,
  $$ values ('pending'::text, 1::smallint, true) $$, '… not counted as a try, again in 2 minutes');
select set_config('test.f1', (select file_id::text from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'billing',
  'billing_document', 'invoice', current_setting('test.zoe')::uuid, 'application/pdf', 1000, repeat('a', 64), null, 'Facture.pdf')), true);
select set_config('test.f2', (select file_id::text from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'billing',
  'billing_document', 'invoice', current_setting('test.zoe')::uuid, 'application/pdf', 1000, repeat('b', 64), null, 'Facture.pdf')), true);
select is((select view_permission from public.stored_files where id = current_setting('test.f1')::uuid), 'billing.view', 'the PDF is read with billing.view');
select lives_ok($$ select public.finish_billing_delivery_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_zoe')::uuid,
                     current_setting('test.f1')::uuid, 'sent', null, null, null) $$, 'Zoé''s sent with its PDF');
select results_eq($$ select d.status, d.email_status, i.pdf_file_id from public.billing_deliveries d join public.invoices i on i.id = d.invoice_id
                      where d.id = current_setting('test.dl_zoe')::uuid $$,
  $$ values ('done'::text, 'sent'::text, current_setting('test.f1')::uuid) $$, '… done, the PDF on the invoice');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.dl_zoe2', public.send_billing_document('invoice', current_setting('test.zoe')::uuid)::text, true);
reset role;
select is(pg_catalog.cardinality(public.billing_deliveries_for_service('b0000000-0000-0000-0000-00000000000a', 25)), 1, '« Renvoyer »: a new delivery');
select is(public.billing_document_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_zoe2')::uuid) #>> '{stored,file_id}',
  current_setting('test.f1'), '… the stored PDF reused');
select lives_ok($$ select public.finish_billing_delivery_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_zoe2')::uuid,
                     current_setting('test.f2')::uuid, 'sent', null, null, null) $$, 'a second PDF for the same invoice');
select results_eq($$ select (select pdf_file_id from public.invoices where id = current_setting('test.zoe')::uuid),
                            (select status from public.stored_files where id = current_setting('test.f2')::uuid) $$,
  $$ values (current_setting('test.f1')::uuid, 'deleted'::text) $$, '… the first kept, the second discarded');
select throws_ok($$ select public.finish_billing_delivery_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.dl_zoe2')::uuid,
                      null, 'sent', null, null, null) $$, '22023', 'Unknown or unclaimed delivery', 'a finished delivery is not finished again');

-- Payments and receipts.
select set_config('test.total', (select total_cents::text from public.invoices where id = current_setting('test.lea2')::uuid), true);
select set_config('test.total_fr', private.billing_format_money(current_setting('test.total')::int), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.record_payment(current_setting('test.lea2')::uuid, 'interac', 100) $$, '42501', 'Permission refusée : billing.manage',
  'the conseillère records no payment');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.record_payment(current_setting('test.lea2')::uuid, 'interac', current_setting('test.total')::int + 1) $$,
  'P0001', 'Le montant va de 0,01 $ au solde de la facture (' || current_setting('test.total_fr') || ').', 'at most the balance');
select throws_ok($$ select public.record_payment(current_setting('test.lea2')::uuid, 'credit_note', 100) $$, 'P0001', 'Choisissez un mode de paiement.',
  'not « Note de crédit »');
select throws_ok($$ select public.record_payment(current_setting('test.lea2')::uuid, 'interac', 100, current_date + 2) $$,
  'P0001', 'La date du paiement ne peut pas être dans le futur.', 'not in the future');
select set_config('test.r1', public.record_payment(current_setting('test.lea2')::uuid, 'interac', 5000, null, 'CA1234')::text, true);
select results_eq($$ select i.paid_cents, i.payment_status, r.number ~ '^R-[0-9]{4}-1$' from public.invoices i join public.receipts r on r.invoice_id = i.id
                      where i.id = current_setting('test.lea2')::uuid $$,
  $$ values (5000, 'partial'::text, true) $$, 'a part paid: the receipt R-AAAA-1');
select lives_ok($$ select public.record_payment(current_setting('test.lea2')::uuid, 'cheque', current_setting('test.total')::int - 5000) $$, 'the rest');
select results_eq($$ select paid_cents = total_cents, payment_status from public.invoices where id = current_setting('test.lea2')::uuid $$,
  $$ values (true, 'paid'::text) $$, '… paid');
select is((select count(*)::int from public.billing_deliveries where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'receipt' and send_email), 2, 'each receipt goes to the payer');
select throws_ok($$ select public.issue_credit_note(current_setting('test.lea2')::uuid, 'Erreur') $$,
  'P0001', 'Cette facture a des paiements : remboursez-les avant de la créditer.', 'a paid invoice waits for refunds');
select throws_ok($$ select public.record_payment(current_setting('test.lea2')::uuid, 'interac', 1) $$,
  'P0001', 'Le montant va de 0,01 $ au solde de la facture (0,00 $).', 'nothing left to pay');
-- Credit notes: emailed when the invoice was.
select lives_ok($$ select public.issue_credit_note(current_setting('test.zoe')::uuid, 'Erreur de tarif') $$, 'Zoé''s credited');
select lives_ok($$ select public.issue_credit_note(current_setting('test.nadia')::uuid, 'Erreur de tarif') $$, 'Nadia''s credited');
select results_eq($$ select i.id::text, d.send_email from public.billing_deliveries d join public.invoices i on i.id = d.invoice_id
                      where d.org_id = 'b0000000-0000-0000-0000-00000000000a' and d.kind = 'credit_note' order by d.send_email $$,
  $$ values (current_setting('test.nadia'), false), (current_setting('test.zoe'), true) $$, 'the credit note emailed when the invoice was');
-- A manual finalising: its PDF, no email.
select set_config('test.m', public.create_manual_invoice('d0000000-0000-0000-0000-000000000004')::text, true);
select public.add_invoice_line(current_setting('test.m')::uuid, 'adjustment', null, 'Rédaction de rapport', 1, 8000, false);
select ok(public.finalize_invoice(current_setting('test.m')::uuid) is not null, 'a manual invoice finalised');
select results_eq($$ select send_email from public.billing_deliveries where invoice_id = current_setting('test.m')::uuid $$,
  $$ values (false) $$, '… its PDF made, no email');

-- Statements.
select set_config('test.st', public.create_statement('d0000000-0000-0000-0000-000000000001', extract(year from current_date)::int, null, true)::text, true);
select results_eq($$ select pg_catalog.jsonb_array_length(d -> 'invoices'), pg_catalog.jsonb_array_length(d -> 'payments'), d #>> '{payer,first_name}'
                       from (select public.get_billing_document('statement', current_setting('test.st')::uuid) -> 'document' d) x $$,
  $$ values (1, 2, 'Léa'::text) $$, 'Léa''s statement: her invoice, its two payments');
select throws_ok($$ select public.create_statement('d0000000-0000-0000-0000-000000000001', extract(year from current_date)::int + 1) $$,
  'P0001', 'Choisissez une année passée ou l''année en cours.', 'not a year to come');

-- The reads.
select results_eq($$ select (b ->> 'balance_cents')::int, b #>> '{special_agreement,note}', pg_catalog.jsonb_array_length(b -> 'payments'),
                            pg_catalog.jsonb_array_length(b -> 'statements')
                       from (select public.get_client_billing('d0000000-0000-0000-0000-000000000001') b) x $$,
  $$ values (0, null::text, 2, 1) $$, 'Léa''s billing: no balance, two payments, a statement');
select is(public.get_client_billing('d0000000-0000-0000-0000-000000000002') #>> '{special_agreement,note}', 'Tarif convenu avec la famille',
  'Zoé''s agreement');
select results_eq($$ select payment_status from public.list_invoices(null, 'd0000000-0000-0000-0000-000000000001') $$,
  $$ values ('paid'::text) $$, 'the list shows the payment state');
select is(pg_catalog.jsonb_array_length(public.get_invoice(current_setting('test.lea2')::uuid) -> 'payments'), 2, 'the invoice''s payments');
select lives_ok($$ select public.set_special_agreement('d0000000-0000-0000-0000-000000000002', null) $$, 'Zoé''s agreement ended');
select is((select count(*)::int from public.special_agreements where client_id = 'd0000000-0000-0000-0000-000000000002' and is_active), 0, '… none active');
reset role;

-- QuickBooks' outbox (FQ): each issued invoice, credit note and payment once, never an import.
select results_eq($$ select kind, count(*)::int from public.billing_sync_events where org_id = 'b0000000-0000-0000-0000-00000000000a' group by kind order by kind $$,
  $$ values ('invoice_credited'::text, 2), ('invoice_issued', 4), ('payment_recorded', 2) $$,
  'every issued invoice, credit note and payment is in the outbox');
select is((select count(*)::int from public.billing_sync_events
            where kind = 'invoice_issued' and invoice_id = current_setting('test.zoe')::uuid), 1, '… once, a resend adds none');
select is(private.billing_invoice_for_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.zoe')::uuid) #>> '{credit_note,number}',
  (select number from public.credit_notes where invoice_id = current_setting('test.zoe')::uuid), 'the invoice''s read names its credit note');
select is((private.billing_payment_for_sync('b0000000-0000-0000-0000-00000000000a',
             (select id from public.payments where reference = 'CA1234')) ->> 'mode_code'), 'interac', 'the payment''s read names its mode');
select set_config('test.ev', (select min(id)::text from public.billing_sync_events where org_id = 'b0000000-0000-0000-0000-00000000000a'), true);
select lives_ok($$ select public.finish_billing_sync_event_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.ev')::bigint, 'qbo_unavailable') $$,
  'a push that fails');
select results_eq($$ select attempts, processed_at is null from public.billing_sync_events where id = current_setting('test.ev')::bigint $$,
  $$ values (1, true) $$, '… one more try, still pending');
select lives_ok($$ select public.finish_billing_sync_event_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.ev')::bigint, null) $$,
  'pushed');
select ok(not exists (select 1 from public.billing_sync_events_for_service('b0000000-0000-0000-0000-00000000000a', 50)
                       where id = current_setting('test.ev')::bigint), '… no longer listed');
insert into public.invoices (org_id, client_id, payer_client_id, source_type, external_ref)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'import', 'GOR-1');
select lives_ok($$ select private.billing_queue_sync('b0000000-0000-0000-0000-00000000000a', 'invoice_issued',
                     (select id from public.invoices where external_ref = 'GOR-1'), (select id from public.invoices where external_ref = 'GOR-1')) $$,
  'an imported invoice …');
select is((select count(*)::int from public.billing_sync_events e join public.invoices i on i.id = e.invoice_id where i.source_type = 'import'), 0,
  '… never enters the outbox (already in QuickBooks)');

-- Clients' anonymisation: the references and the agreements go.
select ok(private.billing_anonymize_client('d0000000-0000-0000-0000-000000000001') >= 1, 'an anonymisation');
select is((select count(*)::int from public.payments where payer_client_id = 'd0000000-0000-0000-0000-000000000001' and reference is not null), 0,
  '… the payments'' references blanked');

select * from finish();
rollback;
