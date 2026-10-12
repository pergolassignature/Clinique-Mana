-- Demandes (migration *_demandes_module.sql, plan D1 part 1). Covers: the registry (module,
-- dependencies, permissions, role defaults); privileges (read-only tables, the helpers for no
-- role); every policy carries a demandes.* gate; audit on every table, personal values redacted;
-- the reference (DEM-AAAA-NNNN in order per clinic and year, frozen); checks (states and their
-- consistency, a contact to call back, a waiting-list target, priority and waived fee reasons);
-- RLS per role (staff read; the note with demandes.notes only; the professional her matched
-- requests and the entries naming her, never the note; another clinic nothing; the module off
-- hides all).
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

-- =============================================================================
-- Registry
-- =============================================================================
select results_eq($$ select name from public.modules where key = 'demandes' $$, array['Demandes'], 'module demandes is registered');
select results_eq($$ select depends_on from public.module_dependencies where module_key = 'demandes' order by 1 $$,
  array['clients', 'professionals'], 'demandes depends on clients and professionals');
select results_eq($$ select key from public.permissions where module_key = 'demandes' order by key $$,
  array['demandes.manage', 'demandes.notes', 'demandes.self', 'demandes.view', 'demandes.waitlist'], 'five permissions');
select results_eq($$ select role || ':' || permission_key from public.role_permissions where permission_key like 'demandes.%' and role <> 'admin' order by 1 $$,
  array['admin_assistant:demandes.manage', 'admin_assistant:demandes.notes', 'admin_assistant:demandes.view', 'admin_assistant:demandes.waitlist',
        'counselor:demandes.manage', 'counselor:demandes.notes', 'counselor:demandes.view', 'counselor:demandes.waitlist',
        'provider:demandes.self'],
  'defaults: the counselors and the adjointe work requests, notes and the list; the professional her own (D-1)');
select is((select count(*)::int from public.role_permissions where role = 'admin' and permission_key like 'demandes.%'), 5, 'the admin holds all five');

-- =============================================================================
-- Privileges and catalog shape
-- =============================================================================
select table_privs_are('public', t.name, 'anon', array[]::text[], t.name || ': anon has nothing')
  from (values ('demandes'), ('demande_motifs'), ('demande_notes'), ('demande_participants'), ('demande_events'),
               ('demande_tasks'), ('demande_propositions'), ('waitlist_entries'), ('waitlist_contacts'), ('waitlist_offers')) as t(name);
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': authenticated reads only')
  from (values ('demandes'), ('demande_motifs'), ('demande_notes'), ('demande_participants'), ('demande_events'),
               ('demande_tasks'), ('demande_propositions'), ('waitlist_entries'), ('waitlist_contacts'), ('waitlist_offers')) as t(name);
select is_empty($$
  select p.tablename || '.' || p.policyname from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('demandes', 'demande_motifs', 'demande_notes', 'demande_participants', 'demande_events',
                         'demande_tasks', 'demande_propositions', 'waitlist_entries', 'waitlist_contacts', 'waitlist_offers')
     and p.qual not like '%has_permission(''demandes.%'
$$, 'every policy of the module carries a demandes.* gate');
select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('demandes', 'demande_motifs', 'demande_notes', 'demande_participants', 'demande_events',
                       'demande_tasks', 'demande_propositions', 'waitlist_entries', 'waitlist_contacts', 'waitlist_offers')
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = c.oid and p.proname = 'audit_trigger')
$$, 'every table of the module is audited');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname like 'demande%'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the module''s private helpers are granted to no role');

-- =============================================================================
-- Fixtures (as postgres): orgs A and B; in A an admin, an adjointe, a provider (professional P1),
-- a counselor; P2 without an account; in B an admin and P3. Modules on in both.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@dem.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 5) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@dem.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@dem.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u3@dem.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u4@dem.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u5@dem.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'u3@dem.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Pro', 'Deux', 'pro2@dem.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pro', 'B', 'pro3@dem.test', 'active');

-- Requests: D1 (matched to P1, with a note and a participant), D2 (new), X1 in B.
insert into public.demandes (id, org_id, received_at, contact_name, contact_phone_e164, contact_email, concerns, state, matched_professional_id) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', '2026-10-12 14:00+00', 'Alice Tremblay', '+15145550101',
   'alice@exemple.test', 'Anxiété au travail', 'matched', 'c0000000-0000-0000-0000-000000000001');
insert into public.demandes (id, org_id, received_at, contact_name) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', '2026-10-12 15:00+00', 'Bob'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', '2026-10-12 15:00+00', 'Xavier');
insert into public.demande_notes (demande_id, org_id, internal_note) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Préfère être appelée le soir.');
insert into public.demande_participants (demande_id, org_id, display_name, relationship, is_primary) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice Tremblay', 'self', true);
insert into public.waitlist_entries (id, org_id, demande_id, target_professional_id, state) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'active'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'active');

-- =============================================================================
-- The reference
-- =============================================================================
select results_eq($$ select reference from public.demandes where org_id = 'b0000000-0000-0000-0000-00000000000a' order by reference $$,
  array['DEM-2026-0001', 'DEM-2026-0002'], 'references in order per clinic and year');
select results_eq($$ select reference from public.demandes where org_id = 'b0000000-0000-0000-0000-00000000000b' $$,
  array['DEM-2026-0001'], '… from 1 in clinic B');
