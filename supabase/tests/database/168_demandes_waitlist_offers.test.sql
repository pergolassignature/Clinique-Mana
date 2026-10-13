-- Demandes, batch D4 part 2 (migration *_demandes_waitlist_offers.sql): the compatible registrants of
-- a professional (her list and her professions', « Active » or « À rappeler », no proposal pending,
-- her hard filters with the entry's criteria) in list order; « Place disponible » from the nightly
-- photo; the next one after a declined proposal; permissions. Professionnels' facts are a fixture.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'list_waitlist_compatible'
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the RPC: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'demandes_waitlist_compatible'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helper is granted to no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@wo.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@wo.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@wo.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('clients'), ('professionals'), ('demandes')) y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Psy', 'p1@wo.test', 'active');
select set_config('test.title', (select id::text from public.profession_titles where org_id = 'b0000000-0000-0000-0000-00000000000a' and is_active order by key limit 1), true);

-- P1: active, ready, French, adults, the title; 2 places now.
create table private.test_facts as
select 'c0000000-0000-0000-0000-000000000001'::uuid as professional_id, 'active'::text as status, true as ready, true as accepting_new_clients,
       array['evening']::text[] as availability_periods, null::smallint as min_client_age, false as women_only, 'female'::text as gender,
       'Hélène Psy'::text as display_name, 'Psychologue'::text as primary_title_label, array[current_setting('test.title')::uuid] as title_ids,
       array['fr']::text[] as language_codes,
       jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'key', 'adults', 'name', 'Adultes', 'specialized', false, 'min_age', 18, 'max_age', null)) as clienteles,
       '{}'::uuid[] as motif_ids, '{}'::uuid[] as refused_motif_ids, 'valid'::text as insurance_status,
       2::smallint as new_client_places, now() - interval '30 days' as new_client_places_set_at,
       null::text as matching_note, null::text as matching_priority_reason, now() as updated_at;
create or replace function private.professional_matching_facts(p_org uuid, p_ids uuid[] default null)
returns table (
  professional_id uuid, status text, ready boolean, accepting_new_clients boolean, availability_periods text[],
  min_client_age smallint, women_only boolean, gender text, display_name text, primary_title_label text,
  title_ids uuid[], language_codes text[], clienteles jsonb, motif_ids uuid[], refused_motif_ids uuid[],
  insurance_status text, new_client_places smallint, new_client_places_set_at timestamptz, matching_note text,
  matching_priority_reason text, updated_at timestamptz)
language sql stable set search_path = '' as $$
  select f.* from private.test_facts f
   where p_org = 'b0000000-0000-0000-0000-00000000000a' and (p_ids is null or f.professional_id = any (p_ids))
$$;

-- Four requests on the list: Léa (her profession's list, older), Marc (her own list, « Prioritaire »),
-- Noah (English only), Zoé (incomplete).
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_name, state)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'DEM-2026-80' || lpad(n::text, 2, '0'), 2026, 8000 + n,
       (array['Léa', 'Marc', 'Noah', 'Zoé'])[n], 'waitlist'
  from generate_series(1, 4) n;
insert into public.waitlist_entries (org_id, demande_id, target_profession_title_id, target_professional_id, priority, priority_reason,
                                     registered_at, language, state, fee_status, fee_waived_reason)
values
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000001', current_setting('test.title')::uuid, null, 'normal', null,
   now() - interval '60 days', 'fr', 'active', 'waived', 'Test'),
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000002', null, 'c0000000-0000-0000-0000-000000000001', 'priority', 'Urgent',
   now() - interval '10 days', 'fr', 'to_call', 'waived', 'Test'),
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000003', null, 'c0000000-0000-0000-0000-000000000001', 'normal', null,
   now() - interval '90 days', 'en', 'active', 'waived', 'Test'),
  ('b0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-000000000004', null, 'c0000000-0000-0000-0000-000000000001', 'normal', null,
   now() - interval '5 days', 'fr', 'incomplete', 'to_invoice', null);

