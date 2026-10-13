-- Communications, batch CM1 (migration *_communications_gmail.sql): the module's registry rows,
-- the mailboxes, their encrypted tokens, the sync state, the mirror (labels, threads, messages,
-- attachments, links), the service RPCs the functions call, the jobs and the 24-month purge.
begin;
create extension if not exists pgtap with schema extensions;
select plan(108);

-- =============================================================================
-- Fixtures (as postgres): org A (module enabled; admin 01, counselor 02, provider 03, adjointe
-- 04), org B (admin 05, module enabled). Nothing from the seed is counted: every assertion is
-- keyed on these ids.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@cm.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u4@cm.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@cm.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'communications', true),
  ('b0000000-0000-0000-0000-00000000000b', 'communications', true);
-- The counselors and adjointes hold the inbox by the template (CC-15).
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.inbox'),
  ('b0000000-0000-0000-0000-00000000000a', 'admin_assistant', 'communications.inbox')
on conflict do nothing;

-- =============================================================================
-- Registry
-- =============================================================================
select results_eq($$ select name from public.modules where key = 'communications' $$, $$ values ('Communications') $$, 'module registered');
select results_eq($$
  select p.key from public.permissions p where p.module_key = 'communications' and p.key in ('communications.inbox', 'communications.mailboxes_manage') order by 1
$$, $$ values ('communications.inbox'), ('communications.mailboxes_manage') $$, 'CM1 permissions');
select results_eq($$
  select key, kind, is_maintenance, function_name, sql_function from public.scheduled_jobs
   where module_key = 'communications' and (key like 'communications.gmail%' or key like 'communications.mail%') order by 1
$$, $$ values ('communications.gmail_sync', 'function', false, 'gmail-sync', null::text),
             ('communications.gmail_watch_renew', 'function', false, 'gmail-watch-renew', null::text),
             ('communications.mail_bodies_purge', 'sql', true, null::text, 'private.job_mail_bodies_purge'),
             ('communications.mail_links_backfill', 'sql', true, null::text, 'private.job_mail_links_backfill') $$,
  'four jobs: the sync fallback, the watch renewal, the purge, the links backfill (CM3)');
select results_eq($$
  select j.jobname, j.schedule from cron.job j
   where j.jobname like 'communications.gmail%' or j.jobname like 'communications.mail%' order by 1
$$, $$ values ('communications.gmail_sync', '*/15 * * * *'), ('communications.gmail_watch_renew', '35 * * * *'),
             ('communications.mail_bodies_purge', '45 8 * * *'), ('communications.mail_links_backfill', '25 8 * * *') $$, 'cron entries');
select results_eq($$
  select module_key, bucket, upload_permission, view_permission, retain_days from public.upload_purposes where key = 'mail_attachment'
$$, $$ values ('communications', 'documents', 'communications.mailboxes_manage', 'communications.inbox', null::int) $$,
  'mail_attachment purpose: documents, read with communications.inbox, no staging');

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'mail_connections', 'anon', array[]::text[], 'anon: nothing on mail_connections');
select table_privs_are('public', 'mail_connections', 'authenticated', array['SELECT'], 'authenticated: select on mail_connections');
select table_privs_are('public', 'mail_connection_tokens', 'authenticated', array[]::text[], 'authenticated: nothing on the tokens');
select table_privs_are('public', 'mail_connection_tokens', 'service_role', array[]::text[], 'service_role: nothing on the tokens either');
select table_privs_are('public', 'mail_sync_state', 'authenticated', array[]::text[], 'authenticated: nothing on the sync state');
select table_privs_are('public', 'mail_threads', 'authenticated', array['SELECT'], 'authenticated: select on threads');
select table_privs_are('public', 'mail_messages', 'authenticated', array['SELECT'], 'authenticated: select on messages');
select table_privs_are('public', 'mail_attachments', 'authenticated', array['SELECT'], 'authenticated: select on attachments');
select table_privs_are('public', 'mail_labels', 'authenticated', array['SELECT'], 'authenticated: select on labels');
select table_privs_are('public', 'mail_thread_links', 'authenticated', array['SELECT'], 'authenticated: select on links');

