-- Services et tarifs: a new rate after an ended one (migration *_services_rate_variant_after_end.sql).
-- Covers: same privileges; with no open rate, a start before the series' last end is refused in
-- French on effective_from (never the 23P01 of the exclusion constraint); on that end or after it
-- is accepted; another series (another title) is not affected; the open-rate rule still holds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select function_privs_are('public', 'add_service_rate_variant', array['uuid', 'text', 'uuid', 'text', 'integer', 'numeric', 'date'], 'anon', array[]::text[], 'anon cannot call it');
select function_privs_are('public', 'add_service_rate_variant', array['uuid', 'text', 'uuid', 'text', 'integer', 'numeric', 'date'], 'authenticated', array['EXECUTE'], 'authenticated may call it');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'services', true);
select set_config('test.psy', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.sexo', (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'sexologue'), true);
select set_config('test.s10130', (select s.id::text from public.services s where s.org_id = 'b0000000-0000-0000-0000-00000000000a' and s.code = 10130), true);
-- A reduced rate for psychologists, ended on 2027-01-01 (last day 31 Dec 2026): no open rate left.
insert into public.service_rate_variants (org_id, service_id, variant, profession_title_id, discount_kind, amount_cents, effective_from, effective_to)
values ('b0000000-0000-0000-0000-00000000000a', current_setting('test.s10130')::uuid, 'reduced', current_setting('test.psy')::uuid, 'price', 9000, date '2026-07-01', date '2027-01-01');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select throws_ok($$ select public.add_service_rate_variant(current_setting('test.s10130')::uuid, 'reduced', current_setting('test.psy')::uuid, 'price', 8500, null, date '2026-12-01') $$,
  'P0001', 'La date doit être postérieure à la fin du tarif précédent, le 31 déc. 2026.', 'a start before the ended rate''s end: refused in French');
-- The HINT, from the function's source (no pg_temp helper with an exception handler: conventions §10).
select ok((select p.prosrc ~ 'fin du tarif précédent, le %\.'', private\.format_date_short_fr\(v_last_end - 1\)\s+using errcode = ''P0001'', hint = ''effective_from'''
             from pg_proc p where p.oid = 'public.add_service_rate_variant(uuid, text, uuid, text, integer, numeric, date)'::regprocedure),
  '... with HINT effective_from (the form marks the field)');
select lives_ok($$ select public.add_service_rate_variant(current_setting('test.s10130')::uuid, 'reduced', current_setting('test.psy')::uuid, 'price', 8500, null, date '2027-01-01') $$,
  'a start on the ended rate''s end is accepted');
select is((select count(*)::int from public.service_rate_variants v
            where v.service_id = current_setting('test.s10130')::uuid and v.variant = 'reduced' and v.effective_to is null), 1,
  '... and is the series'' open rate');
select lives_ok($$ select public.add_service_rate_variant(current_setting('test.s10130')::uuid, 'reduced', current_setting('test.sexo')::uuid, 'price', 8000, null, date '2026-12-01') $$,
  'another title''s series is not affected');
select throws_ok($$ select public.add_service_rate_variant(current_setting('test.s10130')::uuid, 'reduced', current_setting('test.psy')::uuid, 'price', 8000, null, date '2027-01-01') $$,
  'P0001', 'La date doit être postérieure au début du tarif en vigueur, le 1 janv. 2027.', 'the open-rate rule still holds');

select * from finish();
rollback;
