-- Professionnels core (migration *_professionals_core.sql, plan Phase 4 Task 4a.3).
-- Covers: privileges (tables, column grants, RPCs, helpers); create_professional (normalised
-- email, 1:1 rows, French, primary profession, duplicates in the clinic only, licence rule,
-- atomicity, permission); column updates under RLS; set_professional_professions (≤ 2, one
-- primary, promotion, row ids kept, licence format and order pattern, archived titles, the
-- deferred primary check, restricted motifs kept consistent); the clientèle, approach, motif and
-- language sets (replace, specialized flags, archived and restricted rules, org of the ids);
-- the HINT of each field refusal (first_name, last_name, email, title, licence, ivac: the forms
-- route by it, never by the French text; for titles and licences DETAIL names the title); IVAC numbers (stored upper-case, unique whatever the case); email changes and the profile → professional email sync (a conflict leaves the
-- professional's email, neutrally); private.current_professional_id(); provider RLS and the
-- module gate; every RPC refused to disabled staff and with the module off; org isolation; usage
-- counts (settings without view); audit rows (record ids prefixed by the professional's id, no
-- audit noise, personal fields redacted).
begin;
create extension if not exists pgtap with schema extensions;
select plan(241);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a conseillère; org B
-- with an admin. Both orgs are created after the migrations, so the reference lists are seeded.
-- P1 (org A, draft, psychologue), P2 (org A, linked to provider A), P3 (org B).
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

-- Reference ids of org A (and a few of org B), read once.
select set_config('test.p1', 'c0000000-0000-0000-0000-000000000001', true);
select set_config('test.p2', 'c0000000-0000-0000-0000-000000000002', true);
select set_config('test.p3', 'c0000000-0000-0000-0000-000000000003', true);
select set_config('test.psy',    (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.sexo',   (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'sexologue'), true);
select set_config('test.naturo', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'naturopathe'), true);
select set_config('test.orient', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'conseiller_orientation'), true);
select set_config('test.psyed',  (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychoeducateur'), true);
select set_config('test.b_psy',  (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000b' and t.key = 'psychologue'), true);
select set_config('test.psy_cat', (select c.id::text from public.profession_categories c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'psychologie'), true);
select set_config('test.adults',   (select c.id::text from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'adults'), true);
select set_config('test.couples',  (select c.id::text from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000a' and c.key = 'couples'), true);
select set_config('test.b_adults', (select c.id::text from public.clienteles c where c.org_id = 'b0000000-0000-0000-0000-00000000000b' and c.key = 'adults'), true);
select set_config('test.cbt',     (select s.id::text from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.key = 'cbt'), true);
select set_config('test.emdr',    (select s.id::text from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.key = 'emdr'), true);
select set_config('test.gestalt', (select s.id::text from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.key = 'gestalt'), true);
select set_config('test.b_cbt',   (select s.id::text from public.specialties s where s.org_id = 'b0000000-0000-0000-0000-00000000000b' and s.key = 'cbt'), true);
select set_config('test.fr',   (select l.id::text from public.languages l where l.org_id = 'b0000000-0000-0000-0000-00000000000a' and l.code = 'fr'), true);
select set_config('test.en',   (select l.id::text from public.languages l where l.org_id = 'b0000000-0000-0000-0000-00000000000a' and l.code = 'en'), true);
select set_config('test.b_fr', (select l.id::text from public.languages l where l.org_id = 'b0000000-0000-0000-0000-00000000000b' and l.code = 'fr'), true);
select set_config('test.anxiete',  (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'anxiete'), true);
select set_config('test.deuil',    (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'deuil'), true);
select set_config('test.psychose', (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000a' and m.key = 'psychose'), true);
select set_config('test.b_anxiete', (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000b' and m.key = 'anxiete'), true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.ca'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.ca');
insert into public.professional_public_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003');
insert into public.professional_matching_profiles (org_id, professional_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.psy')::uuid, 'OPQ-1000', true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.psy')::uuid, 'OPQ-2000', true),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003', current_setting('test.b_psy')::uuid, 'OPQ-3000', true);
insert into public.professional_languages (org_id, professional_id, language_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.fr')::uuid),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.fr')::uuid),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003', current_setting('test.b_fr')::uuid);
insert into public.professional_motifs (org_id, professional_id, motif_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.deuil')::uuid),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.anxiete')::uuid),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000003', current_setting('test.b_anxiete')::uuid);
insert into public.professional_clienteles (org_id, professional_id, clientele_id, is_specialized) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.adults')::uuid, true);
insert into public.professional_specialties (org_id, professional_id, specialty_id) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', current_setting('test.cbt')::uuid);

-- Reference states the rules need: an archived motif already held by P1 (deuil), a restricted
-- motif (psychose), an order with a licence pattern (OCCOQ), an archived title (psychoéducateur),
-- an archived approach (Gestalt).
update public.motifs set is_active = false where id = current_setting('test.deuil')::uuid;
update public.motifs set is_restricted = true where id = current_setting('test.psychose')::uuid;
update public.professional_orders set licence_pattern = '^[0-9]{5}$'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'occoq';
update public.profession_titles set is_active = false where id = current_setting('test.psyed')::uuid;
update public.specialties set is_active = false where id = current_setting('test.gestalt')::uuid;

select set_config('test.p1_psy_row', (select pp.id::text from public.professional_professions pp
  where pp.professional_id = current_setting('test.p1')::uuid and pp.profession_title_id = current_setting('test.psy')::uuid), true);

-- The HINT of the error `p_sql` raises (null when it raises none or succeeds): throws_ok checks the
-- code and the message only.
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

-- `hint|detail` of the error `p_sql` raises: the professions editor routes a refusal to the row of
-- the title its DETAIL names.
create function private.test_error_hint_detail(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || '|' || v_detail;
end;
$$;
grant execute on function private.test_error_hint_detail(text) to authenticated;

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', 'professionals', 'authenticated', array['SELECT'], 'authenticated: select only at table level on professionals');
select table_privs_are('public', 'professionals', 'anon', array[]::text[], 'anon: nothing on professionals');
select column_privs_are('public', 'professionals', 'first_name',       'authenticated', array['SELECT', 'UPDATE'], 'first_name is updatable');
select column_privs_are('public', 'professionals', 'last_name',        'authenticated', array['SELECT', 'UPDATE'], 'last_name is updatable');
select column_privs_are('public', 'professionals', 'personal_phone',   'authenticated', array['SELECT', 'UPDATE'], 'personal_phone is updatable');
select column_privs_are('public', 'professionals', 'address_line1',    'authenticated', array['SELECT', 'UPDATE'], 'address_line1 is updatable');
select column_privs_are('public', 'professionals', 'address_line2',    'authenticated', array['SELECT', 'UPDATE'], 'address_line2 is updatable');
select column_privs_are('public', 'professionals', 'city',             'authenticated', array['SELECT', 'UPDATE'], 'city is updatable');
select column_privs_are('public', 'professionals', 'province',         'authenticated', array['SELECT', 'UPDATE'], 'province is updatable');
select column_privs_are('public', 'professionals', 'postal_code',      'authenticated', array['SELECT', 'UPDATE'], 'postal_code is updatable');
select column_privs_are('public', 'professionals', 'years_experience', 'authenticated', array['SELECT', 'UPDATE'], 'years_experience is updatable');
select column_privs_are('public', 'professionals', 'gender',           'authenticated', array['SELECT', 'UPDATE'], 'gender is updatable');
select column_privs_are('public', 'professionals', 'email',            'authenticated', array['SELECT'], 'email is not updatable (RPC)');
select column_privs_are('public', 'professionals', 'status',           'authenticated', array['SELECT'], 'status is not updatable (RPC)');
select column_privs_are('public', 'professionals', 'profile_id',       'authenticated', array['SELECT'], 'profile_id is not updatable');
select column_privs_are('public', 'professionals', 'deactivation_reason_id',        'authenticated', array['SELECT'], 'deactivation_reason_id is not updatable');
select column_privs_are('public', 'professionals', 'deactivation_note',             'authenticated', array['SELECT'], 'deactivation_note is not updatable');
select column_privs_are('public', 'professionals', 'deactivation_disabled_account', 'authenticated', array['SELECT'], 'deactivation_disabled_account is not updatable');
select column_privs_are('public', 'professionals', 'activation_override_reason',    'authenticated', array['SELECT'], 'activation_override_reason is not updatable');

select table_privs_are('public', 'professional_public_profiles', 'authenticated', array['SELECT'], 'authenticated: select only at table level on public profiles');
select table_privs_are('public', 'professional_public_profiles', 'anon', array[]::text[], 'anon: nothing on public profiles');
select column_privs_are('public', 'professional_public_profiles', 'bio',          'authenticated', array['SELECT', 'UPDATE'], 'bio is updatable');
select column_privs_are('public', 'professional_public_profiles', 'approach',     'authenticated', array['SELECT', 'UPDATE'], 'approach is updatable');
select column_privs_are('public', 'professional_public_profiles', 'public_email', 'authenticated', array['SELECT', 'UPDATE'], 'public_email is updatable');
select column_privs_are('public', 'professional_public_profiles', 'public_phone', 'authenticated', array['SELECT', 'UPDATE'], 'public_phone is updatable');
select column_privs_are('public', 'professional_public_profiles', 'professional_id', 'authenticated', array['SELECT'], 'public profile key is not updatable');

select table_privs_are('public', 'professional_matching_profiles', 'authenticated', array['SELECT'], 'authenticated: select only at table level on matching profiles');
select table_privs_are('public', 'professional_matching_profiles', 'anon', array[]::text[], 'anon: nothing on matching profiles');
select column_privs_are('public', 'professional_matching_profiles', 'accepting_new_clients', 'authenticated', array['SELECT', 'UPDATE'], 'accepting_new_clients is updatable');
select column_privs_are('public', 'professional_matching_profiles', 'availability_periods',  'authenticated', array['SELECT', 'UPDATE'], 'availability_periods is updatable');
select column_privs_are('public', 'professional_matching_profiles', 'availability_note',     'authenticated', array['SELECT', 'UPDATE'], 'availability_note is updatable');
select column_privs_are('public', 'professional_matching_profiles', 'professional_id', 'authenticated', array['SELECT'], 'matching profile key is not updatable');

select table_privs_are('public', 'professional_professions',   'authenticated', array['SELECT'], 'authenticated: select only on professions');
select table_privs_are('public', 'professional_clienteles',    'authenticated', array['SELECT'], 'authenticated: select only on clientèles');
select table_privs_are('public', 'professional_specialties',   'authenticated', array['SELECT'], 'authenticated: select only on approaches');
select table_privs_are('public', 'professional_motifs',        'authenticated', array['SELECT'], 'authenticated: select only on motifs');
select table_privs_are('public', 'professional_languages',     'authenticated', array['SELECT'], 'authenticated: select only on languages');
select table_privs_are('public', 'professional_payer_numbers', 'authenticated', array['SELECT'], 'authenticated: select only on payer numbers');
select table_privs_are('public', 'professional_professions',   'anon', array[]::text[], 'anon: nothing on professions');
select table_privs_are('public', 'professional_clienteles',    'anon', array[]::text[], 'anon: nothing on clientèles');
select table_privs_are('public', 'professional_specialties',   'anon', array[]::text[], 'anon: nothing on approaches');
select table_privs_are('public', 'professional_motifs',        'anon', array[]::text[], 'anon: nothing on motifs');
select table_privs_are('public', 'professional_languages',     'anon', array[]::text[], 'anon: nothing on languages');
select table_privs_are('public', 'professional_payer_numbers', 'anon', array[]::text[], 'anon: nothing on payer numbers');

select function_privs_are('public', 'create_professional', array['text', 'text', 'text', 'uuid', 'text'], 'anon', array[]::text[], 'anon cannot call create_professional');
select function_privs_are('public', 'create_professional', array['text', 'text', 'text', 'uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call create_professional');
select function_privs_are('public', 'set_professional_email', array['uuid', 'text'], 'anon', array[]::text[], 'anon cannot call set_professional_email');
select function_privs_are('public', 'set_professional_email', array['uuid', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_email');
select function_privs_are('public', 'set_professional_professions', array['uuid', 'jsonb'], 'anon', array[]::text[], 'anon cannot call set_professional_professions');
select function_privs_are('public', 'set_professional_professions', array['uuid', 'jsonb'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_professions');
select function_privs_are('public', 'set_professional_clienteles', array['uuid', 'jsonb'], 'anon', array[]::text[], 'anon cannot call set_professional_clienteles');
select function_privs_are('public', 'set_professional_clienteles', array['uuid', 'jsonb'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_clienteles');
select function_privs_are('public', 'set_professional_specialties', array['uuid', 'jsonb'], 'anon', array[]::text[], 'anon cannot call set_professional_specialties');
select function_privs_are('public', 'set_professional_specialties', array['uuid', 'jsonb'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_specialties');
select function_privs_are('public', 'set_professional_motifs', array['uuid', 'uuid[]'], 'anon', array[]::text[], 'anon cannot call set_professional_motifs');
select function_privs_are('public', 'set_professional_motifs', array['uuid', 'uuid[]'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_motifs');
select function_privs_are('public', 'set_professional_languages', array['uuid', 'uuid[]'], 'anon', array[]::text[], 'anon cannot call set_professional_languages');
select function_privs_are('public', 'set_professional_languages', array['uuid', 'uuid[]'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_languages');
select function_privs_are('public', 'set_professional_payer_number', array['uuid', 'text', 'text'], 'anon', array[]::text[], 'anon cannot call set_professional_payer_number');
select function_privs_are('public', 'set_professional_payer_number', array['uuid', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call set_professional_payer_number');
select function_privs_are('public', 'list_professionals_reference_usage', array[]::text[], 'anon', array[]::text[], 'anon cannot call list_professionals_reference_usage');
select function_privs_are('public', 'list_professionals_reference_usage', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated may call list_professionals_reference_usage');
select is_definer('public', 'list_professionals_reference_usage', array[]::text[], 'list_professionals_reference_usage is security definer (true counts without view)');
select function_privs_are('private', 'current_professional_id', array[]::text[], 'anon', array[]::text[], 'anon cannot call private.current_professional_id');
select function_privs_are('private', 'current_professional_id', array[]::text[], 'authenticated', array['EXECUTE'], 'policies may call private.current_professional_id');
select function_privs_are('private', 'lock_professional', array['uuid'], 'authenticated', array[]::text[], 'clients cannot call private.lock_professional');
select function_privs_are('private', 'lock_professional', array['uuid'], 'service_role', array[]::text[], 'service_role cannot call private.lock_professional');
select function_privs_are('private', 'professional_professions_guard', array[]::text[], 'authenticated', array[]::text[], 'clients cannot call the professions guard');
select function_privs_are('private', 'professionals_email_from_profile', array[]::text[], 'authenticated', array[]::text[], 'clients cannot call the email sync trigger function');

-- Indexes for the list sort and filters and the matching lookups.
select has_index('public', 'professionals', 'professionals_org_name_idx', 'list sort index (org, last name, first name)');
select has_index('public', 'professionals', 'professionals_org_status_idx', 'status filter index');
select has_index('public', 'professionals', 'professionals_org_email_key', 'email unique per clinic');
select has_index('public', 'professional_professions', 'professional_professions_org_title_idx', 'professions by title');
select has_index('public', 'professional_clienteles', 'professional_clienteles_org_clientele_idx', 'matching lookup by clientèle');
select has_index('public', 'professional_specialties', 'professional_specialties_org_specialty_idx', 'matching lookup by approach');
select has_index('public', 'professional_motifs', 'professional_motifs_org_motif_idx', 'matching lookup by motif');
select has_index('public', 'professional_languages', 'professional_languages_org_language_idx', 'matching lookup by language');

-- =============================================================================
-- create_professional (adjointe A)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select set_config('test.marie', public.create_professional('Marie', 'Tremblay', '  Marie.T@Exemple.CA ',
  current_setting('test.psy')::uuid, 'OPQ-1234')::text, true);
select results_eq($$ select p.first_name, p.last_name, p.email, p.status, p.org_id, p.created_by, p.profile_id
                      from public.professionals p where p.id = current_setting('test.marie')::uuid $$,
  $$ values ('Marie'::text, 'Tremblay'::text, 'marie.t@exemple.ca'::text, 'draft'::text,
             'b0000000-0000-0000-0000-00000000000a'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, null::uuid) $$,
  'create_professional: trimmed, lower-cased email, draft, org and creator set, no account');
select results_eq($$ select (select count(*)::int from public.professional_public_profiles x where x.professional_id = current_setting('test.marie')::uuid),
                            (select m.accepting_new_clients from public.professional_matching_profiles m where m.professional_id = current_setting('test.marie')::uuid) $$,
  $$ values (1, true) $$,
  'create_professional: one public profile and one matching profile accepting new clients');
select results_eq($$ select l.code from public.professional_languages pl join public.languages l on l.id = pl.language_id
                      where pl.professional_id = current_setting('test.marie')::uuid $$,
  array['fr'::text], 'create_professional: French is added');
select results_eq($$ select pp.profession_title_id, pp.licence_number, pp.is_primary from public.professional_professions pp
                      where pp.professional_id = current_setting('test.marie')::uuid $$,
  $$ values (current_setting('test.psy')::uuid, 'OPQ-1234'::text, true) $$,
  'create_professional: the profession is primary with its licence');
select throws_ok($$ select public.create_professional('Marie', 'Autre', 'MARIE.T@exemple.ca') $$,
  'P0001', 'Ce courriel est déjà utilisé.', 'the email of another professional of the clinic is refused');
select throws_ok($$ select public.create_professional('Con', 'Seillère', 'Conseillere@A.test') $$,
  'P0001', 'Ce courriel est déjà utilisé.', 'the email of a profile of the clinic is refused');
select lives_ok($$ select public.create_professional('Bea', 'Ailleurs', 'admin@b.test') $$,
  'an email used only by a profile of another clinic is accepted (P4-34)');
select throws_ok($$ select public.create_professional('Rita', 'Sans', 'rita@exemple.ca', current_setting('test.psy')::uuid, '  ') $$,
  'P0001', 'Le numéro de permis est requis pour ce titre.', 'a regulated title without licence is refused');
select is((select count(*)::int from public.professionals p where p.email = 'rita@exemple.ca'), 0,
  'a refused creation leaves nothing behind');
select set_config('test.naturo_pro', public.create_professional('Nina', 'Nature', 'nina@exemple.ca',
  current_setting('test.naturo')::uuid, null)::text, true);
select results_eq($$ select pp.profession_title_id, pp.licence_number, pp.is_primary from public.professional_professions pp
                      where pp.professional_id = current_setting('test.naturo_pro')::uuid $$,
  $$ values (current_setting('test.naturo')::uuid, null::text, true) $$,
  'a title without order (naturopathe) needs no licence');
select throws_ok($$ select public.create_professional('Pierre', 'Archive', 'pierre@exemple.ca', current_setting('test.psyed')::uuid, 'P-1') $$,
  'P0001', 'Ce titre est archivé.', 'an archived title is refused at creation');
select throws_ok($$ select public.create_professional('Xavier', 'X', 'x') $$,
  'P0001', 'Courriel invalide.', 'an invalid email is refused');
select throws_ok($$ select public.create_professional('   ', 'Vide', 'vide@exemple.ca') $$,
  'P0001', 'Le prénom est obligatoire.', 'a blank first name is refused');
select throws_ok($$ select public.create_professional(E'Ma\u200Brie', 'Invisible', 'zw@exemple.ca') $$,
  'P0001', 'Le prénom contient des caractères invisibles ou non permis.',
  'a first name with an invisible character is refused (its message says « permis »)');

-- Each field refusal names its field in a HINT; the form routes by it, not by the wording.
select is(private.test_error_hint($$ select public.create_professional('   ', 'Vide', 'vide@exemple.ca') $$),
  'first_name', 'HINT first_name: blank first name');
select is(private.test_error_hint($$ select public.create_professional(E'Ma\u200Brie', 'Invisible', 'zw@exemple.ca') $$),
  'first_name', 'HINT first_name: « …caractères invisibles ou non permis » is about the first name, not the licence');
select is(private.test_error_hint($$ select public.create_professional('Léa', repeat('n', 81), 'lea@exemple.ca') $$),
  'last_name', 'HINT last_name: a last name over 80 characters');
select is(private.test_error_hint($$ select public.create_professional('Xavier', 'X', 'x') $$),
  'email', 'HINT email: an invalid email');
select is(private.test_error_hint($$ select public.create_professional('Marie', 'Autre', 'MARIE.T@exemple.ca') $$),
  'email', 'HINT email: the email of another professional');
select is(private.test_error_hint($$ select public.create_professional('Con', 'Seillère', 'Conseillere@A.test') $$),
  'email', 'HINT email: the email of a profile of the clinic');
select is(private.test_error_hint($$ select public.create_professional('Pierre', 'Archive', 'pierre@exemple.ca', current_setting('test.psyed')::uuid, 'P-1') $$),
  'title', 'HINT title: an archived title');
select is(private.test_error_hint($$ select public.create_professional('Ulysse', 'Inconnu', 'ulysse@exemple.ca', gen_random_uuid(), null) $$),
  'title', 'HINT title: an unknown title (22023)');
select is(private.test_error_hint($$ select public.create_professional('Rita', 'Sans', 'rita@exemple.ca', current_setting('test.psy')::uuid, '  ') $$),
  'licence', 'HINT licence: a regulated title without licence');
select is(private.test_error_hint($$ select public.create_professional('Rita', 'Sans', 'rita@exemple.ca', current_setting('test.psy')::uuid, 'OPQ#1') $$),
  'licence', 'HINT licence: a licence with other characters');
select is(private.test_error_hint($$ select public.create_professional('Olivier', 'Orientation', 'olivier@exemple.ca', current_setting('test.orient')::uuid, 'abc') $$),
  'licence', 'HINT licence: a licence outside the order''s pattern');
select is(private.test_error_hint($$ select public.create_professional('Rita', 'Sans', 'rita@exemple.ca', null, 'OPQ-1') $$),
  'licence', 'HINT licence: a licence without a title (22023)');
select is(private.test_error_hint($$ select public.set_professional_email(current_setting('test.marie')::uuid, 'pas un courriel') $$),
  'email', 'HINT email: set_professional_email shares the email rules');

-- No active system language (hand-repaired data): refused, nothing created.
reset role;
savepoint no_language;
update public.languages set is_active = false where id = current_setting('test.fr')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.create_professional('Lina', 'Sans', 'lina@exemple.ca') $$,
  'P0001', 'Aucune langue active n''est disponible.', 'no active system language: creation is refused');
select is(private.test_error_hint($$ select public.create_professional('Lina', 'Sans', 'lina@exemple.ca') $$),
  null, 'no HINT when the refusal is about no one field (the form shows it above the buttons)');
rollback to savepoint no_language;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.professionals p where p.email = 'lina@exemple.ca'), 0,
  'the refused creation leaves no record without a language');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.create_professional('Con', 'Seil', 'cs@exemple.ca') $$,
  '42501', null, 'the conseillère cannot create a professional');

-- =============================================================================
-- Column updates under RLS
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ with u as (update public.professionals set city = 'Lévis' where id = current_setting('test.p1')::uuid returning 1)
                    select count(*)::int from u $$,
  array[1], 'the adjointe updates an identity column');
select results_eq($$ with u as (update public.professionals
                                   set personal_phone = '+15145550101', address_line1 = '123 rue Principale',
                                       address_line2 = 'App. 4', postal_code = 'G6V 1A1', gender = 'female'
                                 where id = current_setting('test.p1')::uuid returning 1)
                    select count(*)::int from u $$,
  array[1], 'the adjointe updates the personal fields');
select throws_ok($$ update public.professionals set status = 'active' where id = current_setting('test.p1')::uuid $$,
  '42501', null, 'status has no column grant');
select results_eq($$ with u as (update public.professional_public_profiles set bio = 'Approche chaleureuse.'
                                  where professional_id = current_setting('test.p1')::uuid returning 1)
                    select count(*)::int from u $$,
  array[1], 'the adjointe updates the public profile');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ with u as (update public.professionals set first_name = 'Pirate' where id = current_setting('test.p1')::uuid returning 1)
                    select count(*)::int from u $$,
  array[0], 'the conseillère cannot change identity (RLS: 0 rows)');
select results_eq($$ with u as (update public.professional_matching_profiles set accepting_new_clients = false
                                  where professional_id = current_setting('test.p1')::uuid returning 1)
                    select count(*)::int from u $$,
  array[1], 'the conseillère updates the matching profile');
select throws_ok($$ update public.professional_matching_profiles set availability_periods = array['am', 'am']
                     where professional_id = current_setting('test.p1')::uuid $$,
  '23514', null, 'availability periods are distinct');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ with u as (update public.professional_matching_profiles set accepting_new_clients = false
                                  where professional_id = current_setting('test.p2')::uuid returning 1)
                    select count(*)::int from u $$,
  array[0], 'the provider cannot update their own matching profile directly (4b: questionnaire)');

-- =============================================================================
-- set_professional_professions (adjointe A, P1)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select x.profession_title_id, x.licence_number, x.is_primary
                      from public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                        jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1', 'is_primary', false),
                        jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', ' S-2 ', 'is_primary', true))) x
                     order by x.is_primary desc $$,
  $$ values (current_setting('test.sexo')::uuid, 'S-2'::text, true), (current_setting('test.psy')::uuid, 'OPQ-1'::text, false) $$,
  'two titles, the flagged one primary, licences trimmed');
select is((select pp.id::text from public.professional_professions pp
            where pp.professional_id = current_setting('test.p1')::uuid and pp.profession_title_id = current_setting('test.psy')::uuid),
  current_setting('test.p1_psy_row'), 'the psychologue row keeps its id');
-- At most two titles: re-sending the two held titles is no third one (the guard's count ignores
-- the row's own title; the upsert's BEFORE INSERT fires before the conflict is found).
select results_eq($$ select x.profession_title_id, x.licence_number, x.is_primary
                      from public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                        jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1'),
                        jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', 'S-2', 'is_primary', true))) x
                     order by x.is_primary desc $$,
  $$ values (current_setting('test.sexo')::uuid, 'S-2'::text, true), (current_setting('test.psy')::uuid, 'OPQ-1'::text, false) $$,
  'the same two titles re-sent are accepted');
select results_eq($$ select x.profession_title_id, x.is_primary
                      from public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                        jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1', 'is_primary', true),
                        jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', 'S-2'))) x
                     order by x.is_primary desc $$,
  $$ values (current_setting('test.psy')::uuid, true), (current_setting('test.sexo')::uuid, false) $$,
  'the primary moves between the two held titles');
select results_eq($$ select x.profession_title_id, x.is_primary
                      from public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                        jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1'),
                        jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', 'S-2', 'is_primary', true))) x
                     order by x.is_primary desc $$,
  $$ values (current_setting('test.sexo')::uuid, true), (current_setting('test.psy')::uuid, false) $$,
  'and back');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1'),
                     jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', 'S-2'),
                     jsonb_build_object('title_id', current_setting('test.naturo')))) $$,
  'P0001', 'Un professionnel a au plus deux titres.', 'three titles are refused');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1', 'is_primary', true),
                     jsonb_build_object('title_id', current_setting('test.sexo'), 'licence_number', 'S-2', 'is_primary', true))) $$,
  'P0001', 'Un seul titre principal.', 'two primary titles are refused');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1'),
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-2'))) $$,
  'P0001', 'Un titre ne peut être choisi qu''une fois.', 'the same title twice is refused');

-- The deferred primary check (as postgres): titles without a primary fail at commit.
reset role;
savepoint primary_check;
delete from public.professional_professions pp
 where pp.professional_id = current_setting('test.p1')::uuid and pp.is_primary;
select throws_ok($$ set constraints all immediate $$,
  'P0001', 'Un des titres doit être le titre principal.', 'titles left without a primary fail the deferred check');
rollback to savepoint primary_check;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select x.id, x.profession_title_id, x.licence_number, x.is_primary
                      from public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                        jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1'))) x $$,
  $$ values (current_setting('test.p1_psy_row')::uuid, current_setting('test.psy')::uuid, 'OPQ-1'::text, true) $$,
  'removing the primary promotes the remaining title (same row)');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.orient'), 'licence_number', 'abc'))) $$,
  'P0001', 'Le numéro de permis pour Conseiller.ère en orientation n''a pas le bon format.',
  'the order''s licence pattern applies, and the message names the title');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psyed'), 'licence_number', 'P-1'))) $$,
  'P0001', 'Ce titre est archivé.', 'an archived title cannot be added');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ#1'))) $$,
  'P0001', 'Numéro de permis invalide : lettres, chiffres, espaces et traits d''union (30 caractères au plus).',
  'a licence with other characters is refused with a French message');
-- Each refusal about one title names it (HINT title / licence, DETAIL the title id).
select is(private.test_error_hint_detail($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1'),
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-2'))) $$),
  'title|' || current_setting('test.psy'), 'a repeated title: HINT title, DETAIL its id');
select is(private.test_error_hint_detail($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psyed'), 'licence_number', 'P-1'))) $$),
  'title|' || current_setting('test.psyed'), 'an archived title: HINT title, DETAIL its id');
select is(private.test_error_hint_detail($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.orient'), 'licence_number', 'abc'))) $$),
  'licence|' || current_setting('test.orient'), 'a licence outside the order''s pattern: HINT licence, DETAIL the title id');
select is(private.test_error_hint_detail($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ#1'))) $$),
  'licence|' || current_setting('test.psy'), 'a licence in no valid format: HINT licence, DETAIL the title id');
select is(private.test_error_hint_detail($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.psy')))) $$),
  'licence|' || current_setting('test.psy'), 'a regulated title without licence: HINT licence, DETAIL the title id');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, '{"title_id": null}'::jsonb) $$,
  '22023', null, 'the items must be a JSON array');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, '[{"title_id": "pas-un-uuid"}]'::jsonb) $$,
  '22023', null, 'a malformed title id gives 22023, not 22P02');

-- =============================================================================
-- set_professional_clienteles / _specialties (conseillère A, P1)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select x.clientele_id, x.is_specialized from public.set_professional_clienteles(current_setting('test.p1')::uuid,
                        jsonb_build_array(jsonb_build_object('id', current_setting('test.adults'), 'specialized', true),
                                          jsonb_build_object('id', current_setting('test.couples')))) x
                     order by x.is_specialized desc $$,
  $$ values (current_setting('test.adults')::uuid, true), (current_setting('test.couples')::uuid, false) $$,
  'clientèles set with their specialized flag');
select results_eq($$ select x.clientele_id, x.is_specialized from public.set_professional_clienteles(current_setting('test.p1')::uuid,
                        jsonb_build_array(jsonb_build_object('id', current_setting('test.adults'), 'specialized', false))) x $$,
  $$ values (current_setting('test.adults')::uuid, false) $$,
  'a kept clientèle changes its flag, a removed one goes');
select is((select count(*)::int from public.set_professional_clienteles(current_setting('test.p1')::uuid, '[]'::jsonb)), 0,
  'an empty list clears the clientèles');
select throws_ok($$ select public.set_professional_clienteles(current_setting('test.p1')::uuid,
                     jsonb_build_array(jsonb_build_object('id', current_setting('test.b_adults')))) $$,
  '22023', null, 'a clientèle of another clinic is refused');
select throws_ok($$ select public.set_professional_clienteles(current_setting('test.p1')::uuid, '[{"id": "12345"}]'::jsonb) $$,
  '22023', null, 'a malformed clientèle id gives 22023, not 22P02');
select results_eq($$ select x.specialty_id, x.is_specialized from public.set_professional_specialties(current_setting('test.p1')::uuid,
                        jsonb_build_array(jsonb_build_object('id', current_setting('test.cbt'), 'specialized', true),
                                          jsonb_build_object('id', current_setting('test.emdr')))) x
                     order by x.is_specialized desc $$,
  $$ values (current_setting('test.cbt')::uuid, true), (current_setting('test.emdr')::uuid, false) $$,
  'approaches set with their specialized flag');
select throws_ok($$ select public.set_professional_specialties(current_setting('test.p1')::uuid,
                     jsonb_build_array(jsonb_build_object('id', current_setting('test.gestalt')))) $$,
  'P0001', 'L''approche « Gestalt-thérapie » est archivée.', 'an archived approach cannot be added');
select throws_ok($$ select public.set_professional_specialties(current_setting('test.p1')::uuid,
                     jsonb_build_array(jsonb_build_object('id', current_setting('test.b_cbt')))) $$,
  '22023', null, 'an approach of another clinic is refused');
select is((select count(*)::int from public.set_professional_specialties(current_setting('test.p1')::uuid, '[]'::jsonb)), 0,
  'an empty list clears the approaches');

-- =============================================================================
-- set_professional_motifs (conseillère A)
-- =============================================================================
select results_eq($$ select x from public.set_professional_motifs(current_setting('test.p1')::uuid,
                        array[current_setting('test.anxiete')::uuid, current_setting('test.deuil')::uuid]) x order by x $$,
  $$ select x from unnest(array[current_setting('test.anxiete')::uuid, current_setting('test.deuil')::uuid]) x order by x $$,
  'motifs set; an archived motif already held stays when re-sent');
select results_eq($$ select x from public.set_professional_motifs(current_setting('test.p1')::uuid,
                        array[current_setting('test.anxiete')::uuid]) x $$,
  array[current_setting('test.anxiete')::uuid], 'the set is replaced');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p1')::uuid,
                     array[current_setting('test.anxiete')::uuid, current_setting('test.deuil')::uuid]) $$,
  'P0001', 'Le motif « Deuil » est archivé.', 'an archived motif cannot be added back');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.naturo_pro')::uuid,
                     array[current_setting('test.psychose')::uuid]) $$,
  'P0001', 'Le motif « Psychose » est réservé aux professions réglementées.',
  'a restricted motif needs a regulated profession (naturopathe only)');
select results_eq($$ select x from public.set_professional_motifs(current_setting('test.p1')::uuid,
                        array[current_setting('test.anxiete')::uuid, current_setting('test.psychose')::uuid, null]) x order by x $$,
  $$ select x from unnest(array[current_setting('test.anxiete')::uuid, current_setting('test.psychose')::uuid]) x order by x $$,
  'a psychologue may hold a restricted motif (null ids ignored)');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p1')::uuid,
                     array[current_setting('test.b_anxiete')::uuid]) $$,
  '22023', null, 'a motif of another clinic is refused');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p1')::uuid, null) $$,
  '22023', null, 'a null set is refused (send an empty array to clear)');

