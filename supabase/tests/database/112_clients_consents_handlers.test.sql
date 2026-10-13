-- Client consents in a client merge and an anonymisation (migration *_clients_consents_handlers.sql,
-- C5a with C2). Covers: the handlers registered and callable by no role; who signs read through
-- client_contacts_for (an authorised parent, not an archived one); merge (open requests moved, two
-- open requests for one consent → the one in signing stays, the other cancelled and its links
-- revoked, both in signing refused in French; the latest signed consent stays in force, the other
-- superseded, the sealed PDF kept; a pending request whose two signers became one person
-- cancelled); anonymisation (her open requests and those she must sign cancelled, the signers'
-- names removed from her consents and from those she signed, the withdrawal note gone, the PDF kept).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select function_privs_are('private', f.name, f.args, 'authenticated', array[]::text[], f.name || ': no role')
  from (values ('clients_consents_reassign_client', array['uuid', 'uuid']), ('clients_consents_anonymize_client', array['uuid']),
               ('clients_consent_in_signing', array['uuid', 'uuid']), ('clients_consent_cancel', array['uuid', 'uuid'])) as f(name, args);
-- Since CL-30 Clients' row names private.clients_reassign_client, which runs the consents' handler first.
select is((select function_name from public.client_merge_handlers where module_key = 'clients'), 'private.clients_reassign_client',
  'the consents'' merge handler is registered (through Clients'' handler, CL-30)');
select is((select function_name from public.client_anonymize_handlers where module_key = 'clients'), 'private.clients_consents_anonymize_client',
  'the consents'' anonymisation handler is registered');

-- Fixtures: clinic A with Clients; its admin (clients.merge, clients.privacy).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);

-- Kim (kept) and Max (merged), adults; Chloé, 10, under shared custody, both her parents; Kara and
-- Marc (a merge that is refused); Lou, 9, Kim's daughter only.
insert into public.clients (id, org_id, first_name, last_name, birthday, email, shared_custody) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Kim', 'Garde', '1985-02-01', 'kim@exemple.test', false),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Max', 'Fusion', '1986-03-01', 'max@exemple.test', false),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Enfant', (current_date - interval '10 years')::date, null, true),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Kara', 'Un', '1980-01-01', 'kara@exemple.test', false),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Deux', '1981-01-01', 'marc@exemple.test', false),
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Lou', 'Garde', (current_date - interval '9 years')::date, null, false),
  ('d0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Noé', 'Ancien', '1970-01-01', 'noe@exemple.test', false);
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, a_manages_appointments) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'parent', 'child', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'parent', 'child', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', 'parent', 'child', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000007', 'child', 'parent', false);
update public.client_relations set b_manages_appointments = true
 where client_a_id = 'd0000000-0000-0000-0000-000000000006' and client_b_id = 'd0000000-0000-0000-0000-000000000007';
update public.clients set archived_at = now() where id = 'd0000000-0000-0000-0000-000000000007';

-- Who signs, through client_contacts_for: Lou's authorised parent, not the archived one.
select results_eq($$ select (s ->> 'signer_client_id')::uuid, s ->> 'role', s ->> 'relation_id' is not null
                       from jsonb_array_elements(private.clients_consent_signers('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006')) s $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'client', true) $$, 'who signs for a child: her authorised parent, read through client_contacts_for');
select is(jsonb_array_length(private.clients_consent_signers('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003')), 2,
  'shared custody: both parents');

create temporary table v as
select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr';

insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, state, signed_at) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'waitlist',    'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'coaching',    'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'coaching',    'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'naturopathy', 'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'naturopathy', 'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'general',     'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'general',     'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000005', 'general',     'fr', (select id from v), 'pending', null),
  ('e1000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'waitlist',    'fr', (select id from v), 'signed', now() - interval '30 days');
insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000001', 'client',   'd0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000002', 'client',   'd0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000006', 'client',   'd0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000006', 'client_2', 'd0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000009', 'client',   'd0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000009', 'client_2', 'd0000000-0000-0000-0000-000000000005');
-- Signatures started: Max's naturopathy, and both of Kara's and Marc's general consents.
insert into public.signature_requests (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at)
select 'b0000000-0000-0000-0000-00000000000a', 'clients', 'clients.consent', (select id from v), 'client_consent_request', x.id,
       'Consentement', 'sent', 'envelope_' || right(x.id::text, 2), 'client-consent:' || x.id, 'clients.view', now()
  from (values ('e1000000-0000-0000-0000-000000000004'::uuid), ('e1000000-0000-0000-0000-000000000007'::uuid), ('e1000000-0000-0000-0000-000000000008'::uuid)) as x(id);

-- Consents in force: Kim's general (imported, older), Max's general (ours, newer, with its sealed PDF);
-- Chloé's waitlist, signed by Kim and by Marc (as recorded then).
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, retain_until)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/e0000000-0000-0000-0000-000000000001/f0000000-0000-0000-0000-000000000001.pdf',
        'core', 'signing_signed', 'signature_request', 'e0000000-0000-0000-0000-000000000001', 'clients.view',
        'Consentement signé.pdf', 'application/pdf', 'pdf', 1000, repeat('c', 64), 'ready', now(), now() + interval '1 day');
