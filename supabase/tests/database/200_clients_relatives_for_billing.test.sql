-- Clients, R-78 (migration *_clients_relatives_for_billing): a file's relatives, published for
-- Facturation's file-opening rule.
-- Covers: granted to no role; both sides of a relation, whatever its type; a file without
-- relation; another clinic's org gives nothing; a removed relation is gone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select function_privs_are('private', 'client_relative_ids', array['uuid', 'uuid'], 'authenticated', array[]::text[],
  'client_relative_ids: not for users');
select function_privs_are('private', 'client_relative_ids', array['uuid', 'uuid'], 'service_role', array[]::text[],
  'client_relative_ids: not for the service role (definer callers only)');

insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.org_modules (org_id, module_key, enabled)
select o, 'clients', true
  from (values ('b0000000-0000-0000-0000-00000000000a'::uuid), ('b0000000-0000-0000-0000-00000000000b'::uuid)) as x(o);
insert into public.clients (id, org_id, first_name, last_name) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Essai'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Essai'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Noé', 'Essai'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Autre');
-- Léa – Marc spouses; Noé is Léa's child (stored with Léa on side a, as the trigger orders it).
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'spouse', 'spouse'),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003', 'parent', 'child');

select results_eq($$ select x from private.client_relative_ids('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001') x order by x $$,
  $$ values ('d0000000-0000-0000-0000-000000000002'::uuid), ('d0000000-0000-0000-0000-000000000003'::uuid) $$,
  'Léa: her spouse and her child');
select results_eq($$ select x from private.client_relative_ids('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003') x $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid) $$,
  'Noé: his parent, from the other side of the pair');
select is_empty($$ select x from private.client_relative_ids('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004') x $$,
  'Zoé, without relation: none');
select is_empty($$ select x from private.client_relative_ids('b0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000001') x $$,
  'another clinic: none');

delete from public.client_relations r where r.client_b_id = 'd0000000-0000-0000-0000-000000000002';
select results_eq($$ select x from private.client_relative_ids('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001') x $$,
  $$ values ('d0000000-0000-0000-0000-000000000003'::uuid) $$,
  'a removed relation no longer counts');

select * from finish();
rollback;