-- Restricted motifs stay consistent: the last regulated title cannot go while they are held.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, jsonb_build_array(
                     jsonb_build_object('title_id', current_setting('test.naturo')))) $$,
  'P0001', 'Retirez d''abord les motifs réservés aux professions réglementées : Psychose.',
  'removing the only regulated title is refused while a restricted motif is held');

-- =============================================================================
-- set_professional_languages (conseillère A)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_languages(current_setting('test.p1')::uuid, array[]::uuid[]) $$,
  'P0001', 'Au moins une langue est requise.', 'at least one language');
select results_eq($$ select x from public.set_professional_languages(current_setting('test.p1')::uuid,
                        array[current_setting('test.fr')::uuid, current_setting('test.en')::uuid]) x order by x $$,
  $$ select x from unnest(array[current_setting('test.fr')::uuid, current_setting('test.en')::uuid]) x order by x $$,
  'two languages');

-- The provider holds no matching permission.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p2')::uuid, array[]::uuid[]) $$,
  '42501', null, 'the provider cannot change matching sets');

-- =============================================================================
-- set_professional_payer_number (adjointe A)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', ' 123456 ') $$,
  'the adjointe stores an IVAC number');
select results_eq($$ select n.payer_type, n.number from public.professional_payer_numbers n where n.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('ivac'::text, '123456'::text) $$, 'the IVAC number is stored trimmed');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p2')::uuid, 'ivac', '123456') $$,
  'P0001', 'Ce numéro IVAC est déjà attribué à un autre professionnel.', 'an IVAC number is unique in the clinic');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', '1') $$,
  'P0001', 'Numéro IVAC invalide : 3 à 30 lettres, chiffres ou traits d''union.', 'an IVAC number has a format');
