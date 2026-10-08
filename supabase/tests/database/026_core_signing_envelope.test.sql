-- Signing on the Documenso envelope API (migration *_core_signing_envelope.sql, plan
-- docs/plans/2026-10-08-documenso-envelope-api-plan.md §2.1, E-1…E-4).
-- Covers: superseded_envelope_ids (shape, its check); a sent request needs an envelope id
-- (signature_requests_sent_has_envelope replaces the document check); one envelope per org; the
-- deprecated document columns' comments; the four RPCs keyed by document now take the envelope
-- (one version each, service role only, definer); mark_signature_request_sent records the
-- envelope (never a document id) and supersedes the earlier one; mark_signature_request_failed
-- records and supersedes envelopes, an abandoned draft staying abandoned; apply_signing_event
-- matches the recorded or a superseded envelope; recover_signature_request only adopts the
-- draft's recorded envelope; the reconcile's draft actions and set_signing_settings' open-request
-- rule follow the envelope id.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

-- =============================================================================
-- Schema
-- =============================================================================
select col_type_is('public', 'signature_requests', 'superseded_envelope_ids', 'text[]',
  'superseded_envelope_ids is a text array');
select col_not_null('public', 'signature_requests', 'superseded_envelope_ids', 'superseded_envelope_ids is not null');
select col_default_is('public', 'signature_requests', 'superseded_envelope_ids', '{}'::text,
  'superseded_envelope_ids defaults to {}');
select is((select pg_get_constraintdef(c.oid) from pg_constraint c
            where c.conrelid = 'public.signature_requests'::regclass and c.conname = 'signature_requests_sent_has_envelope'),
  'CHECK (((status = ''draft''::text) OR ((envelope_id IS NOT NULL) AND (sent_at IS NOT NULL))))',
  'a request past its draft has an envelope id and a send time');
select is_empty($$
  select 1 from pg_constraint c
   where c.conrelid = 'public.signature_requests'::regclass
     and (c.conname = 'signature_requests_check2'
          or pg_get_constraintdef(c.oid) like '%documenso_document_id IS NOT NULL%')
$$, 'signature_requests_check2 is gone; no check needs a document id');
select is((select pg_get_constraintdef(c.oid) from pg_constraint c
            where c.conrelid = 'public.signature_requests'::regclass and c.conname = 'signature_requests_org_id_envelope_id_key'),
  'UNIQUE (org_id, envelope_id)', 'an envelope is unique per org');
select results_eq($$
  select a.attname::text collate "default", col_description(a.attrelid, a.attnum)
    from pg_attribute a
   where a.attrelid = 'public.signature_requests'::regclass
     and a.attname in ('documenso_document_id', 'superseded_document_ids')
   order by a.attname
$$, $$ values
  ('documenso_document_id'::text, 'Deprecated (envelope API, 2026-10-08): never written; dropped by a later migration.'::text),
  ('superseded_document_ids', 'Deprecated: superseded_envelope_ids replaces it.')
$$, 'the document columns are marked deprecated');

-- =============================================================================
-- Functions
-- =============================================================================
select hasnt_function('public', 'mark_signature_request_sent',
  array['uuid', 'text', 'text', 'uuid', 'jsonb', 'timestamp with time zone'], 'the old mark_signature_request_sent is gone');
select hasnt_function('public', 'mark_signature_request_failed', array['uuid', 'text', 'text', 'text'],
  'the old mark_signature_request_failed is gone');
select hasnt_function('public', 'recover_signature_request', array['uuid', 'uuid', 'text', 'text', 'jsonb'],
  'the old recover_signature_request is gone');
-- apply_signing_event keeps its argument types: its parameter names show the change.
select results_eq($$
  select p.oid::regprocedure::text collate "default", (p.proargnames)[1:p.pronargs]::text[] collate "default", p.prosecdef
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('mark_signature_request_sent', 'mark_signature_request_failed', 'apply_signing_event',
                       'recover_signature_request')
   order by p.proname collate "C"
$$, $$ values
  ('apply_signing_event(uuid,uuid,text,text,text,timestamp with time zone,text)'::text,
   array['p_org_id', 'p_request_id', 'p_envelope_id', 'p_event', 'p_recipient_id', 'p_at', 'p_reason'], true),
  ('mark_signature_request_failed(uuid,text,text)', array['p_id', 'p_error_code', 'p_envelope_id'], true),
  ('mark_signature_request_sent(uuid,text,uuid,jsonb,timestamp with time zone)',
   array['p_id', 'p_envelope_id', 'p_source_file_id', 'p_signer_recipients', 'p_expires_at'], true),
  ('recover_signature_request(uuid,uuid,text,jsonb)', array['p_org_id', 'p_id', 'p_envelope_id', 'p_signer_recipients'], true)
$$, 'the envelope signatures exist, one version each, definer');
select function_privs_are('public', f.name, f.args, r.role,
         case when r.role = 'service_role' then array['EXECUTE'] else array[]::text[] end,
         f.name || ': ' || case when r.role = 'service_role' then 'EXECUTE for ' else 'nothing for ' end || r.role)
  from (values
          ('mark_signature_request_sent', array['uuid', 'text', 'uuid', 'jsonb', 'timestamp with time zone']),
          ('mark_signature_request_failed', array['uuid', 'text', 'text']),
          ('apply_signing_event', array['uuid', 'uuid', 'text', 'text', 'text', 'timestamp with time zone', 'text']),
          ('recover_signature_request', array['uuid', 'uuid', 'text', 'jsonb'])) f (name, args)
 cross join (values ('anon'), ('authenticated'), ('service_role')) r (role);

