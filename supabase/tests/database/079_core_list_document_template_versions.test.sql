-- Core: a template's versions through an RPC (migration *_core_list_document_template_versions.sql),
-- so a module never reads document_template_versions itself (CLAUDE.md §5).
-- Covers: privileges (authenticated only, security definer); the columns answered, newest first;
-- the template's view permission first (the provider 42501, a disabled module 42501); another
-- clinic's template and an unknown id answer the same 22023.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'list_document_template_versions', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may list a template''s versions');
select function_privs_are('public', 'list_document_template_versions', array['uuid'], 'anon', array[]::text[],
  'anon may not');
select function_privs_are('public', 'list_document_template_versions', array['uuid'], 'service_role', array[]::text[],
  'the service role may not (user-scoped)');
select is_definer('public', 'list_document_template_versions', array['uuid'], 'security definer, the permission checked first');

-- =============================================================================
-- Fixtures (as postgres): org A (admin, provider), org B (admin), Professionnels on in both: the
-- service contract template is seeded per clinic (draft v1). A second version is published in A.
-- =============================================================================
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
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

select set_config('test.tpl', (select t.id::text from public.document_templates t
                                where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.service_contract'), true);
select set_config('test.v1', (select v.id::text from public.document_template_versions v
                               where v.template_id = current_setting('test.tpl')::uuid and v.version = 1), true);
-- v1 published as is (any status will do: the read lists them all), then a draft v2.
update public.document_template_versions set status = 'published', published_at = now()
 where id = current_setting('test.v1')::uuid;
insert into public.document_template_versions (template_id, org_id, version, email_subject)
values (current_setting('test.tpl')::uuid, 'b0000000-0000-0000-0000-00000000000a', 2, 'Objet v2');

-- =============================================================================
-- Admin A: every version, newest first, the columns the editor reads
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select version, status, email_subject from public.list_document_template_versions(current_setting('test.tpl')::uuid) $$,
  $$ values (2, 'draft'::text, 'Objet v2'::text),
            (1, 'published'::text, (select v.email_subject from public.document_template_versions v where v.id = current_setting('test.v1')::uuid)) $$,
  'the admin reads every version, newest first');
select is(
  (select pg_catalog.array_agg(c order by o)
     from unnest((select p.proargnames from pg_proc p where p.oid = 'public.list_document_template_versions(uuid)'::regprocedure)) with ordinality x(c, o)
    where o > 1),
  array['id', 'version', 'status', 'body', 'variables', 'signers', 'email_subject', 'email_message',
        'created_at', 'updated_at', 'published_at', 'archived_at'],
  'only the columns the editor needs (no actor ids, no org)');
select throws_ok($$ select * from public.list_document_template_versions(gen_random_uuid()) $$,
  '22023', 'Unknown template', 'an unknown template');
reset role;

-- =============================================================================
-- The provider (no professionals.view), another clinic, a disabled module
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_document_template_versions(current_setting('test.tpl')::uuid) $$,
  '42501', null, 'the provider may not read the versions');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_document_template_versions(current_setting('test.tpl')::uuid) $$,
  '22023', 'Unknown template', 'another clinic''s template reads as unknown');
reset role;

update public.org_modules set enabled = false
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_document_template_versions(current_setting('test.tpl')::uuid) $$,
  '42501', null, 'a disabled module: its template''s versions are refused');
reset role;

select * from finish();
rollback;
