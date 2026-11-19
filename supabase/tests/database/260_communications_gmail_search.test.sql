-- « Dans Gmail » (migration *_communications_gmail_search.sql, decision CM-30): the service RPC
-- get_mail_search_threads_for_service re-checks the actor (an active member holding
-- communications.inbox, the mailbox connected and readable by them) and answers which of the given
-- Gmail threads the mirror holds in that mailbox, never another mailbox's nor another clinic's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- =============================================================================
-- Fixtures (as postgres): org A (counselor 02 with the inbox, provider 03 without it, admin 01 who
-- owns a personal mailbox), org B. A shared mailbox in each, a disconnected one in A, the admin's
-- personal one in A. Threads t1 and t2 in A's shared mailbox, pt1 in the personal one, zt1 in B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@gs.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@gs.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@gs.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@gs.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Partie A', 'u4@gs.test', 'disabled'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@gs.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'communications', true),
  ('b0000000-0000-0000-0000-00000000000b', 'communications', true);
insert into public.org_role_permissions (org_id, role, permission_key) values
  ('b0000000-0000-0000-0000-00000000000a', 'counselor', 'communications.inbox')
on conflict do nothing;

insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by) values
  ('c0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'info@a.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'old@a.test', 'shared', 'disconnected', 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'info@b.test', 'shared', 'connected', 'a0000000-0000-0000-0000-000000000005');
insert into public.mail_connections (id, org_id, email_address, kind, status, connected_by, owner_profile_id) values
  ('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', 'perso@a.test', 'personal', 'connected',
   'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', $j$[
  {"gmail_message_id":"m1","gmail_thread_id":"t1","from_address":"alice@x.test","subject":"Demande","sent_at":"2026-10-01T12:00:00Z","label_ids":["INBOX"]},
  {"gmail_message_id":"m2","gmail_thread_id":"t2","from_address":"bob@x.test","subject":"Facture","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a3', $j$[
  {"gmail_message_id":"p1","gmail_thread_id":"pt1","from_address":"x@perso.test","subject":"Personnel","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);
select count(*) from public.upsert_mail_messages('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', $j$[
  {"gmail_message_id":"z1","gmail_thread_id":"zt1","from_address":"x@b.test","subject":"Org B","sent_at":"2026-10-02T09:00:00Z","label_ids":["INBOX"]}
]$j$);

-- =============================================================================
-- What the mirror holds, for the mailbox asked
-- =============================================================================
select is((select array_agg(gmail_thread_id order by gmail_thread_id) from public.get_mail_search_threads_for_service(
            'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
            array['t1', 't2', 'tx', 'pt1', 'zt1'])),
          array['t1', 't2'],
          'the threads the mailbox holds come back; another mailbox''s, another clinic''s and an unknown one do not');
select is((select thread_id from public.get_mail_search_threads_for_service(
            'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
            array['t1'])),
          (select id from public.mail_threads where gmail_thread_id = 't1'),
          'with its mirror id (what an open answers)');
select is((select count(*)::int from public.get_mail_search_threads_for_service(
            'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
            array[]::text[])),
          0, 'an empty list answers nothing (a search Gmail found nothing for)');

-- =============================================================================
-- The actor and the mailbox
-- =============================================================================
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
                    'c0000000-0000-0000-0000-00000000000a', array['t1']) $$,
  '42501', null, 'without communications.inbox: refused');
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a',
                    'c0000000-0000-0000-0000-00000000000a', array['t1']) $$,
  '42501', null, 'a disabled member: refused');
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b',
                    'c0000000-0000-0000-0000-00000000000b', array['zt1']) $$,
  '42501', null, 'another clinic, named as the org: refused');
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
                    'c0000000-0000-0000-0000-00000000000b', array['zt1']) $$,
  '42501', null, 'another clinic''s mailbox: refused');
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
                    'c0000000-0000-0000-0000-0000000000a2', array['t1']) $$,
  '42501', null, 'a disconnected mailbox: refused');
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
                    'c0000000-0000-0000-0000-0000000000a3', array['pt1']) $$,
  '42501', null, 'someone else''s personal mailbox: refused');
reset role;

-- =============================================================================
-- Only the service role calls it
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_mail_search_threads_for_service('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
                    'c0000000-0000-0000-0000-00000000000a', array['t1']) $$,
  '42501', null, 'a signed-in caller cannot call it directly');
reset role;

select * from finish();
rollback;
