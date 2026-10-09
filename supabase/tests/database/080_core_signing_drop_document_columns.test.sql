-- Core signing: the deprecated Documenso document columns are gone (migration
-- *_core_signing_drop_document_columns.sql, step 2 of the envelope API's E-2). Covers: the columns
-- and what hung on them; the four outputs without them, with their arguments, security and grants
-- unchanged; no function of the catalog names them any more; the envelope constraints kept.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select hasnt_column('public', 'signature_requests', 'documenso_document_id', 'documenso_document_id is dropped');
select hasnt_column('public', 'signature_requests', 'superseded_document_ids', 'superseded_document_ids is dropped');
select has_column('public', 'signature_requests', 'envelope_id', 'envelope_id remains');
select has_column('public', 'signature_requests', 'superseded_envelope_ids', 'superseded_envelope_ids remains');
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.signature_requests'::regclass
             and conname = 'signature_requests_sent_has_envelope')
  and exists (select 1 from pg_constraint where conrelid = 'public.signature_requests'::regclass
                 and conname = 'signature_requests_org_id_envelope_id_key'),
  'the envelope checks remain (sent has an envelope; unique per org)');

-- The outputs.
select is(pg_get_function_result('public.create_signature_request(jsonb)'::regprocedure),
  'TABLE(id uuid, existing boolean, status text, signers jsonb, last_error text, created_at timestamp with time zone, envelope_id text)',
  'create_signature_request: no document id');
select is(pg_get_function_result('public.get_signature_request(uuid)'::regprocedure),
  'TABLE(id uuid, org_id uuid, module_key text, purpose text, subject_type text, subject_id uuid, title text, status text, envelope_id text, expires_at timestamp with time zone, sent_at timestamp with time zone, completed_at timestamp with time zone, last_error text)',
  'get_signature_request: no document id');
select is(pg_get_function_result('public.list_signature_requests_to_reconcile(uuid, integer)'::regprocedure),
  'TABLE(id uuid, module_key text, status text, envelope_id text, expires_at timestamp with time zone, action text)',
  'list_signature_requests_to_reconcile: no document id');
select is(pg_get_function_arguments('public.list_signature_requests_to_reconcile(uuid, integer)'::regprocedure),
  'p_org_id uuid, p_limit integer DEFAULT 100',
  'list_signature_requests_to_reconcile keeps its default limit');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~ '(documenso_document_id|superseded_document_ids)'),
  0,
  'no function of the catalog names the dropped columns (get_signing_request included)');

-- Security and grants as before.
select ok(
  (select bool_and(p.prosecdef) from pg_proc p
    where p.oid in ('public.create_signature_request(jsonb)'::regprocedure,
                    'public.list_signature_requests_to_reconcile(uuid, integer)'::regprocedure,
                    'public.get_signing_request(uuid, uuid)'::regprocedure))
  and not (select p.prosecdef from pg_proc p where p.oid = 'public.get_signature_request(uuid)'::regprocedure),
  'definer for the service RPCs, invoker for get_signature_request (RLS decides)');
select ok(
  (select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
    where p.oid in ('public.create_signature_request(jsonb)'::regprocedure,
                    'public.get_signature_request(uuid)'::regprocedure,
                    'public.list_signature_requests_to_reconcile(uuid, integer)'::regprocedure,
                    'public.get_signing_request(uuid, uuid)'::regprocedure)),
  'an empty search_path on all four');
select ok(
  has_function_privilege('authenticated', 'public.get_signature_request(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_signature_request(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.get_signature_request(uuid)', 'execute'),
  'get_signature_request: authenticated only');
select ok(
  has_function_privilege('service_role', 'public.create_signature_request(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_signature_request(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.create_signature_request(jsonb)', 'execute'),
  'create_signature_request: the service role only');
select ok(
  has_function_privilege('service_role', 'public.list_signature_requests_to_reconcile(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.list_signature_requests_to_reconcile(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.list_signature_requests_to_reconcile(uuid, integer)', 'execute'),
  'list_signature_requests_to_reconcile: the service role only');
select ok(
  has_function_privilege('service_role', 'public.get_signing_request(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_signing_request(uuid, uuid)', 'execute'),
  'get_signing_request: the service role only');

select * from finish();
rollback;
