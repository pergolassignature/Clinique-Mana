-- Rendez-vous, batch R1b (migration *_appointments_holds.sql): held appointments.
-- Covers: privileges (the service helpers granted to no role); a hold: its row, its actor in the
-- audit, no client link yet, the slot taken (a booking, another hold, the open slots), the
-- availability required, the expiry's bounds, an unknown actor; the staff's RPCs refuse it; the
-- agenda shows it; confirm checks again (an exception since, the balance rule) and books it (the
-- client linked, the consents read); release frees the slot (the reason in the audit's source);
-- expiry (confirm refused, the job releases, a new hold clears a stale one); anonymisation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

select function_privs_are('private', f, a, r, array[]::text[], f || ': no ' || r)
  from (values ('appointments_hold', array['uuid', 'uuid', 'uuid', 'timestamp with time zone', 'uuid[]', 'timestamp with time zone', 'uuid', 'uuid', 'text']),
               ('appointments_confirm_hold', array['uuid', 'uuid', 'uuid']),
               ('appointments_release_hold', array['uuid', 'uuid', 'text'])) as x(f, a)
 cross join (values ('authenticated'), ('service_role')) as y(r);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Other B',       'other@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);

-- P1 works Monday and Tuesday 9:00–12:00 (13:00Z–16:00Z in March 2027, after the change).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '09:00', '12:00', '{}', true, false, '2026-10-01', null)
  from (values (1), (2)) as w(d);
reset role;

-- A hold (Demandes' proposal, Monday 9:00, for a week).
select set_config('test.h1', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 13:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], now() + interval '7 days',
  'a0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001')::text, true);
select results_eq($$ select state, held_until > now(), hold_reference, created_by, ends_at, blocks_until from public.appointments where id = current_setting('test.h1')::uuid $$,
  $$ values ('held'::text, true, 'f0000000-0000-0000-0000-000000000001'::uuid, 'a0000000-0000-0000-0000-000000000004'::uuid,
             '2027-03-15 13:50Z'::timestamptz, '2027-03-15 14:00Z'::timestamptz) $$, 'a held appointment, its expiry, its proposal and its actor');
select is((select actor_id from public.audit_log where table_name = 'appointments' and record_id = current_setting('test.h1') and action = 'insert'),
  'a0000000-0000-0000-0000-000000000004'::uuid, '… the actor named in the audit');
select is((select count(*)::int from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000001'), 0,
  '… and the client not linked to the professional yet');

-- The slot is taken.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 13:30Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'a hold blocks a booking over it');
select is((select count(*)::int from public.get_open_slots('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid, '2027-03-15', '2027-03-15')
            where starts_at = '2027-03-15 13:00Z'), 0, '… and is not an open slot');
select results_eq($$ select state from public.list_agenda('2027-03-15 00:00Z', '2027-03-16 00:00Z') where id = current_setting('test.h1')::uuid $$,
  $$ values ('held'::text) $$, 'the agenda shows it as held');
-- The staff's RPCs leave it to the proposal.
select throws_ok($$ select public.move_appointment(current_setting('test.h1')::uuid, '2027-03-15 14:00Z') $$,
  'P0001', 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.', 'a held appointment does not move');
select throws_ok($$ select public.cancel_appointment(current_setting('test.h1')::uuid, 'not_specified') $$,
  'P0001', 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.', '… is not cancelled');
select throws_ok($$ select public.set_appointment_presence(current_setting('test.h1')::uuid, 'd0000000-0000-0000-0000-000000000001', 'present') $$,
  'P0001', 'Ce créneau est proposé au client et attend son acceptation : il se gère depuis la demande.', '… takes no presence');
select lives_ok($$ select * from public.get_appointment_consents(current_setting('test.h1')::uuid) $$, '… and its consents read');
reset role;

select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 13:30Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 day',
  'a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'a hold blocks another hold');
select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 20:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 day',
  'a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'a hold lies in the availability (no override)');
select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() - interval '1 minute',
  'a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'La proposition expire après maintenant et au plus tard au début du rendez-vous.', 'an expiry in the past is refused');
select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], '2027-03-15 15:00Z',
  'a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'La proposition expire après maintenant et au plus tard au début du rendez-vous.', '… and one after the start');
select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 day',
  'a0000000-0000-0000-0000-000000000009') $$,
  '22023', 'Unknown actor for this clinic', 'the actor belongs to the clinic');

-- Confirm checks every rule again. H2 (Monday 10:00), then an exception covers it.
select set_config('test.h2', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-15 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 day', null)::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.x', public.add_availability_exception('c0000000-0000-0000-0000-000000000001', 'other', '2027-03-15 14:00Z', '2027-03-15 15:00Z', null)::text, true);
reset role;
select throws_ok($$ select private.appointments_confirm_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h2')::uuid, null) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'confirm: the availability checked again');
select is((select state from public.appointments where id = current_setting('test.h2')::uuid), 'held', '… the hold kept');

-- The balance rule at confirm (Facturation's stub answering « owes money » for Alice).
create or replace function private.client_has_balance(p_org uuid, p_client_id uuid) returns boolean
language sql stable set search_path = '' as $$ select p_client_id = 'd0000000-0000-0000-0000-000000000001'::uuid $$;
select throws_ok($$ select private.appointments_confirm_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h1')::uuid, 'a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Ce client a un solde dû : il faut le régler, ou une exception approuvée, avant un nouveau rendez-vous.', 'confirm: the balance rule, no exception');
select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-16 15:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], now() + interval '1 day', null) $$,
  'P0001', 'Ce client a un solde dû : il faut le régler, ou une exception approuvée, avant un nouveau rendez-vous.', 'hold: the balance rule too');
