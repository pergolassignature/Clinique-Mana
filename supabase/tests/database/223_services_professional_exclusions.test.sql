-- Services per professional (migrations *_services_professional_exclusions.sql,
-- *_appointments_service_exclusions.sql, *_demandes_proposition_services_exclusions.sql; decision
-- R-83). Covers: privileges (the table read-only, the RPC for users, the helper for no role); the
-- RPC (professionals.manage and services.view, a professional of the clinic, only services her
-- titles offer, replaces the set, audited); `services_catalog.excluded_professional_ids` (staff
-- see every professional's, a professional her own only); « Mon agenda »'s services, Demandes'
-- proposal services and a booking (insert, change of service) leave an excluded service out; an
-- imported appointment is kept; the module off refuses.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- =============================================================================
-- Shape and privileges
-- =============================================================================
select table_privs_are('public', 'service_professional_exclusions', 'anon', array[]::text[], 'anon: nothing');
select table_privs_are('public', 'service_professional_exclusions', 'authenticated', array['SELECT'], 'authenticated: read only');
select function_privs_are('public', 'set_professional_service_exclusions', array['uuid', 'uuid[]'], 'authenticated', array['EXECUTE'],
  'set_professional_service_exclusions: users');
select function_privs_are('private', 'service_excluded_for', array['uuid', 'uuid', 'uuid'], 'authenticated', array[]::text[],
  'service_excluded_for: no role');
select has_column('public', 'services_catalog', 'excluded_professional_ids', 'services_catalog publishes the exclusions');

-- =============================================================================
-- Fixtures (as postgres): org A (an adjointe, a conseillère, P1 with an account, P2 without), both
-- psychothérapeutes (10150 individual, 20160 couple; not 10157 naturopathy; 50601 a clinic service).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@spe.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u1@spe.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@spe.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@spe.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('demandes')) as y(m);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'u3@spe.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'p2@spe.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', p, t.id, 'L-1', true
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid), ('c0000000-0000-0000-0000-000000000002'::uuid)) as x(p)
  join public.profession_titles t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychotherapeute';
select set_config('test.s_ind', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10150), true);
select set_config('test.s_cpl', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 20160), true);
select set_config('test.s_cpl30', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 20170), true);
select set_config('test.s_eapcpl', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 40160), true);
select set_config('test.s_nat', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 10157), true);
select set_config('test.s_call', (select id::text from public.services where org_id = 'b0000000-0000-0000-0000-00000000000a' and code = 50601), true);

-- =============================================================================
-- The RPC
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(format($$ select public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001', array[%L]::uuid[]) $$,
                        current_setting('test.s_cpl')),
  '42501', null, 'the conseillère (no professionals.manage): refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001', array[current_setting('test.s_cpl')::uuid]),
  1, 'the adjointe: P1 does not offer the couple service');
select throws_ok(format($$ select public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001', array[%L]::uuid[]) $$,
                        current_setting('test.s_nat')),
  'P0001', 'Un des services choisis n''est pas offert par ses professions.', 'a service of another title: refused');
select throws_ok(format($$ select public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001', array[%L]::uuid[]) $$,
                        current_setting('test.s_call')),
  'P0001', 'Un des services choisis n''est pas offert par ses professions.', 'a clinic service (no title) cannot be excluded');
select throws_ok($$ select public.set_professional_service_exclusions('c0000000-0000-0000-0000-0000000000ff', '{}') $$,
  'P0001', 'Professionnel introuvable.', 'an unknown professional');
select is(public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000002', array[current_setting('test.s_ind')::uuid]),
  1, 'P2 does not offer the individual service');
select is((select excluded_professional_ids from public.services_catalog where id = current_setting('test.s_cpl')::uuid),
  array['c0000000-0000-0000-0000-000000000001'::uuid], 'services_catalog: the staff read who does not offer it');

-- A professional reads her own exclusions only.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select (select excluded_professional_ids from public.services_catalog where id = current_setting('test.s_cpl')::uuid),
                            (select excluded_professional_ids from public.services_catalog where id = current_setting('test.s_ind')::uuid) $$,
  $$ values (array['c0000000-0000-0000-0000-000000000001'::uuid], '{}'::uuid[]) $$,
  'a professional: her own exclusion, never another professional''s');
-- « Mon agenda »: her services leave the excluded one out.
select results_eq($$ select (select bool_or((s ->> 'id')::uuid = current_setting('test.s_ind')::uuid) from pg_catalog.jsonb_array_elements(x -> 'services') s),
                            (select bool_or((s ->> 'id')::uuid = current_setting('test.s_cpl')::uuid) from pg_catalog.jsonb_array_elements(x -> 'services') s)
                       from public.get_my_agenda_reference() x $$,
  $$ values (true, false) $$, '« Mon agenda »: the individual service, not the couple one');

