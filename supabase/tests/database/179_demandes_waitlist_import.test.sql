-- Demandes, the GOrendezvous import of the waiting list (migration *_demandes_waitlist_import.sql;
-- decision I-16). Covers: privileges (clients.merge too); a dry run writes nothing; an entry on a
-- profession's list with its GOrendezvous date and fee, its client's request made once (« Liste
-- d'attente », received on her first registration) under the audit source `import`; active
-- when the consent is in force and the fee paid, else incomplete; a re-run and the same list again
-- `skipped`; a second list on the same request; a client not found `unmatched`; refusals in French
-- with their field.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select function_privs_are('public', 'import_waitlist_entry', array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], 'import_waitlist_entry: authenticated');
select function_privs_are('public', 'import_waitlist_entry', array['jsonb', 'boolean'], 'anon', array[]::text[], 'import_waitlist_entry: never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('demandes')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, language, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'fr', 'gorendezvous:501'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', 'fr', 'gorendezvous:502'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pas', 'Importé', 'fr', null);
-- Camille signed the « liste d'attente » consent in GOrendezvous (C5a's import fact).
select ok(public.import_client_consent_fact_for_service('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
  'waitlist', null, now() - interval '60 days', null), 'Camille''s consent, imported');
select set_config('test.row', jsonb_build_object(
  'external_ref', 'gorendezvous:waitlist:1', 'client_name', 'Camille Essai', 'profession_key', 'psychologue',
  'registered_at', '2026-03-02T09:00:00-05:00', 'fee_paid', 'true')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_waitlist_entry(current_setting('test.row')::jsonb, true) $$, '42501', null,
  'the conseillère (no clients.merge): refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb, true) ->> 'status', 'ok', 'a dry run: ok');
reset role;
select is((select count(*)::int from public.waitlist_entries where org_id = 'b0000000-0000-0000-0000-00000000000a')
          + (select count(*)::int from public.demandes where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing written');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.r1', public.import_waitlist_entry(current_setting('test.row')::jsonb, false)::text, true);
select is(current_setting('test.r1')::jsonb ->> 'new_demande', 'true', 'imported, with a new request');
reset role;
select results_eq($$ select e.state, e.fee_status, e.registered_at, t.key, e.external_ref, e.priority, e.client_id
                       from public.waitlist_entries e join public.profession_titles t on t.id = e.target_profession_title_id
                      where e.id = (current_setting('test.r1')::jsonb ->> 'id')::uuid $$,
  $$ values ('active'::text, 'paid'::text, '2026-03-02T09:00:00-05:00'::timestamptz, 'psychologue'::text, 'gorendezvous:waitlist:1'::text,
             'normal'::text, 'd0000000-0000-0000-0000-000000000001'::uuid) $$,
  'on the psychologists'' list since its GOrendezvous date, the fee paid, active (consent in force)');
select results_eq($$ select state, external_ref, client_id, channel, received_at from public.demandes
                      where id = (current_setting('test.r1')::jsonb ->> 'demande_id')::uuid $$,
  $$ values ('waitlist'::text, 'gorendezvous:waitlist:d0000000-0000-0000-0000-000000000001'::text, 'd0000000-0000-0000-0000-000000000001'::uuid,
             'other'::text, '2026-03-02T09:00:00-05:00'::timestamptz) $$,
  'her request: « Liste d''attente », received on the registration');
select is((select source from public.audit_log where table_name = 'waitlist_entries' and record_id = current_setting('test.r1')::jsonb ->> 'id' and action = 'insert'),
  'import', 'written under the audit source « import »');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb, false) ->> 'status', 'skipped', 'a re-run: skipped');
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:waitlist:2"}', false) ->> 'reason',
  'Déjà sur cette liste', 'the same client on the same list again: skipped');
-- Her second list (a professional's): the same request.
select set_config('test.r3', public.import_waitlist_entry(jsonb_build_object(
  'external_ref', 'gorendezvous:waitlist:3', 'client_ref', 'gorendezvous:501', 'professional_id', 'c0000000-0000-0000-0000-000000000001',
  'registered_at', '2026-02-01T09:00:00-05:00', 'priority_reason', 'Suivi interrompu'), false)::text, true);
reset role;
select results_eq($$ select (current_setting('test.r3')::jsonb ->> 'demande_id') = (current_setting('test.r1')::jsonb ->> 'demande_id'),
                            (current_setting('test.r3')::jsonb ->> 'new_demande')::boolean,
                            (select received_at from public.demandes where id = (current_setting('test.r1')::jsonb ->> 'demande_id')::uuid),
                            (select priority from public.waitlist_entries where id = (current_setting('test.r3')::jsonb ->> 'id')::uuid) $$,
  $$ values (true, false, '2026-03-02T09:00:00-05:00'::timestamptz, 'priority'::text) $$,
  'a second list: her request again (its date unchanged); a reason makes it a priority');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.r4', public.import_waitlist_entry(current_setting('test.row')::jsonb
  || '{"external_ref": "gorendezvous:waitlist:4", "client_name": "Marc Essai", "fee_paid": ""}', false)::text, true);
reset role;
select results_eq($$ select state, fee_status from public.waitlist_entries where id = (current_setting('test.r4')::jsonb ->> 'id')::uuid $$,
  $$ values ('incomplete'::text, 'to_invoice'::text) $$, 'the fee not paid: incomplete, « à facturer »');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:waitlist:9", "client_name": "Pas Importé"}', true) ->> 'reason',
  'client_not_found', 'a file not imported: unmatched');
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:waitlist:9", "client_name": "Marc Essai", "profession_key": "astrologue"}', true)
            -> 'errors' -> 0 ->> 'field',
  'profession_key', 'a profession not in the catalogue: refused with its field');
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:waitlist:9", "client_name": "Marc Essai", "professional_id": "c0000000-0000-0000-0000-000000000001"}', true)
            -> 'errors' -> 0 ->> 'message',
  'Une liste : une profession ou un professionnel (un seul des deux).', 'two lists in one row: refused in French');
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:waitlist:9", "client_name": "Marc Essai", "registered_at": "2099-01-01"}', true)
            -> 'errors' -> 0 ->> 'field',
  'registered_at', 'a registration in the future: refused');
select is(public.import_waitlist_entry(current_setting('test.row')::jsonb || '{"external_ref": "1"}', true) -> 'errors' -> 0 ->> 'field',
  'external_ref', 'no GOrendezvous reference: refused');
reset role;

select * from finish();
rollback;
