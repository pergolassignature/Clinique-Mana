-- Demandes, batch D5 (migrations *_professionals_places_restart.sql, *_demandes_capacity.sql): the
-- places offered set from the board (« Recommencer le décompte »), the board (active ones by
-- name, places declared / taken / left, the totals), the nightly snapshots (one row per
-- professional per day, replaced when run again), permissions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('list_professional_capacity', 'set_professional_new_client_places')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the RPCs: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_capacity_snapshot', 'job_demandes_capacity_snapshots', 'stamp_new_client_places')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');
select table_privs_are('public', 'capacity_snapshots', 'authenticated', array['SELECT'], 'snapshots: read only');
select results_eq($$ select kind, is_maintenance, sql_function from public.scheduled_jobs where key = 'demandes.capacity_snapshots' $$,
  $$ values ('sql', true, 'private.job_demandes_capacity_snapshots') $$, 'a nightly maintenance job (« Exécuter maintenant »)');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ca.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@ca.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@ca.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@ca.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('clients'), ('professionals'), ('demandes')) y(m);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.p1', public.create_professional('Hélène', 'Places', 'helene@ca.test')::text, true);
select set_config('test.p2', public.create_professional('Bruno', 'Inactif', 'bruno@ca.test')::text, true);
reset role;
update public.professionals set status = 'active' where id = current_setting('test.p1')::uuid;

-- =============================================================================
-- The places offered (Professionnels, from the board)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((public.set_professional_new_client_places(current_setting('test.p1')::uuid, 3) ->> 'new_client_places')::int, 3,
  'the counselor (professionals.matching) sets 3 places');
reset role;
-- Declared ten days ago (the stamp is the trigger's: set it past with the trigger off).
alter table public.professional_matching_profiles disable trigger professional_matching_profiles_stamp_places;
update public.professional_matching_profiles set new_client_places_set_at = now() - interval '10 days'
 where professional_id = current_setting('test.p1')::uuid;
alter table public.professional_matching_profiles enable trigger professional_matching_profiles_stamp_places;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok((public.set_professional_new_client_places(current_setting('test.p1')::uuid, 3) ->> 'new_client_places_set_at')::timestamptz < now() - interval '9 days',
  'the same number again: the day stays (P4-382)');
select ok((public.set_professional_new_client_places(current_setting('test.p1')::uuid, 3, true) ->> 'new_client_places_set_at')::timestamptz = now(),
  '« Recommencer le décompte »: today, the same number');
reset role;
-- The restart is the RPC's alone: after it, another write of the profile leaves the day alone.
alter table public.professional_matching_profiles disable trigger professional_matching_profiles_stamp_places;
update public.professional_matching_profiles set new_client_places_set_at = now() - interval '5 days'
 where professional_id = current_setting('test.p1')::uuid;
alter table public.professional_matching_profiles enable trigger professional_matching_profiles_stamp_places;
update public.professional_matching_profiles set accepting_new_clients = true where professional_id = current_setting('test.p1')::uuid;
select ok((select new_client_places_set_at from public.professional_matching_profiles where professional_id = current_setting('test.p1')::uuid)
            < now() - interval '4 days', 'the restart setting does not outlive the RPC');
alter table public.professional_matching_profiles disable trigger professional_matching_profiles_stamp_places;
update public.professional_matching_profiles set new_client_places_set_at = now() where professional_id = current_setting('test.p1')::uuid;
alter table public.professional_matching_profiles enable trigger professional_matching_profiles_stamp_places;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_new_client_places(current_setting('test.p1')::uuid, 120) $$, 'P0001', null, '0 to 99 places');
select throws_ok($$ select public.set_professional_new_client_places(current_setting('test.p1')::uuid, null, true) $$, 'P0001', null,
  'a restart needs a number');
