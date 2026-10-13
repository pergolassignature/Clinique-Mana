-- Rendez-vous (migration *_appointments_messages_reserved.sql): P3-40 for the clients' messages.
-- Covers: Communications reserved → a text is skipped (`sms_off`), a cancellation's too (never an
-- error, never « no consent »); Rendez-vous reserved → a booking queues nothing, the job's pass sets
-- the pending emails aside (`reserved`) and sends nothing, an email prepared then is set aside;
-- opened again → nothing from the reserved time goes out; an imported appointment (the cutover)
-- never sends a confirmation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
-- Léa (texts), her parent Camille (email, manages her appointments).
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164, reminders_by_email, reminders_by_sms, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', null, '+15145550101', false, true, 'fr'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'camille@a.test', null, true, false, 'fr');
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, b_manages_appointments)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'child', 'parent', true);
insert into public.sms_consents (org_id, phone_e164, status, source, granted_at)
values ('b0000000-0000-0000-0000-00000000000a', '+15145550101', 'opted_in', 'staff', now());
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.d', (((now() at time zone 'America/Toronto')::date + 3 + time '10:00') at time zone 'America/Toronto')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '08:00', '20:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d;
reset role;

-- Communications reserved, Rendez-vous open: the texts are skipped, the emails go.
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'communications';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.a1', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select channel, status, skip_reason from public.appointment_messages where appointment_id = current_setting('test.a1')::uuid order by channel $$,
  $$ values ('email'::text, 'pending'::text, null::text), ('sms', 'skipped', 'sms_off') $$,
  'Communications reserved: the text skipped (sms_off), the email waits');
select is((select count(*)::int from public.sms_messages where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… and nothing queued in Communications');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_appointment(current_setting('test.a1')::uuid, 'not_specified') $$, 'a cancellation never fails on the text');
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select status, skip_reason from public.appointment_messages
                      where appointment_id = current_setting('test.a1')::uuid and kind = 'cancelled' and channel = 'sms' $$,
  $$ values ('skipped'::text, 'sms_off'::text) $$, '… its text skipped (sms_off), not « no consent »');

-- Rendez-vous reserved: the pass sets everything pending aside and sends nothing.
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
-- The conseillère tests it (the testers keep the module's permissions).
insert into public.org_module_testers (org_id, module_key, user_id)
values ('b0000000-0000-0000-0000-00000000000a', 'appointments', 'a0000000-0000-0000-0000-000000000004');
select results_eq($$ select (x ->> 'reminders')::int, pg_catalog.jsonb_array_length(x -> 'email')
                       from public.appointment_messages_for_service('b0000000-0000-0000-0000-00000000000a') x $$,
  $$ values (0, 0) $$, 'Rendez-vous reserved: the pass sends nothing');
select is((select count(*)::int from public.appointment_messages where org_id = 'b0000000-0000-0000-0000-00000000000a' and status = 'pending'), 0,
  '… nothing left pending for the launch');
select is((select count(*)::int from public.appointment_messages where org_id = 'b0000000-0000-0000-0000-00000000000a' and skip_reason = 'reserved'), 1,
  '… the pending cancellation email set aside (reserved)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.a2', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d')::timestamptz + interval '2 hours', array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.a2')::uuid), 0,
  'a booking while reserved queues nothing');
-- An email queued just before the module was reserved, prepared after: set aside.
insert into public.appointment_messages (org_id, appointment_id, client_id, recipient_client_id, channel, kind, starts_at)
values ('b0000000-0000-0000-0000-00000000000a', current_setting('test.a2')::uuid, 'd0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000003', 'email', 'confirmation', current_setting('test.d')::timestamptz + interval '2 hours');
select is(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a',
            (select id from public.appointment_messages where appointment_id = current_setting('test.a2')::uuid), extensions.digest('t', 'sha256')),
  null, 'an email prepared while reserved: not sent');

-- Opened again, an imported appointment (the cutover) sends no confirmation.
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key in ('appointments', 'communications');
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, external_ref)
values ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, current_setting('test.d')::timestamptz + interval '5 hours',
        current_setting('test.d')::timestamptz + interval '5 hours 50 minutes', current_setting('test.d')::timestamptz + interval '6 hours', 'gorendezvous:123');
insert into public.appointment_participants (appointment_id, client_id, org_id)
values ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = 'e0000000-0000-0000-0000-000000000007'), 0,
  'an imported appointment: no confirmation');
select results_eq($$ select (x ->> 'reminders')::int >= 0, pg_catalog.jsonb_array_length(x -> 'email')
                       from public.appointment_messages_for_service('b0000000-0000-0000-0000-00000000000a') x $$,
  $$ values (true, 0) $$, 'opened again: nothing from the reserved time goes out');

select * from finish();
rollback;
