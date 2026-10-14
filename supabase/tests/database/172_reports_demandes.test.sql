-- Rapports « Indicateurs des demandes » (Demandes D6; migrations *_demandes_report_facts,
-- *_professionals_catalogue_names, *_appointments_first_after, *_reports_demandes): privileges;
-- the totals (activity and cohort, a duplicate apart, the promise's five states), weeks (a Sunday
-- night in Toronto stays in its week) and months, channels, counselors, outcomes, matches per
-- professional and per week; the sources; the delays; first appointments cancelled (once each, a
-- match before the period, never a later appointment); the waiting list (people, not entries;
-- incomplete apart); the places; another clinic never counted; the permissions, Demandes off, the
-- period's rules.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

select function_privs_are('public', 'report_demandes', array['date', 'date'], 'authenticated', array['EXECUTE'], 'report_demandes: users');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_report_requests', 'demandes_report_matches', 'demandes_report_waitlist', 'demandes_report_capacity',
                       'appointments_first_after', 'appointments_cancelled_between', 'clientele_names', 'profession_title_names')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the published facts: no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@rd.test'), ('a0000000-0000-0000-0000-000000000004', 'conseillere@rd.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'), ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@rd.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@rd.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select o, m, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o)
 cross join (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports'), ('demandes')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@rd.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Deux', 'p2@rd.test', 'active'),
  ('c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Pro', 'Ailleurs', 'pb@rd.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Rapport'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Rapport'),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Émile', 'Rapport'),
  ('d0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'Bob', 'Ailleurs');
insert into public.referral_sources (id, org_id, key, name) values
  ('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'zz_rd_google', 'Google (test)');
select set_config('test.title', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' order by key limit 1), true);
select set_config('test.title_name', (select name from public.profession_titles where id = current_setting('test.title')::uuid), true);

-- September 2026 (Tue Sep 1 … Wed Sep 30), Org A:
--   R1 Sep 2, phone, Google, « automne », facebook / cpc, from www.google.com; called 3 h later; matched Sep 4 to
--      Pro Un, « Jumelée » again Sep 6 (same professional).
--   R2 Sep 9, web form, never called, closed « Sans réponse ».
--   R3 Aug 20 (outside), Chloé, matched Sep 3 to Pro Deux.
--   R4 Sep 10 (Thursday), email; first message Tue Sep 15 (72 business hours); on Pro Un's list, « Prioritaire ».
--   R5 Jul 1 (outside), Émile, matched Aug 15 (before the period) to Pro Deux.
--   R6 Sunday Sep 13 23:30 in Toronto (Monday in UTC), sms, never called, still « Nouvelle »; incomplete on a profession's list.
--   R7 Sep 15, closed as a duplicate.
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_name, received_at, received_by, channel,
                             referral_source_id, source_campaign, source_utm, source_referrer, client_id, state, closed_reason, closed_at,
                             matched_professional_id, matched_at)
values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0001', 2026, 1, 'R Un', '2026-09-02 14:00Z',
   'a0000000-0000-0000-0000-000000000004', 'phone', 'a1000000-0000-0000-0000-000000000001', 'automne',
   '{"utm_source": "facebook", "utm_medium": "cpc"}', 'https://www.Google.com/search?q=psy', 'd0000000-0000-0000-0000-000000000001',
   'matched', null, null, 'c0000000-0000-0000-0000-000000000001', '2026-09-06 14:00Z'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0002', 2026, 2, 'R Deux', '2026-09-09 14:00Z',
   null, 'web_form', null, null, '{}', null, null, 'closed', 'no_answer', '2026-09-20 14:00Z', null, null),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0003', 2026, 3, 'R Trois', '2026-08-20 14:00Z',
   'a0000000-0000-0000-0000-000000000004', 'phone', null, null, '{}', null, 'd0000000-0000-0000-0000-000000000003',
   'matched', null, null, 'c0000000-0000-0000-0000-000000000002', '2026-09-03 14:00Z'),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0004', 2026, 4, 'R Quatre', '2026-09-10 14:00Z',
   'a0000000-0000-0000-0000-000000000004', 'email', null, null, '{}', null, null, 'waitlist', null, null, null, null),
  ('e1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0005', 2026, 5, 'R Cinq', '2026-07-01 14:00Z',
   null, 'phone', null, null, '{}', null, 'd0000000-0000-0000-0000-000000000005',
   'matched', null, null, 'c0000000-0000-0000-0000-000000000002', '2026-08-15 14:00Z'),
  ('e1000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0006', 2026, 6, 'R Six', '2026-09-14 03:30Z',
   null, 'sms', null, null, '{}', null, null, 'new', null, null, null, null),
  ('e1000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0007', 2026, 7, 'R Sept', '2026-09-15 14:00Z',
   null, 'phone', null, null, '{}', null, null, 'closed', 'duplicate', '2026-09-15 15:00Z', null, null),
  ('e1000000-0000-0000-0000-0000000000bb', 'b0000000-0000-0000-0000-00000000000b', 'DEM-2026-9001', 2026, 9001, 'R Ailleurs', '2026-09-05 14:00Z',
   null, 'phone', null, null, '{}', null, 'd0000000-0000-0000-0000-00000000000b',
   'matched', null, null, 'c0000000-0000-0000-0000-00000000000b', '2026-09-06 14:00Z');
