-- Demandes, the audit's after-cutover items (migration *_demandes_audit_followups.sql): a client
-- file's requests (hers and as a participant), the inbox's sort, the default service and the next
-- free slots' guards.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('list_client_demandes', 'demande_next_slots', 'list_demandes')
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the RPCs: SECURITY DEFINER, authenticated, not anon');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'list_demandes'), 1,
  'list_demandes has one signature (the sort added, the old one dropped)');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'demandes_default_service'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the default service helper: no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@af.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@af.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@af.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true
  from (values ('professionals'), ('services'), ('clients'), ('appointments'), ('demandes')) y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Psy', 'p1@af.test', 'active');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'L-1', true
  from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue';
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Fiche'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Fiche'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Ailleurs');

-- R1: Alice's (oldest, new); R2: Bruno's with Alice as a participant (matched to Hélène); R3: Chloé's (closed).
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_name, received_at, client_id, state,
                             closed_reason, closed_at, matched_professional_id, matched_at, beneficiary)
values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0001', 2026, 1, 'R1', now() - interval '10 days',
   'd0000000-0000-0000-0000-000000000001', 'new', null, null, null, null, 'self'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0002', 2026, 2, 'R2', now() - interval '5 days',
   'd0000000-0000-0000-0000-000000000002', 'matched', null, null, 'c0000000-0000-0000-0000-000000000001', now() - interval '1 day', 'couple'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-0003', 2026, 3, 'R3', now() - interval '1 day',
   'd0000000-0000-0000-0000-000000000003', 'closed', 'withdrew', now(), null, null, 'self');
insert into public.demande_participants (demande_id, org_id, client_id, relationship, is_primary) values
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'self', true),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'partner', false);

-- The default service: the 50-minute session; a couple's service for a couple when she has one.
select is((select s.code from public.services s where s.id = private.demandes_default_service('b0000000-0000-0000-0000-00000000000a',
             'c0000000-0000-0000-0000-000000000001', false)), 10150, 'not a couple: the 50-minute session');
select ok((select s.for_two or s.code = 10150 from public.services s where s.id = private.demandes_default_service('b0000000-0000-0000-0000-00000000000a',
             'c0000000-0000-0000-0000-000000000001', true)), 'a couple: a couple''s service when she has one, else the 50-minute session');
select is(private.demandes_default_service('b0000000-0000-0000-0000-00000000000a', gen_random_uuid(), false), null, 'no professional: none');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- A-1: Alice's requests: hers and Bruno's (as a participant), newest first; never Chloé's.
select results_eq($$ select r ->> 'reference', r ->> 'role', r ->> 'matched_professional_name'
                       from jsonb_array_elements(public.list_client_demandes('d0000000-0000-0000-0000-000000000001')) r $$,
  $$ values ('DEM-2026-0002', 'participant', 'Hélène Psy'), ('DEM-2026-0001', 'file', null) $$,
  'a file''s requests: as a participant and her own, newest first, with the matched professional');
select is(public.list_client_demandes('d0000000-0000-0000-0000-000000000003') -> 0 ->> 'closed_reason', 'withdrew', 'a closed one says why');
select is(public.list_client_demandes(gen_random_uuid()), '[]'::jsonb, 'no request: an empty list');

-- A-4: the sorts.
select results_eq($$ select reference from public.list_demandes('all', 'any', '{}', null, 0, 50, 'received_asc') $$,
  $$ values ('DEM-2026-0001'), ('DEM-2026-0002'), ('DEM-2026-0003') $$, 'received, oldest first');
select results_eq($$ select reference from public.list_demandes('all', 'any', '{}', null, 0, 50, 'received_desc') $$,
  $$ values ('DEM-2026-0003'), ('DEM-2026-0002'), ('DEM-2026-0001') $$, 'received, newest first');
select results_eq($$ select reference from public.list_demandes('all', 'any', '{}', null, 0, 50, 'state') $$,
  $$ values ('DEM-2026-0001'), ('DEM-2026-0002'), ('DEM-2026-0003') $$, 'by state: new, matched, closed');
select results_eq($$ select reference from public.list_demandes('all') $$,
  $$ values ('DEM-2026-0003'), ('DEM-2026-0002'), ('DEM-2026-0001') $$, 'without a sort: as before (the newest first outside the open view)');
select throws_ok($$ select * from public.list_demandes('all', 'any', '{}', null, 0, 50, 'name') $$, '22023', null, 'an unknown sort');

-- A-7: the guards.
select throws_ok($$ select public.demande_next_slots(gen_random_uuid()) $$, 'P0001', null, 'an unknown request');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.list_client_demandes('d0000000-0000-0000-0000-000000000001') $$, '42501', null, 'a provider reads none');
reset role;

select * from finish();
rollback;
