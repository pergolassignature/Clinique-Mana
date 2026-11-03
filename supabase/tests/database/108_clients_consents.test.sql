-- Client consents, part 1 (migrations *_core_signing_second_client_signer.sql and
-- *_clients_consents.sql, batch C5a). Covers: the second client signer role in core; privileges
-- (tables read-only, the service RPCs for the service role only); every policy gated by clients.*;
-- audit with the answers and signers redacted; the seeds (7 consents, 14 draft templates, 7
-- inactive rules, the settings, the link purpose, the emails, the job) for every clinic and a new
-- one; the rules (unknown consent, target, duplicate); nothing requestable before a text is
-- published; who signs (R-48: the client from 14, an authorised parent under 14, both parents
-- under shared custody, refusals with HINT `signer_required` / `signer_email`); one open request
-- per consent (a second send re-sends, new links); the public page (identity check, answers once,
-- `agree` clauses, resume an envelope); the signature's outcome (the consent in force, the links
-- revoked, a second signature supersedes); required_consents_for (once, each_time, pending,
-- missing, resign); a new version for « tous les clients actifs » or « nouveaux clients
-- seulement » (R-49); cancel; the reminders; the import; RLS (staff, provider through
-- my_client_consents only, another clinic, the module off).
begin;
create extension if not exists pgtap with schema extensions;
select plan(128);

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

-- =============================================================================
-- Core: the second client signer role
-- =============================================================================
select ok(private.signing_signers_valid('[{"role": "client", "label": "A", "order": 1, "required": true},
                                          {"role": "client_2", "label": "B", "order": 2, "required": false}]'),
  'a version may name `client_2`');
select ok(not private.signing_signers_valid('[{"role": "client", "label": "A", "order": 1, "required": true},
                                              {"role": "client_2", "label": "B", "order": 2, "required": false},
                                              {"role": "clinic", "label": "C", "order": 3, "required": false},
                                              {"role": "professional", "label": "D", "order": 4, "required": false}]'),
  'still three signers at most (the signature page holds three)');
select ok(not private.signing_signers_valid('[{"role": "client_3", "label": "A", "order": 1, "required": true}]'),
  'no other new role');

-- =============================================================================
-- Privileges
-- =============================================================================
select table_privs_are('public', t.name, 'anon', array[]::text[], t.name || ': anon has nothing')
  from (values ('client_consent_types'), ('client_consent_rules'), ('client_consent_settings'), ('client_consent_requests'),
               ('client_consent_request_signers'), ('client_consents'), ('client_consents_status'), ('client_consents_to_obtain'),
               ('my_client_consents')) as t(name);
select table_privs_are('public', t.name, 'authenticated', array['SELECT'], t.name || ': authenticated reads only')
  from (values ('client_consent_types'), ('client_consent_rules'), ('client_consent_settings'), ('client_consent_requests'),
               ('client_consent_request_signers'), ('client_consents'), ('client_consents_status'), ('client_consents_to_obtain'),
               ('my_client_consents')) as t(name);
select function_privs_are('public', f.name, f.args, 'authenticated', array[]::text[], f.name || ': not for a client')
  from (values
    ('prepare_client_consent_request_for_service', array['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid', 'timestamp with time zone', 'bytea', 'bytea', 'uuid']),
    ('open_client_consent_for_service', array['bytea', 'text', 'integer']),
    ('start_client_consent_signing_for_service', array['bytea', 'text', 'integer', 'jsonb', 'text']),
    ('client_consent_reminders_for_service', array['uuid', 'integer']),
    ('import_client_consent_fact_for_service', array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'text']),
    ('resolve_client_consent_link', array['uuid'])
  ) as f(name, args);
select function_privs_are('public', f.name, f.args, 'service_role', array[]::text[], f.name || ': user-scoped, not the service role')
  from (values
    ('set_client_consent_rule', array['uuid', 'text', 'text', 'text', 'text', 'boolean']),
    ('set_client_consent_settings', array['jsonb']),
    ('cancel_client_consent_request', array['uuid']),
    ('publish_client_consent_version', array['uuid', 'text'])
  ) as f(name, args);