-- =============================================================================
-- Fixtures (as postgres)
-- Org A: admin A. Org B: admin B. Requests (built-in test document, one professional signer):
--   E1 a draft (mark_sent);   E2 a draft (mark_failed twice, then mark_sent: supersedes);
--   E3 a draft holding envelope_e3, last send 2 hours ago (retry, sync, recover);
--   E4 a draft with no envelope, 2 days old (abandon; never recovered);
--   E5 an abandoned draft;    E6 a draft holding an envelope, last send 30 minutes ago;
--   E7 a draft with no envelope, 2 hours old;   B1 org B's draft (the same envelope as E3).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'admin@b.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', 'admin');

insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  envelope_id, idempotency_key, view_permission, last_error, created_at, last_send_at)
select x.id, x.org, 'core', 'core.signing_test', 'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Document test',
       'draft', x.envelope, 'key-' || x.id, 'settings.integrations_manage', x.err, x.created, x.last_send
  from (values
    ('c0000000-0000-0000-0000-0000000000e1'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, null::text, null::text,
     now(), null::timestamptz),
    ('c0000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-00000000000a', null, null, now(), null),
    ('c0000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-00000000000a', 'envelope_e3', 'provider_error',
     now() - interval '3 days', now() - interval '2 hours'),
    ('c0000000-0000-0000-0000-0000000000e4', 'b0000000-0000-0000-0000-00000000000a', null, 'provider_error',
     now() - interval '2 days', null),
    ('c0000000-0000-0000-0000-0000000000e5', 'b0000000-0000-0000-0000-00000000000a', null, 'abandoned',
     now() - interval '3 days', null),
    ('c0000000-0000-0000-0000-0000000000e6', 'b0000000-0000-0000-0000-00000000000a', 'envelope_e6', 'provider_error',
     now() - interval '3 days', now() - interval '30 minutes'),
    ('c0000000-0000-0000-0000-0000000000e7', 'b0000000-0000-0000-0000-00000000000a', null, 'provider_error',
     now() - interval '2 hours', null)
  ) as x (id, org, envelope, err, created, last_send);
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order)
select r.id, r.org_id, 'professional', 'Pro', 'p@a.test', 1
  from public.signature_requests r where r.id::text like 'c0000000-0000-0000-0000-0000000000e_';

create temp table t (step text primary key, id uuid) on commit drop;
grant select, insert on t to service_role;
set local role service_role;
insert into t (step, id)
select 'src_' || k, f.file_id
  from unnest(array['e1', 'e2']) k,
       lateral public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'signing_source',
         'signature_request', ('c0000000-0000-0000-0000-0000000000' || k)::uuid, 'application/pdf', 5000, repeat('c', 64),
         'settings.integrations_manage', 'Document test.pdf') f;
reset role;

-- =============================================================================
-- Checks on the row
-- =============================================================================
select throws_ok($$
  insert into public.signature_requests (org_id, module_key, purpose, subject_type, subject_id, title, status,
    idempotency_key, view_permission, sent_at, expires_at)
  values ('b0000000-0000-0000-0000-00000000000a', 'core', 'core.signing_test', 'signing_test',
    'a0000000-0000-0000-0000-000000000001', 'Document test', 'sent', 'key-no-envelope', 'settings.integrations_manage',
    now(), now() + interval '7 days') $$,
  '23514', 'new row for relation "signature_requests" violates check constraint "signature_requests_sent_has_envelope"',
  'a sent request needs an envelope id');
select throws_ok($$ update public.signature_requests set superseded_envelope_ids = array['12']
                     where id = 'c0000000-0000-0000-0000-0000000000e7' $$,
  '23514', null, 'superseded_envelope_ids refuses a numeric document id');
