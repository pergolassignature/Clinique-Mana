-- In-app notifications (migration *_core_notifications.sql, plan Phase 3 Task 3.12, P3-15,
-- P3-21, P3-24).
-- Covers: privileges on both tables and every RPC, helper and job; the policy shape and the
-- indexes; private.notify validation (link path, module/permission pairing, kind prefix,
-- lengths, expiry, recipient in another org, subject pair); visibility (permission, narrowed
-- user, module gate, expiry, org isolation, disabled user) through RLS and
-- list_my_notifications; the unread counts (90-day window, importance); per-user read state
-- (mark_notifications_read re-checks visibility, mark_all_notifications_read, own read rows
-- only); list filters, keyset paging and the clamp; dedupe (same id, scoped by org and kind);
-- create_notification (service role); core.notifications_purge (12 months, 30 days after
-- expiry, reads cascade) and its cron entry.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A (professionals on): admin A, admin A2, adjointe D, conseillère C (professionals.view,
-- no users.view), disabled admin X. Org B: admin B.
-- Notifications (table `n`, created through private.notify, then dated):
--   users     users.view, normal, -1 h          narrowed  users.view, important, admin A only, -2 h
--   pro       professionals.view, important, -3 h
--   expired   users.view, -4 h, expired 1 min ago
--   dedupe    users.view, -5 h, dedupe key, no body or link
--   old       users.view, -100 days (outside the count window)
--   orgb      org B, users.view, -1 h
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@a.test',        '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2@a.test',   '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',         'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe D',      'adjointe@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère C',   'c@a.test',        'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Admin désactivé', 'x@a.test',        'disabled'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',         'admin@b.test',    'active'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'Admin A2',        'admin2@a.test',   'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

create temp table n (step text primary key, id uuid) on commit drop;
grant select, insert on n to authenticated, service_role;

insert into n values
  ('users', private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_users', 'normal',
     'Nouvel accès', 'Une personne a rejoint l''équipe.', '/parametres/utilisateurs',
     'staff_invitation', 'd0000000-0000-0000-0000-000000000001', 'users.view')),
  ('narrowed', private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_users', 'important',
     'Pour vous seulement', null, '/parametres/utilisateurs', null, null, 'users.view',
     'a0000000-0000-0000-0000-000000000001')),
  ('pro', private.notify('b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.insurance_expiring', 'important',
     'Assurance bientôt échue', 'L''assurance de Marie Tremblay prend fin le 15 octobre 2026.', '/professionnels/d0000000-0000-0000-0000-000000000003/documents',
     'professional', 'd0000000-0000-0000-0000-000000000003', 'professionals.view')),
  ('expired', private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_users', 'normal',
     'Échue', null, null, null, null, 'users.view', null, null, now() + interval '1 day')),
  ('dedupe', private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_dedupe', 'normal',
     'Première version', null, null, null, null, 'users.view', null, 'test:1')),
  ('old', private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_users', 'normal',
     'Ancienne', null, null, null, null, 'users.view')),
  ('orgb', private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
     'Org B', null, null, null, null, 'users.view'));

update public.notifications x set created_at = now() - d.age
  from n join (values ('users', interval '1 hour'), ('narrowed', interval '2 hours'), ('pro', interval '3 hours'),
                      ('expired', interval '4 hours'), ('dedupe', interval '5 hours'), ('old', interval '100 days'),
                      ('orgb', interval '1 hour')) d(step, age) on d.step = n.step
 where x.id = n.id;
update public.notifications x set expires_at = now() - interval '1 minute'
  from n where n.step = 'expired' and x.id = n.id;

-- =============================================================================
-- Privileges, policy, indexes, job
-- =============================================================================
select table_privs_are('public', 'notifications', 'anon', array[]::text[], 'anon: nothing on notifications');
select table_privs_are('public', 'notifications', 'authenticated', array['SELECT'], 'authenticated: select only on notifications');
select table_privs_are('public', 'notification_reads', 'anon', array[]::text[], 'anon: nothing on notification_reads');
select table_privs_are('public', 'notification_reads', 'authenticated', array['SELECT'], 'authenticated: select only on notification_reads');
select is_empty($$
  select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
   where table_schema = 'public' and table_name in ('notifications', 'notification_reads')
     and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
$$, 'no column privilege beyond select on the notification tables');

