-- Professionnels: profession_titles_catalog (migration *_professionals_titles_catalog.sql, plan
-- S3.1). Covers: privileges, security invoker, active rows only, the columns Services et tarifs
-- reads, the table's RLS (a provider reads her clinic's titles, nothing of another clinic).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select table_privs_are('public', 'profession_titles_catalog', 'anon', array[]::text[], 'anon: nothing');
select table_privs_are('public', 'profession_titles_catalog', 'authenticated', array['SELECT'], 'authenticated: select');
select ok((select coalesce('security_invoker=true' = any (c.reloptions), false) from pg_class c where c.oid = 'public.profession_titles_catalog'::regclass),
  'the view runs as the caller');
select columns_are('public', 'profession_titles_catalog',
  array['id', 'org_id', 'key', 'name', 'name_feminine', 'name_masculine', 'category_id', 'order_id', 'sort_order'], 'the published columns');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
update public.profession_titles set is_active = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'nutritionniste';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.profession_titles_catalog), 8, 'the provider reads the 8 active titles of her clinic (professionals.self)');
select is_empty($$ select 1 from public.profession_titles_catalog where key = 'nutritionniste' $$, '… an archived title is not listed');
select is_empty($$ select 1 from public.profession_titles_catalog where org_id = 'b0000000-0000-0000-0000-00000000000b' $$, '… nothing of another clinic');
select results_eq($$ select key, name from public.profession_titles_catalog order by sort_order limit 1 $$,
  $$ values ('psychologue'::text, 'Psychologue'::text) $$, '… keys and names, in the settings order');

select * from finish();
rollback;