select is(private.test_error_hint($$ select public.set_professional_payer_number(current_setting('test.p2')::uuid, 'ivac', '123456') $$),
  'ivac', 'a duplicate IVAC number: HINT ivac (the field)');
select is(private.test_error_hint($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', '1') $$),
  'ivac', 'an invalid IVAC number: HINT ivac');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'csst', '123456') $$,
  '22023', null, 'an unknown payer type is refused');
select lives_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', ' Probe-777 ') $$,
  'the adjointe changes the IVAC number');
select results_eq($$ select n.number from public.professional_payer_numbers n where n.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('PROBE-777'::text) $$, 'the IVAC number is stored upper-case');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p2')::uuid, 'ivac', 'probe-777') $$,
  'P0001', 'Ce numéro IVAC est déjà attribué à un autre professionnel.', 'probe-777 is a duplicate of PROBE-777 (unique whatever the case)');
select is(private.test_error_hint($$ select public.set_professional_payer_number(current_setting('test.p2')::uuid, 'ivac', 'probe-777') $$),
  'ivac', 'a duplicate in another case: HINT ivac');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_payer_number(current_setting('test.p3')::uuid, 'ivac', '123456') $$,
  'the same IVAC number is accepted in another clinic');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', '') $$,
  'a blank number deletes it');
