-- Rendez-vous, batch R3 (migration *_appointments_series.sql): series, personal appointments,
-- completion.
-- Covers: privileges; preview_series (local time across the March change, an overlap, an
-- exception, an end by date); create_series (the rule's refusals, a client refusal is the
-- series', conflicts refused with their dates then skipped and kept, every date booked at 9:00
-- local, the series in list_agenda); cancel_series_from; book_personal_appointment (her own only,
-- overlaps, the end); the completion job (a no-show left, presence taking a completed one back);
-- the job's catalogue row.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

select function_privs_are('public', f, a, 'authenticated', array['EXECUTE'], f)
  from (values ('preview_series', array['uuid', 'uuid', 'timestamp with time zone', 'integer', 'integer[]', 'integer', 'date']),
               ('create_series', array['uuid', 'uuid', 'timestamp with time zone', 'integer', 'integer[]', 'integer', 'date', 'uuid[]', 'text', 'text', 'text', 'boolean', 'text', 'text']),
               ('cancel_series_from', array['uuid', 'text', 'text', 'boolean']),
               ('book_personal_appointment', array['timestamp with time zone', 'timestamp with time zone', 'text', 'boolean']),
               ('list_agenda', array['timestamp with time zone', 'timestamp with time zone', 'uuid[]'])) as x(f, a);
select function_privs_are('private', 'job_appointments_mark_completed', array[]::text[], 'service_role', array[]::text[], 'the job: no role');

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
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
-- P1 works Mondays 9:00–12:00; Marc already has Monday 2027-03-29 at 9:00; P1 is away 2027-04-12.
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', 1, '09:00', '12:00', '{}', true, false, '2026-10-01', null);
select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-29 13:00Z',
  array['d0000000-0000-0000-0000-000000000002'::uuid]);
select public.add_availability_exception('c0000000-0000-0000-0000-000000000001', 'vacation', '2027-04-12 04:00Z', '2027-04-13 04:00Z', null);

-- Every 2 weeks × 10 from Monday 2027-03-01 at 9:00 (14:00Z before the change, 13:00Z after).
select results_eq($$ select occurrence, starts_at, conflict from public.preview_series('c0000000-0000-0000-0000-000000000001',
                      current_setting('test.s50')::uuid, '2027-03-01 14:00Z', 2, array[1], 10) where occurrence <= 5 $$,
  $$ values (1, '2027-03-01 14:00Z'::timestamptz, null::text), (2, '2027-03-15 13:00Z', null), (3, '2027-03-29 13:00Z', 'overlap'),
            (4, '2027-04-12 13:00Z', 'outside_availability'), (5, '2027-04-26 13:00Z', null) $$,
  'the preview: 9:00 local across the change, an overlap, an exception');
select is((select count(*)::int from public.preview_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
            '2027-03-01 14:00Z', 2, array[1], 10)), 10, '… ten dates');
select is((select count(*)::int from public.preview_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
            '2027-03-01 14:00Z', 1, array[1], null, '2027-03-22')), 4, 'weekly until a date: four Mondays');

