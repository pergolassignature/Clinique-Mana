-- Rendez-vous, batch R5 (migration *_appointments_publications.sql).
-- Covers: privileges; « Mon agenda »'s reference (her file, the services she offers, staff
-- refused); a client's visits (staff all, a professional her own with a linked client, held ones
-- never, the keyset); the publications for Facturation and Demandes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select function_privs_are('public', 'get_my_agenda_reference', array[]::text[], 'authenticated', array['EXECUTE'], 'get_my_agenda_reference');
select function_privs_are('public', 'list_client_visits', array['uuid', 'timestamp with time zone', 'integer'], 'authenticated', array['EXECUTE'], 'list_client_visits');
select function_privs_are('private', f, a, 'authenticated', array[]::text[], f || ': no role')
  from (values ('appointments_for_billing', array['uuid', 'timestamp with time zone', 'timestamp with time zone']),
               ('first_appointments', array['uuid', 'uuid[]'])) as x(f, a);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- Alice: one completed with P1, one late-cancelled with P2, one booked with P1, one held with P2.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at, cancelled_at, cancel_late, held_until)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2026-09-07 14:00Z', '2026-09-07 14:50Z', '2026-09-07 15:00Z', 'completed', '2026-09-07 15:20Z', null, null, null),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.s50')::uuid,
   '2026-09-14 14:00Z', '2026-09-14 14:50Z', '2026-09-14 15:00Z', 'cancelled', null, '2026-09-14 10:00Z', true, null),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
   '2027-03-15 13:00Z', '2027-03-15 13:50Z', '2027-03-15 14:00Z', 'booked', null, null, null, null),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.s50')::uuid,
   '2027-03-16 13:00Z', '2027-03-16 13:50Z', '2027-03-16 14:00Z', 'held', null, null, null, now() + interval '1 day');
insert into public.appointment_participants (appointment_id, client_id, org_id, presence)
select x, 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', case when x = 'e0000000-0000-0000-0000-000000000001'::uuid then 'present' else 'expected' end
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid), ('e0000000-0000-0000-0000-000000000002'::uuid),
               ('e0000000-0000-0000-0000-000000000003'::uuid), ('e0000000-0000-0000-0000-000000000004'::uuid)) as v(x);
select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'appointment');

set local role authenticated;
-- « Mon agenda ».
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select x -> 'professional' ->> 'id', x -> 'professional' ->> 'display_name',
                            (select bool_or((s ->> 'code')::int = 10150) from pg_catalog.jsonb_array_elements(x -> 'services') s)
                       from public.get_my_agenda_reference() x $$,
  $$ values ('c0000000-0000-0000-0000-000000000001', 'Pro Un', true) $$, '« Mon agenda »: her file and the services she offers');
-- Visits: the professional, her own.
select results_eq($$ select id, state, presence from public.list_client_visits('d0000000-0000-0000-0000-000000000001') $$,
  $$ values ('e0000000-0000-0000-0000-000000000003'::uuid, 'booked'::text, 'expected'::text),
            ('e0000000-0000-0000-0000-000000000001', 'completed', 'present') $$,
  'a professional: her own appointments with a linked client, newest first');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.get_my_agenda_reference() $$, '42501', 'Permission refusée : appointments.self', 'the staff have no « Mon agenda »');
select results_eq($$ select id, professional_name, service_code, cancel_reason is null, cancel_late from public.list_client_visits('d0000000-0000-0000-0000-000000000001') $$,
  $$ values ('e0000000-0000-0000-0000-000000000003'::uuid, 'Pro Un'::text, 10150, true, null::boolean),
            ('e0000000-0000-0000-0000-000000000002', 'Pro Deux', 10150, true, true),
            ('e0000000-0000-0000-0000-000000000001', 'Pro Un', 10150, true, null) $$,
  'the staff: every appointment but the held one, with the professional and the service');
select results_eq($$ select id from public.list_client_visits('d0000000-0000-0000-0000-000000000001', '2026-10-01 00:00Z', 1) $$,
  $$ values ('e0000000-0000-0000-0000-000000000002'::uuid) $$, '… paged before a start');
reset role;
-- A professional not linked to the client.
update public.professionals set profile_id = null where id = 'c0000000-0000-0000-0000-000000000001';
update public.professionals set profile_id = 'a0000000-0000-0000-0000-000000000003' where id = 'c0000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_client_visits('d0000000-0000-0000-0000-000000000001') $$,
  '42501', 'Permission refusée : appointments.view', 'a professional not linked to the client reads nothing');
reset role;

-- Published.
select results_eq($$ select appointment_id, state, presence, cancel_late from private.appointments_for_billing('b0000000-0000-0000-0000-00000000000a', '2026-09-01', '2026-10-01') $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 'completed'::text, 'present'::text, null::boolean),
            ('e0000000-0000-0000-0000-000000000002', 'cancelled', 'expected', true) $$,
  'Facturation: the completed appointments and the late cancellations, per client');
select results_eq($$ select appointment_id, confirmed from private.first_appointments('b0000000-0000-0000-0000-00000000000a', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, true) $$, 'Demandes: her first active appointment');
select is((select count(*)::int from private.first_appointments('b0000000-0000-0000-0000-00000000000a', array['d0000000-0000-0000-0000-000000000009'::uuid])), 0,
  '… none for a client without one');

select * from finish();
rollback;
