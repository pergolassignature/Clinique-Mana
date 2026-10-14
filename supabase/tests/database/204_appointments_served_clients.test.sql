-- Rendez-vous, R-87 (migration *_appointments_served_clients): who an appointment served.
-- Covers: granted to no role; the participants in order (the person seen first); an absent one
-- left out; another clinic's org answers nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select function_privs_are('private', 'appointment_served_client_ids', array['uuid', 'uuid[]'], 'authenticated', array[]::text[],
  'appointment_served_client_ids: not for users');
select function_privs_are('private', 'appointment_served_client_ids', array['uuid', 'uuid[]'], 'service_role', array[]::text[],
  'appointment_served_client_ids: not for the service role');

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai');
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state)
select x.id, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
       (select id from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150),
       now() - x.d * interval '1 day', now() - x.d * interval '1 day' + interval '50 minutes',
       now() - x.d * interval '1 day' + interval '60 minutes', 'booked'
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid, 2), ('e0000000-0000-0000-0000-000000000002'::uuid, 3)) as x(id, d);
insert into public.appointment_participants (appointment_id, client_id, org_id, presence, role) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'present', 'second'),
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present', 'client'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'absent', 'second');

select is((select s.client_ids from private.appointment_served_client_ids('b0000000-0000-0000-0000-00000000000a',
             array['e0000000-0000-0000-0000-000000000001']::uuid[]) s),
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[],
  'both present: both, the person seen first first');
select is((select s.client_ids from private.appointment_served_client_ids('b0000000-0000-0000-0000-00000000000a',
             array['e0000000-0000-0000-0000-000000000002']::uuid[]) s),
  array['d0000000-0000-0000-0000-000000000001']::uuid[], 'an absent participant is left out');
select is_empty($$ select 1 from private.appointment_served_client_ids('b0000000-0000-0000-0000-00000000000b',
                     array['e0000000-0000-0000-0000-000000000001']::uuid[]) $$, 'another clinic: nothing');

select * from finish();
rollback;
