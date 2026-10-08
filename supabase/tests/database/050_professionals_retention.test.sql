-- Professionnels: the retention program (migration *_professionals_compensation_private.sql, plan
-- Phase 4 Task 4a.17 as redesigned by P4-180…P4-194).
-- Covers: privileges (tables, the twelve RPCs and the helpers through function_privs_are; the
-- legacy model gone); the seed (other kinds, the eight grids of the clinic's sheet from
-- 2026-07-01, their tiers and prices, the pay rounding, the sheet's full pay matrix, the tier
-- boundaries); monthly sessions (upsert, half sessions, kept adjustment, zero removes, stale
-- check, future month, negative total, validation with HINT and DETAIL, contract); decisions
-- (initial, suggested, maintained, custom, the statuses — custom and maintained re-flagged at a
-- new tier, not after a downward correction —, the count's month, the optimistic check, the
-- snapshot, the dates, the window); grids (validation, versions, delete window, a new title);
-- other kinds' rates; client agreements (amounts, client key, the full-name guard, end, overlap,
-- delete, the redacted label); the read models (get_professional_compensation with the pay in
-- force and upcoming, list_retention_review); permissions (adjointe, provider, another clinic with
-- org A's ids, module off); the history; the import's two keys.
begin;
create extension if not exists pgtap with schema extensions;
select plan(294);

-- The HINT / DETAIL of the error p_sql raises (null when none): throws_ok checks only code and message.
create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated;
create function private.test_error_detail(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return nullif(v_detail, '');
end;
$$;
grant execute on function private.test_error_detail(text) to authenticated;
-- The professional's open decision, as the UI reads it (p_expected_open_id).
create function private.test_open(p_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select r.id from public.professional_retention r where r.professional_id = p_id and r.effective_to is null
$$;
grant execute on function private.test_open(uuid) to authenticated;

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider (linked to P2) and a
-- conseillère; org B with an admin. Org A: P1 psychologue, P2 travailleur social (the provider),
-- P4 nutritionniste (no grid), P5 psychologue (the floor), P6 psychologue (draft), P7 sexologue
-- (draft); org B: P3. Drafts are not in « Révision mensuelle ».
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', null, 'Noé', 'Quatre', 'p4@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', null, 'Fleur', 'Cinq', 'p5@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', null, 'Sam', 'Six', 'p6@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', null, 'Sève', 'Sept', 'p7@exemple.test', 'draft');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select p.org_id, p.id, t.id, '12345', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'psychologue'), ('c0000000-0000-0000-0000-000000000002'::uuid, 'travailleur_social'),
               ('c0000000-0000-0000-0000-000000000003'::uuid, 'psychologue'), ('c0000000-0000-0000-0000-000000000004'::uuid, 'nutritionniste'),
               ('c0000000-0000-0000-0000-000000000005'::uuid, 'psychologue'), ('c0000000-0000-0000-0000-000000000006'::uuid, 'psychologue'),
               ('c0000000-0000-0000-0000-000000000007'::uuid, 'sexologue')) as v(id, key)
  join public.professionals p on p.id = v.id
  join public.profession_titles t on t.org_id = p.org_id and t.key = v.key;
select set_config('test.p1', 'c0000000-0000-0000-0000-000000000001', true);
select set_config('test.p2', 'c0000000-0000-0000-0000-000000000002', true);
select set_config('test.p3', 'c0000000-0000-0000-0000-000000000003', true);
select set_config('test.p4', 'c0000000-0000-0000-0000-000000000004', true);
select set_config('test.p5', 'c0000000-0000-0000-0000-000000000005', true);
select set_config('test.p6', 'c0000000-0000-0000-0000-000000000006', true);
select set_config('test.p7', 'c0000000-0000-0000-0000-000000000007', true);
select set_config('test.psy_a', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'psychologue'), true);
select set_config('test.nutri_a', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'nutritionniste'), true);
select set_config('test.psy_b', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000b' and key = 'psychologue'), true);
-- The current month (entries may not be later) and the one before, in the clinic's time zone.
select set_config('test.this_month', date_trunc('month', (now() at time zone 'America/Toronto'))::date::text, true);
select set_config('test.last_month', (date_trunc('month', (now() at time zone 'America/Toronto')) - interval '1 month')::date::text, true);

-- =============================================================================
-- Privileges (as postgres)
-- =============================================================================
select table_privs_are('public', 'compensation_kinds',             'authenticated', array['SELECT'], 'authenticated: select only on compensation_kinds');
select table_privs_are('public', 'compensation_rates',             'authenticated', array['SELECT'], 'authenticated: select only on compensation_rates');
select table_privs_are('public', 'retention_grids',                'authenticated', array['SELECT'], 'authenticated: select only on retention_grids');
select table_privs_are('public', 'retention_grid_tiers',           'authenticated', array['SELECT'], 'authenticated: select only on retention_grid_tiers');
select table_privs_are('public', 'retention_grid_prices',          'authenticated', array['SELECT'], 'authenticated: select only on retention_grid_prices');
select table_privs_are('public', 'professional_session_counts',    'authenticated', array['SELECT'], 'authenticated: select only on professional_session_counts');
select table_privs_are('public', 'professional_retention',         'authenticated', array['SELECT'], 'authenticated: select only on professional_retention');
select table_privs_are('public', 'professional_client_agreements', 'authenticated', array['SELECT'], 'authenticated: select only on professional_client_agreements');
select table_privs_are('public', 'professional_retention',         'anon', array[]::text[], 'anon: nothing on professional_retention');
select table_privs_are('public', 'professional_client_agreements', 'anon', array[]::text[], 'anon: nothing on professional_client_agreements');

-- The twelve RPCs: EXECUTE for authenticated, nothing for anon or service_role.
select function_privs_are('public', f.name, f.args, r.role, case when r.role = 'authenticated' then array['EXECUTE'] else array[]::text[] end,
                          r.role || ' on ' || f.name)
  from (values ('set_compensation_rate', array['text', 'numeric', 'date']),
               ('delete_compensation_rate', array['uuid']),
               ('set_retention_grid', array['uuid', 'date', 'jsonb', 'jsonb', 'text']),
               ('delete_retention_grid', array['uuid']),
               ('record_monthly_sessions', array['date', 'jsonb']),
               ('decide_retention', array['uuid', 'text', 'numeric', 'date', 'text', 'date', 'uuid']),
               ('delete_professional_retention', array['uuid']),
               ('set_professional_client_agreement', array['uuid', 'text', 'integer', 'integer', 'integer', 'date', 'text']),
               ('end_professional_client_agreement', array['uuid', 'date']),
               ('delete_professional_client_agreement', array['uuid']),
               ('get_professional_compensation', array['uuid', 'date']),
               ('list_retention_review', array['date'])) as f(name, args)
 cross join (values ('authenticated'), ('anon'), ('service_role')) as r(role);

-- The helpers: granted to no role.
select function_privs_are('private', f.name, f.args, r.role, array[]::text[], r.role || ' on private.' || f.name)
  from (values ('retention_overview', array['uuid', 'date', 'date']),
               ('retention_pay', array['uuid', 'uuid', 'numeric', 'numeric', 'numeric']),
               ('retention_pay_cents', array['integer', 'numeric']),
               ('assert_dated_deletable', array['date', 'timestamp with time zone', 'text']),
               ('agreement_has_successor', array['professional_client_agreements']),
               ('seed_professionals_compensation', array['uuid']),
               ('compensation_note', array['text'])) as f(name, args)
 cross join (values ('authenticated'), ('service_role')) as r(role);

-- The legacy contract's model is gone (P4-180).
select hasnt_table('public', 'compensation_defaults', 'no default ranges');
select hasnt_table('public', 'professional_compensation', 'no per-professional margins');
select hasnt_table('public', 'recognition_rules', 'no recognition rules');
select hasnt_table('public', 'professional_recognition', 'no recognition levels');
select hasnt_function('public', 'set_professional_margin', 'no set_professional_margin');
select hasnt_function('public', 'set_recognition_rule', 'no set_recognition_rule');

-- =============================================================================
-- The seed (as postgres)
-- =============================================================================
select results_eq($$ select key, name from public.compensation_kinds order by sort_order $$,
  $$ values ('workshop', 'Ateliers et conférences'), ('late_cancellation', 'Annulation tardive'), ('other_fees', 'Autres frais') $$,
  'the other kinds: no consultation (the grids drive it)');
select results_eq($$ select kind, retention_pct, effective_from from public.compensation_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' order by kind $$,
  $$ values ('late_cancellation', 30.00, '2026-07-01'::date), ('other_fees', 15.00, '2026-07-01'::date), ('workshop', 25.00, '2026-07-01'::date) $$,
  'the other kinds'' rates, from 2026-07-01 (P4-181)');
select results_eq($$ select t.key from public.retention_grids g join public.profession_titles t on t.id = g.title_id
                      where g.org_id = 'b0000000-0000-0000-0000-00000000000a' and g.effective_from = '2026-07-01' and g.effective_to is null
                      order by t.key $$,
  $$ values ('coach_professionnel'), ('conseiller_orientation'), ('naturopathe'), ('psychoeducateur'), ('psychologue'),
            ('psychotherapeute'), ('sexologue'), ('travailleur_social') $$,
  'eight grids from 2026-07-01, none for nutritionniste');
select is((select count(*)::int from public.retention_grids where org_id = 'b0000000-0000-0000-0000-00000000000b'), 8, 'org B is seeded too');
select results_eq($$ select gt.threshold_sessions, gt.retention_pct from public.retention_grid_tiers gt
                      join public.retention_grids g on g.id = gt.grid_id
                     where g.org_id = 'b0000000-0000-0000-0000-00000000000a' and g.title_id = current_setting('test.psy_a')::uuid
                     order by 1 $$,
  $$ values (0, 28.00), (51, 27.50), (101, 27.00), (151, 26.50), (201, 26.00), (251, 25.50), (301, 25.00) $$,
  'Psychologie: 28 % down by 0.5 per 50 sessions to 25 % at 301');
select results_eq($$ select gt.threshold_sessions, gt.retention_pct from public.retention_grid_tiers gt
                      join public.retention_grids g on g.id = gt.grid_id
                      join public.profession_titles t on t.id = g.title_id
                     where g.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'sexologue'
                     order by 1 desc limit 2 $$,
  $$ values (501, 25.00), (451, 25.50) $$, 'Sexologie: the floor at 501');
select results_eq($$ select t.key, gp.duration::int, gp.client_price_cents from public.retention_grid_prices gp
                      join public.retention_grids g on g.id = gp.grid_id
                      join public.profession_titles t on t.id = g.title_id
                     where g.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key in ('psychologue', 'conseiller_orientation', 'coach_professionnel')
                     order by 1, 2 desc $$,
  $$ values ('coach_professionnel', 60, 12177), ('coach_professionnel', 50, 10437), ('coach_professionnel', 30, 6958),
            ('conseiller_orientation', 50, 14000), ('conseiller_orientation', 30, 10000),
            ('psychologue', 60, 20000), ('psychologue', 50, 17500), ('psychologue', 30, 13000) $$,
  'client prices: Psychologie 200 / 175 / 130 $, Orientation without 60 min, Coach from GoRV');
select results_eq($$ select gp.client_price_cents, private.retention_pay_cents(gp.client_price_cents, 30) from public.retention_grid_prices gp
                      join public.retention_grids g on g.id = gp.grid_id
                      join public.profession_titles t on t.id = g.title_id
                     where g.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychoeducateur' and gp.duration = 60 $$,
  $$ values (16500, 11550) $$, 'Psychoéducation 60 min: 165 $ (Jonathan''s correction), 115.50 $ at 30 %');
select is((select count(*)::int from public.audit_log where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and table_name = 'retention_grids' and source = 'seed:professionals_compensation'), 8, 'the seed is audited as such');
-- The sheet's « Tarif » columns, half away from zero to the cent.
select is(private.retention_pay_cents(17500, 27.5), 12688, 'Psychologie 50 min at 27.5 %: 126.88 $');
select is(private.retention_pay_cents(6958, 25), 5219, 'Coach 30 min at 25 %: 52.19 $');
select is(private.retention_pay_cents(6958, 30), 4871, 'Coach 30 min at 30 %: 48.71 $');
select is(private.retention_pay_cents(12177, 30), 8524, 'Coach 60 min at 30 %: 85.24 $');
select is(private.retention_pay_cents(17500, null), null, 'no rate, no pay');

-- =============================================================================
-- Monthly sessions (admin A)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(public.record_monthly_sessions('2026-07-20',
  jsonb_build_array(jsonb_build_object('professional_id', current_setting('test.p1'), 'sessions_50_60', 20, 'sessions_30', 0,
                                       'adjustment', 10.5, 'expected_updated_at', null))), 1, 'July for P1 (with an opening adjustment)');
select is(public.record_monthly_sessions('2026-08-01',
  jsonb_build_array(jsonb_build_object('professional_id', current_setting('test.p1'), 'sessions_50_60', 20, 'sessions_30', 4, 'expected_updated_at', null),
                    jsonb_build_object('professional_id', current_setting('test.p2'), 'sessions_50_60', 12, 'sessions_30', 1, 'expected_updated_at', null))),
  2, 'August for P1 and P2 in one batch');
select results_eq($$ select month, sessions_50_60, sessions_30, adjustment from public.professional_session_counts
                      where professional_id = current_setting('test.p1')::uuid order by month $$,
  $$ values ('2026-07-01'::date, 20, 0, 10.5), ('2026-08-01'::date, 20, 4, 0.0) $$, 'stored on the first of the month');
select is((public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-08-15') ->> 'sessions_total')::numeric, 52.5,
  'cumulative: 20 + 10.5 + 20 + 4 × 0.5');
select is((public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-07-15') ->> 'sessions_total')::numeric, 30.5,
  '… through July only on a July date');

-- Stale: the month's row exists, so null is no longer the version read.
select throws_ok($$ select public.record_monthly_sessions('2026-08-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  'P0001', 'Les séances de ce mois ont été modifiées depuis leur affichage.', 'a stale version is refused');
select is(private.test_error_hint($$ select public.record_monthly_sessions('2026-08-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$),
  'stale', '… HINT stale');
select is(private.test_error_detail($$ select public.record_monthly_sessions('2026-08-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$),
  current_setting('test.p1'), '… DETAIL the professional');
-- The version read: replaced, the adjustment kept when absent.
select lives_ok($$ select public.record_monthly_sessions('2026-07-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 22, 'sessions_30', 2,
    'expected_updated_at', (select updated_at from public.professional_session_counts
                             where professional_id = current_setting('test.p1')::uuid and month = '2026-07-01')))) $$,
  'with the version read, July is replaced');
select results_eq($$ select sessions_50_60, sessions_30, adjustment from public.professional_session_counts
                      where professional_id = current_setting('test.p1')::uuid and month = '2026-07-01' $$,
  $$ values (22, 2, 10.5) $$, '… and the adjustment, absent, is kept');
-- Zero removes the month.
select lives_ok($$ select public.record_monthly_sessions('2026-08-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p2'), 'sessions_50_60', 0, 'sessions_30', 0,
    'expected_updated_at', (select updated_at from public.professional_session_counts
                             where professional_id = current_setting('test.p2')::uuid and month = '2026-08-01')))) $$,
  'zero sessions for P2''s August');
select is((select count(*)::int from public.professional_session_counts where professional_id = current_setting('test.p2')::uuid), 0,
  '… removes the row');

-- Refusals (before any write).
select throws_ok(format($$ select public.record_monthly_sessions(%L, jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$,
    (current_setting('test.this_month')::date + interval '1 month')::date),
  'P0001', 'Les séances d''un mois à venir ne peuvent pas être saisies.', 'next month is refused');
select is(private.test_error_hint($$ select public.record_monthly_sessions(null, jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$),
  'month', 'no month: HINT month');
select is(private.test_error_hint($$ select public.record_monthly_sessions('1999-12-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$),
  'month', 'a month before 2000: HINT month');
select is(private.test_error_hint($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', -1, 'sessions_30', 0, 'expected_updated_at', null))) $$),
  'sessions_long', 'negative 50/60 sessions: HINT sessions_long');
select is(private.test_error_hint($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 2.5, 'expected_updated_at', null))) $$),
  'sessions_short', 'half a 30-minute session: HINT sessions_short');
select is(private.test_error_hint($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'adjustment', 0.3, 'expected_updated_at', null))) $$),
  'adjustment', 'an adjustment not in half sessions: HINT adjustment');
select is(private.test_error_hint($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'note', repeat('x', 501), 'expected_updated_at', null))) $$),
  'note', 'a note too long: HINT note');
