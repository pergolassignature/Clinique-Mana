-- The service contract (migration *_professionals_contracts.sql, plan Task 4d.1, P4-430 … P4-449).
-- Covers: privileges; the permission and its default; the template seeded per clinic (draft v1,
-- nothing published, publishable, the banner line, initials, the block placeholder) and for a new
-- clinic; the printed terms (values, Annexe A from the retention grid: prices, tiers, the count's
-- tier, the rate in force, the other kinds; the signers; refusals without a title or a grid);
-- prepare_professional_contract (actor checks, arguments, no published template, the snapshot
-- written once and never re-read, a draft resumed under its own key, a contract out refused,
-- resend, regenerate and its double click, an inactive file, a signed contract); the card
-- (get_professional_contract for the conseillère and the admin, another clinic, the provider);
-- readiness (contract_signed: the latest request only, the same for every reader, ready requires
-- it); the history (status moves only).
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

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
grant execute on function private.test_error_hint(text) to authenticated;

-- =============================================================================
-- Privileges
-- =============================================================================
select function_privs_are('public', 'prepare_professional_contract', array['uuid', 'uuid', 'text', 'text'], 'service_role', array['EXECUTE'],
  'service_role may prepare a contract');
select function_privs_are('public', 'prepare_professional_contract', array['uuid', 'uuid', 'text', 'text'], 'authenticated', array[]::text[],
  'a client may not (the function names the actor)');
select function_privs_are('public', 'prepare_professional_contract', array['uuid', 'uuid', 'text', 'text'], 'anon', array[]::text[],
  'anon may not prepare a contract');
select function_privs_are('public', 'get_professional_contract', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated may read the contract card');
select function_privs_are('public', 'get_professional_contract', array['uuid'], 'service_role', array[]::text[],
  'service_role may not (user-scoped)');
select function_privs_are('public', 'get_professional_contract', array['uuid'], 'anon', array[]::text[],
  'anon may not read the contract card');
select function_privs_are('private', 'professional_signed_contracts', array[]::text[], 'authenticated', array['EXECUTE'],
  'the invoker readiness view calls the signed-contracts helper');
select function_privs_are('private', 'professional_contract_terms', array['uuid', 'uuid'], 'authenticated', array[]::text[],
  'no client calls the terms builder');
select function_privs_are('private', 'professional_contract_terms', array['uuid', 'uuid'], 'service_role', array[]::text[],
  'nor the service role (prepare_professional_contract does)');
select function_privs_are('private', 'seed_professionals_contract_template', array['uuid'], 'authenticated', array[]::text[],
  'no client calls the template seed');
select table_privs_are('public', 'professional_contract_snapshots', 'authenticated', array['SELECT'], 'authenticated: select only on the snapshots');
select table_privs_are('public', 'professional_contract_snapshots', 'anon', array[]::text[], 'anon: nothing on the snapshots');
select results_eq($$ select role from public.role_permissions where permission_key = 'professionals.contracts.send' order by role $$,
  $$ values ('admin'::text) $$, 'professionals.contracts.send: admin by default');

-- =============================================================================
-- Fixtures (as postgres): org A (legal name, address, signatory without an address yet) with an
-- admin, an adjointe, a conseillère and a provider (linked to P3); org B with an admin.
-- P1 psychologue (licence, address, female), 78 sessions, 27,5 % in force; P2 no title;
-- P3 nutritionniste (no grid); P4 org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name, legal_name, address_line1, city, province, postal_code, signatory_name, signatory_title) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'Clinique A inc.', '100, rue Principale', 'Québec', 'QC', 'G1A 1A1', 'Dominique Exemple', 'présidente'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', null, null, null, null, null, null, null);
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

