-- Communications, security review fixes (migration *_communications_security_fixes.sql):
-- 1. the AI draft's context needs communications.inbox and a thread the actor reads, and names the
--    thread's correspondents (masked by the function) even when the thread is linked to no file;
-- 2. the PBX address, client id and number need settings.integrations_manage; a new PBX address
--    forgets the stored session (its Vault tokens too);
-- 3. a test text to a withdrawn number is refused;
-- 4. the dispatch fails `module_reserved` the queued client texts while the module is reserved;
-- 5. the stop words as the first word, and the new ones;
-- 6. the purge recomputes the threads' snippets, deletes old drafts and old AI calls.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- =============================================================================
-- Fixtures: org A (Communications and Clients on): admin 01, conseillère 02 (inbox, SMS settings
-- without the integrations), provider 03, conseillère 04 (no inbox).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@sec.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Clinique A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@sec.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@sec.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@sec.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère B', 'u4@sec.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('communications'), ('professionals'), ('clients')) as y(m);
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.inbox'),
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.ai_draft'),
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.sms'),
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.sms_manage')
on conflict do nothing;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'communications.inbox', false);

insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by) values
  ('c0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'info@a.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000001');
insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by, owner_profile_id) values
  ('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', 'perso@a.test', 'personal', 'connected',
   'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m1","gmail_thread_id":"t1","from_name":"Camille Fictive","from_address":"camille@x.test","subject":"Demande",
   "to":[{"name":"Clinique A","address":"info@a.test"}],"cc":[{"name":"Alex Témoin","address":"alex@x.test"},{"address":"sans-nom@x.test"}],
   "snippet":"Bonjour","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX"],"body_text":"Bonjour"},
  {"gmail_message_id":"m2","gmail_thread_id":"t1","from_name":"Conseillère A","from_address":"info@a.test","subject":"Re: Demande",
   "to":[{"name":"Camille Fictive","address":"camille@x.test"}],"snippet":"Avec plaisir","sent_at":"2026-10-01T13:00:00Z","label_ids":["SENT"]},
  {"gmail_message_id":"m3","gmail_thread_id":"t3","from_address":"vieux@x.test","subject":"Ancien","snippet":"Ancien extrait",
   "sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"],"body_text":"Ancien"},
  {"gmail_message_id":"m4","gmail_thread_id":"t4","from_address":"vieux@x.test","subject":"Suivi","snippet":"Vieux début",
   "sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"],"body_text":"Vieux"},
  {"gmail_message_id":"m5","gmail_thread_id":"t4","from_address":"vieux@x.test","subject":"Re: Suivi","snippet":"Récent",
   "sent_at":"2026-10-03T09:00:00Z","label_ids":["INBOX"],"body_text":"Récent"}
]$j$);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a3', $j$[
  {"gmail_message_id":"p1","gmail_thread_id":"pt1","from_name":"Quelqu'un","from_address":"x@perso.test","subject":"Personnel",
   "sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
select set_config('test.t1', (select id::text from public.mail_threads where gmail_thread_id = 't1'), true);
select set_config('test.t3', (select id::text from public.mail_threads where gmail_thread_id = 't3'), true);
select set_config('test.t4', (select id::text from public.mail_threads where gmail_thread_id = 't4'), true);
select set_config('test.pt1', (select id::text from public.mail_threads where gmail_thread_id = 'pt1'), true);

-- =============================================================================
-- 1. The AI draft's context
-- =============================================================================
set local role service_role;
select results_eq($$
  select c -> 'person', c -> 'correspondent_names'
    from (select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002',
                                                     null, current_setting('test.t1')::uuid) c) x $$,
  $$ values ('null'::jsonb, '["Alex Témoin", "Camille Fictive", "Clinique A", "Conseillère A"]'::jsonb) $$,
  'a thread linked to no file: every correspondent''s name is given to be masked (from, to, cc; a nameless address skipped)');
select is((public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', null, null)) -> 'correspondent_names',
  '[]'::jsonb, 'no thread: no correspondent');
select throws_ok($$ select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002',
                                                               null, current_setting('test.pt1')::uuid) $$,
  '42501', 'Permission refusée : fil de courriels', 'a thread of the admin''s personal mailbox: refused to the conseillère');
select lives_ok($$ select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
                                                              null, current_setting('test.pt1')::uuid) $$,
  '… given to its owner');
select throws_ok($$ select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002',
                                                               null, gen_random_uuid()) $$,
  '42501', 'Permission refusée : fil de courriels', 'an unknown thread: refused');
select throws_ok($$ select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', null, null) $$,
  '42501', 'Permission refusée : communications.inbox', 'drafting needs communications.inbox');