select is((select count(*)::int from public.professional_payer_numbers n where n.professional_id = current_setting('test.p1')::uuid), 0,
  'the IVAC number is gone');

-- =============================================================================
-- set_professional_email (adjointe A)
-- =============================================================================
select lives_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, ' New.Email@Exemple.ca ') $$,
  'the email of a professional without account changes');
select is((select p.email from public.professionals p where p.id = current_setting('test.p1')::uuid), 'new.email@exemple.ca',
  'the new email is normalised');
select throws_ok($$ select public.set_professional_email(current_setting('test.p2')::uuid, 'autre@exemple.ca') $$,
  'P0001', 'Ce professionnel a un compte : le courriel se change dans « Mon compte ».', 'not once the account exists');
select throws_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, 'conseillere@a.test') $$,
  'P0001', 'Ce courriel est déjà utilisé.', 'the duplicate rule applies');
select throws_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, 'pas un courriel') $$,
  'P0001', 'Courriel invalide.', 'the format rule applies');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, 'c@exemple.ca') $$,
  '42501', null, 'the conseillère cannot change an email');

-- =============================================================================
-- Email sync (as postgres): auth → profiles → professionals
-- =============================================================================
reset role;
update auth.users set email = 'Provider.New@A.test' where id = 'a0000000-0000-0000-0000-000000000003';
select is((select p.email from public.professionals p where p.id = current_setting('test.p2')::uuid), 'provider.new@a.test',
  'the linked professional''s email follows the account (lower-cased)');