select is(private.test_error_detail($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(
    jsonb_build_object('professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null),
    jsonb_build_object('professional_id', current_setting('test.p2'), 'sessions_50_60', 3000, 'sessions_30', 0, 'expected_updated_at', null))) $$),
  current_setting('test.p2'), 'a refusal names its professional in DETAIL');
select is((select count(*)::int from public.professional_session_counts where month = '2026-09-01'), 0, '… and the batch wrote nothing');
select throws_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', -100, 'expected_updated_at', null))) $$,
  'P0001', 'Le total cumulé de séances ne peut pas devenir négatif.', 'the total never goes below 0');
select throws_ok($$ select public.record_monthly_sessions('2026-09-01', '{}') $$, '22023', null, 'contract: an array');
select throws_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(
    jsonb_build_object('professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null),
    jsonb_build_object('professional_id', current_setting('test.p1'), 'sessions_50_60', 2, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  '22023', 'Un professionnel apparaît deux fois.', 'contract: one entry per professional');
select throws_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0))) $$,
  '22023', null, 'contract: expected_updated_at is required (null when none was read)');
select throws_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null, 'total', 9))) $$,
  '22023', null, 'contract: no unknown key');
select throws_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p3'), 'sessions_50_60', 1, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is not found');

-- =============================================================================
-- Decisions and statuses (admin A, P1: 55.5 sessions → tier 51, 27.5 %)
-- =============================================================================
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'status', 'no_rate',
  'no rate yet: « Taux de départ à fixer », not a gap (P4-197)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') -> 'suggested',
  '{"threshold_sessions": 51, "retention_pct": 27.50}'::jsonb, 'suggested: tier 51 at 27.5 %');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') -> 'next',
  '{"threshold_sessions": 101, "retention_pct": 27.00}'::jsonb, 'next: 101 at 27 %');
