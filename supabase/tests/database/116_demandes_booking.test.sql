-- Demandes: the public discovery-call booking (migration *_demandes_booking.sql, plan D3c, R-74).
-- Covers: privileges (the page's RPCs for the service role only, the settings for authenticated);
-- the weekly rule (defaults off, saved whole, French refusals with their field, permissions); the
-- page closed while booking is off, the module reserved for its testers (P3-40) or unknown; the free
-- slots (the rule, the notice, the horizon, the capacity); a booking (a « Nouvelle » request on the
-- booking channel with its source: answer, utm_*, referrer, landing page; its discovery call; the
-- cancel link; the slot taken); refusals (slot taken, a bad email, closed); the same address
-- answered like a booking (security review 2026-10-14); the cancel
-- link (resolve, cancel once, the request closed « s'est retirée », the slot free again); the
-- reportable view (staff only); the landing page redacted in the audit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

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

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', f.name, f.args, 'service_role', array['EXECUTE'], f.name || ': the service role')
  from (values ('demandes_booking_page_for_service', array['uuid']),
               ('book_discovery_call_for_service', array['uuid', 'jsonb', 'bytea']),
               ('cancel_discovery_call_for_service', array['bytea']),
               ('resolve_discovery_call_link', array['uuid'])) as f(name, args);
select function_privs_are('public', f.name, f.args, 'authenticated', array[]::text[], f.name || ': never a signed-in user')
  from (values ('demandes_booking_page_for_service', array['uuid']),
               ('book_discovery_call_for_service', array['uuid', 'jsonb', 'bytea']),
               ('cancel_discovery_call_for_service', array['bytea'])) as f(name, args);
select function_privs_are('public', f.name, f.args, 'authenticated', array['EXECUTE'], f.name || ': authenticated')
  from (values ('get_demandes_booking_settings', array[]::text[]), ('set_demandes_booking_settings', array['jsonb'])) as f(name, args);
select table_privs_are('public', 'demandes_sources', 'authenticated', array['SELECT'], 'demandes_sources: read only');

-- =============================================================================
-- Fixtures: clinic A (admin, provider), Clients and Demandes on; a referral source
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@book.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@book.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Clinique A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@book.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@book.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000a', 'demandes', true);
insert into public.referral_sources (id, org_id, key, name) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'instagram_test', 'Instagram (test)');

-- =============================================================================
-- The weekly rule
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (s ->> 'enabled')::boolean, (s ->> 'slot_minutes')::int, jsonb_array_length(s -> 'weekly') from public.get_demandes_booking_settings() s $$,
  $$ values (false, 15, 9) $$, 'defaults: off, 15 minutes, weekdays');
select is(private.test_error_hint($$ select public.set_demandes_booking_settings('{"slot_minutes": 17}') $$), 'slot_minutes', 'a slot of 17 minutes: refused');
select is(private.test_error_hint($$ select public.set_demandes_booking_settings(
  '{"weekly": [{"day": 1, "start": "09:00", "end": "12:00"}, {"day": 1, "start": "11:00", "end": "13:00"}]}') $$), 'weekly', 'two ranges of one day overlap: refused');
