-- Professionnels: the public fees on the fiche (migration *_professionals_public_fees.sql, plan
-- Phase 4 Task 4c.5, P4-218). Covers: the grants (function_privs_are), get_professional_public_fees
-- for the conseillère (professionals.view, no grid access): the primary title, a chosen second
-- title, a draft, a title not theirs, no title, no grid, another clinic, an unknown id; only
-- durations and client prices come back; the grid in force today (a later grid ignored, none in
-- force → empty); the provider refused; module off.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, a provider and a conseillère; org B. Both clinics
-- are seeded with their titles and retention grids (organizations triggers).
-- P1 psychologue (primary) + naturopathe, P2 a draft psychoéducatrice, P4 without a title,
-- P5 nutritionniste (no grid) in org A; P3 psychologue in org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Paul',     'Un',     'p1@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pia',      'Deux',   'p2@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Pat',      'Trois',  'p3@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Pénélope', 'Quatre', 'p4@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Fleur',    'Cinq',   'p5@exemple.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select p.org_id, p.id, t.id, v.licence, v.is_primary
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, 'psychologue',     '12345',    true),
               ('c0000000-0000-0000-0000-000000000001'::uuid, 'naturopathe',     null,       false),
               ('c0000000-0000-0000-0000-000000000002'::uuid, 'psychoeducateur', '12345-01', true),
               ('c0000000-0000-0000-0000-000000000003'::uuid, 'psychologue',     '12345',    true),
               ('c0000000-0000-0000-0000-000000000005'::uuid, 'nutritionniste',  '12345',    true)) as v(id, key, licence, is_primary)
  join public.professionals p on p.id = v.id
  join public.profession_titles t on t.org_id = p.org_id and t.key = v.key;
select set_config('test.naturo_a', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'naturopathe'), true);
select set_config('test.sexo_a', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'sexologue'), true);
select set_config('test.psy_grid_a', (select g.id::text from public.retention_grids g join public.profession_titles t on t.id = g.title_id
                                       where g.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.today_a', (select (now() at time zone o.timezone)::date::text from public.organizations o
                                    where o.id = 'b0000000-0000-0000-0000-00000000000a'), true);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'get_professional_public_fees', array['uuid', 'uuid'], 'anon', array[]::text[], 'anon cannot read the public fees');
select function_privs_are('public', 'get_professional_public_fees', array['uuid', 'uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may read them (the RPC checks professionals.view)');
select function_privs_are('public', 'get_professional_public_fees', array['uuid', 'uuid'], 'service_role', array[]::text[], 'service_role cannot');
select ok((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'get_professional_public_fees'),
  'get_professional_public_fees is security definer (the grids need professionals.compensation)');

-- =============================================================================
-- The conseillère (professionals.view, not professionals.compensation)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select is((select count(*)::int from public.retention_grid_prices), 0, 'the conseillère cannot read the grids themselves');
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001'),
  '[{"duration": 60, "client_price_cents": 20000}, {"duration": 50, "client_price_cents": 17500}, {"duration": 30, "client_price_cents": 13000}]'::jsonb,
  'no title given: the primary title''s client prices, 60 then 50 then 30 min');
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001', current_setting('test.naturo_a')::uuid),
  '[{"duration": 50, "client_price_cents": 12000}, {"duration": 30, "client_price_cents": 8000}]'::jsonb,
  'the chosen second title''s prices (a grid without a 60 min price prints none)');
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000002'),
  '[{"duration": 60, "client_price_cents": 16500}, {"duration": 50, "client_price_cents": 14000}, {"duration": 30, "client_price_cents": 10000}]'::jsonb,
  'a draft''s fiche has its fees too (psychoéducation: 165 $ for 60 min)');
select ok(not exists (
    select 1 from pg_catalog.jsonb_array_elements(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001')) e,
                  pg_catalog.jsonb_object_keys(e) k
     where k not in ('duration', 'client_price_cents')),
  'only durations and client prices: never a retention, a tier or a pay');
select throws_ok(format($$ select public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001', %L) $$, current_setting('test.sexo_a')),
  'P0001', 'Titre introuvable.', 'a title the professional does not hold is refused');
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000004'), '[]'::jsonb, 'no title: no fees (« À confirmer »)');
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000005'), '[]'::jsonb, 'a title without a grid: no fees (« À confirmer »)');
select throws_ok($$ select public.get_professional_public_fees('c0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Professionnel introuvable.', 'a professional of another clinic is not found');
select throws_ok($$ select public.get_professional_public_fees('c0000000-0000-0000-0000-0000000000ff') $$,
  'P0001', 'Professionnel introuvable.', 'an unknown id is not found');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'the provider cannot');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000003') -> 1 -> 'client_price_cents', '17500'::jsonb,
  'another clinic reads its own grid');

-- =============================================================================
-- The grid in force today
-- =============================================================================
reset role;
-- A new grid from in ten days: today's prices still print.
update public.retention_grids set effective_to = current_setting('test.today_a')::date + 10 where id = current_setting('test.psy_grid_a')::uuid;
insert into public.retention_grids (id, org_id, title_id, effective_from)
select 'd0000000-0000-0000-0000-000000000001', g.org_id, g.title_id, current_setting('test.today_a')::date + 10
  from public.retention_grids g where g.id = current_setting('test.psy_grid_a')::uuid;
insert into public.retention_grid_prices (org_id, grid_id, duration, client_price_cents)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 50, 99900);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001') -> 1 -> 'client_price_cents', '17500'::jsonb,
  'a grid starting later is not printed yet');

reset role;
-- The current grid ended today: no grid in force until the new one starts.
update public.retention_grids set effective_to = current_setting('test.today_a')::date where id = current_setting('test.psy_grid_a')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001'), '[]'::jsonb,
  'no grid in force today: no fees (« À confirmer »)');

reset role;
update public.retention_grids set effective_from = current_setting('test.today_a')::date where id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001'),
  '[{"duration": 50, "client_price_cents": 99900}]'::jsonb, 'the grid starting today prints from today');

-- =============================================================================
-- Module off
-- =============================================================================
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_public_fees('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'module off: refused');
reset role;

select * from finish();
rollback;