select function_privs_are('private', f.name, f.args, 'authenticated', array[]::text[], f.name || ': no client calls it')
  from (values ('clients_consent_signers', array['uuid', 'uuid']), ('required_consents_for', array['uuid', 'uuid', 'text', 'text', 'text', 'text[]', 'text', 'uuid']),
               ('clients_mark_consent_signed', array[]::text[]), ('seed_clients_consents', array['uuid'])) as f(name, args);
select is_empty($$
  select p.tablename || '.' || p.policyname from pg_policies p
   where p.schemaname = 'public' and p.tablename like 'client_consent%'
     and p.qual not like '%has_permission(''clients.%'
$$, 'every policy carries a clients.* gate');
select is_empty($$
  select c.relname from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'client_consent%'
     and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = c.oid and p.proname = 'audit_trigger')
$$, 'every table is audited');

-- =============================================================================
-- Fixtures (as postgres): org A (admin, conseillère, provider linked to P1), org B (admin)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 4) n;
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u3@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'Admin B', 'u4@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000a', 'clients', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'clients', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pro', 'Un', 'u3@a.test', 'active');
-- Alice (adult), Léa (child, one parent: Marc), Théo (child, shared custody: Marc and Nadia), Zoé (adult, never asked).
insert into public.clients (id, org_id, first_name, last_name, email, birthday, shared_custody) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Tremblay', 'alice@exemple.test', date '1990-03-04', false),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Léa', 'Gagnon', null, (current_date - interval '10 years')::date, false),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Marc', 'Gagnon', null, date '1980-01-01', false),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Théo', 'Gagnon', null, (current_date - interval '8 years')::date, true),
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'Nadia', 'Roy', 'nadia@exemple.test', date '1982-02-02', false),
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Zoé', 'Côté', 'zoe@exemple.test', date '1995-05-05', false);
insert into public.client_professional_links (org_id, client_id, professional_id, reason) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'created');
-- CC-22: every client consent is countersigned by the professional assigned to the file, so each
-- file that can be asked for one has one. Her own signer row carries no link and no email.
update public.clients set primary_professional_id = 'c0000000-0000-0000-0000-000000000001'
 where org_id = 'b0000000-0000-0000-0000-00000000000a';

-- =============================================================================
-- Seeds
-- =============================================================================
select results_eq($$ select key from public.client_consent_types where org_id = 'b0000000-0000-0000-0000-00000000000a' order by sort_order $$,
  array['general', 'waitlist', 'file_transfer', 'intern', 'coaching', 'naturopathy', 'eap'], 'the 7 consents of GOrendezvous');
select is((select count(*)::int from public.document_templates t
            join public.document_template_versions v on v.template_id = t.id
           where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key like 'clients.consent_%' and v.status = 'draft' and v.version = 1),
  14, '14 draft templates (7 consents × fr / en), nothing published');
select is((select count(*)::int from public.document_template_versions v join public.document_templates t on t.id = v.template_id
            where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key like 'clients.consent_%'
              and v.body -> 'blocks' -> 0 -> 'runs' -> 0 ->> 'text' like 'Texte provisoire%'),
  14, 'every text says « Texte provisoire » first (the local seed rewrites two of its own: never a clinic''s)');
select results_eq($$ select r.consent_key, r.trigger_kind, r.target, r.is_active from public.client_consent_rules r
                      where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.consent_key in ('general', 'naturopathy', 'eap') order by 1 $$,
  $$ values ('eap', 'payer_kind', 'pae', false), ('general', 'general', null::text, false), ('naturopathy', 'service', '10157', false) $$,
  'a rule per consent, inactive until its text is published');
select isnt_empty($$ select 1 from public.client_consent_settings where org_id = 'b0000000-0000-0000-0000-00000000000b' $$, 'settings for every clinic');
select results_eq($$ select module_key, default_ttl, max_uses, creates_account, resolve_rpc from public.secure_link_purposes where key = 'client_consent' $$,
  $$ values ('clients', interval '14 days', 1, false, 'resolve_client_consent_link') $$, 'the link purpose');
select results_eq($$ select key from public.email_template_defaults where module_key = 'clients' and key like 'clients.consent\_request%' order by key $$,
  array['clients.consent_request', 'clients.consent_request_en'], 'the request email, in French and English');