-- The rule's refusals.
select throws_ok($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  13, array[1], 10, null, array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Une série se répète chaque semaine ou aux 2 à 12 semaines.', 'an interval of 1 to 12 weeks');
select throws_ok($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  2, array[]::int[], 10, null, array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Choisissez les jours de la série.', 'weekdays required');
select throws_ok($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  2, array[1], null, null, array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Choisissez le nombre de rendez-vous ou la date de fin de la série.', 'a count or an end');
select throws_ok($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  2, array[1], 1, null, array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Une série compte de 2 à 52 rendez-vous.', '2 to 52 appointments');
select throws_ok($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  2, array[1], 10, null, array[]::uuid[]) $$,
  'P0001', 'Choisissez le client du rendez-vous.', 'a client refusal is the series''');
-- Conflicts: refused with the dates, nothing booked.
select throws_like($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  2, array[1], 10, null, array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  '2 dates de la série sont en conflit : 29 mars 2027, 12 avr. 2027.%', 'two conflicts: refused with their dates');
reset role;
select is((select count(*)::int from public.appointment_series), 0, '… and nothing kept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
-- … skipped on request.
select set_config('test.series', public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-01 14:00Z',
  2, array[1], 10, null, array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, true)::text, true);
reset role;
select results_eq($$ select interval_weeks, weekdays, occurrences, skipped_on, created_by from public.appointment_series where id = current_setting('test.series')::uuid $$,
  $$ values (2::smallint, '{1}'::smallint[], 10::smallint, '{2027-03-29,2027-04-12}'::date[], 'a0000000-0000-0000-0000-000000000004'::uuid) $$,
  'the series, its two skipped dates kept');
select is((select count(*)::int from public.appointments where series_id = current_setting('test.series')::uuid), 8, 'eight appointments booked');
select is((select array_agg(distinct pg_catalog.to_char(starts_at at time zone 'America/Toronto', 'ID HH24:MI'))
             from public.appointments where series_id = current_setting('test.series')::uuid), array['1 09:00'], '… every one on Monday at 9:00 local');
select is((select count(*)::int from public.appointment_participants p join public.appointments a on a.id = p.appointment_id
            where a.series_id = current_setting('test.series')::uuid and p.client_id = 'd0000000-0000-0000-0000-000000000001'), 8, '… each with Alice');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.list_agenda('2027-03-01 00:00Z', '2027-04-01 00:00Z') where series_id = current_setting('test.series')::uuid), 2,
  'the agenda shows the series');

-- Cancel from 2027-04-26: that one and the five after.
select set_config('test.from', (select id::text from public.appointments where series_id = current_setting('test.series')::uuid and starts_at = '2027-04-26 13:00Z'), true);
select is(public.cancel_series_from(current_setting('test.from')::uuid, 'not_specified'), 6, 'cancel from the fifth date: six cancelled');
reset role;
select results_eq($$ select state, count(*)::int from public.appointments where series_id = current_setting('test.series')::uuid group by state order by state $$,
  $$ values ('booked'::text, 2), ('cancelled', 6) $$, '… the two before kept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_series_from(current_setting('test.from')::uuid, 'not_specified') $$,
  'P0001', 'Ce rendez-vous est déjà annulé ou terminé.', 'nothing left to cancel from there');
select throws_ok($$ select public.cancel_series_from((select id from public.appointments where starts_at = '2027-03-29 13:00Z'), 'not_specified') $$,
  'P0001', 'Ce rendez-vous ne fait pas partie d''une série.', 'a single appointment is not a series');

-- Personal appointments: the professional's own.
select throws_ok($$ select public.book_personal_appointment('2027-03-02 15:00Z', '2027-03-02 16:00Z', 'Dentiste') $$,
  '42501', 'Permission refusée : appointments.self', 'the staff never book a personal appointment');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.personal', public.book_personal_appointment('2027-03-02 15:00Z', '2027-03-02 16:00Z', '  Dentiste ', true)::text, true);
reset role;
select results_eq($$ select professional_id, is_personal, is_work, personal_label, service_id, blocks_until from public.appointments where id = current_setting('test.personal')::uuid $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, true, true, 'Dentiste'::text, null::uuid, '2027-03-02 16:00Z'::timestamptz) $$,
  'her personal appointment, outside her availability, on her agenda');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.book_personal_appointment('2027-03-02 15:30Z', '2027-03-02 16:30Z', null) $$,
  'P0001', 'Vous avez déjà un rendez-vous sur ce créneau (pause après comprise).', 'never over another appointment');
select throws_ok($$ select public.book_personal_appointment('2027-03-02 17:00Z', '2027-03-02 17:00Z', null) $$,
  'P0001', 'La fin tombe après le début, sur un multiple de 5 minutes, dans les 12 heures.', 'an end after the start');
select throws_ok($$ select public.book_personal_appointment('2027-03-15 13:30Z', '2027-03-15 14:00Z', null) $$,
  'P0001', 'Vous avez déjà un rendez-vous sur ce créneau (pause après comprise).', '… nor over a series date');
reset role;

-- Completion: two past appointments, one with Alice expected, one with Marc absent.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, now() - interval '3 hours', now() - interval '2 hours 10 minutes', now() - interval '2 hours'),
       ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, now() - interval '6 hours', now() - interval '5 hours 10 minutes', now() - interval '5 hours'),
       ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s50')::uuid, now() - interval '30 minutes', now() + interval '20 minutes', now() + interval '30 minutes');
insert into public.appointment_participants (appointment_id, client_id, org_id, presence) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'expected'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'absent'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'expected');
select alike(private.job_appointments_mark_completed(), 'completed=%', 'the job runs');
select results_eq($$ select id, state, completed_at is not null from public.appointments where id::text like 'e0000000-0000-0000-0000-00000000000%' order by id $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid, 'completed'::text, true), ('e0000000-0000-0000-0000-000000000002', 'booked', false),
            ('e0000000-0000-0000-0000-000000000003', 'booked', false) $$,
  'past → completed; a no-show and one still running left');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.set_appointment_presence('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'absent') $$,
  'Alice noted absent afterwards');
reset role;
select results_eq($$ select state, completed_at from public.appointments where id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('booked'::text, null::timestamptz) $$, '… a no-show: back to booked');
select is(private.job_appointments_mark_completed(), 'completed=0', '… which the next pass leaves');
select results_eq($$ select j.module_key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
                       from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
                      where j.key = 'appointments.mark_completed' $$,
  $$ values ('appointments'::text, 'sql'::text, 'private.job_appointments_mark_completed'::text, true, '20 * * * *'::text,
             'select private.run_sql_job(''appointments.mark_completed'')'::text) $$,
  'the job is catalogued and runs hourly');

select * from finish();
rollback;