insert into public.demande_events (demande_id, org_id, kind, to_state, contact_channel, contact_outcome, professional_id, at) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'contact', null, 'phone', 'reached', null, '2026-09-02 17:00Z'),
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-000000000001', '2026-09-04 14:00Z'),
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-000000000001', '2026-09-06 14:00Z'),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-000000000002', '2026-09-03 14:00Z'),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'contact', null, 'email', 'message_sent', null, '2026-09-15 14:00Z'),
  ('e1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-000000000002', '2026-08-15 14:00Z'),
  ('e1000000-0000-0000-0000-0000000000bb', 'b0000000-0000-0000-0000-00000000000b', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-00000000000b', '2026-09-06 14:00Z');
insert into public.waitlist_entries (org_id, demande_id, target_professional_id, target_profession_title_id, priority, priority_reason,
                                     registered_at, language, state, fee_status, fee_waived_reason)
values ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', null,
        'priority', 'Test', '2026-09-11 14:00Z', 'fr', 'active', 'waived', 'Test'),
       ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000006', null, current_setting('test.title')::uuid,
        'normal', null, '2026-09-14 14:00Z', 'fr', 'incomplete', 'to_invoice', null);

-- Appointments (50 min, « Plus requis »):
--   Alice / Pro Un: the first after both of R1's matches, Sep 20, cancelled Sep 19 (24 h): counted once.
--   Émile / Pro Deux: the first after R5's August match, Sep 10, cancelled Sep 9: counted (the match's date does not matter).
--   Chloé / Pro Deux: Sep 8 completed (her first), Sep 15 cancelled Sep 14: not a first appointment.
--   Bob / Pro Ailleurs (Org B): Sep 12 cancelled Sep 11: another clinic.
create function pg_temp.appt(p_id uuid, p_org uuid, p_pro uuid, p_client uuid, p_starts timestamptz, p_state text, p_cancelled timestamptz)
returns void language sql as $$
  insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, is_personal,
                                   cancelled_at, cancel_reason_id, cancel_late, completed_at)
  select p_id, p_org, p_pro, s.id, p_starts, p_starts + interval '50 minutes', p_starts + interval '1 hour', p_state, false,
         p_cancelled, case when p_state = 'cancelled' then r.id end, case when p_state = 'cancelled' then false end,
         case when p_state = 'completed' then p_starts + interval '50 minutes' end
    from public.services s, public.cancellation_reasons r
   where s.org_id = p_org and s.code = 10150 and r.org_id = p_org and r.key = 'no_longer_needed';
  insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence) values (p_id, p_client, p_org, 'client', 'expected');
$$;
select pg_temp.appt('e2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
                    'd0000000-0000-0000-0000-000000000001', '2026-09-20 15:00Z', 'cancelled', '2026-09-19 15:00Z');
select pg_temp.appt('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
                    'd0000000-0000-0000-0000-000000000005', '2026-09-10 15:00Z', 'cancelled', '2026-09-09 15:00Z');
