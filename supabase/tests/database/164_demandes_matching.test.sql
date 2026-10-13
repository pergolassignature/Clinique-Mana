-- Demandes, batch D4 (migration *_demandes_matching.sql): the matching panel — the hard filters
-- and why a professional is left out, the warnings that never filter (a refused motif, R-66; the
-- insurance; an age, a sex or a clientèle to check; 0 place left), the fit and the documented
-- order (fit, places left, name), the person seen (the main participant, never the caller's file
-- in her place), archived criteria not applied, places left (a match uses a place; a cancelled
-- first appointment gives it back), permissions, clinics. One call reads Professionnels' real
-- published facts; then they are a fixture (replaced inside this transaction), as are Rendez-vous'
-- first appointments and cancellations.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'match_professionals_for_demande'
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the panel''s RPC: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_places_left', 'demandes_match_criteria', 'demandes_match')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ma.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@ma.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@ma.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Conseillère B', 'u3@ma.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'counselor');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('clients'), ('professionals'), ('demandes')) m(key);
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'appointments', false);
insert into public.clients (id, org_id, first_name, last_name, email, sex, birthday) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai', 'lea@ma.test', 'female',
   (current_date - interval '30 years 2 months')::date),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Placé', 'marc@ma.test', 'male', null);
insert into public.professionals (id, org_id, first_name, last_name, email, status)
select ('c0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'P' || n, 'p' || n || '@ma.test', 'active'
  from generate_series(1, 5) n;

select set_config('test.m1', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active order by key limit 1), true);
select set_config('test.m2', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active order by key offset 1 limit 1), true);

-- A request for Léa (30, a woman), in French, two motifs, evenings; one older request matched to P3
-- since her places were declared.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d1', public.create_demande(jsonb_build_object('contact_name', 'Léa Essai', 'channel', 'phone',
  'motif_ids', jsonb_build_array(current_setting('test.m1'), current_setting('test.m2')),
  'availability_periods', jsonb_build_array('evening')))::text, true);
select set_config('test.d2', public.create_demande('{"contact_name": "Marc Placé", "channel": "phone"}')::text, true);
reset role;
update public.demandes set client_id = 'd0000000-0000-0000-0000-000000000001' where id = current_setting('test.d1')::uuid;
update public.demandes set client_id = 'd0000000-0000-0000-0000-000000000002', state = 'matched',
       matched_professional_id = 'c0000000-0000-0000-0000-000000000003', matched_at = now() - interval '2 days'
 where id = current_setting('test.d2')::uuid;

-- Professionnels' real facts: five files without a matching profile, not ready, all left out.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
            where not (p ->> 'eligible')::boolean and p -> 'reasons' ? 'not_ready' and p -> 'reasons' ? 'not_accepting'), 5,
  'the real facts: every file without its matching profile is left out (not ready, not accepting)');
reset role;

-- From here, the facts are a fixture: P1 fits best (two motifs, ★ adults, evenings, 3 places); P2
-- one motif, not tracked, « À prioriser »; P3 one motif, a refused one, its insurance expired, one
-- place; P4 English only; P5 inactive, from 40 years old.
create table private.test_facts as
select ('c0000000-0000-0000-0000-00000000000' || n)::uuid as professional_id,
       case when n = 5 then 'inactive' else 'active' end as status,
       true as ready, true as accepting_new_clients,
       array['evening']::text[] as availability_periods,
       case when n = 5 then 40::smallint end as min_client_age,
       false as women_only, 'female'::text as gender,
       'Pro P' || n as display_name, 'Psychologue'::text as primary_title_label,
       '{}'::uuid[] as title_ids,
       case when n = 4 then array['en'] else array['fr'] end as language_codes,
       jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'key', 'adults', 'name', 'Adultes',
                                            'specialized', n = 1, 'min_age', 18, 'max_age', null)) as clienteles,
       case when n = 1 then array[current_setting('test.m1')::uuid, current_setting('test.m2')::uuid]
            else array[current_setting('test.m1')::uuid] end as motif_ids,
       case when n = 3 then array[current_setting('test.m2')::uuid] else '{}'::uuid[] end as refused_motif_ids,
       case when n = 3 then 'expired' else 'valid' end as insurance_status,
       case n when 1 then 3::smallint when 3 then 1::smallint end as new_client_places,
       case when n in (1, 3) then now() - interval '10 days' end as new_client_places_set_at,
       case when n = 1 then 'Préfère les soirs.' end as matching_note,
       case when n = 2 then 'Nouvelle' end as matching_priority_reason,
       now() as updated_at
  from generate_series(1, 5) n;
