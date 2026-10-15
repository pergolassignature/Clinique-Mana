-- « Dossiers existants » in « Nouvelle demande » (migration *_demandes_intake_matches.sql, D-55).
-- Covers: privileges (definer, authenticated only); demandes.manage and clients.view first (the
-- professional refused); the files (Clients' rule) with only what the panel shows; each file's
-- open requests (its own, or as a participant; never matched or closed ones); the other open
-- requests with the same typed contact; nothing for another clinic; nothing typed → nothing;
-- « Utiliser ce dossier »: create_demande with client_id, one transaction, the file of the clinic
-- only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select function_privs_are('public', 'find_demande_matches', array['text', 'text', 'text', 'text'], 'anon', array[]::text[], 'not anon');
select ok((select p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'find_demande_matches'),
  'definer, for authenticated');

-- =============================================================================
-- Fixtures (as postgres): org A (a counselor, a professional), org B (an admin).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@dim.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@dim.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'u2@dim.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u3@dim.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled)
select o.id, m.key, true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) o(id)
 cross join (values ('professionals'), ('clients'), ('demandes')) m(key);
insert into public.clients (id, org_id, client_number, first_name, last_name, email, mobile_e164, birthday) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 9101, 'Virginie', 'Tremblay', 'virginie@dim.test', '+15145550101', '1985-03-02'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 9102, 'Léo', 'Gagnon', null, null, '2015-01-01'),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 9109, 'Virginie', 'Tremblay', 'virginie@dim.test', '+15145550101', null);
-- Virginie's open request (DEM-…-1), a closed one; Léo is a participant of an open request (2);
-- an open request without a file, typed with the same phone (3); a matched one with it (4).
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, client_id, contact_email, received_at, state, closed_reason, closed_at) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9201', 2026, 9201,
   'd0000000-0000-0000-0000-000000000001', 'virginie@dim.test', now() - interval '2 days', 'new', null, null),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9205', 2026, 9205,
   'd0000000-0000-0000-0000-000000000001', null, now() - interval '40 days', 'closed', 'withdrew', now() - interval '30 days');
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_first_name, received_at, state) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9202', 2026, 9202, 'Maman', now() - interval '1 day', 'accepted');
insert into public.demande_participants (demande_id, org_id, client_id, relationship, is_primary) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'child', true);
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_first_name, contact_phone_e164, received_at, state) values
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9203', 2026, 9203, 'Inconnue', '+15145550199', now(), 'new');
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@dim.test', 'active');
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_first_name, contact_phone_e164, received_at, state, matched_professional_id, matched_at) values
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-9204', 2026, 9204, 'Jumelée', '+15145550199', now(), 'matched',
   'c0000000-0000-0000-0000-000000000001', now());

-- =============================================================================
-- Permissions
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.find_demande_matches('Virginie', 'Tremblay', null, null) $$, '42501', null,
  'the professional (no demandes.manage) is refused');

-- =============================================================================
-- The counselor
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.find_demande_matches(null, null, null, null), '{"clients": [], "open_demandes": []}'::jsonb, 'nothing typed: nothing');
select is(public.find_demande_matches('Personne', 'Inconnue', '+15145550000', 'personne@dim.test'),
  '{"clients": [], "open_demandes": []}'::jsonb, 'no match: nothing');
select set_config('test.m', public.find_demande_matches('Virginie', 'Tremblay', '+15145550101', null)::text, true);
select is(jsonb_array_length(current_setting('test.m')::jsonb -> 'clients'), 1, 'her file only (never another clinic''s)');
select is(current_setting('test.m')::jsonb -> 'clients' -> 0,
  '{"client_id": "d0000000-0000-0000-0000-000000000001", "client_number": 9101, "display_name": "Virginie Tremblay", "birth_year": 1985,
    "is_archived": false, "matched_on": ["phone", "name"], "phone_hint": "0101", "email_hint": null,
    "open_demandes": [{"id": "e0000000-0000-0000-0000-000000000001", "reference": "DEM-2026-9201"}]}'::jsonb,
  'the file: number, name, birth year, what matched, the hint, its open request (never the closed one); nothing else');
select is((public.find_demande_matches('Léo', 'Gagnon', null, null) -> 'clients' -> 0 -> 'open_demandes'),
  '[{"id": "e0000000-0000-0000-0000-000000000002", "reference": "DEM-2026-9202"}]'::jsonb,
  'a file''s open request as a participant');
select is((public.find_demande_matches(null, null, '514 555-0199', null) -> 'open_demandes'),
  '[{"id": "e0000000-0000-0000-0000-000000000003", "reference": "DEM-2026-9203"}]'::jsonb,
  'an open request typed with the same phone (never a matched one), without a file');
select is((public.find_demande_matches(null, null, null, 'VIRGINIE@dim.test') -> 'open_demandes'), '[]'::jsonb,
  'a request already listed under its file is not repeated');

-- « Utiliser ce dossier »: the request is made already attached, in one call.
select set_config('test.d', public.create_demande(jsonb_build_object(
  'client_id', 'd0000000-0000-0000-0000-000000000001', 'contact_first_name', 'Virginie', 'contact_phone_e164', '+15145550101'))::text, true);
select is((public.get_demande(current_setting('test.d')::uuid) -> 'client' ->> 'client_number')::int, 9101, 'created with its file');
select is((public.find_demande_matches(null, null, '5145550101', null) -> 'clients' -> 0 -> 'open_demandes' -> 0 ->> 'id'),
  current_setting('test.d'), 'the newest open request first');
select throws_ok($$ select public.create_demande(jsonb_build_object('client_id', 'd0000000-0000-0000-0000-000000000009', 'contact_first_name', 'X')) $$,
  '23503', null, 'another clinic''s file is refused (nothing is created)');
select is((select count(*)::int from public.demandes where contact_first_name = 'X'), 0, '… and no request was made');

-- Org B's admin sees her own clinic only.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((public.find_demande_matches(null, null, '5145550101', null) -> 'clients' -> 0 ->> 'client_number')::int, 9109, 'another clinic: its own file');
reset role;

select * from finish();
rollback;