-- Conflict: the new login address is P1's (unlinked, same clinic). The login change succeeds and
-- reveals nothing (#38); P2 keeps its email.
select lives_ok($$ update auth.users set email = 'New.Email@Exemple.ca' where id = 'a0000000-0000-0000-0000-000000000003' $$,
  'a login email used by an unlinked professional of the clinic still changes');
select is((select pr.email from public.profiles pr where pr.user_id = 'a0000000-0000-0000-0000-000000000003'), 'New.Email@Exemple.ca',
  'the profile follows the account');
select results_eq($$ select p.id, p.email from public.professionals p
                     where p.id in (current_setting('test.p1')::uuid, current_setting('test.p2')::uuid) order by p.id $$,
  $$ values (current_setting('test.p1')::uuid, 'new.email@exemple.ca'::text), (current_setting('test.p2')::uuid, 'provider.new@a.test'::text) $$,
  'on conflict the linked professional keeps its email, the other one is untouched');
-- Without conflict it syncs again.
update auth.users set email = 'provider.again@a.test' where id = 'a0000000-0000-0000-0000-000000000003';
select is((select p.email from public.professionals p where p.id = current_setting('test.p2')::uuid), 'provider.again@a.test',
  'without conflict the email syncs again');
-- An address GoTrue accepts but professionals_email_check refuses (no dot in the domain): the
-- login change still succeeds and the professional keeps its email.
select lives_ok($$ update auth.users set email = 'provider@intranet' where id = 'a0000000-0000-0000-0000-000000000003' $$,
  'a login email the professional''s check refuses still changes');
select results_eq($$ select pr.email, p.email from public.profiles pr join public.professionals p on p.profile_id = pr.user_id
                     where pr.user_id = 'a0000000-0000-0000-0000-000000000003' $$,
  $$ values ('provider@intranet'::text, 'provider.again@a.test'::text) $$,
  'on a check violation the profile follows the account and the professional keeps its email');
update auth.users set email = 'provider.again@a.test' where id = 'a0000000-0000-0000-0000-000000000003';

-- =============================================================================
-- private.current_professional_id()
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(private.current_professional_id(), current_setting('test.p2')::uuid, 'provider A → P2');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.current_professional_id(), null::uuid, 'admin A has no professional row');
reset role;
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(private.current_professional_id(), null::uuid, 'a disabled provider has no professional row');
reset role;
update public.profiles set status = 'active' where user_id = 'a0000000-0000-0000-0000-000000000003';

