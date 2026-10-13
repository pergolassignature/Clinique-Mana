-- Demandes, batch D3b (migration *_demandes_discovery_calls.sql): the counselors' day of discovery
-- calls — the period and the overdue ones, who calls, moved, permissions, clinics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('list_discovery_calls', 'reschedule_demande_task', 'assign_demande_task')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the D3b RPCs: SECURITY DEFINER, authenticated, not anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@dc.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@dc.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u2@dc.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@dc.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère Deux', 'u4@dc.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
insert into public.clients (id, org_id, first_name, last_name, mobile_e164) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Appel', '+15145550111');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- A: a file (her mobile); B: booked on the page (the request's phone); C: a call yesterday never made.
select set_config('test.da', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000001"}')::text, true);
select set_config('test.db', public.create_demande('{"contact_name": "Bruno Page", "contact_phone_e164": "+15145550122", "channel": "booking_page"}')::text, true);
select set_config('test.dc', public.create_demande('{"contact_name": "Chloé Hier", "contact_phone_e164": "+15145550133"}')::text, true);
select set_config('test.ta', public.add_demande_task(current_setting('test.da')::uuid, 'discovery_call', now() + interval '2 hours')::text, true);
select set_config('test.tb', public.add_demande_task(current_setting('test.db')::uuid, 'discovery_call', now() + interval '1 hour')::text, true);
select set_config('test.tc', public.add_demande_task(current_setting('test.dc')::uuid, 'discovery_call', now() - interval '1 day')::text, true);
select public.add_demande_task(current_setting('test.da')::uuid, 'callback', now() + interval '3 hours');
select set_config('test.tx', public.add_demande_task(current_setting('test.da')::uuid, 'discovery_call', now() + interval '4 hours')::text, true);
select public.cancel_demande_task(current_setting('test.da')::uuid, current_setting('test.tx')::uuid);

select results_eq($$ select task_id::text, person_name, phone_e164, booked_online from public.list_discovery_calls(now(), now() + interval '1 day') $$,
  $$ values (current_setting('test.tb'), 'Bruno Page', '+15145550122', true), (current_setting('test.ta'), 'Alice Appel', '+15145550111', false) $$,
  'the day''s calls in time order: the person, the number (the file''s mobile first), booked online; no callback, no cancelled call');
select results_eq($$ select task_id::text from public.list_discovery_calls(now(), now() + interval '1 day', true) order by due_at $$,
  $$ values (current_setting('test.tc')), (current_setting('test.tb')), (current_setting('test.ta')) $$,
  'with the overdue ones: yesterday''s call never made comes first');
select throws_ok($$ select * from public.list_discovery_calls(now(), now() + interval '40 days') $$, '22023', 'Invalid period', 'a month at most');

-- Who calls, moved, done.
select lives_ok(format($$ select public.assign_demande_task(%L, %L, 'a0000000-0000-0000-0000-000000000004') $$,
  current_setting('test.da'), current_setting('test.ta')), 'given to the other counselor');
select is((select assigned_name from public.list_discovery_calls(now(), now() + interval '1 day') where task_id = current_setting('test.ta')::uuid),
  'Conseillère Deux', 'her name on the call');
select throws_ok(format($$ select public.assign_demande_task(%L, %L, 'a0000000-0000-0000-0000-000000000002') $$,
  current_setting('test.da'), current_setting('test.ta')), 'P0001', 'Cette personne ne peut pas traiter les demandes.', 'not to a professional');
select throws_ok(format($$ select public.reschedule_demande_task(%L, %L, now() - interval '2 hours') $$,
  current_setting('test.dc'), current_setting('test.tc')), 'P0001', 'Choisissez un moment à venir.', 'never into the past');
select lives_ok(format($$ select public.reschedule_demande_task(%L, %L, now() + interval '30 hours') $$,
  current_setting('test.dc'), current_setting('test.tc')), 'yesterday''s call moved to tomorrow');
select is_empty($$ select 1 from public.list_discovery_calls(now() - interval '2 days', now(), true) where task_id = current_setting('test.tc')::uuid $$,
  'no longer overdue');
select public.complete_demande_task(current_setting('test.db')::uuid, current_setting('test.tb')::uuid, 'reached');
select results_eq($$ select state, outcome, done_by_name from public.list_discovery_calls(now(), now() + interval '1 day') where task_id = current_setting('test.tb')::uuid $$,
  $$ values ('done', 'reached', 'Conseillère A') $$, 'a call done stays in the day, with its outcome and who');
select throws_ok(format($$ select public.reschedule_demande_task(%L, %L, now() + interval '1 day') $$,
  current_setting('test.db'), current_setting('test.tb')), 'P0001', 'Cette tâche n''est plus ouverte.', 'a call done is not moved');

-- Permissions, clinics.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_discovery_calls(now(), now() + interval '1 day') $$, '42501', null, 'a professional has no calls list');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select * from public.list_discovery_calls(now() - interval '2 days', now() + interval '2 days', true) $$, 'another clinic sees nothing');
select throws_ok(format($$ select public.reschedule_demande_task(%L, %L, now() + interval '1 day') $$,
  current_setting('test.da'), current_setting('test.ta')), 'P0001', 'Cette demande n''existe pas.', 'nor moves one');

select * from finish();
rollback;
