-- Rendez-vous, availability by direct manipulation (migration *_appointments_availability_windows):
-- set_availability_window. Covers: privileges; a new window with the defaults (every service,
-- visible, no overflow, weekly); a compatible window touching or overlapping merges (a chain too)
-- and lists what it absorbed; a window with other settings overlapping is refused, touching is
-- kept apart; the time it adds may not cover the shown week's exception (one inside it is fine); a
-- move (weekday, times) returns the previous row; shrinking counts the coming appointments left
-- outside; « Seulement cette semaine »; the professional on her own windows only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select function_privs_are('public', 'set_availability_window',
  array['uuid', 'uuid', 'integer', 'time without time zone', 'time without time zone', 'date', 'date', 'date'],
  'authenticated', array['EXECUTE'], 'set_availability_window: authenticated');
select function_privs_are('public', 'set_availability_window',
  array['uuid', 'uuid', 'integer', 'time without time zone', 'time without time zone', 'date', 'date', 'date'],
  'anon', array[]::text[], 'set_availability_window: not anon');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@aw.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@aw.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@aw.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@aw.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@aw.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@aw.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, sex, birthday) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai', 'female', '1990-01-01');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);

-- The conseillère (appointments.manage) on P1. The week shown: Monday 2027-03-15.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.mon', public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 1, '09:00', '12:00', '{}', true, false, '2026-10-01', null)::text, true);

-- A new window: the defaults.
select set_config('test.w', public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 3, '13:00', '15:00', '2027-03-15', null, '2027-03-15')::text, true);
select is(current_setting('test.w')::jsonb ->> 'previous', null, 'new: no previous row');
reset role;
select results_eq(format($$ select weekday::int, start_time, end_time, service_ids, visible_to_clients, overflow_allowed, valid_from, valid_until
                              from public.availability_rules where id = %L $$, current_setting('test.w')::jsonb ->> 'id'),
  $$ values (3, time '13:00', time '15:00', '{}'::uuid[], true, false, date '2027-03-15', null::date) $$,
  'new: every service, visible, no overflow, weekly from the week shown');

-- Touching a compatible window: one window, from the earliest validity; what it absorbed is listed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.m', public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 1, '12:00', '14:00', '2027-03-15', null, '2027-03-15')::text, true);
select is((current_setting('test.m')::jsonb ->> 'start_time') || '–' || (current_setting('test.m')::jsonb ->> 'end_time'), '09:00:00–14:00:00', 'touching: merged 9:00–14:00');
select is(jsonb_array_length(current_setting('test.m')::jsonb -> 'absorbed'), 1, '… one window absorbed');
select is(current_setting('test.m')::jsonb -> 'absorbed' -> 0 ->> 'start_time', '09:00:00', '… listed for « Annuler »');
reset role;
select results_eq($$ select count(*)::int, min(valid_from) from public.availability_rules where professional_id = 'c0000000-0000-0000-0000-000000000001' and weekday = 1 $$,
  $$ values (1, date '2026-10-01') $$, '… one Monday window, valid from the earliest');

-- A chain: 9:00–10:00 and 11:00–12:00, then 9:30–11:00 → one 9:00–12:00.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 5, '09:00', '10:00', '2027-03-15', null, null);
select public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 5, '11:00', '12:00', '2027-03-15', null, null);
select is(jsonb_array_length(public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 5, '09:30', '11:00', '2027-03-15', null, null) -> 'absorbed'),
  2, 'a chain: both absorbed');
reset role;
select results_eq($$ select start_time, end_time from public.availability_rules where professional_id = 'c0000000-0000-0000-0000-000000000001' and weekday = 5 $$,
  $$ values (time '09:00', time '12:00') $$, '… one Friday window 9:00–12:00');

-- Other settings: overlapping refused, touching kept apart.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 2, '09:00', '12:00', array[current_setting('test.s50')::uuid], true, false, '2026-10-01', null);
select throws_ok($$ select public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 2, '11:00', '13:00', '2027-03-15', null, null) $$,
  'P0001', 'Cette plage chevauche une plage aux réglages différents (services, visibilité ou validité) : modifiez-la avec « Plus d''options… ».',
  'other settings, overlapping: refused');
