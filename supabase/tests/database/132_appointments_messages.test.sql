-- Rendez-vous, batch R4 (migration *_appointments_messages.sql): the clients' messages.
-- Covers: privileges; a booking's confirmation by each recipient's channels (a teen's text through
-- Communications, her parent's email), nothing for an unreachable client but « Clients sans
-- rappel »; the job's pass, an email prepared with its link and finished; the link's page and
-- « Confirmer ma présence » (once); a move (`changed`), « OUI » by text, a cancellation (the pending
-- email set aside); the reminders (the next business day, once, not right after a confirmation);
-- no consent → skipped; three failed tries → failed; personal and held appointments; the seeds.
-- The deferred trigger fires at commit; here `set constraints all immediate` fires it after each action.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

select function_privs_are('public', f, a, 'authenticated', array[]::text[], f || ': not the app')
  from (values ('appointment_messages_for_service', array['uuid', 'integer']),
               ('prepare_appointment_message_for_service', array['uuid', 'uuid', 'bytea']),
               ('finish_appointment_message_for_service', array['uuid', 'uuid', 'boolean']),
               ('resolve_appointment_confirm_link', array['uuid']),
               ('confirm_appointment_by_link_for_service', array['bytea'])) as x(f, a);
select function_privs_are('public', 'confirm_appointment_by_link_for_service', array['bytea'], 'service_role', array['EXECUTE'], 'the confirmation: service role');
select function_privs_are('public', 'list_appointments_without_reminder', array['timestamp with time zone', 'timestamp with time zone'],
  'authenticated', array['EXECUTE'], '« Clients sans rappel »: the app');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('communications')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Léa (a teen: texts only), her parent Camille (email only, manages her appointments), Marc (nothing).
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164, reminders_by_email, reminders_by_sms, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', null, '+15145550101', false, true, 'fr'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', null, null, false, false, 'fr'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'camille@a.test', null, true, false, 'fr');
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, b_manages_appointments)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'child', 'parent', true);
insert into public.sms_consents (org_id, phone_e164, status, source, granted_at)
values ('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'opted_in', 'staff', now());
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- Every day 8:00–20:00; the reminders every day from midnight (so « now » is always in the window).
insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour)
values ('b0000000-0000-0000-0000-00000000000a', '{1,2,3,4,5,6,7}', '00:00', '23:59', 1, 0)
on conflict (org_id) do update set business_days = excluded.business_days, business_start = excluded.business_start,
  business_end = excluded.business_end, reminder_business_days = 1, reminder_local_hour = 0;