-- =============================================================================
-- Provider RLS: own record only, behind the module gate
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq('select p.id from public.professionals p', array[current_setting('test.p2')::uuid], 'the provider sees only P2');
select results_eq('select distinct x.professional_id from public.professional_public_profiles x', array[current_setting('test.p2')::uuid], 'own public profile only');
select results_eq('select distinct x.professional_id from public.professional_matching_profiles x', array[current_setting('test.p2')::uuid], 'own matching profile only');
select results_eq('select distinct x.professional_id from public.professional_professions x', array[current_setting('test.p2')::uuid], 'own professions only');
select results_eq('select distinct x.professional_id from public.professional_motifs x', array[current_setting('test.p2')::uuid], 'own motifs only');
select results_eq('select distinct x.professional_id from public.professional_clienteles x', array[current_setting('test.p2')::uuid], 'own clientèles only');
select results_eq('select distinct x.professional_id from public.professional_specialties x', array[current_setting('test.p2')::uuid], 'own approaches only');
select results_eq('select distinct x.professional_id from public.professional_languages x', array[current_setting('test.p2')::uuid], 'own languages only');

reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select is((select count(*)::int from public.professionals), 0, 'module off: the provider sees nothing');
select is((select count(*)::int from public.professional_motifs), 0, 'module off: no junction row for the provider');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.professionals), 0, 'module off: the conseillère sees nothing');
select throws_ok($$ select public.set_professional_clienteles(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  '42501', null, 'module off: set_professional_clienteles is refused');
select throws_ok($$ select public.set_professional_specialties(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  '42501', null, 'module off: set_professional_specialties is refused');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p1')::uuid, array[]::uuid[]) $$,
  '42501', null, 'module off: set_professional_motifs is refused');
select throws_ok($$ select public.set_professional_languages(current_setting('test.p1')::uuid, array[current_setting('test.fr')::uuid]) $$,
  '42501', null, 'module off: set_professional_languages is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.create_professional('Off', 'Module', 'off@exemple.ca') $$,
  '42501', null, 'module off: create_professional is refused (admin)');
select throws_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, 'off@exemple.ca') $$,
  '42501', null, 'module off: set_professional_email is refused');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  '42501', null, 'module off: set_professional_professions is refused');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', '999999') $$,
  '42501', null, 'module off: set_professional_payer_number is refused');
