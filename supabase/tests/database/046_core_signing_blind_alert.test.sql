-- Signing blind alert (migration *_core_signing_blind_alert.sql): core.signing_unsaved_alert also
-- speaks when we cannot see a completion. Covers:
-- * `core.signing_reconcile_failing`: one important core notice per org (settings.integrations_manage,
--   linked to « Signature électronique », no subject) when core.signing_reconcile has no `ok` run
--   for the org in the last 6 hours (or none at all) while a request of an enabled module has been
--   sent or viewed for over 6 hours; keyed on the org's last `ok` run, so never twice for one
--   outage; expired by the first run after an `ok` run; a later outage is a new notice.
--   Not for a healthy org, a request sent under 6 hours ago, nor a request of a disabled module.
-- * `core.signing_module_disabled`: one important core notice per org and switch-off (linked to
--   « Modules ») when the module of a sent or viewed request has been disabled for over 6 hours;
--   never twice; expired once the module is enabled again. Not under 6 hours.
-- * The job's description; its counts in the run detail.
-- The whole file is one transaction, so now() is constant: an `ok` run « after » a notice is
-- written with a finished_at in the future.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select ok((select description like '%aucun passage réussi, ou module désactivé%'
                  and description like '%n''est pas sauvegardée%'
             from public.scheduled_jobs where key = 'core.signing_unsaved_alert'),
  'the job''s description names the new cases and keeps the reason');

-- =============================================================================
-- Fixtures (as postgres). One org per case; every request sent 3 days ago unless stated.
--   C  no `ok` run ever (an error 1 h ago)                   → reconcile failing, key 'none'
--   D  last `ok` run 7 h ago (an older one 2 days ago)       → reconcile failing, key = that run
--   E  `ok` run 1 h ago                                      → nothing
--   F  no run, but its only request was sent 2 h ago         → nothing
--   G  `ok` run 1 h ago; a Professionnels request, module off 7 h ago → module disabled
--   H  no run; a Professionnels request, module off 2 h ago  → nothing (grace, and the disabled
--      module's request does not count for the reconcile case)
-- =============================================================================
insert into public.organizations (id, name, timezone)
select ('b0000000-0000-0000-0000-0000000000' || x)::uuid, 'Org ' || x, 'America/Toronto'
  from unnest(array['0c', '0d', '0e', '0f', '1a', '1b']) x;

insert into public.org_modules (org_id, module_key, enabled, updated_at) values
  ('b0000000-0000-0000-0000-00000000001a', 'professionals', false, now() - interval '7 hours'),
  ('b0000000-0000-0000-0000-00000000001b', 'professionals', false, now() - interval '2 hours');

insert into public.document_templates (id, org_id, key, module_key, title, view_permission, edit_permission)
values
  ('d0000000-0000-0000-0000-00000000001a', 'b0000000-0000-0000-0000-00000000001a', 'professionals.service_contract',
   'professionals', 'Contrat', 'professionals.view', 'professionals.manage'),
  ('d0000000-0000-0000-0000-00000000001b', 'b0000000-0000-0000-0000-00000000001b', 'professionals.service_contract',
   'professionals', 'Contrat', 'professionals.view', 'professionals.manage');
insert into public.document_template_versions (id, template_id, org_id, version)
values
  ('d1000000-0000-0000-0000-00000000001a', 'd0000000-0000-0000-0000-00000000001a', 'b0000000-0000-0000-0000-00000000001a', 1),
  ('d1000000-0000-0000-0000-00000000001b', 'd0000000-0000-0000-0000-00000000001b', 'b0000000-0000-0000-0000-00000000001b', 1);

insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id,
  title, status, documenso_document_id, envelope_id, idempotency_key, view_permission, created_at, sent_at, expires_at)
