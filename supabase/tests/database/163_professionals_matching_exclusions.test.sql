-- Professionnels for Demandes D4 (migration *_professionals_matching_exclusions.sql): the refused
-- motifs (never a held one, archived ones never added, staff only), the matching priority (a
-- reason or none), both in the directory and the record bundle, and the published matching facts
-- (active reference rows only, another clinic's ids answer nothing), privileges, audit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('set_professional_refused_motifs', 'set_professional_matching_priority')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the RPCs: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'professional_matching_facts'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the published facts are granted to no role');
select table_privs_are('public', 'professional_refused_motifs', 'authenticated', array['SELECT'], 'refused motifs: read only');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@mx.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@mx.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@mx.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@mx.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);

select set_config('test.m1', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active and not is_restricted order by key limit 1), true);
select set_config('test.m2', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active and not is_restricted order by key offset 1 limit 1), true);
select set_config('test.m3', (select id::text from public.motifs where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active and not is_restricted order by key offset 2 limit 1), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.p1', (select public.create_professional('Hélène', 'Essai', 'helene@mx.test'))::text, true);
select public.set_professional_motifs(current_setting('test.p1')::uuid, array[current_setting('test.m1')::uuid]);

-- =============================================================================
-- Refused motifs
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid,
                     array[current_setting('test.m2')::uuid, current_setting('test.m2')::uuid]) $$,
  $$ values (current_setting('test.m2')::uuid) $$, 'the counselor (professionals.matching) sets them; duplicates once');
select throws_ok($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid, array[current_setting('test.m1')::uuid]) $$,
  'P0001', null, 'a motif she holds is never refused');
select throws_ok($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid, array[gen_random_uuid()]) $$,
  '22023', null, 'an unknown motif refused');
select throws_ok($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid, null) $$,
  '22023', null, 'null refused ([] clears)');
reset role;
update public.motifs set is_active = false where id = current_setting('test.m3')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid,
                    array[current_setting('test.m2')::uuid, current_setting('test.m3')::uuid]) $$,
  'P0001', null, 'an archived motif is never added');
select results_eq($$ select refused_motif_ids from public.professionals_directory where id = current_setting('test.p1')::uuid $$,
  $$ values (array[current_setting('test.m2')::uuid]) $$, 'the directory lists them');
select is((public.get_professional_record(current_setting('test.p1')::uuid) -> 'refused_motif_ids') ->> 0, current_setting('test.m2'),
  'the record bundle too');

-- =============================================================================
-- The priority
-- =============================================================================
select is(public.set_professional_matching_priority(current_setting('test.p1')::uuid, '  Nouvelle : à remplir  ') ->> 'reason',
  'Nouvelle : à remplir', '« À prioriser » with its reason, trimmed');
select is((select matching_priority_reason from public.professionals_directory where id = current_setting('test.p1')::uuid),
  'Nouvelle : à remplir', 'the directory shows it');
select throws_ok($$ select public.set_professional_matching_priority(current_setting('test.p1')::uuid, repeat('x', 201)) $$,
  'P0001', null, 'a reason of 200 characters at most');

-- =============================================================================
-- Staff only
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty($$ select 1 from public.professional_refused_motifs union all select 1 from public.professional_matching_priorities $$,
  'a provider reads neither');
select throws_ok($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid, '{}') $$,
  '42501', null, 'a provider sets nothing');
select throws_ok($$ select public.set_professional_matching_priority(current_setting('test.p1')::uuid, 'x') $$,
  '42501', null, '… nor the priority');

-- =============================================================================
-- The published facts
-- =============================================================================
reset role;
select results_eq($$ select f.motif_ids, f.refused_motif_ids, f.matching_priority_reason, f.ready, f.language_codes
                       from private.professional_matching_facts('b0000000-0000-0000-0000-00000000000a', array[current_setting('test.p1')::uuid]) f $$,
  $$ values (array[current_setting('test.m1')::uuid], array[current_setting('test.m2')::uuid], 'Nouvelle : à remplir', false, array['fr']) $$,
  'the facts: motifs, refused motifs, the priority, readiness, languages');
update public.motifs set is_active = false where id = current_setting('test.m2')::uuid;
select is((select f.refused_motif_ids from private.professional_matching_facts('b0000000-0000-0000-0000-00000000000a') f
            where f.professional_id = current_setting('test.p1')::uuid), '{}'::uuid[], 'an archived motif drops out of the facts (rule 7)');
select is_empty($$ select 1 from private.professional_matching_facts('b0000000-0000-0000-0000-00000000000b', array[current_setting('test.p1')::uuid]) $$,
  'another clinic''s ids answer nothing');

-- An empty reason removes the priority; both are audited.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.set_professional_matching_priority(current_setting('test.p1')::uuid, '   '), null, 'an empty reason removes it');
select results_eq($$ select public.set_professional_refused_motifs(current_setting('test.p1')::uuid, '{}') $$,
  $$ select null::uuid where false $$, '[] clears the refused motifs (an archived one included)');
reset role;
select results_eq($$ select table_name, action from public.audit_log
                      where table_name in ('professional_refused_motifs', 'professional_matching_priorities')
                      group by 1, 2 order by 1, 2 $$,
  $$ values ('professional_matching_priorities', 'delete'), ('professional_matching_priorities', 'insert'),
            ('professional_refused_motifs', 'delete'), ('professional_refused_motifs', 'insert') $$, 'audited');

select * from finish();
rollback;