select results_eq($$ select function_name, local_hour from public.scheduled_jobs where key = 'clients.consent_reminders' $$,
  $$ values ('clients-consent-reminders', 8::smallint) $$, 'the reminder job, at 8 h clinic time');
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000c', 'Org C');
select is((select count(*)::int from public.document_templates where org_id = 'b0000000-0000-0000-0000-00000000000c' and key like 'clients.consent_%'),
  14, 'a new clinic gets its templates');
select is((select count(distinct a.source)::int from public.audit_log a where a.table_name = 'client_consent_types' and a.org_id = 'b0000000-0000-0000-0000-00000000000a'),
  1, 'seeded under one audit source');

-- =============================================================================
-- Rules and settings (the conseillère: clients.manage)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.set_client_consent_rule(null, 'tarot', 'general', null, 'once', true) $$),
  'consent_key', 'an unknown consent is refused');
select is(private.test_error_hint($$ select public.set_client_consent_rule(null, 'naturopathy', 'service', 'naturo', 'once', true) $$),
  'target', 'a service rule needs a 5-digit code');
select is(private.test_error_hint($$ select public.set_client_consent_rule(null, 'general', 'general', null, 'once', false) $$),
  'duplicate', 'the same rule twice is refused');
select is(private.test_error_hint($$ select public.set_client_consent_rule((select r.id from public.client_consent_rules r where r.consent_key = 'general'
                                                            and r.org_id = 'b0000000-0000-0000-0000-00000000000a'),
                                                         'general', 'general', null, 'once', true) $$),
  'template', 'a rule is not switched on before its text is published');
select is((public.set_client_consent_settings('{"reminder_days": 5}')) ->> 'reminder_days', '5', 'a setting is saved');
select is(private.test_error_hint($$ select public.set_client_consent_settings('{"reminder_days": 90}') $$), 'settings', 'out of bounds');
reset role;

-- =============================================================================
-- Sending (service role, the actor model)
-- =============================================================================
set local role service_role;
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
            'general', null, null, null, sha256('t-a1'::bytea), sha256('t-a2'::bytea)) $$),
  'template', 'nothing is requestable before its text is published');
select throws_ok($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
            'general', null, null, null, sha256('t-a1'::bytea), sha256('t-a2'::bytea)) $$,
  '42501', null, 'a provider cannot send (clients.manage)');
reset role;

-- The admin publishes the French general text (new clients only: nothing to flag yet).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.publish_client_consent_version(
            (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
              where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr'), 'new_clients'),
  0, 'the French general text is published');
select is(private.test_error_hint($$ select public.publish_client_consent_version(
            (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
              where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.image_consent'), 'new_clients') $$),
  'template', 'only a client consent');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.set_client_consent_rule((select r.id from public.client_consent_rules r where r.consent_key = 'general'
                                                            and r.org_id = 'b0000000-0000-0000-0000-00000000000a'),
                                                         'general', 'general', null, 'once', true) $$,
  'once its text is published, the general rule is switched on');
reset role;

-- P3-40: while the module is reserved for its testers, nothing is sent to a client.
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
            'general', null, null, null, sha256('t-reserved-1'::bytea), sha256('t-reserved-2'::bytea)) $$),
  'module_reserved', 'reserved for testers: a manual send is refused (P3-40)');
select is((public.client_consent_reminders_for_service('b0000000-0000-0000-0000-00000000000a')) -> 'remind', '[]'::jsonb,
  '… and the job sends nothing again');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';

set local role service_role;
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
            'general', 'record', 'd0000000-0000-0000-0000-000000000001', now() + interval '3 days',
            sha256('t-alice-1'::bytea), sha256('t-unused-1'::bytea))) -> 'signers' -> 0 ->> 'email',
  'alice@exemple.test', 'an adult signs herself');
reset role;
select results_eq($$ select r.state, r.language, r.requested_by, pg_catalog.jsonb_array_length(r.clauses), (select count(*)::int from public.client_consent_request_signers s where s.request_id = r.id)
                      from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('pending', 'fr', 'a0000000-0000-0000-0000-000000000002'::uuid, 1, 2) $$,
  'a pending request in French, by the conseillère, with the clauses, Alice and her professional (CC-22)');
select is((select count(*)::int from public.secure_links l where l.purpose = 'client_consent' and l.revoked_at is null), 1, 'one live link');
select is((public.resolve_client_consent_link((select l.id from public.secure_links l where l.token_hash = sha256('t-alice-1'::bytea)))) ->> 'consent_name',
  'Consentement général', 'resolve-link shows the consent''s name (nothing personal)');

