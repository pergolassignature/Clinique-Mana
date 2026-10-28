-- The assigned professional countersigns a client consent (migration
-- *_clients_consent_professional_signer.sql, decision CC-22, revising R-48 and CC-4).
-- Covers: the signer row may name a professional (exactly one identity per row); who signs gains
-- the file's assigned professional, and a file without one — or whose professional is not active —
-- is refused in French (HINT `professional_required`); the send issues links and emails for the
-- client side only, and reports the professional separately; the envelope carries her as a third
-- recipient; the seeded drafts gained her box, her variable and her signer; what waits for her
-- (`my_client_consent_signatures`) and resuming her own signature
-- (`prepare_my_client_consent_signature_for_service`: `waiting` before the client has signed,
-- `resume` after, and never another professional's).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create function private.test_error_hint(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return nullif(v_hint, '');
end;
$$;
grant execute on function private.test_error_hint(text) to authenticated, service_role;

create function private.test_error_message(p_sql text) returns text
language plpgsql set search_path = '' as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function private.test_error_message(text) to authenticated, service_role;

-- =============================================================================
-- Fixtures: clinic A; its admin, a conseillère, and two providers with a file each.
-- Alice (Pro Un), Bob (no professional), Carl (an inactive professional).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ps.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@ps.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@ps.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro Un', 'u3@ps.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Pro Deux', 'u4@ps.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Dominique', 'Un', 'u3@ps.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'Camille', 'Deux', 'u4@ps.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', null, 'Parti', 'Trois', 'pro3@ps.test', 'inactive');
insert into public.clients (id, org_id, first_name, last_name, email, birthday, language, primary_professional_id) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test', date '1990-03-04', 'fr', 'c0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bob', 'Sanspro', 'bob@exemple.test', date '1988-05-06', 'fr', null),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Carl', 'Inactif', 'carl@exemple.test', date '1975-07-08', 'fr', 'c0000000-0000-0000-0000-000000000003');

-- =============================================================================
-- The signer row: exactly one identity, and only `professional` names a professional
-- =============================================================================
select has_column('public', 'client_consent_request_signers', 'signer_professional_id',
  'the signer row may name a professional');
select col_is_null('public', 'client_consent_request_signers', 'signer_client_id',
  '… so the client is no longer required on every row');
select has_index('public', 'client_consent_request_signers', 'client_consent_request_signers_professional_idx',
  'the new foreign key is indexed');

insert into public.client_consent_requests (id, org_id, client_id, consent_key, language, template_version_id, state)
select 'e9000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
       'general', 'fr', v.id, 'pending'
  from public.document_template_versions v
  join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr';
select throws_ok($$ insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, signer_professional_id)
                    values ('b0000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000001', 'professional',
                            'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'a row naming both a client and a professional is refused');
select throws_ok($$ insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, signer_professional_id)
                    values ('b0000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000001', 'client', null, null) $$,
  '23514', null, 'a row naming nobody is refused');
