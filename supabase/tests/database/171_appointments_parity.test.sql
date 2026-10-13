-- Rendez-vous, the parity audit's gaps (migration *_appointments_parity.sql; AP-28 … AP-32). Covers:
-- privileges; the late notice in business hours (whole business days, the clinic's zone; off:
-- calendar hours) and cancel_appointment through it; « Changer le service » (the new end, the
-- overlap, a retired service, a couple service for one client, the state kept, one `changed`
-- message); « Rétablir » (back to booked, the slot taken refused, a past one refused, one `changed`,
-- cancelled again → a new cancellation message); « Marquer confirmé » (booked → confirmed, every
-- participant, a provider refused); the consents a booking needs; the settings' switch; the texts.
-- The deferred trigger fires at commit; here `set constraints all immediate` fires it after each action.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f || ': the app')
  from (values ('change_appointment_service', array['uuid', 'uuid', 'text']), ('restore_appointment', array['uuid']),
               ('confirm_appointment', array['uuid']), ('get_booking_consents', array['uuid', 'uuid[]']),
               ('set_appointment_settings', array['integer[]', 'time without time zone', 'time without time zone', 'integer', 'integer', 'boolean'])) as x(f, a);
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('appointments_business_minutes', array['uuid', 'timestamp with time zone', 'timestamp with time zone']),
               ('appointments_cancel_late', array['uuid', 'timestamp with time zone', 'integer', 'timestamp with time zone'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'Pro', 'Un', 'pro@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Camille (email reminders), Marc (none).
insert into public.clients (id, org_id, first_name, last_name, email, reminders_by_email, reminders_by_sms, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'camille@a.test', true, false, 'fr'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', null, false, false, 'fr');
select set_config('test.s30', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10130), true);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.natur', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10157), true);
select set_config('test.couple', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 20170), true);
-- Business days: Monday to Friday.
insert into public.appointment_settings (org_id, business_days) values ('b0000000-0000-0000-0000-00000000000a', '{1,2,3,4,5}')
on conflict (org_id) do update set business_days = excluded.business_days, late_notice_business_hours = true;
-- Ten days ahead at 10:00, 10:30 local; yesterday at 10:00.
select set_config('test.d', (((now() at time zone 'America/Toronto')::date + 10 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.d30', (((now() at time zone 'America/Toronto')::date + 10 + time '10:30') at time zone 'America/Toronto')::text, true);
select set_config('test.past', (((now() at time zone 'America/Toronto')::date - 1 + time '10:00') at time zone 'America/Toronto')::text, true);

-- =============================================================================
-- The late notice in business hours (AP-31)
-- =============================================================================
select is(private.appointments_business_minutes('b0000000-0000-0000-0000-00000000000a', '2026-10-17 10:00 America/Toronto', '2026-10-19 10:00 America/Toronto'),
  600, 'Saturday 10:00 → Monday 10:00: 10 business hours (the weekend does not count)');
select is(private.appointments_business_minutes('b0000000-0000-0000-0000-00000000000a', '2026-10-16 10:00 America/Toronto', '2026-10-19 10:00 America/Toronto'),
  1440, 'Friday 10:00 → Monday 10:00: 24 business hours');
select results_eq($$ select private.appointments_cancel_late('b0000000-0000-0000-0000-00000000000a', '2026-10-19 10:00 America/Toronto', 24, x::timestamptz)
                       from (values ('2026-10-16 10:00 America/Toronto'), ('2026-10-16 10:01 America/Toronto'), ('2026-10-17 10:00 America/Toronto')) v(x) $$,
  $$ values (false), (true), (true) $$, 'a Monday 10:00 appointment with 24 h of notice: cancelled Friday 10:00 on time, Friday 10:01 or Saturday late');
select is(private.appointments_cancel_late('b0000000-0000-0000-0000-00000000000a', '2026-10-19 10:00 America/Toronto', null, now()), null::boolean,
  'no policy: not known');
update public.appointment_settings set late_notice_business_hours = false where org_id = 'b0000000-0000-0000-0000-00000000000a';
select is(private.appointments_cancel_late('b0000000-0000-0000-0000-00000000000a', '2026-10-19 10:00 America/Toronto', 24, '2026-10-17 10:00 America/Toronto'),
  false, 'the switch off: calendar hours (Saturday is 48 h before)');
update public.appointment_settings set late_notice_business_hours = true where org_id = 'b0000000-0000-0000-0000-00000000000a';

-- =============================================================================
-- « Changer le service » (AP-28)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '08:00', '20:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d;
select set_config('test.a', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s30')::uuid,
  current_setting('test.d')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select set_config('test.b', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s30')::uuid,
  current_setting('test.d30')::timestamptz, array['d0000000-0000-0000-0000-000000000002'::uuid])::text, true);
set constraints all immediate;
set constraints all deferred;
select throws_ok($$ select public.change_appointment_service(current_setting('test.a')::uuid, current_setting('test.s50')::uuid) $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', '50 min + pause would run into 10:30: refused');
select throws_ok($$ select public.change_appointment_service(current_setting('test.a')::uuid, current_setting('test.natur')::uuid) $$,
  'P0001', 'Ce service n''existe pas ou n''est plus offert.', 'a retired service: refused');
select throws_ok($$ select public.change_appointment_service(current_setting('test.a')::uuid, current_setting('test.couple')::uuid) $$,
  'P0001', null, 'a couple service for one client (or not offered): refused');
select lives_ok($$ select public.cancel_appointment(current_setting('test.b')::uuid, 'not_specified') $$, 'Marc''s 10:30 cancelled');
select is((select cancel_late from public.appointments where id = current_setting('test.b')::uuid), false,
  'ten days ahead: not late (business hours)');
select lives_ok($$ select public.change_appointment_service(current_setting('test.a')::uuid, current_setting('test.s50')::uuid) $$,
  'now the 50-minute service fits');
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select service_id, ends_at - starts_at, blocks_until - starts_at, state from public.appointments where id = current_setting('test.a')::uuid $$,
  $$ values (current_setting('test.s50')::uuid, interval '50 minutes', interval '60 minutes', 'booked'::text) $$,
  '… the new end and pause, the state kept');
select results_eq($$ select kind, status from public.appointment_messages where appointment_id = current_setting('test.a')::uuid order by kind $$,
  $$ values ('changed'::text, 'pending'::text), ('confirmation', 'pending') $$, '… Camille told once: `changed` (never cancel + confirm)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.change_appointment_service(current_setting('test.a')::uuid, current_setting('test.s50')::uuid) $$,
  'the same service again: nothing to do');

-- =============================================================================
-- « Rétablir » (AP-29)
-- =============================================================================
select throws_ok($$ select public.restore_appointment(current_setting('test.b')::uuid) $$,
  'P0001', 'Le créneau est maintenant pris : ce rendez-vous ne peut pas être rétabli.', 'Marc''s slot is now taken by the longer service');
select throws_ok($$ select public.restore_appointment(current_setting('test.a')::uuid) $$,
  'P0001', 'Ce rendez-vous n''est pas annulé.', 'a booked appointment is not restored');
select lives_ok($$ select public.change_appointment_service(current_setting('test.a')::uuid, current_setting('test.s30')::uuid) $$, 'back to 30 minutes');
select lives_ok($$ select public.restore_appointment(current_setting('test.b')::uuid) $$, 'Marc''s appointment restored');
reset role;
select results_eq($$ select state, cancelled_at, cancel_reason_id, cancel_late, kept_on_schedule from public.appointments where id = current_setting('test.b')::uuid $$,
  $$ values ('booked'::text, null::timestamptz, null::uuid, null::boolean, false) $$, '… booked, the cancellation cleared');

-- Camille's: cancelled, restored, cancelled again: each told.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set constraints all immediate;
set constraints all deferred;
select lives_ok($$ select public.cancel_appointment(current_setting('test.a')::uuid, 'not_specified') $$, 'Camille''s cancelled');
set constraints all immediate;
set constraints all deferred;
reset role;
select set_config('test.cancel1', (select id::text from public.appointment_messages where appointment_id = current_setting('test.a')::uuid and kind = 'cancelled'), true);
-- The first cancellation was sent; the restore comes in another transaction (its own event).
update public.appointment_messages set status = 'sent', sent_at = now() where appointment_id = current_setting('test.a')::uuid and status = 'pending';
update public.appointment_messages set event_at = event_at - interval '1 hour' where appointment_id = current_setting('test.a')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.restore_appointment(current_setting('test.a')::uuid) $$, 'restored');
set constraints all immediate;
set constraints all deferred;
reset role;
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.a')::uuid and kind = 'changed' and status = 'pending'),
  1, '… Camille told it is back (`changed`, a new message)');
update public.appointment_messages set event_at = event_at - interval '1 hour' where appointment_id = current_setting('test.a')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_appointment(current_setting('test.a')::uuid, 'not_specified') $$, 'cancelled again');
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.a')::uuid and kind = 'cancelled'),
  2, '… a second cancellation message (the key counts each event)');