set local role service_role;
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
            'general', null, null, null, sha256('t-alice-2'::bytea), sha256('t-unused-2'::bytea))) ->> 'resent',
  'true', 'a second send for an open request re-sends it');
reset role;
select is((select count(*)::int from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001'), 1, '… never a second request');
select ok((select l.revoked_at is not null from public.secure_links l where l.token_hash = sha256('t-alice-1'::bytea)), '… the old link is revoked');

-- Under 14: a parent with the right; both parents under shared custody.
set local role service_role;
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
            'general', null, null, null, sha256('t-lea-0'::bytea), sha256('t-x'::bytea)) $$),
  'signer_required', 'a child without an authorised parent is refused');
reset role;
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, b_manages_appointments) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'child', 'parent', true),
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004', 'parent', 'child', false);
set local role service_role;
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
            'general', null, null, null, sha256('t-lea-0'::bytea), sha256('t-x'::bytea)) $$),
  'signer_email', 'the parent needs an address');
reset role;
update public.clients set email = 'marc@exemple.test' where id = 'd0000000-0000-0000-0000-000000000003';
set local role service_role;
select results_eq($$ select s ->> 'role', s ->> 'first_name'
                       from pg_catalog.jsonb_array_elements((public.prepare_client_consent_request_for_service(
                              'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
                              'general', null, null, null, sha256('t-lea-1'::bytea), sha256('t-x1'::bytea))) -> 'signers') s $$,
  $$ values ('client', 'Marc') $$, 'a 10-year-old''s consent goes to the authorised parent');
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004',
            'general', null, null, null, sha256('t-theo-0'::bytea), sha256('t-x2'::bytea)) $$),
  'signer_required', 'shared custody: the parent without the right does not count, and two are needed');
reset role;
update public.client_relations set a_manages_appointments = true
 where client_a_id = 'd0000000-0000-0000-0000-000000000003' and client_b_id = 'd0000000-0000-0000-0000-000000000004';
insert into public.client_relations (org_id, client_a_id, client_b_id, type_a_to_b, type_b_to_a, a_manages_appointments) values
  ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005', 'child', 'parent', false);
update public.client_relations set b_manages_appointments = true
 where client_a_id = 'd0000000-0000-0000-0000-000000000004' and client_b_id = 'd0000000-0000-0000-0000-000000000005';
set local role service_role;
select results_eq($$ select s ->> 'role'
                       from pg_catalog.jsonb_array_elements((public.prepare_client_consent_request_for_service(
                              'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004',
                              'general', null, null, null, sha256('t-theo-1'::bytea), sha256('t-theo-2'::bytea))) -> 'signers') s
                      order by 1 $$,
  $$ values ('client'), ('client_2') $$, 'shared custody: both parents sign (two links)');
reset role;

-- =============================================================================
-- The public page
-- =============================================================================
set local role service_role;
select is((public.open_client_consent_for_service(sha256('t-alice-2'::bytea), 'Alicia', 1990)) ->> 'state', 'identity_mismatch', 'a wrong first name');
select is((public.open_client_consent_for_service(sha256('t-alice-2'::bytea), 'alice', 1991)) ->> 'state', 'identity_mismatch', 'a wrong birth year');
select is((public.open_client_consent_for_service(sha256('t-alice-1'::bytea), 'Alice', 1990)) ->> 'state', 'invalid', 'a revoked link');
-- Security review 2026-10-14 (P3-40): nothing opens while Clients is reserved for its testers.
reset role;
update public.org_modules set testers_only = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select is((public.open_client_consent_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990)) ->> 'state', 'invalid',
  'reserved for testers: the page opens nothing (P3-40)');
select is((public.start_client_consent_signing_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990, '{"accord": "yes"}', 'key-alice-0')) ->> 'state',
  'invalid', 'reserved for testers: nothing is signed (P3-40)');
reset role;
update public.org_modules set testers_only = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role service_role;
select results_eq($$ select r ->> 'state', r ->> 'role', r ->> 'can_answer', r ->> 'consent_name', r -> 'clauses' -> 0 ->> 'kind'
                       from public.open_client_consent_for_service(sha256('t-alice-2'::bytea), ' ALICE ', 1990) r $$,
  $$ values ('ready', 'client', 'true', 'Consentement général', 'agree') $$, 'the right identity opens it (case and spaces ignored)');
