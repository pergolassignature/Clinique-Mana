-- Rapports « Indicateurs des demandes » for the counselors (migration *_reports_demandes_indicators.sql,
-- decision R-81). Covers: the permission `reports.demandes_indicators` (module reports, French
-- description); its defaults (admin, adjointe, conseillère) in the template and in every clinic;
-- `report_demandes` opens with it or with `reports.view`, never without both (an override's
-- refusal, a provider, the module off); it opens no other report; the adjointe holding
-- users.manage can still give « Conseillère » (the latent role guard).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- =============================================================================
-- Registry and defaults
-- =============================================================================
select results_eq($$ select module_key, description from public.permissions where key = 'reports.demandes_indicators' $$,
  $$ values ('reports'::text, 'Voir les indicateurs des demandes (activité, provenance, délais, liste d''attente)'::text) $$,
  'the permission belongs to Rapports, described in French');
select results_eq($$ select role from public.role_permissions where permission_key = 'reports.demandes_indicators' order by role $$,
  $$ values ('admin'::text), ('admin_assistant'), ('counselor') $$,
  'template defaults: the admin, the adjointe and the conseillère (R-81)');
select results_eq($$ select role from public.role_permissions where permission_key = 'reports.view' order by role $$,
  $$ values ('admin'::text) $$, 'reports.view stays the admin''s');
select is_empty($$ select o.id from public.organizations o
                    where exists (select 1 from public.org_role_permissions rp where rp.org_id = o.id and rp.role = 'admin')
                      and (select count(*) from public.org_role_permissions rp
                            where rp.org_id = o.id and rp.permission_key = 'reports.demandes_indicators'
                              and rp.role in ('admin', 'admin_assistant', 'counselor')) <> 3 $$,
  'every existing clinic holds the three defaults');

-- =============================================================================
-- Fixtures (as postgres): org A (admin, adjointe with users.manage, conseillère, a provider, a
-- second conseillère refused the permission, a user to give a role); org B (a new clinic).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ri.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 6) n;
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'), ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@ri.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@ri.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u3@ri.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u4@ri.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère B', 'u5@ri.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Nouvelle', 'u6@ri.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'users.manage', true),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'reports.demandes_indicators', false);
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('billing'), ('reports'), ('demandes')) as y(m);

select results_eq($$ select role from public.org_role_permissions
                      where org_id = 'b0000000-0000-0000-0000-00000000000b' and permission_key = 'reports.demandes_indicators' order by role $$,
  $$ values ('admin'::text), ('admin_assistant'), ('counselor') $$,
  'a new clinic starts with the same defaults');

-- =============================================================================
-- Who opens « Indicateurs des demandes »
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'the conseillère opens « Indicateurs des demandes »');
select throws_ok($$ select public.report_cancellations('2026-09-01', '2026-09-30') $$, '42501', null,
  '… but not « Annulations et absences » (reports.view)');
select throws_ok($$ select public.report_consents('2026-09-01', '2026-09-30') $$, '42501', null, '… nor « Consentements des clients »');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, '42501',
  'Permission refusée : reports.demandes_indicators', 'a conseillère refused the permission (override): refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, '42501', null, 'a professional: refused');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'the admin still opens it');
reset role;

-- reports.view alone keeps opening it (a custom role, here an override on the second conseillère).
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'reports.view', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, 'reports.view without the new permission: still opens it');
reset role;

-- The module off: nothing.
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'reports';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.report_demandes('2026-09-01', '2026-09-30') $$, '42501', null, 'Rapports off: refused');

-- The role guard: the adjointe (users.manage) still gives « Conseillère ».
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_user_role('a0000000-0000-0000-0000-000000000006', 'counselor') $$,
  'the adjointe holding users.manage can still give « Conseillère » (she holds every one of its defaults)');
reset role;

select * from finish();
rollback;