select throws_ok($$ insert into public.client_consent_request_signers (org_id, request_id, role, signer_client_id, signer_professional_id)
                    values ('b0000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-000000000001', 'client', null,
                            'c0000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'only the `professional` role may name a professional');
delete from public.client_consent_requests where id = 'e9000000-0000-0000-0000-000000000001';

-- =============================================================================
-- Who signs: the client, then her professional
-- =============================================================================
select results_eq($$ select s ->> 'role', s ->> 'signer_professional_id'
                       from jsonb_array_elements(private.clients_consent_signers(
                              'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001')) s $$,
  $$ values ('client', null::text), ('professional', 'c0000000-0000-0000-0000-000000000001') $$,
  'an adult signs herself, then the professional assigned to her file (CC-22)');
select is(private.test_error_hint($$ select private.clients_consent_signers(
            'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002') $$),
  'professional_required', 'a file with no assigned professional is refused');
select is(private.test_error_message($$ select private.clients_consent_signers(
            'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002') $$),
  'Ce dossier n''a pas de professionnel attitré : le consentement doit être signé par le professionnel assigné au dossier. Choisissez-le dans la fiche du client, puis envoyez la demande.',
  '… in French, naming what to do');
select is(private.test_error_hint($$ select private.clients_consent_signers(
            'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003') $$),
  'professional_required', 'a file whose professional is not active is refused too');

-- =============================================================================
-- The templates: a third signature box on the seeded drafts
-- =============================================================================
select is((select count(*)::int from public.document_template_versions v
            join public.document_templates t on t.id = v.template_id
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key ~ '^clients\.consent_' and v.status = 'draft'
             and exists (select 1 from jsonb_array_elements(v.signers) s where s ->> 'role' = 'professional')),
  14, 'the 14 seeded drafts name the professional as a signer');
select is((select count(*)::int from public.document_template_versions v
            join public.document_templates t on t.id = v.template_id
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key ~ '^clients\.consent_' and v.status = 'draft'
             and exists (select 1 from jsonb_array_elements(v.variables) x where x ->> 'path' = 'professional.full_name')),
  14, '… and carry her name as a variable');
select is((select count(*)::int from public.document_template_versions v
            join public.document_templates t on t.id = v.template_id,
                lateral jsonb_array_elements(v.body -> 'blocks') b
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key ~ '^clients\.consent_' and v.status = 'draft'
             and b.value ->> 'type' = 'signaturePage'
             and exists (select 1 from jsonb_array_elements(b.value -> 'signers') s where s ->> 'role' = 'professional')),
  14, '… and hold her box on the signature page');

-- =============================================================================
-- Sending: links and emails for the client side only, the professional reported apart
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.publish_client_consent_version(
         (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr'), 'new_clients');
reset role;
update public.org_modules set testers_only = false
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';

set local role service_role;
select results_eq($$
  select jsonb_array_length(x -> 'signers'), x -> 'signers' -> 0 ->> 'email',
         x -> 'professional' ->> 'full_name', x -> 'professional' ->> 'email'
    from (select public.prepare_client_consent_request_for_service(
                   'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
                   'general', null, null, null, sha256('ps-alice-1'::bytea), sha256('ps-unused-1'::bytea)) as x) s $$,
  $$ values (1, 'alice@exemple.test', 'Dominique Un', 'u3@ps.test') $$,
  'one emailed signer (the client), and the professional reported apart');
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
            'general', null, null, null, sha256('ps-bob-1'::bytea), sha256('ps-unused-2'::bytea)) $$),
  'professional_required', 'a send for a file without a professional is refused');
reset role;
select is((select count(*)::int from public.client_consent_request_signers s
           where s.request_id = (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001')),
  2, 'the request has two signer rows: the client and her professional');
select ok((select s.link_id is null from public.client_consent_request_signers s
            where s.role = 'professional'
              and s.request_id = (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001')),
  '… and the professional''s row carries no secure link (she signs in the app)');
select ok((select s.last_sent_at is not null from public.client_consent_request_signers s
            where s.role = 'professional'
              and s.request_id = (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001')),
  '… but is stamped as asked, like the others');
select is((select count(*)::int from public.secure_links l where l.purpose = 'client_consent' and l.revoked_at is null),
  1, 'one live link only: nothing is sent to the professional by email');

-- The envelope the public page prepares carries her as the third recipient.
set local role service_role;
select results_eq($$
  select s ->> 'role', s ->> 'name', (s ->> 'order')::int
    from jsonb_array_elements((public.start_client_consent_signing_for_service(
           sha256('ps-alice-1'::bytea), 'Alice', 1990, '{"accord": "yes"}', 'key-ps-alice-1')) -> 'signers') s
   order by 3 $$,
  $$ values ('client', 'Alice Tremblay', 1), ('professional', 'Dominique Un', 3) $$,
  'the envelope carries the client and the professional (orders 1 and 3)');
reset role;

-- =============================================================================
-- The professional's side
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select x ->> 'client_name', x ->> 'consent_name', x ->> 'state'
                       from jsonb_array_elements(public.my_client_consent_signatures()) x $$,
  $$ values ('Alice Tremblay', 'Consentement général', 'waiting_client') $$,
  'the professional sees what waits for her, « en attente du client » before any envelope');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.my_client_consent_signatures(), '[]'::jsonb,
  'another professional sees nothing of it');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.my_client_consent_signatures() $$, '42501', null,
  'a conseillère has no clients.self: refused');
reset role;

set local role service_role;
select is((public.prepare_my_client_consent_signature_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
            (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001'))) ->> 'state',
  'waiting', 'nothing to countersign before the client has answered and signed');
reset role;

-- The client's envelope is out (as core would record it), with her recipient.
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at)
select 'e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'clients', 'clients.consent',
       r.template_version_id, 'client_consent_request', r.id, 'Consentement général — Alice Tremblay', 'sent',
       'envelope_psalice', 'client-consent:ps-alice', 'clients.view', now()
  from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001';
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order, documenso_recipient_id) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'Alice Tremblay', 'alice@exemple.test', 1, '81'),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Dominique Un', 'u3@ps.test', 3, '83');

set local role service_role;
select results_eq($$ select x ->> 'state', x ->> 'request_id', x ->> 'recipient_id'
                       from public.prepare_my_client_consent_signature_for_service(
                              'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
                              (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001')) x $$,
  $$ values ('resume', 'e0000000-0000-0000-0000-000000000001', '83') $$,
  'she resumes the envelope with her own recipient, never a second request');
select is(private.test_error_hint($$ select public.prepare_my_client_consent_signature_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004',
            (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001')) $$),
  'request', 'another professional never reaches it');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select x ->> 'state' from jsonb_array_elements(public.my_client_consent_signatures()) x), 'ready',
  '… and her list now says she can sign');
reset role;
update public.signature_request_signers set status = 'signed', signed_at = now()
 where request_id = 'e0000000-0000-0000-0000-000000000001' and role = 'professional';
set local role service_role;
select is(private.test_error_hint($$ select public.prepare_my_client_consent_signature_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
            (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001')) $$),
  'signed', 'she cannot sign the same consent twice');
reset role;

-- Grants: the service function is the service role's only (the app goes through the function).
select function_privs_are('public', 'prepare_my_client_consent_signature_for_service', array['uuid', 'uuid', 'uuid'],
  'authenticated', array[]::text[], 'prepare_my_client_consent_signature_for_service: no authenticated role');

select * from finish();
rollback;
