-- Professionnels onboarding (migration *_professionals_onboarding.sql, plan Phase 4 Task 4b.1).
-- Covers: catalogue rows (permissions and role defaults, the link purpose, the upload purpose, the
-- four email templates, settings and their rules, consent version 1 per clinic); privileges (tables,
-- the service-role RPCs and purpose handlers, the user RPCs, the private helpers, over pg_proc);
-- invitations (service role with an actor: link, status, onboarding draft and prefill, a new link
-- revokes the previous one, the clinic's lifetime, the actor's permission, clinic and module,
-- refusals); resolve; acceptance (profile, role provider and link in one transaction, audit as the
-- new account, link_used / link_expired / link_invalid, the inviter re-check rolling the consumption
-- back, an address that does not match); revocation and deactivation (links revoked); the provider's
-- questionnaire (draft normalisation, every refusal of the staff paths through the rolled-back dry
-- run, restricted motifs across sections, files, insurance dates, unknown and private keys, the
-- client limits and « Fin de journée » of the website catalogue, P4-245, P4-250);
-- private answers (encrypted at once, never in the draft or the audit, masks, collect_sin, blank
-- keeps, one key version per row during a rotation, a clean P0001 for an unreadable kept value);
-- consent signature; submit (gaps, status, notice); isolation (provider's own row only, other
-- clinic, roles); review (diff, private fields without values); apply (some and all, one
-- transaction rolled back by any refusal, files attached, consent row, private data moved and the
-- submission's copy deleted, the adjointe without professionals.private); reject; update requests;
-- readiness items; invitation states (precedence); the record bundle; history; pii_encrypted_values.
-- Security review (P4-300 … P4-308): the link bound to the address (scope, set_professional_email,
-- a forced mismatch, the new link); private answers closed with the submission (revocation,
-- deactivation, account removal, the 90-day purge job); partial saves (only the keys given, merged;
-- unanswered fields never applied); the SIN path (collect_sin on, Luhn, last three digits, rotation,
-- unreadable at save and at apply, applied, collect_sin off before apply); inactive files; refusals
-- at acceptance (disabled inviter, existing profile); self-review; consent and insurance re-checked
-- at apply; draft consent text; staged files of another submission; reminder before expiry.
begin;
create extension if not exists pgtap with schema extensions;
select plan(317);

-- The HINT / DETAIL of the error p_sql raises (null when none): throws_ok checks code and message.
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
create function private.test_error_detail(p_sql text) returns text
language plpgsql set search_path = '' as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return nullif(v_detail, '');
end;
$$;
grant execute on function private.test_error_hint(text), private.test_error_detail(text) to authenticated, service_role;

-- =============================================================================
-- Fixtures (as postgres): org A (admin, adjointe, provider linked to P2, conseillère), org B (admin).
-- Auth users without a profile for the accepted invitations (06: P1's address, 08: P5's, 09: P7's
-- corrected address) and one with another address (07); 10 has P8's address and a profile in org B.
-- P1, P5, P6, P7, P8 drafts and P4 inactive in org A; P2 active; P3 in org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1@exemple.test',    '', now(), '{"invite_link_id": "x"}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'autre@exemple.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5@exemple.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p7-nouveau@exemple.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p8@exemple.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active'),
  ('a0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000b', 'P8 ailleurs',   'p8@exemple.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, deactivation_reason_id) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test', 'active', null),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', null, 'Paz', 'Quatre', 'p4@exemple.test', 'inactive',
   (select r.id from public.deactivation_reasons r where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave')),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', null, 'Pom', 'Cinq', 'p5@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', null, 'Pio', 'Six', 'p6@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', null, 'Pac', 'Sept', 'p7@exemple.test', 'draft', null),
  ('c0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', null, 'Pep', 'Huit', 'p8@exemple.test', 'draft', null);
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_languages (org_id, professional_id, language_id)
select p.org_id, p.id, l.id from public.professionals p join public.languages l on l.org_id = p.org_id and l.code = 'fr'
 where p.id::text like 'c0000000-0000-0000-0000-00000000000_';

select set_config('test.a', 'b0000000-0000-0000-0000-00000000000a', true);
select set_config('test.p1', 'c0000000-0000-0000-0000-000000000001', true);
select set_config('test.p2', 'c0000000-0000-0000-0000-000000000002', true);
select set_config('test.p3', 'c0000000-0000-0000-0000-000000000003', true);
select set_config('test.p4', 'c0000000-0000-0000-0000-000000000004', true);
select set_config('test.p5', 'c0000000-0000-0000-0000-000000000005', true);
select set_config('test.p6', 'c0000000-0000-0000-0000-000000000006', true);
select set_config('test.p7', 'c0000000-0000-0000-0000-000000000007', true);
select set_config('test.p8', 'c0000000-0000-0000-0000-000000000008', true);
select set_config('test.leave', (select r.id::text from public.deactivation_reasons r
                                  where r.org_id = 'b0000000-0000-0000-0000-00000000000a' and r.key = 'leave'), true);
-- Reference rows are taken from the clinic's catalogue by their properties, never by key: the
-- motif and clientèle lists are catalogue data (they are being replaced by the website's).
-- « psy »: a title from an order without a licence pattern; « naturo »: a title without an order.
select set_config('test.psy',    (select t.id::text from public.profession_titles t
                                    join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
                                   where t.org_id = current_setting('test.a')::uuid and t.is_active and o.licence_pattern is null
                                   order by t.sort_order, t.id limit 1), true);
select set_config('test.naturo', (select t.id::text from public.profession_titles t
                                   where t.org_id = current_setting('test.a')::uuid and t.is_active and t.order_id is null
                                   order by t.sort_order, t.id limit 1), true);
select set_config('test.fr',     (select l.id::text from public.languages l where l.org_id = current_setting('test.a')::uuid and l.code = 'fr'), true);
select set_config('test.en',     (select l.id::text from public.languages l where l.org_id = current_setting('test.a')::uuid and l.is_active and l.code <> 'fr'
                                   order by l.sort_order, l.id limit 1), true);
select set_config('test.adults', (select c.id::text from public.clienteles c where c.org_id = current_setting('test.a')::uuid and c.is_active
                                   order by c.sort_order, c.id limit 1), true);
-- Three unrestricted motifs: « anxiete » (archived later), « deuil », « psychose » (made restricted).
create temp table test_motifs on commit drop as
  select m.id, m.name, row_number() over (order by m.sort_order, m.id) as n
    from public.motifs m where m.org_id = current_setting('test.a')::uuid and m.is_active and not m.is_restricted;
select set_config('test.anxiete',  (select id::text from test_motifs where n = 1), true);
select set_config('test.deuil',    (select id::text from test_motifs where n = 2), true);
select set_config('test.psychose', (select id::text from test_motifs where n = 3), true);
select set_config('test.anxiete_name',  (select name from test_motifs where n = 1), true);
select set_config('test.psychose_name', (select name from test_motifs where n = 3), true);
select set_config('test.b_motif',  (select m.id::text from public.motifs m where m.org_id = 'b0000000-0000-0000-0000-00000000000b' and m.is_active limit 1), true);
update public.motifs set is_restricted = true where id = current_setting('test.psychose')::uuid;

-- Staged uploads: 01 photo (PNG) and 02 insurance (PDF) by P1's future account, 03 a PDF by it (their
-- uploader and subject, P1's submission, are set once that account has a profile, below), 04 a PNG by
-- provider A, 05 a PNG by P1's account staged for another submission.
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until, uploaded_by, confirmed_at)
select f.id, current_setting('test.a')::uuid, 'documents',
       current_setting('test.a') || '/professionals/d0000000-0000-0000-0000-000000000001/' || f.id || '.' || f.ext,
       'professionals', 'professional_submission_file', 'professional_submission', 'd0000000-0000-0000-0000-000000000001',
       'fichier.' || f.ext, f.mime, f.ext, 2048, repeat('a', 64), 'ready', 'professionals.review', null, null,
       now() + interval '60 days', case when f.uploader = 'a0000000-0000-0000-0000-000000000003' then f.uploader end, now()
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'image/png', 'png', 'a0000000-0000-0000-0000-000000000006'::uuid),
    ('e0000000-0000-0000-0000-000000000002', 'application/pdf', 'pdf', 'a0000000-0000-0000-0000-000000000006'),
    ('e0000000-0000-0000-0000-000000000003', 'application/pdf', 'pdf', 'a0000000-0000-0000-0000-000000000006'),
    ('e0000000-0000-0000-0000-000000000004', 'image/png', 'png', 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000005', 'image/png', 'png', 'a0000000-0000-0000-0000-000000000006')
  ) as f(id, mime, ext, uploader);

