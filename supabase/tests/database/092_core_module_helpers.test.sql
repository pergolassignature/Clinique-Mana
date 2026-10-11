-- Core: helpers a module calls instead of touching core tables (migration *_core_module_helpers.sql,
-- gap audit T1 and C5). Covers: no role executes them; private.expire_notifications (moved home)
-- and expire_notifications_for_subjects close only the open notices of the given kinds and
-- subjects of the clinic; last_subject_emails reads, per subject and template, the newest email that
-- did not fail for sure; set_stored_files_owner writes only rows that differ, never a purged or
-- another clinic's file, and refuses an owner without a permission or a permission of another
-- module; extend_stored_files_retention only lengthens the hold of the subject's ready files;
-- format_date_fr (moved home, long: a document's deadline) and format_date_short_fr (date-fns fr
-- 'd MMM yyyy') write dates in French; add_tax_rate's refusal says its date short (C-3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- =============================================================================
-- Privileges: granted to no role (module definer RPCs call them)
-- =============================================================================
select function_privs_are('private', f.name, f.args, r.role, array[]::text[], f.name || ': no EXECUTE for ' || r.role)
  from (values
    ('expire_notifications', array['uuid', 'text', 'uuid', 'text[]', 'text[]']),
    ('expire_notifications_for_subjects', array['uuid', 'text', 'uuid[]', 'text[]']),
    ('last_subject_emails', array['uuid', 'text', 'uuid[]', 'text[]', 'timestamp with time zone']),
    ('set_stored_files_owner', array['uuid', 'uuid[]', 'uuid', 'text']),
    ('extend_stored_files_retention', array['uuid', 'text', 'text', 'uuid', 'uuid[]', 'timestamp with time zone']),
    ('format_date_fr', array['date']),
    ('format_date_short_fr', array['date'])
  ) as f(name, args)
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- =============================================================================
-- Fixtures (as postgres): orgs A and B, a provider in A (the owner of files)
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pro@a.test', '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A', 'admin@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Pro A', 'pro@a.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider');

-- =============================================================================
-- Notifications
-- =============================================================================
-- Subjects d1, d2 in A (kind x open, d1 also kind y and an already closed x), d1 in B.
insert into public.notifications (id, org_id, module_key, kind, title, subject_type, subject_id, recipient_permission, dedupe_key, expires_at)
values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_x', 'X1', 'professional', 'd0000000-0000-0000-0000-000000000001', 'users.view', 'k1', null),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_x', 'X2', 'professional', 'd0000000-0000-0000-0000-000000000002', 'users.view', 'k2', now() + interval '1 day'),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_y', 'Y1', 'professional', 'd0000000-0000-0000-0000-000000000001', 'users.view', 'k3', null),
  ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_x', 'X3', 'professional', 'd0000000-0000-0000-0000-000000000003', 'users.view', 'k4', null),
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'core', 'core.test_x', 'XB', 'professional', 'd0000000-0000-0000-0000-000000000001', 'users.view', 'k5', null),
  ('f0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'core', 'core.test_x', 'X0', 'professional', 'd0000000-0000-0000-0000-000000000001', 'users.view', 'k6', now() - interval '1 day');

select is(private.expire_notifications_for_subjects('b0000000-0000-0000-0000-00000000000a', 'professional',
            array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[], array['core.test_x']),
  2, 'expire_notifications_for_subjects closes the open notices of those subjects and kinds');
select results_eq($$ select n.title from public.notifications n
                     where n.id::text like 'f0000000-%' and (n.expires_at is null or n.expires_at > now()) order by n.title $$,
  array['X3', 'XB', 'Y1'], '… not another kind, another subject or another clinic''s');
select is((select n.expires_at from public.notifications n where n.id = 'f0000000-0000-0000-0000-000000000006'),
  now() - interval '1 day', '… and a notice already closed keeps its date');
select is(private.expire_notifications_for_subjects('b0000000-0000-0000-0000-00000000000a', 'professional', array[]::uuid[], array['core.test_x']),
  0, 'no subject: nothing closed');
select is(private.expire_notifications('b0000000-0000-0000-0000-00000000000a', 'professional', 'd0000000-0000-0000-0000-000000000003',
            array['core.test_x'], array['k4']), 0, 'expire_notifications keeps the notice whose key is still true');
select is(private.expire_notifications('b0000000-0000-0000-0000-00000000000a', 'professional', 'd0000000-0000-0000-0000-000000000003',
            array['core.test_x']), 1, '… and closes it otherwise');

-- =============================================================================
-- Emails
-- =============================================================================
insert into public.email_log
  (id, org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code,
   view_permission, created_at)
values
  -- d1 / invite: an old sent one, a newer bounced one (counts: it left), the newest failed for sure (does not count).
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0, 'p@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000001', 'sent', null, 'professionals.view', now() - interval '10 days'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0, 'p@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000001', 'bounced', null, 'professionals.view', now() - interval '5 days'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0, 'p@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000001', 'failed', 'render_failed', 'professionals.view', now() - interval '1 day'),
  -- d1 / invite_reminder: failed with an unknown outcome (counts).
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite_reminder', 0, 'p@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000001', 'failed', 'provider_unavailable', 'professionals.view', now() - interval '2 days'),
  -- d2 / invite: too old for the window.
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.invite', 0, 'p@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000002', 'sent', null, 'professionals.view', now() - interval '40 days'),
  -- d1 / profile_update: a template not asked for; d1 / invite in org B.
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professionals.profile_update', 0, 'p@a.test',
   'professional', 'd0000000-0000-0000-0000-000000000001', 'sent', null, 'professionals.view', now()),
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000b', 'professionals', 'professionals.invite', 0, 'p@b.test',
   'professional', 'd0000000-0000-0000-0000-000000000001', 'sent', null, 'professionals.view', now());