insert into public.demandes (id, org_id, received_at, contact_name) values
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', '2027-01-01 04:30+00', 'Nouvel an'),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', '2027-01-01 06:00+00', 'Nouvel an 2');
select is((select reference from public.demandes where id = 'e0000000-0000-0000-0000-000000000003'),
  'DEM-2026-0003', 'the year is the clinic''s: 23 h 30 on Dec 31 in Toronto is still 2026');
select is((select reference from public.demandes where id = 'e0000000-0000-0000-0000-000000000004'),
  'DEM-2027-0001', 'a new year starts from 1');
select throws_ok($$ update public.demandes set reference = 'DEM-2026-0099' where id = 'e0000000-0000-0000-0000-000000000002' $$,
  '23514', 'La clinique, le numéro et la date de réception d''une demande ne changent pas.', 'a reference never changes');
select throws_ok($$ update public.demandes set received_at = now() where id = 'e0000000-0000-0000-0000-000000000002' $$,
  '23514', null, '… nor the date of reception');

-- =============================================================================
-- Checks
-- =============================================================================
select throws_ok($$ insert into public.demandes (org_id) values ('b0000000-0000-0000-0000-00000000000a') $$,
  '23514', null, 'a request has someone to call back');
select throws_ok($$ insert into public.demandes (org_id, contact_name, state) values ('b0000000-0000-0000-0000-00000000000a', 'X', 'closed') $$,
  '23514', null, 'closed needs a reason and a date');
select throws_ok($$ insert into public.demandes (org_id, contact_name, state) values ('b0000000-0000-0000-0000-00000000000a', 'X', 'matched') $$,
  '23514', null, 'matched needs a professional');
select throws_ok($$ insert into public.demandes (org_id, contact_name, contact_email) values ('b0000000-0000-0000-0000-00000000000a', 'X', 'X@Y.test') $$,
  '23514', null, 'the email in lower case');
select throws_ok($$ insert into public.demandes (org_id, contact_name, availability_periods) values ('b0000000-0000-0000-0000-00000000000a', 'X', '{night}') $$,
  '23514', null, 'availability periods from the list');
select throws_ok($$ insert into public.demandes (org_id, contact_name, channel) values ('b0000000-0000-0000-0000-00000000000a', 'X', 'pigeon') $$,
  '23514', null, 'a known channel');
select throws_ok($$ insert into public.waitlist_entries (org_id, demande_id) values ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'an entry targets a profession or a professional');
select throws_ok($$ insert into public.waitlist_entries (org_id, demande_id, target_professional_id, priority)
  values ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'priority') $$,
  '23514', null, 'a priority needs its reason');
select throws_ok($$ insert into public.waitlist_entries (org_id, demande_id, target_professional_id, fee_status)
  values ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'waived') $$,
  '23514', null, 'a waived fee needs its reason');
select throws_ok($$ insert into public.waitlist_entries (org_id, demande_id, target_professional_id)
  values ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003') $$,
  '23503', null, 'an entry cannot target another clinic''s professional');

-- =============================================================================
-- Audit: personal values redacted
-- =============================================================================
select results_eq($$
  select a.changed_fields->>'contact_name', a.changed_fields->>'contact_email', a.changed_fields->>'concerns', a.changed_fields->>'state'
    from public.audit_log a where a.table_name = 'demandes' and a.action = 'insert' and a.record_id = 'e0000000-0000-0000-0000-000000000001'
$$, $$ values ('[redacted]', '[redacted]', '[redacted]', 'matched') $$, 'audit: the contact and the concerns redacted, the state readable');
select is((select a.changed_fields->>'internal_note' from public.audit_log a where a.table_name = 'demande_notes'
            and a.record_id = 'e0000000-0000-0000-0000-000000000001'), '[redacted]', 'audit: the internal note redacted');

-- =============================================================================
-- RLS
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.demandes where org_id = 'b0000000-0000-0000-0000-00000000000a'), 4, 'the counselor reads every request of her clinic');
select is((select count(*)::int from public.demande_notes), 1, 'and the note (demandes.notes)');
select is((select count(*)::int from public.waitlist_entries), 2, 'and the waiting list');
select is((select count(*)::int from public.demandes where org_id = 'b0000000-0000-0000-0000-00000000000b'), 0, 'nothing of clinic B');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.demandes), 4, 'the adjointe reads the requests');
select is((select count(*)::int from public.demande_notes), 1, 'and the note');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select id from public.demandes $$, array['e0000000-0000-0000-0000-000000000001'::uuid],
  'the professional reads only the request matched to her');
select is((select count(*)::int from public.demande_participants), 1, 'with its participants');
select is((select count(*)::int from public.demande_notes), 0, 'never the internal note');
select results_eq($$ select id from public.waitlist_entries $$, array['f0000000-0000-0000-0000-000000000001'::uuid],
  'the waiting-list entries naming her only');
select is((select count(*)::int from public.demande_events), 0, 'no history or tasks (staff only)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.demandes), 1, 'clinic B''s admin reads her one request');

-- The module off: everything disappears, for the admin too.
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'demandes';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.demandes), 0, 'module off: no request');
select is((select count(*)::int from public.waitlist_entries), 0, 'module off: no entry');

select * from finish();
rollback;
