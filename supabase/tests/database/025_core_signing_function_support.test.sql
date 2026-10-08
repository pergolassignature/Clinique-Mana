-- Signing function support (migration *_core_signing_function_support.sql, plan Phase 3 Task 3.33).
-- Covers: get_signing_request, recover_signature_request and discard_system_file are service-role
-- only and definer;
-- get_signing_request returns one request of the org (its view permission, signers in signing
-- order with their recipient ids, the draft's staged source file: newest ready one still staged
-- with the request's view permission), null for another org's or an unknown id;
-- recover_signature_request makes a live draft of the org `sent` with completion stamped, taking
-- its newest staged source, or none (recorded missing) without blocking the recovery, only for
-- the draft's own recorded document (another document id, or a draft without one, is refused),
-- and refuses anything else; discard_system_file soft-deletes a staged signing system file of the
-- org only (never a file a request took, a client upload, another purpose's, another org's, a
-- pending one), and is idempotent.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- =============================================================================
-- Privileges
-- =============================================================================
select results_eq($$
  select p.oid::regprocedure::text, has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef
    from pg_proc p
   where p.oid in ('public.get_signing_request(uuid, uuid)'::regprocedure,
                   'public.recover_signature_request(uuid, uuid, text, text, jsonb)'::regprocedure,
                   'public.discard_system_file(uuid, uuid)'::regprocedure)
   order by 1
$$, $$ values ('discard_system_file(uuid,uuid)'::text, false, false, true, true),
              ('get_signing_request(uuid,uuid)'::text, false, false, true, true),
              ('recover_signature_request(uuid,uuid,text,text,jsonb)'::text, false, false, true, true) $$,
  'get_signing_request, recover_signature_request and discard_system_file: service role only, definer');

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A. Org B. Requests: R1 a draft of org A (two signers, document 41), R2 sent
-- (recipient ids), R3 a draft (document 43) with no file at all, R4 a draft with no document.
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
   'settings.integrations_manage', now() - interval '2 days', now() + interval '5 days', null),
  ('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.signing_test',
   'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Document test', 'draft', '43', null, 'key-a3',
   'settings.integrations_manage', null, null, null),
  ('c0000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.signing_test',
   'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Document test', 'draft', null, null, 'key-a4',
   'settings.integrations_manage', null, null, 'provider_unavailable');
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order, documenso_recipient_id)
values
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'clinic', 'Clinique', 'direction@a.test', 2, null),
  ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pro', 'p@a.test', 1, null),
  ('c0000000-0000-0000-0000-0000000000a2', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pro', 'p@a.test', 1, '201'),
  ('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pro', 'p@a.test', 1, null),
  ('c0000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pro', 'p@a.test', 1, null);

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
grant select, insert on fx to service_role;
-- A staged system file of another purpose (the org logo), never a signing one.
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id,
  view_permission, original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, retain_until)
values ('f0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000a', 'org-assets',
  'b0000000-0000-0000-0000-00000000000a/core/b0000000-0000-0000-0000-00000000000a/f0000000-0000-0000-0000-000000000010.png',
  'core', 'org_logo', 'organization', 'b0000000-0000-0000-0000-00000000000a', 'settings.manage', 'logo.png',
  'image/png', 'png', 1000, repeat('a', 64), 'ready', now(), now() + interval '1 day');

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
select ok(not public.discard_system_file('b0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000010'),
  'a staged system file of another purpose (the logo) → false');
reset role;
select results_eq($$
  select k, f.status, f.deleted_at is not null, f.deleted_by
    from fx join public.stored_files f on f.id = fx.id
   where k in ('F2', 'T1', 'U1', 'B1', 'P1') order by k
$$, $$ values ('B1'::text, 'ready'::text, false, null::uuid), ('F2', 'deleted', true, null), ('P1', 'pending', false, null),
              ('T1', 'ready', false, null), ('U1', 'ready', false, null) $$,
  'only the staged system file was soft-deleted (deleted_at, no actor)');