select throws_ok($$ select * from public.list_professionals_reference_usage() $$,
  '42501', null, 'module off: list_professionals_reference_usage is refused');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- Disabled staff: every RPC refuses them (rolled back)
-- =============================================================================
savepoint disabled_staff;
update public.profiles set status = 'disabled'
 where user_id in ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.create_professional('Dis', 'Abled', 'disabled@exemple.ca') $$,
  '42501', null, 'disabled adjointe: create_professional is refused');
select throws_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, 'disabled@exemple.ca') $$,
  '42501', null, 'disabled adjointe: set_professional_email is refused');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  '42501', null, 'disabled adjointe: set_professional_professions is refused');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', '999999') $$,
  '42501', null, 'disabled adjointe: set_professional_payer_number is refused');
select throws_ok($$ select * from public.list_professionals_reference_usage() $$,
  '42501', null, 'disabled adjointe: list_professionals_reference_usage is refused');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_clienteles(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  '42501', null, 'disabled conseillère: set_professional_clienteles is refused');
select throws_ok($$ select public.set_professional_specialties(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  '42501', null, 'disabled conseillère: set_professional_specialties is refused');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p1')::uuid, array[]::uuid[]) $$,
  '42501', null, 'disabled conseillère: set_professional_motifs is refused');
select throws_ok($$ select public.set_professional_languages(current_setting('test.p1')::uuid, array[current_setting('test.fr')::uuid]) $$,
  '42501', null, 'disabled conseillère: set_professional_languages is refused');
rollback to savepoint disabled_staff;

-- =============================================================================
-- Isolation (admin B)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq('select p.id from public.professionals p', array[current_setting('test.p3')::uuid], 'admin B sees only P3');
select is((select count(*)::int from public.professional_motifs x where x.professional_id = current_setting('test.p1')::uuid), 0,
  'admin B sees no junction row of org A');
