-- Core: a module applies its retention policy to the files it keeps (migration
-- *_core_stored_files_retention.sql, Clients C5b, CC-17). Covers: no role executes the helper; it
-- sets and clears the purge date of the clinic's ready files of the named purposes only, writes
-- only rows that differ, never a pending, deleted or purged file, another purpose's or another
-- clinic's; a file whose date has passed is then listed by list_files_to_purge; no purposes → 22023.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select function_privs_are('private', 'set_stored_files_retention', array['uuid', 'text[]', 'uuid[]', 'timestamp with time zone'],
                          r.role, array[]::text[], 'set_stored_files_retention: no EXECUTE for ' || r.role)
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role);

insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');

insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, confirmed_at, deleted_at, retain_until)
select f.id, f.org, case f.purpose when 'signing_signed' then 'signed-documents' when 'signing_source' then 'documents' else 'org-assets' end, f.org || '/core/c0000000-0000-0000-0000-000000000001/' || f.id || '.pdf', 'core', f.purpose, 'signature_request',
       'c0000000-0000-0000-0000-000000000001', 'doc.pdf', 'application/pdf', 'pdf', 2048, repeat('a', 64), f.status,
       'clients.view', now(), case when f.status = 'deleted' then now() end, f.retain
  from (values
    -- 1, 2: signed and source copies of A, kept forever; 3: deleted; 4: purged; 5: another purpose;
    -- 6: org B's; 7: A's, already with the date given below.
    ('e1000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'signing_signed', 'ready', null::timestamptz),
    ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'signing_source', 'ready', null),
    ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'signing_signed', 'deleted', null),
    ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'signing_signed', 'purged', null),
    ('e1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'org_logo', 'ready', null),
    ('e1000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'signing_signed', 'ready', null),
    ('e1000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'signing_signed', 'ready', '2020-01-01T00:00:00Z')
  ) as f(id, org, purpose, status, retain);

create temporary table ids as
select array_agg(f.id order by f.id) as all_ids from public.stored_files f where f.id::text like 'e1000000-%';

select is(private.set_stored_files_retention('b0000000-0000-0000-0000-00000000000a', array['signing_signed', 'signing_source'],
                                             (select all_ids from ids), '2020-01-01T00:00:00Z'),
  2, 'the clinic''s ready files of the named purposes get the date (the one that has it already is not written)');
select results_eq($$ select f.id::text || ' ' || coalesce(f.retain_until::date::text, 'forever')
                       from public.stored_files f where f.id::text like 'e1000000-%' order by f.id $$,
  array['e1000000-0000-0000-0000-000000000001 2020-01-01', 'e1000000-0000-0000-0000-000000000002 2020-01-01',
        'e1000000-0000-0000-0000-000000000003 forever', 'e1000000-0000-0000-0000-000000000004 forever',
        'e1000000-0000-0000-0000-000000000005 forever', 'e1000000-0000-0000-0000-000000000006 forever',
        'e1000000-0000-0000-0000-000000000007 2020-01-01'],
  '… never a deleted or purged file, another purpose''s or another clinic''s');
select ok((select array_agg(p.id order by p.id) from public.list_files_to_purge('b0000000-0000-0000-0000-00000000000a') p)
          @> array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002',
                   'e1000000-0000-0000-0000-000000000007']::uuid[],
  'a ready file past its date is listed for the purge');
select is((select count(*)::int from public.audit_log a where a.table_name = 'stored_files' and a.action = 'update'), 2,
  'each change is audited');

select is(private.set_stored_files_retention('b0000000-0000-0000-0000-00000000000a', array['signing_signed'],
                                             array['e1000000-0000-0000-0000-000000000001']::uuid[], '2031-06-01T00:00:00Z'),
  1, 'a date can be moved, later or earlier');
select is(private.set_stored_files_retention('b0000000-0000-0000-0000-00000000000a', array['signing_signed', 'signing_source'],
                                             (select all_ids from ids), null),
  3, 'null clears the date: kept forever');
select is((select count(*)::int from public.stored_files f where f.id::text like 'e1000000-%' and f.retain_until is not null), 0,
  '… on every file it had touched');
select throws_ok($$ select private.set_stored_files_retention('b0000000-0000-0000-0000-00000000000a', array[]::text[],
                                                            array['e1000000-0000-0000-0000-000000000001']::uuid[], null) $$,
  '22023', null, 'the purposes are required');

select * from finish();
rollback;
