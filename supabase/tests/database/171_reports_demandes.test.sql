-- Rapports « Demandes » (Demandes D6; migrations *_demandes_report_facts, *_appointments_first_after,
-- *_reports_demandes): privileges; the totals (activity and cohort, the promise), weeks, channels,
-- outcomes, matches per professional; the sources (D3c's capture: source, campaign, utm, referrer
-- host); the delays; a first appointment cancelled after a match; the waiting list; the places;
-- the permissions, Demandes off, the period's rules.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select function_privs_are('public', 'report_demandes', array['date', 'date'], 'authenticated', array['EXECUTE'], 'report_demandes: users');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_report_requests', 'demandes_report_matches', 'demandes_report_waitlist', 'demandes_report_capacity',
                       'appointments_first_after')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the published facts: no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e, '', now(), '{}', '{}', now(), now()
  from (values ('a0000000-0000-0000-0000-000000000001', 'admin@rd.test'), ('a0000000-0000-0000-0000-000000000004', 'conseillere@rd.test')) as v(u, e);
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@rd.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@rd.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports'), ('demandes')) as y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@rd.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Deux', 'p2@rd.test', 'active');
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Rapport'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Rapport');
insert into public.referral_sources (id, org_id, key, name) values
  ('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'zz_rd_google', 'Google (test)');

-- September 2026 (Wed Sep 2 … Wed Sep 30):
--   R1 Sep 2, phone, Google, « automne », facebook / cpc, from www.google.com; called 3 h later; matched Sep 4 to Pro Un.
--   R2 Sep 9, web form, never called, closed « Sans réponse ».
--   R3 Aug 20 (outside), matched Sep 3 to Pro Deux: an activity match, not the period's cohort.
--   R4 Sep 10 (Thursday), email; first call 3 business days later (Tue Sep 15); on the waiting list.
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_name, received_at, received_by, channel,
                             referral_source_id, source_campaign, source_utm, source_referrer, client_id, state, closed_reason, closed_at,
                             matched_professional_id, matched_at)
values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0001', 2026, 1, 'R Un', '2026-09-02 14:00Z',
   'a0000000-0000-0000-0000-000000000004', 'phone', 'a1000000-0000-0000-0000-000000000001', 'automne',
   '{"utm_source": "facebook", "utm_medium": "cpc"}', 'https://www.Google.com/search?q=psy', 'd0000000-0000-0000-0000-000000000001',
   'matched', null, null, 'c0000000-0000-0000-0000-000000000001', '2026-09-04 14:00Z'),
  ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0002', 2026, 2, 'R Deux', '2026-09-09 14:00Z',
   null, 'web_form', null, null, '{}', null, null, 'closed', 'no_answer', '2026-09-20 14:00Z', null, null),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0003', 2026, 3, 'R Trois', '2026-08-20 14:00Z',
   'a0000000-0000-0000-0000-000000000004', 'phone', null, null, '{}', null, 'd0000000-0000-0000-0000-000000000003',
   'matched', null, null, 'c0000000-0000-0000-0000-000000000002', '2026-09-03 14:00Z'),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0004', 2026, 4, 'R Quatre', '2026-09-10 14:00Z',
   'a0000000-0000-0000-0000-000000000004', 'email', null, null, '{}', null, null, 'waitlist', null, null, null, null);
insert into public.demande_events (demande_id, org_id, kind, to_state, contact_channel, contact_outcome, professional_id, at) values
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'contact', null, 'phone', 'reached', null, '2026-09-02 17:00Z'),
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-000000000001', '2026-09-04 14:00Z'),
  ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'state_changed', 'matched', null, null,
   'c0000000-0000-0000-0000-000000000002', '2026-09-03 14:00Z'),
  ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'contact', null, 'email', 'message_sent', null, '2026-09-15 14:00Z');
insert into public.waitlist_entries (org_id, demande_id, target_professional_id, priority, priority_reason, registered_at, language, state,
                                     fee_status, fee_waived_reason)
values ('b0000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'priority',
        'Test', '2026-09-11 14:00Z', 'fr', 'active', 'waived', 'Test');

-- Alice's first appointment with Pro Un after the match, cancelled 24 h before (Sep 19 for Sep 20).
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, state, is_personal,
                                 cancelled_at, cancel_reason_id, cancel_late)
select 'e2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', s.id,
       '2026-09-20 15:00Z', '2026-09-20 15:50Z', '2026-09-20 16:00Z', 'cancelled', false, '2026-09-19 15:00Z', r.id, false
  from public.services s, public.cancellation_reasons r
 where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10150
   and r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'no_longer_needed';
insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence) values
  ('e2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'expected');

-- Places: Sep 7 and Sep 28 photos.
insert into public.capacity_snapshots (org_id, professional_id, snapshot_on, places_declared, places_used, places_left, accepting_new_clients) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '2026-09-07', 3, 1, 2, true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', '2026-09-07', 2, 0, 2, true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '2026-09-28', 3, 3, 0, true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', '2026-09-28', 2, 1, 1, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.report_demandes('2026-09-01', '2026-09-30')::text, true);