select pg_temp.appt('e2000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
                    'd0000000-0000-0000-0000-000000000003', '2026-09-08 15:00Z', 'completed', null);
select pg_temp.appt('e2000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
                    'd0000000-0000-0000-0000-000000000003', '2026-09-15 15:00Z', 'cancelled', '2026-09-14 15:00Z');
select pg_temp.appt('e2000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b',
                    'd0000000-0000-0000-0000-00000000000b', '2026-09-12 15:00Z', 'cancelled', '2026-09-11 15:00Z');

-- Places: Sep 7 and Sep 28 photos (Org B's never count).
insert into public.capacity_snapshots (org_id, professional_id, snapshot_on, places_declared, places_used, places_left, accepting_new_clients) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '2026-09-07', 3, 1, 2, true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', '2026-09-07', 2, 0, 2, true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '2026-09-28', 3, 3, 0, true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', '2026-09-28', 2, 1, 1, true),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', '2026-09-29', 9, 0, 9, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.report_demandes('2026-09-01', '2026-09-30')::text, true);
create function pg_temp.part(p_key text, p_strip text default 'id') returns jsonb language sql as $$
  select coalesce(pg_catalog.jsonb_agg(x - p_strip), '[]') from jsonb_array_elements(current_setting('test.r')::jsonb -> p_key) x
$$;

select is(current_setting('test.r')::jsonb -> 'totals',
  '{"received": 4, "duplicates": 1, "matched_activity": 3, "activity_rate": 75.0, "matched_cohort": 1, "cohort_rate": 25.0,
    "contacted_on_time": 1, "contacted_late": 1, "pending": 0, "overdue": 1, "no_attempt": 1, "waitlisted": 2}'::jsonb,
  'the totals: a duplicate apart; activity 3 ÷ 4, cohort 1 of 4; the promise''s states; the waiting list');
select is(current_setting('test.r')::jsonb -> 'weeks',
  '[{"week_start": "2026-08-31", "received": 1, "matched": 3, "first_cancelled": 0},
    {"week_start": "2026-09-07", "received": 3, "matched": 0, "first_cancelled": 1},
    {"week_start": "2026-09-14", "received": 0, "matched": 0, "first_cancelled": 1},
    {"week_start": "2026-09-21", "received": 0, "matched": 0, "first_cancelled": 0},
    {"week_start": "2026-09-28", "received": 0, "matched": 0, "first_cancelled": 0}]'::jsonb,
  'per week, Monday first: a Sunday 23:30 in Toronto stays in its week; first appointments by cancellation date');
select is(current_setting('test.r')::jsonb -> 'months',
  '[{"month_start": "2026-09-01", "received": 4, "matched": 3, "first_cancelled": 2}]'::jsonb, 'per month');
select is(current_setting('test.r')::jsonb -> 'by_channel',
  '[{"channel": "email", "received": 1, "matched": 0}, {"channel": "phone", "received": 1, "matched": 1},
    {"channel": "sms", "received": 1, "matched": 0}, {"channel": "web_form", "received": 1, "matched": 0}]'::jsonb,
  'per channel, with the cohort matched; the duplicate is not a request');
select is(pg_temp.part('by_counselor'), '[{"name": "Conseillère A", "received": 2}, {"name": null, "received": 2}]'::jsonb, 'who took the requests');
select is(pg_temp.part('by_professional'), '[{"name": "Pro Un", "matched": 2}, {"name": "Pro Deux", "matched": 1}]'::jsonb,
  'the period''s matches per professional (a « Jumelée » again counts again)');
select is(pg_temp.part('by_professional_week'),
  '[{"week_start": "2026-08-31", "name": "Pro Un", "matched": 2}, {"week_start": "2026-08-31", "name": "Pro Deux", "matched": 1}]'::jsonb,
  'matches per professional per week');
