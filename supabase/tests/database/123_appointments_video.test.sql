-- Rendez-vous, batch RZ (migrations *_professionals_appointments_facts.sql, *_appointments_video.sql).
-- Covers: privileges (tokens unreadable by every role, service RPCs for service_role only), the
-- encrypted columns listed; the fixed link (staff, the professional's own, refusals); the Zoom
-- connection stored for the actor's professional only (tokens encrypted, another professional's
-- Zoom account refused, a non-professional refused), its future video appointments queued; the
-- trigger (a booking, a move, a change of professional, a cancellation, phone and personal
-- appointments, completed ones untouched); the job's claim and completion (meeting recorded, link
-- ready, generation, retries then « failed », « Réessayer », needs_reconnect); the effective link
-- (Zoom, pending, fixed, none); the reads by role; disconnection, deauthorization, the notices; the
-- recipients of the link email; the published Professionnels helpers.
begin;
create extension if not exists pgtap with schema extensions;
select plan(110);

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': select only')
  from (values ('professional_video_links'), ('video_connections'), ('appointment_video_meetings'), ('video_tasks')) as t(name);
select table_privs_are('public', 'video_connection_tokens', r.name, array[]::text[], 'video_connection_tokens: nothing for ' || r.name)
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name);
select function_privs_are('public', f.name, f.args, 'authenticated', array[]::text[], f.name || ': not for authenticated')
  from (values
    ('store_zoom_connection', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'timestamp with time zone', 'text[]']),
    ('get_my_zoom_credentials_for_service', array['uuid', 'uuid']),
    ('disconnect_my_zoom_connection', array['uuid', 'uuid']),
    ('zoom_deauthorized_for_service', array['uuid', 'text']),
    ('get_zoom_credentials_for_service', array['uuid', 'uuid']),
    ('set_zoom_tokens_for_service', array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'timestamp with time zone']),
    ('mark_zoom_needs_reconnect_for_service', array['uuid', 'uuid', 'text', 'timestamp with time zone']),
    ('list_zoom_connections_to_refresh_for_service', array['uuid', 'integer']),
    ('claim_video_tasks_for_service', array['uuid', 'integer']),
    ('complete_video_task_for_service', array['uuid', 'uuid', 'integer', 'uuid', 'text', 'text', 'text']),
    ('video_link_email_for_service', array['uuid', 'uuid']),
    ('mark_video_link_emailed_for_service', array['uuid', 'uuid', 'text'])
  ) as f(name, args);
select function_privs_are('private', f.name, f.args, 'service_role', array[]::text[], f.name || ': no role')
  from (values ('professional_display_names', array['uuid', 'uuid[]']), ('professional_for_profile', array['uuid', 'uuid']),
               ('professional_profile_id', array['uuid', 'uuid']), ('appointment_video_link', array['uuid', 'uuid'])) as f(name, args);
select ok(pg_catalog.pg_get_functiondef('private.pii_encrypted_values()'::regprocedure)
            like '%''video_connection_tokens''::text, ''access_token''%''video_connection_tokens''::text, ''refresh_token''%',
  'the two token columns are in pii_encrypted_values()');

-- =============================================================================
-- Fixtures: clinic A (admin, conseillère, provider P1 with an account, P2 without), clinic B
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider2@a.test',   '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Provider A2',   'provider2@a.test',   'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o),
                       (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000006', 'Pro', 'Deux', 'provider2@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, email, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai', 'alice@exemple.test', 'fr'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc',  'Essai', null, 'en');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);

-- Two future video appointments of P1 (one with Alice), one by phone, one in the past.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, now() + interval '2 days', now() + interval '2 days 50 minutes', now() + interval '2 days 60 minutes', 'video'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, now() + interval '3 days', now() + interval '3 days 50 minutes', now() + interval '3 days 60 minutes', 'phone'),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, now() - interval '3 days', now() - interval '3 days' + interval '50 minutes', now() - interval '3 days' + interval '60 minutes', 'video');
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');

select is((select count(*)::int from public.video_tasks), 0, 'no Zoom connected: no task, no status');

