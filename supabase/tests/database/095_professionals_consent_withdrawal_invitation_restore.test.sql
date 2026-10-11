-- Professionnels: a withdrawn image consent (gap audit V5, P4-549) and a failed reminder's link put
-- back (H7, P4-550), migration *_professionals_consent_withdrawal_invitation_restore.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- =============================================================================
-- Fixtures (as postgres): org A. Admin 01 is also the professional of P2; adjointe 02 reviews
-- documents; conseillère 03. P1 holds a verified image consent (paper, uploaded by 02).
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a0000000-0000-0000-0000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'u' || n || '@a.test', '', now(), '{}', '{}', now(), now()
  from generate_series(1, 3) n;
insert into public.organizations (id, name) values ('b0000000-0000-0000-0000-00000000000a', 'Org A');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'u1@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A', 'u2@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'u3@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'counselor');
insert into public.org_modules (org_id, module_key, enabled) values ('b0000000-0000-0000-0000-00000000000a', 'professionals', true);
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Pia', 'Un', 'p1@a.test', 'invited'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001',
   'Ada', 'Deux', 'u1@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id)
select org_id, id from public.professionals where org_id = 'b0000000-0000-0000-0000-00000000000a';
insert into public.professional_matching_profiles (org_id, professional_id)
select org_id, id from public.professionals where org_id = 'b0000000-0000-0000-0000-00000000000a';
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
select ('e0000000-0000-0000-0000-00000000000' || n)::uuid, 'b0000000-0000-0000-0000-00000000000a', 'documents',
       'b0000000-0000-0000-0000-00000000000a/professionals/c0000000-0000-0000-0000-000000000001/e0000000-0000-0000-0000-00000000000' || n || '.pdf',
       'professionals', 'professional_document', 'professional',
       case when n = 3 then 'c0000000-0000-0000-0000-000000000002' else 'c0000000-0000-0000-0000-000000000001' end::uuid,
       'consentement.pdf', 'application/pdf', 'pdf', 2048, repeat('a', 64), 'ready', 'professionals.view',
       'a0000000-0000-0000-0000-000000000002', now()
  from generate_series(1, 3) n;
insert into public.professional_documents (id, org_id, professional_id, document_type_id, stored_file_id, status, uploaded_by, reviewed_by, reviewed_at)
select 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id,
       'e0000000-0000-0000-0000-000000000001', 'verified', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', now()
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';
insert into public.professional_documents (id, org_id, professional_id, document_type_id, stored_file_id, status, uploaded_by, reviewed_by, reviewed_at)
select 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000002', t.id,
       'e0000000-0000-0000-0000-000000000003', 'verified', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', now()
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';

create function pg_temp.consent_ok(p uuid) returns boolean language sql as $$
  select r.consent_ok from public.professionals_readiness r where r.professional_id = p $$;

-- =============================================================================
-- V5: the withdrawal
-- =============================================================================
select is(pg_temp.consent_ok('c0000000-0000-0000-0000-000000000001'), true, 'a verified consent is in force');

set local role authenticated;
-- The conseillère cannot; nobody records it on her own file.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', current_date) $$,
  '42501', null, 'professionals.documents.review only');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000002', current_date) $$,
  'P0001', 'Vous ne pouvez pas réviser vos propres documents.', 'never on one''s own file (P4-304)');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', private.clinic_today() + 400) $$,
  'P0001', 'Indiquez la date du retrait : au plus tard dans un an.', 'a date more than a year ahead is refused');
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', null) $$,
  'P0001', 'Indiquez la date du retrait : au plus tard dans un an.', 'the date is required');

-- A notice period: still in force until the day.
select is(public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', private.clinic_today() + 30, '  Courriel du 10 oct.  '),
  1, 'a withdrawal in 30 days is recorded on the consent');
reset role;
select is(pg_temp.consent_ok('c0000000-0000-0000-0000-000000000001'), true, '… and the consent stays in force until then');
select isnt(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  null, '… for every reader of it');

-- Corrected to today: no longer in force.
set local role authenticated;
select is(public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', private.clinic_today()),
  1, 'a withdrawal still to come can be corrected');
reset role;
select results_eq($$ select d.status, d.withdrawn_on = private.clinic_today_for_org(d.org_id), d.withdrawal_note, d.withdrawn_by, d.withdrawn_at is not null
                       from public.professional_documents d where d.id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('verified'::text, true, null::text, 'a0000000-0000-0000-0000-000000000002'::uuid, true) $$,
  'the document stays verified, with the date, who and when (the note of this second call: none)');
