-- Signing capture (migration *_core_signing_capture.sql): the Documenso VM is not backed up, so a
-- signed PDF must reach our storage within about an hour, and a person hears of one that does not.
-- Covers: core.signing_reconcile is hourly (cron and description);
-- list_signature_requests_to_reconcile reads every sent or viewed request at each run (no « over
-- a day » wait), puts a request Documenso completed without its PDF first, then the least recently
-- attempted (a fair rotation), and keeps the drafts' clocks; signature_request_syncs (closed to
-- clients, written by record_signature_sync: attempt, success, failure streak, reports at most
-- once a day per request and code); core.signing_unsaved_alert is a catalogued, hourly SQL
-- maintenance job whose body no role may call; it posts one important core notice per request and
-- envelope (to settings.integrations_manage, in the request's org, linked to « Signature
-- électronique ») when Documenso completed it over 6 hours ago and the signed PDF is still not
-- stored, or when it is a draft left `orphan_completed`; never twice; keeps an orphan's notice
-- across claims (which clear its last_error); expires the notice once the request no longer meets
-- that condition (signed, the orphan abandoned or re-sent on another envelope); deletes the sync
-- state of closed requests. record_signature_sync also records an attempt that read nothing. The full detail (the blind cases are 046's) is checked here too. Built on
-- the envelope API (*_core_signing_envelope.sql, applied first): the list and the alert read
-- `envelope_id`, never the deprecated `documenso_document_id`.
-- The whole file is one transaction, so now() is constant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- =============================================================================
-- Jobs: catalogue, schedules, privileges
-- =============================================================================
select results_eq($$
  select j.key, j.kind, j.function_name, j.sql_function, j.is_maintenance, c.schedule, c.command
    from public.scheduled_jobs j join cron.job c on c.jobname = j.cron_job_name
   where j.key in ('core.signing_reconcile', 'core.signing_unsaved_alert')
   order by j.key
$$, $$ values
  ('core.signing_reconcile'::text, 'function'::text, 'signing-sync'::text, null::text, true, '50 * * * *'::text,
   'select private.invoke_job_function(''core.signing_reconcile'')'::text),
  ('core.signing_unsaved_alert', 'sql', null, 'private.job_signing_unsaved_alert', true, '55 * * * *',
   'select private.run_sql_job(''core.signing_unsaved_alert'')')
$$, 'the reconcile runs hourly at :50; the alert is an hourly SQL maintenance job at :55');

select results_eq($$
  select key, label, description like '%n''est pas sauvegardé%'
    from public.scheduled_jobs where key in ('core.signing_reconcile', 'core.signing_unsaved_alert') order by key
$$, $$ values ('core.signing_reconcile'::text, 'Suivi des signatures électroniques'::text, true),
              ('core.signing_unsaved_alert', 'Alerte : documents signés non sauvegardés', true) $$,
  'labels, and both descriptions say why: the Documenso VM is not backed up');

select results_eq($$
  select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef
    from pg_proc p where p.oid = 'private.job_signing_unsaved_alert()'::regprocedure
$$, $$ values (false, false, false, false) $$, 'the alert body: no role may call it (run_sql_job does), not definer');

select results_eq($$
  select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute'), p.prosecdef
    from pg_proc p where p.oid = 'public.record_signature_sync(uuid,uuid,text,text[],boolean)'::regprocedure
$$, $$ values (false, false, true, true) $$, 'record_signature_sync: the service role only, definer');

-- =============================================================================
-- signature_request_syncs: closed to every client role (operational, not audited)
-- =============================================================================
select table_privs_are('public', 'signature_request_syncs', 'anon', array[]::text[], 'anon: nothing');
select table_privs_are('public', 'signature_request_syncs', 'authenticated', array[]::text[], 'authenticated: nothing');
select table_privs_are('public', 'signature_request_syncs', 'service_role', array[]::text[],
  'service_role: nothing (record_signature_sync writes it)');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.signature_request_syncs'::regclass),
  'RLS is on');
