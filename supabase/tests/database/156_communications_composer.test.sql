-- Communications, batch CM3 (migration *_communications_composer.sql): drafts (each person's own),
-- templates (the clinic's and personal ones), « Écrire » from a record, the send's checks
-- (prepare_mail_send: mailbox, thread, recipients, client, placeholders, files, P3-40,
-- idempotency) and its close (complete_mail_send), the merge, and the backfill of CM2b's link.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('save_mail_draft', 'delete_mail_draft', 'save_mail_template', 'delete_mail_template',
                       'list_mail_compose_templates', 'get_mail_compose_context')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the composer''s writes: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('list_mail_drafts', 'get_mail_draft', 'list_client_mail_threads')
     and (p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the reads: SECURITY INVOKER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('prepare_mail_send', 'complete_mail_send')
     and (not p.prosecdef or has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the send''s RPCs: SECURITY DEFINER, the service role only');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('mail_addresses_valid', 'mail_placeholder_error', 'mail_connection_for', 'mail_files_for',
                       'job_mail_links_backfill', 'mail_compose_placeholders')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@cm.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Clinique A'), ('b0000000-0000-0000-0000-00000000000b', 'Clinique B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Julie Gagnon', 'u1@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Admin Deux', 'u4@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe', 'u5@cm.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('communications'), ('clients')) m(key);
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Envoi', 'alice@x.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Garde', 'bruno@x.test'),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Alice', 'Ailleurs', 'alice@x.test');
insert into public.mail_connections (id, org_id, email_address, kind, status, scopes, connected_by) values
  ('c0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'info@a.test', 'shared', 'connected',
   array['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'], 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'admin@a.test', 'shared', 'connected',
   array['https://www.googleapis.com/auth/gmail.modify'], 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'info@b.test', 'shared', 'connected',
   array['https://www.googleapis.com/auth/gmail.send'], 'a0000000-0000-0000-0000-000000000003');
-- The composer's uploads: one of Julie's, one of Admin Deux's; a mirrored attachment; a big one.
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, uploaded_by, retain_until)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'documents',
   'b0000000-0000-0000-0000-00000000000a/communications/a0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-000000000001.pdf',
   'communications', 'mail_outgoing', 'upload', 'a0000000-0000-0000-0000-000000000001', 'communications.inbox', 'recu.pdf',
   'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now(), 'a0000000-0000-0000-0000-000000000001', now() + interval '30 days'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'documents',
   'b0000000-0000-0000-0000-00000000000a/communications/a0000000-0000-0000-0000-000000000004/e0000000-0000-0000-0000-000000000002.pdf',
   'communications', 'mail_outgoing', 'upload', 'a0000000-0000-0000-0000-000000000004', 'communications.inbox', 'autre.pdf',
   'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now(), 'a0000000-0000-0000-0000-000000000004', now() + interval '30 days'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'documents',
   'b0000000-0000-0000-0000-00000000000a/communications/a0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-000000000003.pdf',
   'communications', 'mail_outgoing', 'upload', 'a0000000-0000-0000-0000-000000000001', 'communications.inbox', 'gros.pdf',
   'application/pdf', 'pdf', 19000000, repeat('a', 64), 'ready', now(), 'a0000000-0000-0000-0000-000000000001', now() + interval '30 days');

-- The sync mirrors one thread from Alice (linked by CM2b) and one from an unknown address.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m1","gmail_thread_id":"t1","rfc_message_id":"m1@x.test","from_name":"Alice","from_address":"alice@x.test","subject":"Rendez-vous","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"m2","gmail_thread_id":"t2","from_address":"inconnu@x.test","subject":"Question","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
select set_config('test.t1', (select id::text from public.mail_threads where gmail_thread_id = 't1'), true);
select set_config('test.t2', (select id::text from public.mail_threads where gmail_thread_id = 't2'), true);
select set_config('test.m1', (select id::text from public.mail_messages where gmail_message_id = 'm1'), true);

-- =============================================================================
-- Drafts
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d1', (public.save_mail_draft(null, jsonb_build_object(
  'connection_id', 'c0000000-0000-0000-0000-00000000000a', 'mode', 'reply', 'thread_id', current_setting('test.t1'),
  'reply_to_message_id', current_setting('test.m1'), 'to', jsonb_build_array(' Alice@X.test '),
  'subject', 'Re: Rendez-vous', 'body_html', '<p>Bonjour {{person.first_name}}</p>',
  'file_ids', jsonb_build_array('e0000000-0000-0000-0000-000000000001'))) ->> 'id'), true);
