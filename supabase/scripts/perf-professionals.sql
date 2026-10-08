-- Performance probe for the Professionnels read models (plan Phase 4 Task 4a.4, step 4).
-- LOCAL ONLY, needs the local seed (seed org and conseillère). Everything runs in one transaction
-- that is rolled back: 200 professionals with 2 professions, 3 languages, 4 clientèles,
-- 3 approaches and 25 motifs each (≈ 8 000 audit rows), then EXPLAIN (ANALYZE, BUFFERS) of the
-- read models as the seed conseillère. Function bodies are shown as prepared generic plans
-- (auto_explain cannot be loaded by postgres in the Supabase image).
--
-- Run (inside the DB token):
--   scripts/with-db-lock.sh sh -c 'docker exec -i supabase_db_clinique-mana psql -U postgres -d postgres -X -q \
--     < supabase/scripts/perf-professionals.sql'
-- Expected: each statement under 50 ms; no SubPlan looping once per professional; the history
-- reads audit_log_org_record_prefix_idx; list_professionals reads the name index with the
-- cursor as an index condition.
\set ON_ERROR_STOP on
\set org '00000000-0000-0000-0000-000000000001'
\set conseillere '22222222-2222-2222-2222-222222222222'

begin;
select set_config('app.audit_source', 'perf', true);

create temp table perf_ids on commit drop as
select gen_random_uuid() as id, g as n from generate_series(1, 200) g;

insert into public.professionals (id, org_id, first_name, last_name, email, status, years_experience)
select i.id, :'org', 'Prénom' || i.n, 'Nom' || lpad(i.n::text, 3, '0'), 'perf' || i.n || '@exemple.ca',
       case when i.n % 3 = 0 then 'active' else 'draft' end, i.n % 40
  from perf_ids i;
insert into public.professional_public_profiles (org_id, professional_id)
select :'org', i.id from perf_ids i;
insert into public.professional_matching_profiles (org_id, professional_id, accepting_new_clients)
select :'org', i.id, i.n % 5 <> 0 from perf_ids i;
-- Psychologue (primary) and psychothérapeute, both regulated: a licence each.
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select :'org', i.id, t.id, 'L' || i.n || '-' || t.sort_order, t.key = 'psychologue'
  from perf_ids i
  join public.profession_titles t on t.org_id = :'org' and t.key in ('psychologue', 'psychotherapeute');
insert into public.professional_languages (org_id, professional_id, language_id)
select :'org', i.id, l.id
  from perf_ids i
  join public.languages l on l.org_id = :'org' and l.code in ('fr', 'en', 'es');
-- Rotating windows over the seeded lists: 4 of 7 clientèles, 3 of 10 approaches, 25 of 72 motifs.
insert into public.professional_clienteles (org_id, professional_id, clientele_id, is_specialized)
select :'org', i.id, c.id, c.rn = i.n % 7
  from perf_ids i
  join (select x.id, row_number() over (order by x.sort_order) - 1 as rn from public.clienteles x where x.org_id = :'org') c
    on (c.rn - i.n % 7 + 7) % 7 < 4;
insert into public.professional_specialties (org_id, professional_id, specialty_id, is_specialized)
select :'org', i.id, s.id, s.rn = i.n % 10
  from perf_ids i
  join (select x.id, row_number() over (order by x.sort_order) - 1 as rn from public.specialties x where x.org_id = :'org') s
    on (s.rn - i.n % 10 + 10) % 10 < 3;
insert into public.professional_motifs (org_id, professional_id, motif_id)
select :'org', i.id, m.id
  from perf_ids i
  join (select x.id, row_number() over (order by x.sort_order) - 1 as rn from public.motifs x where x.org_id = :'org') m
    on (m.rn - i.n % 72 + 72) % 72 < 25;
-- Constraint triggers (one primary title) run now, not at the rollback.
set constraints all immediate;
analyze public.professionals, public.professional_professions, public.professional_languages, public.professional_clienteles,
        public.professional_specialties, public.professional_motifs, public.professional_matching_profiles, public.audit_log;

select (select count(*) from perf_ids) as professionals,
       (select count(*) from public.professional_motifs x join perf_ids i on i.id = x.professional_id) as motif_rows,
       (select count(*) from public.audit_log a where a.org_id = :'org') as org_audit_rows;
