-- Professionnels documents (migration *_professionals_documents.sql, plan Phase 4 Tasks 4c.1 and
-- 4c.2). Covers: privileges (tables, RPCs, private helpers); permissions and upload purposes; the
-- seeded document types; the date helpers (next March 31, the rule's default, French dates);
-- « Documents requis » (save, archive, reorder, catalogue); attach (staff verified or pending,
-- provider pending with its notice, every refusal); verify, reject (file soft-deleted), redate,
-- delete; nobody reviews their own record; reads (get_professional_documents, RLS, the owner branch
-- on stored_files); readiness (photo, insurance missing vs expired, e-consent, other required
-- types) and the list and directory columns; the approval hook (the questionnaire's photo and
-- insurance become verified documents, the submission notice closes); notices closed by
-- expire_notifications; audit and history.
begin;
create extension if not exists pgtap with schema extensions;
select plan(116);

-- The HINT of the error p_sql raises (null when none): throws_ok checks code and message only.
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
-- Fixtures (as postgres): org A (admin 01 who is also professional P4, adjointe 02, provider 03
-- linked to P2, conseillère 04, adjointe 06 without documents.review), org B (admin 05).
-- P1 active without account, P2 active (provider 03), P4 active (admin 01); P3 in org B.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conseillere@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',       '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adjointe2@a.test',   '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',       'admin@a.test',       'active'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe A',    'adjointe@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A',    'provider@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'Conseillère A', 'conseillere@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',       'admin@b.test',       'active'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'Adjointe Deux', 'adjointe2@a.test',   'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'counselor'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'admin_assistant');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted, created_by)
values ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'professionals.documents.review', false,
        'a0000000-0000-0000-0000-000000000001');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', null, 'Paul', 'Un', 'p1@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Pia', 'Deux', 'provider@a.test', 'active'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', null, 'Pat', 'Trois', 'p3@exemple.test', 'active'),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'Ana', 'Quatre', 'admin@a.test', 'active');
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-00000000000_';

select set_config('test.a', 'b0000000-0000-0000-0000-00000000000a', true);
select set_config('test.today', (select (now() at time zone o.timezone)::date::text from public.organizations o
                                  where o.id = 'b0000000-0000-0000-0000-00000000000a'), true);
select set_config('test.next_march_31', private.next_march_31(current_setting('test.today')::date)::text, true);