-- Three days ahead at 10:00 and 11:00 local, tomorrow at 10:00.
select set_config('test.d3', (((now() at time zone 'America/Toronto')::date + 3 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.d3b', (((now() at time zone 'America/Toronto')::date + 3 + time '11:00') at time zone 'America/Toronto')::text, true);
select set_config('test.d1', (((now() at time zone 'America/Toronto')::date + 1 + time '10:00') at time zone 'America/Toronto')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '08:00', '20:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d;
select set_config('test.lea', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select set_config('test.marc', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3b')::timestamptz, array['d0000000-0000-0000-0000-000000000002'::uuid])::text, true);
set constraints all immediate;
set constraints all deferred;
select results_eq($$ select id from public.list_appointments_without_reminder(now(), now() + interval '7 days') $$,
  $$ values (current_setting('test.marc')::uuid) $$, '« Clients sans rappel »: Marc, not Léa');
select throws_ok($$ select * from public.list_appointments_without_reminder(now(), now() + interval '30 days') $$,
  'P0001', 'Choisissez une période de 14 jours au plus.', '… 14 days at most');
reset role;

-- The confirmation: Léa's text (sent through Communications), Camille's email (pending).
select results_eq($$ select recipient_client_id, channel, kind, status from public.appointment_messages
                      where appointment_id = current_setting('test.lea')::uuid order by channel $$,
  $$ values ('d0000000-0000-0000-0000-000000000003'::uuid, 'email'::text, 'confirmation'::text, 'pending'::text),
            ('d0000000-0000-0000-0000-000000000001'::uuid, 'sms', 'confirmation', 'sent') $$,
  'a booking: each recipient by her own channel');
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.marc')::uuid), 0, 'Marc: nothing to send');
select results_eq($$ select s.kind, s.body like 'Org A : votre rendez-vous est réservé le % avec Pro Un (par vidéo). Répondez OUI pour confirmer.'
                       from public.sms_messages s join public.appointment_messages m on m.sms_message_id = s.id
                      where m.appointment_id = current_setting('test.lea')::uuid $$,
  $$ values ('confirmation'::text, true) $$, '… the text: the clinic, the moment, the professional, « OUI »');

-- The job's pass, then the email.
select results_eq($$ select (x ->> 'reminders')::int, pg_catalog.jsonb_array_length(x -> 'email')
                       from public.appointment_messages_for_service('b0000000-0000-0000-0000-00000000000a') x $$,
  $$ values (0, 1) $$, 'the pass: one email to send');
select set_config('test.msg', (select id::text from public.appointment_messages where appointment_id = current_setting('test.lea')::uuid and channel = 'email'), true);
select set_config('test.prepared', public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a',
  current_setting('test.msg')::uuid, extensions.digest('token-1', 'sha256'))::text, true);
select results_eq($$ select x ->> 'kind', x ->> 'email', x ->> 'recipient_first_name', x ->> 'client_first_name', x ->> 'professional_name',
                            x ->> 'access', (x ->> 'with_link')::boolean
                       from (select current_setting('test.prepared')::jsonb x) y $$,
  $$ values ('confirmation', 'camille@a.test', 'Camille', 'Léa', 'Pro Un', 'Par vidéo.', true) $$,
  'prepared: Camille, about Léa, the professional, how to join, a link');
select is((select count(*)::int from public.secure_links where purpose = 'appointment_confirm' and subject_id = current_setting('test.msg')::uuid
             and expires_at <= current_setting('test.d3')::timestamptz), 1, '… the link valid until the start');
select lives_ok($$ select public.finish_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.msg')::uuid, true) $$, 'finished: sent');
select is((select status from public.appointment_messages where id = current_setting('test.msg')::uuid), 'sent', '… recorded');

-- The page and « Confirmer ma présence ».
select results_eq($$ select x ->> 'professional_name', x ->> 'mode', (x ->> 'confirmed')::boolean
                       from public.resolve_appointment_confirm_link((select id from public.secure_links where purpose = 'appointment_confirm'
                                                                      and subject_id = current_setting('test.msg')::uuid)) x $$,
  $$ values ('Pro Un', 'video', false) $$, 'the page: the professional, the mode, not confirmed yet');
select is(public.confirm_appointment_by_link_for_service(extensions.digest('token-1', 'sha256')) ->> 'state', 'confirmed', '« Confirmer ma présence »');
select results_eq($$ select a.state, p.confirmed_at is not null from public.appointments a
                       join public.appointment_participants p on p.appointment_id = a.id where a.id = current_setting('test.lea')::uuid $$,
  $$ values ('confirmed'::text, true) $$, '… the appointment and Léa confirmed');
select is(public.confirm_appointment_by_link_for_service(extensions.digest('token-1', 'sha256')) ->> 'state', 'invalid', '… once');
select is(public.confirm_appointment_by_link_for_service(extensions.digest('unknown', 'sha256')) ->> 'state', 'invalid', 'an unknown token');

-- A move: `changed` for both; « OUI » by text confirms.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.move_appointment(current_setting('test.lea')::uuid, current_setting('test.d3')::timestamptz + interval '2 hours') $$, 'moved');
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select channel, status from public.appointment_messages
                      where appointment_id = current_setting('test.lea')::uuid and kind = 'changed' order by channel $$,
  $$ values ('email'::text, 'pending'::text), ('sms', 'sent') $$, '… a change for each recipient');
select is(private.sms_confirmation_hook('b0000000-0000-0000-0000-00000000000a', '+15145550101', null), true, '« OUI » from Léa''s number');
select is((select state from public.appointments where id = current_setting('test.lea')::uuid), 'confirmed', '… confirms the appointment');
select is(private.sms_confirmation_hook('b0000000-0000-0000-0000-00000000000a', '+15145559999', null), false, 'another number confirms nothing');

-- A cancellation: `cancelled`, the pending change email set aside.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_appointment(current_setting('test.lea')::uuid, 'not_specified') $$, 'cancelled');
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select kind, channel, status, skip_reason from public.appointment_messages
                      where appointment_id = current_setting('test.lea')::uuid and kind in ('changed', 'cancelled') order by kind, channel $$,
  $$ values ('cancelled'::text, 'email'::text, 'pending'::text, null::text), ('cancelled', 'sms', 'sent', null),
            ('changed', 'email', 'skipped', 'cancelled'), ('changed', 'sms', 'sent', null) $$,
  '… a cancellation for each, the pending change set aside');
select set_config('test.cancel_msg', (select id::text from public.appointment_messages where appointment_id = current_setting('test.lea')::uuid
                                         and kind = 'cancelled' and channel = 'email'), true);
select is(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cancel_msg')::uuid,
            extensions.digest('token-2', 'sha256')) ->> 'with_link', 'false', 'a cancellation email has no link');
-- Three failed tries → failed.
select public.finish_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cancel_msg')::uuid, false);
select is((select status from public.appointment_messages where id = current_setting('test.cancel_msg')::uuid), 'pending', 'a failed try: tried again');
select public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cancel_msg')::uuid, extensions.digest('t3', 'sha256'));
select public.finish_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cancel_msg')::uuid, false);
select public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cancel_msg')::uuid, extensions.digest('t4', 'sha256'));
select public.finish_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.cancel_msg')::uuid, false);
select is((select status from public.appointment_messages where id = current_setting('test.cancel_msg')::uuid), 'failed', '… three, then failed');

-- Reminders: tomorrow's appointment, after its confirmation's 18 hours.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.tomorrow', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d1')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select (x ->> 'reminders')::int from public.appointment_messages_for_service('b0000000-0000-0000-0000-00000000000a') x), 0,
  'no reminder right after its confirmation');
