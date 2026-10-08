-- Professionnels: the fiche PDF, download (migration *_professionals_fiche.sql, plan Phase 4
-- Task 4c.5). Covers: the stamp column (no client grant) and mark_professional_fiche_generated
-- (conseillère, adjointe on a draft, provider refused, another clinic, unknown id, module off, the
-- audit row and its actor); the fiche's render options in the module settings (P4-353: defaults,
-- the conseillère reads them, only professionals.settings changes them, booleans never null).
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- =============================================================================
-- Fixtures (as postgres): org A with an admin, an adjointe, a provider and a conseillère; org B with
-- an admin. P1 (active), P2 (draft) and P4 (active) in org A; P3 (active) in org B.
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
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Paul', 'Un',     'p1@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pia',  'Deux',   'p2@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Pat',  'Trois',  'p3@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Pénélope', 'Quatre', 'p4@exemple.test', 'active');

-- =============================================================================
-- Privileges and catalogue rows (as postgres)
-- =============================================================================
select has_column('public', 'professionals', 'fiche_generated_at', 'professionals.fiche_generated_at exists');
select col_type_is('public', 'professionals', 'fiche_generated_at', 'timestamp with time zone', 'fiche_generated_at is a timestamptz');
select col_is_null('public', 'professionals', 'fiche_generated_at', 'fiche_generated_at is null until a first fiche');
select column_privs_are('public', 'professionals', 'fiche_generated_at', 'authenticated', array['SELECT'],
  'authenticated may read fiche_generated_at, never update it (the RPC does)');

select function_privs_are('public', 'mark_professional_fiche_generated', array['uuid'], 'anon', array[]::text[], 'anon cannot stamp a fiche');
select function_privs_are('public', 'mark_professional_fiche_generated', array['uuid'], 'authenticated', array['EXECUTE'], 'authenticated may stamp (the RPC checks the permission)');
select function_privs_are('public', 'mark_professional_fiche_generated', array['uuid'], 'service_role', array[]::text[], 'service_role cannot stamp (functions use the caller''s client)');
select ok((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'mark_professional_fiche_generated'),
  'mark_professional_fiche_generated is security definer');

-- =============================================================================
-- mark_professional_fiche_generated
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select isnt(public.mark_professional_fiche_generated('c0000000-0000-0000-0000-000000000001'), null,
  'the conseillère stamps the fiche of a professional of her clinic');
select throws_ok($$ select public.mark_professional_fiche_generated('c0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Professionnel introuvable.', 'a professional of another clinic is not found');
select throws_ok($$ select public.mark_professional_fiche_generated('c0000000-0000-0000-0000-0000000000ff') $$,
  'P0001', 'Professionnel introuvable.', 'an unknown id is not found');
select throws_ok($$ update public.professionals set fiche_generated_at = now() where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'no client writes the column directly');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.mark_professional_fiche_generated('c0000000-0000-0000-0000-000000000002') $$,
  'the adjointe stamps one too (any status: a draft can be downloaded)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.mark_professional_fiche_generated('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'the provider cannot');

reset role;
select isnt((select fiche_generated_at from public.professionals where id = 'c0000000-0000-0000-0000-000000000001'), null,
  'the stamp is stored');
select is((select fiche_generated_at from public.professionals where id = 'c0000000-0000-0000-0000-000000000003'), null,
  'the other clinic''s professional is untouched');
select ok(exists (select 1 from public.audit_log l
                   where l.table_name = 'professionals' and l.record_id = 'c0000000-0000-0000-0000-000000000001'
                     and l.action = 'update' and l.actor_id = 'a0000000-0000-0000-0000-000000000004'
                     and l.changed_fields ? 'fiche_generated_at'),
  'the stamp is audited, with its actor');

update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.mark_professional_fiche_generated('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'module off: refused');
reset role;
update public.org_modules set enabled = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';

-- =============================================================================
-- The fiche's render options (module settings, P4-353)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professionals_settings() - array['collect_sin', 'invitation_expiry_days', 'invitation_reminder_after_days'],
  '{"fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb,
  'the conseillère reads the fiche options, all on by default');
select throws_ok($$ select public.set_professionals_settings('{"fiche_show_closing": false}') $$,
  '42501', null, 'the conseillère cannot change them');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professionals_settings('{"fiche_show_pro_contact": false, "fiche_show_closing": false}')
            - array['collect_sin', 'invitation_expiry_days', 'invitation_reminder_after_days'],
  '{"fiche_show_pro_contact": false, "fiche_show_clinic_footer": true, "fiche_show_closing": false}'::jsonb,
  'the admin turns two off; the effective settings come back');
select throws_ok($$ select public.set_professionals_settings('{"fiche_show_clinic_footer": "non"}') $$,
  '22023', 'Réglage fiche_show_clinic_footer invalide : true ou false attendu.', 'a fiche option is a boolean');
select throws_ok($$ select public.set_professionals_settings('{"fiche_show_closing": null}') $$,
  '22023', 'Réglage fiche_show_closing invalide : true ou false attendu.', 'a fiche option is never null');
select throws_ok($$ select public.set_professionals_settings('{"fiche_show_pro_contact": 1}') $$,
  '22023', 'Réglage fiche_show_pro_contact invalide : true ou false attendu.', 'a number is not a boolean');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professionals_settings() -> 'fiche_show_closing', 'false'::jsonb, 'the conseillère''s next fiche reads the change');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.get_professionals_settings() -> 'fiche_show_closing', 'true'::jsonb, 'the other clinic keeps its default');
reset role;

select lives_ok($$ select private.validate_professionals_setting(d.key, d.value) from jsonb_each(private.professionals_settings_defaults()) d $$,
  'every default passes its own rule (defaults and validator in step)');

select * from finish();
rollback;
