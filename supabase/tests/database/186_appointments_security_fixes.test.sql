-- Rendez-vous: the pre-cutover security review's fixes (migration *_appointments_security_fixes.sql).
-- Covers: a professional books (and books a series for) only the clients already in her files, the
-- staff any; « Votre lien de rencontre » honours the email opt-out and the testers' reservation; a
-- confirmation link confirms only the start its message announced, and a move, a cancellation or
-- a restore revokes it; the Zoom meeting's id redacted from the audit; a held slot shows no client
-- to a professional (list_agenda, the participants' policy), the staff unchanged; the permission
-- checked first (retry_appointment_video, cancel_series_from); get_booking_consents unchanged.
-- The deferred messages trigger fires at commit; here `set constraints all immediate` fires it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- =============================================================================
-- Fixtures: clinic A (conseillère, provider P1), professional P2; clinic B (appointments off)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments')) as y(m);
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000b', m, true
  from (values ('professionals'), ('services'), ('clients')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
-- Three clients, each with an email (reminders by email: the default).
insert into public.clients (id, org_id, first_name, last_name, email, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa',  'Essai', 'lea@a.test',  'fr'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai', 'marc@a.test', 'fr'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Noé',  'Essai', 'noe@a.test',  'fr');
select set_config('test.s50', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
insert into public.appointment_settings (org_id, business_days, business_start, business_end, reminder_business_days, reminder_local_hour)
values ('b0000000-0000-0000-0000-00000000000a', '{1,2,3,4,5,6,7}', '00:00', '23:59', 1, 0)
on conflict (org_id) do update set business_days = excluded.business_days, business_start = excluded.business_start,
  business_end = excluded.business_end;
-- Three and four days ahead, in local time.
select set_config('test.d3', (((now() at time zone 'America/Toronto')::date + 3 + time '10:00') at time zone 'America/Toronto')::text, true);
select set_config('test.d4', (((now() at time zone 'America/Toronto')::date + 4 + time '10:00') at time zone 'America/Toronto')::text, true);
-- P2's appointment (no series).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
        current_setting('test.s50')::uuid, current_setting('test.d4')::timestamptz, current_setting('test.d4')::timestamptz + interval '50 minutes',
        current_setting('test.d4')::timestamptz + interval '60 minutes');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.set_availability_rule(null, 'c0000000-0000-0000-0000-000000000001', d, '08:00', '20:00', '{}', true, false, '2026-01-01', null)
  from pg_catalog.generate_series(1, 7) d;

-- =============================================================================
-- 1. A professional books her own clients only (the staff any)
-- =============================================================================
select set_config('test.a0', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz, array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select ok(current_setting('test.a0') <> '', 'the staff book Léa with P1 (Léa is now in P1''s files)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.a1', public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '2 hours', array['d0000000-0000-0000-0000-000000000001'::uuid])::text, true);
select ok(current_setting('test.a1') <> '', 'P1 books Léa, a client of hers');
select throws_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '4 hours', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce client n''est pas encore dans vos dossiers : demandez à la clinique de le jumeler.', '… never Marc, not in her files');
select throws_ok($$ select public.create_series('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '4 hours', 1,
  array[extract(isodow from current_setting('test.d3')::timestamptz at time zone 'America/Toronto')::int], 3, null, array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'P0001', 'Ce client n''est pas encore dans vos dossiers : demandez à la clinique de le jumeler.', '… nor a series for him');
reset role;
select is((select count(*)::int from public.client_professional_links
            where client_id = 'd0000000-0000-0000-0000-000000000002' and professional_id = 'c0000000-0000-0000-0000-000000000001'),
  0, '… and Marc''s file stays closed to her');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '4 hours', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  'the staff book Marc with P1 (unchanged)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.book_appointment('c0000000-0000-0000-0000-000000000001', current_setting('test.s50')::uuid,
  current_setting('test.d3')::timestamptz + interval '6 hours', array['d0000000-0000-0000-0000-000000000002'::uuid]) $$,
  '… then P1 books him herself');
set constraints all immediate;
set constraints all deferred;
reset role;

-- =============================================================================
-- 2. « Votre lien de rencontre »: the email opt-out, the testers' reservation
-- 4. … and the meeting's id never in the audit
-- =============================================================================
insert into public.video_connections (id, org_id, professional_id, state, external_user_id)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'connected', 'zu1');
insert into public.appointment_video_meetings (appointment_id, org_id, connection_id, external_id, join_url)
values (current_setting('test.a1')::uuid, 'b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001',
        '81234567890', 'https://zoom.test/j/81234567890');
set local role service_role;
select is((select count(*)::int from public.video_link_email_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.a1')::uuid)),
  1, 'the link goes to Léa');
reset role;
update public.clients set reminders_by_email = false where id = 'd0000000-0000-0000-0000-000000000001';
set local role service_role;
select is((select count(*)::int from public.video_link_email_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.a1')::uuid)),
  0, '… never once she turned the emails off');
reset role;
update public.clients set reminders_by_email = true where id = 'd0000000-0000-0000-0000-000000000001';
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
set local role service_role;
select is((select count(*)::int from public.video_link_email_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.a1')::uuid)),
  0, '… nor while the module is reserved for testers (P3-40)');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
select results_eq($$ select changed_fields -> 'external_id', changed_fields -> 'join_url' from public.audit_log
                      where table_name = 'appointment_video_meetings' and action = 'insert' $$,
  $$ values ('"[redacted]"'::jsonb, '"[redacted]"'::jsonb) $$, 'the meeting''s audit row: its id and link redacted');
update public.appointments set video_external_id = '81234567890', video_url = 'https://zoom.test/j/81234567890', video_status = 'ready'
 where id = current_setting('test.a1')::uuid;
select results_eq($$ select changed_fields -> 'video_external_id', changed_fields -> 'video_url' from public.audit_log
                      where table_name = 'appointments' and action = 'update' and record_id = current_setting('test.a1')
                        and changed_fields ? 'video_external_id' $$,
  $$ values ('"[redacted]"'::jsonb, '"[redacted]"'::jsonb) $$, 'the appointment''s audit row: the meeting''s id redacted too');

-- =============================================================================
-- 3. Confirmation links: the announced start only; revoked by a move, a cancellation, a restore
-- =============================================================================
select set_config('test.m1', (select id::text from public.appointment_messages
                                where appointment_id = current_setting('test.a1')::uuid and kind = 'confirmation' and channel = 'email'), true);
select set_config('test.m0', (select id::text from public.appointment_messages
                                where appointment_id = current_setting('test.a0')::uuid and kind = 'confirmation' and channel = 'email'), true);
set local role service_role;
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m1')::uuid,
  extensions.digest('tok-move', 'sha256')) ->> 'with_link' = 'true', 'Léa''s confirmation email carries a link');
reset role;
-- The staff move the appointment: the link is revoked.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.move_appointment(current_setting('test.a1')::uuid, current_setting('test.d3')::timestamptz + interval '8 hours') $$, 'moved');
set constraints all immediate;
set constraints all deferred;
reset role;
select ok((select revoked_at is not null from public.secure_links where token_hash = extensions.digest('tok-move', 'sha256')), '… its link revoked');
set local role service_role;
select is(public.confirm_appointment_by_link_for_service(extensions.digest('tok-move', 'sha256')) ->> 'state', 'invalid', '… and it confirms nothing');
reset role;
-- A live link for the old start (as if issued before the move): it confirms nothing either.
select set_config('test.old_link', private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'appointment_confirm', 'appointment_message',
  current_setting('test.m1')::uuid, extensions.digest('tok-old', 'sha256'), null)::text, true);