select is(private.test_error_hint($$ select public.set_demandes_booking_settings('{"weekly": [{"day": 8, "start": "09:00", "end": "12:00"}]}') $$), 'weekly', 'an unknown day: refused');
select is(private.test_error_hint($$ select public.set_demandes_booking_settings('{"colour": "red"}') $$), '22023', 'an unknown key: 22023');
-- Every day, all day, hourly, no notice, two days ahead, one call at a time.
select is((public.set_demandes_booking_settings(
  '{"enabled": true, "slot_minutes": 60, "notice_hours": 0, "horizon_days": 2, "capacity": 1,
    "weekly": [{"day": 1, "start": "00:00", "end": "24:00"}, {"day": 2, "start": "00:00", "end": "24:00"},
               {"day": 3, "start": "00:00", "end": "24:00"}, {"day": 4, "start": "00:00", "end": "24:00"},
               {"day": 5, "start": "00:00", "end": "24:00"}, {"day": 6, "start": "00:00", "end": "24:00"},
               {"day": 7, "start": "00:00", "end": "24:00"}]}') ->> 'enabled')::boolean, true, 'saved whole, switched on');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_demandes_booking_settings() $$, '42501', 'Permission refusée : demandes.view', 'a professional does not read the rule');
reset role;

-- =============================================================================
-- The page and its slots
-- =============================================================================
set local role service_role;
create temporary table page as select public.demandes_booking_page_for_service('b0000000-0000-0000-0000-00000000000a') as p;
select is((select (p ->> 'open')::boolean from page), true, 'the page is open');
select ok((select jsonb_array_length(p -> 'slots') between 40 and 49 from page), 'hourly slots over two days');
select ok((select bool_and((s #>> '{}')::timestamptz > now() and (s #>> '{}')::timestamptz <= now() + interval '2 days'
                           and extract(minute from ((s #>> '{}')::timestamptz at time zone 'America/Toronto')) = 0)
             from page, jsonb_array_elements(p -> 'slots') s), 'every slot within notice and horizon, on the hour in the clinic''s time');
select is((select p -> 'referral_sources' -> 0 ->> 'name' from page), 'Instagram (test)', 'the « Comment avez-vous entendu parler de MANA ? » list');
select is((public.demandes_booking_page_for_service('b0000000-0000-0000-0000-0000000000ff') ->> 'open')::boolean, false, 'an unknown clinic reads as closed');
reset role;
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role service_role;
select is((public.demandes_booking_page_for_service('b0000000-0000-0000-0000-00000000000a') ->> 'open')::boolean, false,
  'P3-40: reserved for its testers, the page offers nothing');
select set_config('test.slot', (select p -> 'slots' ->> 3 from page), true);
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', 'Camille', 'last_name', 'Essai', 'email', 'camille@exemple.test', 'phone_e164', '+15145550101'),
  sha256('t-closed'::bytea)) $$, current_setting('test.slot'))), 'closed', '… and a booking is refused: nobody outside the clinic is written to');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';

-- =============================================================================
-- A booking
-- =============================================================================
set local role service_role;
select set_config('test.booked', public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', current_setting('test.slot'), 'first_name', ' Camille ', 'last_name', 'Essai', 'email', 'Camille@Exemple.test',
                     'phone_e164', '+15145550101', 'language', 'fr', 'message', 'Pour mon fils.',
                     'referral_source_id', 'c0000000-0000-0000-0000-000000000001',
                     'source_utm', jsonb_build_object('utm_source', 'instagram', 'utm_medium', 'social', 'utm_campaign', 'automne', 'utm_evil', 'x'),
                     'source_referrer', 'https://www.exemple-site.test/services', 'source_landing_page', 'https://www.exemple-site.test/?utm_source=instagram'),
  sha256('t-cancel-1'::bytea))::text, true);
reset role;
select set_config('test.demande', current_setting('test.booked')::jsonb ->> 'demande_id', true);
select results_eq($$ select channel, state, contact_name, contact_email, contact_phone_e164, concerns, assigned_to is null
                       from public.demandes where id = current_setting('test.demande')::uuid $$,
  $$ values ('booking_page', 'new', 'Camille Essai', 'camille@exemple.test', '+15145550101', 'Pour mon fils.', true) $$,
  'a « Nouvelle » request on the booking channel, in the shared inbox');
select results_eq($$ select referral_source_id, source_campaign, source_utm, source_referrer, source_landing_page
                       from public.demandes where id = current_setting('test.demande')::uuid $$,
  $$ values ('c0000000-0000-0000-0000-000000000001'::uuid, 'automne',
             '{"utm_source": "instagram", "utm_medium": "social", "utm_campaign": "automne"}'::jsonb,
             'https://www.exemple-site.test/services', 'https://www.exemple-site.test/?utm_source=instagram') $$,
  'its source: the answer, the campaign, utm_* only, the referrer and the landing page (R-74)');
select results_eq($$ select kind, state, due_at from public.demande_tasks where demande_id = current_setting('test.demande')::uuid $$,
  $$ values ('discovery_call', 'open', current_setting('test.slot')::timestamptz) $$, 'its discovery call at the slot');
select is((select count(*)::int from public.secure_links where purpose = 'discovery_call' and token_hash = sha256('t-cancel-1'::bytea)
             and expires_at >= current_setting('test.slot')::timestamptz - interval '1 minute'), 1, 'its cancel link, valid until the call');
select ok((current_setting('test.booked')::jsonb ->> 'reference') ~ '^DEM-[0-9]{4}-[0-9]+$', 'its reference');
set local role service_role;
select ok(not exists (select 1 from jsonb_array_elements(public.demandes_booking_page_for_service('b0000000-0000-0000-0000-00000000000a') -> 'slots') s
                       where (s #>> '{}')::timestamptz = current_setting('test.slot')::timestamptz), 'the slot is no longer offered (capacity 1)');
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', 'Autre', 'last_name', 'Personne', 'email', 'autre@exemple.test', 'phone_e164', '+15145550102'),
  sha256('t-2'::bytea)) $$, current_setting('test.slot'))), 'slot', 'the same slot again: refused');