create or replace function private.professional_matching_facts(p_org uuid, p_ids uuid[] default null)
returns table (
  professional_id uuid, status text, ready boolean, accepting_new_clients boolean, availability_periods text[],
  min_client_age smallint, women_only boolean, gender text, display_name text, primary_title_label text,
  title_ids uuid[], language_codes text[], clienteles jsonb, motif_ids uuid[], refused_motif_ids uuid[],
  insurance_status text, new_client_places smallint, new_client_places_set_at timestamptz, matching_note text,
  matching_priority_reason text, updated_at timestamptz)
language sql stable set search_path = '' as $$
  select f.* from private.test_facts f
   where p_org = 'b0000000-0000-0000-0000-00000000000a' and (p_ids is null or f.professional_id = any (p_ids))
$$;
-- Rendez-vous' first appointments and cancellations, as fixtures too.
create table private.test_firsts (client_id uuid, professional_id uuid);
create table private.test_cancelled (client_id uuid, professional_id uuid, starts_at timestamptz);
create or replace function private.first_appointments(p_org uuid, p_client_ids uuid[])
returns table (client_id uuid, appointment_id uuid, starts_at timestamptz, professional_id uuid, state text, confirmed boolean)
language sql stable set search_path = '' as $$
  select f.client_id, gen_random_uuid(), now() + interval '1 day', f.professional_id, 'booked', false
    from private.test_firsts f where f.client_id = any (coalesce(p_client_ids, '{}'))
$$;
create or replace function private.appointment_absence_facts(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  appointment_id uuid, starts_at timestamptz, professional_id uuid, service_id uuid, client_id uuid, role text,
  kind text, reason_id uuid, reason_name text, cancel_late boolean, cancelled_at timestamptz, kept_on_schedule boolean,
  later_starts_at timestamptz)
language sql stable set search_path = '' as $$
  select gen_random_uuid(), c.starts_at, c.professional_id, null::uuid, c.client_id, 'client', 'cancelled', null::uuid, null::text,
         false, now(), false, null::timestamptz
    from private.test_cancelled c where c.starts_at >= p_from and c.starts_at < p_to
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.match_professionals_for_demande(current_setting('test.d1')::uuid)::text, true);
reset role;

select results_eq($$ select (c ->> 'age')::int, c ->> 'sex', c ->> 'language', jsonb_array_length(c -> 'motifs'), c -> 'ignored'
                       from (select current_setting('test.r')::jsonb -> 'criteria' c) x $$,
  $$ values (30, 'female', 'fr', 2, '[]'::jsonb) $$, 'the criteria: her age and sex from her file, the language, the motifs named');
select results_eq($$ select p ->> 'display_name' from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p $$,
  $$ values ('Pro P1'), ('Pro P2'), ('Pro P3'), ('Pro P4'), ('Pro P5') $$,
  'the order: the fit, then places left (« non suivi » before 0), then the name; the left-out last');
select results_eq($$ select (p ->> 'fit')::int, jsonb_array_length(p -> 'motif_hits'), (p ->> 'specialized')::boolean,
                            p -> 'period_hits' ->> 0, (p ->> 'places_left')::int, p ->> 'matching_note'
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p where p ->> 'display_name' = 'Pro P1' $$,
  $$ values (211, 2, true, 'evening', 3, 'Préfère les soirs.') $$, 'P1: two motifs, ★ adults, evenings, 3 places, « Bon à savoir »');
select results_eq($$ select (p ->> 'eligible')::boolean, p -> 'warnings', p -> 'refused_hits' -> 0 ->> 'id', (p ->> 'places_left')::int
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p where p ->> 'display_name' = 'Pro P3' $$,
  $$ values (true, '["refused_motif", "insurance_expired", "no_places"]'::jsonb, current_setting('test.m2'), 0) $$,
  'P3: eligible, warned — a refused motif (R-66), the insurance expired, 0 place left (Marc''s match took it)');