select results_eq($$ select mode, to_addresses, attachment_count from public.list_mail_drafts() $$,
  $$ values ('reply', array['alice@x.test'], 1) $$, 'a reply saved: the address in lower case, its file');
select results_eq($$ select (d -> 'attachments' -> 0 ->> 'name'), d ->> 'body_html' from public.get_mail_draft(current_setting('test.d1')::uuid) d $$,
  $$ values ('recu.pdf', '<p>Bonjour {{person.first_name}}</p>') $$, 'the draft with its attachment''s name');
select lives_ok(format($$ select public.save_mail_draft(%L, jsonb_build_object('connection_id', 'c0000000-0000-0000-0000-00000000000a',
  'mode', 'reply', 'thread_id', %L, 'to', '["alice@x.test"]'::jsonb, 'subject', 'Re: Rendez-vous', 'body_html', '<p>Plus long</p>')) $$,
  current_setting('test.d1'), current_setting('test.t1')), 'autosaved again');
select is((select body_html from public.mail_drafts where id = current_setting('test.d1')::uuid), '<p>Plus long</p>', 'the same draft, rewritten');
select throws_ok($$ select public.save_mail_draft(null, '{"connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["pas une adresse"]}') $$,
  'P0001', 'Une adresse n''est pas valide.', 'a bad address refused');
select throws_ok($$ select public.save_mail_draft(null, '{"connection_id": "c0000000-0000-0000-0000-00000000000a", "file_ids": ["e0000000-0000-0000-0000-000000000002"]}') $$,
  'P0001', 'Une pièce jointe est introuvable.', 'someone else''s upload: not hers to attach');
select throws_ok($$ select public.save_mail_draft(null, '{"connection_id": "c0000000-0000-0000-0000-00000000000b"}') $$,
  'P0001', 'Choisissez une boîte de la clinique.', 'another clinic''s mailbox refused');
select throws_ok($$ select public.save_mail_draft(null, '{"connection_id": "c0000000-0000-0000-0000-00000000000a", "client_id": "d0000000-0000-0000-0000-000000000009"}') $$,
  'P0001', 'Choisissez un dossier client de la clinique.', 'another clinic''s file refused');
select throws_ok($$ select public.save_mail_draft(null, '{"connection_id": "c0000000-0000-0000-0000-00000000000a", "mode": "forward"}') $$,
  'P0001', 'Une réponse ou un transfert part d''un fil.', 'a forward needs its thread');
-- Admin Deux sees none of Julie's drafts, and cannot overwrite them.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is_empty($$ select 1 from public.mail_drafts $$, 'another person''s drafts are not hers to read');
select is(public.get_mail_draft(current_setting('test.d1')::uuid), null::jsonb, 'nor to open');
select throws_ok(format($$ select public.save_mail_draft(%L, '{"connection_id": "c0000000-0000-0000-0000-00000000000a"}') $$, current_setting('test.d1')),
  'P0001', 'Ce brouillon n''existe plus.', 'nor to overwrite');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.save_mail_draft(null, '{"connection_id": "c0000000-0000-0000-0000-00000000000a"}') $$,
  '42501', null, 'a professional writes no draft');

-- =============================================================================
-- Templates
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select kind, id from public.list_mail_compose_templates() order by kind, id $$,
  $$ values ('clinic', 'communications.acknowledgement'), ('clinic', 'communications.follow_up') $$, 'the clinic''s two starting texts');
select set_config('test.tp', public.save_mail_template(null, 'Merci', '', '<p>Merci {{person.first_name}} !</p>')::text, true);
select results_eq($$ select kind, name, format from public.list_mail_compose_templates() where kind = 'personal' $$,
  $$ values ('personal', 'Merci', 'html') $$, 'her own template after the clinic''s');
select throws_ok($$ select public.save_mail_template(null, 'merci', '', '<p>Encore</p>') $$,
  'P0001', 'Vous avez déjà un modèle de ce nom.', 'one name once (case ignored)');