select throws_ok($$ select public.decide_retention(current_setting('test.p1')::uuid, 'suggested', 27, '2026-07-01', null, '2026-08-01', null) $$,
  '22023', null, 'a suggested decision takes no rate');
select throws_ok($$ select public.decide_retention(current_setting('test.p1')::uuid, 'maintained', null, '2026-07-01', null, '2026-08-01', null) $$,
  'P0001', 'Aucun taux à maintenir.', 'nothing to maintain yet');
select throws_ok($$ select public.decide_retention(current_setting('test.p1')::uuid, 'other', null, '2026-07-01', null, '2026-08-01', null) $$,
  '22023', null, 'an unknown decision');
select is(private.test_error_hint($$ select public.decide_retention(current_setting('test.p1')::uuid, 'initial', 101, '2026-07-01', null, '2026-08-01', null) $$),
  'retention_pct', 'a rate above 100: HINT retention_pct');
select is(private.test_error_hint($$ select public.decide_retention(current_setting('test.p1')::uuid, 'initial', 28, '2026-07-01', null, null, null) $$),
  'month', 'the count''s month is required: HINT month');
select is(private.test_error_hint(format($$ select public.decide_retention(current_setting('test.p1')::uuid, 'initial', 28, '2026-07-01', null, %L, null) $$,
                                         (current_setting('test.this_month')::date + interval '1 month')::date)),
  'month', '… and not a month to come');
-- The start date is checked before the lock: another clinic's professional gets the date's refusal.
select throws_ok($$ select public.decide_retention(current_setting('test.p3')::uuid, 'initial', 28, null, null, '2026-08-01', null) $$,
  'P0001', 'La date d''entrée en vigueur est requise.', 'no start date: refused before the lock');
select is((public.decide_retention(current_setting('test.p1')::uuid, 'initial', 28, '2026-07-01', null, '2026-08-01', null) ->> 'decreased')::boolean, false,
  'initial 28 % from 2026-07-01');
select throws_ok($$ select public.decide_retention(current_setting('test.p1')::uuid, 'initial', 28, '2026-08-01', null, '2026-08-01', private.test_open(current_setting('test.p1')::uuid)) $$,
  'P0001', 'Un taux est déjà appliqué : choisissez une autre décision.', 'initial only once');
-- The optimistic check: the caller read no decision, one exists now.
select throws_ok($$ select public.decide_retention(current_setting('test.p1')::uuid, 'maintained', null, '2026-09-01', null, '2026-08-01', null) $$,
  'P0001', 'Le taux de ce professionnel a été modifié depuis son affichage.', 'a decision on a stale state is refused');
select is(private.test_error_hint($$ select public.decide_retention(current_setting('test.p1')::uuid, 'maintained', null, '2026-09-01', null, '2026-08-01', gen_random_uuid()) $$),
  'stale', '… HINT stale (another open decision)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'status', 'gap',
  '28 % applied, 27.5 % suggested: gap');
select is(private.test_error_hint($$ select public.decide_retention(current_setting('test.p1')::uuid, 'maintained', null, '2026-07-01', null, '2026-08-01', private.test_open(current_setting('test.p1')::uuid)) $$),
  'effective_from', 'a decision not after the open one: HINT effective_from');
select is(private.test_error_hint($$ select public.decide_retention(current_setting('test.p1')::uuid, 'maintained', null, '2101-01-01', null, '2026-08-01', private.test_open(current_setting('test.p1')::uuid)) $$),
  'effective_from', 'a date after 2100: HINT effective_from');
select is(public.decide_retention(current_setting('test.p1')::uuid, 'maintained', null, '2026-09-01', null, '2026-08-01', private.test_open(current_setting('test.p1')::uuid)) - 'id',
  '{"retention_pct": 28.00, "decreased": false}'::jsonb, 'maintained: 28 % again');
select results_eq($$ select decision, retention_pct, tier_threshold, suggested_pct, sessions_total from public.professional_retention
                      where professional_id = current_setting('test.p1')::uuid and effective_to is null $$,
  $$ values ('maintained'::text, 28.00, 51, 27.50, 55.5) $$, 'the decision keeps the tier and a snapshot');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'status', 'maintained',
  'maintained at the tier the count is in: « Maintenu »');
-- 50 more sessions in September: tier 101.
select lives_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 50, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  'September: 50 sessions');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'status', 'gap',
  'another tier reached: the maintained rate is a gap again');
select is(public.decide_retention(current_setting('test.p1')::uuid, 'suggested', null, '2026-10-01', null, '2026-09-01', private.test_open(current_setting('test.p1')::uuid)) - 'id',
  '{"retention_pct": 27.00, "decreased": true}'::jsonb, 'apply the suggestion: 27 %, a decrease');
-- The read model's pay is the rate in force on p_on; a decision starting later is « upcoming ».
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') -> 'pay' -> 0,
  '{"duration": 60, "client_price_cents": 20000, "applied_cents": 14400, "suggested_cents": 14600, "upcoming_cents": 14600}'::jsonb,
  'on 2026-09-15: pay at 28 % (in force), 27 % upcoming from October');
select is((select x -> 'pay' -> 0 ->> 'applied_cents' from jsonb_array_elements(public.list_retention_review('2026-08-01') -> 'rows') x where x ->> 'last_name' = 'Un'), '14400',
  'the review of August pays September''s rate in force (28 %)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'status', 'conforme',
  'applied = suggested: « Conforme »');
select is((public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'in_force_pct')::numeric, 28.00,
  'in force on 2026-09-15: still 28 %');
select is((public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-09-15') ->> 'previous_pct')::numeric, 28.00,
  'the previous rate');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-10-15') -> 'pay',
  '[{"duration": 60, "client_price_cents": 20000, "applied_cents": 14600, "suggested_cents": 14600, "upcoming_cents": null},
    {"duration": 50, "client_price_cents": 17500, "applied_cents": 12775, "suggested_cents": 12775, "upcoming_cents": null},
    {"duration": 30, "client_price_cents": 13000, "applied_cents": 9490, "suggested_cents": 9490, "upcoming_cents": null}]'::jsonb,
  'pay per duration at 27 %, nothing upcoming');
select results_eq($$ select x ->> 'kind', (x ->> 'retention_pct')::numeric
                      from jsonb_array_elements(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-10-15') -> 'other_rates') x $$,
  $$ values ('workshop', 25.00), ('late_cancellation', 30.00), ('other_fees', 15.00) $$, 'the other kinds in force');
select is(jsonb_array_length(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-10-15') -> 'grid' -> 'tiers'), 7,
  'the grid''s tiers');
select is(private.test_error_hint($$ select public.decide_retention(current_setting('test.p1')::uuid, 'custom', 26, '2026-11-01', null, '2026-10-01', private.test_open(current_setting('test.p1')::uuid)) $$),
  'note', 'a custom rate needs a note: HINT note');
select is((public.decide_retention(current_setting('test.p1')::uuid, 'custom', 26, '2026-11-01', 'Entente fictive', '2026-10-01', private.test_open(current_setting('test.p1')::uuid)) ->> 'retention_pct')::numeric,
  26.00, 'a custom rate');
select is((select tier_threshold from public.professional_retention where professional_id = current_setting('test.p1')::uuid and effective_to is null), 101,
  '… remembering the tier the count is in (105.5: 101)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-11-15') ->> 'status', 'custom',
  '« Taux particulier »');
-- « Taux particulier » re-flags at a new tier (Jonathan, 2026-10-08, P4-188).
select lives_ok($$ select public.record_monthly_sessions('2026-10-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 20, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  'October: 20 more (125.5, still tier 101)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-11-15') ->> 'status', 'custom',
  'within its tier, a custom rate stays « Taux particulier »');
select lives_ok($$ select public.record_monthly_sessions('2026-10-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p1'), 'sessions_50_60', 60, 'sessions_30', 0,
    'expected_updated_at', (select updated_at from public.professional_session_counts
                             where professional_id = current_setting('test.p1')::uuid and month = '2026-10-01')))) $$,
  'October corrected to 60 (165.5: tier 151)');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-11-15') ->> 'status', 'gap',
  'at the next tier, the custom rate is a gap again');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-10-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  'gap', '… in the review of October too');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  'custom', '… while the review of September (105.5) still reads « Taux particulier »');
-- The window: the custom rate (created now) goes; once aged, the next one stays.
select set_config('test.custom', (select id::text from public.professional_retention
                                   where professional_id = current_setting('test.p1')::uuid and effective_to is null), true);
select lives_ok($$ select public.delete_professional_retention(current_setting('test.custom')::uuid) $$, 'the custom rate is deleted within 24 hours');
select is((select retention_pct from public.professional_retention
            where professional_id = current_setting('test.p1')::uuid and effective_to is null), 27.00, '… and 27 % is open again');
reset role;
update public.professional_retention set created_at = now() - interval '2 days' where professional_id = current_setting('test.p1')::uuid;
set local role authenticated;
select throws_ok($$ select public.delete_professional_retention((select id from public.professional_retention
                      where professional_id = current_setting('test.p1')::uuid and effective_to is null)) $$,
  'P0001', 'Un taux déjà en vigueur ne peut pas être supprimé.', 'an old rate in force stays');