select throws_ok($$ update public.signature_requests set superseded_envelope_ids = array['envelope_a', '']
                     where id = 'c0000000-0000-0000-0000-0000000000e7' $$,
  '23514', null, 'superseded_envelope_ids refuses an empty element');
select throws_ok($$ update public.signature_requests
                       set superseded_envelope_ids = array(select 'envelope_' || g from generate_series(1, 21) g)
                     where id = 'c0000000-0000-0000-0000-0000000000e7' $$,
  '23514', null, 'superseded_envelope_ids holds at most 20 envelopes');
select lives_ok($$ update public.signature_requests
                      set superseded_envelope_ids = array(select 'envelope_' || g from generate_series(1, 20) g)
                    where id = 'c0000000-0000-0000-0000-0000000000e7' $$,
  'superseded_envelope_ids accepts 20 envelopes');
select throws_ok($$ update public.signature_requests set envelope_id = 'envelope_e3'
                     where id = 'c0000000-0000-0000-0000-0000000000e7' $$,
  '23505', null, 'an envelope is unique per org');
select lives_ok($$
  insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
    envelope_id, idempotency_key, view_permission, last_error)
  values ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'core', 'core.signing_test',
    'signing_test', 'a0000000-0000-0000-0000-000000000006', 'Document test', 'draft', 'envelope_e3', 'key-b1',
    'settings.integrations_manage', 'provider_error') $$,
  'the same envelope in org B is accepted (ids are per instance)');

-- =============================================================================
-- mark_signature_request_sent / _failed
-- =============================================================================
set local role service_role;
select throws_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000e1', null,
                      (select id from t where step = 'src_e1'), '[{"role": "professional", "recipient_id": "101"}]',
                      now() + interval '7 days') $$,
  '22023', 'Invalid envelope id or expiry', 'mark_sent: an envelope id is required');
select throws_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000e1', '11',
                      (select id from t where step = 'src_e1'), '[{"role": "professional", "recipient_id": "101"}]',
                      now() + interval '7 days') $$,
  '22023', 'Invalid envelope id or expiry', 'mark_sent: a numeric document id is refused');
select lives_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000e1', 'envelope_e1',
                     (select id from t where step = 'src_e1'), '[{"role": "professional", "recipient_id": "101"}]',
                     now() + interval '7 days') $$,
  'mark_signature_request_sent with an envelope id');
reset role;
select results_eq($$
  select r.status, r.envelope_id, r.documenso_document_id, r.superseded_envelope_ids, r.sent_at, r.send_started_at,
         (select array_agg(s.documenso_recipient_id) from public.signature_request_signers s where s.request_id = r.id)
    from public.signature_requests r where r.id = 'c0000000-0000-0000-0000-0000000000e1'
$$, $$ values ('sent'::text, 'envelope_e1'::text, null::text, array[]::text[], now(), null::timestamptz, array['101']) $$,
  'mark_sent records the envelope and its recipients, never a document id');

set local role service_role;
select throws_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000e2', 'provider_error', '12') $$,
  '22023', null, 'mark_failed: a numeric document id is refused');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000e2', 'provider_error',
                     'envelope_e2a') $$,
  'mark_failed records the envelope Documenso created');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000e2', 'provider_unavailable',
                     'envelope_e2b') $$,
  'mark_failed with a re-send''s new envelope');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000e2', 'render_failed') $$,
  'mark_failed without an envelope');
reset role;
select results_eq($$
  select r.status, r.last_error, r.envelope_id, r.superseded_envelope_ids, r.documenso_document_id, r.superseded_document_ids
    from public.signature_requests r where r.id = 'c0000000-0000-0000-0000-0000000000e2'
$$, $$ values ('draft'::text, 'render_failed'::text, 'envelope_e2b'::text, array['envelope_e2a'], null::text, array[]::text[]) $$,
  'mark_failed: the new envelope supersedes the recorded one; without one, the recorded one stays');
set local role service_role;
select lives_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000e2', 'envelope_e2c',
                     (select id from t where step = 'src_e2'), '[{"role": "professional", "recipient_id": "201"}]',
                     now() + interval '7 days') $$,
  'a re-send succeeds with envelope_e2c');
reset role;
select results_eq($$ select status, envelope_id, superseded_envelope_ids from public.signature_requests
                      where id = 'c0000000-0000-0000-0000-0000000000e2' $$,
  $$ values ('sent'::text, 'envelope_e2c'::text, array['envelope_e2a', 'envelope_e2b']) $$,
  'a re-send supersedes the earlier envelope');