select throws_ok($$ select public.save_mail_template(null, 'Autre', '', '<p>{{client.telephone}}</p>') $$,
  'P0001', 'Variable inconnue : {{client.telephone}}.', 'an unknown placeholder refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.list_mail_compose_templates() where kind = 'personal'), 0, 'personal templates stay personal');
select lives_ok(format($$ select public.delete_mail_template(%L) $$, current_setting('test.tp')), 'deleting another''s template does nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.list_mail_compose_templates() where kind = 'personal'), 1, '… hers is still there');

-- =============================================================================
-- From a record
-- =============================================================================
select results_eq($$ select (c -> 'client' ->> 'display_name'), (c -> 'recipients' -> 0 ->> 'email'), (c -> 'recipients' -> 0 ->> 'is_self')
                      from public.get_mail_compose_context('d0000000-0000-0000-0000-000000000001') c $$,
  $$ values ('Alice Envoi', 'alice@x.test', 'true') $$, '« Écrire un courriel »: the file and her address');
select is(public.get_mail_compose_context('d0000000-0000-0000-0000-000000000009'), null::jsonb, 'another clinic''s file: nothing');
select results_eq($$ select id::text, link_source from public.list_client_mail_threads('d0000000-0000-0000-0000-000000000001') $$,
  $$ values (current_setting('test.t1'), 'auto') $$, 'her record lists the thread linked to her');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.get_mail_compose_context('d0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'a professional has no composer');
reset role;

-- =============================================================================
-- The send (gmail-send, service role)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- A reply in Alice's thread: the file from the thread's link, the threading headers, the values.
select set_config('test.s1', public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('send_key', 'f0000000-0000-0000-0000-000000000001', 'connection_id', 'c0000000-0000-0000-0000-00000000000a',
    'mode', 'reply', 'thread_id', current_setting('test.t1'), 'reply_to_message_id', current_setting('test.m1'),
    'draft_id', current_setting('test.d1'), 'to', '["alice@x.test"]'::jsonb, 'subject', 'Re: Rendez-vous',
    'body_html', '<p>Bonjour {{ person.first_name }}, {{sender.name}}</p>',
    'file_ids', '["e0000000-0000-0000-0000-000000000001"]'::jsonb))::text, true);
select results_eq($$ select s ->> 'gmail_thread_id', s ->> 'in_reply_to', s ->> 'references', s -> 'values' ->> 'person.first_name',
                            s -> 'values' ->> 'sender.name', s ->> 'from_address', s -> 'files' -> 0 ->> 'name'
                       from (select current_setting('test.s1')::jsonb s) x $$,
  $$ values ('t1', '<m1@x.test>', '<m1@x.test>', 'Alice', 'Julie Gagnon', 'info@a.test', 'recu.pdf') $$,
  'prepared: in its thread, the headers, the values to fill, the file');
select results_eq($$ select status, client_id::text, recipient_count from public.mail_sends where send_key = 'f0000000-0000-0000-0000-000000000001' $$,
  $$ values ('pending', 'd0000000-0000-0000-0000-000000000001', 1) $$, 'recorded: pending, about Alice''s file, one recipient');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000001", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["alice@x.test"], "subject": "x", "body_html": "x"}') $$,
  'P0001', 'Ce courriel est déjà en cours d''envoi.', 'the same « Envoyer » twice: not sent twice');
-- Gmail answered and the sent message is mirrored in the same thread.
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"s1","gmail_thread_id":"t1","from_address":"info@a.test","subject":"Re: Rendez-vous","sent_at":"2026-10-03T12:00:00Z","label_ids":["SENT"]}
]$j$);
select lives_ok($$ select public.complete_mail_send('b0000000-0000-0000-0000-00000000000a', (current_setting('test.s1')::jsonb ->> 'send_id')::uuid, 'sent', 's1', 't1') $$,
  'closed as sent');