select ok(not exists (select 1 from pg_trigger t where t.tgrelid = 'public.signature_request_syncs'::regclass
                       and not t.tgisinternal),
  'no trigger: not audited (operational state, 000_invariants list)');

-- =============================================================================
-- Fixtures (as postgres). Org A, org B. Requests of org A:
--   e1 sent 10 minutes ago (not completed)     e2 viewed, sent 2 h ago, completed 30 min ago
--   e3 sent 9 days ago, overdue                a1 sent 3 days ago, completed 7 h ago
--   f1 draft left `orphan_completed`, last claimed 50 min ago (not listed yet: an hour)
--   d1 draft with an envelope, re-sent 30 min ago (not listed: an hour)
-- and org B's b1, sent 3 days ago, completed 7 h ago.
-- =============================================================================
insert into public.organizations (id, name, timezone) values
  ('b0000000-0000-0000-0000-00000000000a', 'Org A', 'America/Toronto'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B', 'America/Toronto');

insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  envelope_id, idempotency_key, view_permission, last_error, created_at, sent_at, expires_at,
  completed_event_at, last_send_at)
select x.id, x.org, 'core', 'core.signing_test', 'signing_test', 'a0000000-0000-0000-0000-000000000001', 'Test', x.status,
       'envelope_' || x.doc, 'key-' || x.id, 'settings.integrations_manage', x.err, x.created, x.sent, x.expires,
       x.completed, x.last_send
  from (values
    ('c0000000-0000-0000-0000-0000000000e1'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, 'sent', '701', null::text,
     now() - interval '10 minutes', now() - interval '10 minutes', now() + interval '7 days', null::timestamptz, null::timestamptz),
    ('c0000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-00000000000a', 'viewed', '702', null,
     now() - interval '2 hours', now() - interval '2 hours', now() + interval '7 days', now() - interval '30 minutes', null),
    ('c0000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-00000000000a', 'sent', '703', null,
     now() - interval '9 days', now() - interval '9 days', now() - interval '2 days', null, null),
    ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000a', 'sent', '704', null,
     now() - interval '3 days', now() - interval '3 days', now() + interval '4 days', now() - interval '7 hours', null),
    ('c0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-00000000000a', 'draft', '705', 'orphan_completed',
     now() - interval '3 hours', null, null, null, now() - interval '50 minutes'),
    ('c0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-00000000000a', 'draft', '706', 'provider_error',
     now() - interval '3 days', null, null, null, now() - interval '30 minutes'),
    ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'sent', '707', null,
     now() - interval '3 days', now() - interval '3 days', now() + interval '4 days', now() - interval '7 hours', null)
  ) as x (id, org, status, doc, err, created, sent, expires, completed, last_send);

-- The reconcile itself is healthy here (an `ok` run per org 10 minutes ago): the cases where it is
-- not are 046's.
insert into public.scheduled_job_runs (job_key, org_id, trigger, started_at, finished_at, status, detail)
select 'core.signing_reconcile', o.id, 'cron', now() - interval '10 minutes', now() - interval '9 minutes', 'ok', 'fixture'
  from public.organizations o
 where o.id in ('b0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
-- Within the deploy guard (046): the blind cases stay silent here, whenever the suite runs.
update public.scheduled_jobs set created_at = now() where key = 'core.signing_unsaved_alert';

select results_eq($$
  select o.enabled from public.org_scheduled_jobs o
   where o.job_key = 'core.signing_unsaved_alert' and o.org_id = 'b0000000-0000-0000-0000-00000000000a'
$$, $$ values (true) $$, 'a new org gets the alert, switched on (maintenance)');

-- =============================================================================
-- The reconcile list (service role)
-- =============================================================================
set local role service_role;
select results_eq($$
  select id, action from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a')
$$, $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid, 'sync'::text),
              ('c0000000-0000-0000-0000-0000000000e2', 'sync'),
              ('c0000000-0000-0000-0000-0000000000e3', 'expire'),
              ('c0000000-0000-0000-0000-0000000000e1', 'sync') $$,
  'every sent or viewed request is read at each run, even sent 10 minutes ago; the ones Documenso completed without their PDF come first (then expire, then by expiry); drafts keep their hour');