select is((select pg_catalog.jsonb_agg(o order by o ->> 'state', o ->> 'closed_reason') from jsonb_array_elements(current_setting('test.r')::jsonb -> 'outcomes') o),
  '[{"state": "closed", "count": 1, "closed_reason": "duplicate"}, {"state": "closed", "count": 1, "closed_reason": "no_answer"},
    {"state": "matched", "count": 1, "closed_reason": null}, {"state": "new", "count": 1, "closed_reason": null},
    {"state": "waitlist", "count": 1, "closed_reason": null}]'::jsonb, 'every request of the period by state and reason, the duplicate shown');

-- Sources (R-74).
select is(pg_temp.part('by_source'), '[{"name": null, "received": 3, "matched": 0}, {"name": "Google (test)", "received": 1, "matched": 1}]'::jsonb,
  '« Comment avez-vous entendu parler de MANA ? »');
select is(current_setting('test.r')::jsonb -> 'by_campaign', '[{"name": "automne", "received": 1, "matched": 1, "other": false}]'::jsonb, 'the campaign');
select is(current_setting('test.r')::jsonb -> 'by_utm',
  '[{"source": "facebook", "medium": "cpc", "received": 1, "matched": 1, "other": false}]'::jsonb, 'utm_source / utm_medium');
select is(current_setting('test.r')::jsonb -> 'by_referrer', '[{"host": "google.com", "received": 1, "matched": 1, "other": false}]'::jsonb,
  'the referrer''s host, lower case, without www');

select is(current_setting('test.r')::jsonb -> 'delays',
  '{"first_contact_hours": {"count": 2, "median": 37.5, "average": 37.5}, "proposal_days": {"count": 0, "median": null, "average": null},
    "match_days": {"count": 1, "median": 2.0, "average": 2.0}}'::jsonb, 'received → first contact (business hours), → proposal, → match (days)');

select is((current_setting('test.r')::jsonb -> 'first_appointments') - 'by_professional',
  '{"matched": 3, "cancelled": 2, "rate": 66.7, "notice_hours": {"average": 24.0, "min": 24.0, "max": 24.0},
    "lead_days": {"average": 20.0, "min": 14.0, "max": 26.0}, "by_reason": [{"name": "Plus requis", "count": 2}]}'::jsonb,
  'first appointments cancelled: once each (two matches, one appointment), a match before the period, never a later appointment');
select is((select pg_catalog.jsonb_agg(x - 'id') from jsonb_array_elements(current_setting('test.r')::jsonb -> 'first_appointments' -> 'by_professional') x),
  '[{"name": "Pro Deux", "count": 1}, {"name": "Pro Un", "count": 1}]'::jsonb, '… per professional');

select is((current_setting('test.r')::jsonb -> 'waitlist') - 'open',
  '{"waiting_total": 1, "incomplete_total": 1, "registered": 2, "exits": [], "wait_days": {"count": 0, "average": null, "median": null}}'::jsonb,
  'the waiting list counts people: one waiting, one whose registration is incomplete');
select is((select pg_catalog.jsonb_agg(x - 'id') from jsonb_array_elements(current_setting('test.r')::jsonb -> 'waitlist' -> 'open') x),
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('target_kind', 'title', 'name', current_setting('test.title_name'), 'waiting', 0, 'incomplete', 1, 'priority', 0),
    '{"target_kind": "professional", "name": "Pro Un", "waiting": 1, "incomplete": 0, "priority": 1}'::jsonb),
  'per list, with the incomplete apart and « Prioritaire »');

select is((current_setting('test.r')::jsonb -> 'places') - 'by_professional',
  '{"snapshot_on": "2026-09-28", "total_left": 1, "tracked": 2,
    "weeks": [{"week_start": "2026-09-07", "snapshot_on": "2026-09-07", "total_left": 4}, {"week_start": "2026-09-28", "snapshot_on": "2026-09-28", "total_left": 1}]}'::jsonb,
  'places: the last photo of this clinic, the first photo of each week');

-- Rules and permissions.
select throws_ok($$ select public.report_demandes('2026-09-30', '2026-09-01') $$, 'P0001', null, 'a period the wrong way round');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'the conseillère: reports.demandes_indicators opens it (R-81)');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'P0001',
  'Activez d''abord Demandes : ce rapport lit ses demandes.', 'Demandes off: said plainly');
reset role;

select * from finish();
rollback;
