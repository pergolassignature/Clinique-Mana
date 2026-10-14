-- Rendez-vous: a professional's own bookings outside her availability (migration
-- *_appointments_own_bookings.sql, R-82).
-- Covers: the professional on her own agenda books, moves and changes the service outside her
-- availability without a reason (the trace kept: the reason « Réservé par le professionnel … » or
-- hers, her as its author, the audit); never on another professional's agenda; never over another
-- appointment; her series' preview shows no « outside » conflict; the staff keep AP-12 (a reason,
-- never over another appointment), the admin too (she holds appointments.self but has no
-- professional file); a hold (Demandes) stays in the availability only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname in ('appointments_own_agenda', 'appointments_outside_reason')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

-- =============================================================================
-- Fixtures: clinic A (conseillère, provider P1 with a profile), P2; P1 available 9:00–12:00
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', x.p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name, email) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@a.test');
-- Léa is in P1's files.
insert into public.client_professional_links (org_id, client_id, professional_id, reason)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'appointment');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
-- Another individual service a psychologue offers.
select set_config('test.s30', (select s.id::text from public.services s
                                where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.is_active and s.duration_minutes > 0
                                  and not s.for_two and s.code <> 10150
                                  and exists (select 1 from private.service_booking_facts(s.org_id, s.id) f
                                               where pg_catalog.cardinality(f.title_ids) = 0
                                                  or f.title_ids && array(select t.id from public.profession_titles t
                                                                           where t.org_id = s.org_id and t.key = 'psychologue'))
                                order by s.code limit 1), true);
-- Three days ahead: 18:00 local is outside P1's 9:00–12:00.
select set_config('test.day', ((now() at time zone 'America/Toronto')::date + 3)::text, true);
select set_config('test.eve', ((current_setting('test.day')::date + time '18:00') at time zone 'America/Toronto')::text, true);
select set_config('test.morning', ((current_setting('test.day')::date + time '09:00') at time zone 'America/Toronto')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, p, d, '09:00', '12:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d,
       (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p);

-- =============================================================================
-- 1. The professional on her own agenda: no reason asked, the trace kept
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.own', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select ok(current_setting('test.own') <> '', 'P1 books her client at 18:00, outside her availability, without a reason');
reset role;
select results_eq($$ select outside_availability_reason, outside_availability_by::text from public.appointments where id = current_setting('test.own')::uuid $$,
  $$ values ('Réservé par le professionnel sur son propre agenda.', 'a0000000-0000-0000-0000-000000000003') $$,
  '… the appointment says so, with her as its author (the staff see « Hors disponibilités »)');
select is((select changed_fields ->> 'outside_availability_reason' from public.audit_log
            where table_name = 'appointments' and record_id = current_setting('test.own') and action = 'insert'),
  '[redacted]', '… audited, the reason redacted as AP-12''s');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000002', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', 'Permission refusée : appointments.manage', 'never on another professional''s agenda');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '30 minutes', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'never over another appointment');
select set_config('test.own2', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '2 hours', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, null,
  'Soirée de groupe')::text, true);
select is((select outside_availability_reason from public.appointments where id = current_setting('test.own2')::uuid),
  'Soirée de groupe', 'her own words, when she gives them, are kept instead');
select lives_ok($$ select public.move_appointment(current_setting('test.own')::uuid, current_setting('test.eve')::timestamptz - interval '1 hour') $$,
  'she moves it to 17:00, still outside, without a reason');
select lives_ok($$ select public.move_appointment(current_setting('test.own')::uuid, current_setting('test.morning')::timestamptz) $$,
  '… then into her availability');
select is((select outside_availability_reason from public.appointments where id = current_setting('test.own')::uuid), null,
  '… which clears the trace (as AP-12)');
select throws_ok($$ select public.move_appointment(current_setting('test.own')::uuid, current_setting('test.eve')::timestamptz + interval '2 hours') $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', 'a move never lands over another appointment');
select lives_ok($$ select public.change_appointment_service(current_setting('test.own2')::uuid, current_setting('test.s30')::uuid) $$,
  'she changes the service of an evening appointment, without a reason');
select is((select count(*)::int from public.preview_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
             current_setting('test.eve')::timestamptz + interval '7 days', 1,
             array[extract(isodow from current_setting('test.eve')::timestamptz at time zone 'America/Toronto')::int], 3, null)
            where conflict is not null), 0, 'her series in the evening: no « outside » conflict');
select ok(public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '7 days', 1,
  array[extract(isodow from current_setting('test.eve')::timestamptz at time zone 'America/Toronto')::int], 3, null,
  array['d0000000-0000-0000-0000-000000000001'::uuid]) is not null, '… and she books it');

-- =============================================================================
-- 2. The staff keep AP-12
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '1 day', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'the conseillère still needs a reason');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '1 day', array['d0000000-0000-0000-0000-000000000001'::uuid]) $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.',
  '… and so does the admin (appointments.self, but no professional file of her own)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '1 day', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, null,
  'Soirée exceptionnelle') $$, '… and books with one');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.eve')::timestamptz + interval '1 day 20 minutes', array['d0000000-0000-0000-0000-000000000001'::uuid], 'video', null, null, null,
  'Par-dessus') $$,
  'P0001', 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).', '… never over another appointment');
select is((select count(*)::int from public.preview_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
             current_setting('test.eve')::timestamptz + interval '28 days', 1,
             array[extract(isodow from current_setting('test.eve')::timestamptz at time zone 'America/Toronto')::int], 2, null)
            where conflict = 'outside_availability'), 2, '… and her series preview still shows « outside »');

-- =============================================================================
-- 3. A hold (Demandes) stays in the availability only
-- =============================================================================
reset role;
select throws_ok($$ select private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, current_setting('test.eve')::timestamptz + interval '2 days',
  array['d0000000-0000-0000-0000-000000000001'::uuid], now() + interval '1 day', 'a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.', 'a proposal never uses « Hors disponibilités »');

select * from finish();
rollback;