select results_eq($$ select id from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a', 1) $$,
  $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid) $$, 'with a full page, a request known to be completed without its PDF comes first');
select ok((select bool_and(l.envelope_id like 'envelope\_%')
             from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a') l)
          and not exists (select 1 from pg_proc p
                           where p.oid in ('public.list_signature_requests_to_reconcile(uuid,int)'::regprocedure,
                                           'private.job_signing_unsaved_alert()'::regprocedure,
                                           'private.signing_unverified_requests(uuid)'::regprocedure)
                             and p.prosrc ~ 'documenso_document_id|superseded_document_ids'),
  'built on the envelope (*_core_signing_envelope): the list returns the envelope id; neither the list, the alert nor its unverified condition (*_core_signing_blind_alert) reads the deprecated columns');

-- =============================================================================
-- record_signature_sync and the rotation (service role)
-- =============================================================================
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1'),
  '{}'::text[], 'a success with nothing to report');
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000e3',
            'provider_error', array['provider_error']),
  array['provider_error'], 'a first failure: its code is due for a report');
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000e3',
            'provider_error', array['provider_error', 'signing_orphan_completed']),
  array['signing_orphan_completed'], 'the same code again within a day: not due; another code is');
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000e3',
            null, array['provider_error']),
  '{}'::text[], 'a request of another org: nothing recorded, nothing due');
select throws_ok($$ select public.record_signature_sync('b0000000-0000-0000-0000-00000000000a',
                     'c0000000-0000-0000-0000-0000000000e1', 'Not a code!') $$,
  '22023', null, 'a code is an identifier');
select results_eq($$ select id from public.list_signature_requests_to_reconcile('b0000000-0000-0000-0000-00000000000a') $$,
  $$ values ('c0000000-0000-0000-0000-0000000000e2'::uuid), ('c0000000-0000-0000-0000-0000000000a1'),
            ('c0000000-0000-0000-0000-0000000000e1'), ('c0000000-0000-0000-0000-0000000000e3') $$,
  'rotation: completed-known first, then never attempted before attempted (a1 after e2, e1 before the overdue e3)');
reset role;

select results_eq($$
  select request_id, org_id, attempted_at = now(), synced_at, error_code, failing_since,
         (select array_agg(k order by k) from jsonb_object_keys(reported) k)
    from public.signature_request_syncs order by request_id
$$, $$ values
  ('c0000000-0000-0000-0000-0000000000a1'::uuid, 'b0000000-0000-0000-0000-00000000000a'::uuid, true, now(),
   null::text, null::timestamptz, null::text[]),
  ('c0000000-0000-0000-0000-0000000000e3', 'b0000000-0000-0000-0000-00000000000a', true, null, 'provider_error', now(),
   array['provider_error', 'signing_orphan_completed'])
$$, 'the attempt, the success, the failure streak and the reported codes are recorded');

-- A day later (the report moved back instead), the same code is due again; a success ends the streak.
update public.signature_request_syncs
   set reported = jsonb_build_object('provider_error', now() - interval '1 day 1 minute'),
       failing_since = now() - interval '7 hours'
 where request_id = 'c0000000-0000-0000-0000-0000000000e3';
set local role service_role;
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000e3',
            'provider_error', array['provider_error']),
  array['provider_error'], 'reported over a day ago: due again');
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000e3'),
  '{}'::text[], 'then a success');
reset role;
select results_eq($$
  select synced_at, error_code, failing_since from public.signature_request_syncs
   where request_id = 'c0000000-0000-0000-0000-0000000000e3'
$$, $$ values (now(), null::text, null::timestamptz) $$, 'a success clears the failure and its start');

-- An attempt that read nothing at Documenso (a draft skipped as `sending`, …: p_read false) moves
-- only attempted_at: neither the last read nor the failure streak.
update public.signature_request_syncs
   set attempted_at = now() - interval '1 hour', synced_at = now() - interval '2 hours',
       error_code = 'provider_error', failing_since = now() - interval '3 hours'
 where request_id = 'c0000000-0000-0000-0000-0000000000e3';