insert into public.client_consents (id, org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by,
                                    signed_file_id, request_id, source, withdrawal_note, withdrawn_at, withdrawn_by) values
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr',
   null, 'GOrendezvous', now() - interval '200 days', '[]', null, null, 'import', null, null, null),
  ('c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'fr',
   (select id from v), 'v1', now() - interval '20 days', '[{"name": "Max Fusion", "role": "client", "relation": null}]',
   'f0000000-0000-0000-0000-000000000001', null, 'app', null, null, null),
  ('c1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'waitlist', 'fr',
   (select id from v), 'v1', now() - interval '30 days',
   '[{"name": "Kim Garde", "role": "client", "relation": "parent_or_guardian"}, {"name": "Marc Deux", "role": "client_2", "relation": "parent_or_guardian"}]',
   null, 'e1000000-0000-0000-0000-000000000009', 'app', null, null, null),
  ('c1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'coaching', 'fr',
   (select id from v), 'v1', now() - interval '40 days', '[{"name": "Max Fusion", "role": "client", "relation": null}]',
   null, null, 'app', 'Retiré au téléphone avec Max Fusion.', now() - interval '35 days', null);

-- =============================================================================
-- Merge
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.merge_clients('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Les deux dossiers ont une demande « Consentement général » en cours de signature : attendez qu''une soit signée, puis fusionnez.',
  'both files with the same consent in signing: refused in French');
select lives_ok($$ select public.merge_clients('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002') $$,
  'Max merged into Kim');
reset role;
select ok((select merged_into_id = 'd0000000-0000-0000-0000-000000000001' from public.clients where id = 'd0000000-0000-0000-0000-000000000002'),
  '… Max''s file is merged');
select is((select count(*)::int from public.client_consent_requests where client_id = 'd0000000-0000-0000-0000-000000000002'), 0,
  'no request left on the merged file');
select results_eq($$ select client_id, state from public.client_consent_requests where id = 'e1000000-0000-0000-0000-000000000001' $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'pending') $$, 'an open request moves to the kept file');
select is((select signer_client_id from public.client_consent_request_signers where request_id = 'e1000000-0000-0000-0000-000000000001'),
  'd0000000-0000-0000-0000-000000000001'::uuid, '… and its signer is the kept person');
select results_eq($$ select id, state from public.client_consent_requests where consent_key = 'coaching' order by id $$,
  $$ values ('e1000000-0000-0000-0000-000000000002'::uuid, 'cancelled'), ('e1000000-0000-0000-0000-000000000003'::uuid, 'pending') $$,
  'two open requests, none in signing: the merged file''s is cancelled');
select results_eq($$ select id, state from public.client_consent_requests where consent_key = 'naturopathy' order by id $$,
  $$ values ('e1000000-0000-0000-0000-000000000004'::uuid, 'pending'), ('e1000000-0000-0000-0000-000000000005'::uuid, 'cancelled') $$,
  'the one whose signature started stays; the other is cancelled');
select is((select state from public.client_consent_requests where id = 'e1000000-0000-0000-0000-000000000006'), 'cancelled',
  'Chloé''s request: her two parents are now one person, so it is cancelled (sent again by the clinic)');
select results_eq($$ select id, superseded_at is null, client_id, signed_file_id from public.client_consents where org_id = 'b0000000-0000-0000-0000-00000000000a' and consent_key = 'general' order by id $$,
  $$ values ('c1000000-0000-0000-0000-000000000001'::uuid, false, 'd0000000-0000-0000-0000-000000000001'::uuid, null::uuid),
            ('c1000000-0000-0000-0000-000000000002'::uuid, true,  'd0000000-0000-0000-0000-000000000001'::uuid, 'f0000000-0000-0000-0000-000000000001'::uuid) $$,
  'the latest signed consent stays in force with its sealed PDF; the older one is superseded, never deleted');
select is((select count(*)::int from public.client_consents where client_id = 'd0000000-0000-0000-0000-000000000001'), 3,
  'every signed fact follows the kept file (general twice, coaching withdrawn)');

-- =============================================================================
-- Anonymisation: Kim (who signed Chloé's consent and holds open requests)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.anonymize_client('d0000000-0000-0000-0000-000000000001') $$, 'Kim is anonymised');
reset role;
select is((select count(*)::int from public.client_consent_requests
            where state = 'pending' and (client_id = 'd0000000-0000-0000-0000-000000000001'
              or id in (select request_id from public.client_consent_request_signers where signer_client_id = 'd0000000-0000-0000-0000-000000000001'))),
  0, 'nothing more is asked of her nor in her name');
select is((select count(*)::int from public.client_consents c, jsonb_array_elements(c.signed_by) e
            where c.client_id = 'd0000000-0000-0000-0000-000000000001' and e.value ? 'name'), 0,
  'her consents keep no signer''s name');
select results_eq($$ select e.value ->> 'role', e.value ->> 'name'
                       from public.client_consents c, jsonb_array_elements(c.signed_by) with ordinality e
                      where c.id = 'c1000000-0000-0000-0000-000000000003' order by e.ordinality $$,
  $$ values ('client', null::text), ('client_2', 'Marc Deux') $$, 'Chloé''s consent: Kim''s name removed, the other parent''s kept');
select is((select withdrawal_note from public.client_consents where id = 'c1000000-0000-0000-0000-000000000004'), null::text,
  'the withdrawal note goes');
select results_eq($$ select signed_file_id, signed_at is not null, version_label from public.client_consents where id = 'c1000000-0000-0000-0000-000000000002' $$,
  $$ values ('f0000000-0000-0000-0000-000000000001'::uuid, true, 'v1') $$, 'the sealed PDF stays as the legal proof');

select * from finish();
rollback;