select throws_ok($$ select public.delete_professional_retention((select id from public.professional_retention
                      where professional_id = current_setting('test.p1')::uuid and effective_to = '2026-09-01')) $$,
  'P0001', 'Seul le dernier taux peut être supprimé.', 'only the last rate');

-- The floor (P5: 320 sessions) and a profession without a grid (P4).
select lives_ok($$ select public.record_monthly_sessions('2026-08-01', jsonb_build_array(
    jsonb_build_object('professional_id', current_setting('test.p5'), 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', 320, 'expected_updated_at', null),
    jsonb_build_object('professional_id', current_setting('test.p4'), 'sessions_50_60', 10, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  'P5 opens at 320, P4 counts 10');
select lives_ok($$ select public.decide_retention(current_setting('test.p5')::uuid, 'suggested', null, '2026-08-01', null, '2026-08-01', null) $$, 'P5: the suggestion');
select is(public.get_professional_compensation(current_setting('test.p5')::uuid, '2026-08-15') ->> 'status', 'floor',
  '25 %: « Palier maximum atteint »');
select is(public.get_professional_compensation(current_setting('test.p5')::uuid, '2026-08-15') -> 'next', 'null'::jsonb, 'no next tier');
select is(public.get_professional_compensation(current_setting('test.p4')::uuid, '2026-08-15') ->> 'status', 'profession_unconfirmed',
  'no grid for nutritionniste: « Profession à confirmer »');
select is(public.get_professional_compensation(current_setting('test.p4')::uuid, '2026-08-15') -> 'pay', '[]'::jsonb, '… no pay');
select throws_ok($$ select public.decide_retention(current_setting('test.p4')::uuid, 'suggested', null, '2026-08-01', null, '2026-08-01', null) $$,
  'P0001', 'Aucune grille ne s''applique à la profession principale de ce professionnel à cette date.', 'no suggestion without a grid');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-06-15') ->> 'status', 'profession_unconfirmed',
  'before 2026-07-01 no grid is in force');
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p1')::uuid, '1999-01-01') $$,
  'P0001', 'La date doit être comprise entre le 2000-01-01 et le 2100-12-31.', 'p_on is bounded');

-- =============================================================================
-- Grids
-- =============================================================================
select throws_ok(format($$ select public.set_retention_grid(%L, '2026-07-01', '[{"threshold_sessions": 0, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 17500}]', null) $$,
                        current_setting('test.psy_a')),
  'P0001', 'La nouvelle grille doit commencer après le 2026-07-01.', 'a new version starts after the open one');
select is(private.test_error_hint(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 51, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 17500}]', null) $$,
                        current_setting('test.psy_a'))), 'tiers', 'no tier at 0: HINT tiers');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}, {"threshold_sessions": 51, "retention_pct": 29}]', '[{"duration": 50, "client_price_cents": 17500}]', null) $$,
                        current_setting('test.psy_a')),
  'P0001', 'Un palier plus élevé ne peut pas retenir davantage que le précédent.', 'a higher tier never retains more');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}, {"threshold_sessions": 0, "retention_pct": 27}]', '[{"duration": 50, "client_price_cents": 17500}]', null) $$,
                        current_setting('test.psy_a')),
  'P0001', 'Deux paliers ont le même seuil.', 'distinct thresholds');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0.5, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 17500}]', null) $$,
                        current_setting('test.psy_a')),
  'P0001', 'Les seuils sont des nombres entiers de séances, de 0 à 100 000.', 'whole thresholds');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 101}]', '[{"duration": 50, "client_price_cents": 17500}]', null) $$,
                        current_setting('test.psy_a')),
  'P0001', 'Les taux de retenue sont compris entre 0 et 100 %.', 'rates within 0–100');
select is(private.test_error_hint(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 0}]', null) $$,
                        current_setting('test.psy_a'))), 'prices', 'a price of 0: HINT prices');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}]', '[{"duration": 45, "client_price_cents": 100}]', null) $$,
                        current_setting('test.psy_a')),
  '22023', null, 'contract: durations 60, 50, 30');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 100}, {"duration": 50, "client_price_cents": 200}]', null) $$,
                        current_setting('test.psy_a')),
  '22023', null, 'contract: distinct durations');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 100}]', null) $$,
                        current_setting('test.psy_b')),
  'P0001', 'Profession introuvable.', 'another clinic''s title is not found');
select set_config('test.grid2', public.set_retention_grid(current_setting('test.psy_a')::uuid, '2027-01-01',
  '[{"threshold_sessions": 101, "retention_pct": 26}, {"threshold_sessions": 0, "retention_pct": 27}]',
  '[{"duration": 50, "client_price_cents": 18000}]', 'Nouvelle grille fictive')::text, true);
select is((select effective_to from public.retention_grids where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and title_id = current_setting('test.psy_a')::uuid and effective_from = '2026-07-01'), '2027-01-01'::date,
  'the new version closes the previous one');
select is(public.get_professional_compensation(current_setting('test.p1')::uuid, '2027-02-01') -> 'pay',
  '[{"duration": 50, "client_price_cents": 18000, "applied_cents": 13140, "suggested_cents": 13320, "upcoming_cents": null}]'::jsonb,
  'from 2027 the new grid prices the pay (applied 27 %, suggested 26 %)');
select lives_ok(format($$ select public.delete_retention_grid(%L) $$, current_setting('test.grid2')), 'the new version is deleted (not in force yet)');
select is((select count(*)::int from public.retention_grid_tiers where grid_id = current_setting('test.grid2')::uuid), 0, '… with its tiers');
select is((select effective_to from public.retention_grids where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and title_id = current_setting('test.psy_a')::uuid and effective_from = '2026-07-01'), null::date, '… and the previous one reopens');
reset role;
update public.retention_grids set created_at = now() - interval '2 days' where org_id = 'b0000000-0000-0000-0000-00000000000a';
set local role authenticated;
select throws_ok($$ select public.delete_retention_grid((select id from public.retention_grids where org_id = 'b0000000-0000-0000-0000-00000000000a'
                      and title_id = current_setting('test.psy_a')::uuid)) $$,
  'P0001', 'Une grille déjà en vigueur ne peut pas être supprimée.', 'a grid in force for over 24 hours stays');
-- A custom rate decided without a grid remembers no tier: a grid applying later flags it.
select lives_ok($$ select public.decide_retention(current_setting('test.p4')::uuid, 'custom', 30, '2026-08-01', 'Sans grille (fictif)', '2026-08-01', null) $$,
  'P4: a custom rate without a grid');
select is((select tier_threshold from public.professional_retention where professional_id = current_setting('test.p4')::uuid), null::int,
  '… no tier to remember');
select set_config('test.grid_nutri', public.set_retention_grid(current_setting('test.nutri_a')::uuid, '2026-07-01',
  '[{"threshold_sessions": 0, "retention_pct": 30}]', '[{"duration": 50, "client_price_cents": 12000}]', null)::text, true);
select is(public.get_professional_compensation(current_setting('test.p4')::uuid, '2026-08-15') ->> 'status', 'gap',
  'a grid for nutritionniste: P4''s custom rate decided without one is a gap');
select lives_ok(format($$ select public.delete_retention_grid(%L) $$, current_setting('test.grid_nutri')),
  'a title''s first grid may go within the window');
select is(public.get_professional_compensation(current_setting('test.p4')::uuid, '2026-08-15') ->> 'status', 'profession_unconfirmed',
  '… « Profession à confirmer » again');

-- =============================================================================
-- The other kinds' rates
-- =============================================================================
select set_config('test.rate', public.set_compensation_rate('workshop', 20, '2027-01-01')::text, true);
select is((select effective_to from public.compensation_rates where org_id = 'b0000000-0000-0000-0000-00000000000a'
            and kind = 'workshop' and effective_from = '2026-07-01'), '2027-01-01'::date, 'a new workshop rate closes the old one');
select throws_ok($$ select public.set_compensation_rate('consultation', 20, '2027-01-01') $$, '22023', 'Type de rémunération inconnu.',
  'consultation is no kind any more');
select throws_ok($$ select public.set_compensation_rate('workshop', 101, '2027-02-01') $$, 'P0001', 'Le taux est compris entre 0 et 100 %.',
  'a rate within 0–100');
select lives_ok(format($$ select public.delete_compensation_rate(%L) $$, current_setting('test.rate')), 'the coming rate is deleted');
select throws_ok($$ select public.delete_compensation_rate((select id from public.compensation_rates
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' and kind = 'workshop')) $$,
  'P0001', 'Le premier taux d''un type ne peut pas être supprimé.', 'a kind keeps its first rate');

-- =============================================================================
-- Client agreements (« Ententes particulières »)
-- =============================================================================
select throws_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'AB-123', 50, 13000, 12000, '2026-10-01', null) $$,
  'P0001', 'Le montant versé au professionnel ne peut pas dépasser le prix payé par le client.', 'the pay never exceeds the client price');
select is(private.test_error_hint($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'AB-123', 50, 13000, 12000, '2026-10-01', null) $$),
  'professional_amount', '… HINT professional_amount');
select is(private.test_error_hint($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'AB-123', 50, 8500, null, '2026-10-01', null) $$),
  'client_price', 'the client price is required: HINT client_price');
select is(private.test_error_hint($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, '  ', 50, 8500, 12000, '2026-10-01', null) $$),
  'client_label', 'a client reference is required: HINT client_label');