select is_empty($$ select 1 from public.mail_drafts where id = current_setting('test.d1')::uuid $$, 'the draft is gone');
select results_eq($$ select subject_type, retain_until from public.stored_files where id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('mail_send', null::timestamptz) $$, 'the upload is kept with the send');
select results_eq($$ select (public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000001", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["alice@x.test"], "subject": "x", "body_html": "x"}') ->> 'already_sent') $$,
  $$ values ('true') $$, 'a retry after the send says it is already sent');

-- A new message to Bruno from his record: the new thread is linked to him.
select set_config('test.s2', public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000002", "connection_id": "c0000000-0000-0000-0000-00000000000a", "mode": "new",
    "client_id": "d0000000-0000-0000-0000-000000000002", "to": ["bruno@x.test"], "cc": ["u4@cm.test"], "subject": "Bonjour {{person.first_name}}", "body_html": "<p>Texte</p>"}')::text, true);
select is(current_setting('test.s2')::jsonb -> 'values' ->> 'person.first_name', 'Bruno', 'the values come from the named file');
select is(current_setting('test.s2')::jsonb ->> 'gmail_thread_id', null, 'a new message starts its own thread');
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"s2","gmail_thread_id":"t9","from_address":"info@a.test","subject":"Bonjour Bruno","sent_at":"2026-10-03T13:00:00Z","label_ids":["SENT"]}
]$j$);
select public.complete_mail_send('b0000000-0000-0000-0000-00000000000a', (current_setting('test.s2')::jsonb ->> 'send_id')::uuid, 'sent', 's2', 't9');
select results_eq($$ select l.status, l.client_id::text, l.source from public.mail_thread_links l join public.mail_threads t on t.id = l.thread_id
                      where t.gmail_thread_id = 't9' $$,
  $$ values ('linked', 'd0000000-0000-0000-0000-000000000002', 'manual') $$, 'the new thread belongs to Bruno''s file');

-- Refusals.
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Salut {{person.first_name}}", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Le prénom de la personne n''est pas connu : rattachez le courriel à un dossier ou retirez {{person.first_name}}.',
  'the person''s name without a file: refused, not sent with a blank');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Salut", "body_html": "<p>{{client.nas}}</p>"}') $$,
  'P0001', 'Variable inconnue : {{client.nas}}.', 'an unknown placeholder refused');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Salut", "body_html": "<p>x</p>",
    "file_ids": ["e0000000-0000-0000-0000-000000000002"]}') $$,
  'P0001', 'Une pièce jointe est introuvable.', 'someone else''s upload is not hers to send');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Salut", "body_html": "<p>x</p>",
    "file_ids": ["e0000000-0000-0000-0000-000000000003"]}') $$,
  'P0001', 'Les pièces jointes dépassent 18 Mo : Gmail refuserait le courriel.', 'more than Gmail takes: refused before trying');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-0000000000a2", "to": ["x@y.test"], "subject": "Salut", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Google n''a pas permis l''envoi depuis cette boîte : reconnectez-la dans Paramètres → Courriels Gmail.', 'a mailbox without gmail.send: reconnect');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000b", "to": ["x@y.test"], "subject": "Salut", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Choisissez une boîte de la clinique.', 'another clinic''s mailbox refused');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Salut", "body_html": "<p>x</p>"}') $$,
  '42501', null, 'a professional sends nothing');
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000003", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": [], "subject": "Salut", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Ajoutez au moins un destinataire.', 'no recipient refused');

-- P3-40: Communications « Réservé aux testeurs » writes to nobody outside the clinic.
reset role;
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
-- Julie tests it (the testers keep the module's permissions).
insert into public.org_module_testers (org_id, module_key, user_id)
values ('b0000000-0000-0000-0000-00000000000a', 'communications', 'a0000000-0000-0000-0000-000000000001');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000004", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["u4@cm.test", "x@y.test"], "subject": "Essai", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Le module est réservé aux testeurs : un courriel à une personne hors de la clinique ne peut pas encore partir.',
  'P3-40: an outside address while reserved: refused');
select is_empty($$ select 1 from public.mail_sends where send_key = 'f0000000-0000-0000-0000-000000000004' $$, '… and nothing recorded');
select lives_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000005", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["u4@cm.test"], "cc": ["admin@a.test"], "subject": "Essai", "body_html": "<p>x</p>"}') $$,
  'a tester writes to the clinic''s own people and mailboxes');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
insert into public.org_module_testers (org_id, module_key, user_id)
values ('b0000000-0000-0000-0000-00000000000a', 'clients', 'a0000000-0000-0000-0000-000000000001');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000006", "connection_id": "c0000000-0000-0000-0000-00000000000a", "client_id": "d0000000-0000-0000-0000-000000000002", "to": ["bruno@x.test"], "subject": "Essai", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Le module est réservé aux testeurs : un courriel à une personne hors de la clinique ne peut pas encore partir.',
  'P3-40: a message about a file while Clients is reserved: refused');
select lives_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000007", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Essai", "body_html": "<p>x</p>"}') $$,
  '… a message about no file is Communications'' alone');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';