select lives_ok($$ select public.restore_appointment(current_setting('test.a')::uuid) $$, 'restored again');
set constraints all immediate;
set constraints all deferred;

select set_config('test.p', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s30')::uuid,
  current_setting('test.past')::timestamptz, array['d0000000-0000-0000-0000-000000000002'::uuid])::text, true);
select lives_ok($$ select public.cancel_appointment(current_setting('test.p')::uuid, 'not_specified') $$, 'yesterday''s cancelled');
select throws_ok($$ select public.restore_appointment(current_setting('test.p')::uuid) $$,
  'P0001', 'Un rendez-vous passé ne se rétablit pas : réservez-en un nouveau au besoin.', 'a past appointment is not restored (no fee can exist for one that is)');

-- =============================================================================
-- « Marquer confirmé » (AP-30)
-- =============================================================================
select is((select state from public.appointments where id = current_setting('test.a')::uuid), 'booked', 'Camille''s is booked');
select ok(public.confirm_appointment(current_setting('test.a')::uuid) is not null, 'the counselor marks it confirmed');
reset role;
select results_eq($$ select a.state, p.confirmed_at is not null from public.appointments a
                       join public.appointment_participants p on p.appointment_id = a.id where a.id = current_setting('test.a')::uuid $$,
  $$ values ('confirmed'::text, true) $$, '… the appointment and its participant');