update public.stored_files set subject_id = 'd0000000-0000-0000-0000-000000000009', object_path = replace(object_path, 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000009')
 where id = 'e0000000-0000-0000-0000-000000000005';

select set_config('test.audit_start', (select coalesce(max(id), 0)::text from public.audit_log), true);

-- =============================================================================
-- Catalogue rows
-- =============================================================================
select results_eq($$ select key, description from public.permissions where key in ('professionals.invite', 'professionals.review') order by key $$,
  $$ values ('professionals.invite'::text, 'Inviter les professionnels et demander des mises à jour'::text),
            ('professionals.review', 'Réviser et appliquer les soumissions') $$, 'the two permissions');
select set_eq($$ select role || ':' || permission_key from public.org_role_permissions
                  where org_id = current_setting('test.a')::uuid and permission_key in ('professionals.invite', 'professionals.review') $$,
  array['admin:professionals.invite', 'admin:professionals.review', 'admin_assistant:professionals.invite', 'admin_assistant:professionals.review'],
  'defaults: admin and adjointe in every clinic');
select results_eq($$ select module_key, default_ttl, max_ttl, max_uses, requires_session, creates_account, resolve_rpc, accept_rpc, view_permission
                       from public.secure_link_purposes where key = 'professional_invite' $$,
  $$ values ('professionals'::text, interval '7 days', interval '30 days', 1, false, true, 'resolve_professional_invitation'::text,
             'link_professional_account'::text, 'professionals.view'::text) $$, 'the link purpose names its handlers');
select results_eq($$ select bucket, upload_permission, view_permission, owner_permission, max_bytes, mime_types, retain_days
                       from public.upload_purposes where key = 'professional_submission_file' $$,
  $$ values ('documents'::text, 'professionals.self'::text, 'professionals.review'::text, 'professionals.self'::text, 10485760,
             array['application/pdf', 'image/jpeg', 'image/png'], 60) $$, 'the staged upload purpose (60 days)');
select set_eq($$ select key || ':' || recipient_mode || ':' || allows_attachments || ':' || view_permission from public.email_template_defaults
                  where module_key = 'professionals' $$,
  array['professionals.invite:subject:false:professionals.view', 'professionals.invite_reminder:subject:false:professionals.view',
        'professionals.profile_update:subject:false:professionals.view', 'professionals.submission_received:subject:false:professionals.view',
        'professionals.fiche:free:true:professionals.view',
        'professionals.document_rejected:subject:false:professionals.view', 'professionals.document_expiring:subject:false:professionals.view',
        'professionals.document_expired:subject:false:professionals.view',
        'professionals.document_expired_reminder:subject:false:professionals.view'],
  'the four onboarding email templates, the fiche''s (054) and the four documents ones (061)');
select is_empty($$ select key from public.email_template_defaults
                    where module_key = 'professionals'
                      and (subject || body || coalesce(button_label, '')) ~* '(diagnostic|trouble|patient|th[ée]rapie)' $$,
  'the templates use no clinical word');
select results_eq($$ select c.org_id, c.version, c.title, c.published_at is not null from public.consent_versions c
                      where c.key = 'image_rights' and c.org_id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b')
                      order by c.org_id $$,
  $$ values ('b0000000-0000-0000-0000-00000000000a'::uuid, 1, 'Consentement au droit à l''image'::text, true),
            ('b0000000-0000-0000-0000-00000000000b'::uuid, 1, 'Consentement au droit à l''image'::text, true) $$,
  'version 1 of the consent is published for every new clinic');
select ok((select body like '%vous autorisez Org A à utiliser%' and body like '%12 mois%' and body like '%préavis écrit de 3 mois%'
             from public.consent_versions where org_id = current_setting('test.a')::uuid and key = 'image_rights'),
  'the consent names the clinic, the 12 months and the 3-month notice');

-- =============================================================================
-- Privileges (as postgres)
-- =============================================================================
select table_privs_are('public', 'professional_submissions', 'authenticated', array[]::text[],
  'authenticated: no table-wide select on submissions (columns without answers only, P4-420)');
select table_privs_are('public', 'professional_submissions', 'anon', array[]::text[], 'anon: nothing on submissions');
select table_privs_are('public', 'professional_submission_private', 'authenticated', array[]::text[], 'authenticated: nothing on the private answers');
select table_privs_are('public', 'professional_submission_private', 'anon', array[]::text[], 'anon: nothing on the private answers');
select table_privs_are('public', 'professional_submission_private', 'service_role', array[]::text[], 'service_role: nothing on the private answers (revoked)');
select table_privs_are('public', 'consent_versions', 'authenticated', array['SELECT'], 'authenticated: select only on consent versions');
select table_privs_are('public', 'professional_consents', 'authenticated', array['SELECT'], 'authenticated: select only on consents');
select is((select count(*)::int from pg_class c where c.oid in ('public.professional_submissions'::regclass, 'public.professional_submission_private'::regclass,
                                                               'public.consent_versions'::regclass, 'public.professional_consents'::regclass)
                                                 and c.relrowsecurity), 4, 'RLS on the four tables');
select is((select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'professional_submission_private'), 0,
  'the private answers have no policy');

select function_privs_are('public', 'create_professional_invitation', array['uuid', 'uuid', 'bytea'], 'service_role', array['EXECUTE'], 'service_role creates invitations');
select function_privs_are('public', 'create_professional_invitation', array['uuid', 'uuid', 'bytea'], 'authenticated', array[]::text[], 'a user never chooses the token hash');
select function_privs_are('public', 'resolve_professional_invitation', array['uuid'], 'authenticated', array[]::text[], 'resolve: service role only');
select function_privs_are('public', 'resolve_professional_invitation', array['uuid'], 'service_role', array['EXECUTE'], 'resolve-link may resolve');
select function_privs_are('public', 'link_professional_account', array['bytea', 'uuid', 'jsonb'], 'authenticated', array[]::text[], 'accept: service role only');
select function_privs_are('public', 'link_professional_account', array['bytea', 'uuid', 'jsonb'], 'anon', array[]::text[], 'accept: not anon');
select function_privs_are('public', 'link_professional_account', array['bytea', 'uuid', 'jsonb'], 'service_role', array['EXECUTE'], 'accept-invite may accept');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('revoke_professional_invitation', 'request_professional_update', 'list_professional_invitation_states',
                       'get_professional_onboarding', 'get_my_submission', 'save_my_submission_draft', 'save_my_submission_private', 'sign_my_consent',
                       'submit_my_submission', 'get_my_professional_private', 'start_my_profile_update', 'get_submission_review',
                       'apply_professional_submission', 'reject_professional_submission')
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
          or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or not has_function_privilege('authenticated', p.oid, 'execute') or not p.prosecdef)
$$, 'the user RPCs are security definer and executable by authenticated only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('create_professional_invitation', 'resolve_professional_invitation', 'link_professional_account',
                                'revoke_professional_invitation', 'request_professional_update', 'list_professional_invitation_states',
                                'get_professional_onboarding', 'get_my_submission', 'save_my_submission_draft', 'save_my_submission_private', 'sign_my_consent',
                                'submit_my_submission', 'get_my_professional_private', 'start_my_profile_update', 'get_submission_review',
                                'apply_professional_submission', 'reject_professional_submission')),
  17, 'seventeen new RPCs, none overloaded');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('submission_fields', 'submission_sections', 'normalize_submission_sections', 'seed_professionals_consent',
                       'current_consent_version', 'assert_restricted_motifs_ok', 'apply_professional_motifs', 'apply_professional_clienteles',
                       'apply_professional_languages', 'parse_profession_items',
                       'apply_professional_professions', 'professional_submission_snapshot', 'canonical_professions',
                       'create_professional_submission', 'submission_string', 'submission_label', 'submission_long_text', 'submission_phone',
                       'submission_uuid', 'submission_uuid_array', 'assert_submission_file', 'normalize_submission_section',
                       'dry_run_submission_sets', 'submission_gaps', 'professional_onboarding_states', 'my_professional_id', 'lock_my_draft',
                       'unreadable_submission_field', 'submission_available_fields', 'apply_submission_private')
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
          or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the private helpers are granted to no role');
select hasnt_function('public', 'set_professional_approaches', 'no approaches path is added (P4-276)');
select has_index('public', 'professional_submissions', 'professional_submissions_open_key', 'one open submission per professional');

-- =============================================================================
-- Settings
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.get_professionals_settings(), '{"collect_sin": false, "invitation_expiry_days": 7, "invitation_reminder_after_days": 3, "fiche_show_pro_contact": true, "fiche_show_clinic_footer": true, "fiche_show_closing": true}'::jsonb,
  'the invitation settings and their defaults');
select throws_ok($$ select public.set_professionals_settings('{"invitation_expiry_days": 31}') $$, '22023', null, 'expiry: at most 30 days');
select throws_ok($$ select public.set_professionals_settings('{"invitation_expiry_days": 2.5}') $$, '22023', null, 'expiry: whole days');
select throws_ok($$ select public.set_professionals_settings('{"invitation_expiry_days": null}') $$, '22023', null, 'expiry: never null');
select throws_ok($$ select public.set_professionals_settings('{"invitation_reminder_after_days": 0}') $$, '22023', null, 'reminder: at least 1 day');
select throws_ok($$ select public.set_professionals_settings('{"invitation_reminder_after_days": 7}') $$, 'P0001',
  'Le rappel doit partir avant la fin de validité du lien : choisissez un délai plus court que sa durée de validité.',
  'the reminder leaves before the link expires (P4-308)');
select is(private.test_error_hint($$ select public.set_professionals_settings('{"invitation_expiry_days": 3}') $$), 'invitation_reminder_after_days',
  '… also when the lifetime is shortened under the reminder (HINT the reminder)');
select is(public.set_professionals_settings('{"invitation_reminder_after_days": null}') -> 'invitation_reminder_after_days', 'null'::jsonb,
  'reminder: null turns it off');
reset role;

-- =============================================================================
-- Invitation (service role, the actor named)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv1', public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', current_setting('test.p1')::uuid,
  extensions.digest('token-1', 'sha256'))::text, true);
select is(current_setting('test.inv1')::jsonb - 'link_id' - 'submission_id' - 'expires_at',
  '{"email": "p1@exemple.test", "first_name": "Paul"}'::jsonb, 'the invitation returns what the email needs');
select ok((current_setting('test.inv1')::jsonb ->> 'expires_at')::timestamptz between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days',
  'the link lasts the clinic''s 7 days');
select throws_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000004', current_setting('test.p1')::uuid,
  extensions.digest('token-x', 'sha256')) $$, '42501', 'Permission refusée : professionals.invite', 'the conseillère cannot invite');
select throws_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000005', current_setting('test.p1')::uuid,
  extensions.digest('token-x', 'sha256')) $$, 'P0001', 'Professionnel introuvable.', 'an actor of another clinic finds nothing');
select throws_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', current_setting('test.p2')::uuid,
  extensions.digest('token-x', 'sha256')) $$, 'P0001', 'Ce professionnel a déjà un compte.', 'a file with an account is not invited');
select throws_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', current_setting('test.p4')::uuid,
  extensions.digest('token-x', 'sha256')) $$, 'P0001', 'Un dossier inactif ne peut pas recevoir d''invitation.', 'nor an inactive one');
select throws_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', current_setting('test.p1')::uuid,
  '\x0102'::bytea) $$, '22023', null, 'a hash that is not 32 bytes is refused');
select throws_ok($$ select public.create_professional_invitation(null, current_setting('test.p1')::uuid,
  extensions.digest('token-x', 'sha256')) $$, '22023', null, 'no actor, no invitation');
reset role;

select results_eq($$ select p.status, p.status_changed_by from public.professionals p where p.id = current_setting('test.p1')::uuid $$,
  $$ values ('invited'::text, 'a0000000-0000-0000-0000-000000000002'::uuid) $$, 'the draft is invited, by the actor');