-- =============================================================================
-- Published Professionnels helpers
-- =============================================================================
select results_eq($$ select display_name from private.professional_display_names('b0000000-0000-0000-0000-00000000000a',
                       array['c0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid]) order by 1 $$,
  array['Pro Deux', 'Pro Un'], 'display names');
select is((select count(*)::int from private.professional_display_names('b0000000-0000-0000-0000-00000000000b', array['c0000000-0000-0000-0000-000000000001'::uuid])), 0,
  'another clinic: nothing');
select is(private.professional_for_profile('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003'),
  'c0000000-0000-0000-0000-000000000001'::uuid, 'the professional of an account');
select is(private.professional_profile_id('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  'a0000000-0000-0000-0000-000000000003'::uuid, 'the account of a professional');

-- =============================================================================
-- The fixed link
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_video_link('c0000000-0000-0000-0000-000000000001', '  https://meet.google.com/abc-defg-hij ') $$,
  'the professional sets her fixed link');
select throws_ok($$ select public.set_professional_video_link('c0000000-0000-0000-0000-000000000002', 'https://meet.google.com/x') $$,
  '42501', 'Permission refusée : appointments.manage', 'not another professional''s');
select throws_ok($$ select public.set_professional_video_link('c0000000-0000-0000-0000-000000000001', 'http://meet.google.com/abc') $$,
  'P0001', null, 'only https');
select throws_ok($$ select public.set_professional_video_link('c0000000-0000-0000-0000-000000000001', 'meet.google.com/abc') $$,
  'P0001', null, 'a full address');
select results_eq($$ select professional_id, fixed_url from public.list_professional_video_status() $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'https://meet.google.com/abc-defg-hij') $$, 'her own row, trimmed');
select results_eq($$ select professional_id, zoom_state, fixed_url from public.get_my_video_setup() $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, null::text, 'https://meet.google.com/abc-defg-hij') $$, 'her setup');
select results_eq($$ select url, source, status from public.get_appointment_video('e0000000-0000-0000-0000-000000000001') $$,
  $$ values ('https://meet.google.com/abc-defg-hij', 'fixed', 'ready') $$, 'no Zoom: the fixed link');
select results_eq($$ select url, source, status from public.get_appointment_video('e0000000-0000-0000-0000-000000000003') $$,
  $$ values (null::text, null::text, 'none') $$, 'a phone appointment: none');
-- P2 sets hers, then the conseillère removes it.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_video_link('c0000000-0000-0000-0000-000000000002', 'https://teams.microsoft.com/l/meetup-join/19%3a') $$,
  'another professional, a Teams link');
select is((select count(*)::int from public.list_professional_video_status()), 1, 'a professional sees her row only');
select is((select count(*)::int from public.get_appointment_video('e0000000-0000-0000-0000-000000000001')), 0, 'nor another professional''s appointment');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professional_video_status()), 2, 'the staff see every professional''s');
select lives_ok($$ select public.set_professional_video_link('c0000000-0000-0000-0000-000000000002', '') $$, 'a blank link removes it');
select is((select count(*)::int from public.professional_video_links), 1, 'removed');
select throws_ok($$ select public.get_my_video_setup() $$, '42501', 'Permission refusée : appointments.self', 'the conseillère has no setup of her own');
reset role;

-- =============================================================================
-- Connecting Zoom (service role, for the actor)
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', 'pro.un@zoom.test', 'access-1', 'refresh-1', now() + interval '1 hour', array['meeting:write']) $$,
  '42501', 'Permission refusée : appointments.self', 'the conseillère holds no appointments.self');
select throws_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', 'pro.un@zoom.test', 'access-1', 'refresh-1', now() + interval '1 hour', array['meeting:write']) $$,
  'P0001', 'Seul un professionnel de la clinique peut connecter son compte Zoom.', 'the admin is not a professional');
select set_config('test.conn', public.store_zoom_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', ' Pro.Un@Zoom.test ', 'access-1', 'refresh-1', now() + interval '1 hour', array['meeting:write'])::text, true);
select throws_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', 'pro.un@zoom.test', 'access-2', 'refresh-2', now() + interval '1 hour', '{}') $$,
  'P0001', 'Ce compte Zoom est déjà connecté pour un autre professionnel de la clinique.', 'one professional per Zoom account');
reset role;
select results_eq($$ select state, account_email, professional_id from public.video_connections $$,
  $$ values ('connected', 'pro.un@zoom.test', 'c0000000-0000-0000-0000-000000000001'::uuid) $$, 'connected, address in lower case');
select ok((select position('access-1' in encode(access_token, 'escape')) = 0 and position('refresh-1' in encode(refresh_token, 'escape')) = 0
             from public.video_connection_tokens), 'the tokens are stored encrypted');
