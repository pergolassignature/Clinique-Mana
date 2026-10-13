-- Demandes, the parity gaps (migration *_demandes_parity.sql): the intake's follow-up questions
-- (« Non » clears them, codes checked, types checked), who a proposal books (the request's file
-- and the participants' others, two at most), the match filling the files' primary professional,
-- and the consents of the request's files read live.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'demande_consents'
     and (not p.prosecdef or not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'demande_consents: SECURITY DEFINER, authenticated, not anon');
select is_empty($$
  select p.proname from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('demandes_booking_clients', 'demandes_clear_followups', 'demandes_codes')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the helpers are granted to no role');
select has_column('public', 'demandes', 'legal_context', 'the legal context');
select hasnt_column('public', 'demandes', 'diagnostic_status', 'no diagnostic field (D8)');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@pa.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A'), ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.demandes (id, org_id, reference, reference_year, reference_seq, contact_name)
values ('e0000000-0000-0000-0000-0000000000bb', 'b0000000-0000-0000-0000-00000000000b', 'DEM-2026-9001', 2026, 9001, 'Ailleurs');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u1@pa.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'u2@pa.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled)
select 'b0000000-0000-0000-0000-00000000000a', m, true from (values ('professionals'), ('clients'), ('demandes')) y(m);
insert into public.professionals (id, org_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Hélène', 'Psy', 'p1@pa.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Marie', 'Autre', 'p2@pa.test', 'active');
insert into public.clients (id, org_id, first_name, last_name, primary_professional_id) values
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Alice', 'Couple', null),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Bruno', 'Couple', 'c0000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Chloé', 'Famille', null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- =============================================================================
-- B-2: the follow-up questions
-- =============================================================================
select set_config('test.d', public.create_demande(jsonb_build_object(
  'client_id', 'd0000000-0000-0000-0000-000000000001', 'beneficiary', 'couple',
  'has_issues', true, 'issues', array['other', 'coparenting', 'other'], 'issues_comment', 'Garde partagée',
  'previous_therapy', true, 'previous_professionals', array['psychologist', 'physician'], 'previous_comment', 'Il y a deux ans',
  'has_legal_context', true, 'legal_context', array['dpj'], 'legal_detail', 'Suivi en cours',
  'motif_other', 'Deuil d''un animal', 'availability_other', 'Le vendredi midi'))::text, true);
select results_eq($$ select has_issues, issues, issues_comment, previous_professionals, legal_context, legal_detail, motif_other, availability_other
                       from public.demandes where id = current_setting('test.d')::uuid $$,
  $$ values (true, array['coparenting', 'other'], 'Garde partagée', array['physician', 'psychologist'], array['dpj'], 'Suivi en cours',
             'Deuil d''un animal', 'Le vendredi midi') $$,
  'create_demande keeps the follow-ups (codes distinct and sorted)');

select lives_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"has_issues": false}') $$, '« Enjeux » set to Non');
select results_eq($$ select has_issues, issues, issues_comment from public.demandes where id = current_setting('test.d')::uuid $$,
  $$ values (false, '{}'::text[], null::text) $$, '« Non » clears the issues and their comment');

select lives_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"previous_therapy": null, "has_legal_context": false}') $$,
  'no answer, and Non');
select results_eq($$ select previous_professionals, previous_comment, legal_context, legal_detail from public.demandes where id = current_setting('test.d')::uuid $$,
  $$ values ('{}'::text[], null::text, '{}'::text[], null::text) $$, 'no answer and « Non » clear what follows');

select lives_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"has_legal_context": true, "legal_context": ["court_order"], "legal_detail": "Ordonnance"}') $$,
  'Oui again, with the details');
select results_eq($$ select legal_context, legal_detail from public.demandes where id = current_setting('test.d')::uuid $$,
  $$ values (array['court_order'], 'Ordonnance') $$, 'the legal context kept');
select lives_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"legal_context": ["court_order"], "has_legal_context": true, "has_issues": false, "issues": ["other"]}') $$,
  'issues given while the answer is Non');
select is((select issues from public.demandes where id = current_setting('test.d')::uuid), '{}'::text[], 'ignored: « Non » holds no follow-up');

select throws_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"has_issues": true, "issues": ["diagnostic"]}') $$,
  '23514', null, 'an unknown code is refused');
select throws_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"issues": "coparenting"}') $$,
  '22023', null, 'a list must be a list');
select throws_ok($$ select public.update_demande(current_setting('test.d')::uuid, '{"has_issues": "oui"}') $$,
  '22023', null, 'a yes / no must be a boolean');

-- =============================================================================
-- B-1: who a proposal books
-- =============================================================================
reset role;
select throws_ok($$ select private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', current_setting('test.d')::uuid, true) $$,
  'P0001', 'Ce service se réserve pour deux personnes : ajoutez le dossier de la deuxième personne (onglet Participants).',
  'a couple service with one file: add the second person''s');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_participants(current_setting('test.d')::uuid, jsonb_build_array(
  jsonb_build_object('client_id', 'd0000000-0000-0000-0000-000000000002', 'relationship', 'partner', 'is_primary', false),
  jsonb_build_object('client_id', 'd0000000-0000-0000-0000-000000000001', 'relationship', 'self', 'is_primary', true)));
