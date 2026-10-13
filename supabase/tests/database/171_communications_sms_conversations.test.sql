-- Communications, two-way SMS conversations (migration *_communications_sms_conversations,
-- decisions SM-14 … SM-17). Fictitious numbers (555) only.
-- Covers: privileges; Clients' published phone match and a file's numbers; the automatic link of
-- an inbound text (the file whose number it is; several files: to review; none: unlinked); the
-- manual link and unlink, never undone by a later text; « À rattacher » and the search of
-- `list_sms_conversations`; a file's numbers and threads (`list_client_sms`); the permissions; a
-- merge re-points the link, an anonymisation removes it; the audit row redacts the number.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select table_privs_are('public', 'sms_thread_links', 'authenticated', array['SELECT'], 'sms_thread_links: select only');
select table_privs_are('public', 'sms_thread_links', 'anon', array[]::text[], 'sms_thread_links: anon nothing');
select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': users')
  from (values ('link_sms_thread', array['text', 'uuid']), ('unlink_sms_thread', array['text']), ('get_sms_thread_link', array['text']),
               ('list_sms_conversations', array['text', 'text']), ('list_client_sms', array['uuid'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('clients_match_phone', array['uuid', 'text[]']), ('clients_phones_of', array['uuid', 'uuid']),
               ('communications_link_sms_threads', array['uuid', 'text[]'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000004', 'conseillere@a.test'), ('a0000000-0000-0000-0000-000000000005', 'pro@a.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, 'b0000000-0000-0000-0000-00000000000a', n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000004', 'Conseillère A', 'conseillere@a.test'),
               ('a0000000-0000-0000-0000-000000000005', 'Pro A', 'pro@a.test')) as v(u, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('clients'), ('communications')) as y(m);
-- Ivan (his mobile), Ana and Ben (a shared home number), Rémi (no number).
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164, home_e164) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Ivan', 'Essai', 'ivan@a.test', '+15145550101', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Ana', 'Essai', 'ana@a.test', null, '+15145550102'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Ben', 'Essai', 'ben@a.test', null, '+15145550102'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Rémi', 'Essai', 'remi@a.test', null, null),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Essai', 'zoe@a.test', '+15145550177', null);

-- Clients' published helpers.
select results_eq($$ select phone, client_id::text, match_kind from private.clients_match_phone('b0000000-0000-0000-0000-00000000000a',
                                                                                              array['+15145550101', '+15145550102']) $$,
  $$ values ('+15145550101'::text, 'd0000000-0000-0000-0000-000000000001'::text, 'client'::text),
            ('+15145550102', 'd0000000-0000-0000-0000-000000000002', 'client'),
            ('+15145550102', 'd0000000-0000-0000-0000-000000000003', 'client') $$, 'clients_match_phone: the files whose number it is');
select results_eq($$ select phone, kind from private.clients_phones_of('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001') $$,
  $$ values ('+15145550101'::text, 'mobile'::text) $$, 'clients_phones_of: a file''s numbers');

-- Inbound texts link themselves.
select public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145550101', '+14185550199', 'Bonjour', '[]', 30001, 4001, now());
select public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145550102', '+14185550199', 'Bonjour', '[]', 30002, 4002, now());
select public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145550199', '+14185550199', 'Bonjour', '[]', 30003, 4003, now());
select results_eq($$ select peer_e164, status, client_id::text, pg_catalog.cardinality(candidate_client_ids), source
                       from public.sms_thread_links order by peer_e164 $$,
  $$ values ('+15145550101'::text, 'linked'::text, 'd0000000-0000-0000-0000-000000000001'::text, 0, 'auto'::text),
            ('+15145550102', 'needs_review', null, 2, 'auto'),
            ('+15145550199', 'unlinked', null, 0, null) $$,
  'one file: linked; a shared number: to review; an unknown one: unlinked');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select phone, link_status from public.list_sms_conversations('to_link', null) order by phone $$,
  $$ values ('+15145550102'::text, 'needs_review'::text), ('+15145550199', 'unlinked') $$, '« À rattacher »: the threads not linked');
select results_eq($$ select phone, client_name from public.list_sms_conversations('all', 'ivan') $$,
  $$ values ('+15145550101'::text, 'Ivan Essai'::text) $$, 'the search finds a thread by its file''s name');
select results_eq($$ select phone from public.list_sms_conversations('all', '0199') $$,
  $$ values ('+15145550199'::text) $$, '… or by the number''s digits');
select is(public.get_sms_thread_link('+15145550102') -> 'candidates' -> 0 ->> 'display_name', 'Ana Essai', 'the candidates to review');

-- Manual link and unlink: never undone by a later text.
select lives_ok($$ select public.link_sms_thread('514 555-0102', 'd0000000-0000-0000-0000-000000000002') $$, 'a person links the shared number to Ana');
reset role;
select public.record_inbound_sms('b0000000-0000-0000-0000-00000000000a', '+15145550102', '+14185550199', 'Encore', '[]', 30004, 4002, now());
select results_eq($$ select status, client_id::text, source from public.sms_thread_links where peer_e164 = '+15145550102' $$,
  $$ values ('linked'::text, 'd0000000-0000-0000-0000-000000000002'::text, 'manual'::text) $$, '… a later text leaves it as a person chose');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.unlink_sms_thread('+15145550199') $$, '« Détacher » the unknown number');