select results_eq($$ select l.purpose, l.subject_type, l.subject_id, l.created_by, l.token_hash = extensions.digest('token-1', 'sha256')
                       from public.secure_links l where l.id = (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid $$,
  $$ values ('professional_invite'::text, 'professional'::text, current_setting('test.p1')::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, true) $$,
  'the link: the purpose, the professional, the actor; only the token''s hash');
select is((select l.scope from public.secure_links l where l.id = (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid),
  '{"email": "p1@exemple.test"}'::jsonb, 'the link is bound to the file''s address (P4-300)');
select results_eq($$ select s.kind, s.status, s.requested_sections, s.secure_link_id, s.prefill -> 'languages' -> 'language_ids'
                       from public.professional_submissions s where s.id = (current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid $$,
  $$ values ('onboarding'::text, 'draft'::text,
             array['personal', 'professional', 'portrait', 'languages', 'clienteles', 'motifs', 'availability', 'photo',
                   'insurance', 'tax_bank', 'consent'],
             (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid, jsonb_build_array(current_setting('test.fr'))) $$,
  'the onboarding draft: all eleven sections (no « Approches », P4-276), the link, the record''s values as prefill');
select ok(exists (select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                   and a.table_name = 'professionals' and a.record_id = current_setting('test.p1')
                   and a.actor_id = 'a0000000-0000-0000-0000-000000000002' and a.source = 'rpc:create_professional_invitation'),
  'the status change is audited as the actor');

-- A second link revokes the first and reuses the draft; the clinic's lifetime applies.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.set_professionals_settings('{"invitation_expiry_days": 3}');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv2', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', current_setting('test.p1')::uuid,
  extensions.digest('token-2', 'sha256'))::text, true);
reset role;
select is(current_setting('test.inv2')::jsonb ->> 'submission_id', current_setting('test.inv1')::jsonb ->> 'submission_id', 'a new link reuses the onboarding draft');
select ok((select l.revoked_at is not null from public.secure_links l where l.id = (current_setting('test.inv1')::jsonb ->> 'link_id')::uuid),
  'the previous link is revoked');
select ok((current_setting('test.inv2')::jsonb ->> 'expires_at')::timestamptz < now() + interval '3 days 1 minute', 'the new link lasts 3 days');
select is((select s.secure_link_id::text from public.professional_submissions s where s.id = (current_setting('test.inv2')::jsonb ->> 'submission_id')::uuid),
  current_setting('test.inv2')::jsonb ->> 'link_id', 'the draft points at the new link');

-- Module off: the actor holds nothing.
update public.org_modules set enabled = false where org_id = current_setting('test.a')::uuid and module_key = 'professionals';
set local role service_role;
select throws_ok($$ select public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', current_setting('test.p5')::uuid,
  extensions.digest('token-x', 'sha256')) $$, '42501', null, 'module off: no invitation');
reset role;
update public.org_modules set enabled = true where org_id = current_setting('test.a')::uuid and module_key = 'professionals';

-- =============================================================================
-- Resolve and accept (service role)
-- =============================================================================
set local role service_role;
select is(public.resolve_professional_invitation((current_setting('test.inv2')::jsonb ->> 'link_id')::uuid) - 'expires_at',
  '{"clinic_name": "Org A", "display_name": "Paul Un", "email": "p1@exemple.test"}'::jsonb, 'resolve: the clinic, the name, the address');
select ok(public.resolve_professional_invitation((current_setting('test.inv1')::jsonb ->> 'link_id')::uuid) is null, 'resolve: a revoked link shows nothing');
select is(public.link_professional_account(extensions.digest('token-1', 'sha256'), 'a0000000-0000-0000-0000-000000000006', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: a revoked link is invalid');
select is(public.link_professional_account(extensions.digest('unknown', 'sha256'), 'a0000000-0000-0000-0000-000000000006', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: an unknown token is invalid');
select throws_ok($$ select public.link_professional_account(extensions.digest('token-2', 'sha256'), 'a0000000-0000-0000-0000-000000000007', '{}') $$,
  '22023', null, 'accept: an account with another address is refused');
reset role;
select is((select l.use_count from public.secure_links l where l.id = (current_setting('test.inv2')::jsonb ->> 'link_id')::uuid), 0,
  '… and the link stays usable (rolled back)');
set local role service_role;
select is(public.link_professional_account(extensions.digest('token-2', 'sha256'), 'a0000000-0000-0000-0000-000000000006', '{}'),
  '{"status": "accepted", "org_id": "b0000000-0000-0000-0000-00000000000a", "redirect": "/mon-profil/questionnaire"}'::jsonb,
  'accept: the account is linked; the questionnaire is next');
select is(public.link_professional_account(extensions.digest('token-2', 'sha256'), 'a0000000-0000-0000-0000-000000000006', '{}'),
  '{"status": "link_used"}'::jsonb, 'accept again: link_used');
reset role;
select results_eq($$ select pr.org_id, pr.display_name, pr.status, r.role, p.profile_id, p.status
                       from public.profiles pr join public.user_roles r on r.user_id = pr.user_id
                       join public.professionals p on p.profile_id = pr.user_id
                      where pr.user_id = 'a0000000-0000-0000-0000-000000000006' $$,
  $$ values (current_setting('test.a')::uuid, 'Paul Un'::text, 'active'::text, 'provider'::text, 'a0000000-0000-0000-0000-000000000006'::uuid, 'invited'::text) $$,
  'an active profile, the role provider, the professional linked (still invited until the questionnaire is sent)');
select ok(not exists (select 1 from auth.users u where u.id = 'a0000000-0000-0000-0000-000000000006' and u.raw_app_meta_data ? 'invite_link_id'),
  'the orphan marker is removed');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'professionals' and a.record_id = current_setting('test.p1')
                   and a.actor_id = 'a0000000-0000-0000-0000-000000000006' and a.source = 'rpc:link_professional_account'),
  'the link is audited as the new account');

update public.stored_files set uploaded_by = 'a0000000-0000-0000-0000-000000000006',
       subject_id = case when id = 'e0000000-0000-0000-0000-000000000005' then subject_id
                         else (current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid end
 where id in ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003',
              'e0000000-0000-0000-0000-000000000005');

-- P5: an expired link, then an inviter who lost the permission.
set local role service_role;
select set_config('test.inv5', public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', current_setting('test.p5')::uuid,
  extensions.digest('token-5', 'sha256'))::text, true);
reset role;
update public.secure_links set created_at = now() - interval '10 days', expires_at = now() - interval '1 day'
 where id = (current_setting('test.inv5')::jsonb ->> 'link_id')::uuid;
set local role service_role;
select is(public.link_professional_account(extensions.digest('token-5', 'sha256'), 'a0000000-0000-0000-0000-000000000008', '{}'),
  '{"status": "link_expired"}'::jsonb, 'accept: an expired link');
reset role;
update public.secure_links set expires_at = now() + interval '1 day' where id = (current_setting('test.inv5')::jsonb ->> 'link_id')::uuid;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted)
values ('a0000000-0000-0000-0000-000000000002', current_setting('test.a')::uuid, 'professionals.invite', false);
set local role service_role;
select is(public.link_professional_account(extensions.digest('token-5', 'sha256'), 'a0000000-0000-0000-0000-000000000008', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: the inviter no longer holds professionals.invite (P3-31)');
reset role;
select results_eq($$ select l.use_count, p.profile_id from public.secure_links l join public.professionals p on p.id = l.subject_id
                      where l.id = (current_setting('test.inv5')::jsonb ->> 'link_id')::uuid $$,
  $$ values (0, null::uuid) $$, '… nothing written, the consumption rolled back');
delete from public.user_permission_overrides where user_id = 'a0000000-0000-0000-0000-000000000002';

-- =============================================================================
-- Revocation and deactivation
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.revoke_professional_invitation(current_setting('test.p5')::uuid) $$, '42501', null, 'the conseillère cannot revoke');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.revoke_professional_invitation(current_setting('test.p5')::uuid) $$, 'P0001', 'Professionnel introuvable.',
  'another clinic cannot revoke');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.revoke_professional_invitation(current_setting('test.p5')::uuid) $$, 'the adjointe revokes the invitation');
select throws_ok($$ select public.revoke_professional_invitation(current_setting('test.p5')::uuid) $$, 'P0001', 'Aucune invitation en cours.',
  'nothing left to revoke');
reset role;
select results_eq($$ select p.status, l.revoked_at is not null, l.revoked_by from public.professionals p
                       join public.secure_links l on l.subject_id = p.id where p.id = current_setting('test.p5')::uuid $$,
  $$ values ('draft'::text, true, 'a0000000-0000-0000-0000-000000000002'::uuid) $$, 'the link is revoked; the file is « À inviter » again');
select is((select s.status from public.professional_submissions s where s.id = (current_setting('test.inv5')::jsonb ->> 'submission_id')::uuid),
  'cancelled', '… and its onboarding draft is closed (P4-301)');

set local role service_role;
select set_config('test.inv6', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', current_setting('test.p6')::uuid,
  extensions.digest('token-6', 'sha256'))::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select s.state from public.list_professional_invitation_states() s where s.professional_id = current_setting('test.p6')::uuid), 'sent',
  'states: a new link is sent');
reset role;
update public.secure_links set last_opened_at = now() where id = (current_setting('test.inv6')::jsonb ->> 'link_id')::uuid;
set local role authenticated;
select is((select s.state from public.list_professional_invitation_states() s where s.professional_id = current_setting('test.p6')::uuid), 'opened',
  'states: opened');
reset role;
update public.secure_links set created_at = now() - interval '10 days', expires_at = now() - interval '1 hour'
 where id = (current_setting('test.inv6')::jsonb ->> 'link_id')::uuid;
set local role authenticated;
select is((select s.state from public.list_professional_invitation_states() s where s.professional_id = current_setting('test.p6')::uuid), 'expired',
  'states: expired wins over opened');
reset role;
update public.secure_links set expires_at = now() + interval '1 day' where id = (current_setting('test.inv6')::jsonb ->> 'link_id')::uuid;
set local role authenticated;
select lives_ok($$ select public.deactivate_professional(current_setting('test.p6')::uuid,
  (select r.id from public.deactivation_reasons r where r.org_id = current_setting('test.a')::uuid and r.key = 'leave')) $$,
  'an invited file is deactivated');
select is((select s.state from public.list_professional_invitation_states() s where s.professional_id = current_setting('test.p6')::uuid), 'revoked',
  '… and its link is revoked (4a.4, 4a.14)');
select is((select s.status from public.professional_submissions s where s.id = (current_setting('test.inv6')::jsonb ->> 'submission_id')::uuid),
  'cancelled', '… and its onboarding draft is closed (P4-301)');
select results_eq($$ select s.professional_id, s.state from public.list_professional_invitation_states() s
                      where s.professional_id in (current_setting('test.p1')::uuid, current_setting('test.p5')::uuid) order by 1 $$,
  $$ values (current_setting('test.p1')::uuid, 'used'::text), (current_setting('test.p5')::uuid, 'revoked'::text) $$,
  'states: used, revoked');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_professional_invitation_states() $$, '42501', null, 'the provider reads no states');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.list_professional_invitation_states()), 0, 'admin B reads none of org A');
reset role;

-- =============================================================================
-- The questionnaire (P1's new account, a…06)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq($$ select s ->> 'kind', s ->> 'status', jsonb_array_length(s -> 'requested_sections'), s -> 'consent' ->> 'version',
                            s -> 'collect_sin', s -> 'professional' ->> 'first_name', s -> 'private'
                       from public.get_my_submission() s $$,
  $$ values ('onboarding'::text, 'draft'::text, 11, '1'::text, 'false'::jsonb, 'Paul'::text, 'null'::jsonb) $$,
  'get_my_submission: the onboarding, the consent to sign, collect_sin, the name');

select throws_ok($$ select public.save_my_submission_draft('personal', '{"sin": "046454286"}') $$, '22023', null,
  'a SIN never enters the draft');
select throws_ok($$ select public.save_my_submission_draft('personal', '{"nickname": "Paulo"}') $$, '22023', null, 'unknown keys are refused');
select throws_ok($$ select public.save_my_submission_draft('tax_bank', '{}') $$, '22023', null, 'the private step has its own RPC');
select throws_ok($$ select public.save_my_submission_draft('hobbies', '{}') $$, '22023', null, 'an unknown section is refused');
select throws_ok($$ select public.save_my_submission_draft('approaches', '{}') $$, '22023', null, '« Approches » is no section (P4-276)');
select throws_ok($$ select public.save_my_submission_draft('personal', '{"city": 12}') $$, '22023', null, 'a value of the wrong type is refused');
select throws_ok($$ select public.save_my_submission_draft('personal', '{"postal_code": "H2X"}') $$, 'P0001', 'Code postal invalide : format A1A 1A1 attendu.',
  'postal code format');