select is((select p ->> 'priority_reason' from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p
            where p ->> 'display_name' = 'Pro P2'), 'Nouvelle', 'the priority comes along (a badge, not the order)');
select results_eq($$ select p ->> 'display_name', p -> 'reasons'
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p where not (p ->> 'eligible')::boolean $$,
  $$ values ('Pro P4', '["language"]'::jsonb), ('Pro P5', '["inactive", "min_age"]'::jsonb) $$, 'left out, and why');

-- =============================================================================
-- Places left
-- =============================================================================
select results_eq($$ select places_declared::int, places_used, places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a',
                       array['c0000000-0000-0000-0000-000000000003'::uuid]) $$,
  $$ values (1, 1, 0) $$, 'Rendez-vous off: a match since she declared her places takes one');
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';
select is((select places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a', array['c0000000-0000-0000-0000-000000000003'::uuid])),
  0, 'Rendez-vous on, the first appointment not booked yet: the match keeps its place');
insert into private.test_firsts values ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003');
select is((select places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a', array['c0000000-0000-0000-0000-000000000003'::uuid])),
  0, '… booked with her: still taken');
delete from private.test_firsts;
insert into private.test_cancelled values ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', now() + interval '1 day');
select results_eq($$ select places_used, places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a',
                       array['c0000000-0000-0000-0000-000000000003'::uuid]) $$,
  $$ values (0, 1) $$, '… her first appointment cancelled, none other with her: the place comes back');
insert into private.test_firsts values ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003');
select is((select places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a', array['c0000000-0000-0000-0000-000000000003'::uuid])),
  0, '… cancelled then booked again with her: taken again');
delete from private.test_firsts;
delete from private.test_cancelled;
select results_eq($$ select places_declared, places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a',
                       array['c0000000-0000-0000-0000-000000000002'::uuid]) $$,
  $$ values (null::smallint, null::int) $$, 'not tracked: no count');
update private.test_facts set new_client_places_set_at = now() - interval '1 day' where professional_id = 'c0000000-0000-0000-0000-000000000003';
select is((select places_left from private.demandes_places_left('b0000000-0000-0000-0000-00000000000a', array['c0000000-0000-0000-0000-000000000003'::uuid])),
  1, 'a match before the places were (re)declared counts no more');

-- Not accepting new clients: left out, unless the client's first appointment is already with her.
update private.test_facts set accepting_new_clients = false where professional_id = 'c0000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select p -> 'reasons' from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
            where p ->> 'display_name' = 'Pro P2'), '["not_accepting"]'::jsonb, 'not accepting new clients: left out');
reset role;
insert into private.test_firsts values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select (p ->> 'eligible')::boolean from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
            where p ->> 'display_name' = 'Pro P2'), true, '… unless Léa''s first appointment is already with her');
reset role;
delete from private.test_firsts;
update private.test_facts set accepting_new_clients = true where professional_id = 'c0000000-0000-0000-0000-000000000002';
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'appointments';

-- =============================================================================
-- The clientèle and the person seen
-- =============================================================================
-- Overlapping age clientèles: any one that contains the age (rule 4); one that does not leaves her out.
update private.test_facts set clienteles = jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'key', 'teens', 'name', '12 à 17', 'specialized', true, 'min_age', 12, 'max_age', 17),
    jsonb_build_object('id', gen_random_uuid(), 'key', 'teens2', 'name', '13 à 17', 'specialized', false, 'min_age', 13, 'max_age', 17))
 where professional_id = 'c0000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select p -> 'reasons' from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
            where p ->> 'display_name' = 'Pro P2'), '["clientele"]'::jsonb, 'Léa (30) and teenagers only: left out');