select x.id, x.org, x.module, x.purpose, x.version, 'signing_test', 'a0000000-0000-0000-0000-000000000001',
       'Contrat de Jeanne Exemple', 'sent', x.doc, 'envelope_' || x.doc, 'key-' || x.id, x.perm,
       x.sent, x.sent, now() + interval '4 days'
  from (values
    ('c1000000-0000-0000-0000-00000000000c'::uuid, 'b0000000-0000-0000-0000-00000000000c'::uuid, 'core', 'core.signing_test',
     null::uuid, '801', 'settings.integrations_manage', now() - interval '3 days'),
    ('c1000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-00000000000d', 'core', 'core.signing_test',
     null, '802', 'settings.integrations_manage', now() - interval '3 days'),
    ('c1000000-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-00000000000e', 'core', 'core.signing_test',
     null, '803', 'settings.integrations_manage', now() - interval '3 days'),
    ('c1000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-00000000000f', 'core', 'core.signing_test',
     null, '804', 'settings.integrations_manage', now() - interval '2 hours'),
    ('c1000000-0000-0000-0000-00000000001a', 'b0000000-0000-0000-0000-00000000001a', 'professionals',
     'professionals.service_contract', 'd1000000-0000-0000-0000-00000000001a', '805', 'professionals.view',
     now() - interval '3 days'),
    ('c1000000-0000-0000-0000-00000000001b', 'b0000000-0000-0000-0000-00000000001b', 'professionals',
     'professionals.service_contract', 'd1000000-0000-0000-0000-00000000001b', '806', 'professionals.view',
     now() - interval '3 days')
  ) as x (id, org, module, purpose, version, doc, perm, sent);

insert into public.scheduled_job_runs (id, job_key, org_id, trigger, started_at, finished_at, status, detail)
select x.id, 'core.signing_reconcile', x.org, 'cron', x.started, x.started + interval '1 minute', x.status, x.detail
  from (values
    ('e0000000-0000-0000-0000-0000000000c1'::uuid, 'b0000000-0000-0000-0000-00000000000c'::uuid,
     now() - interval '1 hour', 'error', 'reconcile_failed'),
    ('e0000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-00000000000d',
     now() - interval '2 days', 'ok', '1 demande suivie'),
    ('e0000000-0000-0000-0000-0000000000d2', 'b0000000-0000-0000-0000-00000000000d',
     now() - interval '7 hours', 'ok', '1 demande suivie'),
    ('e0000000-0000-0000-0000-0000000000d3', 'b0000000-0000-0000-0000-00000000000d',
     now() - interval '1 hour', 'error', 'reconcile_failed'),
    ('e0000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-00000000000e',
     now() - interval '1 hour', 'ok', '1 demande suivie'),
    ('e0000000-0000-0000-0000-0000000001a1', 'b0000000-0000-0000-0000-00000000001a',
     now() - interval '1 hour', 'ok', 'Aucune demande à suivre')
  ) as x (id, org, started, status, detail);

-- =============================================================================
-- First run
-- =============================================================================
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=2 resumed=0 module_disabled=1 module_cleared=0',
  'first run: the reconcile is failing for C and D; G''s module has been off for over 6 hours');

select results_eq($$
  select org_id, module_key, kind, importance, link_path, subject_type, subject_id, recipient_permission,
         recipient_user_id, dedupe_key, expires_at
    from public.notifications
   where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled')
   order by kind, org_id
$$, $$ values
  ('b0000000-0000-0000-0000-00000000001a'::uuid, 'core'::text, 'core.signing_module_disabled'::text, 'important'::text,
   '/parametres/modules'::text, null::text, null::uuid, 'settings.integrations_manage'::text, null::uuid,
   'professionals:' || (extract(epoch from now() - interval '7 hours'))::text, null::timestamptz),
  ('b0000000-0000-0000-0000-00000000000c', 'core', 'core.signing_reconcile_failing', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null, 'none', null),
  ('b0000000-0000-0000-0000-00000000000d', 'core', 'core.signing_reconcile_failing', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null,
   'e0000000-0000-0000-0000-0000000000d2', null)
$$, 'one important core notice per org, for settings.integrations_manage, keyed on the last ok run (or none) or on the switch-off');

