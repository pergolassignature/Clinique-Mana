-- Rendez-vous, the sheet's « Messages » and « Renvoyer la notification » (migration
-- *_appointments_messages_sheet.sql; AP-47, parity audit L12). Covers: privileges; the list (kind,
-- channel, the recipient's name, status; the professional's own appointment; another clinic's or
-- an unknown id refused); « Renvoyer »: a new confirmation past the one-per-start key, refused
-- within 2 minutes of the last one, for a past appointment and without appointments.manage; a
-- cancelled coming appointment gets its cancellation again; the 3-argument queue unchanged.
-- The deferred messages trigger fires at commit; `set constraints all immediate` fires it here.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select function_privs_are('public', f, array['uuid'], 'authenticated', array['EXECUTE'], f || ': the app')
  from (values ('list_appointment_messages'), ('resend_appointment_notification')) as x(f);
select function_privs_are('private', 'appointments_queue_message', array['uuid', 'uuid', 'text', 'boolean'], 'authenticated', array[]::text[],
  'appointments_queue_message (again): no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'Pro', 'Un', 'pro@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, email, reminders_by_email, reminders_by_sms, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'camille@a.test', true, false, 'fr');
select set_config('test.s', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- Coming in ten days (booked), and yesterday's (completed).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s')::uuid,
        now() + interval '10 days', now() + interval '10 days 50 minutes', now() + interval '10 days 60 minutes', 'booked', null),
       ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s')::uuid,
        now() - interval '1 day', now() - interval '1 day' + interval '50 minutes', now() - interval '1 day' + interval '50 minutes', 'completed', now() - interval '1 day' + interval '50 minutes');
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select kind, channel, recipient_name, status from public.list_appointment_messages('e0000000-0000-0000-0000-000000000001') $$,
  $$ values ('confirmation'::text, 'email'::text, 'Camille Essai'::text, 'pending'::text) $$, 'the list: the confirmation, by email, to Camille, waiting');
select throws_ok($$ select public.resend_appointment_notification('e0000000-0000-0000-0000-000000000001') $$, 'P0001',
  'Une notification vient de partir : réessayez dans quelques minutes.', 'right after the last one: refused (a double click)');
reset role;
update public.appointment_messages set created_at = created_at - interval '10 minutes' where appointment_id = 'e0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.resend_appointment_notification('e0000000-0000-0000-0000-000000000001'), 1, '« Renvoyer la notification »: one new message');
select is((select count(*)::int from public.list_appointment_messages('e0000000-0000-0000-0000-000000000001') where kind = 'confirmation'), 2,
  '… a second confirmation, past the one-per-start key');
select throws_ok($$ select public.resend_appointment_notification('e0000000-0000-0000-0000-000000000002') $$, 'P0001',
  'Ce rendez-vous est passé : il n''y a plus de notification à envoyer.', 'a past appointment: refused');
select throws_ok($$ select * from public.list_appointment_messages('e0000000-0000-0000-0000-0000000000ff') $$, 'P0001', 'Rendez-vous introuvable.', 'an unknown appointment');

-- The professional: her own appointment's messages, never « Renvoyer ».
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_appointment_messages('e0000000-0000-0000-0000-000000000001')), 2, 'the professional reads her own appointment''s messages');
select throws_ok($$ select public.resend_appointment_notification('e0000000-0000-0000-0000-000000000001') $$, '42501', null, '… but cannot resend');

-- Cancelled (still to come): its cancellation again.
reset role;
update public.appointments
   set state = 'cancelled', cancelled_at = now(),
       cancel_reason_id = (select id from public.cancellation_reasons where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'not_specified')
 where id = 'e0000000-0000-0000-0000-000000000001';
set constraints all immediate;
set constraints all deferred;
-- As if it had happened ten minutes ago (one transaction here: its event time would be the same).
update public.appointment_messages set created_at = created_at - interval '10 minutes', event_at = event_at - interval '10 minutes'
 where appointment_id = 'e0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.resend_appointment_notification('e0000000-0000-0000-0000-000000000001'), 1, 'cancelled: « Renvoyer » sends the cancellation again');
select is((select count(*)::int from public.list_appointment_messages('e0000000-0000-0000-0000-000000000001') where kind = 'cancelled'), 2, '… two cancellations');
reset role;

-- The three-argument queue is unchanged (the triggers and the reminders call it).
select is(private.appointments_queue_message('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'confirmation'), 1,
  'the 3-argument queue still queues');

select * from finish();
rollback;