select set_config('test.psy',    (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'psychologue'), true);
select set_config('test.nutri',  (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'nutritionniste'), true);
select set_config('test.b_psy',  (select t.id::text from public.profession_titles t where t.org_id = 'b0000000-0000-0000-0000-00000000000b' and t.key = 'psychologue'), true);
select set_config('test.tpl',    (select t.id::text from public.document_templates t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.service_contract'), true);
select set_config('test.v1',     (select v.id::text from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid), true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, gender, address_line1, address_line2, city, province, postal_code, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Un', 'pia@exemple.ca', 'female',
   '200, avenue Exemple', 'bureau 3', 'Lévis', 'QC', 'G6V 1A1', 'invited'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Deux', 'paul@exemple.ca', null, null, null, null, 'QC', null, 'draft'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Nora', 'Trois', 'provider@a.test', null, null, null, null, 'QC', null, 'invited'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Quatre', 'pat@exemple.ca', null, null, null, null, 'QC', null, 'draft');
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', current_setting('test.psy')::uuid, '12345-67', true),
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', current_setting('test.nutri')::uuid, 'ND-1', true),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000004', current_setting('test.b_psy')::uuid, '99999-99', true);
insert into public.professional_session_counts (org_id, professional_id, month, adjustment, note) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
   (date_trunc('month', now()) - interval '2 months')::date, 78, 'Solde d''ouverture');
insert into public.professional_retention (org_id, professional_id, retention_pct, decision, effective_from) values
  ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 27.5, 'initial', date '2026-07-01');

-- =============================================================================
-- The template: one draft per clinic, nothing published
-- =============================================================================
select results_eq($$ select t.title, t.module_key, t.view_permission, t.edit_permission, t.is_active
                       from public.document_templates t where t.id = current_setting('test.tpl')::uuid $$,
  $$ values ('Contrat de service'::text, 'professionals'::text, 'professionals.view'::text, 'professionals.settings'::text, true) $$,
  'org A has « Contrat de service » (view professionals.view, edit professionals.settings)');
select results_eq($$ select v.version, v.status from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid $$,
  $$ values (1, 'draft'::text) $$, 'one draft version 1, nothing published');
select is((select count(*)::int from public.document_templates t
            where t.key = 'professionals.service_contract' and t.org_id = 'b0000000-0000-0000-0000-00000000000b'), 1,
  'every clinic gets the template');
select is((select v.body -> 'blocks' -> 0 -> 'runs' -> 0 ->> 'text' from public.document_template_versions v where v.id = current_setting('test.v1')::uuid),
  'Texte à faire valider par la direction avant publication', 'the draft opens with the validation banner');
select is((select v.body -> 'header' -> 'initialsFor' from public.document_template_versions v where v.id = current_setting('test.v1')::uuid),
  '["professional"]'::jsonb, 'the professional initials every page (P4-17, P4-431)');
select ok((select exists (select 1 from jsonb_array_elements(v.body -> 'blocks') b
                           where b ->> 'type' = 'paragraph' and b -> 'runs' = '[{"text": "{{pricing.annexe_a}}"}]'::jsonb)
             from public.document_template_versions v where v.id = current_setting('test.v1')::uuid),
  'Annexe A is a paragraph holding only its placeholder (P4-433)');
select results_eq($$ select s ->> 'role', (s ->> 'required')::boolean from public.document_template_versions v,
                            jsonb_array_elements(v.signers) s where v.id = current_setting('test.v1')::uuid order by (s ->> 'order')::int $$,
  $$ values ('professional'::text, true), ('clinic'::text, false) $$, 'the professional signs, then the optional clinic signer');
select is_empty($$ select 1 from public.document_template_versions v
                    where v.id = current_setting('test.v1')::uuid
                      and (v.body::text ~ 'Christine|Sirois|Lebourgneuf|G2J' or v.email_message ~ 'Christine') $$,
  'no real name or address in the template');
-- A new clinic gets it too (the trigger).
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000c', 'Org C');
select is((select count(*)::int from public.document_templates t join public.document_template_versions v on v.template_id = t.id
            where t.org_id = 'b0000000-0000-0000-0000-00000000000c' and t.key = 'professionals.service_contract' and v.status = 'draft'), 1,
  'a new clinic gets the draft');

