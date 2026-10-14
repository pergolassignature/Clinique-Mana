-- Security review 2026-10-14 (migrations *_core_imports_switch.sql, *_clients_imports_security_fixes.sql).
-- Covers: (1) a re-run of the consents import never brings back a withdrawn consent nor one the app
-- holds at the same or a later date; (2) the name match answers `ambiguous` when a homonym's file
-- was merged into a file anonymised since; (3) the imports switch: modules.manage only, audited,
-- every import_* RPC refused once closed, open again works; import_invoice refuses a « Note de
-- crédit » payment, an inactive mode, a future payment and more than 200 lines; (6) the signed
-- copy is recorded only for an active member with clients.manage; (7) report_demandes respects
-- « Réservé aux testeurs »; (9) the bounded inputs. (4, the public consent page: 108.)
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

select function_privs_are('public', 'set_imports_open', array['boolean'], 'authenticated', array['EXECUTE'], 'set_imports_open: authenticated');
select function_privs_are('public', 'set_imports_open', array['boolean'], 'anon', array[]::text[], 'set_imports_open: never anon');
select function_privs_are('private', 'imports_assert_open', array[]::text[], 'anon', array[]::text[], 'imports_assert_open: never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@sf.test'), ('a0000000-0000-0000-0000-000000000004', 'cons@sf.test'),
               ('a0000000-0000-0000-0000-000000000005', 'pro@sf.test'), ('a0000000-0000-0000-0000-000000000006', 'parti@sf.test')) as v(u, e);
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@sf.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'cons@sf.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@sf.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Partie A', 'parti@sf.test', 'disabled');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports'), ('demandes')) as y(m);
insert into public.clients (id, org_id, first_name, last_name, language, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'fr', 'gorendezvous:701'),
  ('d0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-00000000000a', 'Marie', 'Homonyme', 'fr', 'gorendezvous:801'),
  ('d0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-00000000000a', 'Marie', 'Homonyme', 'fr', 'gorendezvous:802'),
  ('d0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-00000000000a', 'Autre', 'Dossier', 'fr', 'gorendezvous:803');
select set_config('test.consent', '{"client_ref": "gorendezvous:701", "consent_key": "general", "signed_at": "2024-05-06T10:00:00-04:00"}', true);

-- =============================================================================
-- 1. The consents import never brings back what the app holds
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.consent')::jsonb, false) ->> 'status', 'ok', 'a consent imported');
reset role;
update public.client_consents set withdrawn_at = now()
 where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'general';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.consent')::jsonb, false) ->> 'status', 'skipped',
  'withdrawn in the app: a re-run skips it');
select is(public.import_client_consent(current_setting('test.consent')::jsonb || '{"signed_at": "2025-06-01"}', false) ->> 'status', 'skipped',
  '… even with a later date');
reset role;
select is((select count(*)::int from public.client_consents where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'general'),
  1, '… nothing added: the withdrawal stands');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.consent')::jsonb || '{"consent_key": "coaching"}', false) ->> 'status', 'ok',
  'another consent imported');
reset role;
update public.client_consents set superseded_at = now()
 where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'coaching';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_client_consent(current_setting('test.consent')::jsonb || '{"consent_key": "coaching"}', false) ->> 'status', 'skipped',
  'superseded since: the same signature is not imported again');
select is(public.import_client_consent(current_setting('test.consent')::jsonb || '{"consent_key": "coaching", "signed_at": "2025-06-01"}', true) ->> 'status',
  'ok', 'a later signature from GOrendezvous still comes in');
reset role;

-- =============================================================================
-- 2. A homonym whose file was anonymised still counts
-- =============================================================================
select is((select m.status from private.clients_import_match('b0000000-0000-0000-0000-00000000000a', null, 'Homonyme Marie') m),
  'ambiguous', 'two homonyms: ambiguous');
-- 801 merged into 803, then 803 anonymised (as anonymize_client: its names and reference gone).
update public.clients set merged_into_id = 'd0000000-0000-0000-0000-000000000013', archived_at = now()
 where id = 'd0000000-0000-0000-0000-000000000011';
update public.clients set first_name = 'Client', last_name = 'anonymisé n° ' || client_number, external_ref = null, anonymized_at = now()
 where id = 'd0000000-0000-0000-0000-000000000013';
select ok((select external_ref like 'anon:%' from public.clients where id = 'd0000000-0000-0000-0000-000000000013'), '… a tombstone in its place');
select is((select m.status from private.clients_import_match('b0000000-0000-0000-0000-00000000000a', null, 'Marie Homonyme') m),
  'ambiguous', 'one homonym merged into a file anonymised since: still ambiguous, never the other one');
select results_eq($$ select m.status, m.client_id from private.clients_import_match('b0000000-0000-0000-0000-00000000000a', 'gorendezvous:802', null) m $$,
  $$ values ('ok'::text, 'd0000000-0000-0000-0000-000000000012'::uuid) $$, 'by its reference: the file');
select is((select m.status from private.clients_import_match('b0000000-0000-0000-0000-00000000000a', 'gorendezvous:801', null) m),
  'not_found', 'by the reference of the file merged into the anonymised one: not found');
select is((select m.status from private.clients_import_match('b0000000-0000-0000-0000-00000000000a', null, 'Autre Dossier') m),
  'not_found', 'the anonymised file''s former name: not found');
select is((select m.status from private.clients_import_match('b0000000-0000-0000-0000-00000000000a', null, 'Camille Essai') m),
  'ok', 'a single file of that name: ok');

