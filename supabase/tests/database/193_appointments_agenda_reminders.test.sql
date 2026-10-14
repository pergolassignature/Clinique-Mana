-- Rendez-vous, the reminder and confirmation state on the agenda's blocks (migration
-- *_appointments_agenda_reminders.sql; AP-49, parity audit L12). Covers: the signature kept;
-- `reminder_status` (sent, pending, none; a reminder of an old start never counts); `unreachable`
-- for a coming appointment of the next 14 days nobody can be reminded of (never further, never
-- past); the client's confirmation as the state.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select function_privs_are('public', 'list_agenda', array['timestamp with time zone', 'timestamp with time zone', 'uuid[]'], 'authenticated', array['EXECUTE'], 'list_agenda: the app');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
-- Camille can be reminded by email; Marc by nothing.
insert into public.clients (id, org_id, first_name, last_name, email, reminders_by_email, reminders_by_sms, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'camille@a.test', true, false, 'fr'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', null, false, false, 'fr');
select set_config('test.s', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, confirmed_at, completed_at)
select x.id::uuid, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s')::uuid,
       now() + x.at, now() + x.at + interval '50 minutes', now() + x.at + interval '60 minutes', x.state,
       case when x.state = 'confirmed' then now() end, case when x.state = 'completed' then now() + x.at + interval '50 minutes' end
  from (values ('e0000000-0000-0000-0000-000000000001', interval '1 day', 'booked'),
               ('e0000000-0000-0000-0000-000000000002', interval '3 days', 'booked'),
               ('e0000000-0000-0000-0000-000000000003', interval '2 days', 'confirmed'),
               ('e0000000-0000-0000-0000-000000000004', interval '20 days', 'booked'),
               ('e0000000-0000-0000-0000-000000000005', interval '-1 day', 'completed')) as x(id, at, state);
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a');
-- e1's reminder went; e3's waits; e2 had one for a start it no longer has.
insert into public.appointment_messages (org_id, appointment_id, client_id, recipient_client_id, channel, kind, starts_at, status, sent_at)
select 'b0000000-0000-0000-0000-00000000000a', x.appt::uuid, x.client::uuid, x.client::uuid, 'email', 'reminder', x.starts_at, x.status, case when x.status = 'sent' then now() end
  from (values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', now() + interval '1 day', 'sent'),
               ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', now() + interval '2 days', 'pending'),
               ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', now() + interval '4 days', 'sent')) as x(appt, client, starts_at, status);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.rows', (select jsonb_object_agg(id, jsonb_build_object('r', reminder_status, 'u', unreachable, 's', state))
                                  from public.list_agenda(now() - interval '2 days', now() + interval '25 days'))::text, true);
reset role;
select is(current_setting('test.rows')::jsonb -> 'e0000000-0000-0000-0000-000000000001', '{"r": "sent", "s": "booked", "u": false}'::jsonb,
  'tomorrow: its reminder went (a bell), Camille reachable');
select is(current_setting('test.rows')::jsonb -> 'e0000000-0000-0000-0000-000000000003', '{"r": "pending", "s": "confirmed", "u": false}'::jsonb,
  'confirmed by the client (a check), its reminder waiting');
select is(current_setting('test.rows')::jsonb -> 'e0000000-0000-0000-0000-000000000002', '{"r": null, "s": "booked", "u": true}'::jsonb,
  'Marc in three days: nobody to remind (« injoignable »); a reminder of an old start never counts');
select is(current_setting('test.rows')::jsonb -> 'e0000000-0000-0000-0000-000000000004', '{"r": null, "s": "booked", "u": false}'::jsonb,
  'in twenty days: not said yet (the next 14 days only)');
select is(current_setting('test.rows')::jsonb -> 'e0000000-0000-0000-0000-000000000005', '{"r": null, "s": "completed", "u": false}'::jsonb,
  'past: never « injoignable »');

select * from finish();
rollback;
