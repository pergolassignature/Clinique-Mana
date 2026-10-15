-- Demandes, the pre-cutover security review (migration *_demandes_security_fixes.sql). Covers:
-- the booking page never tells a second booking with the same address apart (no new request, the
-- earlier call re-sent with a fresh cancel link, its own first name, the asked slot shown); the
-- booking's names (99 characters, name characters, no web address); a professional's sight of a
-- request's files ends when she loses them (a participant removed, the file changed, the request
-- unmatched or closed), but not while an appointment or another matched request holds it, nor for
-- a link of another reason; the anonymisation blanks the requests' free text, their note and the
-- waiting list's reasons; the audit redacts the remaining personal columns; the cancel link obeys
-- the module; « Facturer l'inscription » no longer refuses for P3-40 (D-52); an offer's slots are stored rebuilt; the
-- « still waiting? » link names a professional's list.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated, service_role;

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_release_clients', 'clients_unlink_professional_reason', 'appointments_professional_has_client')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the new helpers are granted to no role');

-- =============================================================================
-- Fixtures: clinic A (counselor, professional P1 with her account, admin), every module on
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@sf.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Clinique A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@sf.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@sf.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u3@sf.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('demandes'), ('appointments')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status, profile_id) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Psy', 'p1@sf.test', 'active',
   'a0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marie', 'Autre', 'p2@sf.test', 'active', null);
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Un'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Deux'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Trois'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'David', 'Quatre'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Emma', 'Cinq'),
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Félix', 'Six');

-- =============================================================================
-- 1. The booking page: a second booking with the same address reads as a booking
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select public.set_demandes_booking_settings(
  '{"enabled": true, "slot_minutes": 60, "notice_hours": 0, "horizon_days": 2, "capacity": 1,
    "weekly": [{"day": 1, "start": "00:00", "end": "24:00"}, {"day": 2, "start": "00:00", "end": "24:00"},
               {"day": 3, "start": "00:00", "end": "24:00"}, {"day": 4, "start": "00:00", "end": "24:00"},
               {"day": 5, "start": "00:00", "end": "24:00"}, {"day": 6, "start": "00:00", "end": "24:00"},
               {"day": 7, "start": "00:00", "end": "24:00"}]}');
reset role;
set local role service_role;
create temporary table page as select public.demandes_booking_page_for_service('b0000000-0000-0000-0000-00000000000a') as p;
select set_config('test.slot1', (select p -> 'slots' ->> 2 from page), true);
select set_config('test.slot2', (select p -> 'slots' ->> 4 from page), true);
select set_config('test.first', public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', current_setting('test.slot1'), 'first_name', 'Marie-Ève', 'last_name', 'O''Neil St. Pierre',
                     'email', 'marie@exemple.test', 'phone_e164', '+15145550101', 'language', 'en'),
  sha256('sf-1'::bytea))::text, true);
select set_config('test.again', public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', current_setting('test.slot2'), 'first_name', 'Intrus', 'last_name', 'Curieux',
                     'email', 'Marie@Exemple.test', 'phone_e164', '+15145550199', 'language', 'fr'),
  sha256('sf-2'::bytea))::text, true);
reset role;
select is((current_setting('test.first')::jsonb ->> 'first_name'), 'Marie-Ève', 'a name with a hyphen, an apostrophe and « St. »: booked');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('test.again')::jsonb) k),
          (select array_agg(k order by k) from jsonb_object_keys(current_setting('test.first')::jsonb) k),
  'the same address again: the same answer as a booking, no refusal');
select results_eq($$ select (j ->> 'task_id')::uuid, (j ->> 'starts_at')::timestamptz, (j ->> 'requested_starts_at')::timestamptz,
                            j ->> 'first_name', j ->> 'language'
                       from (select current_setting('test.again')::jsonb as j) x $$,
  $$ select (current_setting('test.first')::jsonb ->> 'task_id')::uuid, current_setting('test.slot1')::timestamptz,
            current_setting('test.slot2')::timestamptz, 'Marie-Ève'::text, 'en'::text $$,
  '… for the earlier call (its time, its first name and language for the email), the asked slot for the page');