-- Uploaded files, ready (as storage-confirm leaves them): staff uploads (professional_document),
-- the provider's (professional_self_document, owner 03), two staged questionnaire files already
-- attached to P2 (as apply leaves them), and a staff upload past its staging.
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, owner_profile_id, owner_permission, retain_until, uploaded_by, confirmed_at)
select f.id, current_setting('test.a')::uuid, 'documents',
       current_setting('test.a') || '/professionals/' || f.subject || '/' || f.id || '.' || f.ext,
       'professionals', f.purpose, f.subject_type, f.subject::uuid, 'fichier.' || f.ext, f.mime, f.ext, f.size,
       repeat('a', 64), 'ready', f.view, f.owner, case when f.owner is not null then 'professionals.self' end,
       f.retain, f.uploader, now()
  from (values
    ('e0000000-0000-0000-0000-000000000001'::uuid, 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'application/pdf', 'pdf', 2048, 'professionals.view', null::uuid, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000002'::uuid),
    ('e0000000-0000-0000-0000-000000000002', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'image/png', 'png', 2048, 'professionals.view', null, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000006'),
    ('e0000000-0000-0000-0000-000000000003', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'application/pdf', 'pdf', 2048, 'professionals.view', null, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000002'),
    ('e0000000-0000-0000-0000-000000000004', 'professional_self_document', 'professional', 'c0000000-0000-0000-0000-000000000002', 'application/pdf', 'pdf', 2048, 'professionals.view', 'a0000000-0000-0000-0000-000000000003', now() + interval '1 day', 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000005', 'professional_self_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'image/png', 'png', 2048, 'professionals.view', 'a0000000-0000-0000-0000-000000000003', now() + interval '1 day', 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000006', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000004', 'application/pdf', 'pdf', 2048, 'professionals.view', null, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000001'),
    ('e0000000-0000-0000-0000-000000000007', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'image/png', 'png', 2048, 'professionals.view', null, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000002'),
    ('e0000000-0000-0000-0000-000000000008', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'application/pdf', 'pdf', 2048, 'professionals.view', null, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000002'),
    ('e0000000-0000-0000-0000-000000000009', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'image/png', 'png', 6291456, 'professionals.view', null, now() + interval '1 day', 'a0000000-0000-0000-0000-000000000002'),
    ('e0000000-0000-0000-0000-000000000010', 'professional_submission_file', 'professional', 'c0000000-0000-0000-0000-000000000002', 'image/png', 'png', 2048, 'professionals.view', 'a0000000-0000-0000-0000-000000000003', null, 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000011', 'professional_submission_file', 'professional', 'c0000000-0000-0000-0000-000000000002', 'application/pdf', 'pdf', 2048, 'professionals.view', 'a0000000-0000-0000-0000-000000000003', null, 'a0000000-0000-0000-0000-000000000003'),
    ('e0000000-0000-0000-0000-000000000012', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'application/pdf', 'pdf', 2048, 'professionals.view', null, now() - interval '1 hour', 'a0000000-0000-0000-0000-000000000002')
  ) as f(id, purpose, subject_type, subject, mime, ext, size, view, owner, retain, uploader);

-- =============================================================================
-- Privileges and catalogue rows
-- =============================================================================
select has_table('public', 'document_types', 'document_types exists');
select has_table('public', 'professional_documents', 'professional_documents exists');
select table_privs_are('public', 'document_types', 'authenticated', array['SELECT'], 'authenticated: select only on document types');
select table_privs_are('public', 'document_types', 'anon', array[]::text[], 'anon: nothing on document types');
select table_privs_are('public', 'professional_documents', 'authenticated', array['SELECT'], 'authenticated: select only on documents');
select table_privs_are('public', 'professional_documents', 'anon', array[]::text[], 'anon: nothing on documents');
select column_privs_are('public', 'professional_public_profiles', 'photo_document_id', 'authenticated', array['SELECT'],
  'the photo is set by the RPCs only');

select function_privs_are('public', 'save_document_type', array['uuid', 'text', 'boolean', 'text', 'integer[]', 'boolean', 'text[]', 'integer'],
  'authenticated', array['EXECUTE'], 'save_document_type: authenticated');
select function_privs_are('public', 'attach_professional_document', array['uuid', 'text', 'uuid', 'date', 'jsonb'],
  'authenticated', array['EXECUTE'], 'attach: authenticated');
select function_privs_are('public', 'verify_professional_document', array['uuid', 'date'], 'authenticated', array['EXECUTE'], 'verify: authenticated');
select function_privs_are('public', 'reject_professional_document', array['uuid', 'text'], 'authenticated', array['EXECUTE'], 'reject: authenticated');
select function_privs_are('public', 'set_professional_document_expiry', array['uuid', 'date'], 'authenticated', array['EXECUTE'], 'expiry: authenticated');
select function_privs_are('public', 'delete_professional_document', array['uuid'], 'authenticated', array['EXECUTE'], 'delete: authenticated');
select function_privs_are('public', 'get_professional_documents', array['uuid'], 'authenticated', array['EXECUTE'], 'read: authenticated');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_document_type', 'attach_professional_document', 'verify_professional_document',
                       'reject_professional_document', 'set_professional_document_expiry', 'delete_professional_document',
                       'get_professional_documents')
     and (not p.prosecdef or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
$$, 'the RPCs are security definer, for authenticated only (not anon, not service_role)');
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('clinic_today_for_org', 'expire_notifications', 'next_march_31', 'document_default_expiry',
                       'format_date_fr', 'seed_professionals_document_types', 'seed_professionals_document_types_on_org',
                       'professional_insurance_state', 'after_professional_documents_change', 'lock_professional_document',
                       'assert_not_own_document', 'professional_submissions_documents')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
$$, 'the private helpers are granted to no API role');

select results_eq($$ select role, permission_key from public.role_permissions
                      where permission_key like 'professionals.documents.%' order by 1, 2 $$,
  $$ values ('admin'::text, 'professionals.documents.delete'::text), ('admin', 'professionals.documents.review'),
            ('admin_assistant', 'professionals.documents.review') $$,
  'documents.review for the admin and the adjointe, documents.delete for the admin');
select results_eq($$ select key, upload_permission, view_permission, owner_permission, max_bytes, retain_days
                       from public.upload_purposes where key in ('professional_document', 'professional_self_document') order by key $$,
  $$ values ('professional_document'::text, 'professionals.manage'::text, 'professionals.view'::text, null::text, 10485760, 1),
            ('professional_self_document', 'professionals.self', 'professionals.view', 'professionals.self', 10485760, 1) $$,
  'two upload purposes, staged one day, read with professionals.view');

select results_eq($$ select key, is_system, required, expiry_rule, reminder_days, weekly_after_expiry, max_bytes
                       from public.document_types where org_id = current_setting('test.a')::uuid order by sort_order $$,
  $$ values ('photo'::text, true, true, 'none'::text, '{}'::int[], false, 5242880),
            ('insurance', true, true, 'next_march_31', '{7}', true, 10485760),
            ('image_consent', true, true, 'months_12', '{}', false, 10485760),
            ('cv', false, false, 'none', '{}', false, 10485760),
            ('diploma', false, false, 'none', '{}', false, 10485760),
            ('licence_attestation', false, false, 'none', '{}', false, 10485760),
            ('other', false, false, 'none', '{}', false, 10485760) $$,
  'seven types per clinic; photo, insurance and the image consent are system types; never `license`');
select is((select accepted_mime from public.document_types where org_id = current_setting('test.a')::uuid and key = 'photo'),
  array['image/jpeg', 'image/png'], 'the photo is a JPEG or PNG (the fiche)');

-- =============================================================================
-- Dates
-- =============================================================================
select is(private.next_march_31('2026-03-31'), date '2026-03-31', 'on March 31: the same day');
select is(private.next_march_31('2026-04-01'), date '2027-03-31', 'from April 1: next year''s');
select is(private.next_march_31('2027-02-28'), date '2027-03-31', 'before March 31: this year''s');
select is(private.document_default_expiry('months_12', '2026-10-08'), date '2027-10-08', 'months_12: the date + 12 months');
select is(private.document_default_expiry('none', '2026-10-08'), null::date, 'none: no default');
select is(private.format_date_fr('2027-03-31'), '31 mars 2027', 'French date');
select is(private.format_date_fr('2020-01-01'), '1 janvier 2020', 'no « 1er », as formatDateOnly');
select is(private.format_date_fr('2026-08-15'), '15 août 2026', 'accents kept');

-- =============================================================================
-- « Documents requis »
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.t_new', public.save_document_type(null, '  Formation   continue ', true)::text, true);
select results_eq($$ select key, name, required, expiry_rule, reminder_days, sort_order, is_system
                       from public.document_types where id = current_setting('test.t_new')::uuid $$,
  $$ values ('formation_continue'::text, 'Formation continue'::text, true, 'none'::text, '{}'::int[], 80, false) $$,
  'a new type: key from the name, last, not a system type, defaults');
select throws_ok($$ select public.save_document_type(current_setting('test.t_new')::uuid, 'Formation continue', null, 'months_12', array[7]) $$,
  'P0001', 'Les rappels ne s''appliquent qu''à la preuve d''assurance.', 'reminders are the insurance''s only');
select set_config('test.t_ins', (select id::text from public.document_types where org_id = current_setting('test.a')::uuid and key = 'insurance'), true);
select public.save_document_type(current_setting('test.t_ins')::uuid, 'Preuve d''assurance responsabilité', null, null, array[7, 30, 7]);
select is((select reminder_days from public.document_types where id = current_setting('test.t_ins')::uuid), array[30, 7],
  'insurance reminders stored distinct, largest first');
select throws_ok($$ select public.save_document_type(current_setting('test.t_ins')::uuid, 'Preuve d''assurance responsabilité', null, null, array[120]) $$,
  'P0001', 'Les rappels vont de 1 à 90 jours avant l''échéance, trois au plus.', 'reminders within 1–90 days');
select throws_ok($$ select public.save_document_type(current_setting('test.t_ins')::uuid, 'Preuve d''assurance responsabilité', null, 'none') $$,
  'P0001', 'Les rappels demandent une échéance.', 'reminders need an expiry rule');
select is(private.test_error_hint($$ select public.save_document_type(
            (select id from public.document_types where key = 'photo' and org_id = current_setting('test.a')::uuid),
            'Photo professionnelle', null, null, null, null, array['application/pdf']) $$),
  'accepted_mime', 'the photo stays an image (HINT accepted_mime)');
select throws_ok($$ select public.save_document_type(null, 'Petit', null, null, null, null, null, 1000) $$,
  'P0001', 'La taille maximale va de 100 Ko à 10 Mo.', 'size within the purposes'' caps');
select throws_ok($$ select public.save_document_type(null, 'cv') $$,
  'P0001', 'Un type de document porte déjà ce nom (il est peut-être archivé).', 'names unique per clinic, ignoring case');
select throws_ok($$ select public.save_document_type(null, 'X', null, null, null, null, array['text/html']) $$,
  '22023', null, 'unknown file types: 22023');
select throws_ok($$ select public.set_professionals_reference_active('document_types', current_setting('test.t_ins')::uuid, false) $$,
  'P0001', 'Ce document est suivi par l''application (dossier prêt, rappels) ; il ne peut pas être archivé. Vous pouvez le rendre facultatif.',
  'system types are never archived');
select lives_ok($$ select public.set_professionals_reference_active('document_types', current_setting('test.t_new')::uuid, false) $$,
  'another type is archived');
select is((select is_active from public.document_types where id = current_setting('test.t_new')::uuid), false, 'archived');
select public.reorder_professionals_reference('document_types',
  array(select id from public.document_types where org_id = current_setting('test.a')::uuid order by sort_order desc));
select is((select key from public.document_types where org_id = current_setting('test.a')::uuid order by sort_order limit 1),
  'formation_continue', 'reorder works on document types');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.save_document_type(null, 'Autre chose') $$, '42501', null, 'the adjointe does not edit the list');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_professionals_catalog() -> 'document_types'), 8, 'the catalogue carries the clinic''s types, archived included');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.document_types), 8, 'the provider reads the types (Mes documents)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::int from public.document_types where org_id = current_setting('test.a')::uuid), 0, 'another clinic reads none');
reset role;
-- Back to the plan's order and settings for what follows.
update public.document_types set reminder_days = '{7}' where id = current_setting('test.t_ins')::uuid;
update public.document_types set sort_order = case key when 'photo' then 10 when 'insurance' then 20 when 'image_consent' then 30
  when 'cv' then 40 when 'diploma' then 50 when 'licence_attestation' then 60 when 'other' then 70 else 80 end
 where org_id = current_setting('test.a')::uuid;

-- =============================================================================
-- Attach
-- =============================================================================
set local role authenticated;
-- The adjointe (documents.review): verified at once, default expiry, the file now the professional's.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.d_ins1', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'insurance',
  'e0000000-0000-0000-0000-000000000001', null, '{"insurer": "  La Capitale ", "policy_number": null}')::text, true);