select is((select count(*)::int from public.list_sms_conversations('to_link', null)), 0, '… a person''s choice leaves « À rattacher »');
select throws_ok($$ select public.link_sms_thread('+15145550199', 'd0000000-0000-0000-0000-0000000000ff') $$, 'P0001',
  'Choisissez un dossier client de la clinique.', 'a file of the clinic only');
select lives_ok($$ select public.link_sms_thread('+15145550188', 'd0000000-0000-0000-0000-000000000004') $$,
  'a number with no text yet can be linked (the first text from the file)');

-- A consent the staff records (« Nouveau numéro ») links the number to its file too.
select public.set_sms_consent('514 555-0177', 'opted_in', p_note => 'Au téléphone');
select results_eq($$ select status, client_id::text, source from public.sms_thread_links where peer_e164 = '+15145550177' $$,
  $$ values ('linked'::text, 'd0000000-0000-0000-0000-000000000005'::text, 'auto'::text) $$, 'a consent recorded links Zoé''s mobile to her file');

-- A file's numbers and threads.
select results_eq($$ select phone, kind, message_count from public.list_client_sms('d0000000-0000-0000-0000-000000000001') $$,
  $$ values ('+15145550101'::text, 'mobile'::text, 1) $$, 'Ivan''s file: his mobile and its thread');
select results_eq($$ select phone, kind, message_count from public.list_client_sms('d0000000-0000-0000-0000-000000000004') $$,
  $$ values ('+15145550188'::text, 'linked'::text, 0) $$, 'Rémi''s file: the number linked to it');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.link_sms_thread('+15145550101', 'd0000000-0000-0000-0000-000000000004') $$, '42501',
  'Permission refusée : communications.sms, clients.view', 'a professional cannot link');
reset role;

-- Clients' merge and anonymisation handlers.
select private.communications_reassign_client('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003');
select is((select client_id::text from public.sms_thread_links where peer_e164 = '+15145550102'), 'd0000000-0000-0000-0000-000000000003',
  'a merge: the link follows the kept file');
select private.communications_anonymize_client('d0000000-0000-0000-0000-000000000001');
select results_eq($$ select status, client_id from public.sms_thread_links where peer_e164 = '+15145550101' $$,
  $$ values ('unlinked'::text, null::uuid) $$, 'an anonymisation: the thread is no longer hers');
select is((select count(*)::int from public.audit_log a
            where a.table_name = 'sms_thread_links' and a.changed_fields::text like '%5145550101%'),
  0, 'the audit log never holds the number');

select * from finish();
rollback;