select throws_ok($$ select public.ai_draft_context_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', null, null) $$,
  '42501', 'Permission refusée : communications.ai_draft', 'the provider: refused as before');
reset role;

-- =============================================================================
-- 2. The PBX settings
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_sms_settings('{"sms_base_url": "https://pbx.exemple.test", "sms_client_id": "app-exemple", "sms_did": "418 555 0199"}') $$,
  'the admin (settings.integrations_manage) sets the PBX');
reset role;
select set_config('test.vault_id', (select vault.create_secret('jeton-factice', 'sec-test-access')::text), true);
insert into public.sms_provider_sessions (org_id, base_url, access_secret_id, access_expires_at)
values ('b0000000-0000-0000-0000-00000000000a', 'https://pbx.exemple.test', current_setting('test.vault_id')::uuid, now() + interval '1 hour');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_sms_settings('{"sms_base_url": "https://pbx.ailleurs.test"}') $$, 'P0001',
  'Seul un administrateur des intégrations peut changer l''adresse de la centrale, l''identifiant de l''application ou le numéro de la clinique.',
  'sms_manage alone cannot move the PBX address (where the client secret goes)');
select throws_ok($$ select public.set_sms_settings('{"sms_client_id": "autre-app"}') $$, 'P0001', null, '… nor the client id');
select throws_ok($$ select public.set_sms_settings('{"sms_did": "418 555 0100"}') $$, 'P0001', null, '… nor the clinic''s number');
select throws_ok($$ select public.set_sms_settings('{"sms_base_url": null}') $$, 'P0001', null, '… nor clear the address');
select lives_ok($$ select public.set_sms_settings('{"sms_base_url": "https://pbx.exemple.test/", "sms_client_id": "app-exemple", "sms_did": "(418) 555-0199"}') $$,
  'the same values again (as the form sends them) are accepted');
select lives_ok($$ select public.set_sms_settings('{"sms_opt_out_reply": "Vous ne recevrez plus de textos de la clinique. Merci."}') $$,
  'sms_manage still changes the texts');
reset role;
select is((select count(*)::int from public.sms_provider_sessions where org_id = 'b0000000-0000-0000-0000-00000000000a'), 1,
  'an unchanged address keeps the PBX session');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.set_sms_settings('{"sms_base_url": "https://pbx.nouvelle.test"}')) ->> 'sms_base_url', 'https://pbx.nouvelle.test',
  'the admin moves the PBX');
reset role;
select is((select count(*)::int from public.sms_provider_sessions where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0,
  'a new PBX address deletes the stored session');
select is((select count(*)::int from vault.secrets where id = current_setting('test.vault_id')::uuid), 0, '… and its token leaves Vault');

-- =============================================================================
-- 3. A test text to a withdrawn number
-- =============================================================================
insert into public.sms_consents (org_id, phone_e164, status, source, granted_at, withdrawn_at) values
  ('b0000000-0000-0000-0000-00000000000a', '+15145550111', 'opted_out', 'sms_reply', now() - interval '1 day', now()),
  ('b0000000-0000-0000-0000-00000000000a', '+15145550122', 'opted_in', 'staff', now() - interval '1 day', null);
set local role service_role;
select throws_ok($$ select public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
                                                        '514 555 0111', 'Texto de test.', 'test') $$,
  'P0001', 'Aucun texto ne peut être envoyé à ce numéro : la personne a retiré son consentement.', 'a test to a withdrawn number is refused');
select is((public.queue_sms_for_service('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
                                        '514 555 0133', 'Texto de test.', 'test')) ->> 'to_e164',
  '+15145550133', 'a test to a number with no consent recorded still goes (no staff number exists to limit it to)');
reset role;

-- =============================================================================
-- 4. The dispatch while the module is reserved (P3-40)
-- =============================================================================
delete from public.sms_messages;
insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550122', 'reminder', 'Rappel', 'queued'),
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550122', 'consent_notice', 'Avis', 'queued'),
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550122', 'reply', 'Réponse', 'queued'),
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550111', 'opt_out_ack', 'Retrait', 'queued'),
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550133', 'test', 'Test', 'queued'),
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550111', 'test', 'Test retiré', 'queued');
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
set local role service_role;
select results_eq($$ select c.kind, c.to_e164 from public.claim_sms_batch_for_service('b0000000-0000-0000-0000-00000000000a', 20) c order by c.kind $$,
  $$ values ('opt_out_ack'::text, '+15145550111'::text), ('test', '+15145550133') $$,
  'reserved for testers: only the acknowledgement of a withdrawal and a test leave');
reset role;
select results_eq($$ select m.kind, m.status, m.error_code from public.sms_messages m where m.kind in ('reminder', 'consent_notice', 'reply') order by m.kind $$,
  $$ values ('consent_notice'::text, 'failed'::text, 'module_reserved'::text), ('reminder', 'failed', 'module_reserved'), ('reply', 'failed', 'module_reserved') $$,
  '… the client texts fail `module_reserved`, never left for the go-live');