select results_eq($$ select status, expires_on, metadata, uploaded_by, reviewed_by, reviewed_at is not null
                       from public.professional_documents where id = current_setting('test.d_ins1')::uuid $$,
  $$ values ('verified'::text, current_setting('test.next_march_31')::date, '{"insurer": "La Capitale"}'::jsonb,
             'a0000000-0000-0000-0000-000000000002'::uuid, 'a0000000-0000-0000-0000-000000000002'::uuid, true) $$,
  'staff with documents.review: verified, the next March 31 by default, metadata tidied');
reset role;
select results_eq($$ select subject_type, subject_id, view_permission, owner_profile_id, retain_until
                       from public.stored_files where id = 'e0000000-0000-0000-0000-000000000001' $$,
  $$ values ('professional'::text, 'c0000000-0000-0000-0000-000000000001'::uuid, 'professionals.view'::text, null::uuid, null::timestamptz) $$,
  'the file is attached to the professional (no account: no owner), staging cleared');
set local role authenticated;

-- Adjointe 06 (documents.review revoked): pending, a notice for the reviewers.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.d_photo1', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'photo',
  'e0000000-0000-0000-0000-000000000002')::text, true);
select is((select status from public.professional_documents where id = current_setting('test.d_photo1')::uuid), 'pending',
  'staff without documents.review: pending');
