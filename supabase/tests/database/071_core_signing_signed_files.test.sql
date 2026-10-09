-- What the signed-PDF downloads need (migration *_core_signing_signed_files.sql, P4-500).
-- Covers: signature_requests.page_count (integer, nullable, 1–10000); mark_signature_request_sent
-- in one version (six arguments, the page count last and optional), service role only, definer;
-- it records the page count, or null when none is given (five arguments still resolve), and
-- refuses one out of range; get_signing_request returns the title.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- =============================================================================
-- Schema and privileges
-- =============================================================================
select col_type_is('public', 'signature_requests', 'page_count', 'integer', 'page_count is an integer');
select col_is_null('public', 'signature_requests', 'page_count', 'page_count is nullable (earlier and recovered requests)');
select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname = 'mark_signature_request_sent'), 1,
  'mark_signature_request_sent has one version');
select results_eq($$
  select (p.proargnames)[1:p.pronargs]::text[] collate "default", p.pronargdefaults::int, p.prosecdef
    from pg_proc p where p.oid = 'public.mark_signature_request_sent(uuid,text,uuid,jsonb,timestamptz,integer)'::regprocedure
$$, $$ values (array['p_id', 'p_envelope_id', 'p_source_file_id', 'p_signer_recipients', 'p_expires_at', 'p_page_count'], 1, true) $$,
  'the page count is its last argument, optional; definer');
select function_privs_are('public', 'mark_signature_request_sent',
  array['uuid', 'text', 'uuid', 'jsonb', 'timestamp with time zone', 'integer'], r.role,
  case when r.role = 'service_role' then array['EXECUTE'] else array[]::text[] end,
  'mark_signature_request_sent: ' || case when r.role = 'service_role' then 'EXECUTE for ' else 'nothing for ' end || r.role)
  from (values ('anon'), ('authenticated'), ('service_role')) r (role);

-- =============================================================================
-- Fixtures (as postgres): org A, two drafts of the built-in test document (one signer each) and
-- their staged source files.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, timezone) values ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status)
values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');

insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  idempotency_key, view_permission)
select x.id, 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.signing_test', 'signing_test',
       'a0000000-0000-0000-0000-000000000001', 'Document test — Pia Un', 'draft', 'key-' || x.id, 'settings.integrations_manage'
  from (values ('c0000000-0000-0000-0000-0000000000f1'::uuid), ('c0000000-0000-0000-0000-0000000000f2')) x (id);
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order)
select r.id, r.org_id, 'professional', 'Pia Un', 'p@a.test', 1
  from public.signature_requests r where r.id in ('c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000f2');

create temp table t (step text primary key, id uuid) on commit drop;
grant select, insert on t to service_role;
set local role service_role;
insert into t (step, id)
select 'src_' || k, f.file_id
  from unnest(array['f1', 'f2']) k,
       lateral public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'documents', 'core', 'signing_source',
         'signature_request', ('c0000000-0000-0000-0000-0000000000' || k)::uuid, 'application/pdf', 5000, repeat('c', 64),
         'settings.integrations_manage', 'Document à signer.pdf') f;

-- =============================================================================
-- mark_signature_request_sent records the page count
-- =============================================================================
select throws_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000f1', 'envelope_p1',
                      (select id from t where step = 'src_f1'), '[{"role": "professional", "recipient_id": "101"}]',
                      now() + interval '7 days', 0) $$,
  '22023', 'Invalid page count', 'a page count of 0 is refused');
select throws_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000f1', 'envelope_p1',
                      (select id from t where step = 'src_f1'), '[{"role": "professional", "recipient_id": "101"}]',
                      now() + interval '7 days', 10001) $$,
  '22023', 'Invalid page count', 'over 10000 pages is refused');
select lives_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000f1', 'envelope_p1',
                     (select id from t where step = 'src_f1'), '[{"role": "professional", "recipient_id": "101"}]',
                     now() + interval '7 days', 7) $$,
  'sent with its page count');
select lives_ok($$ select public.mark_signature_request_sent('c0000000-0000-0000-0000-0000000000f2', 'envelope_p2',
                     (select id from t where step = 'src_f2'), '[{"role": "professional", "recipient_id": "102"}]',
                     now() + interval '7 days') $$,
  'five arguments still resolve (the page count is optional)');
reset role;
select results_eq($$ select r.id::text, r.status, r.page_count, r.source_file_id = s.id
                       from public.signature_requests r join t s on s.step = 'src_' || right(r.id::text, 2)
                      where r.id in ('c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000f2')
                      order by r.id $$,
  $$ values ('c0000000-0000-0000-0000-0000000000f1'::text, 'sent'::text, 7, true),
            ('c0000000-0000-0000-0000-0000000000f2', 'sent', null::int, true) $$,
  'the request records N (null when not given) beside its source file');
select throws_ok($$ update public.signature_requests set page_count = 0 where id = 'c0000000-0000-0000-0000-0000000000f2' $$,
  '23514', null, 'the column refuses 0 pages');

-- =============================================================================
-- get_signing_request: the title (the signed PDF's name)
-- =============================================================================
set local role service_role;
select is(public.get_signing_request('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000f1') ->> 'title',
  'Document test — Pia Un', 'get_signing_request returns the title');
reset role;

select * from finish();
rollback;