select throws_ok($$ select public.set_professional_email(current_setting('test.p1')::uuid, 'b@exemple.ca') $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_email: another clinic''s professional is not found');
select throws_ok($$ select public.set_professional_professions(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_professions: not found');
select throws_ok($$ select public.set_professional_clienteles(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_clienteles: not found');
select throws_ok($$ select public.set_professional_specialties(current_setting('test.p1')::uuid, '[]'::jsonb) $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_specialties: not found');
select throws_ok($$ select public.set_professional_motifs(current_setting('test.p1')::uuid, array[]::uuid[]) $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_motifs: not found');
select throws_ok($$ select public.set_professional_languages(current_setting('test.p1')::uuid, array[current_setting('test.b_fr')::uuid]) $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_languages: not found');
select throws_ok($$ select public.set_professional_payer_number(current_setting('test.p1')::uuid, 'ivac', '999999') $$,
  'P0001', 'Professionnel introuvable.', 'set_professional_payer_number: not found');

-- =============================================================================
-- Usage counts (adjointe A)
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select u.kind, u.id, u.usage from public.list_professionals_reference_usage() u
                     where u.id = current_setting('test.psychose')::uuid $$,
  $$ values ('motifs'::text, current_setting('test.psychose')::uuid, 1) $$, 'a motif held once counts 1');
select results_eq($$ select u.usage from public.list_professionals_reference_usage() u
                     where u.kind = 'motifs' and u.id = current_setting('test.anxiete')::uuid $$,
  array[2], 'a motif held by two professionals counts 2');
select results_eq($$ select u.usage from public.list_professionals_reference_usage() u
                     where u.kind = 'profession_categories' and u.id = current_setting('test.psy_cat')::uuid $$,
  array[1], 'a category counts its active titles');
select is((select count(*)::int from public.list_professionals_reference_usage() u where u.id = current_setting('test.b_anxiete')::uuid), 0,
  'nothing of another clinic is counted');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_professionals_reference_usage() $$,
  '42501', null, 'usage counts need professionals.settings or professionals.manage');

-- The conseillère given professionals.settings and denied professionals.view (overrides, rolled
-- back; she never holds manage): the counts are the clinic's, not hidden by RLS.
reset role;
savepoint settings_only;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals.settings', true),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals.view',     false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_motifs), 0, 'settings only: the junction rows are not readable');
select results_eq($$ select u.kind, u.usage from public.list_professionals_reference_usage() u
                     where u.id in (current_setting('test.anxiete')::uuid, current_setting('test.psychose')::uuid)
                     order by u.usage desc $$,
  $$ values ('motifs'::text, 2), ('motifs'::text, 1) $$,
  'settings only: the counts are still the clinic''s');
select is((select count(*)::int from public.list_professionals_reference_usage() u where u.id = current_setting('test.b_anxiete')::uuid), 0,
  'settings only: nothing of another clinic is counted');
rollback to savepoint settings_only;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

-- =============================================================================
-- Audit (as postgres)
-- =============================================================================
-- Re-sending the same set writes nothing.
reset role;
select set_config('test.audit_count', (select count(*)::text from public.audit_log a
                                         where left(a.record_id, 36) = current_setting('test.p1')), true);
set local role authenticated;
select public.set_professional_motifs(current_setting('test.p1')::uuid,
  array[current_setting('test.psychose')::uuid, current_setting('test.anxiete')::uuid]);
select public.set_professional_languages(current_setting('test.p1')::uuid,
  array[current_setting('test.en')::uuid, current_setting('test.fr')::uuid]);
reset role;
select is((select count(*)::text from public.audit_log a where left(a.record_id, 36) = current_setting('test.p1')),
  current_setting('test.audit_count'), 'unchanged sets write no audit row');

select results_eq($$ select distinct a.table_name from public.audit_log a
                     where left(a.record_id, 36) = current_setting('test.p1') order by 1 $$,
  array['professional_clienteles', 'professional_languages', 'professional_matching_profiles', 'professional_motifs',
        'professional_payer_numbers', 'professional_professions', 'professional_public_profiles', 'professional_specialties',
        'professionals']::text[],
  'every write on P1 and its child rows is audited under a record id starting with P1');
select ok(exists (select 1 from public.audit_log a
                   where a.table_name = 'professional_professions' and a.action = 'update'
                     and a.record_id = current_setting('test.p1') || ':' || current_setting('test.p1_psy_row')),
  'a profession row is audited as <professional>:<row id>');
select results_eq($$ select a.action, a.actor_id from public.audit_log a
                     where a.table_name = 'professional_motifs'
                       and a.record_id = current_setting('test.p1') || ':' || current_setting('test.deuil')
                     order by a.id $$,
  $$ values ('insert'::text, null::uuid), ('delete'::text, 'a0000000-0000-0000-0000-000000000004'::uuid) $$,
  'a removed motif leaves its delete row, with the conseillère as actor');
select results_eq($$ select a.action, a.actor_id from public.audit_log a
                     where a.table_name = 'professionals' and a.record_id = current_setting('test.marie') $$,
  $$ values ('insert'::text, 'a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'the creation is audited with the adjointe as actor');

-- Redaction (Loi 25): the history says the personal fields changed, never their values.
select results_eq($$ select a.changed_fields -> 'personal_phone', a.changed_fields -> 'address_line1', a.changed_fields -> 'address_line2',
                            a.changed_fields -> 'postal_code', a.changed_fields -> 'gender'
                       from public.audit_log a
                      where a.table_name = 'professionals' and a.record_id = current_setting('test.p1') and a.action = 'update'
                        and a.changed_fields ? 'postal_code' $$,
  $$ values ('"[redacted]"'::jsonb, '"[redacted]"'::jsonb, '"[redacted]"'::jsonb, '"[redacted]"'::jsonb, '"[redacted]"'::jsonb) $$,
  'phone, address lines, postal code and gender are redacted in the audit log');
select results_eq($$ select a.changed_fields -> 'city' from public.audit_log a
                      where a.table_name = 'professionals' and a.record_id = current_setting('test.p1') and a.action = 'update'
                        and a.changed_fields ? 'city' $$,
  $$ values ('"[redacted]"'::jsonb) $$,
  'the city is redacted too');
select is((select count(*)::int from public.audit_log a
            where a.record_id = current_setting('test.p1')
              and a.changed_fields::text ~ '5145550101|Principale|App\. 4|G6V 1A1|Lévis|female'), 0,
  'no personal value of P1 reaches the audit log');
select results_eq($$ select a.changed_fields -> 'gender', a.changed_fields -> 'first_name'
                       from public.audit_log a
                      where a.table_name = 'professionals' and a.record_id = current_setting('test.marie') and a.action = 'insert' $$,
  $$ values ('"[redacted]"'::jsonb, '"Marie"'::jsonb) $$,
  'an insert row is redacted the same way; the name stays');

select * from finish();
rollback;