select is(private.test_error_hint($$ select public.save_my_submission_draft('personal', '{"postal_code": "H2X"}') $$), 'postal_code', '… HINT postal_code');
select throws_ok($$ select public.save_my_submission_draft('personal', '{"personal_phone": "555-01"}') $$, 'P0001', null, 'phone format');
select throws_ok($$ select public.save_my_submission_draft('personal', '{"province": "XX"}') $$, 'P0001', 'Province inconnue.', 'province list');
select lives_ok($$ select public.save_my_submission_draft('personal', '{"personal_phone": "(514) 555-0101", "address_line1": "  123, rue Principale ",
  "city": "Montréal", "province": "qc", "postal_code": "h2x1y4"}') $$, 'a personal section is saved');
reset role;
select is((select s.submitted_values -> 'personal' from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid),
  '{"personal_phone": "+15145550101", "address_line1": "123, rue Principale", "city": "Montréal", "province": "QC", "postal_code": "H2X 1Y4"}'::jsonb,
  'the answers are stored normalised as the forms store them, only the keys given (P4-176)');
set local role authenticated;

-- Professions and motifs through the staff paths (dry run), restricted motifs across sections.
select throws_ok($$ select public.save_my_submission_draft('professional', jsonb_build_object('professions',
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.psy'))), 'years_experience', 5)) $$,
  'P0001', 'Le numéro de permis est requis pour ce titre.', 'a regulated title needs its licence (the staff guard)');
select is(private.test_error_hint($$ select public.save_my_submission_draft('professional', jsonb_build_object('professions',
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.psy'))))) $$), 'licence', '… HINT licence');
select throws_ok($$ select public.save_my_submission_draft('professional', jsonb_build_object('years_experience', 61)) $$,
  'P0001', 'Les années d''expérience vont de 0 à 60.', 'years 0–60');
select lives_ok($$ select public.save_my_submission_draft('professional', jsonb_build_object('professions',
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.naturo'))), 'years_experience', 4)) $$, 'a title without an order');
select throws_ok($$ select public.save_my_submission_draft('motifs', jsonb_build_object('motif_ids',
  jsonb_build_array(current_setting('test.psychose'), current_setting('test.anxiete')))) $$,
  'P0001', format('Le motif « %s » est réservé aux professions réglementées.', current_setting('test.psychose_name')),
  'a restricted motif needs a regulated title in the answers');
select throws_ok($$ select public.save_my_submission_draft('motifs', jsonb_build_object('motif_ids', jsonb_build_array(current_setting('test.b_motif')))) $$,
  '22023', 'Motif inconnu.', 'another clinic''s motif is unknown');
select lives_ok($$ select public.save_my_submission_draft('professional', jsonb_build_object('professions',
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', ' OPQ-1234 ')), 'years_experience', 4)) $$,
  'a psychologue with a licence');
select lives_ok($$ select public.save_my_submission_draft('motifs', jsonb_build_object('motif_ids',
  jsonb_build_array(current_setting('test.psychose'), current_setting('test.anxiete'), current_setting('test.anxiete')))) $$,
  'then the restricted motif is accepted');
select throws_ok($$ select public.save_my_submission_draft('professional', jsonb_build_object('professions',
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.naturo'))))) $$,
  'P0001', format('Le motif « %s » est réservé aux professions réglementées.', current_setting('test.psychose_name')),
  'dropping the regulated title is refused while the answers hold it');
select throws_ok($$ select public.save_my_submission_draft('languages', '{"language_ids": []}') $$,
  'P0001', 'Au moins une langue est requise.', 'at least one language');
reset role;
select results_eq($$ select (select count(*)::int from public.professional_professions x where x.professional_id = current_setting('test.p1')::uuid),
                            (select count(*)::int from public.professional_motifs x where x.professional_id = current_setting('test.p1')::uuid),
                            (select count(*)::int from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                                and a.table_name in ('professional_professions', 'professional_motifs')
                                and left(a.record_id, 36) = current_setting('test.p1')) $$,
  $$ values (0, 0, 0) $$, 'the dry runs leave the record and the audit untouched');
select is((select s.submitted_values -> 'professional' -> 'professions' from public.professional_submissions s
            where s.professional_id = current_setting('test.p1')::uuid),
  jsonb_build_array(jsonb_build_object('title_id', current_setting('test.psy'), 'licence_number', 'OPQ-1234', 'is_primary', true)),
  'professions stored with the licence trimmed and one primary');
select is((select jsonb_array_length(s.submitted_values -> 'motifs' -> 'motif_ids') from public.professional_submissions s
            where s.professional_id = current_setting('test.p1')::uuid), 2, 'motif ids stored once each');
set local role authenticated;

select lives_ok($$ select public.save_my_submission_draft('languages', jsonb_build_object('language_ids', jsonb_build_array(current_setting('test.fr'), current_setting('test.en')))) $$, 'languages');
select throws_ok($$ select public.save_my_submission_draft('clienteles', '{"min_client_age": 121}') $$,
  'P0001', 'Les âges vont de 0 à 120 ans.', 'the youngest client age: 0–120 (P4-245)');
select is(private.test_error_hint($$ select public.save_my_submission_draft('clienteles', '{"min_client_age": 7.5}') $$), 'min_client_age',
  '… a whole number, HINT min_client_age');
select throws_ok($$ select public.save_my_submission_draft('clienteles', '{"women_only": "oui"}') $$, '22023', null, '« Femmes seulement » is a boolean');
select lives_ok($$ select public.save_my_submission_draft('clienteles', jsonb_build_object('clienteles', jsonb_build_array(jsonb_build_object('id', current_setting('test.adults'), 'specialized', true)),
  'min_client_age', 14, 'women_only', true)) $$, 'clientèles and the client limits');
select lives_ok($$ select public.save_my_submission_draft('availability', '{"accepting_new_clients": false, "availability_periods": ["evening", "end_of_day", "am", "am"], "availability_note": " Mardi soir "}') $$, 'availability');
select throws_ok($$ select public.save_my_submission_draft('availability', '{"availability_periods": ["night"]}') $$, '22023', null, 'unknown periods');
reset role;
select is((select (s.submitted_values -> 'clienteles') - 'clienteles' from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid),
  '{"min_client_age": 14, "women_only": true}'::jsonb, 'the client limits are part of the clientèles section (P4-245)');
select is((select s.submitted_values -> 'availability' -> 'availability_periods' from public.professional_submissions s
            where s.professional_id = current_setting('test.p1')::uuid),
  '["am", "end_of_day", "evening"]'::jsonb, '« Fin de journée » is a period, in its place between the afternoon and the evening (P4-250)');
set local role authenticated;
select lives_ok($$ select public.save_my_submission_draft('portrait', E'{"bio": "Accompagne les adultes.\\n\\nEn français et en anglais.", "public_email": " Paul@Exemple.TEST "}') $$, 'portrait');
select throws_ok($$ select public.save_my_submission_draft('portrait', jsonb_build_object('bio', repeat('x', 4001))) $$,
  'P0001', 'La présentation ne peut pas dépasser 4000 caractères.', 'the presentation has at most 4000 characters');

-- Files: the provider's own staged upload, of the right type; the insurance's date.
select throws_ok($$ select public.save_my_submission_draft('photo', '{"file_id": "e0000000-0000-0000-0000-000000000004"}') $$,
  'P0001', 'Fichier introuvable. Téléversez-le de nouveau.', 'someone else''s upload is not found');
select throws_ok($$ select public.save_my_submission_draft('photo', '{"file_id": "e0000000-0000-0000-0000-000000000005"}') $$,
  'P0001', 'Fichier introuvable. Téléversez-le de nouveau.', 'an upload staged for another submission is not found (P4-306)');
select throws_ok($$ select public.save_my_submission_draft('photo', '{"file_id": "e0000000-0000-0000-0000-000000000003"}') $$,
  'P0001', 'La photo doit être une image JPEG ou PNG de 5 Mo au plus.', 'a PDF is not a photo');
select lives_ok($$ select public.save_my_submission_draft('photo', '{"file_id": "e0000000-0000-0000-0000-000000000001"}') $$, 'the photo');
select throws_ok($$ select public.save_my_submission_draft('insurance', '{"file_id": "e0000000-0000-0000-0000-000000000002", "expires_on": "2027-02-30"}') $$,
  'P0001', 'Date invalide.', 'an impossible date');
select throws_ok($$ select public.save_my_submission_draft('insurance', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000002',
  'expires_on', (current_date - 2)::text)) $$, 'P0001', 'Cette assurance est déjà échue : joignez une preuve en vigueur.', 'an expired proof');
select throws_ok($$ select public.save_my_submission_draft('insurance', '{"file_id": "e0000000-0000-0000-0000-000000000002", "expires_on": "2101-03-31"}') $$,
  'P0001', 'La date doit être au plus tard le 2100-12-31.', 'no absurd year');
select lives_ok($$ select public.save_my_submission_draft('insurance', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000002',
  'expires_on', ((current_date + 200))::text)) $$, 'the insurance');

-- Incomplete: tax_bank is missing. The consent is not a gap here: the clinic has published no
-- Documenso form (P4-487, *_professionals_image_consent.sql; 073 covers a published one).
select throws_ok($$ select public.submit_my_submission() $$, 'P0001', 'Certaines sections sont incomplètes.', 'submit refuses a gap');
select is(private.test_error_detail($$ select public.submit_my_submission() $$), 'tax_bank', '… naming the sections (DETAIL)');

-- The private step.
select throws_ok($$ select public.save_my_submission_private('046 454 286', null, null, null, null, null, null) $$,
  'P0001', 'La collecte du NAS n''est pas activée.', 'no SIN while collect_sin is off');
select is(private.test_error_hint($$ select public.save_my_submission_private('046 454 286', null, null, null, null, null, null) $$), 'sin', '… HINT sin');
select throws_ok($$ select public.save_my_submission_private(null, null, null, null, '81', '30000', '1234567') $$,
  'P0001', 'Le numéro d''institution compte 3 chiffres.', 'institution: 3 digits');
select throws_ok($$ select public.save_my_submission_private(null, '12345', null, null, null, null, null) $$,
  'P0001', 'Le numéro d''entreprise (NE) compte 9 chiffres.', 'business number: 9 digits');
select lives_ok($$ select public.save_my_submission_private(null, '123 456 789', null, null, '815', '30000', '1234-567') $$, 'bank and business number');
select is((select s -> 'private' from public.get_my_submission() s),
  '{"business_number": "123456789", "gst_number": null, "qst_number": null, "bank_institution": "815", "bank_transit": "30000", "bank_account_last4": "4567", "sin_last3": null}'::jsonb,
  'the provider reads back masks only');
select lives_ok($$ select public.save_my_submission_private(null, '123456789', null, null, '815', '30000', null) $$, 'a blank account keeps the stored one');
reset role;
select results_eq($$ select sp.bank_account_last4, private.decrypt_pii(sp.bank_account, sp.key_version), sp.key_version::int,
                            position('1234567' in encode(sp.bank_account, 'escape')) = 0
                       from public.professional_submission_private sp where sp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('4567'::text, '1234567'::text, private.pii_current_key_version(), true) $$,
  'the account is encrypted at once, on the write version, and kept by a blank');
select ok(not (select s.submitted_values::text like '%1234567%' or s.submitted_values ? 'tax_bank'
                 from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid),
  'never in the draft');
select ok((select s.private_saved_at is not null from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid),
  'the submission records when the private step was saved');
select ok(exists (select 1 from private.pii_encrypted_values() e where e.table_name = 'professional_submission_private'
                   and e.column_name = 'bank_account'
                   and e.row_key = (current_setting('test.inv1')::jsonb ->> 'submission_id')),
  'pii_encrypted_values lists the submission''s account (row key submission_id)');
select ok(public.pii_health_check(), 'the health check stays true');
select is_empty($$ select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                     and a.table_name = 'professional_submission_private'
                     and exists (select 1 from jsonb_each(a.changed_fields) f
                                  where f.value <> '"[redacted]"'::jsonb
                                    and f.key in ('sin', 'sin_last3', 'business_number', 'gst_number', 'qst_number',
                                                  'bank_institution', 'bank_transit', 'bank_account', 'bank_account_last4')) $$,
  'every value of the private answers is redacted in the audit');
select is_empty($$ select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                     and a.table_name = 'professional_submissions'
                     and (a.changed_fields ? 'submitted_values' and a.changed_fields -> 'submitted_values' <> '"[redacted]"'::jsonb
                          or a.changed_fields ? 'prefill' and a.changed_fields -> 'prefill' <> '"[redacted]"'::jsonb) $$,
  'the answers and the prefill are redacted in the audit');

-- Consent.
set local role authenticated;
select set_config('test.consent_v1', (select c.id::text from public.consent_versions c where c.org_id = current_setting('test.a')::uuid), true);
select throws_ok($$ select public.sign_my_consent(current_setting('test.consent_v1')::uuid, 'Pierre Un') $$,
  'P0001', 'Le nom saisi ne correspond pas au nom du dossier.', 'the typed name must be the file''s');
select throws_ok($$ select public.sign_my_consent(gen_random_uuid(), 'Paul Un') $$,
  'P0001', 'Le texte du consentement a changé. Relisez-le avant de signer.', 'only the latest published version is signed');
select lives_ok($$ select public.sign_my_consent(current_setting('test.consent_v1')::uuid, '  paul   ÚN ') $$,
  'accents, case and spaces aside, the name matches');
reset role;
select results_eq($$ select s.submitted_values -> 'consent' ->> 'signer_name', (s.submitted_values -> 'consent' ->> 'consent_version_id')::uuid
                       from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('paul ÚN'::text, current_setting('test.consent_v1')::uuid) $$, 'the signature is in the draft, with the version');

-- Isolation of the answers.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid), 0,
  'another provider cannot read P1''s submission');
select ok(public.get_my_submission() is null, '… and has no open submission herself');
select throws_ok($$ select public.save_my_submission_draft('personal', '{}') $$, 'P0001', 'Aucun questionnaire à compléter.',
  'nothing to save without an open submission');
select throws_ok($$ select public.get_submission_review((current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid) $$, '42501', null,
  'a provider cannot review');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid), 1,
  'the conseillère (professionals.view) reads it');
select throws_ok($$ select public.save_my_submission_draft('personal', '{}') $$, '42501', null, 'staff cannot fill a questionnaire');
select throws_ok($$ select public.apply_professional_submission((current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid) $$, '42501', null,
  'the conseillère cannot apply');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_submissions s where s.professional_id = current_setting('test.p1')::uuid), 0,
  'admin B reads nothing of org A');
select ok(public.get_submission_review((current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid) is null, 'admin B reviews nothing of org A');
select throws_ok($$ select public.apply_professional_submission((current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid) $$,
  'P0001', 'Soumission introuvable.', 'admin B cannot apply org A''s submission');
select throws_ok($$ select public.reject_professional_submission((current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid, 'Non') $$,
  'P0001', 'Soumission introuvable.', '… nor reject it');

-- Submit.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.apply_professional_submission((current_setting('test.inv1')::jsonb ->> 'submission_id')::uuid) $$,
  'P0001', 'Cette soumission n''attend pas de révision.', 'a draft cannot be applied');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.submit_my_submission() $$, 'the complete questionnaire is sent');
select throws_ok($$ select public.save_my_submission_draft('personal', '{}') $$, 'P0001', 'Votre profil a déjà été envoyé.', 'a sent profile is read-only');
reset role;
select results_eq($$ select s.status, s.submitted_at is not null, p.status from public.professional_submissions s
                       join public.professionals p on p.id = s.professional_id where s.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('submitted'::text, true, 'in_review'::text) $$, 'submitted; the file is « À réviser »');
select results_eq($$ select n.kind, n.title, n.body, n.recipient_permission, n.link_path from public.notifications n
                      where n.org_id = current_setting('test.a')::uuid and n.subject_id = current_setting('test.p1')::uuid $$,
  $$ values ('professionals.submission_received'::text, 'Profil à réviser'::text, 'Paul Un a envoyé son profil.'::text,
             'professionals.review'::text, '/professionnels/' || current_setting('test.p1') || '/documents') $$,
  'the reviewers get a notice');

-- =============================================================================
-- Review, refusal, apply (adjointe: review, no professionals.private)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.s1', current_setting('test.inv1')::jsonb ->> 'submission_id', true);
select set_config('test.review', public.get_submission_review(current_setting('test.s1')::uuid)::text, true);
select is(jsonb_array_length(current_setting('test.review')::jsonb -> 'sections'), 11, 'the review lists the eleven sections');
select is((select f from jsonb_array_elements(current_setting('test.review')::jsonb -> 'sections' -> 0 -> 'fields') f where f ->> 'field' = 'city'),
  '{"field": "city", "label_key": "modules.professionals.submission.fields.city", "kind": "plain", "answered": true, "current": null, "submitted": "Montréal", "changed": true}'::jsonb,
  'a field: answered, current, submitted, changed');
select is((select f from jsonb_array_elements(current_setting('test.review')::jsonb -> 'sections' -> 0 -> 'fields') f where f ->> 'field' = 'address_line2'),
  '{"field": "address_line2", "label_key": "modules.professionals.submission.fields.address_line2", "kind": "plain", "answered": false, "current": null, "submitted": null, "changed": false}'::jsonb,
  'a field never sent is not answered');
select is((select f from jsonb_array_elements(current_setting('test.review')::jsonb -> 'sections') s, jsonb_array_elements(s -> 'fields') f
            where f ->> 'field' = 'bank_account'),
  '{"field": "bank_account", "label_key": "modules.professionals.submission.fields.bank_account", "kind": "private", "answered": true, "changed": true}'::jsonb,
  'a private field says only that it changed');
select ok(current_setting('test.review') not like '%1234567%' and current_setting('test.review') not like '%123456789%',
  'no private value in the review');
select is((select f -> 'changed' from jsonb_array_elements(current_setting('test.review')::jsonb -> 'sections') s, jsonb_array_elements(s -> 'fields') f
            where f ->> 'field' = 'gst_number'), 'false'::jsonb, 'an empty private field did not change');
select is((select f -> 'changed' from jsonb_array_elements(current_setting('test.review')::jsonb -> 'sections') s, jsonb_array_elements(s -> 'fields') f
            where f ->> 'field' = 'language_ids'), 'true'::jsonb, 'a set compares by ids');
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['nickname']) $$, '22023', 'Champ inconnu.',
  'an unknown field is refused');
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['address_line2']) $$, '22023', 'Champ non soumis.',
  'a field without an answer is refused');
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['sin']) $$, 'P0001',
  'La collecte du NAS n''est pas activée.', 'the SIN while collect_sin is off is refused (P4-272)');

-- One transaction: a refused field rolls back the others (the anxiety motif archived meanwhile).
reset role;
update public.motifs set is_active = false where id = current_setting('test.anxiete')::uuid;
set local role authenticated;
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid) $$,
  'P0001', format('Le motif « %s » est archivé.', current_setting('test.anxiete_name')), 'a refusal of the staff paths stops the apply');
reset role;
select results_eq($$ select p.personal_phone, s.status, (select count(*)::int from public.professional_motifs m where m.professional_id = p.id)
                       from public.professionals p join public.professional_submissions s on s.professional_id = p.id
                      where p.id = current_setting('test.p1')::uuid $$,
  $$ values (null::text, 'submitted'::text, 0) $$, '… and nothing was applied');

-- Refusal: back to the provider with the note; the file is invited again.
set local role authenticated;
select throws_ok($$ select public.reject_professional_submission(current_setting('test.s1')::uuid, E' \t ') $$,
  'P0001', 'Indiquez ce que le professionnel doit corriger.', 'a refusal needs a note');
select lives_ok($$ select public.reject_professional_submission(current_setting('test.s1')::uuid, 'Retirez le motif archivé.') $$, 'refused');
reset role;
select results_eq($$ select s.status, s.decision_note, s.reviewed_by, p.status from public.professional_submissions s
                       join public.professionals p on p.id = s.professional_id where s.id = current_setting('test.s1')::uuid $$,
  $$ values ('draft'::text, 'Retirez le motif archivé.'::text, 'a0000000-0000-0000-0000-000000000002'::uuid, 'invited'::text) $$,
  'back to draft with the note; the file is invited again');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select s ->> 'decision_note' from public.get_my_submission() s), 'Retirez le motif archivé.', 'the provider reads the note');