-- =============================================================================
-- The printed terms (as postgres)
-- =============================================================================
select set_config('test.terms', private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001')::text, true);
select is(current_setting('test.terms')::jsonb -> 'values' -> 'professional',
  jsonb_build_object('full_name', 'Pia Un', 'first_name', 'Pia', 'email', 'pia@exemple.ca',
                     'address', '200, avenue Exemple, bureau 3, Lévis (QC) G6V 1A1', 'profession', 'psychologue',
                     'membership', 'membre de l’Ordre des psychologues du Québec, permis nº 12345-67'),
  'the professional''s values: one-line address, the title in a sentence, the order and licence');
select is(current_setting('test.terms')::jsonb -> 'values' -> 'contract',
  '{"clinic_legal_name": "Clinique A inc.", "clinic_address": "100, rue Principale, Québec (QC) G1A 1A1"}'::jsonb,
  'the clinic''s legal name and one-line address');
select ok((current_setting('test.terms')::jsonb -> 'values' ->> 'today')::date = (now() at time zone 'America/Toronto')::date,
  'today is the clinic''s date');
select is(current_setting('test.terms')::jsonb ->> 'title', 'Contrat de service — Pia Un', 'the request title names the professional');
select is(current_setting('test.terms')::jsonb -> 'annexe' -> 'prices',
  '[{"duration": 60, "client_price_cents": 20000}, {"duration": 50, "client_price_cents": 17500}, {"duration": 30, "client_price_cents": 13000}]'::jsonb,
  'Annexe A: the client price of each duration the grid prices');
select is(jsonb_array_length(current_setting('test.terms')::jsonb -> 'annexe' -> 'tiers'), 7, 'one row per tier (28 % down to 25 %)');
select is(current_setting('test.terms')::jsonb -> 'annexe' -> 'tiers' -> 0,
  '{"from": 0, "to": 50, "retention_pct": 28.00, "pay": [{"duration": 60, "cents": 14400}, {"duration": 50, "cents": 12600}, {"duration": 30, "cents": 9360}]}'::jsonb,
  'the first tier: 0 to 50 sessions, pay = price × (1 − 28 %)');
select is(current_setting('test.terms')::jsonb -> 'annexe' -> 'tiers' -> 6 -> 'to', 'null'::jsonb, 'the last tier has no end (« et plus »)');
select results_eq($$ select (a ->> 'sessions_total')::numeric, (a ->> 'current_tier_from')::int, a -> 'in_force' -> 'pay'
                       from (select current_setting('test.terms')::jsonb -> 'annexe' a) x $$,
  $$ values (78.0, 51, '[{"duration": 60, "cents": 14500}, {"duration": 50, "cents": 12688}, {"duration": 30, "cents": 9425}]'::jsonb) $$,
  'the count (78) is in the 51 tier; the pay at the rate in force (27,5 %), rounded half away from zero');
select is(current_setting('test.terms')::jsonb -> 'annexe' -> 'other',
  '[{"kind": "workshop", "name": "Ateliers et conférences", "retention_pct": 25.00},
    {"kind": "late_cancellation", "name": "Annulation tardive", "retention_pct": 30.00},
    {"kind": "other_fees", "name": "Autres frais", "retention_pct": 15.00}]'::jsonb,
  'the other kinds'' rates in force');
select is(current_setting('test.terms')::jsonb -> 'signers',
  '[{"role": "professional", "name": "Pia Un", "email": "pia@exemple.ca", "order": 1}]'::jsonb,
  'without a signatory address, the professional signs alone');
update public.organizations set signatory_email = 'direction@clinique-a.test' where id = 'b0000000-0000-0000-0000-00000000000a';
select is(private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001') -> 'signers' -> 1,
  '{"role": "clinic", "name": "Dominique Exemple", "email": "direction@clinique-a.test", "order": 2}'::jsonb,
  'with Settings « Signataire » complete, the clinic signs second');
select is(private.test_error_hint($$ select private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002') $$),
  'profession', 'no primary title: refused (HINT profession)');
select is(private.test_error_hint($$ select private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003') $$),
  'pricing', 'a title without a grid: refused (HINT pricing)');
select throws_ok($$ select private.professional_contract_terms('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional is unknown');

-- =============================================================================
-- prepare_professional_contract (as postgres: the function's service client)
-- =============================================================================
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') $$,
  '42501', null, 'the adjointe (no professionals.contracts.send) is refused');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s admin finds nothing');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'sign', 'k1') $$,
  '22023', null, 'an unknown action');
select throws_ok($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'a b') $$,
  '22023', null, 'a key outside [A-Za-z0-9_-]');
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') $$),
  'template', 'nothing published: refused (HINT template)');

-- The admin publishes the draft: the seeded body passes publish_template_version's checks.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.publish_template_version(current_setting('test.v1')::uuid) $$, 'the seeded draft can be published');
reset role;

