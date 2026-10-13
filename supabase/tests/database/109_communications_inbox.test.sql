-- Communications, batch CM2 (migration *_communications_inbox.sql): the inbox's reads
-- (list_mail_threads, get_mail_thread: SECURITY INVOKER, the mirror's RLS) and the actions'
-- service RPC (get_mail_threads_for_action: the actor re-checked).
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- =============================================================================
-- Fixtures (as postgres): org A (module on; admin 01, counselor 02 with the inbox, provider 03),
-- org B (admin 05, module on). A shared mailbox in each, and a disconnected one in A.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@cm2.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@cm2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@cm2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@cm2.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@cm2.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'communications', true),
  ('b0000000-0000-0000-0000-00000000000b', 'communications', true);
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.inbox');

insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by) values
  ('c0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'info@a.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'old@a.test', 'shared', 'disconnected', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'info@b.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000005');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.n', (select count(*)::text from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m1","gmail_thread_id":"t1","from_name":"Alice","from_address":"alice@x.test","subject":"Demande de rendez-vous",
   "snippet":"Bonjour, je cherche une psychologue","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX","UNREAD"],
   "body_html":"<p>Bonjour</p>","body_text":"Bonjour",
   "attachments":[{"part_id":"2","gmail_attachment_id":"att","filename":"cv.pdf","mime_type":"application/pdf","size_bytes":10,"is_inline":false,"accepted":true}]},
  {"gmail_message_id":"m2","gmail_thread_id":"t1","from_address":"info@a.test","subject":"Re: Demande de rendez-vous","snippet":"Avec plaisir",
   "sent_at":"2026-10-01T13:00:00Z","label_ids":["SENT"]},
  {"gmail_message_id":"m3","gmail_thread_id":"t2","from_name":"Bob","from_address":"bob@x.test","subject":"Facture de septembre","snippet":"Ci-joint la facture",
   "sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX","STARRED","Label_7"]},
  {"gmail_message_id":"m4","gmail_thread_id":"t3","from_address":"carl@x.test","subject":"Archivé","snippet":"Vieux",
   "sent_at":"2026-09-01T09:00:00Z","label_ids":["Label_7"]},
  {"gmail_message_id":"m5","gmail_thread_id":"t4","from_address":"spam@x.test","subject":"Pourriel","snippet":"Gagnez",
   "sent_at":"2026-10-03T09:00:00Z","label_ids":["SPAM"]}
]$j$)), true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', $j$[
  {"gmail_message_id":"z1","gmail_thread_id":"zt1","from_address":"x@b.test","subject":"Org B","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
select set_config('test.t1', (select id::text from public.mail_threads where gmail_thread_id = 't1'), true);
select set_config('test.t2', (select id::text from public.mail_threads where gmail_thread_id = 't2'), true);
select set_config('test.t3', (select id::text from public.mail_threads where gmail_thread_id = 't3'), true);
select set_config('test.zt1', (select id::text from public.mail_threads where gmail_thread_id = 'zt1'), true);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'list_mail_threads', array['uuid', 'text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer'],
  'authenticated', array['EXECUTE'], 'list_mail_threads: authenticated');
select function_privs_are('public', 'list_mail_threads', array['uuid', 'text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer'],
  'anon', array[]::text[], 'list_mail_threads: not anon');
select function_privs_are('public', 'get_mail_thread', array['uuid'], 'authenticated', array['EXECUTE'], 'get_mail_thread: authenticated');
select function_privs_are('public', 'get_mail_threads_for_action', array['uuid', 'uuid', 'uuid[]'], 'authenticated', array[]::text[],
  'get_mail_threads_for_action: not authenticated');
select function_privs_are('public', 'get_mail_threads_for_action', array['uuid', 'uuid', 'uuid[]'], 'service_role', array['EXECUTE'],
  'get_mail_threads_for_action: service_role');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.list_mail_threads(uuid, text, text, text, timestamptz, uuid, int)'::regprocedure),
  false, 'list_mail_threads is SECURITY INVOKER (the RLS is the check)');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.get_mail_thread(uuid)'::regprocedure), false, 'get_mail_thread is SECURITY INVOKER');