select results_eq($$ select appointment_id, state from public.video_tasks order by 1 $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 'pending') $$, 'her future video appointment is queued (not the phone, not the past)');
select is((select video_status from public.appointments where id = 'e0000000-0000-0000-0000-000000000001'), 'pending', 'its link is on its way');
select results_eq($$ select url, source, status from private.appointment_video_link('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001') $$,
  $$ values (null::text, 'zoom', 'pending') $$, 'pending: no fixed link meanwhile');
set local role service_role;
select results_eq($$ select access_token, refresh_token from public.get_zoom_credentials_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid) $$,
  $$ values ('access-1', 'refresh-1') $$, 'the job reads them decrypted');
select is((select count(*)::int from public.get_zoom_credentials_for_service('b0000000-0000-0000-0000-00000000000b', current_setting('test.conn')::uuid)), 0,
  'not through another clinic');
reset role;

-- =============================================================================
-- The job: claim and complete
-- =============================================================================
set local role service_role;
select results_eq($$ select appointment_id, generation, target_connection_id, meeting_external_id
                      from public.claim_video_tasks_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 1, current_setting('test.conn')::uuid, null::text) $$, 'claimed: create on her account');
select is((select count(*)::int from public.claim_video_tasks_for_service('b0000000-0000-0000-0000-00000000000a')), 0, 'held: not claimed twice');
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 1,
  current_setting('test.conn')::uuid, '88001', 'https://zoom.test/j/88001', null), true, 'created: the clients are to be emailed');
reset role;
select results_eq($$ select video_url, video_external_id, video_status from public.appointments where id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('https://zoom.test/j/88001', '88001', 'ready') $$, 'the appointment holds its meeting');
select is((select state from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000001'), 'done', 'the task is done');
select results_eq($$ select url, source, status from private.appointment_video_link('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001') $$,
  $$ values ('https://zoom.test/j/88001', 'zoom', 'ready') $$, 'the Zoom link wins over the fixed one');
set local role service_role;
select results_eq($$ select email, first_name, language, professional_name, join_url
                      from public.video_link_email_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001') $$,
  $$ values ('alice@exemple.test', 'Alice', 'fr', 'Pro Un', 'https://zoom.test/j/88001') $$, 'the link email: Alice, in French');
select lives_ok($$ select public.mark_video_link_emailed_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 'https://zoom.test/j/88001') $$,
  'marked emailed');
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 1,
  current_setting('test.conn')::uuid, '88001', 'https://zoom.test/j/88001', null), false, 'the same link is never emailed twice');
reset role;

-- A move: the link stays, the task is due again (generation 2); a completion for generation 1 leaves it due.
update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour',
                               blocks_until = blocks_until + interval '1 hour'
 where id = 'e0000000-0000-0000-0000-000000000001';
select results_eq($$ select a.video_status, a.video_url, t.state, t.generation from public.appointments a join public.video_tasks t on t.appointment_id = a.id
                      where a.id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('ready', 'https://zoom.test/j/88001', 'pending', 2) $$, 'a move keeps the link and queues an update');
update public.appointments set internal_note = 'Note' where id = 'e0000000-0000-0000-0000-000000000001';
select is((select generation from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000001'), 2, 'a note queues nothing');
set local role service_role;
select results_eq($$ select generation, meeting_external_id, target_connection_id from public.claim_video_tasks_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values (2, '88001', current_setting('test.conn')::uuid) $$, 'claimed with its meeting: an update');
update public.video_tasks set generation = 3 where appointment_id = 'e0000000-0000-0000-0000-000000000001';
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 2,
  current_setting('test.conn')::uuid, '88001', 'https://zoom.test/j/88001', null), false, 'updated');
reset role;
select is((select state from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000001'), 'pending', 'changed meanwhile: due again');

-- Errors: retried twice, then failed (« Réessayer »).
set local role service_role;
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 3,
  null, null, null, 'provider_error'), false, 'a failure (the meeting was deleted meanwhile)');
reset role;
select results_eq($$ select t.state, t.attempts, a.video_status from public.video_tasks t join public.appointments a on a.id = t.appointment_id
                      where t.appointment_id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('pending', 1::smallint, 'pending') $$, 'first failure: tried again later');
update public.video_tasks set attempts = 2 where appointment_id = 'e0000000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', 3,
  null, null, null, 'provider_error'), false, 'third failure');
reset role;
select results_eq($$ select t.state, a.video_status from public.video_tasks t join public.appointments a on a.id = t.appointment_id
                      where t.appointment_id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('failed', 'failed') $$, 'failed after three attempts');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.retry_appointment_video('e0000000-0000-0000-0000-000000000001') $$, '« Réessayer »');