select results_eq($$ select demande_id, target_kind from private.demandes_waitlist_compatible('b0000000-0000-0000-0000-00000000000a',
                       'c0000000-0000-0000-0000-000000000001') order by sort_key $$,
  $$ values ('e0000000-0000-0000-0000-000000000002'::uuid, 'professional'), ('e0000000-0000-0000-0000-000000000001'::uuid, 'title') $$,
  'compatible, in list order: « Prioritaire » first, then the oldest; never English-only Noah, never incomplete Zoé');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r ->> 'person_name', (r ->> 'order')::int, r ->> 'priority'
                       from jsonb_array_elements(public.list_waitlist_compatible('c0000000-0000-0000-0000-000000000001')) r $$,
  $$ values ('Marc', 1, 'priority'), ('Léa', 2, 'normal') $$, 'the list, as the counselor reads it');
select throws_ok($$ select public.list_waitlist_compatible(gen_random_uuid()) $$, 'P0001', null, 'an unknown professional');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.list_waitlist_compatible('c0000000-0000-0000-0000-000000000001') $$, '42501', null, 'a provider reads none');
reset role;

-- A proposal pending for Marc: he is out of the offers until it ends.
insert into public.demande_propositions (id, demande_id, org_id, professional_id, response, expires_at)
values ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a',
        'c0000000-0000-0000-0000-000000000001', 'pending', now() + interval '48 hours');
select results_eq($$ select demande_id from private.demandes_waitlist_compatible('b0000000-0000-0000-0000-00000000000a',
                       'c0000000-0000-0000-0000-000000000001') $$,
  $$ values ('e0000000-0000-0000-0000-000000000001'::uuid) $$, 'a proposal pending: not offered twice');

-- Marc declines: Léa is next (« Plage à offrir au suivant »).
select ok(private.demandes_end_proposition('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'declined', 'declined', null),
  'the proposal ends, declined');
select results_eq($$ select kind, link_path, recipient_permission from public.notifications where kind = 'demandes.waitlist_offer_next' $$,
  $$ values ('demandes.waitlist_offer_next', '/liste-attente?liste=p-c0000000-0000-0000-0000-000000000001', 'demandes.waitlist') $$,
  'the next one is to be offered: one notice to the waiting list''s counselors');

-- « Place disponible »: yesterday she was full; tonight she has 2 places and people wait.
insert into public.capacity_snapshots (org_id, professional_id, snapshot_on, places_declared, places_used, places_left, accepting_new_clients)
values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', private.clinic_today_for_org('b0000000-0000-0000-0000-00000000000a') - 1, 2, 2, 0, true);
select is(private.demandes_capacity_snapshot('b0000000-0000-0000-0000-00000000000a'), 1, 'tonight''s photo');
select results_eq($$ select kind, subject_type, dedupe_key from public.notifications where kind = 'demandes.waitlist_slot_available' $$,
  $$ values ('demandes.waitlist_slot_available', 'professional',
             'slot:c0000000-0000-0000-0000-000000000001:' || private.clinic_today_for_org('b0000000-0000-0000-0000-00000000000a')::text) $$,
  '« Place disponible »: a place opened since yesterday and someone compatible waits');
select private.demandes_capacity_snapshot('b0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.notifications where kind = 'demandes.waitlist_slot_available'), 1, 'a rerun the same day: once');

-- Still full tonight: no notice.
update public.notifications set dedupe_key = 'old' where kind = 'demandes.waitlist_slot_available';
update private.test_facts set new_client_places = 0;
update public.capacity_snapshots set places_left = 0 where snapshot_on < private.clinic_today_for_org('b0000000-0000-0000-0000-00000000000a');
select private.demandes_capacity_snapshot('b0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.notifications where kind = 'demandes.waitlist_slot_available'), 1, 'no place: no new notice');

select * from finish();
rollback;
