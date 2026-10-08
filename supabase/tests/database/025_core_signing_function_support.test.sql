-- Signing function support (migration *_core_signing_function_support.sql, plan Phase 3 Task 3.33).
-- Covers: get_signing_request and discard_system_file are service-role only and definer;
-- get_signing_request returns one request of the org (its view permission, signers in signing
-- order with their recipient ids, the draft's staged source file: newest ready one still staged
-- with the request's view permission), null for another org's or an unknown id;
-- discard_system_file soft-deletes a staged system file of the org only (never a file a request
-- took, a client upload, another org's, a pending one), and is idempotent.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- =============================================================================
-- Privileges
-- =============================================================================
select results_eq($$
  select p.oid::regprocedure::text, has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef
    from pg_proc p
   where p.oid in ('public.get_signing_request(uuid, uuid)'::regprocedure,
                   'public.discard_system_file(uuid, uuid)'::regprocedure)
   order by 1
$$, $$ values ('discard_system_file(uuid,uuid)'::text, false, false, true, true),
              ('get_signing_request(uuid,uuid)'::text, false, false, true, true) $$,
  'get_signing_request and discard_system_file: service role only, definer');

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A. Org B. Requests: R1 a draft of org A (two signers), R2 sent (recipient ids).
-- Files of R1 (signing_source): F1 staged, older; F2 staged, newest (expected); F3 newer but its
-- staging is over; F4 newer, another view permission; F5 newer, deleted. A client upload U1
-- (staged, uploaded_by set), a file T1 a request took (retain_until null), a pending P1, and
-- org B's staged B1.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');

insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  documenso_document_id, envelope_id, idempotency_key, view_permission, sent_at, expires_at, last_error)
values
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.signing_test',
   'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Document test', 'draft', '41', 'envelope_41', 'key-a1',
   'settings.integrations_manage', null, null, 'provider_unavailable'),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.signing_test',
   'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Document test', 'sent', '42', null, 'key-a2',
   'settings.integrations_manage', now() - interval '2 days', now() + interval '5 days', null);
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order, documenso_recipient_id)
values
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'clinic', 'Clinique', 'direction@a.test', 2, null),
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pro', 'p@a.test', 1, null),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pro', 'p@a.test', 1, '201');

create temp table fx (k text primary key, id uuid, org uuid, subject uuid, view text, status text, retain interval,
                      uploaded_by uuid, age interval) on commit drop;
insert into fx values
  ('F1', 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'ready', interval '20 hours', null, interval '4 hours'),
  ('F2', 'f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'ready', interval '22 hours', null, interval '2 hours'),
  ('F3', 'f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'ready', interval '-1 hour', null, interval '1 hour'),
  ('F4', 'f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.manage', 'ready', interval '23 hours', null, interval '1 hour'),
  ('F5', 'f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'deleted', interval '23 hours', null, interval '1 hour'),
  ('U1', 'f0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'ready', interval '23 hours', 'a0000000-0000-0000-0000-000000000001', interval '1 hour'),
  ('T1', 'f0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2', 'settings.integrations_manage', 'ready', null, null, interval '3 days'),
  ('P1', 'f0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'pending', interval '23 hours', null, interval '1 hour'),
  ('B1', 'f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000a1', 'settings.integrations_manage', 'ready', interval '23 hours', null, interval '1 hour');
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, retain_until, uploaded_by,
  created_at, confirmed_at, deleted_at)
select id, org, 'documents', org::text || '/core/' || subject::text || '/' || id::text || '.pdf', 'core',
       'signing_source', 'signature_request', subject, view, 'Document à signer.pdf', 'application/pdf', 'pdf', 5000,
       case when status = 'pending' then null else repeat('c', 64) end, status, now() + retain, uploaded_by,
       now() - age, case when status = 'pending' then null else now() - age end,
       case when status = 'deleted' then now() else null end
  from fx;
grant select on fx to service_role;

-- =============================================================================
-- get_signing_request
-- =============================================================================
set local role service_role;
select is(public.get_signing_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1'),
  jsonb_build_object(
    'id', 'c0000000-0000-0000-0000-0000000000a1', 'module_key', 'core', 'purpose', 'core.signing_test',
    'status', 'draft', 'view_permission', 'settings.integrations_manage', 'documenso_document_id', '41',
    'envelope_id', 'envelope_41', 'expires_at', null, 'completed_event_at', null, 'last_error', 'provider_unavailable',
    'staged_source_file_id', 'f0000000-0000-0000-0000-000000000002',
    'signers', '[{"role": "professional", "order": 1, "recipient_id": null},
                 {"role": "clinic", "order": 2, "recipient_id": null}]'::jsonb),
  'a draft: its staged source file is the newest ready one still staged with its view permission; signers in order');
select is(public.get_signing_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2')
            - 'expires_at',
  jsonb_build_object(
    'id', 'c0000000-0000-0000-0000-0000000000a2', 'module_key', 'core', 'purpose', 'core.signing_test',
    'status', 'sent', 'view_permission', 'settings.integrations_manage', 'documenso_document_id', '42',
    'envelope_id', null, 'completed_event_at', null, 'last_error', null, 'staged_source_file_id', null,
    'signers', '[{"role": "professional", "order": 1, "recipient_id": "201"}]'::jsonb),
  'a sent request: no staged source file; its recipient ids');
select is((public.get_signing_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a2')
             ->> 'expires_at')::timestamptz, now() + interval '5 days', 'the expiry is returned');
select is(public.get_signing_request('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000a1'),
  null, 'another org''s request → null');
select is(public.get_signing_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000ff'),
  null, 'an unknown request → null');

-- =============================================================================
-- discard_system_file
-- =============================================================================
select ok(public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002'),
  'a staged system file of the org is discarded');
select ok(not public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000002'),
  'discarding it again → false (idempotent)');
select ok(not public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000007'),
  'a file a request took (no longer staged) → false');
select ok(not public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000006'),
  'a client upload → false');
select ok(not public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000009'),
  'another org''s file → false');
select ok(not public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000008'),
  'a pending file → false');
reset role;
select results_eq($$
  select k, f.status, f.deleted_at is not null, f.deleted_by
    from fx join public.stored_files f on f.id = fx.id
   where k in ('F2', 'T1', 'U1', 'B1', 'P1') order by k
$$, $$ values ('B1'::text, 'ready'::text, false, null::uuid), ('F2', 'deleted', true, null), ('P1', 'pending', false, null),
              ('T1', 'ready', false, null), ('U1', 'ready', false, null) $$,
  'only the staged system file was soft-deleted (deleted_at, no actor)');

select * from finish();
rollback;