reset role;
-- The request is for her son of 13 (the main participant, known by his birthday): his age, not Léa's.
insert into public.demande_participants (demande_id, org_id, display_name, relationship, birthday, is_primary)
values (current_setting('test.d1')::uuid, 'b0000000-0000-0000-0000-00000000000a', 'Léo', 'child', (current_date - interval '13 years 1 month')::date, true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.match_professionals_for_demande(current_setting('test.d1')::uuid)::text, true);
reset role;
select results_eq($$ select (c ->> 'age')::int, c ->> 'sex' from (select current_setting('test.r')::jsonb -> 'criteria' c) x $$,
  $$ values (13, null::text) $$, 'the main participant is the person seen (13, sex unknown), never the caller''s file in his place');
select results_eq($$ select (p ->> 'eligible')::boolean, (p ->> 'specialized')::boolean
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p where p ->> 'display_name' = 'Pro P2' $$,
  $$ values (true, true) $$, 'two clientèles contain 13: eligible, ★ from the one that fits');
select is((select count(*)::int from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p
            where p -> 'reasons' ? 'clientele'), 4, '… the adults-only ones are left out (P1, P3, P4, P5)');
delete from public.demande_participants where demande_id = current_setting('test.d1')::uuid;

-- No age at all: the clientèle is « à vérifier », no ★ is scored; P5's limit too.
update public.clients set birthday = null where id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.match_professionals_for_demande(current_setting('test.d1')::uuid)::text, true);
reset role;
select results_eq($$ select p -> 'reasons', p -> 'warnings'
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p where p ->> 'display_name' = 'Pro P5' $$,
  $$ values ('["inactive"]'::jsonb, '["age_unknown", "clientele_unknown"]'::jsonb) $$, 'no age known: her limit and the clientèle are « à vérifier »');
select results_eq($$ select (p ->> 'specialized')::boolean, (p ->> 'fit')::int
                       from jsonb_array_elements(current_setting('test.r')::jsonb -> 'professionals') p where p ->> 'display_name' = 'Pro P1' $$,
  $$ values (false, 201) $$, '… and no ★ without a clientèle checked');

-- A couple needs « Couples »; a man asked for leaves the women out.
update public.demandes set beneficiary = 'couple' where id = current_setting('test.d1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
            where p -> 'reasons' ? 'clientele'), 5, 'a couple: nobody without « Couples »');
reset role;
update public.demandes set beneficiary = null, preferred_pro_gender = 'male' where id = current_setting('test.d1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
            where (p ->> 'eligible')::boolean), 0, 'a man asked for: the women are left out (« gender »)');
reset role;
update public.demandes set preferred_pro_gender = 'any' where id = current_setting('test.d1')::uuid;

-- The title asked; an archived one is not applied (it would leave everyone out).
select set_config('test.title', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active order by key limit 1), true);
update private.test_facts set title_ids = array[current_setting('test.title')::uuid] where professional_id = 'c0000000-0000-0000-0000-000000000001';
update public.demandes set profession_title_id = current_setting('test.title')::uuid where id = current_setting('test.d1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select p ->> 'display_name' from jsonb_array_elements(public.match_professionals_for_demande(current_setting('test.d1')::uuid) -> 'professionals') p
                      where (p ->> 'eligible')::boolean $$,
  $$ values ('Pro P1') $$, 'the profession asked: only who holds it');
reset role;
update public.profession_titles set is_active = false where id = current_setting('test.title')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.r', public.match_professionals_for_demande(current_setting('test.d1')::uuid)::text, true);
reset role;
select results_eq($$ select r -> 'criteria' -> 'ignored', (select count(*)::int from jsonb_array_elements(r -> 'professionals') p where p -> 'reasons' ? 'title')
                       from (select current_setting('test.r')::jsonb r) x $$,
  $$ values ('["profession"]'::jsonb, 0) $$, 'an archived profession: said so, not applied');

-- Permissions, clinics.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.match_professionals_for_demande(current_setting('test.d1')::uuid) $$, '42501', null,
  'a provider never reads the panel');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.match_professionals_for_demande(current_setting('test.d1')::uuid) $$, 'P0001', null,
  'another clinic''s request: unknown');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.match_professionals_for_demande(gen_random_uuid()) $$, 'P0001', null, 'an unknown request');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.match_professionals_for_demande(current_setting('test.d1')::uuid) $$, '42501', null,
  'Demandes disabled: nothing');
reset role;

select * from finish();
rollback;