-- A failed send can be tried again with the same key.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.complete_mail_send('b0000000-0000-0000-0000-00000000000a', s.id, 'failed', null, null, 'provider_error')
  from public.mail_sends s where s.send_key = 'f0000000-0000-0000-0000-000000000007';
select lives_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000007", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Essai", "body_html": "<p>x</p>"}') $$,
  'after a failure, the same « Envoyer » tries again');
select is((select status from public.mail_sends where send_key = 'f0000000-0000-0000-0000-000000000007'), 'pending', '… pending again');
reset role;

-- No answer from Gmail: `unknown`; the same key then looks in Gmail first (CM-16).
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.complete_mail_send('b0000000-0000-0000-0000-00000000000a', s.id, 'unknown', null, null, 'gmail_timeout')
  from public.mail_sends s where s.send_key = 'f0000000-0000-0000-0000-000000000007';
select is((select status from public.mail_sends where send_key = 'f0000000-0000-0000-0000-000000000007'), 'unknown',
  'no answer from Gmail: unknown, not failed');
select is((public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000007", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Essai", "body_html": "<p>x</p>"}')
  ->> 'verify_first'), 'true', 'the next try with the same key looks in Gmail before sending');
select is((public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000008", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Essai", "body_html": "<p>x</p>"}')
  ->> 'verify_first'), 'false', 'a first try sends at once');
reset role;
-- A send left pending (the function died while Gmail was asked): after two minutes, tried again, looking first.
alter table public.mail_sends disable trigger mail_sends_set_updated_at;
update public.mail_sends set updated_at = now() - interval '3 minutes' where send_key = 'f0000000-0000-0000-0000-000000000008';
alter table public.mail_sends enable trigger mail_sends_set_updated_at;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((public.prepare_mail_send('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000008", "connection_id": "c0000000-0000-0000-0000-00000000000a", "to": ["x@y.test"], "subject": "Essai", "body_html": "<p>x</p>"}')
  ->> 'verify_first'), 'true', 'a pending send left behind is tried again, looking first');
reset role;

-- The file needs clients.view: the adjointe reads the inbox without it, names no file, and a
-- thread's link is not hers to use.
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'clients.view', false),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'communications.inbox', true);
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select public.prepare_mail_send('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a',
  '{"send_key": "f0000000-0000-0000-0000-000000000009", "connection_id": "c0000000-0000-0000-0000-00000000000a", "client_id": "d0000000-0000-0000-0000-000000000002", "to": ["bruno@x.test"], "subject": "Essai", "body_html": "<p>x</p>"}') $$,
  'P0001', 'Choisissez un dossier client de la clinique.', 'without clients.view: no file named');
select is((public.prepare_mail_send('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('send_key', 'f0000000-0000-0000-0000-00000000000a', 'connection_id', 'c0000000-0000-0000-0000-00000000000a',
    'mode', 'reply', 'thread_id', current_setting('test.t1'), 'reply_to_message_id', current_setting('test.m1'),
    'to', '["alice@x.test"]'::jsonb, 'subject', 'Re: Rendez-vous', 'body_html', '<p>x</p>')) -> 'values' ->> 'person.first_name'), null,
  '… nor the name from the thread''s link');
select is((select client_id from public.mail_sends where send_key = 'f0000000-0000-0000-0000-00000000000a'), null,
  '… and the send is about no file');