reset role;
select results_eq($$ select kind, recipient_permission, title, body, link_path, subject_type, subject_id, expires_at
                       from public.notifications where dedupe_key = 'document:' || current_setting('test.d_photo1') || ':uploaded' $$,
  $$ values ('professionals.document_to_review'::text, 'professionals.documents.review'::text, 'Document à vérifier'::text,
             'Paul Un a téléversé un document : Photo professionnelle.'::text,
             '/professionnels/c0000000-0000-0000-0000-000000000001/documents'::text, 'professional_document'::text,
             current_setting('test.d_photo1')::uuid, null::timestamptz) $$,
  'a pending document notifies the reviewers (name and type only)');
set local role authenticated;

-- Refusals.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'licence',
                      'e0000000-0000-0000-0000-000000000003') $$, 'P0001', 'Type de document inconnu.', 'an unknown type');
select is(private.test_error_hint($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'photo',
            'e0000000-0000-0000-0000-000000000003') $$), 'file', 'a PDF is not a photo (HINT file)');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'photo',
                      'e0000000-0000-0000-0000-000000000009') $$,
  'P0001', 'Ce fichier dépasse la taille permise pour ce document (5 Mo).', 'the type''s size cap');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Fichier introuvable. Téléversez-le de nouveau.', 'a file already a document');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000005') $$,
  'P0001', 'Fichier introuvable. Téléversez-le de nouveau.', 'staff cannot attach a provider''s upload (another purpose)');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000012') $$,
  'P0001', 'Fichier introuvable. Téléversez-le de nouveau.', 'an upload past its staging');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000003', current_date + 30) $$,
  'P0001', 'Ce type de document n''a pas d''échéance.', 'no date for a type without expiry');