select throws_ok($$ select public.retry_appointment_video('e0000000-0000-0000-0000-000000000001') $$, 'P0001',
  'Le lien de ce rendez-vous n''est pas en échec.', 'only a failed one');
reset role;
select results_eq($$ select t.state, t.attempts, a.video_status from public.video_tasks t join public.appointments a on a.id = t.appointment_id
                      where t.appointment_id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('pending', 0::smallint, 'pending') $$, 'due again');

-- A cancellation with a meeting: the link goes, a deletion is queued.
set local role service_role;
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
  (select generation from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000001'),
  current_setting('test.conn')::uuid, '88002', 'https://zoom.test/j/88002', null), true, 'a new meeting: a new link to email');
reset role;
update public.appointments set state = 'cancelled', cancelled_at = now() where id = 'e0000000-0000-0000-0000-000000000001';
select results_eq($$ select a.video_url, a.video_status, t.state from public.appointments a join public.video_tasks t on t.appointment_id = a.id
                      where a.id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values (null::text, null::text, 'pending') $$, 'cancelled: no link, the deletion queued');
set local role service_role;
select results_eq($$ select target_connection_id, meeting_external_id from public.claim_video_tasks_for_service('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values (null::uuid, '88002') $$, 'claimed: delete, no target');
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001',
  (select generation from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000001'), null, null, null, null), false, 'deleted');
reset role;
select is((select count(*)::int from public.appointment_video_meetings), 0, 'no meeting left');

-- A personal appointment and a phone one queue nothing.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode, is_personal) values
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   null, now() + interval '5 days', now() + interval '5 days 1 hour', now() + interval '5 days 1 hour', 'video', true);
select is((select count(*)::int from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000005'), 0, 'a personal appointment: no meeting');
-- A new video booking of P1: pending and queued at once.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode) values
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, now() + interval '6 days', now() + interval '6 days 50 minutes', now() + interval '6 days 60 minutes', 'video');
select results_eq($$ select a.video_status, t.state from public.appointments a join public.video_tasks t on t.appointment_id = a.id
                      where a.id = 'e0000000-0000-0000-0000-000000000006' $$,
  $$ values ('pending', 'pending') $$, 'a booking queues its meeting');
-- Moved to P2 (not connected): no meeting wanted any more.
set local role service_role;
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000006',
  (select generation from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000006'),
  current_setting('test.conn')::uuid, '88006', 'https://zoom.test/j/88006', null), true, 'its meeting');
reset role;
update public.appointments set professional_id = 'c0000000-0000-0000-0000-000000000002' where id = 'e0000000-0000-0000-0000-000000000006';
select results_eq($$ select a.video_url, a.video_status, t.state from public.appointments a join public.video_tasks t on t.appointment_id = a.id
                      where a.id = 'e0000000-0000-0000-0000-000000000006' $$,
  $$ values (null::text, null::text, 'pending') $$, 'another professional: the old meeting goes');

-- A started appointment: its meeting is left as it is (never moved or deleted under a session).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode) values
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, now() + interval '9 days', now() + interval '9 days 50 minutes', now() + interval '9 days 60 minutes', 'video');
set local role service_role;
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000007',
  (select generation from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000007'),
  current_setting('test.conn')::uuid, '88007', 'https://zoom.test/j/88007', null), true, 'its meeting');
reset role;
update public.appointments set starts_at = now() - interval '5 minutes', ends_at = now() + interval '45 minutes',
                               blocks_until = now() + interval '55 minutes'
 where id = 'e0000000-0000-0000-0000-000000000007';
select results_eq($$ select a.video_url, a.video_status from public.appointments a where a.id = 'e0000000-0000-0000-0000-000000000007' $$,
  $$ values ('https://zoom.test/j/88007', 'ready') $$, 'under way: the link stays');
set local role service_role;
select results_eq($$ select wants_video, started, target_connection_id, meeting_external_id, meeting_professional_id
                      from public.claim_video_tasks_for_service('b0000000-0000-0000-0000-00000000000a')
                     where appointment_id = 'e0000000-0000-0000-0000-000000000007' $$,
  $$ values (true, true, null::uuid, '88007', 'c0000000-0000-0000-0000-000000000001'::uuid) $$,
  'claimed as started: the job keeps the meeting (no target to move it to)');
reset role;
-- A meeting reported for a cancelled appointment never gives it a link back.
update public.appointments set state = 'cancelled', cancelled_at = now() where id = 'e0000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', 1,
  current_setting('test.conn')::uuid, '88003', 'https://zoom.test/j/88003', 'needs_reconnect'), false, 'a meeting kept on a cancelled one');
