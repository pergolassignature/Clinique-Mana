-- Rendez-vous, batch R6 (migration *_appointments_google_busy): a professional's Google busy times.
-- Covers: privileges (tokens unreadable by every role, service RPCs for service_role only, the
-- user reads); the token columns in pii_encrypted_values(); the connection stored for the actor's
-- professional only (tokens encrypted, another professional's Google account refused, staff
-- refused); her setup; the busy times replaced per sync (times only, the window, refusals); the
-- reads by role; open slots skip a busy time; the connections due a sync (the sync status apart,
-- never audited); a failed sync's code in her setup; a refused grant
-- (needs_reconnect, her notice); the disconnection (tokens and busy times gone); the job's row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': select only')
  from (values ('calendar_connections'), ('external_busy_blocks')) as t(name);
select table_privs_are('public', 'calendar_connection_tokens', r.name, array[]::text[], 'calendar_connection_tokens: nothing for ' || r.name)
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name);
select table_privs_are('public', 'calendar_sync_status', r.name, array[]::text[], 'calendar_sync_status: nothing for ' || r.name)
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name);
select function_privs_are('public', f.name, f.args, 'authenticated', array[]::text[], f.name || ': not for authenticated')
  from (values
    ('store_calendar_connection', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'timestamp with time zone', 'text[]']),
    ('get_my_calendar_credentials_for_service', array['uuid', 'uuid']),
    ('disconnect_my_calendar_connection', array['uuid', 'uuid']),
    ('get_calendar_credentials_for_service', array['uuid', 'uuid']),
    ('set_calendar_token_for_service', array['uuid', 'uuid', 'text', 'timestamp with time zone', 'timestamp with time zone']),
    ('mark_calendar_needs_reconnect_for_service', array['uuid', 'uuid', 'text', 'timestamp with time zone']),
    ('list_calendar_connections_to_sync_for_service', array['uuid', 'integer']),
    ('replace_calendar_busy_for_service', array['uuid', 'uuid', 'timestamp with time zone', 'timestamp with time zone', 'jsonb', 'timestamp with time zone'])
  ) as f(name, args);
select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': users')
  from (values ('get_my_calendar_setup', array[]::text[]),
               ('list_external_busy', array['timestamp with time zone', 'timestamp with time zone', 'uuid[]'])) as f(name, args);
select ok(pg_catalog.pg_get_functiondef('private.pii_encrypted_values()'::regprocedure)
            like '%''calendar_connection_tokens''::text, ''access_token''%''calendar_connection_tokens''::text, ''refresh_token''%',
  'the two token columns are in pii_encrypted_values()');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000003', 'provider@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'conseillere@a.test'), ('a0000000-0000-0000-0000-000000000006', 'provider2@a.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
select u::uuid, 'b0000000-0000-0000-0000-00000000000a', n, e, 'active'
  from (values ('a0000000-0000-0000-0000-000000000001', 'Admin A', 'admin@a.test'), ('a0000000-0000-0000-0000-000000000003', 'Provider A', 'provider@a.test'),
               ('a0000000-0000-0000-0000-000000000004', 'Conseillère A', 'conseillere@a.test'),
               ('a0000000-0000-0000-0000-000000000006', 'Provider A2', 'provider2@a.test')) as v(u, n, e);
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000006', 'Pro', 'Deux', 'provider2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- P1 works Mondays 9:00–12:00 (13:00Z–16:00Z in March 2027).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 1, '09:00', '12:00', '{}', true, false, '2026-10-01', null);
reset role;

-- The connection: the actor's professional only.
select throws_ok($$ select public.store_calendar_connection('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a',
                     'g-sub-1', 'pro.un@gmail.test', 'ya29.access', '1//refresh', now() + interval '1 hour', array['openid']) $$,
  '42501', 'Permission refusée : appointments.self', 'the conseillère cannot connect a Google account');
select throws_ok($$ select public.store_calendar_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
                     'g-sub-1', 'pro.un@gmail.test', 'ya29.access', '1//refresh', now() + interval '1 hour', array['openid']) $$,
  'P0001', 'Seul un professionnel de la clinique peut connecter son agenda Google.', 'nor an admin without a professional file');
select set_config('test.conn', public.store_calendar_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
  'g-sub-1', ' Pro.Un@Gmail.test ', 'ya29.access', '1//refresh', now() + interval '1 hour',
  array['openid', 'email', 'https://www.googleapis.com/auth/calendar.freebusy'])::text, true);
select results_eq($$ select professional_id::text, state, account_email from public.calendar_connections where id = current_setting('test.conn')::uuid $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::text, 'connected'::text, 'pro.un@gmail.test'::text) $$, 'P1''s Google account, connected');
select ok((select t.access_token <> pg_catalog.convert_to('ya29.access', 'UTF8') from public.calendar_connection_tokens t
            where t.connection_id = current_setting('test.conn')::uuid), 'the tokens are encrypted');
select results_eq($$ select access_token, refresh_token from public.get_calendar_credentials_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid) $$,
  $$ values ('ya29.access'::text, '1//refresh'::text) $$, '… and read back by the service only');
select throws_ok($$ select public.store_calendar_connection('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a',
                     'g-sub-1', 'pro.un@gmail.test', 'ya29.x', '1//y', now() + interval '1 hour', array['openid']) $$,
  'P0001', 'Ce compte Google est déjà connecté pour un autre professionnel de la clinique.', 'one professional per Google account');

