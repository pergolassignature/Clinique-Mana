-- Professionnels insurance expiry job (migration *_professionals_insurance_expiry_job.sql, plan
-- Phase 4 Task 4c.4). Covers: the job's catalogue row, schedule and per-clinic switch; privileges
-- of the run RPC; the date matrix on a clinic day T with the default reminder (7 days, weekly
-- after): J-8 nothing, J-7 / J-1 / J expiring, J+1 expired, J+7 and J+14 weekly reminders, a
-- reminder not due yet, a renewed insurance, a newer one waiting for review, an inactive file,
-- a failed email tried again; verified documents past their day marked expired (audited as the
-- job); the staff notices (texts, permission, dedupe, 60 days) and « documents requis
-- manquants » (a count, closed at zero); a second run the same day sends and notifies nothing
-- twice; an email never queued (deferred by the function) is due the next day; another clinic is
-- never read; the module switched off.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- =============================================================================
-- Fixtures (as postgres): org A (admin 01, provider 03 linked to P2), org B (admin 05).
-- Thirteen professionals of org A (P11 inactive) and one of org B, each with insurance documents
-- whose last day is relative to T, the clinic's today.
-- =============================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@a.test',    '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider@a.test', '', now(), '{}', '{}', now(), now()),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@b.test',    '', now(), '{}', '{}', now(), now());
insert into public.organizations (id, name) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'Admin A',    'admin@a.test',    'active'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'Provider A', 'provider@a.test', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'Admin B',    'admin@b.test',    'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'admin'),
  ('a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000a', 'provider'),
  ('a0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'admin');
insert into public.org_modules (org_id, module_key, enabled) values
  ('b0000000-0000-0000-0000-00000000000a', 'professionals', true),
  ('b0000000-0000-0000-0000-00000000000b', 'professionals', true);

select set_config('test.a', 'b0000000-0000-0000-0000-00000000000a', true);
select set_config('test.b', 'b0000000-0000-0000-0000-00000000000b', true);
select set_config('test.t', (select (now() at time zone o.timezone)::date::text from public.organizations o
                              where o.id = 'b0000000-0000-0000-0000-00000000000a'), true);

-- Pn = c0…0n. P2 has the provider's account; P11 is inactive; P99 is org B's.
insert into public.professionals (id, org_id, profile_id, first_name, last_name, email, status, deactivation_reason_id, deactivation_note)
select ('c0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       case when n = 99 then current_setting('test.b')::uuid else current_setting('test.a')::uuid end,
       case when n = 2 then 'a0000000-0000-0000-0000-000000000003'::uuid end,
       case when n = 2 then 'Pia' else 'Pro' end, case when n = 2 then 'Deux' else 'N' || n end,
       case when n = 2 then 'provider@a.test' else 'p' || n || '@exemple.test' end,
       case when n = 11 then 'inactive' else 'active' end,
       case when n = 11 then (select r.id from public.deactivation_reasons r where r.org_id = current_setting('test.a')::uuid and r.key = 'leave') end,
       null
  from (select unnest(array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99]) as n) x;
insert into public.professional_public_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-0000000000__';
insert into public.professional_matching_profiles (org_id, professional_id)
select p.org_id, p.id from public.professionals p where p.id::text like 'c0000000-0000-0000-0000-0000000000__';

-- Insurance documents: (professional, file/doc number, last day = T + offset, status).
create temporary table fx (pro int, doc int, days int, status text) on commit drop;
insert into fx values
  (1, 1, 8, 'verified'),     -- J-8: nothing yet
  (2, 2, 7, 'verified'),     -- J-7: expiring, emailed
  (3, 3, 1, 'verified'),     -- J-1: expiring, already emailed in this step
  (4, 4, 0, 'verified'),     -- J (last valid day): expiring, emailed
  (5, 5, -1, 'verified'),    -- J+1: expired today, emailed « échue »
  (6, 6, -8, 'verified'),    -- expired a week ago: weekly reminder due
  (7, 7, -15, 'verified'),   -- two weeks: second weekly reminder due
  (8, 8, -15, 'verified'),   -- a reminder 3 days ago: not yet
  (9, 9, -3, 'verified'),    -- renewed:
  (9, 10, 300, 'verified'),  --   the new one is valid
  (10, 11, -2, 'verified'),  -- expired, but a new one waits for review:
  (10, 12, 365, 'pending'),
  (11, 13, -5, 'verified'),  -- inactive file: marked, never reminded
  (12, 14, -1, 'verified'),  -- expired today; this morning's email failed: tried again
  (99, 15, -1, 'verified');  -- org B
insert into public.stored_files
  (id, org_id, bucket, object_path, module_key, purpose, subject_type, subject_id, original_name, mime_type, ext,
   size_bytes, sha256, status, view_permission, uploaded_by, confirmed_at)
select ('e0000000-0000-0000-0000-0000000000' || lpad(fx.doc::text, 2, '0'))::uuid, p.org_id, 'documents',
       p.org_id || '/professionals/' || p.id || '/e0000000-0000-0000-0000-0000000000' || lpad(fx.doc::text, 2, '0') || '.pdf',
       'professionals', 'professional_document', 'professional', p.id, 'assurance.pdf', 'application/pdf', 'pdf', 2048,
       repeat('a', 64), 'ready', 'professionals.view', null, now()
  from fx join public.professionals p on p.id = ('c0000000-0000-0000-0000-0000000000' || lpad(fx.pro::text, 2, '0'))::uuid;
insert into public.professional_documents
  (id, org_id, professional_id, document_type_id, stored_file_id, status, expires_on, reviewed_at)
select ('f0000000-0000-0000-0000-0000000000' || lpad(fx.doc::text, 2, '0'))::uuid, p.org_id, p.id, t.id,
       ('e0000000-0000-0000-0000-0000000000' || lpad(fx.doc::text, 2, '0'))::uuid, fx.status,
       current_setting('test.t')::date + fx.days, case when fx.status = 'verified' then now() end
  from fx
  join public.professionals p on p.id = ('c0000000-0000-0000-0000-0000000000' || lpad(fx.pro::text, 2, '0'))::uuid
  join public.document_types t on t.org_id = p.org_id and t.key = 'insurance';

-- What was emailed before (clinic dates relative to T).
insert into public.email_log (org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, error_code,
                              view_permission, created_at)
select current_setting('test.a')::uuid, 'professionals', e.template, 0, 'x@exemple.test', 'professional',
       ('c0000000-0000-0000-0000-0000000000' || lpad(e.pro::text, 2, '0'))::uuid, e.status, e.code, 'professionals.view',
       now() - make_interval(days => e.ago)
  from (values
    (3, 'professionals.document_expiring', 5, 'sent', null),            -- in the J-7 step already
    (6, 'professionals.document_expired', 7, 'delivered', null),         -- J+1 of P6, 7 days ago
    (7, 'professionals.document_expired', 14, 'sent', null),
    (7, 'professionals.document_expired_reminder', 7, 'sent', null),
    (8, 'professionals.document_expired', 14, 'sent', null),
    (8, 'professionals.document_expired_reminder', 3, 'sent', null),
    (12, 'professionals.document_expired', 0, 'failed', 'provider_failed') -- failed: not counted
  ) as e(pro, template, ago, status, code);

-- =============================================================================
-- The job: catalogue row, schedule, per-clinic switch; privileges
-- =============================================================================
select results_eq($$
  select j.module_key, j.kind, j.function_name, j.local_hour::int, j.is_maintenance, j.is_active, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key = 'professionals.insurance_expiry_notice'
$$, $$ values ('professionals'::text, 'function'::text, 'professionals-insurance-expiry'::text, 6, false, true,
               '15 * * * *'::text, 'select private.invoke_job_function(''professionals.insurance_expiry_notice'')'::text) $$,
  'a business function job at 06:00 clinic time, dispatched hourly (P4-45)');
select results_eq($$ select enabled from public.org_scheduled_jobs
                      where job_key = 'professionals.insurance_expiry_notice' and org_id = current_setting('test.a')::uuid $$,
  $$ values (false) $$, 'off until « Tâches planifiées » turns it on');
select function_privs_are('public', 'run_professionals_document_notices_for_service', array['uuid', 'date'], 'service_role', array['EXECUTE'],
  'the job runs it');
select function_privs_are('public', 'run_professionals_document_notices_for_service', array['uuid', 'date'], 'authenticated', array[]::text[],
  'never a user');
select function_privs_are('public', 'run_professionals_document_notices_for_service', array['uuid', 'date'], 'anon', array[]::text[],
  'never anon');
select ok((select p.prosecdef from pg_proc p where p.oid = 'public.run_professionals_document_notices_for_service(uuid, date)'::regprocedure),
  'security definer');

-- =============================================================================
-- The run on T
-- =============================================================================
-- An insurance notice still open for the inactive file (raised while it was active).
select private.notify(current_setting('test.a')::uuid, 'professionals', 'professionals.insurance_expired', 'important',
  'Assurance expirée', 'Avant la fin de collaboration.', '/professionnels/c0000000-0000-0000-0000-000000000011/documents',
  'professional', 'c0000000-0000-0000-0000-000000000011', 'professionals.manage', null,
  'insurance:f0000000-0000-0000-0000-000000000013:expired', now() + interval '60 days');
select set_config('test.audit_start', (select coalesce(max(id), 0)::text from public.audit_log), true);
set local role service_role;
select set_config('test.run1', public.run_professionals_document_notices_for_service(current_setting('test.a')::uuid,
  current_setting('test.t')::date)::text, true);
reset role;

select results_eq($$ select (r ->> 'today')::date, r ->> 'clinic_name', (r ->> 'marked')::int, (r ->> 'expiring')::int,
                            (r ->> 'expired')::int, (r ->> 'missing')::int
                       from (select current_setting('test.run1')::jsonb as r) x $$,
  $$ values (current_setting('test.t')::date, 'Org A'::text, 8, 3, 6, 11) $$,
  'eight verified documents past their day marked (inactive file included); 3 expiring, 6 expired notices; 11 active files incomplete');
select results_eq($$ select x ->> 'professional_id', x ->> 'template_key', (x ->> 'expires_on')::date - current_setting('test.t')::date
                       from jsonb_array_elements(current_setting('test.run1')::jsonb -> 'emails') x $$,
  $$ values ('c0000000-0000-0000-0000-000000000002'::text, 'professionals.document_expiring'::text, 7),
            ('c0000000-0000-0000-0000-000000000004', 'professionals.document_expiring', 0),
            ('c0000000-0000-0000-0000-000000000005', 'professionals.document_expired', -1),
            ('c0000000-0000-0000-0000-000000000006', 'professionals.document_expired_reminder', -8),
            ('c0000000-0000-0000-0000-000000000007', 'professionals.document_expired_reminder', -15),
            ('c0000000-0000-0000-0000-000000000012', 'professionals.document_expired', -1) $$,
  'the date matrix: J-7 and J emailed, J-1 already done; J+1 « échue »; J+7, J+14 weekly; nothing for J-8, a reminder 3 days ago, a renewal, a pending renewal, an inactive file; a failed email tried again');
select is((select x from jsonb_array_elements(current_setting('test.run1')::jsonb -> 'emails') x
            where x ->> 'professional_id' = 'c0000000-0000-0000-0000-000000000002'),
  jsonb_build_object('document_id', 'f0000000-0000-0000-0000-000000000002', 'professional_id', 'c0000000-0000-0000-0000-000000000002',
                     'profile_id', 'a0000000-0000-0000-0000-000000000003', 'email', 'provider@a.test', 'first_name', 'Pia',
                     'template_key', 'professionals.document_expiring', 'expires_on', (current_setting('test.t')::date + 7)::text),
  'an email row: the professional''s own address and account, the date-only last day');

select results_eq($$ select status, count(*)::int from public.professional_documents
                      where professional_id::text like 'c0000000-0000-0000-0000-0000000000__' and org_id = current_setting('test.a')::uuid
                      group by status order by status $$,
  $$ values ('expired'::text, 8), ('pending', 1), ('verified', 5) $$, 'past their day: expired; the others untouched');
select ok((select bool_and(a.source = 'job:professionals.insurance_expiry_notice' and a.actor_id is null)
             from public.audit_log a
            where a.id > current_setting('test.audit_start')::bigint and a.table_name = 'professional_documents'),
  'the expiries are audited as the job, without an actor');
select is((select status from public.professional_documents where id = 'f0000000-0000-0000-0000-000000000015'), 'verified',
  'another clinic is not touched');

-- Notices.
select results_eq($$ select n.title, n.body, n.importance, n.recipient_permission, n.link_path, n.subject_type, n.dedupe_key,
                            n.expires_at > now() + interval '59 days'
                       from public.notifications n
                      where n.kind = 'professionals.insurance_expiring' and n.subject_id = 'c0000000-0000-0000-0000-000000000002' $$,
  $$ values ('Assurance bientôt échue'::text,
             'L''assurance de Pia Deux prend fin le ' || private.format_date_fr(current_setting('test.t')::date + 7) || '.',
             'important'::text, 'professionals.manage'::text, '/professionnels/c0000000-0000-0000-0000-000000000002/documents'::text,
             'professional'::text,
             'insurance:f0000000-0000-0000-0000-000000000002:' || to_char(current_setting('test.t')::date + 7, 'YYYY-MM-DD') || ':expiring',
             true) $$,
  'the « expiring » notice: name and date only, for professionals.manage, 60 days, keyed by document and date');
select results_eq($$ select n.title, n.body, n.dedupe_key from public.notifications n
                      where n.kind = 'professionals.insurance_expired' and n.subject_id = 'c0000000-0000-0000-0000-000000000005' $$,
  $$ values ('Assurance expirée'::text,
             'L''assurance de Pro N5 a pris fin le ' || private.format_date_fr(current_setting('test.t')::date - 1) || '. Son dossier reste actif.',
             'insurance:f0000000-0000-0000-0000-000000000005:expired'::text) $$,
  'the « expired » notice: the professional stays active (P4-1)');
select set_eq($$ select subject_id from public.notifications where org_id = current_setting('test.a')::uuid
                    and kind in ('professionals.insurance_expiring', 'professionals.insurance_expired')
                    and (expires_at is null or expires_at > now()) $$,
  array['c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004',
        'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000007',
        'c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000012']::uuid[],
  'notices for the due active files only (not J-8, the renewal, the inactive file)');
select ok((select n.expires_at <= now() from public.notifications n
            where n.kind = 'professionals.insurance_expired' and n.subject_id = 'c0000000-0000-0000-0000-000000000011'),
  'an insurance notice of a file no longer active is closed (P4-408)');
select results_eq($$ select n.title, n.body, n.importance, n.recipient_permission, n.link_path, n.subject_type, n.subject_id,
                            n.dedupe_key, n.expires_at > now() + interval '6 days'
                       from public.notifications n where n.kind = 'professionals.documents_missing' $$,
  $$ values ('Documents requis manquants'::text, '11 professionnels actifs n''ont pas tous leurs documents requis.'::text,
             'normal'::text, 'professionals.manage'::text, '/professionnels'::text, 'organization'::text,
             current_setting('test.a')::uuid, 'documents_missing:' || to_char(current_setting('test.t')::date, 'IYYY-"W"IW'), true) $$,
  'one count for the clinic and the week, no name');

-- A second run the same day (« Exécuter maintenant »): the emails it sent are in the log.
insert into public.email_log (org_id, module_key, template_key, template_version, to_email, subject_type, subject_id, status, view_permission)
select current_setting('test.a')::uuid, 'professionals', x ->> 'template_key', 0, x ->> 'email', 'professional',
       (x ->> 'professional_id')::uuid, 'sent', 'professionals.view'
  from jsonb_array_elements(current_setting('test.run1')::jsonb -> 'emails') x;
select set_config('test.notices', (select count(*)::text from public.notifications where org_id = current_setting('test.a')::uuid), true);
set local role service_role;
select set_config('test.run2', public.run_professionals_document_notices_for_service(current_setting('test.a')::uuid,
  current_setting('test.t')::date)::text, true);
reset role;
select results_eq($$ select (r ->> 'marked')::int, jsonb_array_length(r -> 'emails') from (select current_setting('test.run2')::jsonb as r) x $$,
  $$ values (0, 0) $$, 'the same day again: nothing to mark, nothing to send');
select is((select count(*)::text from public.notifications where org_id = current_setting('test.a')::uuid), current_setting('test.notices'),
  'and no notice twice (dedupe)');

-- A corrected date raises a new notice and closes the old one at the next run.
update public.professional_documents set expires_on = current_setting('test.t')::date + 5 where id = 'f0000000-0000-0000-0000-000000000002';
set local role service_role;
select public.run_professionals_document_notices_for_service(current_setting('test.a')::uuid, current_setting('test.t')::date);
reset role;
select results_eq($$ select n.dedupe_key, n.expires_at > now() from public.notifications n
                      where n.kind = 'professionals.insurance_expiring' and n.subject_id = 'c0000000-0000-0000-0000-000000000002'
                      order by n.created_at, n.dedupe_key $$,
  $$ values ('insurance:f0000000-0000-0000-0000-000000000002:' || to_char(current_setting('test.t')::date + 5, 'YYYY-MM-DD') || ':expiring', true),
            ('insurance:f0000000-0000-0000-0000-000000000002:' || to_char(current_setting('test.t')::date + 7, 'YYYY-MM-DD') || ':expiring', false) $$,
  'the corrected date has its own notice; the old one is closed');

-- Nothing missing any more: the count notice closes.
update public.document_types set required = false where org_id = current_setting('test.a')::uuid;
set local role service_role;
select is((public.run_professionals_document_notices_for_service(current_setting('test.a')::uuid, current_setting('test.t')::date) ->> 'missing')::int,
  0, 'no required type: nothing missing');
reset role;
select ok((select n.expires_at <= now() from public.notifications n where n.kind = 'professionals.documents_missing'),
  'the « documents requis manquants » notice is closed');

-- An email the function deferred (its soft deadline, P4-470) was never queued: the next clinic
-- day it is still due. Today's sends are taken out of the log as if they had been deferred.
delete from public.email_log where org_id = current_setting('test.a')::uuid and created_at = now() and status = 'sent';
set local role service_role;
select set_config('test.run_next', public.run_professionals_document_notices_for_service(current_setting('test.a')::uuid,
  current_setting('test.t')::date + 1)::text, true);
reset role;
select set_has($$ select x ->> 'professional_id' from jsonb_array_elements(current_setting('test.run_next')::jsonb -> 'emails') x $$,
  $$ select x ->> 'professional_id' from jsonb_array_elements(current_setting('test.run1')::jsonb -> 'emails') x $$,
  'an email never queued (deferred) is due again the next day');

-- Another clinic: its own documents only; the module off: refused.
set local role service_role;
select is((select jsonb_agg(x ->> 'professional_id') from jsonb_array_elements(
             public.run_professionals_document_notices_for_service(current_setting('test.b')::uuid, current_setting('test.t')::date) -> 'emails') x),
  '["c0000000-0000-0000-0000-000000000099"]'::jsonb, 'org B''s run reads org B only');
reset role;
update public.org_modules set enabled = false where org_id = current_setting('test.a')::uuid and module_key = 'professionals';
set local role service_role;
select throws_ok($$ select public.run_professionals_document_notices_for_service(current_setting('test.a')::uuid) $$,
  'P0001', 'Le module Professionnels est désactivé pour cette clinique.', 'module off: refused');
select throws_ok($$ select public.run_professionals_document_notices_for_service(null) $$, '22023', null, 'an org is required');
reset role;

select * from finish();
rollback;