select is(private.test_error_hint($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'insurance',
            'e0000000-0000-0000-0000-000000000003', current_setting('test.today')::date - 1) $$),
  'expires_on', 'an expiry already past (HINT expires_on)');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000003', null, '{"insurer": "x"}') $$,
  '22023', null, 'metadata only for the insurance');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000003', 'cv',
                      'e0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Professionnel introuvable.', 'another clinic''s professional');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000003') $$, '42501', null, 'the conseillère cannot attach');

-- The provider: their own record and upload only, always pending.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
                      'e0000000-0000-0000-0000-000000000005') $$, '42501', null, 'the provider cannot attach to another record');
select throws_ok($$ select public.attach_professional_document('c0000000-0000-0000-0000-000000000002', 'cv',
                      'e0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'Fichier introuvable. Téléversez-le de nouveau.', 'the provider attaches only their own upload of their purpose');
select set_config('test.d_ins2', public.attach_professional_document('c0000000-0000-0000-0000-000000000002', 'insurance',
  'e0000000-0000-0000-0000-000000000004', current_setting('test.today')::date + 200)::text, true);
select results_eq($$ select status, expires_on, uploaded_by from public.professional_documents where id = current_setting('test.d_ins2')::uuid $$,
  $$ values ('pending'::text, current_setting('test.today')::date + 200, 'a0000000-0000-0000-0000-000000000003'::uuid) $$,
  'the provider''s upload: pending, with the date given');
reset role;
select results_eq($$ select owner_profile_id, owner_permission from public.stored_files where id = 'e0000000-0000-0000-0000-000000000004' $$,
  $$ values ('a0000000-0000-0000-0000-000000000003'::uuid, 'professionals.self'::text) $$,
  'the provider owns the attached file (owner branch)');
set local role authenticated;

-- The admin is also professional P4: her own upload stays pending.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.d_own', public.attach_professional_document('c0000000-0000-0000-0000-000000000004', 'diploma',
  'e0000000-0000-0000-0000-000000000006')::text, true);
select is((select status from public.professional_documents where id = current_setting('test.d_own')::uuid), 'pending',
  'a document of one''s own record is never verified by its uploader');
select throws_ok($$ select public.verify_professional_document(current_setting('test.d_own')::uuid) $$,
  'P0001', 'Vous ne pouvez pas réviser vos propres documents.', 'nobody verifies their own record');

-- =============================================================================
-- Verify, reject, redate, delete
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.verify_professional_document(current_setting('test.d_photo1')::uuid) $$, '42501', null,
  'the conseillère cannot verify');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.verify_professional_document(current_setting('test.d_photo1')::uuid, current_setting('test.today')::date) $$,
  'P0001', 'Ce type de document n''a pas d''échéance.', 'no date for a photo');
select lives_ok($$ select public.verify_professional_document(current_setting('test.d_photo1')::uuid) $$, 'the adjointe verifies the photo');
select results_eq($$ select status, reviewed_by from public.professional_documents where id = current_setting('test.d_photo1')::uuid $$,
  $$ values ('verified'::text, 'a0000000-0000-0000-0000-000000000002'::uuid) $$, 'verified, by her');
select is((select photo_document_id from public.professional_public_profiles where professional_id = 'c0000000-0000-0000-0000-000000000001'),
  current_setting('test.d_photo1')::uuid, 'the verified photo is the public profile''s');
select throws_ok($$ select public.verify_professional_document(current_setting('test.d_photo1')::uuid) $$,
  'P0001', 'Ce document n''attend pas de vérification.', 'verified once');
reset role;
select ok((select n.expires_at <= now() from public.notifications n
            where n.dedupe_key = 'document:' || current_setting('test.d_photo1') || ':uploaded'), 'its « à vérifier » notice is closed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- The provider's insurance, verified with a corrected date (P4-2).
select public.verify_professional_document(current_setting('test.d_ins2')::uuid, current_setting('test.today')::date + 300);
select results_eq($$ select status, expires_on from public.professional_documents where id = current_setting('test.d_ins2')::uuid $$,
  $$ values ('verified'::text, current_setting('test.today')::date + 300) $$, 'verified with the reviewer''s date');

-- Reject: a reason, the file soft-deleted (P4-404).
select set_config('test.d_cv', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'cv',
  'e0000000-0000-0000-0000-000000000007')::text, true);
