-- Clients C5b, part 1 (migration *_clients_consents_withdrawal_copy.sql; CC-16 … CC-18). Covers:
-- privileges; « Retirer le consentement » (clients.manage, the note, a consent in force only; the
-- status view says « withdrawn » with its date; required_consents_for answers `missing`, an
-- `each_time` request whose consent was withdrawn no longer counts; the note never in the audit
-- log); the signed copy's preparation (P3-40 while reserved, who signs today with an address, the
-- client's language, the PDF's object, no PDF, an anonymised file, the actor's permission) and its
-- record; the retention (none by default, nothing limited; a duration dates the ended consents'
-- sealed and source PDFs, never one in force; a withdrawal and an anonymisation date theirs; out of
-- range refused in French; cleared → kept again).
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'withdraw_client_consent', array['uuid', 'text'], 'authenticated', array['EXECUTE'],
  'withdraw_client_consent: staff RPC');
select function_privs_are('public', 'withdraw_client_consent', array['uuid', 'text'], 'service_role', array[]::text[],
  'withdraw_client_consent: not the service role');
select function_privs_are('public', f.name, array['uuid', 'uuid', 'uuid'], r.role, array[]::text[], f.name || ': not ' || r.role)
  from (values ('prepare_client_consent_copy_for_service'), ('mark_client_consent_copy_sent_for_service')) as f(name)
 cross join (values ('anon'), ('authenticated')) as r(role);
select function_privs_are('private', f.name, f.args, 'authenticated', array[]::text[], f.name || ': no role')
  from (values ('clients_consent_retention_sync', array['uuid', 'uuid']), ('clients_consent_retention_on_consent', array[]::text[]),
               ('clients_consent_retention_on_client', array[]::text[])) as f(name, args);

-- =============================================================================
-- Fixtures (as postgres): clinic A, Clients reserved for its testers; admin and provider
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled, testers_only) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true, false),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true, true);
insert into public.org_module_testers (org_id, module_key, user_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'clients', 'a0000000-0000-0000-0000-000000000001');

-- Kim (adult, English), Lou (9, Kim's daughter), Sam (adult, no address), Ana (adult, anonymised later).
insert into public.clients (id, org_id, first_name, last_name, email, birthday, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Kim', 'Garde', 'kim@exemple.test', '1985-02-01', 'en'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Lou', 'Garde', null, (current_date - interval '9 years')::date, 'fr'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Sam', 'Muet', null, '1990-01-01', 'fr'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Ana', 'Partie', 'ana@exemple.test', '1970-01-01', 'fr');
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, a_manages_appointments) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'parent', 'child', true);

create temporary table v as
select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr';

-- Signed and source PDFs (core's), one pair per consent with a PDF: f1/f2 Kim's general, f3/f4 Lou's
-- general, f5/f6 Kim's coaching, f7/f8 Ana's general.
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
select ('f0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a',
       case when n % 2 = 1 then 'signed-documents' else 'documents' end,
       'b0000000-0000-0000-0000-00000000000a/core/e0000000-0000-0000-0000-00000000000' || ((n + 1) / 2) || '/f0000000-0000-0000-0000-00000000000' || n || '.pdf', 'core',
       case when n % 2 = 1 then 'signing_signed' else 'signing_source' end, 'signature_request',
       ('e0000000-0000-0000-0000-00000000000' || ((n + 1) / 2))::uuid, 'clients.view',
       'Consentement.pdf', 'application/pdf', 'pdf', 1000, repeat('c', 64), 'ready', now()
  from generate_series(1, 8) n;
insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, state, signed_at,
                                            context_type, context_id) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', (select id from v), 'signed', now() - interval '10 days', null, null),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'fr', (select id from v), 'signed', now() - interval '10 days', null, null),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'coaching', 'fr', (select id from v), 'signed', now() - interval '5 days',
   'appointment', '99000000-0000-0000-0000-000000000001'),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'general', 'fr', (select id from v), 'signed', now() - interval '10 days', null, null);
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, completed_at, source_file_id,
                                       signed_file_id, signed_sha256)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'clients', 'clients.consent', (select id from v),
       'client_consent_request', ('e1000000-0000-0000-0000-00000000000' || n)::uuid, 'Consentement', 'signed', 'envelope_' || n,
       'client-consent:' || n, 'clients.view', now() - interval '11 days', now() - interval '10 days',
       ('f0000000-0000-0000-0000-00000000000' || (2 * n))::uuid, ('f0000000-0000-0000-0000-00000000000' || (2 * n - 1))::uuid, repeat('c', 64)
  from generate_series(1, 4) n;
