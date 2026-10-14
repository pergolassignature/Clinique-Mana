-- Rendez-vous: an appointment for several people (migration *_appointments_participants.sql, R-79).
-- Covers: the privileges; six clients at most (seven refused), in the order given; each client and
-- each relation who manages her appointments gets the confirmation (a relation once); the
-- consents at booking; the agenda's participants; adding a participant (her confirmation only, a
-- duplicate, the maximum, a couple service, a professional's own clients only, another's agenda,
-- a past appointment); removing one (her cancellation only, not to a relation who still follows
-- another participant; her pending messages set aside and her links revoked, while a parent who
-- still follows another child keeps hers; a link of hers that escaped manages nothing and no email
-- to her is prepared; added back, a new confirmation; the person seen replaced, never when the
-- appointment is invoiced (Facturation's helper); never the last one; never from a couple service);
-- a hold for a family (Demandes' path); billing's facts (the person seen first); the anonymisation
-- promoting one participant and revoking the anonymised client's links; a merge re-pointing the
-- merged file's messages (her reminder still goes out, to the kept file, and her link still works).
-- The deferred messages trigger fires at commit; here `set constraints all immediate` fires it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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
-- P1 offers the individual (psychologue) and the couple (travailleur social) services.
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', x.p, t.id, 'L-' || (row_number() over ())::text, x.k = 'psychologue'
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'psychologue'), ('c0000000-0000-0000-0000-000000000001'::uuid, 'travailleur_social'),
               ('c0000000-0000-0000-0000-000000000002'::uuid, 'psychologue')) as x(p, k)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = x.k;
insert into public.clients (id, org_id, first_name, last_name, email, language)
select ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'Client' || n, 'Famille', 'c' || n || '@a.test', 'fr'
  from generate_series(1, 9) n;
-- Two files of one person, to merge (section 6).
insert into public.clients (id, org_id, first_name, last_name, email, language) values
  ('d0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'Mia', 'Doublon', 'mia@a.test', 'fr'),
  ('d0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000a', 'Mia', 'Conservée', 'kim@a.test', 'fr');
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
-- The « Annuler ou changer » links are on (AP-50).
update public.appointment_settings set client_manage_links = true where org_id = 'b0000000-0000-0000-0000-00000000000a';
select set_config('test.m2', (select id::text from public.appointment_messages
                               where appointment_id = current_setting('test.fam')::uuid and recipient_client_id = 'd0000000-0000-0000-0000-000000000002'
                                 and kind = 'confirmation' and channel = 'email'), true);
select set_config('test.m8', (select id::text from public.appointment_messages
                               where appointment_id = current_setting('test.fam')::uuid and recipient_client_id = 'd0000000-0000-0000-0000-000000000008'
                                 and kind = 'confirmation' and channel = 'email'), true);
select is((select client_id::text from public.appointment_messages where id = current_setting('test.m8')::uuid),
  'd0000000-0000-0000-0000-000000000002', 'the parent''s confirmation is filed under the first of her two children (a fixed order)');
-- Links already sent to client 2 and to the parent (their confirmation emails prepared).
set local role service_role;
select results_eq($$ select (r ->> 'with_link')::boolean, (r ->> 'with_manage')::boolean
                       from public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m2')::uuid,
                              extensions.digest('c-two', 'sha256'), extensions.digest('g-two', 'sha256')) r $$,
  $$ values (true, true) $$, 'client 2''s confirmation carries both links');
select ok((public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m8')::uuid,
            extensions.digest('c-parent', 'sha256'), extensions.digest('g-parent', 'sha256')) ->> 'with_manage')::boolean,
  '… and so does the parent''s');
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
select ok((select bool_and(revoked_at is not null) from public.secure_links
            where token_hash in (extensions.digest('c-two', 'sha256'), extensions.digest('g-two', 'sha256'))),
  '… and the links already sent to her (confirm, cancel) are revoked');
select results_eq($$ select m.status, m.client_id::text, l.revoked_at is null
                       from public.appointment_messages m
                       join public.secure_links l on l.subject_id = m.id and l.token_hash = extensions.digest('g-parent', 'sha256')
                      where m.id = current_setting('test.m8')::uuid $$,
  $$ values ('pending', 'd0000000-0000-0000-0000-000000000003', true) $$,
  'the parent, who still follows client 3, keeps her confirmation (now filed under client 3) and her links');
-- A link of client 2 that would have escaped the revocation still manages nothing, and her email is set aside.
update public.secure_links set revoked_at = null where token_hash = extensions.digest('g-two', 'sha256');
update public.appointment_messages set status = 'pending', skip_reason = null where id = current_setting('test.m2')::uuid;
select set_config('test.l2', (select id::text from public.secure_links where token_hash = extensions.digest('g-two', 'sha256')), true);
set local role service_role;
select is(public.resolve_appointment_manage_link(current_setting('test.l2')::uuid),
  null, 'a removed client''s « Annuler ou changer » page shows nothing');
select is(public.manage_appointment_by_link_for_service(extensions.digest('g-two', 'sha256'), 'cancel') ->> 'state',
  'invalid', '… and her link cancels nothing');
select is(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m2')::uuid,
            extensions.digest('c-two-b', 'sha256')), null, '… nor is an email to her prepared (but her cancellation)');
reset role;
select is((select a.state || ':' || m.status || ':' || m.skip_reason from public.appointments a, public.appointment_messages m
            where a.id = current_setting('test.fam')::uuid and m.id = current_setting('test.m2')::uuid),
  'booked:skipped:superseded', '… the appointment stays booked, her email set aside');
select is((select state from public.appointments where id = current_setting('test.fam')::uuid), 'booked', '… the appointment stays booked');
select ok(exists (select 1 from public.audit_log where table_name = 'appointment_participants' and action = 'delete'
                   and record_id = current_setting('test.fam') || ':d0000000-0000-0000-0000-000000000002'),
  '… audited');