select is(private.test_error_hint($$ select public.start_client_consent_signing_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990, '{}', 'key-alice-1') $$),
  'answers', 'every clause needs an answer');
select is(private.test_error_hint($$ select public.start_client_consent_signing_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990, '{"accord": "no"}', 'key-alice-1') $$),
  'answers', 'an « Accord requis » clause must be « Oui »');
select results_eq($$ select r ->> 'state', r -> 'signers' -> 0 ->> 'role', r -> 'values' -> 'client' ->> 'full_name', r ->> 'idempotency_key' like 'client-consent:%',
                            r -> 'answers' ->> 'accord'
                       from public.start_client_consent_signing_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990, '{"accord": "yes"}', 'key-alice-1') r $$,
  $$ values ('prepared', 'client', 'Alice Tremblay', true, 'yes') $$, 'the answers are kept; what the signature needs is returned');
select is((public.start_client_consent_signing_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990, '{"accord": "no"}', 'key-alice-2')) -> 'answers' ->> 'accord',
  'yes', 'the answers are given once');
reset role;
select ok((select r.answered_at is not null from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001'), '… with their time');
select is((select count(*)::int from public.audit_log a where a.table_name = 'client_consent_requests' and pg_catalog.strpos(a::text, '"accord": "yes"') > 0), 0,
  'the answers never reach the audit log');

-- A signature request out (as core would record it): the signer resumes it.
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'clients', 'clients.consent',
        (select r.template_version_id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001'),
        'client_consent_request', (select r.id from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001'),
        'Consentement général — Alice Tremblay', 'sent', 'envelope_alice', 'client-consent:alice', 'clients.view', now());
insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order, documenso_recipient_id) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client', 'Alice Tremblay', 'alice@exemple.test', 1, '71'),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'client_2', 'Personne Deux', 'deux@exemple.test', 2, '72');
select pass('a signer with role client_2 is stored');
set local role service_role;
select results_eq($$ select r ->> 'state', r ->> 'request_id', r ->> 'recipient_id'
                       from public.start_client_consent_signing_for_service(sha256('t-alice-2'::bytea), 'Alice', 1990, null, 'key-alice-3') r $$,
  $$ values ('resume', 'e0000000-0000-0000-0000-000000000001', '71') $$, 'an envelope out is resumed with the signer''s own recipient');
reset role;

-- =============================================================================
-- Cancel (staff)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(private.test_error_hint($$ select public.cancel_client_consent_request((select r.id from public.client_consent_requests r
                                                                                 where r.client_id = 'd0000000-0000-0000-0000-000000000001')) $$),
  'signing', 'a request whose signature started is not cancelled');
select lives_ok($$ select public.cancel_client_consent_request((select r.id from public.client_consent_requests r
                                                                 where r.client_id = 'd0000000-0000-0000-0000-000000000002')) $$,
  'Léa''s request is cancelled');
reset role;
select results_eq($$ select r.state, r.cancelled_by from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000002' $$,
  $$ values ('cancelled', 'a0000000-0000-0000-0000-000000000002'::uuid) $$, '… by the conseillère');
select ok((select bool_and(l.revoked_at is not null) from public.secure_links l where l.token_hash = sha256('t-lea-1'::bytea)), '… its link revoked');

-- =============================================================================
-- The signature's outcome
-- =============================================================================
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at, retain_until)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/e0000000-0000-0000-0000-000000000001/f0000000-0000-0000-0000-000000000001.pdf',
        'core', 'signing_signed', 'signature_request', 'e0000000-0000-0000-0000-000000000001', 'clients.view',
        'Consentement signé.pdf', 'application/pdf', 'pdf', 1000, repeat('c', 64), 'ready', now(), now() + interval '1 day');
update public.signature_request_signers set status = 'signed', signed_at = now() where request_id = 'e0000000-0000-0000-0000-000000000001';
-- As the webhook does it: the service role, no user.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select public.complete_signature_request('e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', repeat('c', 64)) $$,
  'core''s completion runs with the module''s hook');
select results_eq($$ select c.consent_key, c.language, c.version_label, c.source, c.answers ->> 'accord', c.superseded_at, c.withdrawn_at
                      from public.client_consents c where c.client_id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('general', 'fr', 'v1', 'app', 'yes', null::timestamptz, null::timestamptz) $$, 'the consent in force, at its version, with the answers');