select lives_ok($$ select public.save_my_submission_draft('motifs', jsonb_build_object('motif_ids', jsonb_build_array(current_setting('test.psychose'), current_setting('test.deuil')))) $$,
  'the provider corrects the motifs');
select lives_ok($$ select public.submit_my_submission() $$, 'and sends again');
reset role;
select results_eq($$ select s.status, s.decision_note, (select count(*)::int from public.notifications n where n.subject_id = s.professional_id
                                                          and n.kind = 'professionals.submission_received')
                       from public.professional_submissions s where s.id = current_setting('test.s1')::uuid $$,
  $$ values ('submitted'::text, null::text, 2) $$, 'sent again: the note is cleared, a new notice');

-- A draft consent text (4c.3) is read by staff only (P4-307); once published, a signature on the
-- previous version is not applied (P4-305). An insurance expired since the sending is not either.
reset role;
insert into public.consent_versions (org_id, key, version, title, body)
values (current_setting('test.a')::uuid, 'image_rights', 2, 'Consentement au droit à l''image', 'Texte révisé.');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from public.consent_versions c where c.org_id = current_setting('test.a')::uuid and c.version = 2), 0,
  'the provider does not read a draft consent text');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.consent_versions c where c.org_id = current_setting('test.a')::uuid and c.version = 2), 1,
  'staff do');
reset role;
update public.consent_versions set published_at = now() where org_id = current_setting('test.a')::uuid and version = 2;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['consent']) $$,
  'P0001', 'Le texte du consentement a changé depuis la signature.', 'apply: a consent signed on a version that is no longer the latest');
select is(private.test_error_hint($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['consent']) $$),
  'Renvoyez le profil au professionnel : il signera la nouvelle version.', '… with the sheet''s button in its hint (P4-369)');
select is((select f -> 'submitted' ->> 'is_latest'
             from jsonb_array_elements(public.get_submission_review(current_setting('test.s1')::uuid) -> 'sections') sec,
                  jsonb_array_elements(sec -> 'fields') f
            where f ->> 'field' = 'consent'), 'false', 'the review says the consent names an older text, before « Appliquer » (P4-378)');
reset role;
delete from public.consent_versions where org_id = current_setting('test.a')::uuid and version = 2;
update public.professional_submissions
   set submitted_values = jsonb_set(submitted_values, '{insurance,expires_on}', to_jsonb((current_date - 3)::text))
 where id = current_setting('test.s1')::uuid;
set local role authenticated;
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['insurance']) $$,
  'P0001', 'Cette assurance est échue depuis l''envoi du profil.', 'apply: an insurance that expired since it was sent');
select is(private.test_error_hint($$ select public.apply_professional_submission(current_setting('test.s1')::uuid, array['insurance']) $$),
  'Renvoyez le profil au professionnel : il joindra une preuve en vigueur.', '… with the sheet''s button in its hint (P4-369)');
reset role;
update public.professional_submissions
   set submitted_values = jsonb_set(submitted_values, '{insurance,expires_on}', to_jsonb((current_date + 200)::text))
 where id = current_setting('test.s1')::uuid;

-- Apply a selection (the adjointe has no professionals.private).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.apply_professional_submission(current_setting('test.s1')::uuid,
  array['consent', 'postal_code', 'personal_phone', 'professions', 'motif_ids', 'language_ids', 'clienteles', 'women_only', 'photo', 'bank_account', 'bank_institution']) $$,
  'the adjointe applies a selection, private values included, without seeing them');
reset role;
select results_eq($$ select p.personal_phone, p.postal_code, p.city, p.status from public.professionals p where p.id = current_setting('test.p1')::uuid $$,
  $$ values ('+15145550101'::text, 'H2X 1Y4'::text, null::text, 'in_review'::text) $$, 'only the chosen fields; the city is not applied');