set local role service_role;
select is(public.record_signature_sync('b0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000e3',
            null, '{}', false),
  '{}'::text[], 'an attempt that read nothing');
select throws_ok($$ select public.record_signature_sync('b0000000-0000-0000-0000-00000000000a',
                     'c0000000-0000-0000-0000-0000000000e3', null, '{}', null) $$,
  '22023', null, 'whether it read is required');
reset role;
select results_eq($$
  select attempted_at = now(), synced_at, error_code, failing_since from public.signature_request_syncs
   where request_id = 'c0000000-0000-0000-0000-0000000000e3'
$$, $$ values (true, now() - interval '2 hours', 'provider_error'::text, now() - interval '3 hours') $$,
  'nothing read: the attempt is stamped (the rotation), the last read and the failure streak stay');

-- =============================================================================
-- The alert (as postgres, like run_sql_job)
-- =============================================================================
select is(private.job_signing_unsaved_alert(),
  'notified=3 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'first run: a1 and b1 (completed over 6 h ago) and the orphan f1; not e2 (completed 30 min ago)');
select results_eq($$
  select org_id, module_key, kind, importance, link_path, subject_type, subject_id, recipient_permission,
         recipient_user_id, dedupe_key, expires_at
    from public.notifications where kind = 'core.signed_document_unsaved' order by subject_id
$$, $$ values
  ('b0000000-0000-0000-0000-00000000000a'::uuid, 'core'::text, 'core.signed_document_unsaved'::text, 'important'::text,
   '/parametres/signature-electronique'::text, 'signature_request'::text, 'c0000000-0000-0000-0000-0000000000a1'::uuid,
   'settings.integrations_manage'::text, null::uuid, 'c0000000-0000-0000-0000-0000000000a1:envelope_704'::text, null::timestamptz),
  ('b0000000-0000-0000-0000-00000000000b', 'core', 'core.signed_document_unsaved', 'important',
   '/parametres/signature-electronique', 'signature_request', 'c0000000-0000-0000-0000-0000000000b1',
   'settings.integrations_manage', null, 'c0000000-0000-0000-0000-0000000000b1:envelope_707', null),
  ('b0000000-0000-0000-0000-00000000000a', 'core', 'core.signed_document_unsaved', 'important',
   '/parametres/signature-electronique', 'signature_request', 'c0000000-0000-0000-0000-0000000000f1',
   'settings.integrations_manage', null, 'c0000000-0000-0000-0000-0000000000f1:envelope_705', null)
$$, 'one important core notice per request and envelope (key <request>:<envelope>), in its own org, for settings.integrations_manage, linked to Signature électronique');
select ok((select bool_and(title = 'Un document signé n''est pas encore sauvegardé'
                           and body like '%Documenso n''est pas sauvegardée%'
                           and body !~ 'Test')
             from public.notifications where kind = 'core.signed_document_unsaved'),
  'French title and body; the request''s title (it may name a person) is not copied');

select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'a second run posts nothing new');
select is((select count(*)::int from public.notifications where kind = 'core.signed_document_unsaved'), 3,
  'never twice for one request');

-- e2 passes its 6 hours (a1 is still unsaved): one more notice.
update public.signature_requests set completed_event_at = now() - interval '6 hours 1 minute'
 where id = 'c0000000-0000-0000-0000-0000000000e2';
select is(private.job_signing_unsaved_alert(),
  'notified=1 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'a request past 6 hours is notified at the next run');

-- a1's PDF is finally stored: its notice expires; the others stay.
select lives_ok($$
  select public.complete_signature_request('c0000000-0000-0000-0000-0000000000a1',
    (select f.file_id from public.register_system_file('b0000000-0000-0000-0000-00000000000a', 'signed-documents', 'core',
       'signing_signed', 'signature_request', 'c0000000-0000-0000-0000-0000000000a1', 'application/pdf', 6000,
       repeat('f', 64), 'settings.integrations_manage', 'Document signé.pdf') f),
    repeat('f', 64))
$$, 'a1''s signed PDF is stored (complete_signature_request)');
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=1 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=1',
  'the next run clears a1''s notice, and forgets a1''s sync state (closed)');