-- (name, anon, authenticated, service_role) for every public notification RPC.
select results_eq($$
  select p.proname::text collate "default",
         has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_notification', 'list_my_notifications', 'count_my_unread_notifications',
                       'mark_notifications_read', 'mark_all_notifications_read')
   order by 1
$$, $$ values
  ('count_my_unread_notifications'::text, false, true, false),
  ('create_notification', false, false, true),
  ('list_my_notifications', false, true, false),
  ('mark_all_notifications_read', false, true, false),
  ('mark_notifications_read', false, true, false)
$$, 'user RPCs for authenticated only, create_notification for service_role only');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('notify', 'job_notifications_purge')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'private.notify and the purge job are callable by no client role');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'private'::regnamespace and p.proname in ('notify', 'job_notifications_purge')),
  2, 'both private notification functions exist');

select is((select pg_get_expr(pol.polqual, pol.polrelid) like '%current_permission_keys()%'
             from pg_policy pol where pol.polname = 'notifications_select'),
  true, 'notifications_select tests recipient_permission against the permission array');

select results_eq($$
  select indexname::text collate "default" from pg_indexes
   where schemaname = 'public' and tablename in ('notifications', 'notification_reads')
     and indexname in ('notifications_org_created_idx', 'notifications_subject_idx', 'notifications_created_idx',
                       'notifications_expires_idx', 'notifications_dedupe_key', 'notification_reads_user_idx')
   order by 1
$$, array['notification_reads_user_idx', 'notifications_created_idx', 'notifications_dedupe_key',
          'notifications_expires_idx', 'notifications_org_created_idx', 'notifications_subject_idx'],
  'list/count, subject, purge, dedupe and per-user read indexes exist');

select results_eq($$
  select j.key, j.module_key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'core.notifications_purge'
$$, $$ values ('core.notifications_purge'::text, 'core'::text, 'sql'::text, 'private.job_notifications_purge'::text,
               true, '0 9 * * *'::text, 'select private.run_sql_job(''core.notifications_purge'')'::text) $$,
  'core.notifications_purge is catalogued and scheduled daily');

-- =============================================================================
-- private.notify validation (as postgres)
-- =============================================================================
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, 'https://evil.test', null, null, 'users.view') $$, '23514', null, 'an absolute URL is refused as link');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, '//evil', null, null, 'users.view') $$, '23514', null, 'a protocol-relative link is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, '/\evil', null, null, 'users.view') $$, '23514', null, 'a link starting with a backslash is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, E'/a\nb', null, null, 'users.view') $$, '23514', null, 'a link with a control character is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, null, null, null, 'professionals.view') $$, '22023', null, 'a core notification cannot use a module permission');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, null, null, null, 'nope.view') $$, '22023', null, 'an unknown permission is refused');
select lives_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'professionals', 'professionals.test', 'normal',
  'T', null, null, null, null, 'users.view') $$, 'a module notification may use a core permission');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'professionals', 'core.test_users', 'normal',
  'T', null, null, null, null, 'professionals.view') $$, '23514', null, 'the kind prefix must be the module key');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.Bad-Kind', 'normal',
  'T', null, null, null, null, 'users.view') $$, '23514', null, 'a malformed kind is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'urgent',
  'T', null, null, null, null, 'users.view') $$, '23514', null, 'importance is normal or important');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  '   ', null, null, null, null, 'users.view') $$, '23514', null, 'a blank title is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  repeat('t', 161), null, null, null, null, 'users.view') $$, '23514', null, 'a title over 160 characters is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', repeat('b', 501), null, null, null, 'users.view') $$, '23514', null, 'a body over 500 characters is refused');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, null, 'professional', null, 'users.view') $$, '23514', null, 'subject type and id go together');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, null, null, null, 'users.view', 'a0000000-0000-0000-0000-000000000001') $$,
  '23503', null, 'the narrowed recipient must belong to the notification''s org');
select throws_ok($$ select private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_users', 'normal',
  'T', null, null, null, null, 'users.view', null, null, now()) $$, '22023', null, 'an expiry in the past is refused');