select results_eq($$ select mp.women_only, mp.min_client_age, mp.availability_periods from public.professional_matching_profiles mp
                      where mp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (true, null::smallint, '{}'::text[]) $$, '« Femmes seulement » is applied; the age and the periods, not chosen, are not');
select results_eq($$ select x.profession_title_id, x.licence_number, x.is_primary from public.professional_professions x
                      where x.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (current_setting('test.psy')::uuid, 'OPQ-1234'::text, true) $$, 'the title through the staff path');
select set_eq($$ select x.motif_id from public.professional_motifs x where x.professional_id = current_setting('test.p1')::uuid $$,
  array[current_setting('test.psychose')::uuid, current_setting('test.deuil')::uuid], 'the motifs, the restricted one with its regulated title');
select results_eq($$ select f.subject_type, f.subject_id, f.view_permission, f.owner_profile_id, f.owner_permission, f.retain_until
                       from public.stored_files f where f.id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('professional'::text, current_setting('test.p1')::uuid, 'professionals.view'::text, 'a0000000-0000-0000-0000-000000000006'::uuid,
             'professionals.self'::text, null::timestamptz) $$, 'the photo is attached to the professional, no longer staged');
select ok((select f.retain_until is not null and f.subject_type = 'professional_submission' from public.stored_files f
            where f.id = 'e0000000-0000-0000-0000-000000000002'), 'the insurance not chosen stays staged');
select results_eq($$ select c.consent_version_id, c.signer_name, c.expires_on = ((c.signed_at at time zone 'America/Toronto')::date + interval '12 months')::date,
                            c.submission_id
                       from public.professional_consents c where c.professional_id = current_setting('test.p1')::uuid $$,
  $$ values (current_setting('test.consent_v1')::uuid, 'paul ÚN'::text, true, current_setting('test.s1')::uuid) $$,
  'the consent: valid 12 months from the clinic date of the signature');
select results_eq($$ select pp.bank_institution, pp.bank_account_last4, pp.business_number, private.decrypt_pii(pp.bank_account, pp.key_version),
                            pp.updated_by
                       from public.professional_private pp where pp.professional_id = current_setting('test.p1')::uuid $$,
  $$ values ('815'::text, '4567'::text, null::text, '1234567'::text, 'a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'the chosen private values moved to professional_private (the business number was not chosen)');
select results_eq($$ select s.status, s.reviewed_by, s.applied_fields from public.professional_submissions s where s.id = current_setting('test.s1')::uuid $$,
  $$ values ('approved'::text, 'a0000000-0000-0000-0000-000000000002'::uuid,
             array['personal_phone', 'postal_code', 'professions', 'language_ids', 'clienteles', 'women_only', 'motif_ids', 'photo', 'bank_institution',
                   'bank_account', 'consent']) $$, 'approved, with the fields applied in questionnaire order');
select is_empty($$ select 1 from public.professional_submission_private sp where sp.submission_id = current_setting('test.s1')::uuid $$,
  'the submission''s private copy is deleted (Loi 25)');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'professional_professions' and left(a.record_id, 36) = current_setting('test.p1')
                   and a.source = 'rpc:apply_professional_submission' and a.actor_id = 'a0000000-0000-0000-0000-000000000002'),
  'the applied changes are audited under the review');
select is_empty($$ select 1 from public.audit_log a where a.id > current_setting('test.audit_start')::bigint
                     and a.changed_fields::text ~ '(1234567|123456789)' $$, 'no private value anywhere in the audit');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.reveal_professional_private(current_setting('test.p1')::uuid, 'bank_account'), '1234567', 'the admin reveals the applied account');
select is(public.get_professional_readiness(current_setting('test.p1')::uuid) -> 'items',
  '[{"key": "matching_profile", "done": true, "missing": []}, {"key": "account_created", "done": true, "missing": []},
    {"key": "submission_approved", "done": true, "missing": []}, {"key": "documents", "done": false, "missing": ["insurance"]},
    {"key": "contract_signed", "done": false, "missing": []}]'::jsonb,
  'readiness: matching, account, questionnaire; of the documents (4c.2), the approved photo and e-consent count, the insurance (not chosen) is missing; the contract (4d.1) still to sign');
select is(public.get_professional_readiness(current_setting('test.p1')::uuid) - 'items',
  '{"complete": false, "done": 3, "total": 5, "warnings": []}'::jsonb, 'the file waits for its insurance and its contract');
select results_eq($$ select r.account_created, r.submission_approved, r.ready from public.professionals_readiness r
                      where r.professional_id in (current_setting('test.p5')::uuid, current_setting('test.p2')::uuid) order by r.professional_id $$,
  $$ values (true, false, false), (false, false, false) $$, 'P2 (account, no questionnaire) and P5 (neither) are not ready');
select results_eq($$ select r -> 'invitation' ->> 'state', jsonb_typeof(r -> 'submission'), r -> 'onboarding_approved'
                       from public.get_professional_onboarding(current_setting('test.p1')::uuid) r $$,
  $$ values ('used'::text, 'null'::text, 'true'::jsonb) $$, 'the record''s onboarding line: invitation used, nothing open, approved');
select ok(public.get_professional_onboarding(current_setting('test.p4')::uuid) is null, 'a file without link or submission: null');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select ok(public.get_professional_onboarding(current_setting('test.p1')::uuid) is null, 'another clinic reads null');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.get_professional_onboarding(current_setting('test.p2')::uuid) $$, '42501', null, 'a provider reads no onboarding line');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_eq($$ select distinct h.table_name from public.list_professional_history(current_setting('test.p1')::uuid, null, 200) h
                  where h.table_name in ('professional_submissions', 'professional_consents', 'professional_submission_private') $$,
  array['professional_submissions', 'professional_consents'], 'the history shows submissions and consents, never the private answers');

-- The provider reads her own masks (« Mon profil »).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq($$ select g.bank_account_last4, g.bank_institution, g.sin_last3 from public.get_my_professional_private() g $$,
  $$ values ('4567'::text, '815'::text, null::text) $$, 'get_my_professional_private: masks of her own row');
select is((select count(*)::int from public.professional_consents c where c.professional_id = current_setting('test.p1')::uuid), 0,
  'she reads no consent row through the table (P4-420: a re-linked account must not read the previous signer''s name)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.professional_consents c where c.professional_id = current_setting('test.p1')::uuid), 0,
  'another provider does not');
select results_eq($$ select g.bank_account_last4 from public.get_my_professional_private() g $$, $$ values (null::text) $$,
  'another provider reads her own (empty) row');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.get_my_professional_private() $$, '42501', null, 'staff have no « Mon profil »');

-- =============================================================================
-- Update requests (P4-44) and apply all
-- =============================================================================
select throws_ok($$ select public.request_professional_update(current_setting('test.p5')::uuid, array['motifs']) $$,
  'P0001', 'Ce professionnel n''a pas encore de compte.', 'an update needs an account');
select throws_ok($$ select public.request_professional_update(current_setting('test.p2')::uuid, array['hobbies']) $$, '22023', null, 'unknown section');
select throws_ok($$ select public.request_professional_update(current_setting('test.p2')::uuid, '{}') $$, '22023', null, 'at least one section');
select set_config('test.u2', public.request_professional_update(current_setting('test.p2')::uuid, array['motifs', 'availability', 'motifs'])::text, true);
select is(current_setting('test.u2')::jsonb - 'submission_id', '{"email": "provider@a.test", "first_name": "Pia"}'::jsonb, 'what the email needs');
select throws_ok($$ select public.request_professional_update(current_setting('test.p2')::uuid, array['motifs']) $$,
  'P0001', 'Une soumission est déjà en cours.', 'one open submission at a time');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.request_professional_update(current_setting('test.p2')::uuid, array['motifs']) $$, '42501', null,
  'the conseillère cannot request an update');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$ select s ->> 'kind', s -> 'requested_sections', s -> 'prefill' -> 'availability' -> 'accepting_new_clients'
                       from public.get_my_submission() s $$,
  $$ values ('update'::text, '["motifs", "availability"]'::jsonb, 'true'::jsonb) $$, 'the provider sees the sections asked, prefilled');
select throws_ok($$ select public.start_my_profile_update(array['portrait']) $$, 'P0001', 'Une soumission est déjà en cours.',
  'no second submission from « Mon profil »');
select throws_ok($$ select public.save_my_submission_draft('portrait', '{"bio": "x"}') $$, '22023', null, 'a section not asked is refused');
select lives_ok($$ select public.save_my_submission_draft('motifs', jsonb_build_object('motif_ids', jsonb_build_array(current_setting('test.deuil')))) $$, 'motifs');
select lives_ok($$ select public.save_my_submission_draft('availability', '{"accepting_new_clients": false, "availability_periods": ["weekend", "end_of_day"]}') $$, 'availability');
select lives_ok($$ select public.submit_my_submission() $$, 'the update is sent');
reset role;
select results_eq($$ select p.status, n.title from public.professionals p
                       join public.notifications n on n.subject_id = p.id and n.kind = 'professionals.submission_received'
                      where p.id = current_setting('test.p2')::uuid $$,
  $$ values ('active'::text, 'Mise à jour à réviser'::text) $$, 'an update keeps the status; its notice says « Mise à jour »');
update public.professional_matching_profiles set availability_note = 'Les mardis' where professional_id = current_setting('test.p2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.apply_professional_submission((current_setting('test.u2')::jsonb ->> 'submission_id')::uuid) $$, 'apply all');
reset role;
select results_eq($$ select mp.accepting_new_clients, mp.availability_periods, mp.availability_note,
                            (select array_agg(x.motif_id) from public.professional_motifs x where x.professional_id = mp.professional_id)
                       from public.professional_matching_profiles mp where mp.professional_id = current_setting('test.p2')::uuid $$,
  $$ values (false, array['end_of_day', 'weekend'], 'Les mardis'::text, array[current_setting('test.deuil')::uuid]) $$,
  'every answered field is applied; the note, never sent, keeps its value (P4-176)');
select is((select s.applied_fields from public.professional_submissions s where s.id = (current_setting('test.u2')::jsonb ->> 'submission_id')::uuid),
  array['motif_ids', 'accepting_new_clients', 'availability_periods'], 'applied fields recorded');
-- Historique (4b.3 review): the draft saves are audited but are not history rows; every other
-- submission row names its kind, so an update request reads « mise à jour ».
select ok(exists (select 1 from public.audit_log a
                   where a.table_name = 'professional_submissions' and a.action = 'update'
                     and left(a.record_id, 36) = current_setting('test.p2')
                     and not exists (select 1 from jsonb_object_keys(a.changed_fields) k(key)
                                      where k.key not in ('submitted_values', 'secure_link_id'))),
  'the update''s draft saves are audited');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is_empty($$ select 1 from public.list_professional_history(current_setting('test.p2')::uuid, null, 200) h
                    where h.table_name = 'professional_submissions' and h.action = 'update'
                      and not exists (select 1 from jsonb_object_keys(h.changed_fields) k(key)
                                       where k.key not in ('submitted_values', 'secure_link_id', 'kind')) $$,
  'list_professional_history leaves out the draft saves');
select results_eq($$ select h.action, h.changed_fields ->> 'kind', h.changed_fields -> 'status' ->> 'after'
                       from public.list_professional_history(current_setting('test.p2')::uuid, null, 200) h
                      where h.table_name = 'professional_submissions' order by h.id $$,
  $$ values ('insert'::text, 'update'::text, null::text), ('update', 'update', 'submitted'), ('update', 'update', 'approved') $$,
  'the update request''s rows: opened, sent, approved, each with its kind');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(set_config('test.u3', public.start_my_profile_update(array['portrait', 'tax_bank'])::text, true) is not null,
  '« Proposer une modification » once nothing is open');
reset role;

-- =============================================================================
-- Key versions (§8): one version per row during a rotation; unreadable values
-- =============================================================================
-- P5 accepts a new invitation and saves an account on version 1.
set local role service_role;
select set_config('test.inv5b', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', current_setting('test.p5')::uuid,
  extensions.digest('token-5b', 'sha256'))::text, true);
