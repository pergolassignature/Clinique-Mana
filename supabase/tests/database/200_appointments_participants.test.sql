-- Rendez-vous: an appointment for several people (migration *_appointments_participants.sql, R-79).
-- Covers: the privileges; six clients at most (seven refused), in the order given; each client and
-- each relation who manages her appointments gets the confirmation (a relation once); the
-- consents at booking; the agenda's participants; adding a participant (her confirmation only, a
-- duplicate, the maximum, a couple service, a professional's own clients only, another's agenda,
-- a past appointment); removing one (her cancellation only, not to a relation who still follows
-- another participant; her pending messages set aside and her links revoked; the person seen
-- replaced; never the last one; never from a couple service); a hold for a family (Demandes'
-- path); billing's facts (the person seen first); the anonymisation promoting one participant.
-- The deferred messages trigger fires at commit; here `set constraints all immediate` fires it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', f, array['uuid', 'uuid'], 'authenticated', array['EXECUTE'], f || ': authenticated may call it')
  from (values ('add_appointment_participant'), ('remove_appointment_participant')) as x(f);
select function_privs_are('public', f, array['uuid', 'uuid'], 'anon', array[]::text[], f || ': not anon')
  from (values ('add_appointment_participant'), ('remove_appointment_participant')) as x(f);
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('appointments_max_clients', 'appointments_participants_target', 'appointments_queue_message')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');
select is(private.appointments_max_clients(), 6, 'an appointment holds six clients at most');

-- =============================================================================
-- Fixtures: clinic A (conseillère, provider P1 with a profile), P2; nine clients, a parent
-- =============================================================================
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
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active');
-- P1 offers the individual (psychologue) and the couple (travailleur social) services.
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', x.p, t.id, 'L-' || (row_number() over ())::text, x.k = 'psychologue'
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'psychologue'), ('c0000000-0000-0000-0000-000000000001'::uuid, 'travailleur_social'),
               ('c0000000-0000-0000-0000-000000000002'::uuid, 'psychologue')) as x(p, k)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = x.k;
insert into public.clients (id, org_id, first_name, last_name, email, language)
select ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'Client' || n, 'Famille', 'c' || n || '@a.test', 'fr'
  from generate_series(1, 9) n;
-- Client 8 is the parent who manages the appointments of clients 2 and 3.
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, b_manages_appointments) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000008', 'child', 'parent', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000008', 'child', 'parent', true);
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.couple', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 20160), true);
insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour)
values ('b0000000-0000-0000-0000-00000000000a', '{1,2,3,4,5,6,7}', '00:00', '23:59', 1, 0)
on conflict (org_id) do update set business_days = excluded.business_days, business_start = excluded.business_start,
  business_end = excluded.business_end;
select set_config('test.d3', (((now() at time zone 'America/Toronto')::date + 3 + time '09:00') at time zone 'America/Toronto')::text, true);
-- P2's appointment with client 1, and a past one of P1's.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
   current_setting('test.s50')::uuid, current_setting('test.d3')::timestamptz, current_setting('test.d3')::timestamptz + interval '50 minutes',
   current_setting('test.d3')::timestamptz + interval '60 minutes'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   current_setting('test.s50')::uuid, date_trunc('hour', now()) - interval '1 day', date_trunc('hour', now()) - interval '1 day' + interval '50 minutes',
   date_trunc('hour', now()) - interval '1 day' + interval '60 minutes');
insert into public.appointment_participants (appointment_id, client_id, org_id) values
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a'),
  ('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '08:00', '20:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d;

-- =============================================================================
-- 1. Booking a family: up to six, in the order given, each told
-- =============================================================================
select set_config('test.fam', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz, array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
                                                 'd0000000-0000-0000-0000-000000000003']::uuid[])::text, true);