create or replace function private.client_has_balance(p_org uuid, p_client_id uuid) returns boolean
language sql stable set search_path = '' as $$ select false $$;

-- Accepted: booked, the client linked, the consents read (never blocking, R-47).
select lives_ok($$ select private.appointments_confirm_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h1')::uuid, 'a0000000-0000-0000-0000-000000000004') $$,
  'the client accepts');
select results_eq($$ select state, held_until, hold_reference from public.appointments where id = current_setting('test.h1')::uuid $$,
  $$ values ('booked'::text, null::timestamptz, 'f0000000-0000-0000-0000-000000000001'::uuid) $$, '… booked, the proposal kept');
select is((select count(*)::int from public.client_professional_links
            where client_id = 'd0000000-0000-0000-0000-000000000001' and professional_id = 'c0000000-0000-0000-0000-000000000001'), 1,
  '… the client linked to the professional');
select is((select source from public.audit_log where table_name = 'appointments' and record_id = current_setting('test.h1') and action = 'update'
            order by id desc limit 1), 'rpc:appointments_confirm_hold', '… under its own source');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select * from public.get_appointment_consents(current_setting('test.h1')::uuid) $$, '… its consents read as a booked one');
reset role;
select throws_ok($$ select private.appointments_confirm_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h1')::uuid, null) $$,
  'P0001', 'Ce créneau n''est plus réservé pour cette proposition.', 'a second accept is refused');
select is(private.appointments_release_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h1')::uuid, 'withdrawn'), false,
  'a booked appointment is never released');
select throws_ok($$ select private.appointments_release_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h2')::uuid, 'because') $$,
  '22023', 'Unknown hold release reason', 'a release names a known reason');

-- Release frees the slot.
select is(private.appointments_release_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h2')::uuid, 'other_accepted'), true, 'H2 released');
select is((select count(*)::int from public.appointments where id = current_setting('test.h2')::uuid), 0, '… deleted, its participants with it');
select is((select source from public.audit_log where table_name = 'appointments' and record_id = current_setting('test.h2') and action = 'delete'),
  'rpc:appointments_release_hold:other_accepted', '… the reason in the audit''s source');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.remove_availability_exception(current_setting('test.x')::uuid) $$, 'the exception removed');
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  '2027-03-15 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$, '… and the freed slot booked');
reset role;

-- Expiry: H4 (Tuesday 9:00) past its expiry.
select set_config('test.h4', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-16 13:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 hour', null)::text, true);
update public.appointments set held_until = now() - interval '1 second' where id = current_setting('test.h4')::uuid;
select throws_ok($$ select private.appointments_confirm_hold('b0000000-0000-0000-0000-00000000000a', current_setting('test.h4')::uuid, null) $$,
  'P0001', 'La proposition a expiré : ce créneau n''est plus réservé.', 'an expired hold is not accepted');
select is(private.job_appointments_holds_release(), 'released=1', 'the job releases it');
select is((select count(*)::int from public.appointments where id = current_setting('test.h4')::uuid), 0, '… the slot free');
select results_eq($$ select j.module_key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
                       from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
                      where j.key = 'appointments.holds_release' $$,
  $$ values ('appointments'::text, 'sql'::text, 'private.job_appointments_holds_release'::text, true, '*/5 * * * *'::text,
             'select private.run_sql_job(''appointments.holds_release'')'::text) $$,
  'the job is catalogued and runs every 5 minutes');
-- A stale hold never blocks a new one: H5 expired, H6 on the same slot.
select set_config('test.h5', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-16 14:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 hour', null)::text, true);
update public.appointments set held_until = now() - interval '1 second' where id = current_setting('test.h5')::uuid;
select lives_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-16 14:00Z', array['d0000000-0000-0000-0000-000000000001'::uuid], now() + interval '1 hour', null) $$,
  'a new hold over an expired one');
select is((select count(*)::int from public.appointments where id = current_setting('test.h5')::uuid), 0, '… which it released');

-- Anonymisation releases the client's holds.
select set_config('test.h7', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, '2027-03-16 15:00Z', array['d0000000-0000-0000-0000-000000000002'::uuid], now() + interval '1 hour', null)::text, true);
select ok(private.appointments_anonymize_client('d0000000-0000-0000-0000-000000000002') >= 1, 'Marc anonymised');
select is((select count(*)::int from public.appointments where id = current_setting('test.h7')::uuid), 0, '… his hold released');

select * from finish();
rollback;
