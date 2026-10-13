-- Clients (migration *_clients_module.sql, plan C1). Covers: the registry (module, dependency,
-- permissions, role defaults, disabled at start); privileges (tables and views read-only for
-- clients, helpers for no role); every policy carries a clients.* gate; audit on every table with
-- the personal columns redacted; the referral sources seed; the file number (in order, per
-- clinic, frozen); checks (names, email, phones, province and postal code by country, rate
-- variant); the relation pair stored in order with its rights swapped, no self relation, valid
-- inverse types (also on update); ≤ 5 tags (also when a link moves); one active payer per kind,
-- an IVAC file once per clinic; RLS per role (staff read; a professional reads no client table,
-- only her linked clients' published columns through my_clients, anonymised ones hidden; another
-- clinic sees nothing; the module off hides all); the published views and helpers; the
-- agreements' FK to clients.
begin;
create extension if not exists pgtap with schema extensions;
select plan(114);

-- =============================================================================
-- Registry
-- =============================================================================
select results_eq($$ select name from public.modules where key = 'clients' $$, array['Clients'], 'module clients is registered');
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'clients' $$, array['professionals'], 'clients depends on professionals');
select results_eq($$ select key from public.permissions where module_key = 'clients' order by key $$,
  array['clients.manage', 'clients.merge', 'clients.privacy', 'clients.self', 'clients.view'], 'five permissions');
select results_eq($$ select role || ':' || permission_key from public.role_permissions where permission_key like 'clients.%' and role <> 'admin' order by 1 $$,
  array['admin_assistant:clients.manage', 'admin_assistant:clients.merge', 'admin_assistant:clients.view',
        'counselor:clients.manage', 'counselor:clients.view', 'provider:clients.self'],
  'defaults: conseillère and adjointe read and change, the adjointe merges, the professional sees her own');
select is((select count(*)::int from public.role_permissions where role = 'admin' and permission_key like 'clients.%'), 5, 'the admin holds all five');

-- =============================================================================
-- Privileges and catalog shape
-- =============================================================================
select table_privs_are('public', t.name, 'anon', array[]::text[], t.name || ': anon has nothing')
  from (values ('referral_sources'), ('client_tags'), ('clients'), ('client_notes'), ('client_relations'), ('client_insurances'),
               ('client_payers'), ('client_tag_links'), ('client_professional_links'), ('client_merges'),
               ('clients_directory'), ('my_clients')) as t(name);
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': authenticated reads only')
  from (values ('referral_sources'), ('client_tags'), ('clients'), ('client_notes'), ('client_relations'), ('client_insurances'),
               ('client_payers'), ('client_tag_links'), ('client_professional_links'), ('client_merges'),
               ('clients_directory'), ('my_clients')) as t(name);
select is_empty($$
  select p.tablename || '.' || p.policyname from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('referral_sources', 'client_tags', 'clients', 'client_notes', 'client_relations', 'client_insurances',
                         'client_payers', 'client_tag_links', 'client_professional_links', 'client_merges')
     and p.qual not like '%has_permission(''clients.%'
     -- C4: Demandes (which depends on Clients) reads the active sources through referral_sources_catalog.
     and not (p.policyname = 'referral_sources_select_demandes' and p.qual like '%has_permission(''demandes.view''%')
$$, 'every policy of the module carries a clients.* gate (or, for the referral sources, Demandes'' own)');
select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('referral_sources', 'client_tags', 'clients', 'client_notes', 'client_relations', 'client_insurances',
                       'client_payers', 'client_tag_links', 'client_professional_links', 'client_merges')
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = c.oid and p.proname = 'audit_trigger')
$$, 'every table of the module is audited');
select function_privs_are('private', f.name, f.args, r.role, array[]::text[], f.name || ': no EXECUTE for ' || r.role)
  from (values
    ('clients_link_professional', array['uuid', 'uuid', 'uuid', 'text']),
    ('client_visible_to_professional', array['uuid', 'uuid']),
    ('clients_assign_number', array[]::text[]),
    ('seed_clients_reference', array['uuid'])
  ) as f(name, args)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- =============================================================================
-- Fixtures (as postgres): orgs A and B; in A an admin, an adjointe, a conseillère, a provider
-- linked to professional P1, and professional P2 (no account); in B an admin.
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
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pro', 'B', 'pro@b.test', 'active');

-- The referral sources are seeded for every clinic.
select results_eq($$ select key from public.referral_sources where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order $$,
  array['google', 'social_media', 'word_of_mouth', 'professional_referral', 'employer_eap', 'school_organization', 'event', 'returning_client', 'other'],
  'the website''s referral sources, in order');