insert into public.client_consents (id, org_id, client_id, consent_key, language, template_version_id, version_label, signed_at, signed_by,
                                    signed_file_id, request_id, source) values
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr',
   (select id from v), 'v1', '2026-10-03T03:30:00Z', '[{"name": "Kim Garde", "role": "client", "relation": null}]',
   'f0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'app'),
  ('c1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'fr',
   (select id from v), 'v1', now() - interval '10 days', '[{"name": "Kim Garde", "role": "client", "relation": "parent_or_guardian"}]',
   'f0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'app'),
  ('c1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'coaching', 'fr',
   (select id from v), 'v1', now() - interval '5 days', '[{"name": "Kim Garde", "role": "client", "relation": null}]',
   'f0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000003', 'app'),
  ('c1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'general', 'fr',
   (select id from v), 'v1', now() - interval '10 days', '[{"name": "Ana Partie", "role": "client", "relation": null}]',
   'f0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000004', 'app'),
  -- Sam's: imported from GOrendezvous, no PDF.
  ('c1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'general', 'fr',
   null, 'GOrendezvous', now() - interval '300 days', '[]', null, null, 'import');
-- The rules in force: the general consent once, coaching for each appointment.
update public.client_consent_rules r set is_active = true
 where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.consent_key = 'general' and r.trigger_kind = 'general';
insert into public.client_consent_rules (org_id, consent_key, trigger_kind, target, frequency, is_active)
values ('b0000000-0000-0000-0000-00000000000a', 'coaching', 'service', '10999', 'each_time', true);

select results_eq($$ select consent_key, state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a',
                       'd0000000-0000-0000-0000-000000000001', '10999', null, null, '{}', 'appointment', '99000000-0000-0000-0000-000000000001')
                     order by 1 $$,
  $$ values ('coaching'::text, 'signed'::text), ('general', 'signed') $$, 'before: Kim''s general consent and this appointment''s coaching are signed');

-- =============================================================================
-- Withdrawal (CC-16)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-000000000001', 'Au téléphone.') $$,
  '42501', null, 'a provider cannot withdraw (clients.manage)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-000000000001', ' ok ') $$,
  'P0001', 'Notez la raison du retrait et comment il a été reçu (3 à 500 caractères).', 'a note of under 3 characters is refused');
select throws_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-000000000001', repeat('x', 501)) $$,
  'P0001', 'Notez la raison du retrait et comment il a été reçu (3 à 500 caractères).', 'a note of over 500 characters is refused');
select throws_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-0000000000ff', 'Au téléphone.') $$,
  'P0001', 'Consentement introuvable.', 'an unknown consent is refused');
select lives_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-000000000001', '  Retrait demandé au téléphone, confirmé par courriel.  ') $$,
  'the admin withdraws Kim''s general consent');
select results_eq($$ select withdrawn_by, withdrawal_note, withdrawn_at is not null from public.client_consents where id = 'c1000000-0000-0000-0000-000000000001' $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'Retrait demandé au téléphone, confirmé par courriel.'::text, true) $$,
  '… who, the trimmed note, when');
select results_eq($$ select state, withdrawn_at is not null, in_force, consent_id from public.client_consents_status
                     where client_id = 'd0000000-0000-0000-0000-000000000001' and consent_key = 'general' $$,
  $$ values ('withdrawn'::text, true, false, 'c1000000-0000-0000-0000-000000000001'::uuid) $$,
  'the status view says « withdrawn », its date, no longer in force');