-- =============================================================================
-- 3. The imports switch
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_imports_open(false) $$, '42501', 'Permission refusée : modules.manage', 'the conseillère cannot close the imports');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_imports_open(false) ->> 'imports_open', 'false', 'the admin closes the imports');
reset role;
select ok((select not imports_open and imports_closed_at is not null from public.organizations where id = 'b0000000-0000-0000-0000-00000000000a'),
  '… closed, with its time');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'organizations' and a.action = 'update'
                   and a.actor_id = 'a0000000-0000-0000-0000-000000000001' and a.changed_fields ? 'imports_open'), '… audited');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format('select public.%I(%L::jsonb, true)', f, '{}'), 'P0001', 'Les imports sont fermés pour cette clinique.', f || ': refused once closed')
  from unnest(array['import_client', 'import_client_relation', 'import_client_payers', 'import_client_consent', 'import_invoice',
                    'import_default_payer', 'import_appointment', 'import_waitlist_entry', 'import_professional']) f;
reset role;
select throws_ok($$ select public.import_client_consent_fact_for_service('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
                     'waitlist', null, now() - interval '1 day', null) $$,
  'P0001', 'Les imports sont fermés pour cette clinique.', 'the consent writer too');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_imports_open(true) ->> 'imports_open', 'true', 'opened again (a late run)');
select is(public.import_client_consent(current_setting('test.consent')::jsonb || '{"consent_key": "waitlist"}', true) ->> 'status', 'ok', '… the imports work again');

-- import_invoice: payments as record_payment, bounded arrays.
select set_config('test.invoice', $${
  "gorendezvous_number": "2025-0000077", "issued_on": "2025-03-04", "client_ref": "gorendezvous:701",
  "subtotal_cents": 10000, "gst_cents": 0, "qst_cents": 0, "total_cents": 10000,
  "lines": [{"description": "Consultation", "quantity": 1, "unit_price_cents": 10000, "total_cents": 10000}],
  "payments": [{"paid_on": "2025-03-04", "mode_code": "interac", "amount_cents": 10000}]
}$$, true);
select is(public.import_invoice(current_setting('test.invoice')::jsonb, true) ->> 'status', 'ok', 'an invoice paid by Interac: ok');
select is(public.import_invoice(current_setting('test.invoice')::jsonb
            || '{"payments": [{"paid_on": "2025-03-04", "mode_code": "credit_note", "amount_cents": 10000}]}', true) -> 'errors' -> 0 ->> 'message',
  'Paiement 1 : une note de crédit ne s''importe pas comme un paiement.', 'a « Note de crédit » payment: refused');
select is(public.import_invoice(current_setting('test.invoice')::jsonb
            || '{"payments": [{"paid_on": "2099-03-04", "mode_code": "interac", "amount_cents": 10000}]}', true) -> 'errors' -> 0 ->> 'message',
  'Paiement 1 : la date de paiement est dans le futur.', 'a payment in the future: refused');
select is(public.import_invoice(current_setting('test.invoice')::jsonb
            || jsonb_build_object('lines', (select jsonb_agg(jsonb_build_object('description', 'x', 'total_cents', 0)) from generate_series(1, 201))), true)
            -> 'errors' -> 0 ->> 'message',
  'Une facture importée a au plus 200 lignes, 200 paiements et 200 remboursements.', 'more than 200 lines: refused');
reset role;
update public.payment_modes set is_active = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 'interac';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_invoice(current_setting('test.invoice')::jsonb, true) -> 'errors' -> 0 ->> 'message',
  'Paiement 1 : mode de paiement inconnu ou inactif.', 'an inactive mode: refused');
select is(public.import_invoice(current_setting('test.invoice')::jsonb || '{"client_ref": null, "client_name": "Marie Homonyme"}', true) ->> 'reason',
  'client_ambiguous', 'an invoice named after the homonyms: left out (ambiguous)');
reset role;

-- =============================================================================
-- 6. The signed copy is recorded for an active member with clients.manage only
-- =============================================================================
set local role service_role;
select set_config('test.cid', (select id::text from public.client_consents where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'general'), true);
select throws_ok($$ select public.mark_client_consent_copy_sent_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cid')::uuid,
                     'a0000000-0000-0000-0000-000000000005') $$, '42501', 'Permission refusée : clients.manage', 'a professional: refused');
select throws_ok($$ select public.mark_client_consent_copy_sent_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cid')::uuid,
                     'a0000000-0000-0000-0000-000000000006') $$, '42501', 'Permission refusée : clients.manage', 'a disabled account: refused');
select ok(public.mark_client_consent_copy_sent_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cid')::uuid,
            'a0000000-0000-0000-0000-000000000004') is not null, 'the conseillère: recorded');
reset role;

-- =============================================================================
-- 7. report_demandes respects « Réservé aux testeurs »
-- =============================================================================
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'P0001', 'Activez d''abord Demandes : ce rapport lit ses demandes.',
  'Demandes reserved for testers, the admin is not one: refused');
reset role;
insert into public.org_module_testers (org_id, module_key, user_id)
values ('b0000000-0000-0000-0000-00000000000a', 'demandes', 'a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, '… a tester reads it');

-- =============================================================================
-- 9. Bounded inputs
-- =============================================================================
select is((select count(*)::int from public.search_clients('Camille' || repeat(' ', 300) || 'Inconnue')), 1,
  'search_clients: the query cut at 200 characters (the words after ignored)');
select is((select count(*)::int from public.list_clients(p_query => 'Camille' || repeat(' ', 300) || 'Inconnue')), 1,
  'list_clients: the query cut at 200 characters');
select lives_ok($$ select * from public.find_client_duplicates('Camille', 'Essai', null,
                     (select array_agg('+1999' || lpad(n::text, 7, '0')) from generate_series(1, 50) n), null, null) $$,
  'find_client_duplicates: 50 phones read as 10');
reset role;

select * from finish();
rollback;
