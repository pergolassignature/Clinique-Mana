-- Professionnels: the image consent never expires and has one source (migration
-- *_professionals_image_consent_one_source.sql, decisions P4-504 and P4-507). Covers: the type's rule is `none` in every clinic and for a
-- new one, and cannot become anything else; a signed consent's document has no end date; only a
-- verified document is in force (valid_until, readiness, the Documents tab), never the retired
-- e-consent; the data fix (documents' end dates cleared, an « expired » consent back to verified,
-- the Documenso template: the default and a clinic's draft corrected in place, a published
-- version replaced by a new published one, a clinic's own wording left alone), idempotent.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01); P1 with an e-consent signed two years ago (its old
-- end date passed), P2 with a withdrawn one, P3 with an image-consent document marked expired
-- by the old rule, P4 with nothing.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, first_name, last_name, email, status)
select ('c0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'P', 'N' || n, 'p' || n || '@exemple.test', 'active'
  from generate_series(1, 4) n;
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.org_id = 'b0000000-0000-0000-0000-00000000000a';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.org_id = 'b0000000-0000-0000-0000-00000000000a';
insert into public.professional_consents (org_id, professional_id, consent_version_id, signer_name, signed_at, expires_on, withdrawn_at, withdrawal_effective_on)
select 'b0000000-0000-0000-0000-00000000000a', x.pid,
       (select v.id from public.consent_versions v where v.org_id = 'b0000000-0000-0000-0000-00000000000a' and v.version = 1),
       'P N', now() - interval '2 years', (now() - interval '1 year')::date, x.withdrawn, x.effective
  from (values ('c0000000-0000-0000-0000-000000000001'::uuid, null::timestamptz, null::date),
               ('c0000000-0000-0000-0000-000000000002', now() - interval '6 months', (now() - interval '3 months')::date)) as x(pid, withdrawn, effective);
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
values ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000003/e0000000-0000-0000-0000-000000000003.pdf',
        'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000003', 'consentement.pdf',
        'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view', 'a0000000-0000-0000-0000-000000000001', now());
insert into public.professional_documents (id, org_id, professional_id, document_type_id, stored_file_id, status, expires_on, uploaded_by, reviewed_at)
select 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', t.id,
       'e0000000-0000-0000-0000-000000000003', 'expired', date '2025-01-01', 'a0000000-0000-0000-0000-000000000001', now() - interval '2 years'
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';

-- =============================================================================
-- The type: no expiry, for good
-- =============================================================================
select is_empty($$ select 1 from public.document_types t where t.key = 'image_consent' and t.expiry_rule <> 'none' $$,
  'the image consent has no expiry rule in any clinic');
select throws_ok($$ update public.document_types set expiry_rule = 'months_12'
                    where org_id = 'b0000000-0000-0000-0000-00000000000a' and key = 'image_consent' $$,
  '23514', null, 'and cannot get one back');
select is((select t.expiry_rule from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'insurance'),
  'next_march_31', 'the insurance keeps its rule');
select is(private.document_default_expiry('none', current_date), null::date, 'a signed consent''s document gets no end date (rule none)');

-- =============================================================================
-- In force: a verified document only (P4-507), with no end
-- =============================================================================
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  null::date, 'the retired e-consent is no longer read');
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003'),
  null::date, 'a consent document marked expired by the old rule: not in force before the repair');
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004'),
  null::date, 'nothing signed: nothing in force');
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001'), null::jsonb, '(no caller: nothing read)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select r.consent_ok, 'image_consent' = any (r.documents_missing) from public.professionals_readiness r
                      where r.professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values (false, true) $$, 'readiness: the retired e-consent no longer counts (P4-507)');
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'consent', 'null'::jsonb,
  'the Documents tab reads no e-consent');
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003'),
  false, 'readiness: a consent document marked expired by the old rule does not count before the repair');
reset role;

