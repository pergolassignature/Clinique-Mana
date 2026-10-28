-- « Approches » back as checkboxes, counted but off the fiche (migration
-- *_professionals_approaches.sql, decision P4-510, reviving what P4-240 and P4-276 removed).
-- Covers: the seventeen seeded per clinic in Jonathan's order, and a clinic created later gets
-- them too; the set is read by staff and by the professional herself only; writing it replaces
-- what she held, keeps the text of « Autre — précisez » on that row alone, and refuses an unknown
-- or archived approach; the questionnaire knows `approach_ids` in « Portrait » and the snapshot
-- carries it; `count_professional_approaches` counts active professionals and needs the
-- permission; nothing is added to the public profile.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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
grant execute on function private.test_error_hint(text) to authenticated, service_role;

-- =============================================================================
-- Fixtures: clinic A (admin, a provider with her own file), one active professional
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ap.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@ap.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@ap.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro B', 'u3@ap.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'Ana', 'Un', 'u2@ap.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Bo', 'Deux', 'u3@ap.test', 'active');

-- =============================================================================
-- The catalogue
-- =============================================================================
select is((select count(*)::int from public.approaches where org_id = 'b0000000-0000-0000-0000-00000000000a'), 17,
  'the seventeen approaches Jonathan listed are seeded');
select results_eq($$ select key from public.approaches
                      where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order limit 3 $$,
  $$ values ('cbt'), ('humanistic'), ('psychodynamic') $$, '… in his order');
select is((select name from public.approaches
            where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'emdr'),
  'EMDR — Désensibilisation et retraitement par les mouvements oculaires', 'the names are written as he wrote them');
select ok((select a.requires_text from public.approaches a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.key = 'other'),
  '« Autre — précisez » is the one that asks for a text');
select ok((select not bool_or(a.requires_text) from public.approaches a
            where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.key <> 'other'),
  '… and no other does');

-- A clinic created later gets them too (the reference seed's trigger).
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000b', 'Org B');
select is((select count(*)::int from public.approaches where org_id = 'b0000000-0000-0000-0000-00000000000b'), 17,
  'a clinic created later is seeded as well');

-- =============================================================================
-- Writing the set
-- =============================================================================
select lives_ok($$ select private.apply_professional_approaches(
  'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  array(select a.id from public.approaches a where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.key in ('cbt', 'emdr', 'other')),
  '  Approche maison  ') $$, 'her approaches are written');
select results_eq($$ select a.key, pa.other_text
                       from public.professional_approaches pa
                       join public.approaches a on a.id = pa.approach_id
                      where pa.professional_id = 'c0000000-0000-0000-0000-000000000001' order by a.sort_order $$,
  $$ values ('cbt', null::text), ('emdr', null::text), ('other', 'Approche maison') $$,
  '… the text trimmed, and only on « Autre — précisez »');
select lives_ok($$ select private.apply_professional_approaches(
  'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  array(select a.id from public.approaches a where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.key = 'narrative'),
  null) $$, 'writing again replaces what she held');
select results_eq($$ select a.key from public.professional_approaches pa
                       join public.approaches a on a.id = pa.approach_id
                      where pa.professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('narrative') $$, '… the former ones are gone, « Autre » with them');
select is(private.test_error_hint($$ select private.apply_professional_approaches(
  'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  array['00000000-0000-4000-8000-00000000dead'::uuid], null) $$),
  'approach_ids', 'an approach that is not this clinic''s is refused');
update public.approaches set is_active = false
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'schema';
select is(private.test_error_hint($$ select private.apply_professional_approaches(
  'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002',
  array(select a.id from public.approaches a where a.org_id = 'b0000000-0000-0000-0000-00000000000a' and a.key = 'schema'),
  null) $$),
  'approach_ids', 'an archived one she does not already hold is refused');

-- =============================================================================
-- The questionnaire knows the field, and the snapshot carries it
-- =============================================================================
select results_eq($$ select section, kind from private.submission_fields() where field = 'approach_ids' $$,
  $$ values ('portrait', 'set') $$, '`approach_ids` is a set of the « Portrait » section');
select ok((select (private.professional_submission_snapshot(
             'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001') #> '{portrait,approach_ids}') is not null),
  'the snapshot the questionnaire prefills from carries her approaches');
-- P4-173: the portrait is complete with its bio; the approaches never hold a questionnaire back.
select is((select count(*)::int from private.submission_fields() where section = 'portrait'), 5,
  'the portrait has five fields now');

-- =============================================================================
-- Reading: staff, herself, and the counts
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_approaches), 0,
  'a professional reads none of another''s approaches');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_approaches), 1, '… and reads her own');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select x ->> 'professionals' from jsonb_array_elements(public.count_professional_approaches()) x
            where x ->> 'key' = 'narrative'),
  '1', 'the counts say how many professionals hold each approach');
reset role;

select * from finish();
rollback;