-- =============================================================================
-- Visibility
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$ select l.id from public.list_my_notifications() l where l.id in (select id from n) $$,
  $$ select id from n where step in ('users', 'narrowed', 'pro', 'dedupe', 'old')
      order by array_position(array['users', 'narrowed', 'pro', 'dedupe', 'old'], step) $$,
  'admin A lists the users.view, narrowed and professionals notices, newest first (not expired, not org B)');
select results_eq($$
  select l.module_key, l.kind, l.importance, l.title, l.body, l.link_path, l.subject_type, l.subject_id, l.is_read
    from public.list_my_notifications() l where l.id = (select id from n where step = 'pro')
$$, $$ values ('professionals'::text, 'professionals.insurance_expiring'::text, 'important'::text,
               'Assurance bientôt échue'::text, 'L''assurance de Marie Tremblay prend fin le 15 octobre 2026.'::text,
               '/professionnels/d0000000-0000-0000-0000-000000000003/documents'::text, 'professional'::text,
               'd0000000-0000-0000-0000-000000000003'::uuid, false) $$,
  'a listed notice carries its fields and is unread');
select is((select count(*)::int from public.notifications where id in (select id from n)), 5,
  'RLS on the table itself shows admin A the same five rows');
select ok(not exists (select 1 from public.notifications where id = (select id from n where step = 'expired')),
  'an expired notice is invisible');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (4, 2) $$, 'admin A: 4 unread in the last 90 days, 2 important (the 100-day-old one is not counted)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select results_eq($$ select l.id from public.list_my_notifications() l where l.id in (select id from n) $$,
  $$ select id from n where step in ('users', 'pro', 'dedupe', 'old')
      order by array_position(array['users', 'pro', 'dedupe', 'old'], step) $$,
  'admin A2 does not see the notice narrowed to admin A');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (3, 1) $$, 'admin A2: 3 unread, 1 important');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select l.id from public.list_my_notifications() l where l.id in (select id from n) $$,
  $$ select id from n where step = 'pro' $$,
  'the conseillère sees the professionals.view notice only (no users.view)');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (1, 1) $$, 'the conseillère: 1 unread, important');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select ok(not exists (select 1 from public.list_my_notifications() l
                       where l.id in (select id from n where step <> 'orgb')),
  'admin B sees nothing of org A');
select ok(exists (select 1 from public.list_my_notifications() l where l.id = (select id from n where step = 'orgb')),
  'admin B sees the org B notice');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty($$ select id from public.list_my_notifications() $$, 'a disabled admin lists nothing');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (0, 0) $$, 'a disabled admin counts nothing');

-- Module gate: disabling Professionnels hides its notice.
reset role;
update public.org_modules set enabled = false
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not exists (select 1 from public.list_my_notifications() l where l.id = (select id from n where step = 'pro')),
  'a professionals.view notice disappears when the module is disabled');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (3, 1) $$, 'the counts follow the module gate');
reset role;
update public.org_modules set enabled = true
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- Read state
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.mark_notifications_read(array(
  select id from n where step in ('users', 'narrowed', 'orgb', 'expired'))) $$,
  'admin A marks four ids read, two of them invisible to her');
select set_eq($$ select notification_id from public.notification_reads where user_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ select id from n where step in ('users', 'narrowed') $$,
  'only the visible ids get a read row (not org B, not expired)');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (2, 1) $$, 'admin A: 2 unread left, 1 important');
select is((select is_read from public.list_my_notifications() where id = (select id from n where step = 'users')),
  true, 'the list shows the notice as read for admin A');
select lives_ok($$ select public.mark_notifications_read(array(select id from n where step = 'users')) $$,
  'marking an already read notice again is harmless');
select is((select count(*)::int from public.notification_reads where notification_id = (select id from n where step = 'users')),
  1, 'still one read row');
select results_eq($$ select l.id from public.list_my_notifications(p_unread_only => true) l where l.id in (select id from n) $$,
  $$ select id from n where step in ('pro', 'dedupe', 'old') order by array_position(array['pro', 'dedupe', 'old'], step) $$,
  'p_unread_only lists the unread notices only');
select results_eq($$ select l.id from public.list_my_notifications(p_importance => 'important') l where l.id in (select id from n) $$,
  $$ select id from n where step in ('narrowed', 'pro') order by array_position(array['narrowed', 'pro'], step) $$,
  'p_importance filters on importance');