select is(public.resolve_appointment_confirm_link(current_setting('test.old_link')::uuid), null, 'a link for the old start: the page shows nothing');
set local role service_role;
select is(public.confirm_appointment_by_link_for_service(extensions.digest('tok-old', 'sha256')) ->> 'state', 'invalid', '… and confirms nothing');
reset role;
select is((select state from public.appointments where id = current_setting('test.a1')::uuid), 'booked', '… the appointment still unconfirmed');

-- Cancelled, then restored at the same start: each revokes the links already sent.
set local role service_role;
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a', current_setting('test.m0')::uuid,
  extensions.digest('tok-cancel', 'sha256')) ->> 'with_link' = 'true', 'the other appointment''s email carries a link');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.cancel_appointment(current_setting('test.a0')::uuid, 'not_specified') $$, 'cancelled');
set constraints all immediate;
set constraints all deferred;
reset role;
select ok((select revoked_at is not null from public.secure_links where token_hash = extensions.digest('tok-cancel', 'sha256')), '… its link revoked');
select set_config('test.restore_link', private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'appointment_confirm', 'appointment_message',
  current_setting('test.m0')::uuid, extensions.digest('tok-restore', 'sha256'), null)::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.restore_appointment(current_setting('test.a0')::uuid) $$, 'restored at the same start');
