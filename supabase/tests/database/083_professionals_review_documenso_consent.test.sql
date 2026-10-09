-- Professionnels: the review sheet reads the image consent signed through Documenso (migration
-- *_professionals_review_documenso_consent.sql, gap audit V4, P4-505). Covers: get_submission_review's
-- consent field: nothing on file; a Documenso signature made during the questionnaire (current
-- and submitted, source `signature`, the professional's signing time, nothing to apply); one made
-- before the questionnaire opened (current only); a newer paper consent (source `document`); no
-- end date anywhere (P4-504).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, the reviewer; provider 03 linked to P1). P1's update
-- questionnaire asks for the consent, opened two days ago and sent.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pia@exemple.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pia Un', 'pia@exemple.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003',
   'Pia', 'Un', 'pia@exemple.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id) values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_matching_profiles (org_id, professional_id) values ('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.professional_submissions (id, org_id, professional_id, kind, status, requested_sections, submitted_values, created_at, submitted_at)
values ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        'update', 'submitted', array['consent'], '{}', now() - interval '2 days', now() - interval '1 hour');

-- A signed image-consent request for P1 (as core's capture leaves it): `n` names it, `p_signed` is
-- when she signed.
create function private.test_signed_consent(n int, p_signed timestamptz) returns void
language plpgsql set search_path = '' as $$
declare
  v_req uuid := ('d0000000-0000-0000-0000-00000000000' || n)::uuid;
  v_file uuid := ('f0000000-0000-0000-0000-00000000000' || n)::uuid;
begin
  insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id, title, status,
                                         envelope_id, idempotency_key, view_permission, sent_at)
  values (v_req, 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.image_consent',
          (select v.id from public.document_template_versions v join public.document_templates t on t.id = v.template_id
            where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'professionals.image_consent'),
          'professional', 'c0000000-0000-0000-0000-000000000001', 'Consentement — Pia Un', 'sent', 'envelope_consent' || n,
          'consent-' || n, 'professionals.view', p_signed - interval '1 hour');
  insert into public.signature_request_signers (request_id, org_id, role, name, email, signing_order, status, signed_at)
  values (v_req, 'b0000000-0000-0000-0000-00000000000a', 'professional', 'Pia Un', 'pia@exemple.test', 1, 'signed', p_signed);
  insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, view_permission,
                                   original_name, mime_type, ext, size_bytes, sha256, status, confirmed_at)
  values (v_file, 'b0000000-0000-0000-0000-00000000000a', 'signed-documents',
          'b0000000-0000-0000-0000-00000000000a/core/' || v_req || '/' || v_file || '.pdf',
          'core', 'signing_signed', 'signature_request', v_req, 'professionals.view',
          'Consentement signé.pdf', 'application/pdf', 'pdf', 1000, repeat('d', 64), 'ready', now());
  update public.signature_requests set status = 'signed', completed_at = now(), completed_event_at = now(),
         signed_file_id = v_file, signed_sha256 = repeat('d', 64)
   where id = v_req;
end;
$$;

-- The consent field of the review, as the reviewer reads it.
create function private.test_consent_field() returns jsonb
language sql set search_path = '' as $$
  select f from jsonb_array_elements(public.get_submission_review('e0000000-0000-0000-0000-000000000001') -> 'sections') s,
                jsonb_array_elements(s -> 'fields') f
   where f ->> 'field' = 'consent'
$$;
grant execute on function private.test_consent_field() to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_consent_field() - 'label_key',
  '{"field": "consent", "kind": "consent", "answered": false, "changed": false, "current": null, "submitted": null}'::jsonb,
  'nothing signed: nothing on file, nothing in the answer');

-- Signed through Documenso before the questionnaire opened: on file only.
reset role;
select private.test_signed_consent(1, now() - interval '30 days');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_consent_field() -> 'current',
  jsonb_build_object('source', 'signature', 'request_id', 'd0000000-0000-0000-0000-000000000001', 'signed_at', now() - interval '30 days'),
  'an earlier signature through Documenso: on file, « Signé électroniquement le … », no end date');
select is(private.test_consent_field() -> 'submitted', 'null'::jsonb, '… not the questionnaire''s answer');

-- Signed in the questionnaire's « Consentement » step (P4-487): on file and the step's answer.
reset role;
select private.test_signed_consent(2, now() - interval '3 hours');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_consent_field() -> 'current',
  jsonb_build_object('source', 'signature', 'request_id', 'd0000000-0000-0000-0000-000000000002', 'signed_at', now() - interval '3 hours'),
  'signed in the questionnaire: the newest signature is on file');
select is(private.test_consent_field() -> 'submitted',
  jsonb_build_object('source', 'signature', 'request_id', 'd0000000-0000-0000-0000-000000000002', 'signed_at', now() - interval '3 hours'),
  '… and is the step''s answer (never « Pas encore signé »)');
select is((private.test_consent_field() ->> 'answered')::boolean, false, '… with nothing to apply (it is already on file)');
select ok(private.test_consent_field()::text !~ 'expires_on|valid', 'no end date in the field (P4-504)');

-- A newer paper consent staff attached: on file as a document.
reset role;
insert into public.stored_files (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
                                 size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
values ('f0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'documents',
        'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/f0000000-0000-0000-0000-000000000009.pdf',
        'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'papier.pdf',
        'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view', 'a0000000-0000-0000-0000-000000000001', now());
insert into public.professional_documents (org_id, professional_id, document_type_id, stored_file_id, status, uploaded_by, uploaded_at, reviewed_at)
select 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id, 'f0000000-0000-0000-0000-000000000009',
       'verified', 'a0000000-0000-0000-0000-000000000001', now() - interval '1 minute', now()
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(private.test_consent_field() -> 'current', jsonb_build_object('source', 'document', 'uploaded_at', now() - interval '1 minute'),
  'a newer paper consent: on file as a document');
reset role;

select * from finish();
rollback;
