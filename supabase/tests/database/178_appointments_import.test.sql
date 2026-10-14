-- Rendez-vous, the GOrendezvous import I2 (migration *_appointments_import.sql; decision I-15).
-- Covers: privileges (clients.merge too); a dry run writes nothing; history (completed: its slot
-- without the pause, each client present or absent; cancelled: an unknown reason « Non spécifiée »
-- and noted) under the audit source `import`, linked « import » to the professional; a re-run
-- `skipped`; an overlap `conflict`; clients not found or homonyms `unmatched`; refusals in French
-- with their field; a coming appointment with its pause and its GOrendezvous link kept (no Zoom
-- task over it; one without a link gets its meeting), no confirmation, but a later cancellation
-- told, and its reminder from the messages job; Facturation's three publications leave the
-- imported history out (a coming one stays).
-- The deferred messages trigger fires at commit; `set constraints all immediate` fires it here.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select function_privs_are('public', 'import_appointment', array['jsonb', 'boolean'], 'authenticated', array['EXECUTE'], 'import_appointment: authenticated');
select function_privs_are('public', 'import_appointment', array['jsonb', 'boolean'], 'anon', array[]::text[], 'import_appointment: never anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro2@a.test', '', now(), '{}', '{}', now(), now()),
       ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pro Deux', 'pro2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Un', 'pro1@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'Pro', 'Deux', 'pro2@a.test', 'active');