update public.appointment_messages set created_at = now() - interval '2 days' where appointment_id = current_setting('test.tomorrow')::uuid;
select is((select (x ->> 'reminders')::int from public.appointment_messages_for_service('b0000000-0000-0000-0000-00000000000a') x), 2,
  'the next business day''s appointment: a reminder for each recipient');
select results_eq($$ select channel, status from public.appointment_messages
                      where appointment_id = current_setting('test.tomorrow')::uuid and kind = 'reminder' order by channel $$,
  $$ values ('email'::text, 'pending'::text), ('sms', 'sent') $$, '… Camille''s email, Léa''s text');
select is((select (x ->> 'reminders')::int from public.appointment_messages_for_service('b0000000-0000-0000-0000-00000000000a') x), 0,
  '… once');
select is((select count(*)::int from public.appointment_messages where kind = 'reminder' and appointment_id = current_setting('test.marc')::uuid
             or kind = 'reminder' and appointment_id <> current_setting('test.tomorrow')::uuid and org_id = 'b0000000-0000-0000-0000-00000000000a'), 0,
  'three days ahead: not yet');

-- No consent: the text is skipped. Personal and held appointments: nothing.
update public.sms_consents set status = 'opted_out', withdrawn_at = now() where phone_e164 = '+15145550101';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.noconsent', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '4 hours', array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select status, skip_reason from public.appointment_messages
                      where appointment_id = current_setting('test.noconsent')::uuid and channel = 'sms' $$,
  $$ values ('skipped'::text, 'no_consent'::text) $$, 'no consent in force: the text is skipped');
select set_config('test.held', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, current_setting('test.d3')::timestamptz + interval '6 hours', array['d0000000-0000-0000-0000-000000000003'::uuid],
  now() + interval '1 day', null)::text, true);
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.held')::uuid), 0, 'a held slot: nothing');
select private.appointments_confirm_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.held')::uuid, null);
set constraints all immediate;
set constraints all deferred;
select results_eq($$ select kind, channel from public.appointment_messages where appointment_id = current_setting('test.held')::uuid $$,
  $$ values ('confirmation'::text, 'email'::text) $$, '… accepted: its confirmation');
insert into public.appointments (id, org_id, professional_id, starts_at, ends_at, blocks_until, is_personal, personal_label)
values ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.d3')::timestamptz + interval '8 hours', current_setting('test.d3')::timestamptz + interval '9 hours',
        current_setting('test.d3')::timestamptz + interval '9 hours', true, 'Dentiste');
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = 'e0000000-0000-0000-0000-000000000009'), 0, 'a personal appointment: nothing');

-- The seeds.
select results_eq($$ select j.kind, j.function_name, c.schedule from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
                      where j.key = 'appointments.messages' $$,
  $$ values ('function'::text, 'appointments-messages'::text, '*/10 * * * *'::text) $$, 'the job, every 10 minutes');
select is((select count(*)::int from public.email_template_defaults where module_key = 'appointments'
             and key ~ '^appointments\.(confirmation|reminder|changed|cancelled)(_en)?$'), 8, 'eight email templates');
select results_eq($$ select max_uses, resolve_rpc from public.secure_link_purposes where key = 'appointment_confirm' $$,
  $$ values (1, 'resolve_appointment_confirm_link'::text) $$, 'the confirmation link: one use');

select * from finish();
rollback;