-- =============================================================================
-- recover_signature_request (after the discard above, R1's newest staged source is F1)
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000a2', '52', null, '[{"role": "professional", "recipient_id": "301"}]') $$,
  '22023', null, 'recover: a sent request is not a draft');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000b',
                      'c0000000-0000-0000-0000-0000000000a1', '41', null,
                      '[{"role": "professional", "recipient_id": "301"}, {"role": "clinic", "recipient_id": "302"}]') $$,
  '22023', null, 'recover: another org''s request is unknown');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000a1', '41', null, '[{"role": "professional", "recipient_id": "301"}]') $$,
  '22023', null, 'recover: every signer gets a recipient id');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000a1', '51', 'envelope_51',
                      '[{"role": "professional", "recipient_id": "301"}, {"role": "clinic", "recipient_id": "302"}]') $$,
  '22023', 'Not the request''s document',
  'recover: a document the draft did not record (another one under the request''s id) is never adopted');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000a4', '44', null, '[{"role": "professional", "recipient_id": "304"}]') $$,
  '22023', 'Not the request''s document', 'recover: a draft without a recorded document cannot be recovered');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000a1', 'x', null,
                      '[{"role": "professional", "recipient_id": "301"}, {"role": "clinic", "recipient_id": "302"}]') $$,
  '22023', null, 'recover: a Documenso document id is numeric');
select is(public.recover_signature_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1',
            '41', 'envelope_41', '[{"role": "professional", "recipient_id": "301"}, {"role": "clinic", "recipient_id": "302"}]'),
  'f0000000-0000-0000-0000-000000000001'::uuid, 'recover takes the newest source still staged');
select is(public.recover_signature_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a3',
            '43', null, '[{"role": "professional", "recipient_id": "303"}]'),
  null::uuid, 'no staged source left → null (recorded missing), recovered anyway');
reset role;
select results_eq($$
  select r.id, r.status, r.documenso_document_id, r.envelope_id, r.source_file_id, r.sent_at, r.expires_at,
         r.completed_event_at, r.last_error, r.send_started_at, r.superseded_document_ids,
         (select array_agg(s.documenso_recipient_id order by s.signing_order) from public.signature_request_signers s
           where s.request_id = r.id)
    from public.signature_requests r
   where r.id in ('c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a3') order by r.id
$$, $$ values
  ('c0000000-0000-0000-0000-0000000000a1'::uuid, 'sent'::text, '41'::text, 'envelope_41'::text,
   'f0000000-0000-0000-0000-000000000001'::uuid, now(), null::timestamptz, now(), null::text, null::timestamptz,
   array[]::text[], array['301', '302']),
  ('c0000000-0000-0000-0000-0000000000a3', 'sent', '43', null, null, now(), null, now(), null, null, array[]::text[],
   array['303']) $$,
  'recovered: sent on its own document, completion stamped (nothing expires or cancels it now), recipients keyed by role');
select is((select retain_until from public.stored_files where id = 'f0000000-0000-0000-0000-000000000001'), null,
  'the source taken is no longer staged');
set local role service_role;
insert into fx (k, id, org, subject, view, status)
select 'S3', f.file_id, null, null, null, null
  from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'core', 'signing_signed',
         'signature_request', 'c0000000-0000-0000-0000-0000000000a3', 'application/pdf', 6000, repeat('d', 64),
         'settings.integrations_manage', 'Document signé.pdf') f;
select lives_ok($$ select public.complete_signature_request('c0000000-0000-0000-0000-0000000000a3',
                     (select id from fx where k = 'S3'), repeat('d', 64)) $$,
  'a request recovered without its source is completed with the signed PDF');
reset role;
select is((select status from public.signature_requests where id = 'c0000000-0000-0000-0000-0000000000a3'), 'signed',
  'signed without a source file: the signed PDF is what matters');

select * from finish();
rollback;