select is((select count(*)::int from public.demandes where org_id = 'b0000000-0000-0000-0000-00000000000a' and contact_email = 'marie@exemple.test'), 1,
  'no second request');
select is((select count(*)::int from public.demande_tasks where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'discovery_call'), 1,
  'no second call; the asked slot stays free');
select results_eq($$ select token_hash = sha256('sf-2'::bytea), revoked_at is null from public.secure_links
                      where purpose = 'discovery_call' and subject_id = (current_setting('test.first')::jsonb ->> 'task_id')::uuid order by created_at, token_hash = sha256('sf-2'::bytea) $$,
  $$ values (false, false), (true, true) $$, 'the earlier call''s cancel link is replaced by the new one (sent with it)');
-- Names: 99 characters, name characters only.
set local role service_role;
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', %L, 'last_name', 'Long', 'email', 'long@exemple.test', 'phone_e164', '+15145550102'),
  sha256('sf-3'::bytea)) $$, current_setting('test.slot2'), repeat('a', 100))), 'name', 'a first name of 100 characters: refused with its field');
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', 'Gagnez', 'last_name', 'www.exemple.test', 'email', 'web@exemple.test', 'phone_e164', '+15145550103'),
  sha256('sf-4'::bytea)) $$, current_setting('test.slot2'))), 'name', 'a web address as a name: refused');
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', 'https://x', 'last_name', 'Lien', 'email', 'lien@exemple.test', 'phone_e164', '+15145550104'),
  sha256('sf-5'::bytea)) $$, current_setting('test.slot2'))), 'name', 'a link as a first name: refused');
select ok(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', %L, 'last_name', %L, 'email', 'max@exemple.test', 'phone_e164', '+15145550105'),
  sha256('sf-6'::bytea)) $$, current_setting('test.slot2'), repeat('é', 99), repeat('b', 99))) is null, '99 and 99 characters: booked, never a 500');
reset role;

-- =============================================================================
-- 5. The cancel link obeys the module
-- =============================================================================
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role service_role;
select is(public.cancel_discovery_call_for_service(sha256('sf-2'::bytea)) ->> 'state', 'invalid', 'Demandes off: the cancel link does nothing');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role service_role;
select is(public.cancel_discovery_call_for_service(sha256('sf-1'::bytea)) ->> 'state', 'invalid', 'the replaced link is spent');
select is(public.cancel_discovery_call_for_service(sha256('sf-2'::bytea)) ->> 'state', 'cancelled', 'Demandes on: the new link cancels');
reset role;

-- =============================================================================
-- 2. A professional's sight of a request's files
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d1', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000001"}')::text, true);
select public.set_demande_participants(current_setting('test.d1')::uuid,
  '[{"client_id": "d0000000-0000-0000-0000-000000000001", "relationship": "self", "is_primary": true},
    {"client_id": "d0000000-0000-0000-0000-000000000002", "relationship": "partner", "is_primary": false}]');
select public.set_demande_state(current_setting('test.d1')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d1')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select array_agg(id order by id) from public.my_clients),
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[], 'matched: P1 sees the file and the participant''s');

-- A participant removed.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_participants(current_setting('test.d1')::uuid,
  '[{"client_id": "d0000000-0000-0000-0000-000000000001", "relationship": "self", "is_primary": true}]');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select array_agg(id order by id) from public.my_clients),
  array['d0000000-0000-0000-0000-000000000001']::uuid[], 'a participant removed: P1 no longer sees her file');
reset role;
select is((select primary_professional_id from public.clients where id = 'd0000000-0000-0000-0000-000000000002'), null,
  '… nor is she its primary professional (the match had made her so)');
select is((select primary_professional_id from public.clients where id = 'd0000000-0000-0000-0000-000000000001'),
  'c0000000-0000-0000-0000-000000000001'::uuid, '… the file she keeps keeps her');

-- The request's file changed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_participants(current_setting('test.d1')::uuid, '[]');
select public.update_demande(current_setting('test.d1')::uuid, '{"client_id": "d0000000-0000-0000-0000-000000000003"}');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select array_agg(id order by id) from public.my_clients),
  array['d0000000-0000-0000-0000-000000000003']::uuid[], 'the request''s file changed: P1 sees the new one, not the old');