-- Demandes' proposal: the services she offers.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select bool_or(id = current_setting('test.s_ind')::uuid), bool_or(id = current_setting('test.s_cpl')::uuid)
                       from public.proposition_services('c0000000-0000-0000-0000-000000000001') $$,
  $$ values (true, false) $$, 'a proposal for P1: the individual service, not the couple one');
reset role;

select ok(exists (select 1 from public.audit_log l where l.table_name = 'service_professional_exclusions' and l.action = 'insert'
                   and l.actor_id = 'a0000000-0000-0000-0000-000000000001' and l.org_id = 'b0000000-0000-0000-0000-00000000000a'),
  'an exclusion is in the journal, with who made it');

-- =============================================================================
-- Demandes' « Prochaine disponibilité » and Rendez-vous' open slots
-- =============================================================================
select is((select code from public.services
            where id = private.demandes_default_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', true)),
  20170, 'a couple request: her default service skips the couple 60 min she does not offer (the next couple session)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001',
            array[current_setting('test.s_cpl'), current_setting('test.s_cpl30'), current_setting('test.s_eapcpl')]::uuid[]),
  3, 'P1 offers no couple session at all');
reset role;
select is((select code from public.services
            where id = private.demandes_default_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', true)),
  10150, '… then a couple request falls back to her 50-minute session');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$ select * from public.get_open_slots('c0000000-0000-0000-0000-000000000001', %L, current_date, current_date + 7) $$,
                        current_setting('test.s_cpl')),
  'P0001', 'Ce professionnel n''offre pas ce service.', 'get_open_slots: no slot for a service she does not offer (refused as one of another title)');
select lives_ok(format($$ select * from public.get_open_slots('c0000000-0000-0000-0000-000000000001', %L, current_date, current_date + 7) $$,
                       current_setting('test.s_ind')),
  '… her offered service: asked as before');
reset role;

-- =============================================================================
-- Booking (Rendez-vous): never an excluded service
-- =============================================================================
select throws_ok(format($$ insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
                           values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', %L,
                                   '2027-03-15 13:00Z', '2027-03-15 14:00Z', '2027-03-15 14:00Z') $$, current_setting('test.s_cpl')),
  'P0001', 'Ce professionnel n''offre pas ce service.', 'a booking of a service she does not offer: refused');
select lives_ok(format($$ insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until, external_ref, state, completed_at)
                          values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', %L,
                                  '2026-03-15 13:00Z', '2026-03-15 14:00Z', '2026-03-15 14:00Z', 'gorv-1', 'completed', '2026-03-15 14:00Z') $$,
                         current_setting('test.s_cpl')),
  'the guard''s import exemption: an appointment inserted with external_ref (GOrendezvous''s history) and a service she does not offer is accepted');
insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        current_setting('test.s_ind')::uuid, '2027-03-16 13:00Z', '2027-03-16 13:50Z', '2027-03-16 14:00Z');
select throws_ok(format($$ update public.appointments set service_id = %L where id = 'e0000000-0000-0000-0000-000000000001' $$,
                        current_setting('test.s_cpl')),
  'P0001', 'Ce professionnel n''offre pas ce service.', 'changing an appointment to a service she does not offer: refused');
select throws_ok($$ update public.appointments set professional_id = 'c0000000-0000-0000-0000-000000000002' where id = 'e0000000-0000-0000-0000-000000000001' $$,
  'P0001', 'Ce professionnel n''offre pas ce service.', '… or moving it to a professional who does not offer it');
select lives_ok($$ update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour',
                                                 blocks_until = blocks_until + interval '1 hour'
                    where id = 'e0000000-0000-0000-0000-000000000001' $$,
  'moving it in time never asks again');

-- The set is replaced: an empty list gives everything back.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001', '{}'), 0, 'every service offered again');
reset role;
select lives_ok(format($$ insert into public.appointments (org_id, professional_id, service_id, starts_at, ends_at, blocks_until)
                          values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', %L,
                                  '2027-03-17 13:00Z', '2027-03-17 14:00Z', '2027-03-17 14:00Z') $$, current_setting('test.s_cpl')),
  '… and the couple service books again');

-- Services off: refused.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'services';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.set_professional_service_exclusions('c0000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', null, 'Services et tarifs off: refused');
reset role;

select * from finish();
rollback;