set constraints all immediate;
set constraints all deferred;
reset role;
set local role service_role;
select is(public.confirm_appointment_by_link_for_service(extensions.digest('tok-restore', 'sha256')) ->> 'state', 'invalid',
  '… a link sent before the restore confirms nothing');
-- The restore's own message gets a new link that works.
select ok(public.prepare_appointment_message_for_service('b0000000-0000-0000-0000-00000000000a',
  (select id from public.appointment_messages where appointment_id = current_setting('test.a0')::uuid and kind = 'changed' and channel = 'email'),
  extensions.digest('tok-new', 'sha256')) ->> 'with_link' = 'true', 'the restore''s email carries a new link');
select is(public.confirm_appointment_by_link_for_service(extensions.digest('tok-new', 'sha256')) ->> 'state', 'confirmed', '… which confirms');
reset role;

-- =============================================================================
-- 5. A held slot shows no client to a professional (AP-15)
-- =============================================================================
select set_config('test.held', private.appointments_hold('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  current_setting('test.s50')::uuid, current_setting('test.d4')::timestamptz, array['d0000000-0000-0000-0000-000000000003'::uuid],
  now() + interval '1 hour', null)::text, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select state, participants from public.list_agenda(current_setting('test.d4')::timestamptz - interval '1 hour',
                                                                        current_setting('test.d4')::timestamptz + interval '2 hours')
                      where id = current_setting('test.held')::uuid $$,
  $$ values ('held'::text, '[]'::jsonb) $$, 'P1''s agenda: the proposed slot, no client');
select is((select count(*)::int from public.appointment_participants where appointment_id = current_setting('test.held')::uuid), 0,
  '… nor through the table');
select is((select pg_catalog.jsonb_array_length(participants) from public.list_agenda(current_setting('test.d3')::timestamptz,
                                                                                    current_setting('test.d3')::timestamptz + interval '12 hours')
            where id = current_setting('test.a1')::uuid), 1, '… her booked appointments keep their client');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select p ->> 'client_id' from public.list_agenda(current_setting('test.d4')::timestamptz - interval '1 hour',
                                                                     current_setting('test.d4')::timestamptz + interval '2 hours') a,
                           pg_catalog.jsonb_array_elements(a.participants) p
                      where a.id = current_setting('test.held')::uuid $$,
  $$ values ('d0000000-0000-0000-0000-000000000003'::text) $$, 'the staff see the proposed client (unchanged)');
select is((select count(*)::int from public.appointment_participants where appointment_id = current_setting('test.held')::uuid), 1,
  '… through the table too');

-- =============================================================================
-- 6. The permission first; 7. get_booking_consents
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.retry_appointment_video(current_setting('test.a1')::uuid) $$,
  '42501', 'Permission refusée : appointments.manage', '« Réessayer »: refused before anything is read');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_series_from('e0000000-0000-0000-0000-000000000002', 'not_specified') $$,
  '42501', 'Permission refusée : appointments.manage', 'another professional''s appointment: refused before its series is told');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.cancel_series_from('e0000000-0000-0000-0000-000000000002', 'not_specified') $$,
  'P0001', 'Ce rendez-vous ne fait pas partie d''une série.', '… the staff are told (unchanged)');
select is((select count(distinct client_id)::int from public.get_booking_consents(current_setting('test.s50')::uuid,
            array['d0000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-0000000000ff'::uuid])),
  (select count(distinct client_id)::int from public.get_booking_consents(current_setting('test.s50')::uuid,
            array['d0000000-0000-0000-0000-000000000001'::uuid])),
  'get_booking_consents: an unknown client adds nothing');
reset role;

select * from finish();
rollback;
