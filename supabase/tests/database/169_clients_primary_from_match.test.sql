-- Clients (migration *_clients_primary_from_match.sql, A-6): the files without a primary
-- professional get one; a file that has one keeps it; merged and other clinics' files are left
-- alone. Granted to no role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'clients_fill_primary_professional'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the helper is granted to no role');

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Un', 'p1@pm.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro', 'Deux', 'p2@pm.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, primary_professional_id) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Sans', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Avec', 'c0000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Gardée', null),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Denis', 'Ailleurs', null);
-- Émile merged into Chloé (a merged file is archived).
insert into public.clients (id, org_id, first_name, last_name, merged_into_id, archived_at) values
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Émile', 'Fusionné', 'd0000000-0000-0000-0000-000000000003', now());

select is(private.clients_fill_primary_professional('b0000000-0000-0000-0000-00000000000a',
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004',
        'd0000000-0000-0000-0000-000000000005']::uuid[], 'c0000000-0000-0000-0000-000000000001'), 1,
  'one file changed: Alice');
select results_eq($$ select id, primary_professional_id from public.clients
                      where id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002') order by id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid),
            ('d0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid) $$,
  'a file without a primary professional gets her; one with a primary keeps it');
select is((select primary_professional_id from public.clients where id = 'd0000000-0000-0000-0000-000000000004'), null,
  'another clinic''s file is left alone');
select is((select primary_professional_id from public.clients where id = 'd0000000-0000-0000-0000-000000000005'), null,
  'a merged file is left alone');
select is(private.clients_fill_primary_professional('b0000000-0000-0000-0000-00000000000a', '{}', 'c0000000-0000-0000-0000-000000000001'), 0,
  'no file: nothing');

select * from finish();
rollback;