select is(private.test_error_hint($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, repeat('x', 41), 50, 8500, 12000, '2026-10-01', null) $$),
  'client_label', '… at most 40 characters');
select throws_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'AB-123', 45, 8500, 12000, '2026-10-01', null) $$,
  '22023', 'Durée inconnue (60, 50 ou 30).', 'durations 60, 50, 30');
-- Loi 25: a reference, never a full name (P4-183).
select throws_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'Marie Tremblay', 50, 8500, 12000, '2026-10-01', null) $$,
  'P0001', 'Numéro de dossier ou initiales seulement.', 'a full name is refused');
select is(private.test_error_hint($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'Élise Côté-Roy', 50, 8500, 12000, '2026-10-01', null) $$),
  'client_label', '… accents and hyphens included: HINT client_label');
select is(private.test_error_hint($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'Jean d''Arc', 50, 8500, 12000, '2026-10-01', null) $$),
  'client_label', '… apostrophes too');
select set_config('test.ag1', public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'AB-123', 50, 8500, 12000, '2026-10-01', null)::text, true);
select lives_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'CD', 30, 5000, 9000, '2026-10-01', 'Fictif') $$,
  'another client');
select lives_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'M. T. 2', 60, 5000, 9000, '2026-10-01', null) $$,
  'initials with a number pass the full-name guard');
select set_config('test.ag2', public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'ab-123', 50, 9000, 12000, '2026-12-01', null)::text, true);
select is((select effective_to from public.professional_client_agreements where id = current_setting('test.ag1')::uuid), '2026-12-01'::date,
  'the same client (case ignored) and duration: the new agreement closes the old one');
select results_eq($$ select x ->> 'client_label', (x ->> 'professional_amount_cents')::int, (x ->> 'client_price_cents')::int
                      from jsonb_array_elements(public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-11-15') -> 'agreements') x $$,
  $$ values ('M. T. 2', 5000, 9000), ('AB-123', 8500, 12000), ('CD', 5000, 9000) $$, 'the agreements in force, 60 min first');
select is((public.get_professional_compensation(current_setting('test.p1')::uuid, '2026-11-15') -> 'pay' -> 1 ->> 'applied_cents')::int, 12775,
  'an agreement never changes the grid''s pay');
select is(private.test_error_hint(format($$ select public.end_professional_client_agreement(%L, '2026-11-01') $$, current_setting('test.ag2'))),
  'effective_to', 'an end before the start: HINT effective_to');
select throws_ok(format($$ select public.end_professional_client_agreement(%L, %L) $$, current_setting('test.ag2'),
                        (now() at time zone 'America/Toronto')::date - 1),
  'P0001', 'La fin de l''entente ne peut pas précéder aujourd''hui.', 'an end before the clinic''s today is refused');
select is(private.test_error_hint(format($$ select public.end_professional_client_agreement(%L, %L) $$, current_setting('test.ag2'),
                                         (now() at time zone 'America/Toronto')::date - 1)),
  'effective_to', '… HINT effective_to');
select throws_ok(format($$ select public.end_professional_client_agreement(%L, '2027-03-01') $$, current_setting('test.ag1')),
  'P0001', 'Seule la dernière entente d''un client et d''une durée peut prendre fin.', 'only the last agreement ends');
select lives_ok(format($$ select public.end_professional_client_agreement(%L, '2027-03-01') $$, current_setting('test.ag2')), 'the agreement ends');
select throws_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'AB-123', 50, 9000, 12000, '2027-02-01', null) $$,
  'P0001', 'La nouvelle entente doit commencer au plus tôt le 2027-03-01.', 'the next one starts at its end or later');
select is((public.get_professional_compensation(current_setting('test.p1')::uuid, '2027-03-15') -> 'agreements') @> '[{"client_label": "AB-123"}]', false,
  'ended: no longer in force');
select lives_ok(format($$ select public.delete_professional_client_agreement(%L) $$, current_setting('test.ag2')), 'the new one is deleted');
select is((select effective_to from public.professional_client_agreements where id = current_setting('test.ag1')::uuid), null::date,
  '… and the previous one reopens');
reset role;
update public.professional_client_agreements set created_at = now() - interval '2 days' where id = current_setting('test.ag1')::uuid;
set local role authenticated;
select throws_ok(format($$ select public.delete_professional_client_agreement(%L) $$, current_setting('test.ag1')),
  'P0001', 'Une entente déjà en vigueur ne peut pas être supprimée.', 'an old agreement in force stays');
reset role;
select throws_ok($$ insert into public.professional_client_agreements (org_id, professional_id, client_label, duration, professional_amount_cents, client_price_cents, effective_from)
                    values ('b0000000-0000-0000-0000-00000000000a', current_setting('test.p1')::uuid, 'ab-123', 50, 1, 1, '2026-11-01') $$,
  '23P01', null, 'overlapping agreements of a client are refused by the table');
set local role authenticated;

-- =============================================================================
-- « Révision mensuelle »
-- =============================================================================
select is(public.list_retention_review('2026-09-20') ->> 'month', '2026-09-01', 'the month');
select is(public.list_retention_review('2026-09-20') ->> 'on', '2026-10-01', 'its next month''s first day');
select results_eq($$ select x ->> 'last_name' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x $$,
  $$ values ('Cinq'), ('Deux'), ('Quatre'), ('Un') $$, 'every active professional of the clinic, by name (no draft, no other clinic)');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  'conforme', 'P1 is « Conforme » for September');
select is((select (x ->> 'increase_decided')::boolean from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  true, '… with the increase decided for October (green)');
select is((select (x ->> 'increase_decided')::boolean from jsonb_array_elements(public.list_retention_review('2026-10-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  false, '… not for the next month');
select is((select x -> 'entry' ->> 'sessions_50_60' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  '50', 'the month''s entry');
select is((select (x ->> 'sessions_before')::numeric from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  55.5, 'the count before the month');
select is((select (x ->> 'sessions_total')::numeric from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  105.5, '… and through it');
select ok((select x -> 'entry' ? 'updated_at' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  'the entry carries its version');
select is((select (x ->> 'agreements')::int from jsonb_array_elements(public.list_retention_review('2026-11-01') -> 'rows') x where x ->> 'last_name' = 'Un'),
  3, 'the agreements in force, counted');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Quatre'),
  'profession_unconfirmed', 'P4: « Profession à confirmer »');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Cinq'),
  'floor', 'P5: « Palier maximum atteint »');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Deux'),
  'no_rate', 'P2: no rate, « Taux de départ à fixer » (P4-197)');
select is(private.test_error_hint($$ select public.list_retention_review(null) $$), 'month', 'a month is required');

-- The decision counts through the month it was taken for (P4-187): reviewing September while
-- October is already entered, « Appliquer la suggestion » stores September's suggestion.
select lives_ok($$ select public.record_monthly_sessions('2026-09-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p2'), 'sessions_50_60', 40, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  'P2: 40 sessions in September');
select lives_ok($$ select public.record_monthly_sessions('2026-10-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p2'), 'sessions_50_60', 20, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  '… and 20 in October (60: tier 51)');
select is((select x -> 'suggested' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Deux'),
  '{"threshold_sessions": 0, "retention_pct": 30.00}'::jsonb, 'the review of September suggests 30 % (40 sessions)');
select is(public.decide_retention(current_setting('test.p2')::uuid, 'suggested', null, '2026-10-01', null, '2026-09-01', null) - 'id',
  '{"retention_pct": 30.00, "decreased": false}'::jsonb, 'applying it stores 30 %, not October''s 29.5 %');
select results_eq($$ select tier_threshold, suggested_pct, sessions_total from public.professional_retention
                      where professional_id = current_setting('test.p2')::uuid $$,
  $$ values (0, 30.00, 40.0) $$, '… with September''s count in the snapshot');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-09-01') -> 'rows') x where x ->> 'last_name' = 'Deux'),
  'conforme', 'September: « Conforme »');
select is((select x ->> 'status' from jsonb_array_elements(public.list_retention_review('2026-10-01') -> 'rows') x where x ->> 'last_name' = 'Deux'),
  'gap', 'October reaches tier 51: a gap');

-- « Maintenu » holds after a downward correction (P6, draft psychologue).
select lives_ok($$ select public.record_monthly_sessions('2026-07-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p6'), 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', 120, 'expected_updated_at', null))) $$,
  'P6 opens at 120 (tier 101)');
select lives_ok($$ select public.decide_retention(current_setting('test.p6')::uuid, 'initial', 28, '2026-07-01', null, '2026-07-01', null) $$, 'P6: 28 %');
select lives_ok($$ select public.decide_retention(current_setting('test.p6')::uuid, 'maintained', null, '2026-08-01', null, '2026-07-01',
                                                   private.test_open(current_setting('test.p6')::uuid)) $$, '… maintained at tier 101');
select is(public.get_professional_compensation(current_setting('test.p6')::uuid, '2026-08-15') ->> 'status', 'maintained', '« Maintenu »');
select lives_ok($$ select public.record_monthly_sessions('2026-07-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p6'), 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', 60,
    'expected_updated_at', (select updated_at from public.professional_session_counts
                             where professional_id = current_setting('test.p6')::uuid and month = '2026-07-01')))) $$,
  'a correction down to 60 (tier 51)');
select is(public.get_professional_compensation(current_setting('test.p6')::uuid, '2026-08-15') ->> 'status', 'maintained',
  'a lower tier after a correction: still « Maintenu »');
select lives_ok($$ select public.record_monthly_sessions('2026-07-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p6'), 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', 160,
    'expected_updated_at', (select updated_at from public.professional_session_counts
                             where professional_id = current_setting('test.p6')::uuid and month = '2026-07-01')))) $$,
  '160 (tier 151)');