-- =============================================================================
-- The views, as the counselor (communications.inbox)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('t2'), ('t1') $$, 'inbox: the INBOX threads, newest first');
select results_eq($$ select gmail_thread_id, unread_count, link_status from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'unread') $$,
  $$ values ('t1', 1, 'unlinked') $$, 'unread: the inbox threads with an unread message');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'starred') $$,
  $$ values ('t2') $$, 'starred');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'sent') $$,
  $$ values ('t1') $$, 'sent: a thread with a sent message');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'label', 'Label_7') $$,
  $$ values ('t2'), ('t3') $$, 'a user label, archived threads included');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all') $$,
  $$ values ('t2'), ('t1'), ('t3') $$, 'all: everything but spam and trash');
select is_empty($$ select 1 from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'nope') $$, 'an unknown view lists nothing');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all', null, 'factures') $$,
  $$ values ('t2') $$, 'the search reads the subject (French stemming)');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all', null, 'psychologue') $$,
  $$ values ('t1') $$, 'and the snippet');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all', null, 'facture -bob') $$,
  $$ select 't1' where false $$, 'web-search syntax: a minus excludes');
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all', null, '   ') $$,
  $$ values ('t2'), ('t1'), ('t3') $$, 'a blank search is no search');

-- Keyset: one page of 1, then the next after it.
select results_eq($$ select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all', null, null, null, null, 1) $$,
  $$ values ('t2') $$, 'page 1');
select results_eq($$
  select gmail_thread_id from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all', null, null,
    (select last_message_at from public.mail_threads where id = current_setting('test.t2')::uuid), current_setting('test.t2')::uuid, 1)
$$, $$ values ('t1') $$, 'page 2 starts after the last row seen');

-- The thread.
select results_eq($$
  select (j->>'subject'), (j->>'mailbox'), jsonb_array_length(j->'messages'),
         (j->'messages'->0->>'gmail_message_id'), (j->'messages'->0->'attachments'->0->>'status'), (j->'messages'->1->>'is_inbound')::boolean
    from (select public.get_mail_thread(current_setting('test.t1')::uuid) j) x
$$, $$ values ('Demande de rendez-vous', 'info@a.test', 2, 'm1', 'pending', false) $$,
  'get_mail_thread: summary, messages oldest first, attachments, direction');
select is(public.get_mail_thread(current_setting('test.zt1')::uuid), null::jsonb, 'another clinic''s thread: nothing');

-- The provider and another clinic see nothing; a disabled module hides everything.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all') $$, 'the provider lists nothing');
select is(public.get_mail_thread(current_setting('test.t1')::uuid), null::jsonb, 'nor reads a thread');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all') $$, 'org B lists nothing of org A');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_mail_threads('c0000000-0000-0000-0000-00000000000a', 'all') $$, 'module disabled: nothing, for the admin too');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';

-- =============================================================================
-- get_mail_threads_for_action (service role, the actor re-checked)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select results_eq($$
  select gmail_thread_id, jsonb_array_length(messages), messages->0->>'gmail_message_id'
    from public.get_mail_threads_for_action('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
      array[current_setting('test.t1')::uuid, current_setting('test.t2')::uuid, current_setting('test.zt1')::uuid])
   order by 1
$$, $$ values ('t1', 2, 'm1'), ('t2', 1, 'm3') $$, 'the counselor''s threads, another clinic''s left out, with their messages');
select throws_ok($$
  select * from public.get_mail_threads_for_action('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', array[current_setting('test.t1')::uuid])
$$, '42501', null, 'the provider (no communications.inbox) is refused');
select throws_ok($$
  select * from public.get_mail_threads_for_action('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', array[current_setting('test.t1')::uuid])
$$, '42501', null, 'a member of another clinic is refused');
select throws_ok($$
  select * from public.get_mail_threads_for_action('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
    array(select gen_random_uuid() from generate_series(1, 51)))
$$, '22023', null, 'at most 50 threads');
reset role;
update public.mail_connections set status = 'disconnected' where id = 'c0000000-0000-0000-0000-00000000000a';
set local role service_role;
select is_empty($$
  select 1 from public.get_mail_threads_for_action('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', array[current_setting('test.t1')::uuid])
$$, 'a disconnected mailbox takes no action');

select * from finish();
rollback;
