-- Clients: the consents' names for the other modules (migration *_clients_consent_names.sql, AP-32).
-- Covers: no role executes it; the clinic's 7 consents with their French and English names, never
-- another clinic's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select function_privs_are('private', 'clients_consent_names', array['uuid'], r.role, array[]::text[], 'clients_consent_names: not ' || r.role)
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role);

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
update public.client_consent_types set name_fr = 'Général B' where org_id = 'b0000000-0000-0000-0000-00000000000b' and key = 'general';

select is((select count(*)::int from private.clients_consent_names('b0000000-0000-0000-0000-00000000000a')), 7, 'the clinic''s 7 consents');
select results_eq($$ select name_fr, name_en from private.clients_consent_names('b0000000-0000-0000-0000-00000000000a') where key = 'general' $$,
  $$ values ('Consentement général'::text, 'General consent'::text) $$, '… in French and English, its own (not another clinic''s)');

select * from finish();
rollback;
