-- Professionnels: a file attached before the professional has an account becomes hers when the
-- account is linked (migration *_professionals_documents_owner_on_link.sql, gap audit V3, P4-503).
-- Covers: a document staff attached to a file without an account has no owner; accepting the
-- invitation makes every stored file of her documents hers (owner professionals.self), core's
-- signed consent included, never another professional's; she can then read them (stored_files
-- RLS, what storage-sign asks); the one-time repair of files already attached to linked files, idempotent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01), auth user 02 with P1's address and no profile yet,
-- provider 03 already linked to P2. P1 has two documents staff attached before any account
-- (e1: a module file, e2: core's signed copy); P2 one (e3, ownerless, as a file attached before
-- this migration's fix). e4: another professional's (P3), never re-owned.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1@exemple.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2@exemple.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Deux', 'p2@exemple.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test', 'draft'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'p2@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', null, 'Pat', 'Trois', 'p3@exemple.test', 'draft');
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';

insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
select f.id, 'b0000000-0000-0000-0000-00000000000a', case when f.module = 'core' then 'signed-documents' else 'documents' end,
       'b0000000-0000-0000-0000-00000000000a/' || f.module || '/' || f.subject || '/' || f.id || '.pdf',
       f.module, f.purpose, f.subject_type, f.subject, 'doc.pdf', 'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready',
       f.perm, 'a0000000-0000-0000-0000-000000000001', now()
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001'::uuid, 'professionals.view'),
    ('e0000000-0000-0000-0000-000000000002', 'core', 'signing_signed', 'signature_request', 'd0000000-0000-0000-0000-000000000001', 'professionals.view'),
    ('e0000000-0000-0000-0000-000000000003', 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000002', 'professionals.view'),
    ('e0000000-0000-0000-0000-000000000004', 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000003', 'professionals.view')
  ) as f(id, module, purpose, subject_type, subject, perm);
insert into public.professional_documents (org_id, professional_id, document_type_id, stored_file_id, status, uploaded_by, reviewed_at)
select 'b0000000-0000-0000-0000-00000000000a', d.pid, t.id, d.file, 'verified', 'a0000000-0000-0000-0000-000000000001', now()
  from (values
    ('c0000000-0000-0000-0000-000000000001'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, 'photo'),
    ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'image_consent'),
    ('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', 'photo'),
    ('c0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004', 'photo')
  ) as d(pid, file, type_key)
  join public.document_types t on t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = d.type_key;

create function private.test_owners() returns setof text
language sql set search_path = '' as $$
  select f.id::text || ' ' || coalesce(f.owner_profile_id::text, '-') || ' ' || coalesce(f.owner_permission, '-')
    from public.stored_files f where f.id::text like 'e0000000-%' order by f.id
$$;

select results_eq($$ select * from private.test_owners() $$,
  array['e0000000-0000-0000-0000-000000000001 - -', 'e0000000-0000-0000-0000-000000000002 - -',
        'e0000000-0000-0000-0000-000000000003 - -', 'e0000000-0000-0000-0000-000000000004 - -'],
  'before any account: staff''s attachments have no owner');

-- =============================================================================
-- The one-time repair (the migration's own statement, run again: idempotent)
-- =============================================================================
select lives_ok($$ select private.own_professional_document_files(null) $$, 'the repair runs over every linked file');
select results_eq($$ select * from private.test_owners() $$,
  array['e0000000-0000-0000-0000-000000000001 - -', 'e0000000-0000-0000-0000-000000000002 - -',
        'e0000000-0000-0000-0000-000000000003 a0000000-0000-0000-0000-000000000003 professionals.self',
        'e0000000-0000-0000-0000-000000000004 - -'],
  'the repair: the linked professional''s file becomes hers; files without an account stay ownerless');
select lives_ok($$ select private.own_professional_document_files(null) $$, 'run again');
select is((select count(*)::int from public.audit_log a where a.table_name = 'stored_files' and a.record_id = 'e0000000-0000-0000-0000-000000000003'
             and a.action = 'update'), 1, '… changes nothing the second time (one audited update)');

-- =============================================================================
-- Acceptance links the account and re-owns her documents' files
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok((public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
  extensions.digest('tok-1', 'sha256')) ->> 'link_id') is not null, 'the admin invites P1');
select is(public.link_professional_account(extensions.digest('tok-1', 'sha256'), 'a0000000-0000-0000-0000-000000000002', '{}') ->> 'status',
  'accepted', 'P1 accepts');
reset role;
select results_eq($$ select * from private.test_owners() $$,
  array['e0000000-0000-0000-0000-000000000001 a0000000-0000-0000-0000-000000000002 professionals.self',
        'e0000000-0000-0000-0000-000000000002 a0000000-0000-0000-0000-000000000002 professionals.self',
        'e0000000-0000-0000-0000-000000000003 a0000000-0000-0000-0000-000000000003 professionals.self',
        'e0000000-0000-0000-0000-000000000004 - -'],
  'accepting makes her documents'' files hers (the signed consent too), nobody else''s');
select is((select a.source from public.audit_log a where a.table_name = 'stored_files' and a.record_id = 'e0000000-0000-0000-0000-000000000001'
            order by a.id desc limit 1), 'rpc:link_professional_account', '… audited as the acceptance');

-- She reads them now (the owner branch of stored_files_select, what storage-sign asks).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select f.id::text from public.stored_files f order by f.id $$,
  array['e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002'],
  'the professional reads her own files, and only those');
reset role;

select * from finish();
rollback;