select throws_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-000000000001', 'Encore une fois.') $$,
  'P0001', 'Ce consentement n''est plus en vigueur.', 'a withdrawn consent cannot be withdrawn again');
select lives_ok($$ select public.withdraw_client_consent('c1000000-0000-0000-0000-000000000003', 'Retrait du coaching en séance.') $$,
  'Kim''s coaching consent withdrawn too');
reset role;

select results_eq($$ select consent_key, state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a',
                       'd0000000-0000-0000-0000-000000000001', '10999', null, null, '{}', 'appointment', '99000000-0000-0000-0000-000000000001')
                     order by 1 $$,
  $$ values ('coaching'::text, 'missing'::text), ('general', 'missing') $$,
  'after: both missing again, the appointment''s signed coaching request no longer counts');
select ok(not exists (select 1 from public.audit_log a where a.table_name = 'client_consents' and a::text like '%confirmé par courriel%'),
  'the note is never in the audit log');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'client_consents' and a.action = 'update'
                   and a.record_id = 'c1000000-0000-0000-0000-000000000001'),
  'the withdrawal is audited (Historique)');

-- =============================================================================
-- Retention (CC-18): none by default
-- =============================================================================
select is((select count(*)::int from public.stored_files f where f.id::text like 'f0000000-%' and f.retain_until is not null), 0,
  'no duration set: no PDF has a purge date, even a withdrawn consent''s');
select is((select signed_pdf_retention_years from public.client_consent_settings where org_id = 'b0000000-0000-0000-0000-00000000000a'), null::int,
  'the duration is empty by default');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_client_consent_settings('{"signed_pdf_retention_years": 51}') $$,
  'P0001', 'Un réglage est hors des limites : rappel de 1 à 30 jours, délai de 0 à 30 jours, préavis de 12 à 168 heures, conservation de 1 à 50 ans.',
  'a duration over 50 years is refused in French');
select is(public.set_client_consent_settings('{"signed_pdf_retention_years": 7}') ->> 'signed_pdf_retention_years', '7',
  'the admin sets 7 years');
reset role;
select results_eq($$ select f.id::text, f.retain_until = c.withdrawn_at + interval '7 years'
                       from public.stored_files f
                       join public.client_consents c on c.client_id = 'd0000000-0000-0000-0000-000000000001'
                        and f.id in (c.signed_file_id, (select s.source_file_id from public.signature_requests s where s.signed_file_id = c.signed_file_id))
                      order by f.id $$,
  $$ values ('f0000000-0000-0000-0000-000000000001', true), ('f0000000-0000-0000-0000-000000000002', true),
            ('f0000000-0000-0000-0000-000000000005', true), ('f0000000-0000-0000-0000-000000000006', true) $$,
  'the withdrawn consents'' sealed and source PDFs: their end + 7 years');
select is((select count(*)::int from public.stored_files f where f.id in ('f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004',
                                                                          'f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000008')
                                                             and f.retain_until is not null), 0,
  'a consent in force is never limited');

update public.clients set anonymized_at = now() where id = 'd0000000-0000-0000-0000-000000000004';
select ok((select f.retain_until > now() + interval '6 years' and f.retain_until < now() + interval '8 years'
             from public.stored_files f where f.id = 'f0000000-0000-0000-0000-000000000007'),
  'an anonymised file: its consents have ended, their PDFs dated');

update public.client_consents set superseded_at = now() - interval '8 years' where id = 'c1000000-0000-0000-0000-000000000002';
select ok((select f.retain_until < now() from public.stored_files f where f.id = 'f0000000-0000-0000-0000-000000000003'),
  'a consent replaced over 7 years ago: its PDF is past its date');
select ok((select array_agg(p.id) from public.list_files_to_purge('b0000000-0000-0000-0000-00000000000a') p)
          @> array['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004']::uuid[],
  '… so storage-cleanup lists it for the purge');
