-- FP fixes (migration *_billing_payer_guards), parity audit P10–P12:
-- - a new payer never replaces the active one of its kind;
-- - a PAE needs its file number to be complete (completion list, the morning queue's hold, a
--   payer invoice by hand), once per provider among the active payers;
-- - a payment carries an optional note (audited redacted), shown on the invoice.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select function_privs_are('public', 'record_payment', array['uuid', 'text', 'integer', 'date', 'text', 'text'], 'authenticated', array['EXECUTE'],
  'record_payment: users (with its note)');
select hasnt_function('public', 'record_payment', array['uuid', 'text', 'integer', 'date', 'text'], 'the old signature is gone');
select has_column('public', 'payments', 'note', 'payments.note');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000002', 'adjointe@a.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
values ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'adjointe@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.payer_organisations (id, org_id, kind, name, cadence)
values ('f8000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'Fournisseur X', 'threshold');
insert into public.professionals (id, org_id, first_name, last_name, email, status, gender) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Pro', 'pro1@a.test', 'active', 'female');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Ivan', 'Essai', 'ivan@a.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Paula', 'Essai', 'paula@a.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Rémi', 'Essai', 'remi@a.test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- P10: one active payer per kind; a new one never replaces it.
select lives_ok($$ select public.save_client_payer('d0000000-0000-0000-0000-000000000001', null, 'ivac', null, 'IV-1', null, null, null, null, null, null) $$,
  'an IVAC payer added');
select throws_ok($$ select public.save_client_payer('d0000000-0000-0000-0000-000000000001', null, 'ivac', null, 'IV-2', null, null, null, null, null, null) $$,
  'P0001', 'Ce client a déjà un payeur IVAC actif : modifiez-le, ou terminez-le avant d''en ajouter un autre.',
  'a second IVAC payer is refused, never silently replacing the first');
select is((select file_number from public.client_payers where client_id = 'd0000000-0000-0000-0000-000000000001' and is_active), 'IV-1',
  '… which keeps its file number');

-- P11: a PAE's file number, once per provider among active payers.
select set_config('test.paula', public.save_client_payer('d0000000-0000-0000-0000-000000000002', null, 'pae', 'Fournisseur X', null, null, null, 30000,
  null, null, null, 80)::text, true);
select is((select x -> 'missing' from pg_catalog.jsonb_array_elements(public.list_client_payers_to_complete()) x
            where x ->> 'client_payer_id' = current_setting('test.paula')), '["file_number"]'::jsonb,
  'a PAE without its file number is still to complete');
select throws_ok(format($$ select public.create_payer_invoice(%L) $$, current_setting('test.paula')), 'P0001',
  'Indiquez d''abord le numéro de dossier du PAE dans le dossier du client.', 'no payer invoice by hand without it');
select lives_ok(format($$ select public.save_client_payer('d0000000-0000-0000-0000-000000000002', %L, 'pae', 'Fournisseur X', 'PX-9', null, null, 30000,
                         null, null, null, 80) $$, current_setting('test.paula')), 'the file number completed');
select is((select count(*)::int from pg_catalog.jsonb_array_elements(public.list_client_payers_to_complete()) x
            where x ->> 'client_payer_id' = current_setting('test.paula')), 0, '… and the PAE is complete');
select throws_ok($$ select public.save_client_payer('d0000000-0000-0000-0000-000000000003', null, 'pae', 'fournisseur x', 'px-9', 5000, null, null,
                     null, null, null) $$,
  'P0001', 'Ce numéro de dossier du PAE est déjà au dossier d''un autre client.', 'a provider''s file number once (case ignored)');
reset role;
select throws_ok($$ insert into public.client_payers (client_id, org_id, kind, organisation_name, file_number, session_amount_cents)
                     values ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'pae', 'FOURNISSEUR X', 'PX-9', 5000) $$,
  '23505', null, '… held by a unique index too');

-- The morning queue's hold: a session covered by a PAE without its file number.
update public.client_payers set file_number = null where id = current_setting('test.paula')::uuid;
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
select 'e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
       current_setting('test.s50')::uuid, s, s + interval '50 minutes', s + interval '60 minutes', 'completed', s + interval '50 minutes'
  from (select (((now() at time zone 'America/Toronto')::date - 3 + pg_catalog.make_time(10, 0, 0)) at time zone 'America/Toronto') as s) t;
insert into public.appointment_participants (appointment_id, client_id, org_id)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.inv', public.create_invoice(array['e0000000-0000-0000-0000-000000000001'::uuid])::text, true);
reset role;
select ok(private.billing_payer_incomplete((select i from public.invoices i where i.id = current_setting('test.inv')::uuid)),
  'a draft whose PAE has no file number is held « Payeur tiers à compléter »');
update public.client_payers set file_number = 'PX-9' where id = current_setting('test.paula')::uuid;
select ok(not private.billing_payer_incomplete((select i from public.invoices i where i.id = current_setting('test.inv')::uuid)),
  '… and released once it has one');

-- P12: a payment's note.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.manual', public.create_manual_invoice('d0000000-0000-0000-0000-000000000003', null)::text, true);
select public.add_invoice_line(current_setting('test.manual')::uuid, 'adjustment', null, 'Rapport', 1, 10000, false, null);
select public.finalize_invoice(current_setting('test.manual')::uuid);
select throws_ok(format($$ select public.record_payment(%L, 'interac', 5000, null, null, %L) $$, current_setting('test.manual'), repeat('x', 501)),
  'P0001', 'La note du paiement compte 500 caractères au plus.', 'a note of 500 characters at most');
select lives_ok(format($$ select public.record_payment(%L, 'interac', 5000, null, 'REF-1', '  Payé par le conjoint  ') $$, current_setting('test.manual')),
  'a payment with its note');
select is((select x ->> 'note' from pg_catalog.jsonb_array_elements(public.get_invoice(current_setting('test.manual')::uuid) -> 'payments') x),
  'Payé par le conjoint', 'the invoice shows the payment''s note, trimmed');
reset role;

select * from finish();
rollback;