select set_config('test.prep1', public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1')::text, true);
select results_eq($$ select p ->> 'idempotency_key', (p ->> 'template_version_id')::uuid, p -> 'cancel', p -> 'annexe' -> 'in_force' -> 'retention_pct'
                       from (select current_setting('test.prep1')::jsonb p) x $$,
  $$ values ('professionals.service_contract:c0000000-0000-0000-0000-000000000001:k1'::text, current_setting('test.v1')::uuid, 'null'::jsonb, '27.5'::jsonb) $$,
  'send: the request key, the published version, nothing to cancel, the terms');
select results_eq($$ select s.created_by, s.title from public.professional_contract_snapshots s
                      where s.idempotency_key = 'professionals.service_contract:c0000000-0000-0000-0000-000000000001:k1' $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'Contrat de service — Pia Un'::text) $$, 'the snapshot is written, by the actor');
select results_eq($$ select a.source, a.actor_id, a.changed_fields ->> 'template_values', a.changed_fields ->> 'signers'
                       from public.audit_log a where a.table_name = 'professional_contract_snapshots' and a.action = 'insert' $$,
  $$ values ('rpc:prepare_professional_contract'::text, 'a0000000-0000-0000-0000-000000000001'::uuid, '[redacted]'::text, '[redacted]'::text) $$,
  'audited under the actor; the values and signers redacted');

-- First write wins: a backdated rate change does not reach the same action (P4-151).
update public.professional_retention set retention_pct = 26 where professional_id = 'c0000000-0000-0000-0000-000000000001';
select is(public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k1') -> 'annexe' -> 'in_force' -> 'retention_pct',
  '27.5'::jsonb, 'the same key returns what was printed, never the compensation read again');
select is((select count(*)::int from public.professional_contract_snapshots), 1, 'one snapshot per key');

-- The draft created by the send (as the function would, through create_signature_request).
select set_config('test.r1', (select r.id::text from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.service_contract',
  'template_version_id', current_setting('test.v1'), 'subject_type', 'professional', 'subject_id', 'c0000000-0000-0000-0000-000000000001',
  'title', 'Contrat de service — Pia Un', 'view_permission', 'professionals.compensation',
  'idempotency_key', 'professionals.service_contract:c0000000-0000-0000-0000-000000000001:k1',
  'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', current_setting('test.prep1')::jsonb -> 'signers')) r), true);
-- Its send failed: « Réessayer » draws another key, the draft is resumed under its own.
update public.signature_requests set last_error = 'provider_unavailable' where id = current_setting('test.r1')::uuid;
select is(public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k2') ->> 'idempotency_key',
  'professionals.service_contract:c0000000-0000-0000-0000-000000000001:k1', 'send with an open draft resumes it under its own key');
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'resend', null) $$),
  'contract', 'resend: nothing out yet (a draft)');

-- Sent: Documenso holds it, the professional's recipient is known.
update public.signature_requests set status = 'sent', envelope_id = 'envelope_contractone', sent_at = now(), last_error = null,
       expires_at = now() + interval '7 days'
 where id = current_setting('test.r1')::uuid;
update public.signature_request_signers set documenso_recipient_id = case role when 'professional' then '11' else '12' end
 where request_id = current_setting('test.r1')::uuid;
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'send', 'k3') $$),
  'contract', 'send while a contract is out: refused (HINT contract)');
select is(public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'resend', null),
  jsonb_build_object('resend', jsonb_build_object('request_id', current_setting('test.r1'), 'envelope_id', 'envelope_contractone', 'recipient_ids', '["11"]'::jsonb)),
  'resend: the envelope and the next signer''s recipient');
select set_config('test.prep4', public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'k4')::text, true);
select results_eq($$ select p ->> 'idempotency_key', p -> 'cancel', (p -> 'annexe' -> 'in_force' ->> 'retention_pct')::numeric
                       from (select current_setting('test.prep4')::jsonb p) x $$,
  $$ values ('professionals.service_contract:c0000000-0000-0000-0000-000000000001:k4'::text,
             jsonb_build_object('request_id', current_setting('test.r1'), 'envelope_id', 'envelope_contractone', 'status', 'sent'), 26.00) $$,
  'regenerate: a new key, the open request to close first, today''s terms');