select i.id as pid from perf_ids i where i.n = 100 \gset
select m.id as motif from public.motifs m where m.org_id = :'org' and m.key = 'anxiete' \gset

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"' || :'conseillere' || '","role":"authenticated"}', true);

\echo '=== 1. select * from professionals_list'
explain (analyze, buffers, costs off) select * from public.professionals_list;
\echo '=== 2. select * from professionals_directory'
explain (analyze, buffers, costs off) select * from public.professionals_directory;
\echo '=== 3. readiness of one professional (the view, as get_professional_readiness reads it)'
explain (analyze, buffers, costs off) select * from public.professionals_readiness r where r.professional_id = :'pid';

-- Functions: the call as a whole, then each one's main statement as a prepared generic plan
-- (plan_cache_mode = force_generic_plan): plpgsql variables are plan parameters, so this is the
-- plan a cached function statement gets, and the cursor must be an index condition in it.
\echo '=== 4. select get_professional_record(<one id>)'
explain (analyze, buffers, costs off) select public.get_professional_record(:'pid');
select pg_catalog.length(public.get_professional_record(:'pid')::text) as record_bytes;

\echo '=== 5. select * from list_professional_history(<id>) (first page, 50)'
explain (analyze, buffers, costs off) select * from public.list_professional_history(:'pid');
reset role;
set local plan_cache_mode = force_generic_plan;
-- Same statement as the function (audit_log needs audit.view, the function is a definer).
prepare history(uuid, text, bigint, int) as
  select a.id, a.created_at, a.table_name, a.record_id, a.action, a.changed_fields,
         a.actor_id, pr.display_name, a.actor_role, a.source
    from public.audit_log a
    left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
   where a.org_id = $1
     and left(a.record_id, 36) = $2
     and a.id < $3
     and a.table_name = any (array['professionals', 'professional_public_profiles', 'professional_matching_profiles',
                                   'professional_professions', 'professional_clienteles', 'professional_specialties',
                                   'professional_motifs', 'professional_languages', 'professional_payer_numbers'])
   order by a.id desc
   limit $4;
explain (analyze, buffers, costs off) execute history(:'org', :'pid', 9223372036854775807, 50);
\echo '--- second page (cursor = 20th row id)'
select h.id as cursor from public.audit_log h where h.org_id = :'org' and left(h.record_id, 36) = :'pid'
 order by h.id desc offset 19 limit 1 \gset
explain (analyze, buffers, costs off) execute history(:'org', :'pid', :cursor, 50);

\echo '=== 6. list_professionals: motif filter, 2nd page by name (call, then its statement)'
set local role authenticated;
explain (analyze, buffers, costs off)
  select * from public.list_professionals(p_motif_ids => array[:'motif']::uuid[], p_after_last_name => 'Nom050',
                                          p_after_first_name => 'Prénom50', p_after_id => :'pid', p_limit => 50);
prepare page(uuid, text, text, uuid, uuid[], int) as
  select l.* from public.professionals_list l
   where l.org_id = $1
     and (l.last_name, l.first_name, l.id) > ($2, $3, $4)
     and l.id = any ($5)
   order by l.last_name, l.first_name, l.id
   limit $6;
-- The motif filter's id set, as the function resolves it first.
select array(select x.professional_id from public.professional_motifs x
              where x.org_id = :'org' and x.motif_id = :'motif')::text as motif_holders \gset
explain (analyze, buffers, costs off) execute page(:'org', 'Nom050', 'Prénom50', :'pid', :'motif_holders', 50);

\echo '=== 7. list_professionals: no filter, 2nd page by name (call, then its statement)'
explain (analyze, buffers, costs off)
  select * from public.list_professionals(p_after_last_name => 'Nom050', p_after_first_name => 'Prénom50',
                                          p_after_id => :'pid', p_limit => 50);
prepare page_all(uuid, text, text, uuid, int) as
  select l.* from public.professionals_list l
   where l.org_id = $1
     and (l.last_name, l.first_name, l.id) > ($2, $3, $4)
   order by l.last_name, l.first_name, l.id
   limit $5;
explain (analyze, buffers, costs off) execute page_all(:'org', 'Nom050', 'Prénom50', :'pid', 50);

rollback;