select is((select c.signed_file_id from public.client_consents c where c.client_id = 'd0000000-0000-0000-0000-000000000001'),
  'f0000000-0000-0000-0000-000000000001'::uuid, '… and the sealed PDF');
select is((select r.state from public.client_consent_requests r where r.client_id = 'd0000000-0000-0000-0000-000000000001'), 'signed', 'the request is signed');
select ok((select l.revoked_at is not null from public.secure_links l where l.token_hash = sha256('t-alice-2'::bytea)), 'its link is revoked');
select is((select count(*)::int from public.audit_log a where a.table_name = 'client_consents' and pg_catalog.strpos(a::text, 'Alice Tremblay') > 0), 0,
  'the signers'' names never reach the audit log');

-- =============================================================================
-- required_consents_for
-- =============================================================================
select results_eq($$ select r.consent_key, r.state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001') r $$,
  $$ values ('general', 'signed') $$, 'Alice: the general consent is signed');
select results_eq($$ select r.state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004') r $$,
  $$ values ('pending') $$, 'Théo: pending');
select results_eq($$ select r.state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006') r $$,
  $$ values ('missing') $$, 'Zoé: missing (never blocks a booking: the caller only flags it)');
update public.client_consent_rules set is_active = true, frequency = 'each_time'
 where org_id = 'b0000000-0000-0000-0000-00000000000a' and consent_key = 'eap';
select results_eq($$ select r.consent_key, r.frequency, r.state
                       from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001',
                                                          null, 'pae', null, '{}', 'appointment', gen_random_uuid()) r order by 1 $$,
  $$ values ('eap', 'each_time', 'missing'), ('general', 'once', 'signed') $$, 'an EAP client: the each-time consent is missing for this appointment');
select is((select count(*)::int from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', null, 'ivac')),
  1, 'the EAP rule does not apply to IVAC');

-- =============================================================================
-- A new version (R-49)
-- =============================================================================
insert into public.document_template_versions (template_id, org_id, version, body, variables, signers, email_subject, email_message)
select v.template_id, v.org_id, 2, v.body, v.variables, v.signers, v.email_subject, v.email_message
  from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr' and v.version = 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.publish_client_consent_version(
            (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
              where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_fr' and v.version = 2), 'all_active'),
  1, '« tous les clients actifs »: the signed consent is flagged');
reset role;
select results_eq($$ select r.state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001') r $$,
  $$ values ('resign') $$, 'Alice: « À signer de nouveau »');
select is((select v.version from public.client_consent_requests q join public.document_template_versions v on v.id = q.template_version_id
            where q.client_id = 'd0000000-0000-0000-0000-000000000004' and q.state = 'pending'), 2,
  'an open request not yet in signing now prints the new version (the old one is archived)');
select is((select count(*)::int from public.client_consents c where c.resign_requested_at is not null and c.consent_key <> 'general'), 0,
  'only that consent is flagged');

-- =============================================================================
-- Import and reminders (service role)
-- =============================================================================
set local role service_role;
select ok(public.import_client_consent_fact_for_service('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006',
                                                        'general', '15', now() - interval '1 year', 'Zoé Côté'),
  'an imported consent fact');
select ok(not public.import_client_consent_fact_for_service('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006',
                                                            'general', '15', now() - interval '1 year', 'Zoé Côté'),
  '… once (a consent in force is kept)');
reset role;
select results_eq($$ select r.state from private.required_consents_for('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000006') r $$,
  $$ values ('signed') $$, 'an imported signature counts as signed (R-49)');
update public.client_consent_requests set last_sent_at = now() - interval '10 days', due_at = now() - interval '1 day'
 where client_id = 'd0000000-0000-0000-0000-000000000004';
set local role service_role;
select results_eq($$ select (r -> 'remind' ->> 0)::uuid, (r ->> 'overdue')::int from public.client_consent_reminders_for_service('b0000000-0000-0000-0000-00000000000a') r $$,
  $$ select q.id, 1 from public.client_consent_requests q where q.client_id = 'd0000000-0000-0000-0000-000000000004' $$,
  'a request pending 10 days is reminded; the overdue one raises a notice');
reset role;
select isnt_empty($$ select 1 from public.notifications n where n.kind = 'clients.consent_overdue' and n.recipient_permission = 'clients.manage' $$,
  'the notice goes to clients.manage');
set local role service_role;
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', null, null, null, null, null, null,
            sha256('t-theo-3'::bytea), sha256('t-theo-4'::bytea),
            (select q.id from public.client_consent_requests q where q.client_id = 'd0000000-0000-0000-0000-000000000004'))) ->> 'resent',
  'true', 'the job re-sends with new links (no actor)');