select results_eq($$ select e.subject_id, e.template_key, e.created_at
                       from private.last_subject_emails('b0000000-0000-0000-0000-00000000000a', 'professional',
                              array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[],
                              array['professionals.invite', 'professionals.invite_reminder'], now() - interval '30 days') e
                      order by e.subject_id, e.template_key $$,
  $$ values ('d0000000-0000-0000-0000-000000000001'::uuid, 'professionals.invite'::text, now() - interval '5 days'),
            ('d0000000-0000-0000-0000-000000000001'::uuid, 'professionals.invite_reminder'::text, now() - interval '2 days') $$,
  'last_subject_emails: per subject and template, the newest email that did not fail for sure, in the window');
select is_empty($$ select 1 from private.last_subject_emails('b0000000-0000-0000-0000-00000000000a', 'staff_invitation',
                     array['d0000000-0000-0000-0000-000000000001']::uuid[], array['professionals.invite'], now() - interval '30 days') $$,
  '… another subject type reads nothing');

-- =============================================================================
-- Stored files
-- =============================================================================
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at, retain_until)
select f.id, f.org, case when f.module = 'core' then 'signed-documents' else 'documents' end,
       f.org || '/' || f.module || '/' || f.subject || '/' || f.id || '.pdf',
       f.module, f.purpose, f.subject_type, f.subject, 'doc.pdf', 'application/pdf', 'pdf', 2048, repeat('a', 64), f.status,
       'professionals.view', 'a0000000-0000-0000-0000-000000000001', now(), f.retain
  from (values
    -- 1, 2: module files of A; 3: core's signed copy; 4: purged; 5: org B's.
    ('e1000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001'::uuid, 'ready', null::timestamptz),
    ('e1000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'ready', null),
    ('e1000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'core', 'signing_signed', 'signature_request', 'c0000000-0000-0000-0000-000000000009', 'ready', null),
    ('e1000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'purged', null),
    ('e1000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'professionals', 'professional_document', 'professional', 'c0000000-0000-0000-0000-000000000001', 'ready', null),
    -- 6–9: staged answers of submission s1 (6: ends in 10 days, 7: in 200 days, 8: kept forever, 9: pending); 10: another submission's.
    ('e1000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_submission_file', 'professional_submission', 'c1000000-0000-0000-0000-000000000001', 'ready', now() + interval '10 days'),
    ('e1000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_submission_file', 'professional_submission', 'c1000000-0000-0000-0000-000000000001', 'ready', now() + interval '200 days'),
    ('e1000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_submission_file', 'professional_submission', 'c1000000-0000-0000-0000-000000000001', 'ready', null),
    ('e1000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_submission_file', 'professional_submission', 'c1000000-0000-0000-0000-000000000001', 'pending', now() + interval '10 days'),
    ('e1000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-00000000000a', 'professionals', 'professional_submission_file', 'professional_submission', 'c1000000-0000-0000-0000-000000000002', 'ready', now() + interval '10 days')
  ) as f(id, org, module, purpose, subject_type, subject, status, retain);

select is(private.set_stored_files_owner('b0000000-0000-0000-0000-00000000000a',
            array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004',
                  'e1000000-0000-0000-0000-000000000005']::uuid[],
            'a0000000-0000-0000-0000-000000000003', 'professionals.self'),
  2, 'set_stored_files_owner owns the clinic''s live files (a module file and core''s signed copy)');
select results_eq($$ select f.id::text || ' ' || coalesce(f.owner_profile_id::text, '-') || ' ' || coalesce(f.owner_permission, '-')
                       from public.stored_files f where f.id::text like 'e1000000-0000-0000-0000-00000000000_' order by f.id $$,
  array['e1000000-0000-0000-0000-000000000001 a0000000-0000-0000-0000-000000000003 professionals.self',
        'e1000000-0000-0000-0000-000000000002 - -',
        'e1000000-0000-0000-0000-000000000003 a0000000-0000-0000-0000-000000000003 professionals.self',
        'e1000000-0000-0000-0000-000000000004 - -',
        'e1000000-0000-0000-0000-000000000005 - -',
        'e1000000-0000-0000-0000-000000000006 - -',
        'e1000000-0000-0000-0000-000000000007 - -',
        'e1000000-0000-0000-0000-000000000008 - -',
        'e1000000-0000-0000-0000-000000000009 - -'],
  '… never a file not named, a purged file or another clinic''s');
select is(private.set_stored_files_owner('b0000000-0000-0000-0000-00000000000a',
            array['e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003']::uuid[],
            'a0000000-0000-0000-0000-000000000003', 'professionals.self'),
  0, '… and writes nothing when the owner is already right');
select is(private.set_stored_files_owner('b0000000-0000-0000-0000-00000000000a',
            array['e1000000-0000-0000-0000-000000000003']::uuid[], null, null),
  1, '… an owner can be removed');
select throws_ok($$ select private.set_stored_files_owner('b0000000-0000-0000-0000-00000000000a',
                     array['e1000000-0000-0000-0000-000000000002']::uuid[], 'a0000000-0000-0000-0000-000000000003', null) $$,
  '22023', null, 'an owner without an owner permission is refused');
select throws_ok($$ select private.set_stored_files_owner('b0000000-0000-0000-0000-00000000000a',
                     array['e1000000-0000-0000-0000-000000000002']::uuid[], 'a0000000-0000-0000-0000-000000000003', 'users.view') $$,
  '22023', null, 'a module file cannot name another module''s permission');

select is(private.extend_stored_files_retention('b0000000-0000-0000-0000-00000000000a', 'professional_submission_file',
            'professional_submission', 'c1000000-0000-0000-0000-000000000001',
            array['e1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000008',
                  'e1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000010', null]::uuid[],
            now() + interval '90 days'),
  1, 'extend_stored_files_retention lengthens the hold of the subject''s ready files');
select results_eq($$ select f.id::text || ' ' || coalesce((f.retain_until - now())::text, 'forever')
                       from public.stored_files f where f.id::text like 'e1000000-0000-0000-0000-0000000000%'
                        and f.purpose = 'professional_submission_file' order by f.id $$,
  array['e1000000-0000-0000-0000-000000000006 90 days', 'e1000000-0000-0000-0000-000000000007 200 days',
        'e1000000-0000-0000-0000-000000000008 forever', 'e1000000-0000-0000-0000-000000000009 10 days',
        'e1000000-0000-0000-0000-000000000010 10 days'],
  '… never shortens it, never limits a file kept forever, a pending file or another subject''s');

-- =============================================================================
-- Dates in French (C5)
-- =============================================================================
select is(private.format_date_fr('2027-03-31'), '31 mars 2027', 'format_date_fr: « 31 mars 2027 »');
select is(private.format_date_fr('2026-08-01'), '1 août 2026', '… as the app''s formatDateOnly writes it');
select is(private.format_date_short_fr('2026-11-01'), '1 nov. 2026', 'format_date_short_fr: « 1 nov. 2026 »');
select is(private.format_date_short_fr('2026-07-04'), '4 juil. 2026', '… « 4 juil. 2026 »');
select is((select string_agg(private.format_date_short_fr(make_date(2027, m, 31 - (m = 2)::int * 3 - (m in (4, 6, 9, 11))::int)), ' | ' order by m)
             from generate_series(1, 12) m),
  '31 janv. 2027 | 28 févr. 2027 | 31 mars 2027 | 30 avr. 2027 | 31 mai 2027 | 30 juin 2027 | 31 juil. 2027 | 31 août 2027 | 30 sept. 2027 | 31 oct. 2027 | 30 nov. 2027 | 31 déc. 2027',
  '… the twelve abbreviations of date-fns fr (formatDateOnlyShort)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select isnt(public.add_tax_rate('qst', 0.1, '2031-07-01'), null::uuid, 'the admin adds a future QST rate');
select throws_ok($$ select public.add_tax_rate('qst', 0.11, '2031-07-01') $$,
  'P0001', 'Le nouveau taux doit commencer après le 1 juil. 2031.', 'add_tax_rate''s refusal says the date in short French');
reset role;

select * from finish();
rollback;