-- Her setup.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select state, account_email, last_synced_at is null from public.get_my_calendar_setup() $$,
  $$ values ('connected'::text, 'pro.un@gmail.test'::text, true) $$, 'her setup: connected, not synced yet');
reset role;
select is((select count(*)::int from public.list_calendar_connections_to_sync_for_service('b0000000-0000-0000-0000-00000000000a', 20) x
            where x = current_setting('test.conn')::uuid), 1, 'a connection never synced is due');

-- The busy times: replaced at each sync, times only.
select set_config('test.audits', (select count(*)::text from public.audit_log), true);
select set_config('test.connected_at', (select connected_at::text from public.calendar_connections where id = current_setting('test.conn')::uuid), true);
select is(public.replace_calendar_busy_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid,
            '2027-03-14T00:00Z', '2027-05-14T00:00Z',
            '[{"start": "2027-03-15T13:00:00Z", "end": "2027-03-15T14:00:00Z"}, {"start": "2027-03-22T15:00:00Z", "end": "2027-03-22T16:30:00Z"}]',
            current_setting('test.connected_at')::timestamptz), 2, 'two busy times stored');
select is(public.replace_calendar_busy_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid,
            '2027-03-14T00:00Z', '2027-05-14T00:00Z', '[{"start": "2027-03-15T13:00:00Z", "end": "2027-03-15T14:00:00Z"}]',
            current_setting('test.connected_at')::timestamptz), 1, 'the next sync replaces them');
select is((select count(*)::int from public.external_busy_blocks), 1, '… one left');
select throws_ok($$ select public.replace_calendar_busy_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid,
                     '2027-03-14T00:00Z', '2027-05-14T00:00Z', '[{"start": "2027-03-15T14:00:00Z", "end": "2027-03-15T13:00:00Z"}]',
                     current_setting('test.connected_at')::timestamptz) $$, '22023', null, 'a busy time ends after it starts');
select is(public.replace_calendar_busy_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid,
            '2027-03-14T00:00Z', '2027-05-14T00:00Z', '[]', '2000-01-01T00:00Z'), -1,
  'a sync read before a reconnection changes nothing');
select is((select count(*)::int from public.list_calendar_connections_to_sync_for_service('b0000000-0000-0000-0000-00000000000a', 20)), 0,
  'just synced: not due');
select is((select count(*)::text from public.audit_log), current_setting('test.audits'),
  'a sync writes nothing to the audit log (its status is operational)');
select lives_ok($$ select public.record_calendar_sync_error_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'provider_error') $$,
  'a failed sync records its code');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select last_synced_at is not null, last_sync_error, busy_count from public.get_my_calendar_setup() $$,
  $$ values (true, 'provider_error'::text, 1) $$, 'her setup: the last read, the failure''s code, the busy time kept');
reset role;

-- The reads, by role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select professional_id::text, starts_at, ends_at from public.list_external_busy('2027-03-15T00:00Z', '2027-03-16T00:00Z', null) $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::text, '2027-03-15T13:00Z'::timestamptz, '2027-03-15T14:00Z'::timestamptz) $$,
  'the professional reads her own busy times (never a title: there is none)');
select is((select count(*)::int from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-15', '2027-03-15')
            where starts_at < '2027-03-15T14:00Z'), 0, 'open slots skip her busy time');
select ok((select count(*) from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-15', '2027-03-15')) > 0,
  '… the rest of the morning stays open');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from public.list_external_busy('2027-03-15T00:00Z', '2027-03-16T00:00Z', null)), 0, 'another professional does not see hers');
select is((select count(*)::int from public.external_busy_blocks), 0, '… nor through the table');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.list_external_busy('2027-03-15T00:00Z', '2027-03-16T00:00Z',
            array['c0000000-0000-0000-0000-000000000001'::uuid])), 1, 'the staff see it in the agenda');
select throws_ok($$ select public.list_external_busy('2027-03-01T00:00Z', '2027-06-01T00:00Z', null) $$, 'P0001', null, 'a period of 62 days at most');
reset role;

-- A refused grant: to reconnect, she is told.
select ok(public.mark_calendar_needs_reconnect_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid,
            'invalid_grant', current_setting('test.connected_at')::timestamptz), 'Google refused the grant');
select results_eq($$ select state, reconnect_reason from public.calendar_connections where id = current_setting('test.conn')::uuid $$,
  $$ values ('needs_reconnect'::text, 'invalid_grant'::text) $$, '… to reconnect');
select is((select count(*)::int from public.notifications n where n.kind = 'appointments.google_calendar_reconnect'
            and n.recipient_user_id = 'a0000000-0000-0000-0000-000000000003'), 1, '… and she is told');

-- The disconnection.
select ok(public.disconnect_my_calendar_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a'), 'disconnected');
select results_eq($$ select (select count(*)::int from public.calendar_connection_tokens), (select count(*)::int from public.external_busy_blocks),
                            (select count(*)::int from public.calendar_sync_status),
                            (select state from public.calendar_connections where id = current_setting('test.conn')::uuid) $$,
  $$ values (0, 0, 0, 'disconnected'::text) $$, 'her tokens, busy times and sync status are gone');

select results_eq($$ select function_name, is_maintenance from public.scheduled_jobs where key = 'appointments.google_busy_sync' $$,
  $$ values ('google-calendar-sync'::text, false) $$, 'the sync job, every 15 minutes, off until switched on');

select * from finish();
rollback;