select is(private.test_error_hint($$ select public.reject_professional_document(current_setting('test.d_cv')::uuid, '  ') $$), 'reason',
  'a refusal needs a reason (HINT reason)');
select lives_ok($$ select public.reject_professional_document(current_setting('test.d_cv')::uuid, ' Le document est illisible. ') $$,
  'a verified document can be refused');
reset role;
select results_eq($$ select d.status, d.rejection_reason, f.status from public.professional_documents d
                       join public.stored_files f on f.id = d.stored_file_id where d.id = current_setting('test.d_cv')::uuid $$,
  $$ values ('rejected'::text, 'Le document est illisible.'::text, 'deleted'::text) $$,
  'rejected with its reason; the file is soft-deleted at once');
set local role authenticated;
select throws_ok($$ select public.reject_professional_document(current_setting('test.d_cv')::uuid, 'Encore') $$,
  'P0001', 'Ce document ne peut plus être refusé.', 'refused once');
select throws_ok($$ select public.set_professional_document_expiry(current_setting('test.d_photo1')::uuid, current_setting('test.today')::date) $$,
  'P0001', 'Ce type de document n''a pas d''échéance.', 'no date for a photo');

-- Redate: past → expired, future → verified again.
select public.set_professional_document_expiry(current_setting('test.d_ins1')::uuid, current_setting('test.today')::date - 1);
select is((select status from public.professional_documents where id = current_setting('test.d_ins1')::uuid), 'expired',
  'a past last day makes it expired');
select public.set_professional_document_expiry(current_setting('test.d_ins1')::uuid, current_setting('test.today')::date + 100);
select is((select status from public.professional_documents where id = current_setting('test.d_ins1')::uuid), 'verified',
  'a corrected future day makes it verified again');

-- Delete: documents.delete (the admin), not the adjointe.
select set_config('test.d_del', public.attach_professional_document('c0000000-0000-0000-0000-000000000001', 'other',
  'e0000000-0000-0000-0000-000000000008')::text, true);
select throws_ok($$ select public.delete_professional_document(current_setting('test.d_del')::uuid) $$, '42501', null,
  'the adjointe cannot delete');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.delete_professional_document(current_setting('test.d_del')::uuid) $$, 'the admin deletes');
reset role;
select results_eq($$ select (select count(*)::int from public.professional_documents where id = current_setting('test.d_del')::uuid),
                            (select status from public.stored_files where id = 'e0000000-0000-0000-0000-000000000008') $$,
  $$ values (0, 'deleted'::text) $$, 'the row is gone, the file soft-deleted');
select ok(exists (select 1 from public.audit_log a where a.table_name = 'professional_documents' and a.action = 'delete'
                   and a.record_id = 'c0000000-0000-0000-0000-000000000001:' || current_setting('test.d_del')),
  'the audit keeps the deleted row under the professional''s id (P4-36)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.verify_professional_document(current_setting('test.d_own')::uuid) $$,
  'P0001', 'Document introuvable.', 'another clinic''s document');

-- =============================================================================
-- Reads
-- =============================================================================
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'documents'), 3,
  'the conseillère reads P1''s documents (insurance, photo, refused CV)');
select results_eq($$ select x ->> 'type_key', x ->> 'status', x -> 'file' ->> 'name', x ->> 'reviewed_by_name'
                       from jsonb_array_elements(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'documents') x
                      order by x ->> 'type_key' $$,
  $$ values ('cv'::text, 'rejected'::text, null::text, 'Adjointe A'::text),
            ('insurance', 'verified', 'fichier.pdf', 'Adjointe A'),
            ('photo', 'verified', 'fichier.png', 'Adjointe A') $$,
  'type, status, file (none once refused), reviewer');
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001') -> 'photo',
  jsonb_build_object('document_id', current_setting('test.d_photo1'), 'file_id', 'e0000000-0000-0000-0000-000000000002'),
  'the photo''s ids for storage-sign');
select is((public.get_professional_documents('c0000000-0000-0000-0000-000000000001') ->> 'today')::date, current_setting('test.today')::date,
  'the clinic''s today');
