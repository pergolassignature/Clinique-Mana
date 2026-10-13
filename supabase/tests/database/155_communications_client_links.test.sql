-- Communications, batch CM2b (migration *_communications_client_links.sql): a mail thread linked
-- to its client — automatically by the sender's address (Clients' match), « À rattacher » when
-- several files match, manually (never overwritten), Clients off, the merge and the anonymisation,
-- permissions, clinics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('link_mail_thread', 'unlink_mail_thread')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'link / unlink: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('communications_link_threads', 'communications_link_new_messages', 'communications_visible_thread',
                       'communications_reassign_client', 'communications_anonymize_client')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@cl.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@cl.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@cl.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@cl.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('communications'), ('clients')) m(key);
-- Alice has her own address; Marc and Léa share one (a family address); Zoé is Marc's daughter.
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Lien', 'alice@x.test'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Famille', 'famille@x.test'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Famille', 'famille@x.test'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Famille', null),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Alice', 'Ailleurs', 'alice@x.test');
insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by) values
  ('c0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'info@a.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'info@b.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000003');

-- The sync (service role) mirrors four threads in A and one in B.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m1","gmail_thread_id":"t1","from_name":"Alice","from_address":"Alice@X.test","subject":"Rendez-vous","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"m2","gmail_thread_id":"t2","from_address":"famille@x.test","subject":"Pour nos enfants","sent_at":"2026-10-01T13:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"m3","gmail_thread_id":"t3","from_address":"inconnu@x.test","subject":"Question","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"m4","gmail_thread_id":"t4","from_address":"info@a.test","subject":"Envoyé","sent_at":"2026-10-02T10:00:00Z","label_ids":["SENT"]}
]$j$);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', $j$[
  {"gmail_message_id":"z1","gmail_thread_id":"zt1","from_address":"alice@x.test","subject":"Org B","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
select set_config('test.t' || n, (select id::text from public.mail_threads where gmail_thread_id = 't' || n), true) from generate_series(1, 4) n;
select set_config('test.zt1', (select id::text from public.mail_threads where gmail_thread_id = 'zt1'), true);

-- =============================================================================
-- Automatic
-- =============================================================================
select results_eq($$ select status, client_id::text, source from public.mail_thread_links where thread_id = current_setting('test.t1')::uuid $$,
  $$ values ('linked', 'd0000000-0000-0000-0000-000000000001', 'auto') $$, 'one file with her address (case ignored): linked automatically');
select results_eq($$ select status, client_id, cardinality(candidate_client_ids) from public.mail_thread_links where thread_id = current_setting('test.t2')::uuid $$,
  $$ values ('needs_review', null::uuid, 2) $$, 'a shared address: « À rattacher », with the two files');
select results_eq($$ select status from public.mail_thread_links where thread_id = current_setting('test.t3')::uuid $$,
  $$ values ('unlinked') $$, 'no file: not linked');
select is_empty($$ select 1 from public.mail_thread_links where thread_id = current_setting('test.t4')::uuid and status <> 'unlinked' $$,
  'the mailbox''s own mail: nothing to match');
select results_eq($$ select client_id::text from public.mail_thread_links where thread_id = current_setting('test.zt1')::uuid $$,
  $$ values ('d0000000-0000-0000-0000-000000000009') $$, 'each clinic its own files');

-- =============================================================================
-- Manual
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (r ->> 'status'), jsonb_array_length(r -> 'candidates') from public.get_mail_thread_link(current_setting('test.t2')::uuid) r $$,
  $$ values ('needs_review', 2) $$, 'the thread''s link: to review, its candidates with their names');
select results_eq(format($$ select id::text from public.list_mail_threads(%L, 'to_link') order by 1 $$, 'c0000000-0000-0000-0000-00000000000a'),
  $$ select x from (values (current_setting('test.t2')), (current_setting('test.t3'))) v(x) order by 1 $$, '« À rattacher »: to review and never linked');
select lives_ok(format($$ select public.link_mail_thread(%L, 'd0000000-0000-0000-0000-000000000002') $$, current_setting('test.t2')), 'linked to Marc by hand');
select results_eq($$ select r -> 'client' ->> 'display_name', r ->> 'source' from public.get_mail_thread_link(current_setting('test.t2')::uuid) r $$,
  $$ values ('Marc Famille', 'manual') $$, 'the header shows his file');
select lives_ok(format($$ select public.unlink_mail_thread(%L) $$, current_setting('test.t1')), '« Détacher » Alice''s thread');
select throws_ok(format($$ select public.link_mail_thread(%L, 'd0000000-0000-0000-0000-000000000009') $$, current_setting('test.t3')),
  'P0001', 'Choisissez un dossier client de la clinique.', 'another clinic''s file: refused');

-- A new message never overwrites what a person decided.
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m5","gmail_thread_id":"t1","from_address":"alice@x.test","subject":"Re: Rendez-vous","sent_at":"2026-10-03T12:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"m6","gmail_thread_id":"t2","from_address":"famille@x.test","subject":"Re","sent_at":"2026-10-03T12:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
select results_eq($$ select status, client_id::text from public.mail_thread_links where thread_id in (current_setting('test.t1')::uuid, current_setting('test.t2')::uuid)
                     order by thread_id = current_setting('test.t1')::uuid desc $$,
  $$ values ('unlinked', null::text), ('linked', 'd0000000-0000-0000-0000-000000000002') $$, 'manual decisions kept when new mail comes');

-- Clients off: nothing linked.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m7","gmail_thread_id":"t7","from_address":"alice@x.test","subject":"Clients éteint","sent_at":"2026-10-04T12:00:00Z","label_ids":["INBOX"]}
]$j$);
reset role;
select is_empty($$ select 1 from public.mail_thread_links l join public.mail_threads t on t.id = l.thread_id
                    where t.gmail_thread_id = 't7' and l.status <> 'unlinked' $$,
  'Clients off: no link made');
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';

-- =============================================================================
-- Merge and anonymisation (Clients' handlers)
-- =============================================================================
select is(private.communications_reassign_client('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004'), 1,
  'a merge moves the link');
select results_eq($$ select client_id::text from public.mail_thread_links where thread_id = current_setting('test.t2')::uuid $$,
  $$ values ('d0000000-0000-0000-0000-000000000004') $$, '… to the kept file');
select is(private.communications_anonymize_client('d0000000-0000-0000-0000-000000000004'), 1, 'an anonymisation clears it');
select results_eq($$ select status, client_id from public.mail_thread_links where thread_id = current_setting('test.t2')::uuid $$,
  $$ values ('unlinked', null::uuid) $$, '… unlinked');
select ok(exists (select 1 from public.client_merge_handlers where module_key = 'communications')
          and exists (select 1 from public.client_anonymize_handlers where module_key = 'communications'), 'both handlers in Clients'' catalogues');

-- =============================================================================
-- Permissions
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select public.link_mail_thread(%L, 'd0000000-0000-0000-0000-000000000001') $$, current_setting('test.t3')),
  '42501', null, 'a professional links nothing');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format($$ select public.link_mail_thread(%L, 'd0000000-0000-0000-0000-000000000009') $$, current_setting('test.t3')),
  'P0001', 'Ce fil n''existe pas.', 'another clinic''s thread: not found');

select * from finish();
rollback;