select is((select count(*)::int from public.referral_sources where org_id = 'b0000000-0000-0000-0000-00000000000b'), 9, '… for every clinic');
select is((select count(distinct a.source)::int from public.audit_log a where a.table_name = 'referral_sources' and a.org_id = 'b0000000-0000-0000-0000-00000000000a'), 1, 'seeded with one audit source …');
select is((select a.source from public.audit_log a where a.table_name = 'referral_sources' and a.org_id = 'b0000000-0000-0000-0000-00000000000a' limit 1), 'seed:clients_reference', '… seed:clients_reference');

-- Clients: C1, C2 (a child), C3 (her parent) in A; X1 in B.
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164, birthday, sex, external_ref) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test', '+15145550101', date '1990-03-04', 'female', 'GO-1');
insert into public.clients (id, org_id, first_name, last_name, birthday) values
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Gagnon', date '2013-06-01'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Gagnon', date '1980-01-01'),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Xavier', 'Bérubé', null);

select results_eq($$ select client_number from public.clients where org_id = 'b0000000-0000-0000-0000-00000000000a' order by client_number $$,
  array[1, 2, 3], 'file numbers given in order in clinic A');
select results_eq($$ select client_number from public.clients where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  array[1], '… and from 1 in clinic B');
select throws_ok($$ update public.clients set client_number = 99 where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '23514', 'La clinique et le numéro d''un dossier client ne changent pas.', 'a file number never changes');
select throws_ok($$ update public.clients set org_id = 'b0000000-0000-0000-0000-00000000000b' where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '23514', 'La clinique et le numéro d''un dossier client ne changent pas.', '… nor its clinic');
select is((select a.changed_fields ->> 'first_name' from public.audit_log a where a.table_name = 'clients' and a.action = 'insert'
            and a.record_id = 'd0000000-0000-0000-0000-000000000001'), '[redacted]', 'audit: the first name is redacted');
select is((select a.changed_fields ->> 'email' from public.audit_log a where a.table_name = 'clients' and a.action = 'insert'
            and a.record_id = 'd0000000-0000-0000-0000-000000000001'), '[redacted]', 'audit: the email is redacted');
select is((select a.changed_fields ->> 'birthday' from public.audit_log a where a.table_name = 'clients' and a.action = 'insert'
            and a.record_id = 'd0000000-0000-0000-0000-000000000001'), '[redacted]', 'audit: the birthday is redacted');
select is((select a.changed_fields ->> 'client_number' from public.audit_log a where a.table_name = 'clients' and a.action = 'insert'
            and a.record_id = 'd0000000-0000-0000-0000-000000000001'), '1', 'audit: the file number stays readable');

-- Checks.
select throws_ok($$ insert into public.clients (org_id, first_name, last_name) values ('b0000000-0000-0000-0000-00000000000a', ' Bob', 'X') $$,
  '23514', null, 'a name with surrounding spaces is refused');
select throws_ok($$ insert into public.clients (org_id, first_name, last_name, email) values ('b0000000-0000-0000-0000-00000000000a', 'Bob', 'X', 'Bob@Exemple.test') $$,
  '23514', null, 'an email is stored in lower case');
select throws_ok($$ insert into public.clients (org_id, first_name, last_name, mobile_e164) values ('b0000000-0000-0000-0000-00000000000a', 'Bob', 'X', '514-555-0101') $$,
  '23514', null, 'phones are E.164');
select throws_ok($$ insert into public.clients (org_id, first_name, last_name, province) values ('b0000000-0000-0000-0000-00000000000a', 'Bob', 'X', 'Québec') $$,
  '23514', null, 'in Canada, the province is a code');
select lives_ok($$ insert into public.clients (org_id, first_name, last_name, country, province, postal_code) values ('b0000000-0000-0000-0000-00000000000a', 'Bob', 'Abroad', 'FR', 'Île-de-France', '75001') $$,
  'abroad, a province and postal code as written');
select throws_ok($$ insert into public.clients (org_id, first_name, last_name, rate_variant) values ('b0000000-0000-0000-0000-00000000000a', 'Bob', 'X', 'vip') $$,
  '23514', null, 'the rate variant is student or reduced');
select throws_ok($$ insert into public.clients (org_id, first_name, last_name, external_ref) values ('b0000000-0000-0000-0000-00000000000a', 'Bob', 'X', 'GO-1') $$,
  '23505', null, 'an external reference is the clinic''s once');
select throws_ok($$ update public.clients set merged_into_id = id, archived_at = now() where id = 'd0000000-0000-0000-0000-000000000003' $$,
  '23514', null, 'a client is never merged into itself');