select is(public.link_professional_account(extensions.digest('token-5b', 'sha256'), 'a0000000-0000-0000-0000-000000000008', '{}') ->> 'status',
  'accepted', 'P5 accepts');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.save_my_submission_private(null, null, null, null, '815', '30000', '7654321') $$, 'P5 saves an account');
reset role;
select set_config('test.s5', current_setting('test.inv5b')::jsonb ->> 'submission_id', true);
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'pii_encryption_key_v2', 'test');
select ok(private.pii_seed_canary(2), 'rotation: version 2 gets its canary');
set local role authenticated;
select lives_ok($$ select public.save_my_submission_private(null, '123456789', null, null, '815', '30000', null) $$,
  'rotation: a save that keeps the account');
reset role;
select results_eq($$ select sp.key_version::int, private.decrypt_pii(sp.bank_account, 2) from public.professional_submission_private sp
                      where sp.submission_id = current_setting('test.s5')::uuid $$,
  $$ values (2, '7654321'::text) $$, 'rotation: the kept account is re-encrypted with version 2 in the same statement');
select results_eq($$ select u.key_version, u.value_count from private.pii_key_versions_in_use() u where u.table_name = 'professional_submission_private' $$,
  $$ values (2, 1::bigint) $$, 'rotation: the inventory shows the submission''s row on version 2');
select ok(public.pii_health_check(), 'rotation: the health check stays true');

-- A kept account that does not decrypt (another key, row left on version 1): a clean P0001.
update public.professional_submission_private
   set bank_account = extensions.pgp_sym_encrypt('0000000', 'not-this-environment-key'), key_version = 1
 where submission_id = current_setting('test.s5')::uuid;
set local role authenticated;
select throws_ok($$ select public.save_my_submission_private(null, '123456789', null, null, '815', '30000', null) $$,
  'P0001', 'Le numéro de compte enregistré précédemment ne peut pas être lu avec la clé de cet environnement.', 'an unreadable kept account: clean P0001');
select is(private.test_error_hint($$ select public.save_my_submission_private(null, '123456789', null, null, '815', '30000', null) $$),
  'Saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.', '… with a hint');
select lives_ok($$ select public.save_my_submission_private(null, '123456789', null, null, '815', '30000', '7654321') $$,
  'typing the account again replaces it');
reset role;
select is((select private.decrypt_pii(sp.bank_account, sp.key_version) from public.professional_submission_private sp
            where sp.submission_id = current_setting('test.s5')::uuid), '7654321', '… on the write version');

-- An unreadable submitted value at apply: a clean P0001, nothing applied.
update public.professional_submission_private
   set bank_account = extensions.pgp_sym_encrypt('0000000', 'not-this-environment-key'), key_version = 1
 where submission_id = current_setting('test.s5')::uuid;
update public.professional_submissions set status = 'submitted', submitted_at = now() where id = current_setting('test.s5')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.apply_professional_submission(current_setting('test.s5')::uuid, array['bank_account']) $$,
  'P0001', 'Les renseignements transmis ne peuvent pas être lus avec la clé de cet environnement.', 'apply: an unreadable answer');
reset role;
select is_empty($$ select 1 from public.professional_private pp where pp.professional_id = current_setting('test.p5')::uuid $$, '… nothing applied');
update public.professional_submission_private
   set bank_account = private.encrypt_pii('7654321', 1), key_version = 1
 where submission_id = current_setting('test.s5')::uuid;
set local role authenticated;
select lives_ok($$ select public.apply_professional_submission(current_setting('test.s5')::uuid, array['bank_account', 'business_number']) $$,
  'apply across versions: a version 1 answer');
reset role;
select results_eq($$ select pp.key_version::int, private.decrypt_pii(pp.bank_account, 2), pp.business_number
                       from public.professional_private pp where pp.professional_id = current_setting('test.p5')::uuid $$,
  $$ values (2, '7654321'::text, '123456789'::text) $$, '… lands on version 2 (re-encrypted inside the database)');
-- =============================================================================
-- The SIN in the questionnaire (P4-272): collect_sin on, Luhn, last three digits, a rotation, an
-- unreadable kept value at save and at apply, applied; partial saves (P4-176); self-review (P4-304)
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professionals_settings('{"collect_sin": true}') -> 'collect_sin', 'true'::jsonb, 'the admin turns collect_sin on');
reset role;
-- P2's record already holds part of its portrait; the update leaves those fields unanswered.
update public.professional_public_profiles set approach = 'Approche actuelle', public_email = 'pia@exemple.test'
 where professional_id = current_setting('test.p2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.save_my_submission_private('046 454 287', null, null, null, '815', '30000', '1112223') $$,
  'P0001', 'NAS invalide.', 'a SIN that fails the Luhn check is refused');
select is(private.test_error_hint($$ select public.save_my_submission_private('046 454 287', null, null, null, '815', '30000', '1112223') $$),
  'sin', '… HINT sin');
select lives_ok($$ select public.save_my_submission_private('046-454-286', null, null, null, '815', '30000', '1112223') $$,
  'with collect_sin on, the SIN is saved');
select is((select s -> 'private' ->> 'sin_last3' from public.get_my_submission() s), '286', 'the provider reads back its last three digits only');
reset role;
select results_eq($$ select private.decrypt_pii(sp.sin, sp.key_version), sp.key_version::int from public.professional_submission_private sp
                      where sp.submission_id = current_setting('test.u3')::uuid $$,
  $$ values ('046454286'::text, private.pii_current_key_version()) $$, 'the SIN is encrypted at once, on the write version');
-- A row left on version 1 by a rotation: a save that keeps the SIN re-encrypts it (one version per row).
update public.professional_submission_private
   set sin = private.encrypt_pii('046454286', 1), bank_account = private.encrypt_pii('1112223', 1), key_version = 1
 where submission_id = current_setting('test.u3')::uuid;
set local role authenticated;
select lives_ok($$ select public.save_my_submission_private(null, null, null, null, '815', '30000', null) $$, 'rotation: a save that keeps the SIN');
reset role;
select results_eq($$ select sp.key_version::int, private.decrypt_pii(sp.sin, 2), private.decrypt_pii(sp.bank_account, 2)
                       from public.professional_submission_private sp where sp.submission_id = current_setting('test.u3')::uuid $$,
  $$ values (2, '046454286'::text, '1112223'::text) $$, 'rotation: the kept SIN and account are re-encrypted with version 2');
-- A kept SIN that does not decrypt (another key): a clean P0001 that names it.
update public.professional_submission_private
   set sin = extensions.pgp_sym_encrypt('000000000', 'not-this-environment-key'), bank_account = private.encrypt_pii('1112223', 1),
       key_version = 1
 where submission_id = current_setting('test.u3')::uuid;
set local role authenticated;
select throws_ok($$ select public.save_my_submission_private(null, null, null, null, '815', '30000', null) $$,
  'P0001', 'Le NAS enregistré précédemment ne peut pas être lu avec la clé de cet environnement.', 'an unreadable kept SIN: clean P0001');
select is(private.test_error_hint($$ select public.save_my_submission_private(null, null, null, null, '815', '30000', null) $$),
  'Saisissez-le de nouveau au complet : il remplacera celui qui est enregistré.', '… with a hint');
select lives_ok($$ select public.save_my_submission_private('046454286', null, null, null, '815', '30000', null) $$,
  'typing the SIN again replaces it');

-- Two saves of « Portrait », one field each: merged; the fields never sent stay unanswered.
select lives_ok($$ select public.save_my_submission_draft('portrait', '{"bio": "Nouvelle présentation."}') $$, 'a save with the presentation only');
select lives_ok($$ select public.save_my_submission_draft('portrait', '{"public_phone": "514 555 0199"}') $$, 'then one with the public phone only');
reset role;
select is((select s.submitted_values -> 'portrait' from public.professional_submissions s where s.id = current_setting('test.u3')::uuid),
  '{"bio": "Nouvelle présentation.", "public_phone": "+15145550199"}'::jsonb, 'the section holds both answers and nothing else');
set local role authenticated;
select lives_ok($$ select public.submit_my_submission() $$, 'the update with a SIN is sent');

-- Self-review: a reviewer never applies or refuses her own file.
reset role;
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted)
values ('a0000000-0000-0000-0000-000000000003', current_setting('test.a')::uuid, 'professionals.review', true);
set local role authenticated;
select throws_ok($$ select public.apply_professional_submission(current_setting('test.u3')::uuid) $$,
  'P0001', 'Vous ne pouvez pas réviser votre propre profil.', 'self-review: no apply');
select throws_ok($$ select public.reject_professional_submission(current_setting('test.u3')::uuid, 'Non') $$,
  'P0001', 'Vous ne pouvez pas réviser votre propre profil.', 'self-review: no refusal');
reset role;
delete from public.user_permission_overrides where user_id = 'a0000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select jsonb_object_agg(f ->> 'field', f -> 'answered')
             from jsonb_array_elements(public.get_submission_review(current_setting('test.u3')::uuid) -> 'sections') s,
                  jsonb_array_elements(s -> 'fields') f
            where f ->> 'field' in ('bio', 'approach', 'public_email', 'public_phone', 'sin')),
  '{"bio": true, "approach": false, "public_email": false, "public_phone": true, "sin": true}'::jsonb, 'the review says which fields were answered');
-- The submission's SIN on version 1 and unreadable: a clean P0001 at apply.
reset role;
update public.professional_submission_private
   set sin = extensions.pgp_sym_encrypt('000000000', 'not-this-environment-key'), bank_account = private.encrypt_pii('1112223', 1),
       key_version = 1
 where submission_id = current_setting('test.u3')::uuid;
set local role authenticated;
select throws_ok($$ select public.apply_professional_submission(current_setting('test.u3')::uuid, array['sin']) $$,
  'P0001', 'Les renseignements transmis ne peuvent pas être lus avec la clé de cet environnement.', 'apply: an unreadable SIN');
select is(private.test_error_hint($$ select public.apply_professional_submission(current_setting('test.u3')::uuid, array['sin']) $$),
  'Renvoyez le profil au professionnel : il saisira ces renseignements de nouveau.', '… with a hint');
reset role;
update public.professional_submission_private set sin = private.encrypt_pii('046454286', 1)
 where submission_id = current_setting('test.u3')::uuid;
set local role authenticated;
select lives_ok($$ select public.apply_professional_submission(current_setting('test.u3')::uuid) $$, 'apply all, the SIN included');
reset role;
select results_eq($$ select pp.key_version::int, private.decrypt_pii(pp.sin, pp.key_version), pp.sin_last3,
                            private.decrypt_pii(pp.bank_account, pp.key_version)
                       from public.professional_private pp where pp.professional_id = current_setting('test.p2')::uuid $$,
  $$ values (2, '046454286'::text, '286'::text, '1112223'::text) $$, 'the SIN lands in professional_private, on the write version');
select results_eq($$ select x.bio, x.approach, x.public_email, x.public_phone from public.professional_public_profiles x
                      where x.professional_id = current_setting('test.p2')::uuid $$,
  $$ values ('Nouvelle présentation.'::text, 'Approche actuelle'::text, 'pia@exemple.test'::text, '+15145550199'::text) $$,
  'apply all: the answered fields change, the fields never sent keep their values (P4-176)');