select results_eq($$ select m.status, m.error_code from public.sms_messages m where m.body = 'Test retiré' $$,
  $$ values ('failed'::text, 'consent_withdrawn'::text) $$, 'a queued test to a withdrawn number fails `consent_withdrawn`');
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
insert into public.sms_messages (org_id, direction, peer_e164, kind, body, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'out', '+15145550122', 'reminder', 'Rappel ouvert', 'queued');
set local role service_role;
select results_eq($$ select c.body from public.claim_sms_batch_for_service('b0000000-0000-0000-0000-00000000000a', 20) c $$,
  $$ values ('Rappel ouvert'::text) $$, 'open to all again: the client text leaves');
reset role;

-- =============================================================================
-- 5. Stop words
-- =============================================================================
select is(private.sms_keyword('STOP merci'), 'stop', '« STOP merci »: the first word stops');
select is(private.sms_keyword('Arrêt svp'), 'stop', '« Arrêt svp »');
select is(private.sms_keyword('arrêter'), 'stop', '« arrêter »');
select is(private.sms_keyword('ARRETER'), 'stop', '« ARRETER »');
select is(private.sms_keyword('Arrêtez!'), 'stop', '« Arrêtez! »');
select is(private.sms_keyword('arretez de m''écrire'), 'stop', '« arretez de m''écrire »');
select is(private.sms_keyword('Arrête'), 'stop', '« Arrête »');
select is(private.sms_keyword('Désabonner'), 'stop', '« Désabonner »');
select is(private.sms_keyword('desabonner svp'), 'stop', '« desabonner svp »');
select is(private.sms_keyword('Désabonnez-moi'), 'stop', '« Désabonnez-moi »');
select is(private.sms_keyword('Unsubscribe please'), 'stop', '« Unsubscribe please »');
select is(private.sms_keyword('stop l''envoi'), 'stop', '« stop l''envoi »');
select is(private.sms_keyword('CANCEL'), 'stop', '« CANCEL » alone still stops');
select is(private.sms_keyword('Cancel mon rendez-vous'), null, '« Cancel mon rendez-vous » is not a withdrawal');
select is(private.sms_keyword('Je ne veux pas arrêter'), null, 'a stop word that is not the first word does not count');
select is(private.sms_keyword('Oui merci'), null, '« OUI » confirms only alone');
select is(private.sms_keyword('Oui'), 'yes', '« Oui » confirms');
set local role service_role;
select is((public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145550122', '+14185550199', 'Arrêt svp', '[]', 900001, 900002, now())) ->> 'keyword',
  'stop', 'an inbound « Arrêt svp » is a withdrawal');
reset role;
select is((select c.status from public.sms_consents c where c.phone_e164 = '+15145550122'), 'opted_out', '… the consent withdrawn');

-- =============================================================================
-- 6. The purge
-- =============================================================================
update public.mail_messages set sent_at = now() - interval '25 months' where gmail_message_id in ('m3', 'm4');
insert into public.mail_drafts (org_id, user_id, connection_id, subject, created_at, updated_at) values
  ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', 'Ancien brouillon',
   now() - interval '26 months', now() - interval '25 months'),
  ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a', 'Brouillon récent',
   now() - interval '26 months', now() - interval '1 day');
insert into public.ai_requests (org_id, user_id, created_at, model, kind, status) values
  ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', now() - interval '14 months', 'gpt-5.4', 'write', 'ok'),
  ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', now() - interval '12 months', 'gpt-5.4', 'write', 'ok');
select is((select snippet from public.mail_threads where id = current_setting('test.t3')::uuid), 'Ancien extrait', 'before: the thread shows its message''s snippet');
select is(private.job_mail_bodies_purge(), 'purged=2 files=0 threads=2 drafts=1 ai_requests=1', 'the job: two messages, their threads, an old draft, an old AI call');
select is((select snippet from public.mail_threads where id = current_setting('test.t3')::uuid), null, 'a thread whose last message is purged loses its snippet');
select is((select snippet from public.mail_threads where id = current_setting('test.t4')::uuid), 'Récent', 'a thread with a newer message keeps the newer snippet');
select results_eq($$ select subject from public.mail_drafts order by subject $$, $$ values ('Brouillon récent'::text) $$,
  'a draft untouched for 24 months is deleted, a recent one kept');
select is((select count(*)::int from public.ai_requests where created_at < now() - interval '13 months'), 0, 'AI calls older than 13 months are deleted');
select is((select count(*)::int from public.ai_requests), 1, '… the year''s calls kept');

select * from finish();
rollback;