-- Relations: the parent (C3) written as a, though C2 < C3: stored the other way round.
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, a_manages_appointments, a_receives_invoices, a_main_contact)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'parent', 'child', true, true, true);
select results_eq($$ select client_a_id, client_b_id, type_a_to_b, type_b_to_a, a_manages_appointments, b_manages_appointments, b_receives_invoices, b_main_contact
                       from public.client_relations where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('d0000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000003'::uuid, 'child', 'parent', false, true, true, true) $$,
  'a pair written the other way is stored in order, its types and rights swapped');
select throws_ok($$ insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a) values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'sibling', 'sibling') $$,
  '23505', null, 'one relation per pair');
select throws_ok($$ insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a) values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'other', 'other') $$,
  'P0001', 'Un client ne peut pas être lié à lui-même.', 'no relation to oneself');
select throws_ok($$ insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a) values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'parent', 'parent') $$,
  '23514', null, 'the types are inverse');
select throws_ok($$ insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a) values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000009', 'other', 'other') $$,
  '23503', null, 'no relation with another clinic''s client');
-- A merge replaces one side: when the kept client sorts first, the row is swapped whole.
update public.client_relations set client_b_id = 'd0000000-0000-0000-0000-000000000001'
 where org_id = 'b0000000-0000-0000-0000-00000000000a';
select results_eq($$ select client_a_id, client_b_id, type_a_to_b, a_manages_appointments, b_manages_appointments from public.client_relations where org_id = 'b0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'd0000000-0000-0000-0000-000000000002'::uuid, 'parent', true, false) $$, 'a side replaced (merge) keeps who has which right');

-- Tags: at most 5 per client.
insert into public.client_tags (org_id, name, sort_order)
select 'b0000000-0000-0000-0000-00000000000a', 'Étiquette ' || n, n from generate_series(1, 6) n;
insert into public.client_tag_links (client_id, tag_id, org_id)
select 'd0000000-0000-0000-0000-000000000001', t.id, t.org_id from public.client_tags t
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.sort_order <= 5;
select is((select count(*)::int from public.client_tag_links where client_id = 'd0000000-0000-0000-0000-000000000001'), 5, 'five tags');
select throws_ok($$ insert into public.client_tag_links (client_id, tag_id, org_id)
                    select 'd0000000-0000-0000-0000-000000000001', t.id, t.org_id from public.client_tags t
                     where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.sort_order = 6 $$,
  'P0001', 'Un client a au plus 5 étiquettes.', 'a sixth is refused');
select throws_ok($$ insert into public.client_tags (org_id, name) values ('b0000000-0000-0000-0000-00000000000a', 'étiquette 1') $$,
  '23505', null, 'tag names are unique in a clinic (case ignored)');
insert into public.client_tag_links (client_id, tag_id, org_id)
select 'd0000000-0000-0000-0000-000000000003', t.id, t.org_id from public.client_tags t
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.sort_order = 6;
select throws_ok($$ update public.client_tag_links set client_id = 'd0000000-0000-0000-0000-000000000001' where client_id = 'd0000000-0000-0000-0000-000000000003' $$,
  'P0001', 'Un client a au plus 5 étiquettes.', 'a link moved to a client with five already is refused (merge)');

-- Payers: one active per kind; an IVAC file once per clinic.
insert into public.client_payers (client_id, org_id, kind, file_number, session_amount_cents) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'ivac', 'IV-123', 9450);
select throws_ok($$ insert into public.client_payers (client_id, org_id, kind, file_number) values ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'ivac', 'IV-999') $$,
  '23505', null, 'one active IVAC file per client');
select throws_ok($$ insert into public.client_payers (client_id, org_id, kind, file_number) values ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'ivac', 'iv-123') $$,
  '23505', null, 'an IVAC file number is the clinic''s once');
select throws_ok($$ insert into public.client_payers (client_id, org_id, kind) values ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'pae') $$,
  '23514', null, 'a PAE names its provider');
select is((select a.changed_fields ->> 'file_number' from public.audit_log a where a.table_name = 'client_payers' and a.action = 'insert'
            and a.record_id like 'd0000000-0000-0000-0000-000000000001:%'), '[redacted]', 'audit: the IVAC file number is redacted');

insert into public.client_notes (client_id, org_id, admin_notes) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Préfère les soirs.');
select is((select a.changed_fields ->> 'admin_notes' from public.audit_log a where a.table_name = 'client_notes' and a.action = 'insert'
            and a.record_id = 'd0000000-0000-0000-0000-000000000001'), '[redacted]', 'audit: the admin notes are redacted');
insert into public.client_insurances (client_id, rank, org_id, insurer, policy_number) values
  ('d0000000-0000-0000-0000-000000000001', 1, 'b0000000-0000-0000-0000-00000000000a', 'Assureur', 'POL-1');