select results_eq($$
  select subject_id, expires_at from public.notifications where kind = 'core.signed_document_unsaved' order by subject_id
$$, $$ values ('c0000000-0000-0000-0000-0000000000a1'::uuid, now()),
              ('c0000000-0000-0000-0000-0000000000b1', null::timestamptz),
              ('c0000000-0000-0000-0000-0000000000e2', null),
              ('c0000000-0000-0000-0000-0000000000f1', null) $$,
  'only the signed request''s notice expires (it leaves the bell and « À surveiller »)');
select results_eq($$ select request_id from public.signature_request_syncs $$,
  $$ values ('c0000000-0000-0000-0000-0000000000e3'::uuid) $$, 'the open request''s sync state stays');

-- The reconcile claims the orphan draft f1 again (about every 2 hours): begin_signature_request_send
-- clears its last_error. The notice stays: its key is never posted twice, so it would never come back.
select ok(public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a',
            'c0000000-0000-0000-0000-0000000000f1', interval '10 minutes'),
  'f1 is claimed again (its last_error cleared)');
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'an orphan draft claimed again, on the same envelope: its notice stays');
select is((select expires_at from public.notifications
            where kind = 'core.signed_document_unsaved' and subject_id = 'c0000000-0000-0000-0000-0000000000f1'),
  null::timestamptz, 'still open');

-- Then a person cancels it (abandoned): its notice expires, it is not signed.
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000f1', 'abandoned') $$,
  'f1 is abandoned');
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=1 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'an orphan draft abandoned: its notice expires at the next run');
select is((select expires_at from public.notifications
            where kind = 'core.signed_document_unsaved' and subject_id = 'c0000000-0000-0000-0000-0000000000f1'),
  now(), 'expired now, not in 90 days');

-- The draft d1 (envelope_706) is left orphan_completed: a notice. It is re-sent (claimed; the send
-- fails after creating envelope_708, which the draft records): the old notice expires. Once
-- Documenso completes envelope_708 with unmatched recipients again, a new notice (a new key).
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000d1', 'orphan_completed') $$,
  'd1 is left orphan_completed');
select is(private.job_signing_unsaved_alert(),
  'notified=1 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'd1''s orphan is notified');
select ok(public.begin_signature_request_send('b0000000-0000-0000-0000-00000000000a',
            'c0000000-0000-0000-0000-0000000000d1', interval '10 minutes'),
  'd1 is claimed for a re-send');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000d1', 'provider_error',
                     'envelope_708') $$,
  'the re-send records its new envelope, then fails');
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=1 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'another envelope, not completed: the old notice expires');
select lives_ok($$ select public.mark_signature_request_failed('c0000000-0000-0000-0000-0000000000d1', 'orphan_completed') $$,
  'the new envelope is completed with unmatched recipients');
select is(private.job_signing_unsaved_alert(),
  'notified=1 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'a new notice for the new envelope (a new key)');
select results_eq($$
  select dedupe_key, expires_at is null from public.notifications
   where kind = 'core.signed_document_unsaved' and subject_id = 'c0000000-0000-0000-0000-0000000000d1'
   order by dedupe_key
$$, $$ values ('c0000000-0000-0000-0000-0000000000d1:envelope_706'::text, false),
              ('c0000000-0000-0000-0000-0000000000d1:envelope_708', true) $$,
  'one notice per envelope of the request');

select lives_ok($$ select private.run_sql_job('core.signing_unsaved_alert') $$, 'run_sql_job runs it');
select results_eq($$
  select status, detail from public.scheduled_job_runs where job_key = 'core.signing_unsaved_alert'
$$, $$ values ('ok'::text,
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0'::text) $$,
  'and logs an ok run with its counts');

select * from finish();
rollback;