select is((select count(*)::int from public.professional_documents), 5, 'RLS: the conseillère sees the clinic''s documents');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.get_professional_documents() ->> 'professional_id', 'c0000000-0000-0000-0000-000000000002',
  'the provider''s own documents without an id');
select is((select x ->> 'reviewed_by_name' from jsonb_array_elements(public.get_professional_documents() -> 'documents') x), null,
  'the provider does not get the reviewer''s name');
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001'), null, 'never another professional''s');
select is((select count(*)::int from public.professional_documents), 1, 'RLS: the provider sees their own document only');
select is((select count(*)::int from public.stored_files where id = 'e0000000-0000-0000-0000-000000000004'), 1,
  'the provider reads their attached file (storage-sign''s check)');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001'), null, 'another clinic: null');
select is((select count(*)::int from public.professional_documents), 0, 'RLS: another clinic sees nothing');

-- =============================================================================
-- Readiness, list and directory
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
-- P1: photo and insurance verified, no consent.
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') -> 'items' -> 3,
  '{"key": "documents", "done": false, "missing": ["image_consent"]}'::jsonb, 'P1 misses the image consent');
select results_eq($$ select r.photo_ok, r.insurance_ok, r.consent_ok, r.documents_ok, r.documents_done, r.documents_required, r.insurance_status
                       from public.professionals_readiness r where r.professional_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values (true, true, false, false, 2, 3, 'valid'::text) $$, 'readiness columns');
reset role;
-- An e-consent in force satisfies the image consent.
insert into public.professional_consents (org_id, professional_id, consent_version_id, signer_name, signed_at, expires_on)
select current_setting('test.a')::uuid, 'c0000000-0000-0000-0000-000000000001', v.id, 'Paul Un', now() - interval '1 day',
       current_setting('test.today')::date + 300
  from public.consent_versions v where v.org_id = current_setting('test.a')::uuid order by v.version desc limit 1;
set local role authenticated;
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') -> 'items' -> 3,
  '{"key": "documents", "done": true, "missing": []}'::jsonb, 'the e-consent satisfies the image consent');
reset role;
update public.professional_consents set withdrawn_at = now(), withdrawal_effective_on = current_setting('test.today')::date
 where professional_id = 'c0000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') -> 'items' -> 3 -> 'missing',
  '["image_consent"]'::jsonb, 'a withdrawal in effect today no longer counts');
reset role;
update public.professional_consents set withdrawn_at = null, withdrawal_effective_on = null
 where professional_id = 'c0000000-0000-0000-0000-000000000001';
-- The insurance: expiring, then expired (missing vs expired).
update public.professional_documents set expires_on = current_setting('test.today')::date + 3 where id = current_setting('test.d_ins1')::uuid;
set local role authenticated;
select results_eq($$ select d.insurance_status, l.insurance_status, l.insurance_expires_on, l.documents_done, l.documents_required
                       from public.professionals_directory d join public.professionals_list l on l.id = d.id
                      where d.id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('expiring'::text, 'expiring'::text, current_setting('test.today')::date + 3, 3, 3) $$,
  'within the reminder days: expiring (directory and list), still valid for readiness');
reset role;
update public.professional_documents set expires_on = current_setting('test.today')::date - 1 where id = current_setting('test.d_ins1')::uuid;
set local role authenticated;
select results_eq($$ select d.insurance_status, r.insurance_ok, r.documents_missing, r.ready
                       from public.professionals_directory d join public.professionals_readiness r on r.professional_id = d.id
                      where d.id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('expired'::text, false, array['insurance_expired']::text[], false) $$,
  'past its last day (even before the job marks it): expired, and readiness says so');
select is((select insurance_status from public.professionals_directory where id = 'c0000000-0000-0000-0000-000000000004'), 'missing',
  'no insurance at all: missing');
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000004') -> 'items' -> 3 -> 'missing',
  '["photo", "insurance", "image_consent"]'::jsonb, 'P4 misses everything, in order');
reset role;
update public.professional_documents set expires_on = current_setting('test.today')::date + 100 where id = current_setting('test.d_ins1')::uuid;
-- Another required type of the clinic (CV) shows as other_documents.
update public.document_types set required = true where org_id = current_setting('test.a')::uuid and key = 'cv';
set local role authenticated;
select is(public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') -> 'items' -> 3,
  '{"key": "documents", "done": false, "missing": ["other_documents"]}'::jsonb, 'a refused CV does not count; other required types are named together');
select is((public.get_professional_readiness('c0000000-0000-0000-0000-000000000001') ->> 'total')::int, 4, 'four readiness items');
reset role;
update public.document_types set required = false where org_id = current_setting('test.a')::uuid and key = 'cv';