reset role;
select results_eq($$ select video_url, video_status from public.appointments where id = 'e0000000-0000-0000-0000-000000000003' $$,
  $$ values (null::text, null::text) $$, 'no link on a cancelled appointment');

-- =============================================================================
-- Reconnect, disconnect, deauthorize
-- =============================================================================
select set_config('test.connected_at', (select connected_at::text from public.video_connections where id = current_setting('test.conn')::uuid), true);
set local role service_role;
select is(public.mark_zoom_needs_reconnect_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'invalid_grant',
  current_setting('test.connected_at')::timestamptz - interval '1 hour'), false, 'not when it was connected again since the job read it');
select is(public.set_zoom_tokens_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'a-x', 'r-x',
  now() + interval '1 hour', current_setting('test.connected_at')::timestamptz - interval '1 hour'), false, 'nor are stale tokens stored');
select is(public.set_zoom_tokens_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'access-2', 'refresh-2',
  now() + interval '1 hour', current_setting('test.connected_at')::timestamptz), true, 'refreshed tokens stored');
select results_eq($$ select access_token, refresh_token from public.get_zoom_credentials_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid) $$,
  $$ values ('access-2', 'refresh-2') $$, 'both rotated');
select is(public.mark_zoom_needs_reconnect_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'invalid_grant',
  current_setting('test.connected_at')::timestamptz), true, 'needs reconnect');
reset role;
select results_eq($$ select recipient_permission, importance from public.notifications where kind = 'appointments.zoom_reconnect' order by 1 $$,
  $$ values ('appointments.manage', 'normal'), ('appointments.self', 'important') $$, 'the professional and the staff are told');
set local role service_role;
select is(public.mark_zoom_needs_reconnect_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.conn')::uuid, 'invalid_grant',
  current_setting('test.connected_at')::timestamptz), false, 'once');
select lives_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', 'pro.un@zoom.test', 'access-3', 'refresh-3', now() + interval '1 hour', '{}') $$, 'reconnected');
reset role;
select is((select count(*)::int from public.notifications where kind = 'appointments.zoom_reconnect' and (expires_at is null or expires_at > now())), 0,
  'the notices are over');
set local role service_role;
select is(public.disconnect_my_zoom_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a'), true, '« Déconnecter »');
reset role;
select results_eq($$ select c.state, (select count(*)::int from public.video_connection_tokens) from public.video_connections c $$,
  $$ values ('disconnected', 0) $$, 'disconnected, tokens deleted');
set local role service_role;
select lives_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', 'pro.un@zoom.test', 'access-4', 'refresh-4', now() + interval '1 hour', '{}') $$, 'connected again');
select is(public.zoom_deauthorized_for_service('b0000000-0000-0000-0000-00000000000a', 'zu1'), 1, 'Zoom: app deauthorized');
select is(public.zoom_deauthorized_for_service('b0000000-0000-0000-0000-00000000000b', 'zu1'), 0, 'another clinic''s webhook ends nothing here');
reset role;
select results_eq($$ select state, reconnect_reason from public.video_connections $$,
  $$ values ('disconnected', 'deauthorized') $$, 'ended by Zoom, said so');

-- Another Zoom account: the old account's meetings are forgotten, the appointments re-queued.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode) values
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, now() + interval '11 days', now() + interval '11 days 50 minutes', now() + interval '11 days 60 minutes', 'video');
set local role service_role;
select lives_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
  'zu1', 'za1', 'pro.un@zoom.test', 'access-5', 'refresh-5', now() + interval '1 hour', '{}') $$, 'connected again');
select is(public.complete_video_task_for_service('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000008',
  (select generation from public.video_tasks where appointment_id = 'e0000000-0000-0000-0000-000000000008'),
  current_setting('test.conn')::uuid, '88008', 'https://zoom.test/j/88008', null), true, 'a meeting on the first account');
select lives_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a',
  'zu2', 'za1', 'autre@zoom.test', 'access-6', 'refresh-6', now() + interval '1 hour', '{}') $$, 'another Zoom account');
reset role;
select results_eq($$ select a.video_url, a.video_status, t.state,
                            (select count(*)::int from public.appointment_video_meetings m where m.appointment_id = a.id)
                       from public.appointments a join public.video_tasks t on t.appointment_id = a.id
                      where a.id = 'e0000000-0000-0000-0000-000000000008' $$,
  $$ values (null::text, 'pending', 'pending', 0) $$, 'the old meeting forgotten, a new one queued');

select * from finish();
rollback;