select ok(current_setting('test.fam') <> '', 'three clients booked together');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '2 hours',
  array(select ('d0000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 7) n)) $$,
  'P0001', 'Un rendez-vous compte 6 clients au plus.', 'seven clients: refused');
select set_config('test.six', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '2 hours',
  array(select ('d0000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(7, 2, -1) n))::text, true);
select ok(current_setting('test.six') <> '', 'six clients: booked');
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq($$ select client_id::text, role from public.appointment_participants
                      where appointment_id = current_setting('test.fam')::uuid order by role = 'second', created_at $$,
  $$ values ('d0000000-0000-0000-0000-000000000001', 'client'), ('d0000000-0000-0000-0000-000000000002', 'second'),
            ('d0000000-0000-0000-0000-000000000003', 'second') $$,
  'the person seen first, then the others, in the order given');
select is((select array_agg(client_id::text order by role = 'second', created_at) from public.appointment_participants
            where appointment_id = current_setting('test.six')::uuid),
  array(select 'd0000000-0000-0000-0000-00000000000' || n from generate_series(7, 2, -1) n),
  'six clients keep the order given (the readers order by role, then created_at)');
select results_eq($$ select recipient_client_id::text, count(*)::int from public.appointment_messages
                      where appointment_id = current_setting('test.fam')::uuid and kind = 'confirmation' and channel = 'email'
                      group by 1 order by 1 $$,
  $$ values ('d0000000-0000-0000-0000-000000000001', 1), ('d0000000-0000-0000-0000-000000000002', 1),
            ('d0000000-0000-0000-0000-000000000003', 1), ('d0000000-0000-0000-0000-000000000008', 1) $$,
  'each client gets her confirmation; the parent who manages two of them, once');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select * from public.get_booking_consents(current_setting('test.s50')::uuid,
            array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003']::uuid[]) $$,
  'the consents at booking, read for three clients');
select throws_ok($$ select * from public.get_booking_consents(current_setting('test.s50')::uuid,
  array(select ('d0000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1, 7) n)) $$,
  '22023', null, '… seven: refused');
select is((select pg_catalog.jsonb_array_length(participants) from public.list_agenda(
             current_setting('test.d3')::timestamptz - interval '1 hour', current_setting('test.d3')::timestamptz + interval '1 day')
            where id = current_setting('test.fam')::uuid), 3, 'the agenda shows the three participants');

-- =============================================================================
-- 2. Adding a participant
-- =============================================================================
select lives_ok($$ select public.add_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000004') $$,
  'the conseillère adds a fourth person');
reset role;
select results_eq($$ select role, presence from public.appointment_participants
                      where appointment_id = current_setting('test.fam')::uuid and client_id = 'd0000000-0000-0000-0000-000000000004' $$,
  $$ values ('second', 'expected') $$, '… another participant, expected');
select results_eq($$ select recipient_client_id::text, count(*)::int from public.appointment_messages
                      where appointment_id = current_setting('test.fam')::uuid and kind = 'confirmation' group by 1 order by 1 $$,
  $$ values ('d0000000-0000-0000-0000-000000000001', 1), ('d0000000-0000-0000-0000-000000000002', 1),
            ('d0000000-0000-0000-0000-000000000003', 1), ('d0000000-0000-0000-0000-000000000004', 1),
            ('d0000000-0000-0000-0000-000000000008', 1) $$,
  '… she gets her confirmation; nobody else gets a second one');
select ok(exists (select 1 from public.client_professional_links
                   where client_id = 'd0000000-0000-0000-0000-000000000004' and professional_id = 'c0000000-0000-0000-0000-000000000001'),
  '… and her file is linked to the professional');
select ok(exists (select 1 from public.audit_log where table_name = 'appointment_participants' and action = 'insert'
                   and record_id = current_setting('test.fam') || ':d0000000-0000-0000-0000-000000000004'),
  '… audited');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.add_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Ce client participe déjà à ce rendez-vous.', 'never twice');
select throws_ok($$ select public.add_appointment_participant(current_setting('test.six')::uuid, 'd0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Un rendez-vous compte 6 clients au plus.', 'never a seventh');
select throws_ok($$ select public.add_appointment_participant('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Ce rendez-vous est commencé : ses participants ne changent plus (notez plutôt la présence).', 'never to a past appointment');
select set_config('test.couple_appt', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.couple')::uuid,
  current_setting('test.d3')::timestamptz + interval '1 day',
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[])::text, true);
select throws_ok($$ select public.add_appointment_participant(current_setting('test.couple_appt')::uuid, 'd0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Ce service se réserve pour deux personnes : changez le service pour ajouter une autre personne.', 'a couple service keeps two');
select throws_ok($$ select public.remove_appointment_participant(current_setting('test.couple_appt')::uuid, 'd0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Ce service se réserve pour deux personnes : changez le service avant de retirer une personne.', '… both ways');
-- P1 herself: her own clients only, her own agenda only.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.add_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000009') $$,
  'P0001', 'Ce client n''est pas encore dans vos dossiers : demandez à la clinique de le jumeler.', 'a professional adds only her own clients');
select lives_ok($$ select public.add_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000005') $$,
  '… one already in her files');
select throws_ok($$ select public.add_appointment_participant('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000005') $$,
  '42501', null, '… never on another professional''s appointment');
select throws_ok($$ select public.remove_appointment_participant('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001') $$,
  '42501', null, '… nor removes anyone there');

-- =============================================================================
-- 3. Removing a participant
-- =============================================================================
reset role;
-- A link already sent to client 2 (her confirmation email prepared).
set local role service_role;
select set_config('test.m2', (select id::text from public.appointment_messages
                               where appointment_id = current_setting('test.fam')::uuid and recipient_client_id = 'd0000000-0000-0000-0000-000000000002'
                                 and kind = 'confirmation' and channel = 'email'), true);
select ok((public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m2')::uuid,
            extensions.digest('c-two', 'sha256')) ->> 'with_link')::boolean, 'client 2''s confirmation carries its link');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000002') $$,
  'the conseillère takes client 2 off the appointment');
reset role;
select ok(not exists (select 1 from public.appointment_participants
                       where appointment_id = current_setting('test.fam')::uuid and client_id = 'd0000000-0000-0000-0000-000000000002'),
  '… she is no longer a participant');
select results_eq($$ select recipient_client_id::text from public.appointment_messages
                      where appointment_id = current_setting('test.fam')::uuid and kind = 'cancelled' order by 1 $$,
  $$ values ('d0000000-0000-0000-0000-000000000002') $$,
  '… she gets a cancellation; the parent, who still follows client 3, does not; nobody else does');
select is((select status || ':' || coalesce(skip_reason, '') from public.appointment_messages where id = current_setting('test.m2')::uuid),
  'skipped:superseded', '… her pending confirmation is set aside');
select ok((select revoked_at is not null from public.secure_links where token_hash = extensions.digest('c-two', 'sha256')),
  '… and the link already sent to her is revoked');
select is((select state from public.appointments where id = current_setting('test.fam')::uuid), 'booked', '… the appointment stays booked');
select ok(exists (select 1 from public.audit_log where table_name = 'appointment_participants' and action = 'delete'
                   and record_id = current_setting('test.fam') || ':d0000000-0000-0000-0000-000000000002'),
  '… audited');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000001') $$,
  'the person seen is taken off');
reset role;
select results_eq($$ select client_id::text, role from public.appointment_participants
                      where appointment_id = current_setting('test.fam')::uuid order by role = 'second', created_at $$,
  $$ values ('d0000000-0000-0000-0000-000000000003', 'client'), ('d0000000-0000-0000-0000-000000000004', 'second'),
            ('d0000000-0000-0000-0000-000000000005', 'second') $$,
  '… the next one becomes the person seen, the others stay');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'Ce client n''est pas au rendez-vous.', 'someone not there');
select lives_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000005') $$,
  'another one off');
select lives_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000004') $$,
  '… and another');
select throws_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Un rendez-vous garde au moins un client : annulez-le plutôt.', 'never the last one');

-- =============================================================================
-- 4. A family's hold (Demandes' path) and billing's facts
-- =============================================================================
reset role;
select set_config('test.hold', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, current_setting('test.d3')::timestamptz + interval '4 hours',
  array['d0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000005']::uuid[],
  now() + interval '1 day', 'a0000000-0000-0000-0000-000000000004')::text, true);
select is((select array_agg(client_id::text order by role = 'second', created_at) from public.appointment_participants
            where appointment_id = current_setting('test.hold')::uuid),
  array['d0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000005'],
  'a proposal holds a family''s slot, every file in order');
select is((select client_ids[1]::text || ':' || pg_catalog.cardinality(client_ids) from private.appointment_billing_facts(
             'b0000000-0000-0000-0000-00000000000a', array[current_setting('test.six')::uuid])),
  'd0000000-0000-0000-0000-000000000007:6', 'billing reads the six files, the person seen first (one invoice, at her file)');

-- =============================================================================
-- 5. Anonymisation: one participant becomes the person seen
-- =============================================================================
select lives_ok($$ select private.appointments_anonymize_client('d0000000-0000-0000-0000-000000000007') $$,
  'the person seen of the six is anonymised');
select results_eq($$ select client_id::text, role from public.appointment_participants
                      where appointment_id = current_setting('test.six')::uuid order by role = 'second', created_at $$,
  $$ values ('d0000000-0000-0000-0000-000000000006', 'client'), ('d0000000-0000-0000-0000-000000000005', 'second'),
            ('d0000000-0000-0000-0000-000000000004', 'second'), ('d0000000-0000-0000-0000-000000000003', 'second'),
            ('d0000000-0000-0000-0000-000000000002', 'second') $$,
  '… she leaves it and only the next one becomes the person seen');

select * from finish();
rollback;