select is(jsonb_array_length(public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 2, '12:00', '13:00', '2027-03-15', null, null) -> 'absorbed'),
  0, 'other settings, touching: kept apart');

-- The week shown has an exception: refused (Thursday 2027-03-18 10:00–11:00 in Montréal, EDT).
select public.add_availability_exception('c0000000-0000-0000-0000-000000000001', 'other', '2027-03-18 14:00Z', '2027-03-18 15:00Z', null);
select throws_ok($$ select public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 4, '09:00', '12:00', '2027-03-15', null, '2027-03-15') $$,
  'P0001', 'Ce moment est bloqué (vacances, congé ou autre absence) : retirez d''abord le blocage.', 'over the week''s exception: refused');

-- A move: the Wednesday window to Thursday 13:00–16:00; the previous row comes back.
select set_config('test.mv', public.set_availability_window((current_setting('test.w')::jsonb ->> 'id')::uuid, 'c0000000-0000-0000-0000-000000000001', 4, '13:00', '16:00',
  '2027-03-15', null, '2027-03-15')::text, true);
select is((current_setting('test.mv')::jsonb -> 'previous' ->> 'weekday') || ' ' || (current_setting('test.mv')::jsonb -> 'previous' ->> 'start_time'), '3 13:00:00',
  'a move: the previous row');

-- Shrinking: an appointment Thursday 2027-03-18 15:00 (in 13:00–16:00) left outside by 13:00–15:00.
select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-18 19:00Z',
  array['d0000000-0000-0000-0000-000000000001'::uuid]);
select is((public.set_availability_window((current_setting('test.w')::jsonb ->> 'id')::uuid, 'c0000000-0000-0000-0000-000000000001', 4, '13:00', '15:00',
  '2027-03-15', null, '2027-03-15') ->> 'outside_count')::int, 1, 'shrinking: one coming appointment left outside');
select is((public.set_availability_window((current_setting('test.w')::jsonb ->> 'id')::uuid, 'c0000000-0000-0000-0000-000000000001', 4, '13:00', '16:00',
  '2027-03-15', null, '2027-03-15') ->> 'outside_count')::int, 0, 'growing back: none');

-- « Seulement cette semaine ».
select is(public.set_availability_window((current_setting('test.w')::jsonb ->> 'id')::uuid, 'c0000000-0000-0000-0000-000000000001', 4, '13:00', '16:00',
  '2027-03-15', '2027-03-21', '2027-03-15') ->> 'valid_until', '2027-03-21', 'only this week');
-- The time added may not cover the exception; one inside the window never stops it from changing.
select throws_ok(format($$ select public.set_availability_window(%L, 'c0000000-0000-0000-0000-000000000001', 4, '09:00', '16:00', '2027-03-15', '2027-03-21', '2027-03-15') $$,
  current_setting('test.w')::jsonb ->> 'id'),
  'P0001', 'Ce moment est bloqué (vacances, congé ou autre absence) : retirez d''abord le blocage.', 'growing over the exception: refused');
select public.add_availability_exception('c0000000-0000-0000-0000-000000000001', 'other', '2027-03-18 18:00Z', '2027-03-18 18:30Z', null);
select lives_ok(format($$ select public.set_availability_window(%L, 'c0000000-0000-0000-0000-000000000001', 4, '13:00', '15:30', '2027-03-15', '2027-03-21', '2027-03-15') $$,
  current_setting('test.w')::jsonb ->> 'id'), 'an exception inside the window: it still changes');
select throws_ok($$ select public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 6, '09:07', '12:00', null, null, null) $$,
  'P0001', 'Les heures d''une plage tombent sur un multiple de 5 minutes.', 'five-minute marks');

-- The professional: her own windows, nobody else's.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000001', 6, '09:00', '12:00', null, null, null) ->> 'id' is not null, 'the professional: her own');
select throws_ok($$ select public.set_availability_window(null, 'c0000000-0000-0000-0000-000000000002', 6, '09:00', '12:00', null, null, null) $$,
  '42501', null, '… not another''s');
reset role;

select * from finish();
rollback;
