-- Clients' list, « Dernier rendez-vous » (migrations *_appointments_last_visits.sql,
-- *_clients_list_last_visit.sql; A-2, parity audit L17). Covers: the published fact (no role);
-- the last appointment that has begun (a coming one, a cancelled one and a personal one never
-- count; a no-show does); the column; the filters in the clinic's days (within 30 / 90 days, over
-- 90 / 180 / 365 days, never); the sorts (latest first, longest ago first, never last) and their
-- keyset pages; unknown values refused; without appointments.view (Rendez-vous disabled): no
-- value, and a visit sort or filter refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select function_privs_are('private', 'appointments_last_visits', array['uuid'], 'authenticated', array[]::text[], 'appointments_last_visits: no role');

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
-- Anne: 10 days ago, and a coming one. Bruno: 200 days ago, a no-show. Chloé: 400 days ago, and a
-- cancellation yesterday. Denis: never (only a coming one).
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Anne', 'Aubin'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Bédard'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Caron'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Denis', 'Dion');
select set_config('test.s', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, completed_at, cancelled_at, cancel_reason_id)
select x.id::uuid, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.s')::uuid,
       now() - x.ago, now() - x.ago + interval '50 minutes', now() - x.ago + interval '50 minutes', x.state,
       case when x.state = 'completed' then now() - x.ago + interval '50 minutes' end,
       case when x.state = 'cancelled' then now() - interval '3 days' end,
       case when x.state = 'cancelled' then (select r.id from public.cancellation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'not_specified') end
  from (values ('e0000000-0000-0000-0000-000000000001', interval '10 days', 'completed'),
               ('e0000000-0000-0000-0000-000000000002', interval '-10 days', 'booked'),
               ('e0000000-0000-0000-0000-000000000003', interval '200 days', 'booked'),
               ('e0000000-0000-0000-0000-000000000004', interval '400 days', 'completed'),
               ('e0000000-0000-0000-0000-000000000005', interval '1 day', 'cancelled'),
               ('e0000000-0000-0000-0000-000000000006', interval '-20 days', 'booked')) as x(id, ago, state);
insert into public.appointment_participants (appointment_id, client_id, org_id, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'expected'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'absent'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'present'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'expected'),
  ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'expected');

select results_eq($$ select client_id, now() - last_at from private.appointments_last_visits('b0000000-0000-0000-0000-00000000000a') order by client_id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, interval '10 days'), ('d0000000-0000-0000-0000-000000000002'::uuid, interval '200 days'),
            ('d0000000-0000-0000-0000-000000000003'::uuid, interval '400 days') $$,
  'the fact: the last that has begun (a no-show counts; a coming, a cancelled one never)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select first_name, now() - last_visit_at from public.list_clients() $$,
  $$ values ('Anne', interval '10 days'), ('Bruno', interval '200 days'), ('Chloé', interval '400 days'), ('Denis', null::interval) $$,
  'the column, in name order');
select results_eq($$ select first_name from public.list_clients(p_last_visit => 'within_30') $$, array['Anne'], 'within 30 days');
select results_eq($$ select first_name from public.list_clients(p_last_visit => 'within_90') $$, array['Anne'], 'within 90 days');
select results_eq($$ select first_name from public.list_clients(p_last_visit => 'over_90') $$, array['Bruno', 'Chloé'], 'over 90 days ago');
select results_eq($$ select first_name from public.list_clients(p_last_visit => 'over_365') $$, array['Chloé'], 'over a year ago');
select results_eq($$ select first_name from public.list_clients(p_last_visit => 'never') $$, array['Denis'], 'never');
select results_eq($$ select first_name from public.list_clients(p_sort => 'visit_recent') $$, array['Anne', 'Bruno', 'Chloé', 'Denis'], 'the latest first, never last');
select results_eq($$ select first_name from public.list_clients(p_sort => 'visit_oldest') $$, array['Chloé', 'Bruno', 'Anne', 'Denis'], 'the longest ago first, never last');
select results_eq($$ select first_name from public.list_clients(p_sort => 'visit_oldest', p_limit => 2) $$, array['Chloé', 'Bruno'], 'a page of two');
select results_eq($$ select first_name from public.list_clients(p_sort => 'visit_oldest',
                       p_after_visit => (select sort_visit from public.list_clients(p_sort => 'visit_oldest') where first_name = 'Bruno'),
                       p_after_last => 'bedard', p_after_first => 'bruno', p_after_id => 'd0000000-0000-0000-0000-000000000002') $$,
  array['Anne', 'Denis'], 'the next page after its cursor (never included)');
select throws_ok($$ select * from public.list_clients(p_sort => 'random') $$, '22023', null, 'an unknown sort');
select throws_ok($$ select * from public.list_clients(p_last_visit => 'demain') $$, '22023', null, 'an unknown filter');

-- Rendez-vous disabled: no appointments.view, no value; a visit filter or sort refused.
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(last_visit_at)::int from public.list_clients()), 0, 'Rendez-vous disabled: no last appointment shown');
select throws_ok($$ select * from public.list_clients(p_sort => 'visit_recent') $$, '42501', 'Permission refusée : appointments.view', '… and a visit sort refused');
select throws_ok($$ select * from public.list_clients(p_last_visit => 'never') $$, '42501', 'Permission refusée : appointments.view', '… and a visit filter refused');
reset role;

select * from finish();
rollback;