select is((public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', (select p -> 'slots' ->> 5 from page), 'first_name', 'Camille', 'last_name', 'Essai', 'email', 'camille@exemple.test', 'phone_e164', '+15145550101'),
  sha256('t-3'::bytea)) ->> 'task_id'), current_setting('test.booked')::jsonb ->> 'task_id',
  'a second call with the same address: answered like a booking, for the earlier call (never told apart; its cancel link renewed)');
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', 'Bob', 'last_name', 'Roy', 'email', 'pas un courriel', 'phone_e164', '+15145550103'),
  sha256('t-4'::bytea)) $$, (select p -> 'slots' ->> 6 from page))), 'email', 'an unreadable email: refused with its field');
select is(private.test_error_hint(format($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', %L, 'first_name', 'Bob', 'last_name', 'Roy', 'email', 'bob@exemple.test'),
  sha256('t-5'::bytea)) $$, (select p -> 'slots' ->> 6 from page))), 'phone', 'no phone: refused (the counselor calls)');
select is(private.test_error_hint($$ select public.book_discovery_call_for_service('b0000000-0000-0000-0000-00000000000a',
  jsonb_build_object('starts_at', '2020-01-01T12:00:00Z', 'first_name', 'Bob', 'last_name', 'Roy', 'email', 'bob@exemple.test', 'phone_e164', '+15145550103'),
  sha256('t-6'::bytea)) $$), 'slot', 'a time outside the rule: refused');
reset role;

-- The landing page and the referrer never reach the journal.
select is((select count(*)::int from public.audit_log a where a.table_name = 'demandes' and a.record_id = current_setting('test.demande')
             and (strpos(a::text, 'exemple-site.test') > 0 or strpos(a::text, 'camille@') > 0)), 0, 'the source and the contact are redacted in the audit');

-- =============================================================================
-- The reportable view
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select channel, referral_source_name, utm_source, utm_medium, utm_campaign, source_landing_page is not null
                       from public.demandes_sources where id = current_setting('test.demande')::uuid $$,
  $$ values ('booking_page', 'Instagram (test)', 'instagram', 'social', 'automne', true) $$, 'demandes_sources: the source, reportable');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.demandes_sources $$, 'a professional reads none of it');
reset role;

-- =============================================================================
-- Cancelling
-- =============================================================================
-- The second booking with the same address renewed the call's cancel link (t-3).
select set_config('test.link', (select id::text from public.secure_links where token_hash = sha256('t-3'::bytea)), true);
set local role service_role;
select is((public.resolve_discovery_call_link(current_setting('test.link')::uuid) ->> 'starts_at')::timestamptz,
  current_setting('test.slot')::timestamptz, 'resolve-link shows the call''s time');
select is(public.cancel_discovery_call_for_service(sha256('t-cancel-1'::bytea)) ->> 'state', 'invalid', 'the renewed link replaced the first');
select is(public.cancel_discovery_call_for_service(sha256('t-3'::bytea)) ->> 'state', 'cancelled', 'cancelled by its link');
reset role;
select results_eq($$ select d.state, d.closed_reason, t.state from public.demandes d join public.demande_tasks t on t.demande_id = d.id
                      where d.id = current_setting('test.demande')::uuid $$,
  $$ values ('closed', 'withdrew', 'cancelled') $$, 'the call is cancelled and the request closed « s''est retirée »');
set local role service_role;
select is(public.cancel_discovery_call_for_service(sha256('t-3'::bytea)) ->> 'state', 'invalid', 'the link works once');
select ok(exists (select 1 from jsonb_array_elements(public.demandes_booking_page_for_service('b0000000-0000-0000-0000-00000000000a') -> 'slots') s
                   where (s #>> '{}')::timestamptz = current_setting('test.slot')::timestamptz), 'the slot is free again');
reset role;

select * from finish();
rollback;