reset role;

-- Unmatched while an appointment of hers holds the file: she keeps it.
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        (select id from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' order by code limit 1),
        date_trunc('hour', now()) + interval '30 hours', date_trunc('hour', now()) + interval '31 hours', date_trunc('hour', now()) + interval '31 hours');
insert into public.appointment_participants (appointment_id, client_id, org_id)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_state(current_setting('test.d1')::uuid, 'accepted');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select array_agg(id order by id) from public.my_clients),
  array['d0000000-0000-0000-0000-000000000003']::uuid[], 'unmatched, but an appointment of hers with the file: she keeps it');

-- Two matched requests for one file: the link goes with the last one.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d3', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000004"}')::text, true);
select set_config('test.d4', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000004"}')::text, true);
select public.set_demande_state(current_setting('test.d3')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d3')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001');
select public.set_demande_state(current_setting('test.d4')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d4')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001');
select public.set_demande_state(current_setting('test.d3')::uuid, 'accepted');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok('d0000000-0000-0000-0000-000000000004'::uuid in (select id from public.my_clients),
  'one request unmatched, another still matched to her for the file: she keeps it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_state(current_setting('test.d4')::uuid, 'closed', 'withdrew');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok('d0000000-0000-0000-0000-000000000004'::uuid not in (select id from public.my_clients),
  'the last one closed: she no longer sees the file');
reset role;

-- A link of another reason (she created the file) is never Demandes' to remove.
select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000005',
                                         'c0000000-0000-0000-0000-000000000001', 'created');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d5', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000005"}')::text, true);
select public.set_demande_state(current_setting('test.d5')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d5')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001');
select public.set_demande_state(current_setting('test.d5')::uuid, 'accepted');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok('d0000000-0000-0000-0000-000000000005'::uuid in (select id from public.my_clients),
  'a file she created: unmatching never removes it');
reset role;

-- Re-matched to another professional: the first one no longer sees the file.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d6', public.create_demande('{"client_id": "d0000000-0000-0000-0000-000000000002"}')::text, true);
select public.set_demande_state(current_setting('test.d6')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d6')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001');
select public.set_demande_state(current_setting('test.d6')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d6')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok('d0000000-0000-0000-0000-000000000002'::uuid not in (select id from public.my_clients),
  're-matched to another: P1 no longer sees the file');
reset role;
select results_eq($$ select professional_id, primary_professional_id from public.client_professional_links l
                      join public.clients c on c.id = l.client_id where l.client_id = 'd0000000-0000-0000-0000-000000000002' $$,
  $$ values ('c0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid) $$,
  '… the new one does, and is its primary professional');

-- =============================================================================
-- 3, 4. The anonymisation and the audit
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d7', public.create_demande(jsonb_build_object(
  'client_id', 'd0000000-0000-0000-0000-000000000006', 'contact_name', 'Félix Six', 'concerns', 'Sf-concerns secret',
  'payer_kind', 'insurance', 'insurer', 'Sf-assureur secret', 'has_issues', true, 'issues', array['coparenting'],
  'issues_comment', 'Sf-issues secret', 'previous_therapy', true, 'previous_comment', 'Sf-previous secret',
  'has_legal_context', true, 'legal_context', array['court_order'], 'legal_detail', 'Sf-legal secret',
  'motif_other', 'Sf-motif secret', 'availability_other', 'Sf-dispo secret'))::text, true);
select public.set_demande_note(current_setting('test.d7')::uuid, 'Sf-note secret');
reset role;
update public.demandes set source_referrer = 'https://sf-referrer.test/', source_landing_page = 'https://sf-landing.test/'
 where id = current_setting('test.d7')::uuid;
insert into public.waitlist_entries (id, org_id, demande_id, client_id, target_professional_id, priority, priority_reason, fee_status, fee_waived_reason)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', current_setting('test.d7')::uuid,
        'd0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 'priority', 'Sf-priorite secret', 'waived', 'Sf-exoneration secret');