select ok(exists (select 1 from public.audit_log l where l.table_name = 'appointments' and l.record_id = current_setting('test.a')
                   and l.source = 'rpc:confirm_appointment'), '… audited under its name');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.confirm_appointment(current_setting('test.b')::uuid) $$, '42501', null, 'a provider cannot (appointments.manage)');

-- =============================================================================
-- The consents a booking needs (AP-32)
-- =============================================================================
reset role;
update public.client_consent_rules r set is_active = true
 where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.consent_key = 'general' and r.trigger_kind = 'general';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select client_id, consent_key, consent_name, state from public.get_booking_consents(current_setting('test.s30')::uuid,
                       array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'general'::text, 'Consentement général'::text, 'missing'::text) $$,
  'a booking: the general consent missing, by its name');
select results_eq($$ select client_id, consent_name, state from public.get_appointment_consents(current_setting('test.a')::uuid) $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'Consentement général'::text, 'missing'::text) $$,
  'an appointment: the same, with the name');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.get_booking_consents(current_setting('test.s30')::uuid, array['d0000000-0000-0000-0000-000000000001'::uuid])),
  1, 'a professional: her own client (linked by the booking)');
reset role;
delete from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.get_booking_consents(current_setting('test.s30')::uuid, array['d0000000-0000-0000-0000-000000000001'::uuid])),
  0, '… never another''s');

-- =============================================================================
-- The settings' switch and the texts
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.set_appointment_settings(array[1, 2, 3, 4, 5], '08:00', '17:00', 1, 8, false) $$, 'the admin turns it off');
select is((select late_notice_business_hours from public.appointment_settings where org_id = 'b0000000-0000-0000-0000-00000000000a'), false, '… off');
select lives_ok($$ select public.set_appointment_settings(array[1, 2, 3, 4, 5], '08:00', '17:00', 1, 8) $$, 'five arguments still work');
select is((select late_notice_business_hours from public.appointment_settings where org_id = 'b0000000-0000-0000-0000-00000000000a'), false, '… and keep the switch');
reset role;
select is(private.appointments_sms_body('changed', 'fr', 'Org A', 'lundi 19 octobre à 10 h', 'Pro Un', 'video', true),
  'Org A : votre rendez-vous est modifié : le lundi 19 octobre à 10 h avec Pro Un (par vidéo). Répondez OUI pour confirmer.', 'the text says « modifié »');

select * from finish();
rollback;