-- Added back: a new confirmation (the one set aside does not hold it back); the parent gets none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.add_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000002') $$,
  'client 2 is added back');
reset role;
select results_eq($$ select recipient_client_id::text, status from public.appointment_messages
                      where appointment_id = current_setting('test.fam')::uuid and kind = 'confirmation' and channel = 'email'
                        and recipient_client_id in ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000008')
                      order by 1, created_at, status $$,
  $$ values ('d0000000-0000-0000-0000-000000000002', 'pending'), ('d0000000-0000-0000-0000-000000000002', 'skipped'),
            ('d0000000-0000-0000-0000-000000000008', 'pending') $$,
  '… she gets a new confirmation; the parent keeps her one');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.remove_appointment_participant(current_setting('test.fam')::uuid, 'd0000000-0000-0000-0000-000000000002') $$,
  '… and taken off again');
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
-- Invoiced at the person seen's file (a draft with the session's line): she stays until it is credited.
insert into public.invoices (id, org_id, client_id, payer_client_id)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
        'd0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000007');
insert into public.invoice_lines (org_id, invoice_id, position, line_type, appointment_id, description)
values ('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 1, 'service', current_setting('test.six')::uuid, 'Séance');
select ok(private.billing_appointment_invoiced('b0000000-0000-0000-0000-00000000000a', current_setting('test.six')::uuid),
  'Facturation says the appointment is invoiced');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.remove_appointment_participant(current_setting('test.six')::uuid, 'd0000000-0000-0000-0000-000000000007') $$,
  'P0001', 'Ce rendez-vous est déjà facturé au dossier de la personne reçue : créditez la facture avant de la retirer.',
  '… so its person seen is not taken off');
reset role;
update public.invoice_lines set credited = true where invoice_id = 'f0000000-0000-0000-0000-000000000001';
select ok(not private.billing_appointment_invoiced('b0000000-0000-0000-0000-00000000000a', current_setting('test.six')::uuid),
  '… a credited line no longer counts');

-- =============================================================================
-- 5. Anonymisation: one participant becomes the person seen
-- =============================================================================
set local role service_role;
select set_config('test.m7', (select id::text from public.appointment_messages
                               where appointment_id = current_setting('test.six')::uuid and recipient_client_id = 'd0000000-0000-0000-0000-000000000007'
                                 and kind = 'confirmation' and channel = 'email'), true);
select ok((public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m7')::uuid,
            extensions.digest('c-seven', 'sha256'), extensions.digest('g-seven', 'sha256')) ->> 'with_manage')::boolean,
  'client 7 holds her links');
reset role;
select lives_ok($$ select private.appointments_anonymize_client('d0000000-0000-0000-0000-000000000007') $$,
  'the person seen of the six is anonymised');
select ok((select bool_and(revoked_at is not null) from public.secure_links
            where token_hash in (extensions.digest('c-seven', 'sha256'), extensions.digest('g-seven', 'sha256'))),
  '… her links are revoked as she leaves the appointment');
select results_eq($$ select client_id::text, role from public.appointment_participants
                      where appointment_id = current_setting('test.six')::uuid order by role = 'second', created_at $$,
  $$ values ('d0000000-0000-0000-0000-000000000006', 'client'), ('d0000000-0000-0000-0000-000000000005', 'second'),
            ('d0000000-0000-0000-0000-000000000004', 'second'), ('d0000000-0000-0000-0000-000000000003', 'second'),
            ('d0000000-0000-0000-0000-000000000002', 'second') $$,
  '… she leaves it and only the next one becomes the person seen');

-- =============================================================================
-- 6. A merge: the merged file's messages follow her to the kept file
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.mrg', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '6 hours', array['d0000000-0000-0000-0000-00000000000a'::uuid])::text, true);
select ok(current_setting('test.mrg') <> '', 'an appointment with the file to be merged away');
set constraints all immediate;
set constraints all deferred;
reset role;
select set_config('test.mm', (select id::text from public.appointment_messages
                               where appointment_id = current_setting('test.mrg')::uuid and kind = 'confirmation' and channel = 'email'), true);
select ok(private.appointments_queue_message('b0000000-0000-0000-0000-00000000000a', current_setting('test.mrg')::uuid, 'reminder', true) >= 1,
  '… her reminder waits to go out');
set local role service_role;
select ok((public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.mm')::uuid,
            extensions.digest('c-mrg', 'sha256'), extensions.digest('g-mrg', 'sha256')) ->> 'with_manage')::boolean,
  '… and her confirmation went with its links');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.merge_clients('d0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000a') $$,
  'the admin merges the file into the kept one');
reset role;
select results_eq($$ select recipient_client_id::text, client_id::text, status from public.appointment_messages
                      where appointment_id = current_setting('test.mrg')::uuid and kind = 'reminder' and channel = 'email' $$,
  $$ values ('d0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b', 'pending') $$,
  '… her pending reminder now belongs to the kept file, still pending');
select set_config('test.lm', (select id::text from public.secure_links where token_hash = extensions.digest('g-mrg', 'sha256')), true);
select set_config('test.rm', (select id::text from public.appointment_messages
                               where appointment_id = current_setting('test.mrg')::uuid and kind = 'reminder' and channel = 'email'), true);
set local role service_role;
select isnt(public.resolve_appointment_manage_link(current_setting('test.lm')::uuid), null, '… the link already sent still works');
select is(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.rm')::uuid,
            extensions.digest('c-mrg-r', 'sha256')) ->> 'email', 'kim@a.test', '… and the reminder goes out, to the kept file''s address');
reset role;

select * from finish();
rollback;