select is((select count(*)::int from public.audit_log a where a.table_name = 'demandes' and a.record_id = current_setting('test.d7')
             and (strpos(a::text, 'Sf-assureur') > 0 or strpos(a::text, 'Sf-dispo') > 0 or strpos(a::text, 'court_order') > 0
                  or strpos(a::text, 'coparenting') > 0)), 0,
  'the insurer, « Autres disponibilités », the legal context and the issues never reach the journal');
select ok((select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.demandes'::regclass and t.tgname = 'demandes_audit')
            ~ '''has_legal_context''.*''has_issues''', '… nor do the yes / no answers before them');

select ok(private.demandes_anonymize_client('d0000000-0000-0000-0000-000000000006') > 0, 'the anonymisation handler runs');
select results_eq($$ select contact_name, concerns, insurer, issues_comment, previous_comment, legal_detail, legal_context,
                            motif_other, availability_other, source_referrer, source_landing_page
                       from public.demandes where id = current_setting('test.d7')::uuid $$,
  $$ values (null::text, null::text, null::text, null::text, null::text, null::text, '{}'::text[],
             null::text, null::text, null::text, null::text) $$,
  'the request''s free text, insurer and source are blanked');
select is((select count(*)::int from public.demande_notes where demande_id = current_setting('test.d7')::uuid), 0, 'its internal note is deleted');
select results_eq($$ select priority, priority_reason, fee_status, fee_waived_reason from public.waitlist_entries
                      where id = 'f0000000-0000-0000-0000-000000000001' $$,
  $$ values ('priority'::text, 'Anonymisé'::text, 'waived'::text, 'Anonymisé'::text) $$,
  'the waiting list''s reasons are replaced (the priority and the waiver stay)');

-- =============================================================================
-- 8. An offer's slots are stored rebuilt
-- =============================================================================
insert into public.waitlist_entries (id, org_id, demande_id, client_id, target_professional_id, state, fee_status)
values ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', current_setting('test.d1')::uuid,
        'd0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'active', 'paid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.offer', public.add_waitlist_offer('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
  '[{"starts_at": "2026-11-02T14:00:00Z", "ends_at": "2026-11-02T15:00:00Z", "note": "<b>ailleurs</b>"}]')::text, true);
reset role;
select results_eq($$ select (select array_agg(k order by k) from jsonb_object_keys(o.slots -> 0) k),
                            (o.slots -> 0 ->> 'starts_at')::timestamptz, (o.slots -> 0 ->> 'ends_at')::timestamptz
                       from public.waitlist_offers o where o.id = current_setting('test.offer')::uuid $$,
  $$ values (array['ends_at', 'starts_at'], '2026-11-02T14:00:00Z'::timestamptz, '2026-11-02T15:00:00Z'::timestamptz) $$,
  'only the start and the end are stored');

-- =============================================================================
-- 9. The « still waiting? » link names a professional's list
-- =============================================================================
update public.waitlist_entries set state = 'to_call' where id = 'f0000000-0000-0000-0000-000000000001';
select set_config('test.wl', private.issue_secure_link('b0000000-0000-0000-0000-00000000000a', 'waitlist_followup', 'waitlist_entry',
  'f0000000-0000-0000-0000-000000000001', sha256('sf-wl'::bytea), null, interval '7 days', '{}')::text, true);
set local role service_role;
select is(public.resolve_waitlist_followup_link(current_setting('test.wl')::uuid) ->> 'list_name',
  'Hélène Psy', 'the job''s link names her list (no user: her published display facts)');
reset role;

-- =============================================================================
-- 6. « Facturer l'inscription » while reserved: no P3-40 refusal any more (D-52, pgTAP 240: the
--    invoice is made, its email held); here Facturation is off, so its own refusal answers
-- =============================================================================
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
insert into public.org_module_testers (org_id, module_key, user_id)
values ('b0000000-0000-0000-0000-00000000000a', 'demandes', 'a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.invoice_waitlist_fee('f0000000-0000-0000-0000-000000000002') $$), 'billing',
  'Demandes reserved for its testers: no longer refused for P3-40 (D-52)');
select throws_ok($$ select public.invoice_waitlist_fee('f0000000-0000-0000-0000-000000000002') $$, 'P0001',
  'La Facturation n''est pas activée : notez les frais à la main (payés ou exonérés).', '… Facturation off answers, in French');
reset role;

select * from finish();
rollback;