-- The function closed it and sent the new one; a double click on « Régénérer » is the same action.
select ok(public.cancel_signature_request(current_setting('test.r1')::uuid, 'a0000000-0000-0000-0000-000000000001'), 'the old request is cancelled');
select set_config('test.r2', (select r.id::text from public.create_signature_request(jsonb_build_object(
  'org_id', 'b0000000-0000-0000-0000-00000000000a', 'module_key', 'professionals', 'purpose', 'professionals.service_contract',
  'template_version_id', current_setting('test.v1'), 'subject_type', 'professional', 'subject_id', 'c0000000-0000-0000-0000-000000000001',
  'title', 'Contrat de service — Pia Un', 'view_permission', 'professionals.compensation',
  'idempotency_key', 'professionals.service_contract:c0000000-0000-0000-0000-000000000001:k4',
  'sent_by', 'a0000000-0000-0000-0000-000000000001',
  'signers', current_setting('test.prep4')::jsonb -> 'signers')) r), true);
update public.signature_requests set status = 'sent', envelope_id = 'envelope_contracttwo', sent_at = now(), expires_at = now() + interval '7 days'
 where id = current_setting('test.r2')::uuid;
select is(public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'k4') -> 'cancel',
  'null'::jsonb, 'regenerate with the same key never closes its own request');

-- =============================================================================
-- The card (get_professional_contract)
-- =============================================================================
update public.signature_requests set status = 'viewed', viewed_at = now() where id = current_setting('test.r2')::uuid;
update public.signature_request_signers set status = 'viewed', viewed_at = now()
 where request_id = current_setting('test.r2')::uuid and role = 'professional';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.card', public.get_professional_contract('c0000000-0000-0000-0000-000000000001')::text, true);
select results_eq($$ select c -> 'request' ->> 'id', c -> 'request' ->> 'status', (c -> 'request' ->> 'can_read')::boolean,
                            c -> 'request' -> 'signed_file_id', c -> 'request' ->> 'template_version'
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values (current_setting('test.r2'), 'viewed'::text, false, 'null'::jsonb, '1'::text) $$,
  'the conseillère sees the latest request''s state, never its file (the pay is in it, P4-435)');
select is(current_setting('test.card')::jsonb -> 'request' -> 'signers' -> 0 ->> 'status', 'viewed', 'and each signer''s progress');
select results_eq($$ select (c -> 'template' ->> 'published_version')::int, (c ->> 'clinic_signer')::boolean
                       from (select current_setting('test.card')::jsonb c) x $$,
  $$ values (1, true) $$, 'the published version and whether the clinic signs');
select is((select count(*)::int from public.signature_requests), 0, 'she cannot read the requests themselves (view permission professionals.compensation)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.get_professional_contract('c0000000-0000-0000-0000-000000000001') -> 'request' ->> 'can_read')::boolean, true,
  'the admin may open what was sent');
select ok(public.get_professional_contract('c0000000-0000-0000-0000-000000000002') -> 'request' = 'null'::jsonb,
  'a file without any contract: no request');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(public.get_professional_contract('c0000000-0000-0000-0000-000000000001') is null, 'another clinic reads null');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_contract('c0000000-0000-0000-0000-000000000003') $$, '42501', null,
  'the provider (no professionals.view) has no card');
reset role;

-- =============================================================================
-- Readiness: contract_signed
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select r.contract_signed from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001'), false,
  'out for signature: not signed');
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') -> 'items' -> 3,
  '{"key": "contract_signed", "done": false, "missing": []}'::jsonb, 'the fourth readiness item');
select is((public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') ->> 'total')::int, 4, 'four items');
reset role;

-- Signed (the webhook stored the PDF: complete_signature_request).
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                 original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
values ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
        'b0000000-0000-0000-0000-00000000000a/core/' || current_setting('test.r2') || '/f0000000-0000-0000-0000-000000000001.pdf',
        'core', 'signing_signed', 'signature_request', current_setting('test.r2')::uuid, 'professionals.compensation',
        'Contrat signé.pdf', 'application/pdf', 'pdf', 1000, repeat('a', 64), 'ready', now());
update public.signature_requests set status = 'signed', completed_event_at = now(), completed_at = now(),
       signed_file_id = 'f0000000-0000-0000-0000-000000000001', signed_sha256 = repeat('a', 64)
 where id = current_setting('test.r2')::uuid;
update public.signature_request_signers set status = 'signed', signed_at = now() where request_id = current_setting('test.r2')::uuid;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$ select r.contract_signed, r.ready, r.ready = (r.matching_complete and r.account_created and r.submission_approved and r.contract_signed)
                       from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values (true, false, true) $$, 'signed: the item is done for the conseillère too; ready needs every item');