select ok((select bool_and(body like '%VM Documenso, qui n''est pas sauvegardée%' and body !~ 'Jeanne'
                           and title !~ 'Jeanne')
             from public.notifications
            where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled')),
  'French notices that say why, and name no one (a request''s title may)');
select results_eq($$
  select kind, title, body like '%« Signature électronique »%', body like '%Le module « Professionnels »%'
    from public.notifications
   where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled') and org_id in
         ('b0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000001a')
   order by kind
$$, $$ values
  ('core.signing_module_disabled'::text, 'Des signatures en cours ne sont plus suivies'::text, false, true),
  ('core.signing_reconcile_failing', 'Le suivi des signatures électroniques ne fonctionne plus', true, false)
$$, 'titles; the failing notice points to « Signature électronique », the module one names the module');

-- =============================================================================
-- No repeat while the condition holds
-- =============================================================================
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 module_disabled=0 module_cleared=0', 'a second run posts nothing new');
select is((select count(*)::int from public.notifications
            where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled')), 3,
  'never twice for one outage or one switch-off');

-- =============================================================================
-- Recovery, then a new outage
-- =============================================================================
-- C's reconcile succeeds after the notice was posted.
insert into public.scheduled_job_runs (id, job_key, org_id, trigger, started_at, finished_at, status, detail)
values ('e0000000-0000-0000-0000-0000000000c2', 'core.signing_reconcile', 'b0000000-0000-0000-0000-00000000000c',
        'cron', now(), now() + interval '1 minute', 'ok', '1 demande suivie');
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=1 module_disabled=0 module_cleared=0', 'an ok run ends C''s outage');
select results_eq($$
  select org_id, expires_at from public.notifications where kind = 'core.signing_reconcile_failing' order by org_id
$$, $$ values ('b0000000-0000-0000-0000-00000000000c'::uuid, now()),
              ('b0000000-0000-0000-0000-00000000000d', null::timestamptz) $$,
  'C''s notice expires (it leaves the bell and « À surveiller »); D''s stays');

-- Seven hours later (moved back instead), C has failed since that run: a new outage, a new notice.
update public.scheduled_job_runs
   set started_at = now() - interval '7 hours', finished_at = now() - interval '7 hours' + interval '1 minute'
 where id = 'e0000000-0000-0000-0000-0000000000c2';
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=1 resumed=0 module_disabled=0 module_cleared=0', 'C''s next outage is notified again');
select results_eq($$
  select dedupe_key, expires_at is null from public.notifications
   where kind = 'core.signing_reconcile_failing' and org_id = 'b0000000-0000-0000-0000-00000000000c'
   order by created_at, dedupe_key
$$, $$ values ('e0000000-0000-0000-0000-0000000000c2'::text, true), ('none', false) $$,
  'keyed on the ok run before it; the first outage''s notice stays expired');

-- =============================================================================
-- Module enabled again
-- =============================================================================
update public.org_modules set enabled = true
 where org_id = 'b0000000-0000-0000-0000-00000000001a' and module_key = 'professionals';
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 module_disabled=0 module_cleared=1',
  'G''s module is enabled again: its notice expires (G''s reconcile is healthy, so nothing else)');
select is((select expires_at from public.notifications
            where kind = 'core.signing_module_disabled' and org_id = 'b0000000-0000-0000-0000-00000000001a'),
  now(), 'expired now');

-- =============================================================================
-- The run log
-- =============================================================================
select lives_ok($$ select private.run_sql_job('core.signing_unsaved_alert') $$, 'run_sql_job runs it');
select results_eq($$
  select status, detail from public.scheduled_job_runs where job_key = 'core.signing_unsaved_alert'
$$, $$ values ('ok'::text, 'notified=0 cleared=0 stalled=0 resumed=0 module_disabled=0 module_cleared=0'::text) $$,
  'and logs an ok run with all six counts');

select * from finish();
rollback;