select is(pg_temp.consent_ok('c0000000-0000-0000-0000-000000000001'), false, 'withdrawn: no longer in force');
select ok((select 'image_consent' = any (r.documents_missing) from public.professionals_readiness r
            where r.professional_id = 'c0000000-0000-0000-0000-000000000001'), '… readiness says the consent is missing');
select is(private.professional_image_consent_valid_until('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001'),
  null, '… so a new consent may be signed (start_my_consent_signing, the record''s send)');

set local role authenticated;
select throws_ok($$ select public.withdraw_professional_image_consent('c0000000-0000-0000-0000-000000000001', private.clinic_today()) $$,
  'P0001', 'Aucun consentement au droit à l''image en vigueur dans ce dossier.', 'nothing left in force to withdraw');
select results_eq($$ select (x ->> 'withdrawn_on')::date = private.clinic_today(), x ->> 'withdrawn_by_name'
                       from jsonb_array_elements(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'documents') x
                      where x ->> 'id' = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values (true, 'Adjointe A'::text) $$, 'the Documents tab reads the withdrawal and who recorded it');
reset role;

select is((select count(*)::int from public.audit_log a
            where a.table_name = 'professional_documents' and a.action = 'update'
              and a.record_id = 'c0000000-0000-0000-0000-000000000001:d0000000-0000-0000-0000-000000000001'
              and a.changed_fields ? 'withdrawn_on'), 2, 'each recording is audited (Historique)');

-- A new consent later: in force again.
insert into public.professional_documents (id, org_id, professional_id, document_type_id, stored_file_id, status, uploaded_by, reviewed_by, reviewed_at)
select 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', t.id,
       'e0000000-0000-0000-0000-000000000002', 'verified', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', now()
  from public.document_types t where t.org_id = 'b0000000-0000-0000-0000-00000000000a' and t.key = 'image_consent';
select is(pg_temp.consent_ok('c0000000-0000-0000-0000-000000000001'), true, 'a new consent signed later is in force');
select throws_ok($$ update public.professional_documents set status = 'pending', reviewed_at = null
                     where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'only a verified document carries a withdrawal');

-- =============================================================================
-- H7: the reminder's link put back
-- =============================================================================
insert into public.secure_links (id, org_id, purpose, subject_type, subject_id, token_hash, scope, max_uses, expires_at, revoked_at, created_by, created_at)
values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professional_invite', 'professional',
   'c0000000-0000-0000-0000-000000000001', decode(repeat('01', 32), 'hex'), '{"email": "p1@a.test"}', 1, now() + interval '3 days', now(),
   'a0000000-0000-0000-0000-000000000002', now() - interval '4 days'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professional_invite', 'professional',
   'c0000000-0000-0000-0000-000000000001', decode(repeat('02', 32), 'hex'), '{"email": "p1@a.test"}', 1, now() + interval '7 days', null,
   'a0000000-0000-0000-0000-000000000002', now());
insert into public.professional_submissions (id, org_id, professional_id, kind, status, requested_sections, secure_link_id)
values ('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
        'onboarding', 'draft', array['personal'], 'f0000000-0000-0000-0000-000000000002');

select function_privs_are('public', 'restore_professional_invitation_for_service', array['uuid', 'uuid', 'uuid', 'uuid'], 'authenticated',
  array[]::text[], 'restore: never a user');

set local role service_role;
select is(public.restore_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001'), true, 'a failed reminder puts the previous link back');
reset role;
select results_eq($$ select l.id::text, l.revoked_at is null from public.secure_links l
                      where l.subject_id = 'c0000000-0000-0000-0000-000000000001' order by l.id $$,
  $$ values ('f0000000-0000-0000-0000-000000000001'::text, true), ('f0000000-0000-0000-0000-000000000002', false) $$,
  'the previous link is live again, the reminder''s revoked');
select is((select s.secure_link_id from public.professional_submissions s where s.id = 'a1000000-0000-0000-0000-000000000001'),
  'f0000000-0000-0000-0000-000000000001'::uuid, 'the draft questionnaire points to it again');

-- Never over a link someone opened, nor to an expired one.
set local role service_role;
select is(public.restore_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001'), false, 'the reminder''s link is no longer live: nothing to do');
reset role;
update public.secure_links set revoked_at = now() where id = 'f0000000-0000-0000-0000-000000000001';
update public.secure_links set revoked_at = null where id = 'f0000000-0000-0000-0000-000000000002';
update public.secure_links set last_opened_at = now() where id = 'f0000000-0000-0000-0000-000000000002';
set local role service_role;
select is(public.restore_professional_invitation_for_service('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001'), false, 'an opened link stays');
reset role;

select * from finish();
rollback;