-- collect_sin turned off between the save and the review: the SIN is not applied (P4-272).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(set_config('test.u4', public.start_my_profile_update(array['tax_bank'])::text, true) is not null, 'a second update: tax and bank');
select lives_ok($$ select public.save_my_submission_private('130 692 544', null, null, null, null, null, null) $$, 'a new SIN');
select lives_ok($$ select public.submit_my_submission() $$, 'sent (the account and its institution are on file)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.set_professionals_settings('{"collect_sin": false}') -> 'collect_sin', 'false'::jsonb, 'the admin turns collect_sin off');
select is((select f -> 'answered' from jsonb_array_elements(public.get_submission_review(current_setting('test.u4')::uuid) -> 'sections') s,
                                       jsonb_array_elements(s -> 'fields') f where f ->> 'field' = 'sin'),
  'false'::jsonb, 'the SIN is no longer an available field');
select throws_ok($$ select public.apply_professional_submission(current_setting('test.u4')::uuid, array['sin']) $$,
  'P0001', 'La collecte du NAS n''est pas activée.', 'apply: the SIN is refused while collect_sin is off');
select lives_ok($$ select public.apply_professional_submission(current_setting('test.u4')::uuid) $$, '« Appliquer tout » works without it');
reset role;
select results_eq($$ select private.decrypt_pii(pp.sin, pp.key_version), s.applied_fields,
                            (select count(*)::int from public.professional_submission_private sp where sp.submission_id = s.id)
                       from public.professional_private pp join public.professional_submissions s on s.professional_id = pp.professional_id
                      where s.id = current_setting('test.u4')::uuid $$,
  $$ values ('046454286'::text, '{}'::text[], 0) $$, 'the record keeps its SIN; the one sent is discarded with the private row');

-- =============================================================================
-- Loi 25: private answers never outlive their submission (P4-301, P4-302); inactive files (P4-303)
-- =============================================================================
select results_eq($$ select j.module_key, j.kind, j.sql_function, j.is_maintenance, c.schedule, c.command
                       from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
                      where j.key = 'professionals.submission_private_purge' $$,
  $$ values ('professionals'::text, 'sql'::text, 'private.job_professionals_submission_private_purge'::text, true, '10 9 * * *'::text,
             'select private.run_sql_job(''professionals.submission_private_purge'')'::text) $$,
  'the purge of stale private answers is catalogued and scheduled daily');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(set_config('test.u5', public.start_my_profile_update(array['tax_bank'])::text, true) is not null, 'a third update');
select lives_ok($$ select public.save_my_submission_private(null, null, null, null, null, null, '2223334') $$, 'an account entered, not sent');
reset role;
select ok(private.job_professionals_submission_private_purge() ~ '^deleted=[0-9]+$', 'the purge job returns a count');
select ok(exists (select 1 from public.professional_submission_private sp where sp.submission_id = current_setting('test.u5')::uuid),
  'a draft saved recently keeps its private answers');
-- 100 days without a save (updated_at set with its trigger off).
alter table public.professional_submissions disable trigger professional_submissions_set_updated_at;
alter table public.professional_submission_private disable trigger professional_submission_private_set_updated_at;
update public.professional_submissions set updated_at = now() - interval '100 days' where id = current_setting('test.u5')::uuid;
update public.professional_submission_private set updated_at = now() - interval '100 days' where submission_id = current_setting('test.u5')::uuid;
alter table public.professional_submissions enable trigger professional_submissions_set_updated_at;
alter table public.professional_submission_private enable trigger professional_submission_private_set_updated_at;
select ok(private.job_professionals_submission_private_purge() ~ '^deleted=[1-9][0-9]*$', 'the job deletes the private answers of a stale draft');
select results_eq($$ select s.status, s.private_saved_at, (select count(*)::int from public.professional_submission_private sp where sp.submission_id = s.id)
                       from public.professional_submissions s where s.id = current_setting('test.u5')::uuid $$,
  $$ values ('draft'::text, null::timestamptz, 0) $$, '… the draft stays, its private step empty again');
set local role authenticated;
select lives_ok($$ select public.save_my_submission_private(null, null, null, null, null, null, '2223334') $$, 'the provider enters the account again');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.deactivate_professional(current_setting('test.p2')::uuid, current_setting('test.leave')::uuid) $$,
  'P2 is deactivated (leave: the account stays enabled)');
reset role;
select results_eq($$ select s.status, (select count(*)::int from public.professional_submission_private sp where sp.submission_id = s.id)
                       from public.professional_submissions s where s.id = current_setting('test.u5')::uuid $$,
  $$ values ('cancelled'::text, 0) $$, 'deactivation closes the open submission and deletes its private answers');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.start_my_profile_update(array['portrait']) $$,
  'P0001', 'Votre dossier est inactif : communiquez avec la clinique pour le réactiver.', 'an inactive file: no update from « Mon profil »');
select throws_ok($$ select public.save_my_submission_draft('portrait', '{"bio": "x"}') $$,
  'P0001', 'Votre dossier est inactif : communiquez avec la clinique pour le réactiver.', '… nor a save');
select ok(public.get_my_submission() is null, '… and nothing is open');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.request_professional_update(current_setting('test.p2')::uuid, array['motifs']) $$,
  'P0001', 'Ce dossier est inactif : réactivez-le d''abord.', 'staff ask nothing of an inactive file');

-- An account removed abandons the open submission (P5, a…08).
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select ok(set_config('test.u6', public.start_my_profile_update(array['tax_bank'])::text, true) is not null, 'P5 starts an update');
select lives_ok($$ select public.save_my_submission_private(null, null, null, null, null, null, '3334445') $$, '… and enters an account');
reset role;
delete from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000008';
select results_eq($$ select p.profile_id, s.status, (select count(*)::int from public.professional_submission_private sp where sp.submission_id = s.id)
                       from public.professionals p join public.professional_submissions s on s.professional_id = p.id
                      where s.id = current_setting('test.u6')::uuid $$,
  $$ values (null::uuid, 'cancelled'::text, 0) $$, 'the account removed: the open submission is closed, its private answers deleted');

-- =============================================================================
-- The invitation is bound to the address it was sent to (P4-300)
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv7', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', current_setting('test.p7')::uuid,
  extensions.digest('token-7', 'sha256'))::text, true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.set_professional_email(current_setting('test.p7')::uuid, 'P7-Nouveau@exemple.test') $$,
  'the address of an invited file is corrected');
reset role;
select results_eq($$ select p.email, p.status, l.revoked_at is not null from public.professionals p
                       join public.secure_links l on l.id = (current_setting('test.inv7')::jsonb ->> 'link_id')::uuid
                      where p.id = current_setting('test.p7')::uuid $$,
  $$ values ('p7-nouveau@exemple.test'::text, 'draft'::text, true) $$, 'the link sent to the old address is revoked; the file is « À inviter » again');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(public.resolve_professional_invitation((current_setting('test.inv7')::jsonb ->> 'link_id')::uuid) is null, 'resolve: the old link shows nothing');
select is(public.link_professional_account(extensions.digest('token-7', 'sha256'), 'a0000000-0000-0000-0000-000000000009', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: the old link opens no account, even for the new address');
select set_config('test.inv7b', public.create_professional_invitation('a0000000-0000-0000-0000-000000000001', current_setting('test.p7')::uuid,
  extensions.digest('token-7b', 'sha256'))::text, true);
select is(public.resolve_professional_invitation((current_setting('test.inv7b')::jsonb ->> 'link_id')::uuid) ->> 'email', 'p7-nouveau@exemple.test',
  'a new link goes to the new address');
reset role;
-- The address changed without set_professional_email (forced here): the bound link is refused.
update public.professionals set email = 'p7-autre@exemple.test' where id = current_setting('test.p7')::uuid;
set local role service_role;
select ok(public.resolve_professional_invitation((current_setting('test.inv7b')::jsonb ->> 'link_id')::uuid) is null,
  'resolve: a link whose address is no longer the file''s shows nothing');
select is(public.link_professional_account(extensions.digest('token-7b', 'sha256'), 'a0000000-0000-0000-0000-000000000009', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: … and is invalid');
reset role;
select results_eq($$ select l.use_count, p.profile_id from public.secure_links l join public.professionals p on p.id = l.subject_id
                      where l.id = (current_setting('test.inv7b')::jsonb ->> 'link_id')::uuid $$,
  $$ values (0, null::uuid) $$, '… the consumption rolled back');
update public.professionals set email = 'p7-nouveau@exemple.test' where id = current_setting('test.p7')::uuid;
set local role service_role;
select is(public.link_professional_account(extensions.digest('token-7b', 'sha256'), 'a0000000-0000-0000-0000-000000000009', '{}') ->> 'status',
  'accepted', 'the link sent to the current address works');
reset role;
-- An inactive file: nothing is applied (forced here: a deactivation closes the submission).
update public.professional_submissions set status = 'submitted', submitted_at = now()
 where professional_id = current_setting('test.p7')::uuid and status = 'draft';
update public.professionals set status = 'inactive', deactivation_reason_id = current_setting('test.leave')::uuid
 where id = current_setting('test.p7')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.apply_professional_submission((select s.id from public.professional_submissions s
                                                                 where s.professional_id = current_setting('test.p7')::uuid and s.status = 'submitted')) $$,
  'P0001', 'Ce dossier est inactif : réactivez-le d''abord.', 'apply: an inactive file is refused');
reset role;

-- =============================================================================
-- Acceptance refusals: a disabled inviter, an inactive file, an account that already has a profile
-- =============================================================================
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('test.inv8', public.create_professional_invitation('a0000000-0000-0000-0000-000000000002', current_setting('test.p8')::uuid,
  extensions.digest('token-8', 'sha256'))::text, true);
reset role;
update public.profiles set status = 'disabled' where user_id = 'a0000000-0000-0000-0000-000000000002';
set local role service_role;
select is(public.link_professional_account(extensions.digest('token-8', 'sha256'), 'a0000000-0000-0000-0000-000000000010', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: the inviter''s account is disabled (P3-31)');
reset role;
update public.profiles set status = 'active' where user_id = 'a0000000-0000-0000-0000-000000000002';
update public.professionals set status = 'inactive', deactivation_reason_id = current_setting('test.leave')::uuid
 where id = current_setting('test.p8')::uuid;
set local role service_role;
select ok(public.resolve_professional_invitation((current_setting('test.inv8')::jsonb ->> 'link_id')::uuid) is null,
  'resolve: an inactive file shows nothing');
select is(public.link_professional_account(extensions.digest('token-8', 'sha256'), 'a0000000-0000-0000-0000-000000000010', '{}'),
  '{"status": "link_invalid"}'::jsonb, 'accept: an inactive file is refused');
reset role;
update public.professionals set status = 'invited', deactivation_reason_id = null where id = current_setting('test.p8')::uuid;
set local role service_role;
select throws_ok($$ select public.link_professional_account(extensions.digest('token-8', 'sha256'), 'a0000000-0000-0000-0000-000000000010', '{}') $$,
  '23505', null, 'accept: an account that already has a profile is refused');
reset role;
select results_eq($$ select l.use_count, p.profile_id from public.secure_links l join public.professionals p on p.id = l.subject_id
                      where l.id = (current_setting('test.inv8')::jsonb ->> 'link_id')::uuid $$,
  $$ values (0, null::uuid) $$, '… nothing written (rolled back)');

select ok(public.pii_health_check(), 'the health check is true at the end');

select * from finish();
rollback;
