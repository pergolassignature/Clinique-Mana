-- Clients: the list page's read (migration *_clients_list.sql, plan C3.2). Covers: privileges;
-- clients.view first; the clinic only; active / archived / all; merged and anonymised files never;
-- the search words (name with accents folded, email, number, phone digits); the primary
-- professional and tag filters; the keyset pages in name order, case and accents ignored.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select function_privs_are('public', 'list_clients', array['text', 'text', 'uuid', 'uuid', 'text', 'text', 'uuid', 'integer'], 'anon', array[]::text[], 'anon cannot call it');
select function_privs_are('public', 'list_clients', array['text', 'text', 'uuid', 'uuid', 'text', 'text', 'uuid', 'integer'], 'authenticated', array['EXECUTE'], 'authenticated may call it');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'pro1@a.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, email, mobile_e164, primary_professional_id, archived_at) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Émile', 'Bérubé', 'emile@exemple.test', '+15145550101', 'c0000000-0000-0000-0000-000000000001', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Anne', 'berube', null, null, null, null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Côté', 'zoe@exemple.test', null, null, null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Luc', 'Archivé', null, null, null, now()),
  ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'Autre', 'Clinique', null, null, null, null);
insert into public.clients (id, org_id, first_name, last_name, archived_at, merged_into_id, anonymized_at) values
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Fusion', 'Berube', now(), 'd0000000-0000-0000-0000-000000000001', null),
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Client', 'anonymisé n° 6', now(), null, now());
insert into public.client_tags (id, org_id, name) values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Atelier');
insert into public.client_tag_links (client_id, tag_id, org_id) values
  ('d0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select first_name from public.list_clients() $$, array['Anne', 'Émile', 'Zoé'],
  'active files of the clinic, by last then first name, case and accents ignored');
select results_eq($$ select first_name from public.list_clients(p_status => 'archived') $$, array['Luc'], 'archived');
select is((select count(*)::int from public.list_clients(p_status => 'all')), 4, 'all: never merged or anonymised files');
select results_eq($$ select first_name from public.list_clients('berube emile') $$, array['Émile'], 'search: every word, accents ignored');
select results_eq($$ select first_name from public.list_clients('zoe@') $$, array['Zoé'], 'search: the email');
select results_eq($$ select first_name from public.list_clients('(514) 555') $$, array['Émile'], 'search: a typed phone''s digits');
select results_eq($$ select first_name from public.list_clients(p_professional_id => 'c0000000-0000-0000-0000-000000000001') $$, array['Émile'], 'filter: the primary professional');
select results_eq($$ select first_name, tag_ids from public.list_clients(p_tag_id => 'e0000000-0000-0000-0000-000000000001') $$,
  $$ values ('Zoé', array['e0000000-0000-0000-0000-000000000001'::uuid]) $$, 'filter: a tag, with the tags');
select results_eq($$ select first_name from public.list_clients(p_limit => 2) $$, array['Anne', 'Émile'], 'a page of two');
select results_eq($$ select first_name from public.list_clients(p_after_last => 'berube', p_after_first => 'emile', p_after_id => 'd0000000-0000-0000-0000-000000000001') $$,
  array['Zoé'], 'the next page after the cursor');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_clients() $$, '42501', 'Permission refusée : clients.view', 'a professional has no list of every client');
select throws_ok($$ select * from public.list_clients(p_status => 'nope') $$, '42501', null, '… even with a bad state (permission first)');

select * from finish();
rollback;
