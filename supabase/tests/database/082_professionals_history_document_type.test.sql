-- Professionnels: every document row of the history names its type (migration
-- *_professionals_history_document_type.sql). Covers: the signature unchanged; an update whose
-- upload row is not on the page carries document_type_id and document_type_name; the insert keeps
-- its own document_type_id; a deleted document's update still names its type (from its audited
-- insert); another table's rows are untouched; another clinic's type never leaks.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01), org B (admin 02); P1 in org A.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u2@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);
insert into public.professionals (id, org_id, first_name, last_name, email) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Geneviève', 'Tremblay', 'gt@exemple.test');

insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
select f.id, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/' || f.id || '.png',
       'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001',
       'photo.png', 'image/png', 'png', 2048, repeat('a', 64), 'ready', 'professionals.view',
       'a0000000-0000-0000-0000-000000000001', now()
  from (values ('e0000000-0000-0000-0000-000000000001'::uuid), ('e0000000-0000-0000-0000-000000000002')) f(id);

-- D1 (kept) and D2 (deleted later): two photos, each uploaded, then verified.
insert into public.professional_documents (id, org_id, professional_id, document_type_id, stored_file_id)
select d.id, 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, d.file
  from (values ('d0000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid),
               ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002')) d(id, file)
  join public.document_types t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'photo';
update public.professional_documents
   set status = 'verified', reviewed_by = 'a0000000-0000-0000-0000-000000000001', reviewed_at = now()
 where professional_id = 'c0000000-0000-0000-0000-000000000001';
delete from public.professional_documents where id = 'd0000000-0000-0000-0000-000000000002';
update public.professionals set last_name = 'Tremblay-Roy' where id = 'c0000000-0000-0000-0000-000000000001';

create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', pg_catalog.json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

select set_config('test.photo', (select id::text from public.document_types
                                  where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'photo'), true);
select set_config('test.photo_name', (select name from public.document_types
                                       where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'photo'), true);
-- The audit ids: D1's verification, D2's verification and D2's deletion.
select set_config('test.d1_update', (select max(id)::text from public.audit_log
                                      where table_name = 'professional_documents' and action = 'update'
                                        and record_id like '%:d0000000-0000-0000-0000-000000000001'), true);
select set_config('test.d2_delete', (select max(id)::text from public.audit_log
                                      where table_name = 'professional_documents' and action = 'delete'), true);

-- =============================================================================
-- Shape (as postgres)
-- =============================================================================
select is(pg_catalog.pg_get_function_result('public.list_professional_history(uuid, bigint, integer)'::regprocedure),
  'TABLE(id bigint, created_at timestamp with time zone, table_name text, record_id text, action text, changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text)',
  'the signature is unchanged');

-- =============================================================================
-- The admin of org A
-- =============================================================================
set local role authenticated;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');

-- D1's verification alone (one row, right after it): its upload row is not on the page.
select is((select h.changed_fields ->> 'document_type_id'
             from public.list_professional_history('c0000000-0000-0000-0000-000000000001', current_setting('test.d1_update')::bigint + 1, 1) h),
  current_setting('test.photo'), 'an update alone on its page carries its document type id');
select is((select h.changed_fields ->> 'document_type_name'
             from public.list_professional_history('c0000000-0000-0000-0000-000000000001', current_setting('test.d1_update')::bigint + 1, 1) h),
  current_setting('test.photo_name'), 'and its name');
select ok((select h.changed_fields ? 'status'
             from public.list_professional_history('c0000000-0000-0000-0000-000000000001', current_setting('test.d1_update')::bigint + 1, 1) h),
  'the change itself is kept');

-- D2's verification, D2 deleted since: the type comes from its audited insert.
select is((select h.changed_fields ->> 'document_type_name'
             from public.list_professional_history('c0000000-0000-0000-0000-000000000001', current_setting('test.d2_delete')::bigint, 1) h),
  current_setting('test.photo_name'), 'a deleted document''s update still names its type');

-- Every document row names its type; the insert keeps its own id.
select is((select count(*)::int from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
            where h.table_name = 'professional_documents'
              and (h.changed_fields ->> 'document_type_name') is distinct from current_setting('test.photo_name')),
  0, 'every document row (insert, update, delete) names its type');
select is((select count(*)::int from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
            where h.table_name = 'professional_documents' and h.action = 'insert'
              and h.changed_fields ->> 'document_type_id' = current_setting('test.photo')),
  2, 'the inserts keep their document_type_id');

-- Another table's rows are untouched.
select is((select count(*)::int from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
            where h.table_name <> 'professional_documents' and h.changed_fields ? 'document_type_name'),
  0, 'no other table gains a document type');

-- =============================================================================
-- Another clinic
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) $$,
  'another clinic reads nothing of the file');

select * from finish();
rollback;