select results_eq($$ select l.id from public.list_my_notifications(p_importance => 'important', p_unread_only => true, p_limit => 5) l
                      where l.id in (select id from n) $$,
  $$ select id from n where step = 'pro' $$,
  'the « À surveiller » query: unread important notices only');
select throws_ok($$ select public.mark_notifications_read(array_fill(gen_random_uuid(), array[201])) $$,
  '22023', null, 'at most 200 ids per call');
select lives_ok($$ select public.mark_notifications_read(null) $$, 'a null array is a no-op');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is_empty($$ select 1 from public.notification_reads where notification_id in (select id from n) $$,
  'admin A2 cannot see admin A''s read rows');
select is((select is_read from public.list_my_notifications() where id = (select id from n where step = 'users')),
  false, 'read state is per user: unread for admin A2');
select lives_ok($$ select public.mark_notifications_read(array(select id from n where step = 'narrowed')) $$,
  'admin A2 marks the notice narrowed to admin A');
select is_empty($$ select 1 from public.notification_reads where user_id = 'a0000000-0000-0000-0000-000000000007' $$,
  'no read row for a notice the caller cannot see');
select lives_ok($$ select public.mark_all_notifications_read() $$, 'admin A2 marks everything read');
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (0, 0) $$, 'admin A2: nothing unread');
select set_eq($$ select notification_id from public.notification_reads where user_id = 'a0000000-0000-0000-0000-000000000007' $$,
  $$ select id from n where step in ('users', 'pro', 'dedupe', 'old') $$,
  'mark_all reads exactly the visible notices (not narrowed to someone else, not expired, not org B)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select total, important from public.count_my_unread_notifications() $$,
  $$ values (2, 1) $$, 'admin A2 reading everything leaves admin A''s counts unchanged');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.mark_all_notifications_read() $$, 'a disabled admin may call mark_all');
select lives_ok($$ select public.mark_notifications_read(array(select id from n)) $$, 'and mark_notifications_read');

reset role;
select is_empty($$ select 1 from public.notification_reads where user_id = 'a0000000-0000-0000-0000-000000000005' $$,
  'a disabled admin gets no read row');

-- =============================================================================
-- Paging
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select l.id from public.list_my_notifications(p_limit => 2) l $$,
  $$ select id from n where step in ('users', 'narrowed') order by array_position(array['users', 'narrowed'], step) $$,
  'the first page');
select results_eq($$
  select l.id from public.list_my_notifications(
    p_before => (select created_at from public.notifications where id = (select id from n where step = 'narrowed')),
    p_before_id => (select id from n where step = 'narrowed'),
    p_limit => 2) l
$$, $$ select id from n where step in ('pro', 'dedupe') order by array_position(array['pro', 'dedupe'], step) $$,
  'the next page starts after the last row (created_at, id)');
select results_eq($$
  select l.id from public.list_my_notifications(
    p_before => (select created_at from public.notifications where id = (select id from n where step = 'pro'))) l
   where l.id in (select id from n)
$$, $$ select id from n where step in ('dedupe', 'old') order by array_position(array['dedupe', 'old'], step) $$,
  'p_before alone means created_at < p_before');
select is((select count(*)::int from public.list_my_notifications(p_limit => 0)), 1, 'p_limit is clamped up to 1');

-- =============================================================================
-- Dedupe (as postgres)
-- =============================================================================
reset role;
select is(private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_dedupe', 'important',
            'Deuxième version', null, null, null, null, 'users.view', null, 'test:1'),
  (select id from n where step = 'dedupe'), 'the same dedupe key returns the existing id');
select results_eq($$ select title, importance from public.notifications
                     where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'core.test_dedupe' and dedupe_key = 'test:1' $$,
  $$ values ('Première version'::text, 'normal'::text) $$, 'one row, the first version kept');
select isnt(private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_other', 'normal',
              'Autre type', null, null, null, null, 'users.view', 'a0000000-0000-0000-0000-000000000002', 'test:1'),
  (select id from n where step = 'dedupe'), 'the dedupe key is scoped by kind');