set local role service_role;
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000e5', 'provider_error',
                     'envelope_e5') $$,
  'a late failure on an abandoned draft');
reset role;
select results_eq($$ select last_error, envelope_id from public.signature_requests
                      where id = 'c0000000-0000-0000-0000-0000000000e5' $$,
  $$ values ('abandoned'::text, 'envelope_e5'::text) $$, 'an abandoned draft stays abandoned, its envelope recorded');

-- =============================================================================
-- apply_signing_event
-- =============================================================================
set local role service_role;
select results_eq($$ select outcome from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e2', 'envelope_e2c', 'DOCUMENT_OPENED', '201', now(), null) $$,
  $$ values ('applied'::text) $$, 'the recorded envelope → applied');
select results_eq($$ select outcome, request_id from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e2', 'envelope_e2a', 'DOCUMENT_CANCELLED', null, now(), null) $$,
  $$ values ('ignored'::text, 'c0000000-0000-0000-0000-0000000000e2'::uuid) $$, 'a superseded envelope''s late event → ignored');
select results_eq($$ select outcome from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e2', 'envelope_other', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('not_found'::text) $$, 'another envelope on a sent request → not_found');
select results_eq($$ select outcome from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e3', 'envelope_e3', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('retry'::text) $$, 'a draft holding an envelope → retry');
select results_eq($$ select outcome from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e4', 'envelope_new', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('retry'::text) $$, 'a draft whose send has not recorded its envelope yet → retry');
select results_eq($$ select outcome from public.apply_signing_event('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e5', 'envelope_e5', 'DOCUMENT_OPENED', null, now(), null) $$,
  $$ values ('ignored'::text) $$, 'an abandoned draft → ignored');

-- =============================================================================
-- Reconcile and recovery
-- =============================================================================
select results_eq($$
  select id, envelope_id, action from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a')
   where id in ('c0000000-0000-0000-0000-0000000000e3', 'c0000000-0000-0000-0000-0000000000e4',
                'c0000000-0000-0000-0000-0000000000e6', 'c0000000-0000-0000-0000-0000000000e7')
$$, $$ values ('c0000000-0000-0000-0000-0000000000e4'::uuid, null::text, 'abandon'::text),
              ('c0000000-0000-0000-0000-0000000000e3', 'envelope_e3', 'sync') $$,
  'reconcile: a draft with an envelope → sync after an hour, one without → abandon after a day');

select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e3', 'envelope_other', '[{"role": "professional", "recipient_id": "301"}]') $$,
  '22023', 'Not the request''s envelope', 'recover: an envelope the draft did not record is never adopted');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e3', null, '[{"role": "professional", "recipient_id": "301"}]') $$,
  '22023', 'Invalid envelope id', 'recover: an envelope id is required');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e3', '13', '[{"role": "professional", "recipient_id": "301"}]') $$,
  '22023', 'Invalid envelope id', 'recover: a numeric document id is refused');
select throws_ok($$ select public.recover_signature_request('b0000000-0000-0000-0000-00000000000a',
                      'c0000000-0000-0000-0000-0000000000e4', 'envelope_e4', '[{"role": "professional", "recipient_id": "401"}]') $$,
  '22023', 'Not the request''s envelope', 'recover: a draft without an envelope is never recovered');
select is(public.recover_signature_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000e3',
            'envelope_e3', '[{"role": "professional", "recipient_id": "301"}]'),
  null::uuid, 'recover: the draft''s own envelope (no staged source: recorded missing)');
reset role;
select results_eq($$
  select r.status, r.envelope_id, r.completed_event_at, r.documenso_document_id,
         (select array_agg(s.documenso_recipient_id) from public.signature_request_signers s where s.request_id = r.id)
    from public.signature_requests r where r.id = 'c0000000-0000-0000-0000-0000000000e3'
$$, $$ values ('sent'::text, 'envelope_e3'::text, now(), null::text, array['301']) $$,
  'recovered: sent on its own envelope, completion stamped');

-- =============================================================================
-- set_signing_settings: an origin change waits for the drafts holding an envelope
-- =============================================================================
update public.signing_settings set base_url = 'https://sign.b.test' where org_id = 'b0000000-0000-0000-0000-00000000000b';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok($$ select public.set_signing_settings('{"base_url": "https://autre.b.test"}') $$, 'P0001', null,
  'set_signing_settings: an origin change is refused while a draft holds an envelope');
reset role;
update public.signature_requests set envelope_id = null where id = 'c0000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select is(public.set_signing_settings('{"base_url": "https://autre.b.test"}'), '{"api_key_cleared": false}'::jsonb,
  'allowed when the open draft has no envelope');
reset role;

select * from finish();
rollback;