select function_privs_are('public', 'get_communications_settings', array[]::text[], 'authenticated', array['EXECUTE'], 'get_communications_settings: authenticated');
select function_privs_are('public', 'set_communications_settings', array['jsonb'], 'authenticated', array['EXECUTE'], 'set_communications_settings: authenticated');
select function_privs_are('public', 'list_mail_connections', array[]::text[], 'authenticated', array['EXECUTE'], 'list_mail_connections: authenticated');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('store_mail_connection', 'disconnect_mail_connection', 'get_mail_connection_credentials',
                       'set_mail_access_token', 'set_mail_connection_status', 'request_mail_sync',
                       'list_mail_connections_to_sync', 'acquire_mail_sync_lease', 'finish_mail_sync', 'reset_mail_history',
                       'set_mail_watch', 'upsert_mail_labels', 'upsert_mail_messages', 'delete_mail_messages',
                       'apply_mail_label_changes', 'list_mail_attachments_to_store', 'record_mail_attachment')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute') or not p.prosecdef)
$$, 'the 17 service RPCs: definer, service_role only');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('communications_settings', 'assert_mail_manager', 'refresh_mail_threads', 'job_mail_bodies_purge')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private helpers: no role');
select results_eq($$
  select e.table_name, e.column_name from (select distinct table_name, column_name from private.pii_encrypted_values() where false) e
  union all
  select 'mail_connection_tokens', c from unnest(array['access_token', 'refresh_token']) c
   where pg_get_functiondef('private.pii_encrypted_values()'::regprocedure) like '%''mail_connection_tokens''::text, ''' || c || '''::text%'
  order by 2
$$, $$ values ('mail_connection_tokens', 'access_token'), ('mail_connection_tokens', 'refresh_token') $$,
  'pii_encrypted_values lists both token columns');

-- =============================================================================
-- Settings
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_communications_settings(), '{"pubsub_topic": null, "pubsub_service_account": null}'::jsonb, 'settings default: no topic, no service account');
select throws_ok($$ select public.set_communications_settings('{"pubsub_topic": "nope"}') $$, 'P0001',
  'Le nom du sujet Pub/Sub doit avoir la forme projects/<projet>/topics/<sujet>.', 'a malformed topic is refused in French');
select throws_ok($$ select public.set_communications_settings('{"other": 1}') $$, '22023', null, 'an unknown key is refused');
select is(public.set_communications_settings('{"pubsub_topic": " projects/mana-prod/topics/gmail-push "}'),
  '{"pubsub_topic": "projects/mana-prod/topics/gmail-push", "pubsub_service_account": null}'::jsonb, 'the topic is trimmed and saved');
select is(public.set_communications_settings('{"pubsub_topic": null}'), '{"pubsub_topic": null, "pubsub_service_account": null}'::jsonb, 'the topic can be cleared');
select throws_ok($$ select public.set_communications_settings('{"pubsub_service_account": "someone@gmail.com"}') $$, 'P0001',
  'Le compte de service doit avoir la forme nom@projet.iam.gserviceaccount.com.', 'the push account must be a service account');
select is(public.set_communications_settings('{"pubsub_service_account": " Gmail-Push@Mana-Prod.iam.gserviceaccount.com "}')->>'pubsub_service_account',
  'gmail-push@mana-prod.iam.gserviceaccount.com', 'the push account is trimmed, lower-cased and saved, the topic kept');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.get_communications_settings() $$, '42501', null, 'a counselor cannot read the settings');

-- =============================================================================
-- store_mail_connection (service role, actor model)
-- =============================================================================
reset role; set local role service_role;
-- A service-role call carries no user: the functions name the actor (p_actor), never a session.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$
  select public.store_mail_connection('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
    'info@clinique.test', 'shared', 'at', 'rt', now() + interval '1 hour', array['https://www.googleapis.com/auth/gmail.modify'])
$$, '42501', null, 'a counselor (no mailboxes_manage) cannot store a connection');
select throws_ok($$
  select public.store_mail_connection('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a',
    'info@clinique.test', 'shared', 'at', 'rt', now() + interval '1 hour', '{}')
$$, '42501', null, 'an admin of another clinic cannot store a connection for org A');
select throws_ok($$
  select public.store_mail_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
    'not-an-address', 'shared', 'at', 'rt', now() + interval '1 hour', '{}')
$$, 'P0001', 'Adresse courriel invalide.', 'a malformed address is refused');
select set_config('test.c1', public.store_mail_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  ' Info@Clinique.test ', 'shared', 'access-1', 'refresh-1', now() + interval '1 hour',
  array['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'])::text, true);
select results_eq($$
  select c.email_address, c.kind, c.status, c.connected_by::text, s.initial_sync_done, s.sync_requested_at is not null
    from public.mail_connections c join public.mail_sync_state s on s.connection_id = c.id
   where c.id = current_setting('test.c1')::uuid
$$, $$ values ('info@clinique.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000001', false, true) $$,
  'the connection: address lower-cased and trimmed, connected, a fresh sync state with a sync requested');
-- The tokens table and the audit log are read as postgres: service_role has no privilege on either.
reset role;
select results_eq($$
  select t.access_token <> convert_to('access-1', 'UTF8'), t.refresh_token <> convert_to('refresh-1', 'UTF8'),
         t.key_version = private.pii_current_key_version()::smallint
    from public.mail_connection_tokens t where t.connection_id = current_setting('test.c1')::uuid
$$, $$ values (true, true, true) $$, 'tokens stored encrypted under the current key version');
select results_eq($$
  select access_token, refresh_token, email_address, status
    from public.get_mail_connection_credentials('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid)
$$, $$ values ('access-1', 'refresh-1', 'info@clinique.test', 'connected') $$, 'the credentials RPC decrypts for the functions');
select is_empty($$
  select 1 from public.get_mail_connection_credentials('b0000000-0000-0000-0000-00000000000b', current_setting('test.c1')::uuid)
$$, 'the credentials RPC answers nothing for another org');
select results_eq($$
  select a.table_name, a.action, a.changed_fields->>'access_token', a.changed_fields->>'refresh_token', a.actor_id::text, a.source
    from public.audit_log a
   where a.table_name = 'mail_connection_tokens' and a.record_id = current_setting('test.c1')
$$, $$ values ('mail_connection_tokens', 'insert', '[redacted]', '[redacted]', 'a0000000-0000-0000-0000-000000000001', 'rpc:store_mail_connection') $$,
  'the audit row names the actor and redacts both tokens');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'mail_connections' and a.record_id = current_setting('test.c1')
                   and a.action = 'insert' and a.actor_id = 'a0000000-0000-0000-0000-000000000001'),
  'the connection insert is audited to the actor');
set local role service_role;

-- A refreshed access token.
select lives_ok($$ select public.set_mail_access_token('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 'access-2', now() + interval '50 minutes') $$,
  'set_mail_access_token');
select is((select access_token from public.get_mail_connection_credentials('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid)),
  'access-2', 'the new access token reads back');

-- Reconnecting the same address reuses the row.
select is(public.store_mail_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  'info@clinique.test', 'shared', 'access-3', 'refresh-3', now() + interval '1 hour', '{}'), current_setting('test.c1')::uuid,
  'reconnecting the same address reuses the connection row');
select is((select refresh_token from public.get_mail_connection_credentials('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid)),
  'refresh-3', 'with the new refresh token');

-- Shared mailboxes only for now (CM-10): a personal one is refused in French.
select throws_ok($$
  select public.store_mail_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
    'admin.perso@clinique.test', 'personal', 'access-p', 'refresh-p', now() + interval '1 hour', '{}')
$$, 'P0001', 'Seules les boîtes partagées de la clinique peuvent être connectées pour l''instant.', 'a personal mailbox is refused');
-- The model is ready for them: a personal row (written as postgres) is its owner's alone (RLS below).
reset role;
select set_config('test.c2', gen_random_uuid()::text, true);
insert into public.mail_connections (id, org_id, email_address, kind, owner_profile_id, connected_by)
values (current_setting('test.c2')::uuid, 'b0000000-0000-0000-0000-00000000000a', 'admin.perso@clinique.test', 'personal',
        'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.mail_sync_state (connection_id, org_id) values (current_setting('test.c2')::uuid, 'b0000000-0000-0000-0000-00000000000a');
insert into public.mail_connection_tokens (connection_id, org_id, access_token, refresh_token, access_token_expires_at, key_version)
values (current_setting('test.c2')::uuid, 'b0000000-0000-0000-0000-00000000000a', private.encrypt_pii('access-p', private.pii_current_key_version()),
        private.encrypt_pii('refresh-p', private.pii_current_key_version()), now() + interval '1 hour', private.pii_current_key_version());
set local role service_role;
select is((select owner_profile_id from public.mail_connections where id = current_setting('test.c2')::uuid),
  'a0000000-0000-0000-0000-000000000001'::uuid, 'a personal mailbox belongs to its owner');

-- Status and the webhook's hint.
select lives_ok($$ select public.set_mail_connection_status('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 'needs_reconnect', 'invalid_grant') $$,
  'set_mail_connection_status');
select is((select status || ':' || status_reason from public.mail_connections where id = current_setting('test.c1')::uuid),
  'needs_reconnect:invalid_grant', 'needs_reconnect with its reason');
select is(public.request_mail_sync('b0000000-0000-0000-0000-00000000000a', 'info@clinique.test'), null::uuid,
  'a mailbox that needs reconnection is not due for a sync');
select lives_ok($$ select public.set_mail_connection_status('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 'connected', null) $$,
  'back to connected');
select is(public.request_mail_sync('b0000000-0000-0000-0000-00000000000a', 'INFO@clinique.test'), current_setting('test.c1')::uuid,
  'the webhook hint matches the address exactly (case-folded)');
select is(public.request_mail_sync('b0000000-0000-0000-0000-00000000000b', 'info@clinique.test'), null::uuid,
  'the hint never matches another org');
select results_eq($$
  select connection_id::text, status, history_id from public.list_mail_connections_to_sync('b0000000-0000-0000-0000-00000000000a') order by 1
$$, $$ select x.id::text, 'connected', null::bigint from (values (current_setting('test.c1')::uuid), (current_setting('test.c2')::uuid)) x(id) order by 1 $$,
  'list_mail_connections_to_sync: the connected mailboxes');

-- =============================================================================
-- The lease
-- =============================================================================
select is(public.acquire_mail_sync_lease('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000001', 300), true, 'the lease is taken');
select is(public.acquire_mail_sync_lease('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000002', 300), false, 'a second holder is refused');
select is(public.acquire_mail_sync_lease('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000001', 300), true, 'the holder may renew');
select is((select sync_in_progress from public.list_mail_connections() where id = current_setting('test.c1')::uuid), null::boolean,
  'list_mail_connections as service_role (no profile): nothing');
select is(public.finish_mail_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000002',
  100, 'ok', null, true, null, 3), false, 'finishing under another token writes nothing');
select is(public.finish_mail_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000001',
  100, 'ok', null, true, null, 3), true, 'the holder finishes');
select results_eq($$
  select s.history_id, s.last_sync_status, s.last_sync_at is not null, s.lease_token, s.initial_sync_done, s.messages_synced
    from public.mail_sync_state s where s.connection_id = current_setting('test.c1')::uuid
$$, $$ values (100::bigint, 'ok', true, null::uuid, true, 3::bigint) $$, 'the state after an ok pass: history, time, lease released, count');
select is(public.acquire_mail_sync_lease('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000002', 60), true, 'a released lease is free');
select is(public.finish_mail_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000002',
  null, 'error', 'provider_error', null, null, 0), true, 'an error pass');
select results_eq($$
  select s.history_id, s.last_sync_status, s.last_error_code, s.last_error_at is not null
    from public.mail_sync_state s where s.connection_id = current_setting('test.c1')::uuid
$$, $$ values (100::bigint, 'error', 'provider_error', true) $$, 'an error keeps the history id and records the code');
select is(public.acquire_mail_sync_lease('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000003', 60), true, 'a pass holds the lease');
select is(public.reset_mail_history('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid), false,
  '« Tout relire » is refused while another pass holds the lease (it would write its history back)');
select is((select history_id from public.mail_sync_state where connection_id = current_setting('test.c1')::uuid), 100::bigint, 'the history is kept');
select is(public.reset_mail_history('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000003'), true,
  'the holder may reset (Gmail answered 404)');
select is((select history_id from public.mail_sync_state where connection_id = current_setting('test.c1')::uuid), null::bigint, 'the history is forgotten');
select is(public.finish_mail_sync('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, '10000000-0000-0000-0000-000000000003',
  null, 'ok', null, null, null, 0), true, 'the holder releases the lease');
select lives_ok($$ select public.set_mail_watch('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, now() + interval '7 days', 200) $$, 'set_mail_watch');
select is((select watch_history_id from public.mail_sync_state where connection_id = current_setting('test.c1')::uuid), 200::bigint, 'the watch is recorded');

-- =============================================================================
-- Labels
-- =============================================================================
select is(public.upsert_mail_labels('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid,
  '[{"id":"INBOX","name":"INBOX","type":"system"},{"id":"Label_1","name":"Clients","type":"user","visibility":"labelShow","color_background":"#16a765","color_text":"#ffffff"},{"id":"bad id","name":"x","type":"user"}]'),
  2, 'labels upserted (a malformed id is skipped)');
select is(public.upsert_mail_labels('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid,
  '[{"id":"INBOX","name":"INBOX","type":"system"}]'), 1, 'a label Gmail no longer lists is deleted');

-- =============================================================================
-- Messages, threads, attachments
-- =============================================================================
select results_eq($$
  select m.gmail_message_id, m.inserted from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, $j$[
    {"gmail_message_id":"m1","gmail_thread_id":"t1","from_name":"Alice Client","from_address":"Alice@Example.test","to":[{"name":"Clinique","address":"info@clinique.test"}],
     "subject":"Demande de rendez-vous","snippet":"Bonjour, je voudrais…","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX","UNREAD"],
     "body_html":"<p>Bonjour</p>","body_text":"Bonjour",
     "attachments":[{"part_id":"2","gmail_attachment_id":"att-1","filename":"cv.pdf","mime_type":"application/pdf","size_bytes":1000,"is_inline":false,"accepted":true},
                    {"part_id":"3","gmail_attachment_id":"att-2","filename":"a.zip","mime_type":"application/zip","size_bytes":10,"is_inline":false,"accepted":false}]},
    {"gmail_message_id":"m2","gmail_thread_id":"t1","from_name":"Clinique","from_address":"info@clinique.test","to":[{"name":"Alice","address":"alice@example.test"}],
     "subject":"Re: Demande de rendez-vous","snippet":"Avec plaisir","sent_at":"2026-10-01T13:00:00Z","label_ids":["SENT"]},
    {"gmail_message_id":"m3","gmail_thread_id":"t2","from_address":"bob@example.test","subject":"Autre","snippet":"…","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX","UNREAD","STARRED"]}
  ]$j$) m order by 1
$$, $$ values ('m1', true), ('m2', true), ('m3', true) $$, 'three messages inserted');
select results_eq($$
  select t.gmail_thread_id, t.subject, t.snippet, t.last_from_address, t.message_count, t.unread_count, t.has_attachments,
         (select array_agg(l order by l) from unnest(t.label_ids) l)
    from public.mail_threads t where t.connection_id = current_setting('test.c1')::uuid order by 1
$$, $$ values ('t1', 'Demande de rendez-vous', 'Avec plaisir', 'info@clinique.test', 2, 1, true, array['INBOX', 'SENT', 'UNREAD']),
             ('t2', 'Autre', '…', 'bob@example.test', 1, 1, false, array['INBOX', 'STARRED', 'UNREAD']) $$,
  'thread summaries: first subject, last snippet and sender, counts, labels union');
select results_eq($$
  select m.gmail_message_id, m.from_address, m.is_unread, m.is_inbound, m.has_attachments
    from public.mail_messages m where m.connection_id = current_setting('test.c1')::uuid order by 1
$$, $$ values ('m1', 'alice@example.test', true, true, true), ('m2', 'info@clinique.test', false, false, false), ('m3', 'bob@example.test', true, true, false) $$,
  'messages: address lower-cased, unread from UNREAD, inbound unless sent by the mailbox');
select results_eq($$
  select a.part_id, a.status from public.mail_attachments a join public.mail_messages m on m.id = a.message_id
   where m.gmail_message_id = 'm1' and m.connection_id = current_setting('test.c1')::uuid order by 1
$$, $$ values ('2', 'pending'), ('3', 'unsupported_type') $$, 'attachments: accepted types pending, the others listed as unsupported');
select results_eq($$
  select l.status, l.client_id from public.mail_thread_links l join public.mail_threads t on t.id = l.thread_id
   where t.connection_id = current_setting('test.c1')::uuid
$$, $$ values ('unlinked', null::uuid), ('unlinked', null::uuid) $$, 'every thread gets an unlinked link row');
-- A second pass (a label change re-read with format full) keeps the body and updates the labels.
select results_eq($$
  select m.gmail_message_id, m.inserted from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, $j$[
    {"gmail_message_id":"m1","gmail_thread_id":"t1","from_address":"alice@example.test","subject":"Demande de rendez-vous","snippet":"Bonjour, je voudrais…",
     "sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX"],
     "attachments":[{"part_id":"2","gmail_attachment_id":"att-1b","filename":"cv.pdf","mime_type":"application/pdf","size_bytes":1000,"is_inline":false,"accepted":true}]}
  ]$j$) m
$$, $$ values ('m1', false) $$, 'a known message is updated, not inserted');
select results_eq($$
  select m.is_unread, m.body_html, (select a.gmail_attachment_id from public.mail_attachments a where a.message_id = m.id and a.part_id = '2')
    from public.mail_messages m where m.gmail_message_id = 'm1' and m.connection_id = current_setting('test.c1')::uuid
$$, $$ values (false, '<p>Bonjour</p>', 'att-1b') $$, 'the update: read now, body kept, the attachment id refreshed');
select is((select unread_count from public.mail_threads where gmail_thread_id = 't1' and connection_id = current_setting('test.c1')::uuid), 0,
  'the thread summary follows');

-- Label changes from the history.
select is(public.apply_mail_label_changes('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid,
  '[{"gmail_message_id":"m3","add":[],"remove":["INBOX","UNREAD"]},{"gmail_message_id":"unknown","add":["INBOX"],"remove":[]}]'), 1,
  'one known message changed (an unknown id is ignored)');
select results_eq($$
  select m.is_unread, (select array_agg(l order by l) from unnest(m.label_ids) l), t.unread_count, (select array_agg(l order by l) from unnest(t.label_ids) l)
    from public.mail_messages m join public.mail_threads t on t.id = m.thread_id
   where m.gmail_message_id = 'm3' and m.connection_id = current_setting('test.c1')::uuid
$$, $$ values (false, array['STARRED'], 0, array['STARRED']) $$, 'archived and read: the message and its thread');

-- The attachments to copy, and the copy's outcome.
select results_eq($$
  select gmail_message_id, part_id, filename from public.list_mail_attachments_to_store('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 10)
$$, $$ values ('m1', '2', 'cv.pdf') $$, 'the pending attachment is listed');
select set_config('test.a1', (select attachment_id::text from public.list_mail_attachments_to_store('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 10)), true);
select set_config('test.f1', (select file_id::text from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'communications', 'mail_attachment',
  'mail_message', (select message_id from public.list_mail_attachments_to_store('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, 10)),
  'application/pdf', 1000, repeat('a', 64), null, 'cv.pdf')), true);
select throws_ok($$ select public.record_mail_attachment('b0000000-0000-0000-0000-00000000000a', current_setting('test.a1')::uuid, 'stored', null) $$, '22023', null,
  'stored without a file is refused');
select lives_ok($$ select public.record_mail_attachment('b0000000-0000-0000-0000-00000000000a', current_setting('test.a1')::uuid, 'stored', current_setting('test.f1')::uuid) $$,
  'record_mail_attachment stored');
select results_eq($$
  select a.status, a.stored_file_id::text, a.attempts from public.mail_attachments a where a.id = current_setting('test.a1')::uuid
$$, $$ values ('stored', current_setting('test.f1'), 1) $$, 'the attachment points at its file');
select is((select f.view_permission || '/' || (f.retain_until is null)::text from public.stored_files f where f.id = current_setting('test.f1')::uuid),
  'communications.inbox/true', 'the file is read with communications.inbox and never staged');

-- Deleted messages.
select is(public.delete_mail_messages('b0000000-0000-0000-0000-00000000000a', current_setting('test.c1')::uuid, array['m3', 'unknown']), 1, 'one message deleted');
select is((select count(*)::int from public.mail_threads t where t.connection_id = current_setting('test.c1')::uuid), 1, 'its thread (left empty) is gone');

-- =============================================================================
-- RLS: who sees what
-- =============================================================================
reset role; set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select email_address, kind from public.mail_connections order by 1 $$,
  $$ values ('admin.perso@clinique.test', 'personal'), ('info@clinique.test', 'shared') $$, 'the admin sees the shared mailbox and her own personal one');
select results_eq($$
  select email_address, status, thread_count, unread_count, sync_in_progress from public.list_mail_connections() order by 1
$$, $$ values ('admin.perso@clinique.test', 'connected', 0::bigint, 0::bigint, false), ('info@clinique.test', 'connected', 1::bigint, 0::bigint, false) $$,
  'list_mail_connections: the state with counts');
select is((select count(*)::int from public.mail_messages), 2, 'the admin reads the mirror');
select is((select count(*)::int from public.mail_attachments), 2, 'and the attachments');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select email_address from public.mail_connections $$, $$ values ('info@clinique.test') $$, 'the counselor sees the shared mailbox only');
select is((select count(*)::int from public.mail_threads), 1, 'and its threads');
select is((select count(*)::int from public.mail_thread_links), 1, 'and their links');
select is((select count(*)::int from public.mail_labels), 1, 'and its labels');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.mail_connections), 0, 'the provider sees no mailbox');
select is((select count(*)::int from public.mail_messages), 0, 'nor any message');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.mail_connections), 0, 'org B sees nothing of org A');
select is((select count(*)::int from public.list_mail_connections()), 0, 'list_mail_connections: nothing for org B');
-- The module gate: disabled, every row disappears for the admin too.
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.mail_connections), 0, 'module disabled: no mailbox');
select is((select count(*)::int from public.mail_messages), 0, 'module disabled: no message');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';

-- =============================================================================
-- Disconnect
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.disconnect_mail_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', current_setting('test.c2')::uuid), true, 'disconnected');
select is(public.disconnect_mail_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', current_setting('test.c2')::uuid), false, 'already disconnected');
reset role;
select results_eq($$
  select c.status, c.disconnected_by::text, (select count(*)::int from public.mail_connection_tokens t where t.connection_id = c.id),
         (select count(*)::int from public.mail_sync_state s where s.connection_id = c.id)
    from public.mail_connections c where c.id = current_setting('test.c2')::uuid
$$, $$ values ('disconnected', 'a0000000-0000-0000-0000-000000000001', 0, 0) $$, 'tokens and state deleted, the row kept');

-- =============================================================================
-- The 24-month purge
-- =============================================================================
reset role;
update public.mail_messages set sent_at = now() - interval '25 months' where gmail_message_id = 'm1' and connection_id = current_setting('test.c1')::uuid;
select is(private.job_mail_bodies_purge(), 'purged=1 files=1', 'one old message purged with its file');
select results_eq($$
  select m.body_html, m.body_text, m.snippet, m.body_purged_at is not null, m.subject,
         (select a.status from public.mail_attachments a where a.id = current_setting('test.a1')::uuid),
         (select f.status from public.stored_files f where f.id = current_setting('test.f1')::uuid)
    from public.mail_messages m where m.gmail_message_id = 'm1' and m.connection_id = current_setting('test.c1')::uuid
$$, $$ values (null::text, null::text, null::text, true, 'Demande de rendez-vous', 'purged', 'deleted') $$,
  'bodies and snippet nulled, the subject kept, the attachment purged and its file soft-deleted');
select is(private.job_mail_bodies_purge(), 'purged=0 files=0', 'nothing left to purge');

select * from finish();
rollback;
