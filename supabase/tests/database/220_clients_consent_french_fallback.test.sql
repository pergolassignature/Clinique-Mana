-- Client consents in French only (migration *_clients_consent_french_fallback.sql, decision R-75).
-- Covers: an English-speaking client with only the French text published gets a French request
-- (its language, its version, the email's language and name); nothing published in either
-- language is still refused (HINT `template`, in French); once the English text is published an
-- English-speaking client gets it; a French-speaking client is unchanged; a re-send keeps the
-- request's language.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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
grant execute on function private.test_error_message(text) to service_role;

-- =============================================================================
-- Fixtures (as postgres): org A (admin, conseillère); Alice (French), John and Kate (English)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@ff.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@ff.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@ff.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true);
insert into public.clients (id, org_id, first_name, last_name, email, birthday, language) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test', date '1990-03-04', 'fr'),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'John', 'Smith', 'john@exemple.test', date '1985-06-07', 'en'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Kate', 'Brown', 'kate@exemple.test', date '1979-08-09', 'en');

-- =============================================================================
-- Nothing published: still refused, in French
-- =============================================================================
set local role service_role;
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
            'general', null, null, null, sha256('ff-john-0'::bytea), sha256('ff-unused-0'::bytea)) $$),
  'template', 'nothing published in either language: an English-speaking client is refused (HINT template)');
select is(private.test_error_message($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
            'general', null, null, null, sha256('ff-john-0'::bytea), sha256('ff-unused-0'::bytea)) $$),
  'Le texte de ce consentement n''est pas encore publié en français. Publiez-le dans Paramètres → Consentements.',
  '… and the refusal names the French text, the one to publish');
reset role;

-- The admin publishes the French general text only.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.publish_client_consent_version(
         (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr'), 'new_clients');
reset role;

-- =============================================================================
-- English-speaking client, French text only: a French request
-- =============================================================================
set local role service_role;
select results_eq($$
  select x ->> 'language', x ->> 'consent_name', x -> 'signers' -> 0 ->> 'email'
    from (select public.prepare_client_consent_request_for_service(
                   'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
                   'general', null, null, null, sha256('ff-john-1'::bytea), sha256('ff-unused-1'::bytea)) as x) s $$,
  $$ values ('fr', 'Consentement général', 'john@exemple.test') $$,
  'an English-speaking client with only the French text published: the request goes out in French (email, name)');
reset role;
select results_eq($$
  select r.language, t.key, r.state
    from public.client_consent_requests r
    join public.document_template_versions v on v.id = r.template_version_id
    join public.document_templates t on t.id = v.template_id
   where r.client_id = 'd0000000-0000-0000-0000-000000000002' $$,
  $$ values ('fr', 'clients.consent_general_fr', 'pending') $$,
  'the request records the language actually used (fr) and the French version');

-- A re-send keeps the request's language.
set local role service_role;
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
            'general', null, null, null, sha256('ff-john-2'::bytea), sha256('ff-unused-2'::bytea))) ->> 'language',
  'fr', 'a second send re-sends the French request');
-- A French-speaking client: unchanged.
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
            'general', null, null, null, sha256('ff-alice-1'::bytea), sha256('ff-unused-3'::bytea))) ->> 'language',
  'fr', 'a French-speaking client: French, as before');
reset role;

-- =============================================================================
-- Once the English text is published, an English-speaking client gets it
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.publish_client_consent_version(
         (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_en'), 'new_clients');
reset role;
set local role service_role;
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003',
            'general', null, null, null, sha256('ff-kate-1'::bytea), sha256('ff-unused-4'::bytea))) ->> 'language',
  'en', 'the English text published: an English-speaking client gets it');
reset role;
select is((select t.key from public.client_consent_requests r
             join public.document_template_versions v on v.id = r.template_version_id
             join public.document_templates t on t.id = v.template_id
            where r.client_id = 'd0000000-0000-0000-0000-000000000003'),
  'clients.consent_general_en', '… with the English version');
select is((select r.language from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000002'),
  'fr', 'the earlier French request of an English-speaking client stays French');

select * from finish();
rollback;