-- =============================================================================
-- The data fix (the migration's own function, run again: idempotent)
-- =============================================================================
select lives_ok($$ select private.professionals_image_consent_no_expiry() $$, 'the repair runs');
select results_eq($$ select d.status, d.expires_on from public.professional_documents d where d.id = 'd0000000-0000-0000-0000-000000000003' $$,
  $$ values ('verified'::text, null::date) $$, 'a consent document: back to verified, no end date');
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003'),
  date '2100-12-31', '… in force, with no end');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select r.consent_ok from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000003'),
  true, '… and counts in readiness');
reset role;

-- The template's default, and the clinic's draft (seeded with it).
select set_config('test.tpl', (select t.id::text from public.document_templates t
                                where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.image_consent'), true);
select ok(private.professionals_image_consent_template()::text !~ '12 mois|renouvel',
  'the default text: no 12 months, no renewal');
select ok((select v.body::text ~ 'sans limite de durée' and v.body::text !~ '12 mois|renouvel' from public.document_template_versions v
            where v.template_id = current_setting('test.tpl')::uuid and v.status = 'draft'),
  'a new clinic''s draft says the consent has no time limit');

-- A clinic's draft that still holds the old clause is corrected in place.
create function private.test_old_clause(p_body jsonb) returns jsonb
language sql set search_path = '' as $$
  select pg_catalog.jsonb_set(p_body, '{blocks,9,runs}', '[{"text": "Ce consentement est valide pour une période de "}, {"text": "12 mois", "bold": true},
    {"text": " à compter de la date de signature et sera "}, {"text": "renouvelé automatiquement", "bold": true},
    {"text": " pour des périodes successives de 12 mois, sauf retrait de ma part."}]'::jsonb)
$$;
update public.document_template_versions v set body = private.test_old_clause(v.body)
 where v.template_id = current_setting('test.tpl')::uuid and v.status = 'draft';
select private.professionals_image_consent_no_expiry();
select results_eq($$ select v.version, v.status, v.body::text ~ 'sans limite de durée' and v.body::text !~ '12 mois|renouvel'
                       from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid $$,
  $$ values (1, 'draft'::text, true) $$, 'a draft with the old clause: corrected in place, still a draft');

-- A published version with the old clause: a new version is published, as « Publier » would.
update public.document_template_versions v set body = private.test_old_clause(v.body)
 where v.template_id = current_setting('test.tpl')::uuid;
update public.document_template_versions v set status = 'published', published_at = now() - interval '1 day'
 where v.template_id = current_setting('test.tpl')::uuid;
select throws_ok($$ update public.document_template_versions set body = '{}' where template_id = current_setting('test.tpl')::uuid $$,
  'P0001', null, '(a published version never changes)');
select private.professionals_image_consent_no_expiry();
select results_eq($$ select v.version, v.status, v.body::text ~ 'sans limite de durée' and v.body::text !~ '12 mois|renouvel'
                       from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid order by v.version $$,
  $$ values (1, 'archived'::text, false), (2, 'published', true) $$,
  'a published version with the old clause: archived, and version 2 with the corrected text published');
select private.professionals_image_consent_no_expiry();
select is((select count(*)::int from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid), 2,
  'run again: nothing more');

-- A clinic's own wording is never rewritten.
update public.document_template_versions v set status = 'archived', archived_at = now()
 where v.template_id = current_setting('test.tpl')::uuid and v.status = 'published';
insert into public.document_template_versions (template_id, org_id, version, body, variables, signers, email_subject, email_message, status)
select v.template_id, v.org_id, 3,
       pg_catalog.jsonb_set(v.body, '{blocks,9,runs}', '[{"text": "Valide 12 mois, à notre façon."}]'::jsonb),
       v.variables, v.signers, v.email_subject, v.email_message, 'draft'
  from public.document_template_versions v where v.template_id = current_setting('test.tpl')::uuid and v.version = 2;
select private.professionals_image_consent_no_expiry();
select ok((select v.body::text ~ 'à notre façon' from public.document_template_versions v
            where v.template_id = current_setting('test.tpl')::uuid and v.version = 3),
  'a clause the clinic wrote itself is left as it is (the migration reports it)');

select * from finish();
rollback;