select is(public.get_professional_contract('c0000000-0000-0000-0000-000000000001') -> 'request' -> 'signed_file_id', 'null'::jsonb,
  'the conseillère never gets the signed file');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_professional_contract('c0000000-0000-0000-0000-000000000001') -> 'request' ->> 'signed_file_id',
  'f0000000-0000-0000-0000-000000000001', 'the admin does');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.professionals_readiness r where r.contract_signed), 0, 'another clinic sees no signed contract of org A');
reset role;

select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'regenerate', 'k5') $$),
  'contract', 'a signed contract cannot be regenerated (HINT contract)');

-- A later request that was rejected: only the latest counts (A10.9).
insert into public.signature_requests (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, rejected_at, created_at)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract', current_setting('test.v1')::uuid,
        'professional', 'c0000000-0000-0000-0000-000000000001', 'Contrat de service — Pia Un', 'rejected', 'envelope_contractthree',
        'contract-later', 'professionals.compensation', now(), now(), now() + interval '1 minute');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select r.contract_signed from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001'), false,
  'a later rejected request: not signed any more');
reset role;
delete from public.signature_requests where idempotency_key = 'contract-later';

-- The provider's own file (professionals.self): the helper answers for it alone.
insert into public.signature_requests (org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                       envelope_id, idempotency_key, view_permission, sent_at, completed_event_at, completed_at,
                                       signed_file_id, signed_sha256)
values ('b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.service_contract', current_setting('test.v1')::uuid,
        'professional', 'c0000000-0000-0000-0000-000000000003', 'Contrat de service — Nora Trois', 'signed', 'envelope_contractnora',
        'contract-nora', 'professionals.compensation', now(), now(), now(), 'f0000000-0000-0000-0000-000000000001', repeat('a', 64));
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_eq($$ select * from private.professional_signed_contracts() $$, array['c0000000-0000-0000-0000-000000000003'::uuid],
  'the provider learns only about her own contract');
reset role;

-- =============================================================================
-- Inactive file
-- =============================================================================
update public.professionals set status = 'inactive',
       deactivation_reason_id = (select r.id from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave')
 where id = 'c0000000-0000-0000-0000-000000000002';
select is(private.test_error_hint($$ select public.prepare_professional_contract('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'send', 'k6') $$),
  'status', 'an inactive file gets no contract');

-- =============================================================================
-- History (the admin)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.hist', (select coalesce(jsonb_agg(jsonb_build_object('t', h.table_name, 's', h.changed_fields -> 'status' -> 'after') order by h.id), '[]')::text
                                 from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
                                where h.table_name in ('signature_requests', 'signature_request_signers')), true);
select ok(current_setting('test.hist')::jsonb @> '[{"t": "signature_requests", "s": "sent"}, {"t": "signature_requests", "s": "cancelled"},
                                                   {"t": "signature_requests", "s": "signed"}, {"t": "signature_request_signers", "s": "signed"}]'::jsonb,
  'the history lists the contract''s status moves and the signers''');
select is_empty($$ select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
                    where h.table_name in ('signature_requests', 'signature_request_signers')
                      and (h.action <> 'update' or not (h.changed_fields ? 'status')
                           or (h.table_name = 'signature_request_signers' and not (h.changed_fields ? 'role'))) $$,
  'never an insert, a claim or a stamp; a signer''s row names its role');
select is_empty($$ select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000002', null, 200) h
                    where h.table_name = 'signature_requests' $$,
  'another professional''s history holds none of it');
select is_empty($$ select 1 from public.list_professional_history('c0000000-0000-0000-0000-000000000001', null, 200) h
                    where h.changed_fields::text ~ '(Pia Un|pia@exemple)' $$,
  'no title, name or address in those rows');
reset role;

select * from finish();
rollback;