update public.client_consents set superseded_at = null where id = 'c1000000-0000-0000-0000-000000000002';
select is((select retain_until from public.stored_files where id = 'f0000000-0000-0000-0000-000000000003'), null::timestamptz,
  'back in force: its date is removed');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_client_consent_settings('{"signed_pdf_retention_years": null}') $$, 'the duration cleared');
reset role;
select is((select count(*)::int from public.stored_files f where f.id::text like 'f0000000-%' and f.retain_until is not null), 0,
  '… every PDF kept again');

-- =============================================================================
-- The signed copy (CC-17, service role)
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Le module Clients est réservé aux testeurs : aucune copie ne part aux clients avant son ouverture à tous.',
  'P3-40: no copy while Clients is reserved for its testers');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;

select throws_ok($$ select public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'the actor needs clients.manage');
select is(public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
            'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001') - 'consent_id',
  jsonb_build_object('language', 'en', 'consent_name', 'General consent', 'client_first_name', 'Kim', 'clinic_name', 'Org A',
                     'signed_on', '2026-10-02',
                     'file', jsonb_build_object('bucket', 'signed-documents', 'object_path', 'b0000000-0000-0000-0000-00000000000a/core/e0000000-0000-0000-0000-000000000001/f0000000-0000-0000-0000-000000000001.pdf'),
                     'recipients', jsonb_build_array(jsonb_build_object('role', 'client', 'first_name', 'Kim', 'email', 'kim@exemple.test'))),
  'Kim''s withdrawn consent: to Kim, in English, the clinic''s date, the PDF''s object');
select is(public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
            'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002') -> 'recipients',
  jsonb_build_array(jsonb_build_object('role', 'client', 'first_name', 'Kim', 'email', 'kim@exemple.test')),
  'a child''s consent: to the parent who signs for her today');
select throws_ok($$ select public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Ce consentement n''a pas de PDF signé à envoyer : sa signature vient de GOrendezvous.', 'an imported signature has no PDF');
select throws_ok($$ select public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Ce dossier client est anonymisé.', 'an anonymised file gets no copy');
reset role;
update public.client_consents set signed_file_id = 'f0000000-0000-0000-0000-000000000005' where id = 'c1000000-0000-0000-0000-000000000005';
set local role service_role;
select throws_ok($$ select public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Personne ne peut recevoir la copie : ajoutez une adresse courriel au dossier de la personne qui signe.',
  'no one with an address: refused');
reset role;
update public.stored_files set status = 'purged' where id = 'f0000000-0000-0000-0000-000000000003';
set local role service_role;
select throws_ok($$ select public.prepare_client_consent_copy_for_service('b0000000-0000-0000-0000-00000000000a',
                     'a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Le PDF signé de ce consentement n''est plus conservé.', 'a purged PDF cannot be sent');

select ok(public.mark_client_consent_copy_sent_for_service('b0000000-0000-0000-0000-00000000000a',
            'c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001') is not null,
  'the copy recorded');
reset role;
select results_eq($$ select copy_sent_by, copy_sent_at is not null from public.client_consents where id = 'c1000000-0000-0000-0000-000000000001' $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, true) $$, '… with who sent it');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'client_consents' and a.action = 'update'
                   and a.record_id = 'c1000000-0000-0000-0000-000000000001' and a.actor_id = 'a0000000-0000-0000-0000-000000000001'
                   and a.changed_fields ? 'copy_sent_at'),
  '… audited as the actor');
select is((select copy_sent_at is not null from public.client_consents_status where consent_id = 'c1000000-0000-0000-0000-000000000001'), true,
  'the status view shows the copy');
select is((select count(*)::int from public.email_template_defaults
            where key in ('clients.consent_signed_copy', 'clients.consent_signed_copy_en') and allows_attachments and button_label is null), 2,
  'the two copy templates, with the PDF attached and no button');

select * from finish();
rollback;