-- Imported files (GOrendezvous references); « Pas Importé » was made here.
insert into public.clients (id, org_id, first_name, last_name, email, reminders_by_email, reminders_by_sms, language, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Camille', 'Essai', 'camille@a.test', true, false, 'fr', 'gorendezvous:501'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', null, false, false, 'fr', 'gorendezvous:502'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Luc', 'Homonyme', null, false, false, 'fr', 'gorendezvous:503'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Luc', 'Homonyme', null, false, false, 'fr', 'gorendezvous:504'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Pas', 'Importé', null, false, false, 'fr', null);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- Yesterday, two and three days ago at 10:00; ten and eleven days ahead at 10:00 (clinic time).
select set_config('test.p1', (((now() at time zone 'America/Toronto')::date - 1 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.p2', (((now() at time zone 'America/Toronto')::date - 2 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.p3', (((now() at time zone 'America/Toronto')::date - 3 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.p4', (((now() at time zone 'America/Toronto')::date - 4 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.f10', (((now() at time zone 'America/Toronto')::date + 10 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.f11', (((now() at time zone 'America/Toronto')::date + 11 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.row', jsonb_build_object(
  'external_ref', 'gorendezvous:appt:1', 'professional_id', 'c0000000-0000-0000-0000-000000000001', 'service_code', '10150',
  'clients', jsonb_build_array(jsonb_build_object('client_name', 'ESSAI, Camille')), 'starts_at', current_setting('test.p1'))::text, true);

-- =============================================================================
-- Privileges, dry run
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.import_appointment(current_setting('test.row')::jsonb, true) $$, '42501', null,
  'the conseillère (no clients.merge): refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.import_appointment(current_setting('test.row')::jsonb, true) ->> 'status', 'ok', 'a dry run: ok');
reset role;
select is((select count(*)::int from public.appointments where org_id = 'b0000000-0000-0000-0000-00000000000a'), 0, '… nothing written');

-- =============================================================================
-- History
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.r1', public.import_appointment(current_setting('test.row')::jsonb, false)::text, true);
select is(current_setting('test.r1')::jsonb ->> 'status', 'ok', 'a past appointment imported');
reset role;
select set_config('test.a1', current_setting('test.r1')::jsonb ->> 'id', true);
select results_eq($$ select state, completed_at = ends_at, ends_at - starts_at, blocks_until = ends_at, external_ref, mode
                       from public.appointments where id = current_setting('test.a1')::uuid $$,
  $$ values ('completed'::text, true, interval '50 minutes', true, 'gorendezvous:appt:1'::text, 'video'::text) $$,
  'completed, its service''s length, its slot without the pause, its reference');
select results_eq($$ select client_id, role, presence from public.appointment_participants where appointment_id = current_setting('test.a1')::uuid $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'client'::text, 'present'::text) $$, 'the client by her name (any order), present');
select is((select reason from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000001'
              and professional_id = 'c0000000-0000-0000-0000-000000000001'), 'import', 'linked to the professional, reason « import »');
select is((select source from public.audit_log where table_name = 'appointments' and record_id = current_setting('test.a1') and action = 'insert'),
  'import', 'written under the audit source « import »');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.import_appointment(current_setting('test.row')::jsonb, false) ->> 'status', 'skipped', 'a re-run: skipped');
-- A couple: the second client absent.
select set_config('test.a2', (public.import_appointment(jsonb_build_object(
  'external_ref', 'gorendezvous:appt:2', 'professional_id', 'c0000000-0000-0000-0000-000000000001', 'service_code', '20170',
  'clients', jsonb_build_array(jsonb_build_object('client_ref', 'gorendezvous:501'), jsonb_build_object('client_ref', 'gorendezvous:502', 'absent', 'true')),
  'starts_at', current_setting('test.p2')), false) ->> 'id'), true);
-- Cancelled, its reason unknown here.
select set_config('test.r3', public.import_appointment(jsonb_build_object(
  'external_ref', 'gorendezvous:appt:3', 'professional_id', 'c0000000-0000-0000-0000-000000000001', 'service_code', '10150',
  'clients', jsonb_build_array(jsonb_build_object('client_ref', 'gorendezvous:501')), 'starts_at', current_setting('test.p3'),
  'state', 'cancelled', 'cancel_reason', 'Raison inventée'), false)::text, true);
reset role;
select results_eq($$ select role, presence from public.appointment_participants where appointment_id = current_setting('test.a2')::uuid order by role $$,
  $$ values ('client'::text, 'present'::text), ('second', 'absent') $$, 'a couple: each client''s presence');
select results_eq($$ select a.state, r.key, a.cancelled_at is not null, a.cancel_late is null
                       from public.appointments a join public.cancellation_reasons r on r.id = a.cancel_reason_id
                      where a.id = (current_setting('test.r3')::jsonb ->> 'id')::uuid $$,
  $$ values ('cancelled'::text, 'not_specified'::text, true, true) $$, 'cancelled: an unknown reason is « Non spécifiée »');
select is(current_setting('test.r3')::jsonb -> 'notes', '["reason_unknown"]'::jsonb, '… and noted for the report');

-- =============================================================================
-- Conflicts, matching, refusals
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.import_appointment(current_setting('test.row')::jsonb || jsonb_build_object('external_ref', 'gorendezvous:appt:9',
            'clients', jsonb_build_array(jsonb_build_object('client_ref', 'gorendezvous:502'))), false) ->> 'status',
  'conflict', 'the professional busy on that slot: conflict, never an error');
select is(public.import_appointment(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:appt:10", "clients": [{"client_name": "Luc Homonyme"}]}', true) ->> 'reason',
  'client_ambiguous', 'two homonyms: unmatched');
select is(public.import_appointment(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:appt:10", "clients": [{"client_name": "Pas Importé"}]}', true) ->> 'reason',
  'client_not_found', 'a file not imported: not found');
select is(public.import_appointment(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:appt:10", "service_code": "99999"}', true) -> 'errors' -> 0 ->> 'field',
  'service_code', 'an unknown service code: refused with its field');
select is(public.import_appointment(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:appt:10", "state": "booked"}', true) -> 'errors' -> 0 ->> 'message',
  'L''état ne convient pas : un rendez-vous passé est terminé ou annulé, un rendez-vous à venir réservé, confirmé ou annulé.',
  'a past appointment still « réservé »: refused in French');
select is(public.import_appointment(current_setting('test.row')::jsonb || '{"external_ref": "1234"}', true) -> 'errors' -> 0 ->> 'field',
  'external_ref', 'no GOrendezvous reference: refused');
select is(public.import_appointment(current_setting('test.row')::jsonb || '{"external_ref": "gorendezvous:appt:10", "clients": [{"client_ref": "gorendezvous:501"}, {"client_ref": "gorendezvous:502"}, {"client_ref": "gorendezvous:503"}]}', true)
            -> 'errors' -> 0 ->> 'field',
  'clients', 'three clients: refused');

-- =============================================================================
-- Coming appointments: the pause, the link, the messages
-- =============================================================================
select set_config('test.a4', (public.import_appointment(current_setting('test.row')::jsonb || jsonb_build_object('external_ref', 'gorendezvous:appt:4',
  'starts_at', current_setting('test.f10'), 'video_url', 'https://visio.exemple.test/salle-4'), false) ->> 'id'), true);
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select state, blocks_until - starts_at, video_url, video_status from public.appointments where id = current_setting('test.a4')::uuid $$,
  $$ values ('booked'::text, interval '60 minutes', 'https://visio.exemple.test/salle-4'::text, 'ready'::text) $$,
  'coming: booked, with its pause, its GOrendezvous link ready');
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.a4')::uuid), 0,
  'no confirmation for an import');

-- Pro Deux has Zoom: her imported link stands; one without a link gets its meeting.
select lives_ok($$ select public.store_zoom_connection('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a',
  'zu2', 'za2', 'pro.deux@zoom.test', 'access-2', 'refresh-2', now() + interval '1 hour', array['meeting:write']) $$, 'Pro Deux connects Zoom');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.a5', (public.import_appointment(current_setting('test.row')::jsonb || jsonb_build_object('external_ref', 'gorendezvous:appt:5',
  'professional_id', 'c0000000-0000-0000-0000-000000000002', 'starts_at', current_setting('test.f10'),
  'video_url', 'https://visio.exemple.test/salle-5'), false) ->> 'id'), true);
select set_config('test.a6', (public.import_appointment(current_setting('test.row')::jsonb || jsonb_build_object('external_ref', 'gorendezvous:appt:6',
  'professional_id', 'c0000000-0000-0000-0000-000000000002', 'starts_at', current_setting('test.f11')), false) ->> 'id'), true);
reset role;
select results_eq($$ select a.video_status, (select count(*)::int from public.video_tasks t where t.appointment_id = a.id)
                       from public.appointments a where a.id = current_setting('test.a5')::uuid $$,
  $$ values ('ready'::text, 0) $$, 'with Zoom: the imported link stands, no Zoom task over it');
select results_eq($$ select a.video_status, (select count(*)::int from public.video_tasks t where t.appointment_id = a.id)
                       from public.appointments a where a.id = current_setting('test.a6')::uuid $$,
  $$ values ('pending'::text, 1) $$, 'with Zoom and no link: its meeting is on its way');

-- =============================================================================
-- Facturation: the imported history is not billed again
-- =============================================================================
-- One appointment made here, completed four days ago (Camille).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, current_setting('test.p4')::timestamptz, current_setting('test.p4')::timestamptz + interval '50 minutes',
        current_setting('test.p4')::timestamptz + interval '50 minutes', 'completed', current_setting('test.p4')::timestamptz + interval '50 minutes');
insert into public.appointment_participants (appointment_id, client_id, org_id, presence)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present');
select results_eq($$ select distinct appointment_id from private.appointments_for_billing('b0000000-0000-0000-0000-00000000000a', now() - interval '30 days', now() + interval '30 days') $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid) $$, 'the morning queue: the appointment made here only');
select is((select count(*)::int from private.client_billable_appointments('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', null)
            where appointment_id in (current_setting('test.a1')::uuid, current_setting('test.a2')::uuid)), 0,
  'the file''s « à facturer »: no imported history …');