select is(public.get_professional_compensation(current_setting('test.p6')::uuid, '2026-08-15') ->> 'status', 'gap',
  'a higher tier: the maintained rate is a gap');
-- A custom rate at the floor is never flagged again.
select lives_ok($$ select public.record_monthly_sessions('2026-07-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p6'), 'sessions_50_60', 0, 'sessions_30', 0, 'adjustment', 320,
    'expected_updated_at', (select updated_at from public.professional_session_counts
                             where professional_id = current_setting('test.p6')::uuid and month = '2026-07-01')))) $$,
  '320 (the floor, 301)');
select lives_ok($$ select public.decide_retention(current_setting('test.p6')::uuid, 'custom', 24, '2026-09-01', 'Sous le plancher (fictif)', '2026-07-01',
                                                   private.test_open(current_setting('test.p6')::uuid)) $$, 'a custom rate at the floor');
select lives_ok($$ select public.record_monthly_sessions('2026-08-01', jsonb_build_array(jsonb_build_object(
    'professional_id', current_setting('test.p6'), 'sessions_50_60', 400, 'sessions_30', 0, 'expected_updated_at', null))) $$,
  '400 more sessions');
select is(public.get_professional_compensation(current_setting('test.p6')::uuid, '2026-09-15') ->> 'status', 'custom',
  'at the floor, « Taux particulier » stays');

-- =============================================================================
-- The grid's boundaries and the sheet's full pay matrix (as postgres)
-- =============================================================================
reset role;
insert into public.professional_session_counts (org_id, professional_id, month, adjustment)
values ('b0000000-0000-0000-0000-00000000000a', current_setting('test.p7')::uuid, '2026-08-01', 50);
select results_eq($$ select suggested_threshold, suggested_pct, next_threshold from private.retention_overview('b0000000-0000-0000-0000-00000000000a', '2026-08-01', '2026-08-15')
                     where professional_id = current_setting('test.p7')::uuid $$,
  $$ values (0, 30.00, 51) $$, 'Sexologie, 50 sessions: the first tier');
update public.professional_session_counts set adjustment = 50.5 where professional_id = current_setting('test.p7')::uuid;
select results_eq($$ select suggested_threshold, suggested_pct, next_threshold from private.retention_overview('b0000000-0000-0000-0000-00000000000a', '2026-08-01', '2026-08-15')
                     where professional_id = current_setting('test.p7')::uuid $$,
  $$ values (0, 30.00, 51) $$, '50.5: still the first tier (« 0 à 50,5 »)');
update public.professional_session_counts set adjustment = 51 where professional_id = current_setting('test.p7')::uuid;
select results_eq($$ select suggested_threshold, suggested_pct, next_threshold from private.retention_overview('b0000000-0000-0000-0000-00000000000a', '2026-08-01', '2026-08-15')
                     where professional_id = current_setting('test.p7')::uuid $$,
  $$ values (51, 29.50, 101) $$, '51: the second tier');
update public.professional_session_counts set adjustment = 350 where professional_id = current_setting('test.p7')::uuid;
select results_eq($$ select suggested_threshold, suggested_pct, next_threshold from private.retention_overview('b0000000-0000-0000-0000-00000000000a', '2026-08-01', '2026-08-15')
                     where professional_id = current_setting('test.p7')::uuid $$,
  $$ values (301, 27.00, 351) $$, '350: « 301 à 350 »');
update public.professional_session_counts set adjustment = 550 where professional_id = current_setting('test.p7')::uuid;
select results_eq($$ select suggested_threshold, suggested_pct, next_threshold, floor_pct from private.retention_overview('b0000000-0000-0000-0000-00000000000a', '2026-08-01', '2026-08-15')
                     where professional_id = current_setting('test.p7')::uuid $$,
  $$ values (501, 25.00, null::int, 25.00) $$, '550: the floor, no next tier');
select results_eq($$ select suggested_threshold, suggested_pct from private.retention_overview('b0000000-0000-0000-0000-00000000000a', '2026-07-01', '2026-08-15')
                     where professional_id = current_setting('test.p6')::uuid $$,
  $$ values (301, 25.00) $$, 'Psychologie, 320 sessions: the floor at 301');