select isnt(private.notify('b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_dedupe', 'normal',
              'Org B', null, null, null, null, 'users.view', null, 'test:1'),
  (select id from n where step = 'dedupe'), 'the dedupe key is scoped by org');

-- =============================================================================
-- create_notification (service role)
-- =============================================================================
set local role service_role;
insert into n values ('service', public.create_notification('b0000000-0000-0000-0000-00000000000a', 'professionals',
  'professionals.document_to_review', 'normal', 'Document à vérifier', 'Marie Tremblay a téléversé un document.',
  '/professionnels/d0000000-0000-0000-0000-000000000003/documents', 'professional', 'd0000000-0000-0000-0000-000000000003',
  'professionals.view', null, 'document:d0000000-0000-0000-0000-000000000009:uploaded', now() + interval '60 days'));
select results_eq($$
  select org_id, module_key, kind, recipient_permission, dedupe_key, expires_at = now() + interval '60 days'
    from public.notifications where id = (select id from n where step = 'service')
$$, $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 'professionals'::text, 'professionals.document_to_review'::text,
               'professionals.view'::text, 'document:d0000000-0000-0000-0000-000000000009:uploaded'::text, true) $$,
  'the service role creates a notification through create_notification');
select is(public.create_notification('b0000000-0000-0000-0000-00000000000a', 'professionals',
  'professionals.document_to_review', 'normal', 'Encore', null, null, null, null,
  'professionals.view', null, 'document:d0000000-0000-0000-0000-000000000009:uploaded'),
  (select id from n where step = 'service'), 'create_notification dedupes like private.notify');
select throws_ok($$ select public.create_notification('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_users',
  'normal', 'T', null, null, null, null, 'professionals.view') $$, '22023', null,
  'create_notification applies the module/permission rule');

-- =============================================================================
-- core.notifications_purge (as postgres)
-- =============================================================================
reset role;
insert into n values
  ('p_old',    private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_purge', 'normal', 'P1', null, null, null, null, 'users.view')),
  ('p_kept',   private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_purge', 'normal', 'P2', null, null, null, null, 'users.view')),
  ('p_exp31',  private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_purge', 'normal', 'P3', null, null, null, null, 'users.view', null, null, now() + interval '1 day')),
  ('p_exp29',  private.notify('b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_purge', 'normal', 'P4', null, null, null, null, 'users.view', null, null, now() + interval '1 day'));
update public.notifications x set created_at = now() - interval '13 months' from n where n.step = 'p_old' and x.id = n.id;
update public.notifications x set created_at = now() - interval '11 months' from n where n.step = 'p_kept' and x.id = n.id;
update public.notifications x set created_at = now() - interval '40 days', expires_at = now() - interval '31 days'
  from n where n.step = 'p_exp31' and x.id = n.id;
update public.notifications x set created_at = now() - interval '40 days', expires_at = now() - interval '29 days'
  from n where n.step = 'p_exp29' and x.id = n.id;
insert into public.notification_reads (notification_id, user_id, org_id)
select id, 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a' from n where step = 'p_old';

select matches(private.job_notifications_purge(), '^deleted=[0-9]+$', 'the purge job reports a count');
select set_eq($$ select n.step from n join public.notifications x on x.id = n.id where n.step like 'p\_%' $$,
  array['p_kept', 'p_exp29'], 'older than 12 months and expired over 30 days ago are deleted; the rest is kept');
select is_empty($$ select 1 from public.notification_reads where notification_id = (select id from n where step = 'p_old') $$,
  'read rows go with their notification');
select ok(exists (select 1 from public.notifications where id = (select id from n where step = 'expired')),
  'a notice expired 1 minute ago is kept until 30 days have passed');

-- Clamp: 55 more visible notices; a page never exceeds 50, and defaults to 20.
insert into public.notifications (org_id, module_key, kind, title, recipient_permission)
select 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_bulk', 'Lot ' || i, 'users.view'
  from generate_series(1, 55) i;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.list_my_notifications(p_limit => 1000)), 50, 'p_limit is clamped down to 50');
select is((select count(*)::int from public.list_my_notifications()), 20, 'the default page is 20');
select is((select count(*)::int from public.list_my_notifications(p_limit => null)), 20, 'a null p_limit means 20');

select * from finish();
rollback;