reset role;
select is(private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', current_setting('test.d')::uuid, true),
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[],
  'the request''s file first, then the other participant''s: both booked');
select is(private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', current_setting('test.d')::uuid, false),
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[],
  'any service books every file (two at most)');
insert into public.demande_participants (demande_id, org_id, client_id, relationship)
values (current_setting('test.d')::uuid, 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'child');
select throws_ok($$ select private.demandes_booking_clients('b0000000-0000-0000-0000-00000000000a', current_setting('test.d')::uuid, false) $$,
  'P0001', null, 'three files: an appointment counts two clients at most');
delete from public.demande_participants where client_id = 'd0000000-0000-0000-0000-000000000003';

-- =============================================================================
-- A-6: the match fills the primary professional
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_state(current_setting('test.d')::uuid, 'accepted');
select lives_ok($$ select public.set_demande_state(current_setting('test.d')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000001') $$,
  '« Jumelée » by hand, with a professional');
reset role;
select results_eq($$ select id, primary_professional_id from public.clients
                      where id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002') order by id $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'c0000000-0000-0000-0000-000000000001'::uuid),
            ('d0000000-0000-0000-0000-000000000002'::uuid, 'c0000000-0000-0000-0000-000000000002'::uuid) $$,
  'the file without a primary professional gets her; the other keeps its own');
select is((select count(*)::int from public.client_professional_links
            where professional_id = 'c0000000-0000-0000-0000-000000000001'
              and client_id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002')), 2,
  'both files linked to her');

-- Matched again, to another: the file the first match filled moves to her (D-41: p_replace).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_demande_state(current_setting('test.d')::uuid, 'accepted');
select public.set_demande_state(current_setting('test.d')::uuid, 'matched', null, 'c0000000-0000-0000-0000-000000000002');
reset role;
select is((select primary_professional_id from public.clients where id = 'd0000000-0000-0000-0000-000000000001'),
  'c0000000-0000-0000-0000-000000000002'::uuid, 'matched again: the primary professional the first match set is replaced');

-- The follow-ups' free text never reaches the journal.
select is((select count(*)::int from public.audit_log a where a.table_name = 'demandes' and a.record_id = current_setting('test.d')
             and (strpos(a::text, 'Garde partagée') > 0 or strpos(a::text, 'Il y a deux ans') > 0
                  or strpos(a::text, 'Suivi en cours') > 0 or strpos(a::text, 'Deuil d''un animal') > 0)), 0,
  'the comments and « Autre motif » are redacted in the audit');

-- =============================================================================
-- B-4: the consents, live
-- =============================================================================
update public.client_consent_rules set is_active = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and consent_key = 'general';
insert into public.client_consents (org_id, client_id, consent_key, language, version_label, signed_at, source)
values ('b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'general', 'fr', 'v1', now() - interval '1 day', 'import');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (f ->> 'client_id')::uuid, c ->> 'key', c ->> 'state'
                       from jsonb_array_elements(public.demande_consents(current_setting('test.d')::uuid)) f
                       cross join jsonb_array_elements(f -> 'consents') c $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'general', 'signed'),
            ('d0000000-0000-0000-0000-000000000002'::uuid, 'general', 'missing') $$,
  'per file, in order: the general consent signed for one, missing for the other');
select is(public.demande_consents(gen_random_uuid()), null, 'an unknown request: null');
select is(public.demande_consents('e0000000-0000-0000-0000-0000000000bb'), null, 'another clinic''s request: null');
reset role;
-- The payer kind (PAE → Clients' `pae`), the matched professional's status (an intern: she has a
-- supervisor), and a request sent but past its due date (« en retard »).
update public.demandes set payer_kind = 'eap' where id = current_setting('test.d')::uuid;
update public.professionals set supervisor_professional_id = 'c0000000-0000-0000-0000-000000000001' where id = 'c0000000-0000-0000-0000-000000000002';
update public.client_consent_rules set is_active = true where org_id = 'b0000000-0000-0000-0000-00000000000a' and consent_key in ('eap', 'intern');
insert into public.client_consent_requests (org_id, client_id, consent_key, language, template_version_id, due_at)
select 'b0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'general', 'en', v.id, now() - interval '1 day'
  from public.document_template_versions v join public.document_templates t on t.id = v.template_id
 where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'clients.consent_general_en' and v.version = 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select (f ->> 'client_id')::uuid, c ->> 'key', c ->> 'state'
                       from jsonb_array_elements(public.demande_consents(current_setting('test.d')::uuid)) f
                       cross join jsonb_array_elements(f -> 'consents') c $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'general', 'signed'),
            ('d0000000-0000-0000-0000-000000000001'::uuid, 'intern', 'missing'),
            ('d0000000-0000-0000-0000-000000000001'::uuid, 'eap', 'missing'),
            ('d0000000-0000-0000-0000-000000000002'::uuid, 'general', 'overdue'),
            ('d0000000-0000-0000-0000-000000000002'::uuid, 'intern', 'missing'),
            ('d0000000-0000-0000-0000-000000000002'::uuid, 'eap', 'missing') $$,
  'the PAE payer and the intern professional add their consents; a request past its date is late');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.demande_consents(current_setting('test.d')::uuid) $$, '42501', null, 'a provider reads none');
reset role;

select * from finish();
rollback;