-- Every tier and duration of the clinic's sheet (« Grille tarifaire »), pay to the cent, from org B's
-- untouched seed; Psychoéducation 60 min at 165 $ (Jonathan's correction of the sheet's 170 $).
select results_eq($$ select t.key, gt.threshold_sessions, gt.retention_pct, gp.duration::int,
                            private.retention_pay_cents(gp.client_price_cents, gt.retention_pct)
                       from public.retention_grids g
                       join public.profession_titles t on t.id = g.title_id
                       join public.retention_grid_tiers gt on gt.grid_id = g.id
                       join public.retention_grid_prices gp on gp.grid_id = g.id
                      where g.org_id = 'b0000000-0000-0000-0000-00000000000b'
                      order by t.key, gt.threshold_sessions, gp.duration desc $$,
  $$ values
            ('coach_professionnel', 0, 30.00, 60, 8524), ('coach_professionnel', 0, 30.00, 50, 7306), ('coach_professionnel', 0, 30.00, 30, 4871), ('coach_professionnel', 51, 29.50, 60, 8585),
            ('coach_professionnel', 51, 29.50, 50, 7358), ('coach_professionnel', 51, 29.50, 30, 4905), ('coach_professionnel', 101, 29.00, 60, 8646), ('coach_professionnel', 101, 29.00, 50, 7410),
            ('coach_professionnel', 101, 29.00, 30, 4940), ('coach_professionnel', 151, 28.50, 60, 8707), ('coach_professionnel', 151, 28.50, 50, 7462), ('coach_professionnel', 151, 28.50, 30, 4975),
            ('coach_professionnel', 201, 28.00, 60, 8767), ('coach_professionnel', 201, 28.00, 50, 7515), ('coach_professionnel', 201, 28.00, 30, 5010), ('coach_professionnel', 251, 27.50, 60, 8828),
            ('coach_professionnel', 251, 27.50, 50, 7567), ('coach_professionnel', 251, 27.50, 30, 5045), ('coach_professionnel', 301, 27.00, 60, 8889), ('coach_professionnel', 301, 27.00, 50, 7619),
            ('coach_professionnel', 301, 27.00, 30, 5079), ('coach_professionnel', 351, 26.50, 60, 8950), ('coach_professionnel', 351, 26.50, 50, 7671), ('coach_professionnel', 351, 26.50, 30, 5114),
            ('coach_professionnel', 401, 26.00, 60, 9011), ('coach_professionnel', 401, 26.00, 50, 7723), ('coach_professionnel', 401, 26.00, 30, 5149), ('coach_professionnel', 451, 25.50, 60, 9072),
            ('coach_professionnel', 451, 25.50, 50, 7776), ('coach_professionnel', 451, 25.50, 30, 5184), ('coach_professionnel', 501, 25.00, 60, 9133), ('coach_professionnel', 501, 25.00, 50, 7828),
            ('coach_professionnel', 501, 25.00, 30, 5219), ('conseiller_orientation', 0, 30.00, 50, 9800), ('conseiller_orientation', 0, 30.00, 30, 7000), ('conseiller_orientation', 51, 29.50, 50, 9870),
            ('conseiller_orientation', 51, 29.50, 30, 7050), ('conseiller_orientation', 101, 29.00, 50, 9940), ('conseiller_orientation', 101, 29.00, 30, 7100), ('conseiller_orientation', 151, 28.50, 50, 10010),
            ('conseiller_orientation', 151, 28.50, 30, 7150), ('conseiller_orientation', 201, 28.00, 50, 10080), ('conseiller_orientation', 201, 28.00, 30, 7200), ('conseiller_orientation', 251, 27.50, 50, 10150),
            ('conseiller_orientation', 251, 27.50, 30, 7250), ('conseiller_orientation', 301, 27.00, 50, 10220), ('conseiller_orientation', 301, 27.00, 30, 7300), ('conseiller_orientation', 351, 26.50, 50, 10290),
            ('conseiller_orientation', 351, 26.50, 30, 7350), ('conseiller_orientation', 401, 26.00, 50, 10360), ('conseiller_orientation', 401, 26.00, 30, 7400), ('conseiller_orientation', 451, 25.50, 50, 10430),
            ('conseiller_orientation', 451, 25.50, 30, 7450), ('conseiller_orientation', 501, 25.00, 50, 10500), ('conseiller_orientation', 501, 25.00, 30, 7500), ('naturopathe', 0, 30.00, 50, 8400),
            ('naturopathe', 0, 30.00, 30, 5600), ('naturopathe', 51, 29.50, 50, 8460), ('naturopathe', 51, 29.50, 30, 5640), ('naturopathe', 101, 29.00, 50, 8520),
            ('naturopathe', 101, 29.00, 30, 5680), ('naturopathe', 151, 28.50, 50, 8580), ('naturopathe', 151, 28.50, 30, 5720), ('naturopathe', 201, 28.00, 50, 8640),
            ('naturopathe', 201, 28.00, 30, 5760), ('naturopathe', 251, 27.50, 50, 8700), ('naturopathe', 251, 27.50, 30, 5800), ('naturopathe', 301, 27.00, 50, 8760),
            ('naturopathe', 301, 27.00, 30, 5840), ('naturopathe', 351, 26.50, 50, 8820), ('naturopathe', 351, 26.50, 30, 5880), ('naturopathe', 401, 26.00, 50, 8880),
            ('naturopathe', 401, 26.00, 30, 5920), ('naturopathe', 451, 25.50, 50, 8940), ('naturopathe', 451, 25.50, 30, 5960), ('naturopathe', 501, 25.00, 50, 9000),
            ('naturopathe', 501, 25.00, 30, 6000), ('psychoeducateur', 0, 30.00, 60, 11550), ('psychoeducateur', 0, 30.00, 50, 9800), ('psychoeducateur', 0, 30.00, 30, 7000),
            ('psychoeducateur', 51, 29.50, 60, 11633), ('psychoeducateur', 51, 29.50, 50, 9870), ('psychoeducateur', 51, 29.50, 30, 7050), ('psychoeducateur', 101, 29.00, 60, 11715),
            ('psychoeducateur', 101, 29.00, 50, 9940), ('psychoeducateur', 101, 29.00, 30, 7100), ('psychoeducateur', 151, 28.50, 60, 11798), ('psychoeducateur', 151, 28.50, 50, 10010),
            ('psychoeducateur', 151, 28.50, 30, 7150), ('psychoeducateur', 201, 28.00, 60, 11880), ('psychoeducateur', 201, 28.00, 50, 10080), ('psychoeducateur', 201, 28.00, 30, 7200),
            ('psychoeducateur', 251, 27.50, 60, 11963), ('psychoeducateur', 251, 27.50, 50, 10150), ('psychoeducateur', 251, 27.50, 30, 7250), ('psychoeducateur', 301, 27.00, 60, 12045),
            ('psychoeducateur', 301, 27.00, 50, 10220), ('psychoeducateur', 301, 27.00, 30, 7300), ('psychoeducateur', 351, 26.50, 60, 12128), ('psychoeducateur', 351, 26.50, 50, 10290),
            ('psychoeducateur', 351, 26.50, 30, 7350), ('psychoeducateur', 401, 26.00, 60, 12210), ('psychoeducateur', 401, 26.00, 50, 10360), ('psychoeducateur', 401, 26.00, 30, 7400),
            ('psychoeducateur', 451, 25.50, 60, 12293), ('psychoeducateur', 451, 25.50, 50, 10430), ('psychoeducateur', 451, 25.50, 30, 7450), ('psychoeducateur', 501, 25.00, 60, 12375),
            ('psychoeducateur', 501, 25.00, 50, 10500), ('psychoeducateur', 501, 25.00, 30, 7500), ('psychologue', 0, 28.00, 60, 14400), ('psychologue', 0, 28.00, 50, 12600),
            ('psychologue', 0, 28.00, 30, 9360), ('psychologue', 51, 27.50, 60, 14500), ('psychologue', 51, 27.50, 50, 12688), ('psychologue', 51, 27.50, 30, 9425),
            ('psychologue', 101, 27.00, 60, 14600), ('psychologue', 101, 27.00, 50, 12775), ('psychologue', 101, 27.00, 30, 9490), ('psychologue', 151, 26.50, 60, 14700),
            ('psychologue', 151, 26.50, 50, 12863), ('psychologue', 151, 26.50, 30, 9555), ('psychologue', 201, 26.00, 60, 14800), ('psychologue', 201, 26.00, 50, 12950),
            ('psychologue', 201, 26.00, 30, 9620), ('psychologue', 251, 25.50, 60, 14900), ('psychologue', 251, 25.50, 50, 13038), ('psychologue', 251, 25.50, 30, 9685),
            ('psychologue', 301, 25.00, 60, 15000), ('psychologue', 301, 25.00, 50, 13125), ('psychologue', 301, 25.00, 30, 9750), ('psychotherapeute', 0, 28.00, 60, 13320),
            ('psychotherapeute', 0, 28.00, 50, 11520), ('psychotherapeute', 0, 28.00, 30, 8640), ('psychotherapeute', 51, 27.50, 60, 13413), ('psychotherapeute', 51, 27.50, 50, 11600),
            ('psychotherapeute', 51, 27.50, 30, 8700), ('psychotherapeute', 101, 27.00, 60, 13505), ('psychotherapeute', 101, 27.00, 50, 11680), ('psychotherapeute', 101, 27.00, 30, 8760),
            ('psychotherapeute', 151, 26.50, 60, 13598), ('psychotherapeute', 151, 26.50, 50, 11760), ('psychotherapeute', 151, 26.50, 30, 8820), ('psychotherapeute', 201, 26.00, 60, 13690),
            ('psychotherapeute', 201, 26.00, 50, 11840), ('psychotherapeute', 201, 26.00, 30, 8880), ('psychotherapeute', 251, 25.50, 60, 13783), ('psychotherapeute', 251, 25.50, 50, 11920),
            ('psychotherapeute', 251, 25.50, 30, 8940), ('psychotherapeute', 301, 25.00, 60, 13875), ('psychotherapeute', 301, 25.00, 50, 12000), ('psychotherapeute', 301, 25.00, 30, 9000),
            ('sexologue', 0, 30.00, 60, 12250), ('sexologue', 0, 30.00, 50, 10500), ('sexologue', 0, 30.00, 30, 7700), ('sexologue', 51, 29.50, 60, 12338),
            ('sexologue', 51, 29.50, 50, 10575), ('sexologue', 51, 29.50, 30, 7755), ('sexologue', 101, 29.00, 60, 12425), ('sexologue', 101, 29.00, 50, 10650),
            ('sexologue', 101, 29.00, 30, 7810), ('sexologue', 151, 28.50, 60, 12513), ('sexologue', 151, 28.50, 50, 10725), ('sexologue', 151, 28.50, 30, 7865),
            ('sexologue', 201, 28.00, 60, 12600), ('sexologue', 201, 28.00, 50, 10800), ('sexologue', 201, 28.00, 30, 7920), ('sexologue', 251, 27.50, 60, 12688),
            ('sexologue', 251, 27.50, 50, 10875), ('sexologue', 251, 27.50, 30, 7975), ('sexologue', 301, 27.00, 60, 12775), ('sexologue', 301, 27.00, 50, 10950),
            ('sexologue', 301, 27.00, 30, 8030), ('sexologue', 351, 26.50, 60, 12863), ('sexologue', 351, 26.50, 50, 11025), ('sexologue', 351, 26.50, 30, 8085),
            ('sexologue', 401, 26.00, 60, 12950), ('sexologue', 401, 26.00, 50, 11100), ('sexologue', 401, 26.00, 30, 8140), ('sexologue', 451, 25.50, 60, 13038),
            ('sexologue', 451, 25.50, 50, 11175), ('sexologue', 451, 25.50, 30, 8195), ('sexologue', 501, 25.00, 60, 13125), ('sexologue', 501, 25.00, 50, 11250),
            ('sexologue', 501, 25.00, 30, 8250), ('travailleur_social', 0, 30.00, 60, 10500), ('travailleur_social', 0, 30.00, 50, 8400), ('travailleur_social', 0, 30.00, 30, 5950),
            ('travailleur_social', 51, 29.50, 60, 10575), ('travailleur_social', 51, 29.50, 50, 8460), ('travailleur_social', 51, 29.50, 30, 5993), ('travailleur_social', 101, 29.00, 60, 10650),
            ('travailleur_social', 101, 29.00, 50, 8520), ('travailleur_social', 101, 29.00, 30, 6035), ('travailleur_social', 151, 28.50, 60, 10725), ('travailleur_social', 151, 28.50, 50, 8580),
            ('travailleur_social', 151, 28.50, 30, 6078), ('travailleur_social', 201, 28.00, 60, 10800), ('travailleur_social', 201, 28.00, 50, 8640), ('travailleur_social', 201, 28.00, 30, 6120),
            ('travailleur_social', 251, 27.50, 60, 10875), ('travailleur_social', 251, 27.50, 50, 8700), ('travailleur_social', 251, 27.50, 30, 6163), ('travailleur_social', 301, 27.00, 60, 10950),
            ('travailleur_social', 301, 27.00, 50, 8760), ('travailleur_social', 301, 27.00, 30, 6205), ('travailleur_social', 351, 26.50, 60, 11025), ('travailleur_social', 351, 26.50, 50, 8820),
            ('travailleur_social', 351, 26.50, 30, 6248), ('travailleur_social', 401, 26.00, 60, 11100), ('travailleur_social', 401, 26.00, 50, 8880), ('travailleur_social', 401, 26.00, 30, 6290),
            ('travailleur_social', 451, 25.50, 60, 11175), ('travailleur_social', 451, 25.50, 50, 8940), ('travailleur_social', 451, 25.50, 30, 6333), ('travailleur_social', 501, 25.00, 60, 11250),
            ('travailleur_social', 501, 25.00, 50, 9000), ('travailleur_social', 501, 25.00, 30, 6375)
  $$, 'the sheet''s pay matrix: 8 professions, every tier and duration, to the cent');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- =============================================================================