-- A mirrored attachment is hers to forward only from a mailbox she reads.
reset role;
insert into public.mail_connections (id, org_id, email_address, kind, owner_profile_id, status, scopes, connected_by) values
  ('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', 'julie@a.test', 'personal',
   'a0000000-0000-0000-0000-000000000001', 'connected', array['https://www.googleapis.com/auth/gmail.modify'], 'a0000000-0000-0000-0000-000000000001');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a3', $j$[
  {"gmail_message_id":"p1","gmail_thread_id":"pt1","from_address":"ami@x.test","subject":"Personnel","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, uploaded_by)
select ('e0000000-0000-0000-0000-00000000000' || x.n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/communications/' || m.id || '/e0000000-0000-0000-0000-00000000000' || x.n || '.pdf',
       'communications', 'mail_attachment', 'mail_message', m.id, 'communications.inbox', 'piece.pdf',
       'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now(), null
  from (values (4, 'p1'), (5, 'm1')) x(n, gm) join public.mail_messages m on m.gmail_message_id = x.gm;
insert into public.mail_attachments (org_id, message_id, part_id, filename, mime_type, size_bytes, status, stored_file_id)
select 'b0000000-0000-0000-0000-00000000000a', m.id, '1', 'piece.pdf', 'application/pdf', 1000, 'stored',
       ('e0000000-0000-0000-0000-00000000000' || x.n)::uuid
  from (values (4, 'p1'), (5, 'm1')) x(n, gm) join public.mail_messages m on m.gmail_message_id = x.gm;
select is((select count(*)::int from private.mail_files_for('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004',
  array['e0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000005']::uuid[])), 1,
  'Admin Deux forwards the shared mailbox''s attachment, never one of Julie''s personal mailbox');
select is((select count(*)::int from private.mail_files_for('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
  array['e0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000005']::uuid[])), 2,
  'Julie forwards both');
select results_eq($$ select view_permission, owner_permission from public.upload_purposes where key = 'mail_outgoing' $$,
  $$ values ('communications.mailboxes_manage', 'communications.inbox') $$,
  'a composer upload is read by its owner (and the mailbox managers), not every inbox user');

-- =============================================================================
-- Merge, and the backfill of CM2b
-- =============================================================================
insert into public.mail_drafts (org_id, user_id, connection_id, client_id)
values ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a',
        'd0000000-0000-0000-0000-000000000002');
select cmp_ok(private.communications_reassign_client('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001'), '>=', 3,
  'a merge moves the links, the drafts and the sends');
select is_empty($$ select 1 from public.mail_drafts where client_id = 'd0000000-0000-0000-0000-000000000002'
                  union all select 1 from public.mail_sends where client_id = 'd0000000-0000-0000-0000-000000000002' $$,
  '… nothing left on the merged file');

-- Threads mirrored while Clients was off, then a file created after the email: the nightly job links them.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"o1","gmail_thread_id":"old1","from_address":"alice@x.test","subject":"Ancien","sent_at":"2026-09-01T12:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"o2","gmail_thread_id":"old2","from_address":"alice@x.test","subject":"Ancien détaché","sent_at":"2026-09-02T12:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
update public.mail_thread_links l set status = 'unlinked', source = 'manual'
  from public.mail_threads t where t.id = l.thread_id and t.gmail_thread_id = 'old2';
select matches(private.job_mail_links_backfill(), '^threads=\d+ linked=[1-9]', 'the backfill runs and links');
select results_eq($$ select t.gmail_thread_id, l.status, l.source from public.mail_thread_links l join public.mail_threads t on t.id = l.thread_id
                      where t.gmail_thread_id in ('old1', 'old2') order by 1 $$,
  $$ values ('old1', 'linked', 'auto'), ('old2', 'unlinked', 'manual') $$, 'the old thread linked, the one a person unlinked left alone');
select matches(private.job_mail_links_backfill(), '^threads=\d+ linked=0$', 'a second run changes nothing');
-- A message sent about Alice's file whose mirror failed: the thread arrives with the next sync, the job links it.
insert into public.mail_sends (org_id, connection_id, sent_by, send_key, mode, client_id, recipient_count, status, gmail_message_id, gmail_thread_id, sent_at)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-0000000000ff', 'new', 'd0000000-0000-0000-0000-000000000001', 1, 'sent', 'late1', 'tlate', now());
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"late1","gmail_thread_id":"tlate","from_address":"info@a.test","subject":"Envoyé","sent_at":"2026-10-03T12:00:00Z","label_ids":["SENT"]}
]$j$);
reset role;
select private.job_mail_links_backfill();
select results_eq($$ select l.status, l.client_id::text, l.source, s.thread_id = t.id
                       from public.mail_threads t join public.mail_thread_links l on l.thread_id = t.id
                       join public.mail_sends s on s.gmail_thread_id = t.gmail_thread_id
                      where t.gmail_thread_id = 'tlate' $$,
  $$ values ('linked', 'd0000000-0000-0000-0000-000000000001', 'manual', true) $$,
  'a sent thread mirrored late is linked to the file it was written about');
select ok(exists (select 1 from public.scheduled_jobs where key = 'communications.mail_links_backfill' and is_maintenance and kind = 'sql'),
  'a nightly maintenance job (« Exécuter maintenant »)');

select * from finish();
rollback;