select is(public.set_professional_new_client_places(current_setting('test.p2')::uuid, null) ->> 'new_client_places', null, 'null: not tracked');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_new_client_places(current_setting('test.p1')::uuid, 1) $$, '42501', null, 'a provider sets nothing');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'professional_matching_profiles' and action = 'update'
                   and source = 'rpc:set_professional_new_client_places'), 'audited, with its source');

-- A request matched to her since: one place taken.
insert into public.demandes (org_id, reference, reference_year, reference_seq, contact_name, state, matched_professional_id, matched_at)
values ('b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9001', 2026, 9001, 'Jumelée', 'matched', current_setting('test.p1')::uuid, now());

-- =============================================================================
-- The board
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.b', public.list_professional_capacity()::text, true);
reset role;
select results_eq($$ select (b ->> 'total_left')::int, (b ->> 'tracked')::int, (b ->> 'with_places')::int, jsonb_array_length(b -> 'professionals')
                       from (select current_setting('test.b')::jsonb b) x $$,
  $$ values (2, 1, 1, 1) $$, 'the totals: 2 places left at 1 tracked professional; the inactive one is not on the board');
select results_eq($$ select p ->> 'display_name', (p ->> 'places_declared')::int, (p ->> 'places_used')::int, (p ->> 'places_left')::int,
                            (p ->> 'matched_30_days')::int, p -> 'languages' ->> 0
                       from jsonb_array_elements(current_setting('test.b')::jsonb -> 'professionals') p $$,
  $$ values ('Hélène Places', 3, 1, 2, 1, 'Français') $$, 'her row: 3 declared, 1 taken, 2 left, 1 match in 30 days, French');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.list_professional_capacity() $$, '42501', null, 'a provider never reads the board');
reset role;

-- =============================================================================
-- The snapshots
-- =============================================================================
select matches(private.job_demandes_capacity_snapshots(), '^orgs=[1-9][0-9]* rows=[1-9][0-9]*$', 'the job: every clinic with Demandes on');
select is((select count(*)::int from public.capacity_snapshots where org_id = 'b0000000-0000-0000-0000-00000000000a'), 1,
  '… here, one row: the active professional only');
select results_eq($$ select places_declared::int, places_used, places_left, accepting_new_clients from public.capacity_snapshots
                      where professional_id = current_setting('test.p1')::uuid $$,
  $$ values (3, 1, 2, true) $$, 'today''s photo');
-- The match dates from before the count was restarted: the place is free again.
update public.demandes set matched_at = now() - interval '1 day' where reference = 'DEM-2026-9001';
select matches(private.job_demandes_capacity_snapshots(), '^orgs=', 'run again the same day …');
select results_eq($$ select count(*)::int, max(places_left) from public.capacity_snapshots where professional_id = current_setting('test.p1')::uuid $$,
  $$ values (1, 3) $$, '… the day''s photo is replaced, never doubled');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.capacity_snapshots $$, 'a provider reads no snapshot');
reset role;

-- Another clinic: never her places, never her board, never her photos.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u9@ca.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Conseillère B', 'u9@ca.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000b', m, true from (values ('clients'), ('professionals'), ('demandes')) y(m);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_new_client_places(current_setting('test.p1')::uuid, 1) $$, 'P0001', null,
  'another clinic''s professional: unknown');
select is(jsonb_array_length(public.list_professional_capacity() -> 'professionals'), 0, 'another clinic''s board: empty');
select is_empty($$ select 1 from public.capacity_snapshots $$, 'another clinic''s staff read none of her photos');
reset role;
-- Demandes off: no board; the job skips the clinic.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
delete from public.capacity_snapshots where org_id = 'b0000000-0000-0000-0000-00000000000a';
select private.job_demandes_capacity_snapshots();
select is_empty($$ select 1 from public.capacity_snapshots where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  'Demandes off: the job skips the clinic');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.list_professional_capacity() $$, '42501', null, 'Demandes off: no board');
reset role;

select * from finish();
rollback;