-- Permissions
-- =============================================================================
-- The adjointe (no professionals.compensation): every RPC refused, every table empty.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(f.sql, '42501', 'Permission refusée : professionals.compensation', 'the adjointe: ' || f.name)
  from (values
    ('set_compensation_rate',            $$ select public.set_compensation_rate('workshop', 20, '2027-05-01') $$),
    ('delete_compensation_rate',         $$ select public.delete_compensation_rate(gen_random_uuid()) $$),
    ('set_retention_grid',               $$ select public.set_retention_grid(gen_random_uuid(), '2027-05-01', '[]', '[]', null) $$),
    ('delete_retention_grid',            $$ select public.delete_retention_grid(gen_random_uuid()) $$),
    ('record_monthly_sessions',          $$ select public.record_monthly_sessions('2026-09-01', '[]') $$),
    ('decide_retention',                 $$ select public.decide_retention(current_setting('test.p1')::uuid, 'suggested', null, '2027-05-01', null, '2026-09-01', null) $$),
    ('delete_professional_retention',    $$ select public.delete_professional_retention(gen_random_uuid()) $$),
    ('set_professional_client_agreement', $$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'X', 50, 1, 1, '2027-05-01', null) $$),
    ('end_professional_client_agreement', $$ select public.end_professional_client_agreement(gen_random_uuid(), null) $$),
    ('delete_professional_client_agreement', $$ select public.delete_professional_client_agreement(gen_random_uuid()) $$),
    ('get_professional_compensation',    $$ select public.get_professional_compensation(current_setting('test.p1')::uuid) $$),
    ('list_retention_review',            $$ select public.list_retention_review('2026-09-01') $$)) as f(name, sql);
select is((select count(*)::int from public.professional_retention) + (select count(*)::int from public.professional_session_counts)
          + (select count(*)::int from public.professional_client_agreements) + (select count(*)::int from public.retention_grids)
          + (select count(*)::int from public.compensation_rates) + (select count(*)::int from public.compensation_kinds),
  0, 'the adjointe reads none of the compensation tables');
-- The provider (professionals.self): nothing, not even their own (the retention is internal).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p2')::uuid) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the provider cannot read their own compensation');
select is((select count(*)::int from public.professional_retention) + (select count(*)::int from public.retention_grid_tiers)
          + (select count(*)::int from public.retention_grid_prices) + (select count(*)::int from public.professional_session_counts),
  0, 'the provider reads none of the tables');
-- Admin B, with org A's ids.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_compensation(current_setting('test.p1')::uuid) $$, 'P0001', 'Professionnel introuvable.',
  'admin B cannot read org A''s professional');
select throws_ok($$ select public.decide_retention(current_setting('test.p1')::uuid, 'custom', 20, '2027-05-01', 'x', '2026-09-01', null) $$, 'P0001', 'Professionnel introuvable.',
  '… nor decide for them');
select throws_ok($$ select public.set_professional_client_agreement(current_setting('test.p1')::uuid, 'X', 50, 1, 1, '2027-05-01', null) $$,
  'P0001', 'Professionnel introuvable.', '… nor add an agreement');
select throws_ok(format($$ select public.delete_professional_client_agreement(%L) $$, current_setting('test.ag1')), 'P0001', 'Entente introuvable.',
  '… nor delete org A''s agreement');
select throws_ok(format($$ select public.end_professional_client_agreement(%L, '2027-06-01') $$, current_setting('test.ag1')), 'P0001', 'Entente introuvable.',
  '… nor end it');
select throws_ok($$ select public.delete_professional_retention((select r.id from public.professional_retention r limit 1)) $$, 'P0001', 'Taux introuvable.',
  '… nor delete a rate (org A''s ids are invisible)');
select throws_ok(format($$ select public.set_retention_grid(%L, '2027-01-01', '[{"threshold_sessions": 0, "retention_pct": 28}]', '[{"duration": 50, "client_price_cents": 100}]', null) $$,
                        current_setting('test.psy_a')), 'P0001', 'Profession introuvable.', '… nor version org A''s grid');
select is(jsonb_array_length(public.list_retention_review('2026-09-01') -> 'rows'), 1, 'admin B''s review lists org B only');
select is((select count(*)::int from public.professional_retention r where r.professional_id = current_setting('test.p1')::uuid)
          + (select count(*)::int from public.retention_grids g where g.org_id = 'b0000000-0000-0000-0000-00000000000a'),
  0, 'admin B reads none of org A''s rows');
-- Module off.
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.list_retention_review('2026-09-01') $$, '42501', 'Permission refusée : professionals.compensation', 'module off: no review');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- History and audit
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select distinct h.table_name from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
                      where h.table_name in ('professional_retention', 'professional_session_counts', 'professional_client_agreements')
                      order by 1 $$,
  $$ values ('professional_client_agreements'), ('professional_retention'), ('professional_session_counts') $$,
  'the admin''s history shows rates, sessions and agreements');
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name in ('professional_retention', 'professional_session_counts', 'professional_client_agreements')
              and left(h.record_id, 36) <> current_setting('test.p1')), 0, 'their record ids start with the professional');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
            where h.table_name in ('professional_retention', 'professional_session_counts', 'professional_client_agreements')),
  0, 'the adjointe''s history leaves them out');
reset role;
select is((select changed_fields ->> 'retention_pct' from public.audit_log
            where table_name = 'professional_retention' and action = 'delete' and record_id like current_setting('test.p1') || ':%'),
  '26.00', 'a deleted rate keeps its value in the log (P4-149)');
select is((select array_agg(distinct changed_fields ->> 'client_label') from public.audit_log
            where table_name = 'professional_client_agreements' and action in ('insert', 'delete')),
  array['[redacted]'], 'a client reference never reaches the log (Loi 25, P4-193)');
select is((select changed_fields ->> 'professional_amount_cents' from public.audit_log
            where table_name = 'professional_client_agreements' and action = 'insert'
              and org_id = 'b0000000-0000-0000-0000-00000000000a' order by id limit 1),
  '8500', '… while the amounts do');

-- =============================================================================
-- Import: retention_pct and cumulative_sessions (P4-192)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.import_professional('{"first_name": "Ima", "last_name": "Port", "email": "import@exemple.test",
    "professions": [{"title_key": "psychologue", "licence_number": "54321", "is_primary": true}],
    "retention_pct": 27.5, "cumulative_sessions": 62.5}', true) ->> 'status', 'ok', 'dry run with both keys');
select is((select count(*)::int from public.professionals where email = 'import@exemple.test'), 0, '… writes nothing');
select is(public.import_professional('{"first_name": "Ima", "last_name": "Port", "email": "import@exemple.test",
    "professions": [{"title_key": "psychologue", "licence_number": "54321", "is_primary": true}],
    "retention_pct": 27.5, "cumulative_sessions": 62.5}', false) ->> 'status', 'ok', 'the real run');
select results_eq($$ select c.month, c.adjustment, c.note from public.professional_session_counts c
                      join public.professionals p on p.id = c.professional_id where p.email = 'import@exemple.test' $$,
  $$ values (current_setting('test.last_month')::date, 62.5, 'Solde importé'::text) $$, 'the opening balance on last month');
select results_eq($$ select r.decision, r.retention_pct, r.effective_from from public.professional_retention r
                      join public.professionals p on p.id = r.professional_id where p.email = 'import@exemple.test' $$,
  $$ values ('initial'::text, 27.50, current_setting('test.this_month')::date) $$,
  'the rate as an initial decision, from the first day of the import''s month');
select is(public.decide_retention((select id from public.professionals where email = 'import@exemple.test'), 'suggested', null,
                                  (current_setting('test.this_month')::date + interval '1 month')::date, null,
                                  current_setting('test.this_month')::date,
                                  private.test_open((select id from public.professionals where email = 'import@exemple.test'))) ->> 'retention_pct',
  '27.50', 'the first review''s decision, for the first day of next month, is accepted (62.5 sessions: 27.5 %)');
select is((public.import_professional('{"first_name": "Ana", "last_name": "Lyse", "email": "ana@exemple.test", "retention_pct": 101,
    "cumulative_sessions": 1.3}', true) -> 'errors'),
  '[{"field": "retentionPct", "message": "Le taux de retenue est un pourcentage entre 0 et 100, à deux décimales au plus."},
    {"field": "cumulativeSessions", "message": "Le nombre de séances cumulées est compris entre 0 et 100 000, par demi-séance."}]'::jsonb,
  'out-of-bounds values are row errors');
select throws_ok($$ select public.import_professional('{"first_name": "A", "last_name": "B", "email": "x@exemple.test", "retention_pct": "27"}', true) $$,
  '22023', 'Nombre attendu : retention_pct', 'contract: a number');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.import_professional('{"first_name": "A", "last_name": "B", "email": "y@exemple.test", "cumulative_sessions": 3}', true) $$,
  '42501', 'Permission refusée : professionals.compensation', 'the adjointe cannot import compensation values');
select is(public.import_professional('{"first_name": "A", "last_name": "B", "email": "y@exemple.test"}', true) ->> 'status', 'ok',
  '… but imports a row without them');

select * from finish();
rollback;