select is(current_setting('test.r')::jsonb -> 'totals',
  '{"received": 3, "matched_activity": 2, "activity_rate": 66.7, "matched_cohort": 1, "cohort_rate": 33.3,
    "contacted_on_time": 1, "contacted_late": 1, "not_contacted": 1, "waitlisted": 1}'::jsonb,
  'the totals: activity (2 matches ÷ 3) and cohort (1 of 3), the promise, the waiting list');
select is((select pg_catalog.jsonb_agg(w) from jsonb_array_elements(current_setting('test.r')::jsonb -> 'weeks') w
            where (w ->> 'received')::int > 0 or (w ->> 'matched')::int > 0),
  '[{"week_start": "2026-08-31", "received": 1, "matched": 2}, {"week_start": "2026-09-07", "received": 2, "matched": 0}]'::jsonb,
  'per week, Monday first: received and matches');
select is(jsonb_array_length(current_setting('test.r')::jsonb -> 'weeks'), 5, 'every week of the period is listed');
select is(current_setting('test.r')::jsonb -> 'by_channel',
  '[{"channel": "email", "received": 1, "matched": 0}, {"channel": "phone", "received": 1, "matched": 1}, {"channel": "web_form", "received": 1, "matched": 0}]'::jsonb,
  'per channel, with the cohort matched');
select is(current_setting('test.r')::jsonb -> 'by_counselor',
  '[{"name": "Conseillère A", "received": 2}, {"name": null, "received": 1}]'::jsonb, 'who took the requests');
select is(current_setting('test.r')::jsonb -> 'by_professional',
  '[{"name": "Pro Deux", "matched": 1}, {"name": "Pro Un", "matched": 1}]'::jsonb, 'the period''s matches per professional');
select is((select pg_catalog.jsonb_agg(o order by o ->> 'state') from jsonb_array_elements(current_setting('test.r')::jsonb -> 'outcomes') o),
  '[{"state": "closed", "count": 1, "closed_reason": "no_answer"}, {"state": "matched", "count": 1, "closed_reason": null},
    {"state": "waitlist", "count": 1, "closed_reason": null}]'::jsonb, 'the period''s requests by state and closing reason');

-- Sources (R-74).
select is(current_setting('test.r')::jsonb -> 'by_source',
  '[{"name": null, "received": 2, "matched": 0}, {"name": "Google (test)", "received": 1, "matched": 1}]'::jsonb,
  '« Comment avez-vous entendu parler de MANA ? »');
select is(current_setting('test.r')::jsonb -> 'by_campaign', '[{"name": "automne", "received": 1, "matched": 1}]'::jsonb, 'the campaign');
select is(current_setting('test.r')::jsonb -> 'by_utm', '[{"source": "facebook", "medium": "cpc", "received": 1, "matched": 1}]'::jsonb, 'utm_source / utm_medium');
select is(current_setting('test.r')::jsonb -> 'by_referrer', '[{"host": "google.com", "received": 1, "matched": 1}]'::jsonb,
  'the referrer''s host, lower case, without www');

-- Delays: R1 3 business hours; R4 Thu 10:00 → Tue 10:00 = 72 business hours; R1 matched after 2 days.
select is(current_setting('test.r')::jsonb -> 'delays',
  '{"first_contact_hours": {"count": 2, "median": 37.5, "average": 37.5}, "proposal_days": {"count": 0, "median": null, "average": null},
    "match_days": {"count": 1, "median": 2.0, "average": 2.0}}'::jsonb, 'received → first contact (business hours), → proposal, → match (days)');

-- The first appointment after R1's match, cancelled in the period with 24 h notice.
select is(current_setting('test.r')::jsonb -> 'first_appointments',
  '{"matched": 2, "cancelled": 1, "rate": 50.0, "notice_hours": {"average": 24.0, "min": 24.0, "max": 24.0},
    "by_reason": [{"name": "Plus requis", "count": 1}], "by_professional": [{"name": "Pro Un", "count": 1}]}'::jsonb,
  'first appointments cancelled: rate ÷ matches, per reason, per professional, the notice');

select is(current_setting('test.r')::jsonb -> 'waitlist',
  '{"open": [{"target_kind": "professional", "name": "Pro Un", "count": 1, "priority": 1}], "open_total": 1, "registered": 1, "exits": [],
    "wait_days": {"count": 0, "average": null, "median": null}}'::jsonb, 'the waiting list: open per list, registered, exits, the wait');

select is(current_setting('test.r')::jsonb -> 'places',
  '{"snapshot_on": "2026-09-28", "total_left": 1, "tracked": 2,
    "by_professional": [{"name": "Pro Deux", "declared": 2, "left": 1, "accepting": true}, {"name": "Pro Un", "declared": 3, "left": 0, "accepting": true}],
    "weeks": [{"week_start": "2026-09-07", "snapshot_on": "2026-09-07", "total_left": 4}, {"week_start": "2026-09-28", "snapshot_on": "2026-09-28", "total_left": 1}]}'::jsonb,
  'places: the last photo, per professional, the first photo of each week');

-- Rules and permissions.
select throws_ok($$ select public.report_demandes('2026-09-30', '2026-09-01') $$, 'P0001', null, 'a period the wrong way round');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, '42501', null, 'the conseillère: reports.view needed');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'P0001',
  'Activez d''abord Demandes : ce rapport lit ses demandes.', 'Demandes off: said plainly');
reset role;

select * from finish();
rollback;