reset role;
select ok((select q.reminded_at is not null from public.client_consent_requests q where q.client_id = 'd0000000-0000-0000-0000-000000000004'),
  '… once: reminded_at is set');
select is(private.test_error_hint($$ select public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', null, 'd0000000-0000-0000-0000-000000000006', 'general', null, null, null,
            sha256('t-z1'::bytea), sha256('t-z2'::bytea)) $$),
  null, 'a new request without an actor is a developer error (22023, no hint)');

-- Five wrong identities on one link revoke it (the birth year cannot be guessed).
set local role service_role;
select is((public.prepare_client_consent_request_for_service(
            'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006',
            'general', null, null, null, sha256('t-zoe-1'::bytea), sha256('t-zoe-2'::bytea))) -> 'signers' -> 0 ->> 'role',
  'client', 'Zoé is asked to sign again');
select is((select count(*)::int from generate_series(1, 4) n
            where (public.open_client_consent_for_service(sha256('t-zoe-1'::bytea), 'Zoé', 1900 + n)) ->> 'state' = 'identity_mismatch'),
  4, 'four wrong years are refused');
select is((public.open_client_consent_for_service(sha256('t-zoe-1'::bytea), 'Zoé', 1990)) ->> 'state', 'invalid', '… the fifth revokes the link');
select is((public.open_client_consent_for_service(sha256('t-zoe-1'::bytea), 'Zoé', 1995)) ->> 'state', 'invalid', '… even with the right identity');
reset role;
-- A parent loses the right before signing: the links stop working (the clinic sends again).
update public.client_relations set b_manages_appointments = false
 where client_a_id = 'd0000000-0000-0000-0000-000000000004' and client_b_id = 'd0000000-0000-0000-0000-000000000005';
set local role service_role;
select is((public.start_client_consent_signing_for_service(sha256('t-theo-3'::bytea), 'Théo',
            pg_catalog.date_part('year', current_date - interval '8 years')::int, '{"accord": "yes"}', 'key-theo-1')) ->> 'state',
  'invalid', 'a signer who lost the right (shared custody: one parent left) cannot sign');
reset role;
select ok((select bool_and(l.revoked_at is not null) from public.secure_links l
            join public.client_consent_request_signers s on s.id = l.subject_id
            join public.client_consent_requests q on q.id = s.request_id
           where q.client_id = 'd0000000-0000-0000-0000-000000000004' and l.created_at is not null),
  '… every link of the request is revoked');
update public.client_relations set b_manages_appointments = true
 where client_a_id = 'd0000000-0000-0000-0000-000000000004' and client_b_id = 'd0000000-0000-0000-0000-000000000005';

-- =============================================================================
-- RLS
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.client_consents), 2, 'staff read the clinic''s consents');
select is((select count(*)::int from public.client_consents_to_obtain), 2, 'the list to obtain: Théo''s and Zoé''s requests');
select results_eq($$ select s.state from public.client_consents_status s where s.client_id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('resign') $$, 'the state per client and consent');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.client_consents), 0, 'a provider reads no consent table');
select is((select count(*)::int from public.client_consent_requests), 0, '… nor the requests');
select results_eq($$ select m.client_id, m.state from public.my_client_consents m $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'resign') $$, 'her linked client''s state only, through my_client_consents');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.client_consents), 0, 'another clinic sees nothing');
reset role;
update public.org_modules set enabled = false where org_id = 'b0000000-0000-0000-0000-00000000000a' and module_key = 'clients';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.client_consents), 0, 'the module off hides everything');
reset role;
set local role service_role;
select is((public.open_client_consent_for_service(sha256('t-theo-3'::bytea), 'Théo', null)) ->> 'state', 'invalid',
  'the module off closes the public page');
reset role;

select * from finish();
rollback;