select throws_ok($$ insert into public.client_insurances (client_id, rank, org_id, insurer) values ('d0000000-0000-0000-0000-000000000001', 3, 'b0000000-0000-0000-0000-00000000000a', 'Autre') $$,
  '23514', null, 'main or secondary insurance only');

-- Links: P1 sees C1 (primary) only, through the published helper.
update public.clients set primary_professional_id = 'c0000000-0000-0000-0000-000000000001' where id = 'd0000000-0000-0000-0000-000000000001';
select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'primary');
select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'appointment');
select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'demande');
select results_eq($$ select reason from public.client_professional_links where client_id = 'd0000000-0000-0000-0000-000000000001' $$,
  array['primary'], 'a second link keeps the first reason');
select throws_ok($$ select private.clients_link_professional('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'demande') $$,
  '23503', null, 'no link to another clinic''s professional');
select ok(private.client_visible_to_professional('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'), 'P1 may see C1');
select ok(not private.client_visible_to_professional('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001'), 'P1 may not see C3');

-- Agreements point at a client of the same clinic.
select throws_ok($$ insert into public.professional_client_agreements (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from)
                    values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'X1', 'd0000000-0000-0000-0000-000000000009', 50, 9000, 12000, date '2026-10-01') $$,
  '23503', null, 'an agreement never names another clinic''s client');
select lives_ok($$ insert into public.professional_client_agreements (org_id, professional_id, client_label, client_id, duration, professional_amount_cents, client_price_cents, effective_from)
                   values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'CLI-1', 'd0000000-0000-0000-0000-000000000001', 50, 9000, 12000, date '2026-10-01') $$,
  '… and may name one of its own');

-- =============================================================================
-- RLS: the module off hides everything
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(not public.module_enabled('clients'), 'clients starts disabled');
select is((select count(*)::int from public.clients), 0, 'disabled: the admin reads no client');
select is((select count(*)::int from public.referral_sources), 0, 'disabled: no referral source either');
reset role;
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'clients', true);

-- Staff read the clinic's rows.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.clients), 4, 'the conseillère reads the clinic''s clients');
select is((select count(*)::int from public.clients_directory), 4, '… and the directory');
select is((select count(*)::int from public.client_notes), 1, '… the notes');
select is((select count(*)::int from public.client_relations), 1, '… the relations');
select is((select count(*)::int from public.client_payers), 1, '… the payers');
select is((select count(*)::int from public.client_insurances), 1, '… the insurance');
select is((select count(*)::int from public.client_tag_links), 6, '… the tags');
select is((select count(*)::int from public.my_clients), 0, 'my_clients is empty for staff');
select is((select count(*)::int from public.clients where org_id = 'b0000000-0000-0000-0000-00000000000b'), 0, 'nothing of clinic B');
select throws_ok($$ update public.clients set first_name = 'Zoé' where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'no client write outside the RPCs');

-- The professional: her linked clients only, and only what she needs.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.clients), 0, 'the provider reads no client table');
select results_eq($$ select id, is_primary, reason from public.my_clients $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, true, 'primary') $$, 'my_clients: her linked client, primary');
select results_eq($$ select display_name, email from public.my_clients $$,
  $$ values ('Alice Tremblay', 'alice@exemple.test') $$, '… with what she needs to reach her');
select is((select count(*)::int from public.clients_directory), 0, 'the staff directory is empty for her');
select is((select count(*)::int from public.client_notes), 0, 'no notes');
select is((select count(*)::int from public.client_relations), 0, 'no relations');
select is((select count(*)::int from public.client_payers), 0, 'no payers');
select is((select count(*)::int from public.client_insurances), 0, 'no insurance');
select is((select count(*)::int from public.client_tag_links), 0, 'no tags');
select results_eq($$ select client_id from public.client_professional_links $$, array['d0000000-0000-0000-0000-000000000001'::uuid], 'her own links only');
reset role;
update public.clients set anonymized_at = now() where id = 'd0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.my_clients), 0, 'an anonymised client leaves my_clients');
reset role;
select throws_ok($$ update public.clients set anonymized_at = null where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '23514', 'Un dossier anonymisé le reste.', 'an anonymisation is never undone');
set local role authenticated;

-- Another clinic.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select results_eq($$ select id from public.clients $$, array['d0000000-0000-0000-0000-000000000009'::uuid], 'clinic B reads only its client');
select is((select count(*)::int from public.client_relations), 0, 'clinic B reads no relation of A');

-- A provider whose module is off for a professional without the self permission override.
reset role;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'clients.self', false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.client_professional_links), 0, 'without clients.self, the provider reads no link');
select is((select count(*)::int from public.my_clients), 0, '… and my_clients is empty');

select * from finish();
rollback;
