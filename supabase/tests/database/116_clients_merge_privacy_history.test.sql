-- Clients, batch C4 (migration *_clients_merge_privacy_history.sql). Covers: privileges (the new
-- merge_clients(keep, merge, take), list_client_history; the private core, the take list and the partial
-- update granted to no role);
-- the merge with values chosen from the merged file, then C2's filling and moving; the two-argument
-- call; refusals; update_client still partial; the export's consents section and its log; the
-- history: the file's rows, a relation where it is the other side, the merge, newest first, the
-- keyset page, another clinic's file never, a professional refused.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select function_privs_are('public', 'merge_clients', array['uuid', 'uuid', 'text[]'], 'authenticated', array['EXECUTE'], 'merge_clients(keep, merge, take): authenticated');
select function_privs_are('public', 'merge_clients', array['uuid', 'uuid', 'text[]'], 'anon', array[]::text[], '… never anon');
select function_privs_are('public', 'list_client_history', array['uuid', 'bigint', 'integer'], 'authenticated', array['EXECUTE'], 'list_client_history: authenticated');
select function_privs_are('private', 'clients_merge_core', array['uuid', 'uuid'], 'authenticated', array[]::text[], 'the merge core: no role');
select function_privs_are('private', 'clients_apply_fields', array['uuid', 'uuid', 'jsonb'], 'authenticated', array[]::text[], 'the partial update: no role');
select hasnt_function('public', 'merge_clients', array['uuid', 'uuid'], 'the two-argument merge_clients is gone (the new one defaults its take)');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000a', 'demandes', true);
-- Referral sources: the provider gets demandes.view alone (an override), never clients.view.
insert into public.referral_sources (org_id, key, name, sort_order, is_active) values
  ('b0000000-0000-0000-0000-00000000000a', 'zz_test_active', 'Source active', 900, true),
  ('b0000000-0000-0000-0000-00000000000a', 'zz_test_retired', 'Source retirée', 901, false);
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'demandes.view', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.keep', public.create_client(jsonb_build_object('first_name', 'Alice', 'last_name', 'Tremblay', 'email', 'alice@exemple.test',
  'city', 'Montréal'))::text, true);
select set_config('test.merge', public.create_client(jsonb_build_object('first_name', 'Alicia', 'last_name', 'Tremblay', 'email', 'alicia@exemple.test',
  'birthday', '1990-03-04', 'mobile_e164', '5145550101'), true)::text, true);
select set_config('test.parent', public.create_client(jsonb_build_object('first_name', 'Marc', 'last_name', 'Tremblay'))::text, true);
select set_config('test.other', public.create_client(jsonb_build_object('first_name', 'Zoé', 'last_name', 'Roy'))::text, true);
-- A relation where the kept file is the other side, whatever the ids' order.
select public.set_client_relation(current_setting('test.parent')::uuid, current_setting('test.keep')::uuid, 'child', '{}', '{"main_contact": true}');

select throws_ok($$ select public.merge_clients(current_setting('test.keep')::uuid, current_setting('test.keep')::uuid, array[]::text[]) $$,
  'P0001', 'Choisissez deux dossiers différents.', 'the same file twice: refused');
select throws_ok($$ select public.merge_clients(current_setting('test.keep')::uuid, current_setting('test.merge')::uuid, array['is_banned']) $$,
  'P0001', 'Cette valeur ne peut pas être reprise de l''autre dossier.', 'only the listed values can be taken (never a flag)');
select lives_ok($$ select public.merge_clients(current_setting('test.keep')::uuid, current_setting('test.merge')::uuid, array['email']) $$,
  'merge with a value taken from the merged file (by key: the database copies it)');
reset role;
select results_eq(
  $$ select email, birthday, mobile_e164, city, first_name from public.clients where id = current_setting('test.keep')::uuid $$,
  $$ values ('alicia@exemple.test', date '1990-03-04', '+15145550101', 'Montréal', 'Alice') $$,
  '… the chosen email, the empty fields filled from the merged file, the kept ones kept');
select is((select merged_into_id from public.clients where id = current_setting('test.merge')::uuid), current_setting('test.keep')::uuid,
  '… the merged file points to the kept one');
select is((select count(*)::int from public.audit_log where table_name = 'clients' and record_id = current_setting('test.keep') and action = 'update'
             and changed_fields ? 'email'), 1, '… the taken email written once, audited');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.merge_clients(current_setting('test.keep')::uuid, current_setting('test.other')::uuid) $$,
  'the two-argument call still merges');
select lives_ok($$ select public.update_client(current_setting('test.keep')::uuid, '{"city": "Laval"}') $$, 'update_client still partial');
reset role;
select is((select email from public.clients where id = current_setting('test.keep')::uuid), 'alicia@exemple.test', '… the email kept');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- The export: the consents section, and the log says so.
select is(jsonb_typeof(public.export_client_privacy(current_setting('test.keep')::uuid) -> 'consents'), 'array', 'the export holds the consents');
reset role;
select ok((select changed_fields -> 'fields' ? 'consents' from public.audit_log
            where table_name = 'clients' and action = 'read' and record_id = current_setting('test.keep') order by id desc limit 1),
  '… and its read is logged with that section');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- The history.
select ok((select bool_and(h.prev_id is null or h.id < h.prev_id)
             from (select id, lag(id) over () as prev_id from public.list_client_history(current_setting('test.keep')::uuid)) h),
  'the history: newest first');
select ok((select array_agg(distinct table_name) from public.list_client_history(current_setting('test.keep')::uuid))
            @> array['clients', 'client_relations', 'client_merges'],
  '… the file, a relation where it is the other side, the merges');
select is((select count(*)::int from public.list_client_history(current_setting('test.keep')::uuid, p_limit => 2)), 2, '… a page of two');
select ok((select max(id) from public.list_client_history(current_setting('test.keep')::uuid,
             (select min(id) from public.list_client_history(current_setting('test.keep')::uuid, p_limit => 2))))
          < (select min(id) from public.list_client_history(current_setting('test.keep')::uuid, p_limit => 2)),
  '… the next page is older');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_client_history(current_setting('test.keep')::uuid)), 0, 'another clinic reads nothing of it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_client_history(current_setting('test.keep')::uuid) $$, '42501',
  'Permission refusée : clients.view', 'a professional has no history of the files');

-- The referral sources' catalogue (lane B, Demandes).
reset role;
select table_privs_are('public', 'referral_sources_catalog', 'authenticated', array['SELECT'], 'referral_sources_catalog: read only');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select name from public.referral_sources_catalog where name like 'Source %' $$, array['Source active'],
  'demandes.view alone reads the active sources, never a retired one');
select is((select count(*)::int from public.clients), 0, '… and still no client file');

select * from finish();
rollback;
