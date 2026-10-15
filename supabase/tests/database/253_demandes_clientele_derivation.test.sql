-- The clientèle « Automatique » (migration *_demandes_clientele_derivation.sql, D-59). Covers: the
-- one rule (`demandes_clientele_holds`: the one asked, else a couple's, a family's, else the age's;
-- no basis: all); what it gives on the clinic's catalogue (`demandes_clientele_fit`); the criteria
-- say whose age (the main participant, else the request's file) and the clientèle derived and
-- applied; get_demande's `match_basis` for the Accueil field; both granted to no role. The match
-- itself (same results as before) is 164's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(not has_function_privilege('authenticated', 'private.demandes_clientele_fit(uuid, uuid, text, int)', 'execute')
          and not has_function_privilege('authenticated', 'private.demandes_clientele_holds(uuid, text, int, uuid, text, int, int)', 'execute'),
  'the helpers are granted to no role');

-- The rule, on a clientèle's id, key and ages.
select ok(private.demandes_clientele_holds('00000000-0000-0000-0000-000000000001', 'couple', 9, '00000000-0000-0000-0000-000000000001', 'adults', 18, null)
          and not private.demandes_clientele_holds('00000000-0000-0000-0000-000000000001', 'couple', 9, '00000000-0000-0000-0000-000000000002', 'couples', null, null),
  'the one asked wins over everything');
select ok(private.demandes_clientele_holds(null, 'couple', 9, gen_random_uuid(), 'couples', null, null)
          and not private.demandes_clientele_holds(null, 'couple', 9, gen_random_uuid(), 'children', 0, 12),
  'a couple: Couples (not the age''s)');
select ok(private.demandes_clientele_holds(null, 'family', null, gen_random_uuid(), 'families', null, null), 'a family: Familles');
select ok(private.demandes_clientele_holds(null, 'child', 9, gen_random_uuid(), 'children', 0, 12)
          and not private.demandes_clientele_holds(null, 'child', 9, gen_random_uuid(), 'adults', 18, null)
          and not private.demandes_clientele_holds(null, 'self', 30, gen_random_uuid(), 'parents', null, null),
  'else the age''s (a clientèle without ages never fits an age)');
select ok(private.demandes_clientele_holds(null, null, null, gen_random_uuid(), 'adults', 18, null), 'no basis: every clientèle (nothing checked)');

-- =============================================================================
-- Fixtures (as postgres): org A (its catalogue is seeded with the clinic), a counselor.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'u1@dcd.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@dcd.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m.key, true from (values ('professionals'), ('clients'), ('demandes')) m(key);

select results_eq($$ select x ->> 'basis', (select array_agg(k ->> 'key') from jsonb_array_elements(x -> 'clienteles') k)
                       from (select private.demandes_clientele_fit('b0000000-0000-0000-0000-00000000000a', null, 'child', 9) as x) s $$,
  $$ values ('age'::text, array['children']) $$, 'the catalogue: a child of 9 → Enfants');
select results_eq($$ select x ->> 'basis', (select array_agg(k ->> 'key' order by k ->> 'key') from jsonb_array_elements(x -> 'clienteles') k)
                       from (select private.demandes_clientele_fit('b0000000-0000-0000-0000-00000000000a', null, 'self', 20) as x) s $$,
  $$ values ('age'::text, array['adults', 'young_adults']) $$, '20 years: Jeunes adultes and Adultes');
select is(private.demandes_clientele_fit('b0000000-0000-0000-0000-00000000000a', null, 'self', null),
  '{"basis": "none", "clienteles": []}'::jsonb, 'no basis: « à préciser »');
select is(private.demandes_clientele_fit('b0000000-0000-0000-0000-00000000000a', null, 'couple', 9) -> 'clienteles' -> 0 ->> 'name',
  'Couples', 'a couple: Couples, by name');

-- =============================================================================
-- The criteria and the bundle
-- =============================================================================
insert into public.clients (id, org_id, first_name, last_name, birthday) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Maman', 'Parent', (current_date - interval '40 years')::date);
-- D1: the mother's file, her child (9) the main participant, « Adultes » chosen by hand.
insert into public.demandes (id, org_id, client_id, beneficiary, clientele_id) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'child',
   (select id from public.clienteles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'adults'));
insert into public.demande_participants (demande_id, org_id, display_name, relationship, birthday, is_primary) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léo', 'child',
   (current_date - interval '9 years 2 months')::date, true);
-- D2: her file only. D3: no file, no participant.
insert into public.demandes (id, org_id, client_id) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001');
insert into public.demandes (id, org_id, contact_first_name) values
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Personne');

select results_eq($$ select c ->> 'person', (c ->> 'age')::int, c -> 'clientele_auto' -> 'clienteles' -> 0 ->> 'key',
                            c -> 'clientele_fit' ->> 'basis', c -> 'clientele_fit' -> 'clienteles' -> 0 ->> 'key'
                       from (select private.demandes_match_criteria('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001') as c) x $$,
  $$ values ('participant'::text, 9, 'children'::text, 'chosen'::text, 'adults'::text) $$,
  'the main participant''s age; automatic: Enfants; applied: the choice (Adultes)');
select results_eq($$ select c ->> 'person', (c ->> 'age')::int, c -> 'clientele_auto' -> 'clienteles' -> 0 ->> 'key'
                       from (select private.demandes_match_criteria('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002') as c) x $$,
  $$ values ('file'::text, 40, 'adults'::text) $$, 'no participants: the request''s file');
select results_eq($$ select c ->> 'person', c ->> 'age', c -> 'clientele_auto' ->> 'basis'
                       from (select private.demandes_match_criteria('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003') as c) x $$,
  $$ values (null::text, null::text, 'none'::text) $$, 'nobody to read an age from: none');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select b ->> 'person', (b ->> 'age')::int, b -> 'clientele_auto' ->> 'basis', b -> 'clientele_auto' -> 'clienteles' -> 0 ->> 'name'
                       from (select public.get_demande('e0000000-0000-0000-0000-000000000001') -> 'match_basis' as b) x $$,
  $$ values ('participant'::text, 9, 'age'::text, 'Enfants'::text) $$,
  'get_demande: the basis the Accueil field shows (« Automatique : Enfants (participant principal, 9 ans) »)');
select is((select public.get_demande('e0000000-0000-0000-0000-000000000001') -> 'match_basis' ? 'sex'), false, 'never the sex');
select results_eq($$ select (select array_agg(k.key order by k.key) from public.clienteles k
                              where k.id in (select x::uuid from jsonb_array_elements_text(public.get_demande('e0000000-0000-0000-0000-000000000001') -> 'match_basis' -> 'derivable_ids') x)) $$,
  $$ values (array['adolescents', 'adults', 'children', 'couples', 'families', 'young_adults']) $$,
  'the clientèles the rule can give: ages, couples, families (never Parents or Athlètes)');
reset role;
-- A couple request: Couples, whatever the age.
update public.demandes set beneficiary = 'couple', clientele_id = null where id = 'e0000000-0000-0000-0000-000000000001';
select is((private.demandes_match_criteria('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001') -> 'clientele_fit' -> 'clienteles' -> 0 ->> 'key'),
  'couples', 'a couple request: Couples, applied');

select * from finish();
rollback;