select is((select count(*)::int from private.client_billable_appointments('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', null)
            where appointment_id in ('e0000000-0000-0000-0000-000000000001'::uuid, current_setting('test.a4')::uuid)), 2,
  '… but the one made here and the coming imported one');
update public.appointments set cancel_late = true where id = (current_setting('test.r3')::jsonb ->> 'id')::uuid;
select is((select count(*)::int from private.appointments_fee_candidates('b0000000-0000-0000-0000-00000000000a', now() - interval '30 days', now())), 0,
  'cancellation fees: never an imported late cancellation');

-- Reminders: an imported coming appointment gets its reminder from the messages job, as any other
-- (no confirmation went out, so nothing holds it back). Every day a business day, the whole day (to
-- 23:59:59.999999), so the job's pass runs now at any hour; the appointment is tomorrow at noon.
insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour)
values ('b0000000-0000-0000-0000-00000000000a', '{1,2,3,4,5,6,7}', '00:00', '23:59:59.999999', 1, 0)
on conflict (org_id) do update set business_days = excluded.business_days, business_start = excluded.business_start,
  business_end = excluded.business_end, reminder_business_days = 1, reminder_local_hour = 0;
select set_config('test.t1', (((now() at time zone 'America/Toronto')::date + 1 + time '12:00') at time zone 'America/Toronto')::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.a7', (public.import_appointment(current_setting('test.row')::jsonb || jsonb_build_object('external_ref', 'gorendezvous:appt:7',
  'starts_at', current_setting('test.t1')), false) ->> 'id'), true);
reset role;
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.a7')::uuid), 0,
  'tomorrow''s imported appointment: no confirmation at import');
select private.appointments_queue_reminders('b0000000-0000-0000-0000-00000000000a');
select results_eq($$ select kind, channel, status from public.appointment_messages where appointment_id = current_setting('test.a7')::uuid $$,
  $$ values ('reminder'::text, 'email'::text, 'pending'::text) $$, '… but the messages job gives it its reminder, as any appointment');

-- A cancellation made here afterwards is told (only the import's insert is silent).
update public.appointments
   set state = 'cancelled', cancelled_at = now(),
       cancel_reason_id = (select id from public.cancellation_reasons where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'not_specified')
 where id = current_setting('test.a4')::uuid;
set constraints all immediate;
set constraints all deferred;
select is((select count(*)::int from public.appointment_messages where appointment_id = current_setting('test.a4')::uuid and kind = 'cancelled'), 1,
  'cancelled here afterwards: Camille is told');

select * from finish();
rollback;