-- =============================================================================
-- The approval hook (P4-400) and the submission notice
-- =============================================================================
insert into public.professional_submissions (id, org_id, professional_id, kind, status, requested_sections, submitted_values, submitted_at)
values ('d0000000-0000-0000-0000-000000000001', current_setting('test.a')::uuid, 'c0000000-0000-0000-0000-000000000002', 'update', 'submitted',
        array['photo', 'insurance'],
        jsonb_build_object('photo', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000010'),
                           'insurance', jsonb_build_object('file_id', 'e0000000-0000-0000-0000-000000000011',
                                                           'expires_on', (current_setting('test.today')::date + 400)::text)),
        now());
select private.notify(current_setting('test.a')::uuid, 'professionals', 'professionals.submission_received', 'normal', 'Mise à jour à réviser',
  'Pia Deux a envoyé une mise à jour de son profil.', '/professionnels/c0000000-0000-0000-0000-000000000002/documents', 'professional',
  'c0000000-0000-0000-0000-000000000002', 'professionals.review', null, 'submission:test', null);
update public.professional_submissions
   set status = 'approved', applied_fields = array['photo', 'insurance'], reviewed_at = now(),
       reviewed_by = 'a0000000-0000-0000-0000-000000000002'
 where id = 'd0000000-0000-0000-0000-000000000001';
select results_eq($$ select t.key, d.status, d.expires_on, d.uploaded_by, d.reviewed_by, d.submission_id
                       from public.professional_documents d join public.document_types t on t.id = d.document_type_id
                      where d.stored_file_id in ('e0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000011')
                      order by t.key $$,
  $$ values ('insurance'::text, 'verified'::text, current_setting('test.today')::date + 400, 'a0000000-0000-0000-0000-000000000003'::uuid,
             'a0000000-0000-0000-0000-000000000002'::uuid, 'd0000000-0000-0000-0000-000000000001'::uuid),
            ('photo', 'verified', null, 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002',
             'd0000000-0000-0000-0000-000000000001') $$,
  'an approved submission''s photo and insurance become verified documents, reviewed by the approver');
select is((select d.stored_file_id from public.professional_public_profiles x join public.professional_documents d on d.id = x.photo_document_id
            where x.professional_id = 'c0000000-0000-0000-0000-000000000002'), 'e0000000-0000-0000-0000-000000000010'::uuid,
  'the approved photo is the public profile''s');
select ok((select n.expires_at <= now() from public.notifications n where n.dedupe_key = 'submission:test'),
  'leaving « submitted » closes the « à réviser » notice');

-- =============================================================================
-- Insurance notices settle when the documents change
-- =============================================================================
-- An « expiring » notice for P2's latest insurance (+400) stays true? No: +400 is not due, so a
-- notice for an older document is closed by the next change.
select private.notify(current_setting('test.a')::uuid, 'professionals', 'professionals.insurance_expiring', 'important', 'Assurance bientôt échue',
  'L''assurance de Pia Deux prend fin bientôt.', '/professionnels/c0000000-0000-0000-0000-000000000002/documents', 'professional',
  'c0000000-0000-0000-0000-000000000002', 'professionals.manage', null, 'insurance:' || current_setting('test.d_ins2') || ':old:expiring',
  now() + interval '60 days');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.set_professional_document_expiry(current_setting('test.d_ins2')::uuid, current_setting('test.today')::date + 2);
reset role;
select ok((select n.expires_at <= now() from public.notifications n
            where n.dedupe_key = 'insurance:' || current_setting('test.d_ins2') || ':old:expiring'),
  'a notice that is no longer the insurance''s current one is closed');
select is(private.expire_notifications(current_setting('test.a')::uuid, 'professional', 'c0000000-0000-0000-0000-000000000002',
  array['professionals.insurance_expiring']), 0, 'closing again closes nothing');

-- The history lists documents.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok((select count(*) from public.list_professional_history('c0000000-0000-0000-0000-000000000001') h
            where h.table_name = 'professional_documents') >= 4, 'the history shows the documents'' rows');
reset role;

-- Module off: nothing readable.
update public.org_modules set enabled = false where org_id = current_setting('test.a')::uuid and module_key = 'professionals';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.get_professional_documents('c0000000-0000-0000-0000-000000000001'), null, 'module off: no documents');
select is((select count(*)::int from public.professional_documents), 0, 'module off: RLS hides the documents');
reset role;

select * from finish();
rollback;
