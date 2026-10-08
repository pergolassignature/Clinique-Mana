-- Signing blind alert (migration *_core_signing_blind_alert.sql): core.signing_unsaved_alert also
-- speaks when we cannot see a completion. Covers:
-- * The deploy guard: the outage and coverage cases wait until the job has existed for 6 hours.
-- * `core.signing_reconcile_failing`: one important core notice per org (settings.integrations_manage,
--   linked to « Signature électronique », no subject) when core.signing_reconcile has no `ok` run
--   for the org in the last 6 hours (or none at all) while a request of an enabled module has been
--   sent or viewed for over 6 hours; keyed on the org's last `ok` run, so never twice for one
--   outage; expired by the first run after an `ok` run; a later outage is a new notice.
--   Not for a healthy org, nor one whose last run was a partial success (`ok`, some requests not
--   verified), a request sent under 6 hours ago, nor a request of a disabled module.
-- * `core.signing_requests_unverified`: one important core notice per org and episode when the
--   reconcile works for the org but a request has not been read successfully for 6 hours (a sent
--   one failing or never reached, a draft failing to settle); not for a completion already known
--   (the unsaved case), nor during an outage; expired once every request is read again; the next
--   episode is keyed on the previous notice.
-- * `core.signing_module_disabled`: one important core notice per org and switch-off (linked to
--   « Modules », telling integration managers to ask a person who manages the modules) when the
--   module of a sent or viewed request has been disabled for over 6 hours; keyed on
--   org_modules.disabled_at, which only a switch moves (a re-save does not); never twice; expired
--   once the module is enabled again; a later switch-off is a new notice. Not under 6 hours.
-- * Each case in its own block: one that fails is logged by its SQLSTATE, the others still run.
-- * The job's description; its counts in the run detail.
-- * The org_modules.disabled_at backfill of modules already disabled (the migration's own
--   statement, replayed on rows as they were before it).
-- * list_unverified_signature_requests: settings.integrations_manage only, the caller's org, the
--   same condition as the notice, a request's title only for those who may see the request; a
--   read before the send (of the draft) neither counts nor shows (greatest(synced_at, sent_at)).
-- The whole file is one transaction, so now() is constant: an `ok` run « after » a notice is
-- written with a finished_at in the future.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

select ok((select description like '%aucun passage réussi, demande qui ne peut pas être vérifiée, ou module désactivé%'
                  and description like '%n''est pas sauvegardée%'
             from public.scheduled_jobs where key = 'core.signing_unsaved_alert'),
  'the job''s description names the blind cases and keeps the reason');

-- =============================================================================
-- org_modules.disabled_at (the switch-off time)
-- =============================================================================
select has_column('public', 'org_modules', 'disabled_at', 'org_modules.disabled_at exists');
select results_eq($$
  select has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
    from pg_proc p where p.oid = 'private.org_modules_track_disabled()'::regprocedure
$$, $$ values (false, false, false) $$, 'its trigger function: no role may call it');

-- =============================================================================
-- Fixtures (as postgres). One org per case; every request sent 3 days ago unless stated.
--   C  no `ok` run ever (an error 1 h ago)                   → reconcile failing, key 'none'
--   D  last `ok` run 7 h ago (an older one 2 days ago)       → reconcile failing, key = that run
--   E  `ok` run 1 h ago, its request read 1 h ago; a second request completed 1 h ago, never read
--      (a known completion: the unsaved case's)              → nothing
--   F  no run, but its only request was sent 2 h ago         → nothing
--   G  `ok` run 1 h ago; a Professionnels request, module off 7 h ago → module disabled
--   H  no run; a Professionnels request, module off 2 h ago  → nothing (grace, and the disabled
--      module's request does not count for the other cases)
--   J  a partial `ok` run 1 h ago (one request not verified); its request last read 8 h ago,
--      failing since 7 h (404 at Documenso)                  → unverified, not failing
--   K  `ok` run 1 h ago; its request never reached           → unverified
--   L  `ok` run 1 h ago; a draft with an envelope failing to settle for 7 h → unverified
-- =============================================================================
insert into public.organizations (id, name, timezone)
select ('b0000000-0000-0000-0000-0000000000' || x)::uuid, 'Org ' || x, 'America/Toronto'
  from unnest(array['0c', '0d', '0e', '0f', '1a', '1b', '2a', '2b', '2c']) x;

insert into public.org_modules (org_id, module_key, enabled, disabled_at) values
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
  title, status, envelope_id, idempotency_key, view_permission, last_error, created_at, sent_at,
  expires_at, completed_event_at)
select x.id, x.org, x.module, x.purpose, x.version, 'signing_test', 'a0000000-0000-0000-0000-000000000001',
       'Contrat de Jeanne Exemple', x.status, 'envelope_' || x.doc, 'key-' || x.id, x.perm, x.err,
       x.sent, case when x.status = 'draft' then null else x.sent end,
       case when x.status = 'draft' then null else now() + interval '4 days' end, x.completed
  from (values
    ('c1000000-0000-0000-0000-00000000000c'::uuid, 'b0000000-0000-0000-0000-00000000000c'::uuid, 'core', 'core.signing_test',
     null::uuid, 'sent', '801', 'settings.integrations_manage', null::text, now() - interval '3 days', null::timestamptz),
    ('c1000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-00000000000d', 'core', 'core.signing_test',
     null, 'sent', '802', 'settings.integrations_manage', null, now() - interval '3 days', null),
    ('c1000000-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-00000000000e', 'core', 'core.signing_test',
     null, 'sent', '803', 'settings.integrations_manage', null, now() - interval '3 days', null),
    ('c1000000-0000-0000-0000-0000000000e2', 'b0000000-0000-0000-0000-00000000000e', 'core', 'core.signing_test',
     null, 'sent', '810', 'settings.integrations_manage', null, now() - interval '3 days', now() - interval '1 hour'),
    ('c1000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-00000000000f', 'core', 'core.signing_test',
     null, 'sent', '804', 'settings.integrations_manage', null, now() - interval '2 hours', null),
    ('c1000000-0000-0000-0000-00000000001a', 'b0000000-0000-0000-0000-00000000001a', 'professionals',
     'professionals.service_contract', 'd1000000-0000-0000-0000-00000000001a', 'sent', '805', 'professionals.view', null,
     now() - interval '3 days', null),
    ('c1000000-0000-0000-0000-00000000001b', 'b0000000-0000-0000-0000-00000000001b', 'professionals',
     'professionals.service_contract', 'd1000000-0000-0000-0000-00000000001b', 'sent', '806', 'professionals.view', null,
     now() - interval '3 days', null),
    ('c1000000-0000-0000-0000-00000000002a', 'b0000000-0000-0000-0000-00000000002a', 'core', 'core.signing_test',
     null, 'sent', '807', 'settings.integrations_manage', null, now() - interval '3 days', null),
    ('c1000000-0000-0000-0000-00000000002b', 'b0000000-0000-0000-0000-00000000002b', 'core', 'core.signing_test',
     null, 'sent', '808', 'settings.integrations_manage', null, now() - interval '3 days', null),
    ('c1000000-0000-0000-0000-00000000002c', 'b0000000-0000-0000-0000-00000000002c', 'core', 'core.signing_test',
     null, 'draft', '809', 'settings.integrations_manage', 'provider_error', now() - interval '3 days', null)
  ) as x (id, org, module, purpose, version, status, doc, perm, err, sent, completed);

insert into public.signature_request_syncs (request_id, org_id, attempted_at, synced_at, error_code, failing_since)
values
  ('c1000000-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-00000000000e', now() - interval '1 hour',
   now() - interval '1 hour', null, null),
  ('c1000000-0000-0000-0000-00000000002a', 'b0000000-0000-0000-0000-00000000002a', now() - interval '1 hour',
   now() - interval '8 hours', 'provider_error', now() - interval '7 hours'),
  ('c1000000-0000-0000-0000-00000000002c', 'b0000000-0000-0000-0000-00000000002c', now() - interval '1 hour',
   null, 'provider_error', now() - interval '7 hours');

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
     now() - interval '1 hour', 'ok', '2 demandes suivies'),
    ('e0000000-0000-0000-0000-0000000001a1', 'b0000000-0000-0000-0000-00000000001a',
     now() - interval '1 hour', 'ok', 'Aucune demande à suivre'),
    ('e0000000-0000-0000-0000-0000000002a1', 'b0000000-0000-0000-0000-00000000002a',
     now() - interval '1 hour', 'ok', 'Aucune demande traitée ; 1 demande non vérifiée'),
    ('e0000000-0000-0000-0000-0000000002b1', 'b0000000-0000-0000-0000-00000000002b',
     now() - interval '1 hour', 'ok', 'Aucune demande traitée ; 1 à reprendre au prochain passage'),
    ('e0000000-0000-0000-0000-0000000002c1', 'b0000000-0000-0000-0000-00000000002c',
     now() - interval '1 hour', 'ok', 'Aucune demande traitée ; 1 demande non vérifiée')
  ) as x (id, org, started, status, detail);

-- =============================================================================
-- The deploy guard: the job is younger than 6 hours (just pushed)
-- =============================================================================
update public.scheduled_jobs set created_at = now() - interval '5 hours' where key = 'core.signing_unsaved_alert';
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=1 module_cleared=0 syncs_purged=0',
  'right after the push: no outage nor coverage notice (the old daily run and no sync state yet); the module switch-off time is real');

-- =============================================================================
-- Six hours later
-- =============================================================================
update public.scheduled_jobs set created_at = now() - interval '7 days' where key = 'core.signing_unsaved_alert';
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=2 resumed=0 unverified=3 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'the reconcile is failing for C and D; J, K and L have requests no read reaches; G was posted already');

select results_eq($$
  select org_id, module_key, kind, importance, link_path, subject_type, subject_id, recipient_permission,
         recipient_user_id, dedupe_key, expires_at
    from public.notifications
   where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled', 'core.signing_requests_unverified')
   order by kind, org_id
$$, $$ values
  ('b0000000-0000-0000-0000-00000000001a'::uuid, 'core'::text, 'core.signing_module_disabled'::text, 'important'::text,
   '/parametres/modules'::text, null::text, null::uuid, 'settings.integrations_manage'::text, null::uuid,
   'professionals:' || (extract(epoch from now() - interval '7 hours'))::text, null::timestamptz),
  ('b0000000-0000-0000-0000-00000000000c', 'core', 'core.signing_reconcile_failing', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null, 'none', null),
  ('b0000000-0000-0000-0000-00000000000d', 'core', 'core.signing_reconcile_failing', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null,
   'e0000000-0000-0000-0000-0000000000d2', null),
  ('b0000000-0000-0000-0000-00000000002a', 'core', 'core.signing_requests_unverified', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null, 'first', null),
  ('b0000000-0000-0000-0000-00000000002b', 'core', 'core.signing_requests_unverified', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null, 'first', null),
  ('b0000000-0000-0000-0000-00000000002c', 'core', 'core.signing_requests_unverified', 'important',
   '/parametres/signature-electronique', null, null, 'settings.integrations_manage', null, 'first', null)
$$, 'one important core notice per org, for settings.integrations_manage, keyed on the last ok run (or none), the episode or the switch-off');

select ok((select bool_and(body like '%VM Documenso, qui n''est pas sauvegardée%' and body !~ 'Jeanne'
                           and title !~ 'Jeanne')
             from public.notifications
            where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled',
                           'core.signing_requests_unverified')),
  'French notices that say why, and name no one (a request''s title may)');
select results_eq($$
  select kind, title,
         body like '%Documenso est peut-être injoignable, ou l''adresse, la clé d''API ou l''instance configurée n''est pas la bonne%',
         body like '%n''ont pas pu être vérifiées%',
         body like '%Le module « Professionnels »%' and body like '%Demandez à une personne qui gère les modules%'
    from public.notifications
   where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled', 'core.signing_requests_unverified')
     and org_id in ('b0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000001a',
                    'b0000000-0000-0000-0000-00000000002a')
   order by kind
$$, $$ values
  ('core.signing_module_disabled'::text, 'Des signatures en cours ne sont plus suivies'::text, false, false, true),
  ('core.signing_reconcile_failing', 'Le suivi des signatures électroniques ne fonctionne plus', true, false, false),
  ('core.signing_requests_unverified', 'Des demandes de signature n''ont pas pu être vérifiées', false, true, false)
$$, 'titles; only the outage blames Documenso, the address, the key or the instance; the module one names the module and says whom to ask');
select ok((select bool_and(body like '%La liste des demandes concernées, avec la raison de chaque échec, est dans « Signature électronique »%'
                           and body not like '%Tâches planifiées%' and body not like '%même si%'
                           and link_path = '/parametres/signature-electronique')
             from public.notifications where kind = 'core.signing_requests_unverified'),
  'the unverified notice points where it links (the list in « Signature électronique »), and never claims the reconcile works');

-- =============================================================================
-- No repeat while the condition holds
-- =============================================================================
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'a second run posts nothing new');
select is((select count(*)::int from public.notifications
            where kind in ('core.signing_reconcile_failing', 'core.signing_module_disabled',
                           'core.signing_requests_unverified')), 6,
  'never twice for one outage, one episode or one switch-off');

-- =============================================================================
-- Outage: recovery, then a new outage
-- =============================================================================
-- C's reconcile succeeds after the notice was posted, and reads its request.
insert into public.scheduled_job_runs (id, job_key, org_id, trigger, started_at, finished_at, status, detail)
values ('e0000000-0000-0000-0000-0000000000c2', 'core.signing_reconcile', 'b0000000-0000-0000-0000-00000000000c',
        'cron', now(), now() + interval '1 minute', 'ok', '1 demande suivie');
insert into public.signature_request_syncs (request_id, org_id, attempted_at, synced_at)
values ('c1000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-00000000000c', now(), now());
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=1 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'an ok run ends C''s outage');
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
  'notified=0 cleared=0 stalled=1 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'C''s next outage is notified again (and not as unverified requests: the reconcile is down)');
select results_eq($$
  select dedupe_key, expires_at is null from public.notifications
   where kind = 'core.signing_reconcile_failing' and org_id = 'b0000000-0000-0000-0000-00000000000c'
   order by created_at, dedupe_key
$$, $$ values ('e0000000-0000-0000-0000-0000000000c2'::text, true), ('none', false) $$,
  'keyed on the ok run before it; the first outage''s notice stays expired');

-- =============================================================================
-- Unverified: read again, then a new episode
-- =============================================================================
update public.signature_request_syncs
   set synced_at = now(), error_code = null, failing_since = null
 where request_id = 'c1000000-0000-0000-0000-00000000002a';
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=1 module_disabled=0 module_cleared=0 syncs_purged=0',
  'J''s request is read again: its notice expires; K''s and L''s stay');

-- =============================================================================
-- Isolated cases: the unverified case fails (a check refuses its notices), the module case runs
-- =============================================================================
alter table public.notifications add constraint test_refuse_unverified
  check (kind <> 'core.signing_requests_unverified') not valid;
update public.signature_request_syncs
   set synced_at = now() - interval '7 hours', error_code = 'provider_error', failing_since = now() - interval '6 hours 30 minutes'
 where request_id = 'c1000000-0000-0000-0000-00000000002a';
update public.org_modules set enabled = true
 where org_id = 'b0000000-0000-0000-0000-00000000001a' and module_key = 'professionals';
-- (and the reconcile reads G's request again, else it would count as unverified)
insert into public.signature_request_syncs (request_id, org_id, attempted_at, synced_at)
values ('c1000000-0000-0000-0000-00000000001a', 'b0000000-0000-0000-0000-00000000001a', now(), now());
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified_error=23514 module_disabled=0 module_cleared=1 syncs_purged=0',
  'a failing case is logged by its SQLSTATE only; G''s module enabled again: its notice still expires');
select is((select count(*)::int from public.notifications
            where kind = 'core.signing_requests_unverified' and org_id = 'b0000000-0000-0000-0000-00000000002a'), 1,
  'the failed case left nothing behind');
select is((select expires_at from public.notifications
            where kind = 'core.signing_module_disabled' and org_id = 'b0000000-0000-0000-0000-00000000001a'),
  now(), 'the module notice expired in the same run');

alter table public.notifications drop constraint test_refuse_unverified;
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=1 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0',
  'J fails again for over 6 hours: a new episode');
select results_eq($$
  select dedupe_key, expires_at is null from public.notifications
   where kind = 'core.signing_requests_unverified' and org_id = 'b0000000-0000-0000-0000-00000000002a'
   order by created_at, dedupe_key
$$, $$ values (
    'after:' || (select id::text from public.notifications
                  where kind = 'core.signing_requests_unverified' and org_id = 'b0000000-0000-0000-0000-00000000002a'
                    and dedupe_key = 'first'), true),
  ('first', false) $$,
  'keyed on the previous notice; the first episode''s notice stays expired');

-- =============================================================================
-- The switch-off time: only a switch moves it
-- =============================================================================
select is((select disabled_at from public.org_modules
            where org_id = 'b0000000-0000-0000-0000-00000000001a' and module_key = 'professionals'),
  null::timestamptz, 'enabled: no switch-off time');
update public.org_modules set updated_by = null
 where org_id = 'b0000000-0000-0000-0000-00000000001b' and module_key = 'professionals';
select is((select disabled_at from public.org_modules
            where org_id = 'b0000000-0000-0000-0000-00000000001b' and module_key = 'professionals'),
  now() - interval '2 hours', 'a re-save of a disabled module keeps its switch-off time (updated_at moves, not this)');
update public.org_modules set enabled = false
 where org_id = 'b0000000-0000-0000-0000-00000000001a' and module_key = 'professionals';
select is((select disabled_at from public.org_modules
            where org_id = 'b0000000-0000-0000-0000-00000000001a' and module_key = 'professionals'),
  now(), 'switched off again: now');
update public.org_modules set disabled_at = now() - interval '30 days'
 where org_id = 'b0000000-0000-0000-0000-00000000001b' and module_key = 'professionals';
select is((select disabled_at from public.org_modules
            where org_id = 'b0000000-0000-0000-0000-00000000001b' and module_key = 'professionals'),
  now() - interval '2 hours', 'an update cannot move it either (only a switch does)');

-- G's second switch-off, 7 hours ago (re-inserted instead): a new key, a new notice.
delete from public.org_modules where org_id = 'b0000000-0000-0000-0000-00000000001a' and module_key = 'professionals';
insert into public.org_modules (org_id, module_key, enabled, disabled_at)
values ('b0000000-0000-0000-0000-00000000001a', 'professionals', false, now() - interval '7 hours 30 minutes');
select is(private.job_signing_unsaved_alert(),
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=1 module_cleared=0 syncs_purged=0',
  'G''s later switch-off is notified again');
select results_eq($$
  select dedupe_key, expires_at is null from public.notifications
   where kind = 'core.signing_module_disabled' and org_id = 'b0000000-0000-0000-0000-00000000001a'
   order by created_at, expires_at nulls first
$$, $$ values
  ('professionals:' || (extract(epoch from now() - interval '7 hours 30 minutes'))::text, true),
  ('professionals:' || (extract(epoch from now() - interval '7 hours'))::text, false) $$,
  'one notice per switch-off; the first stays expired');

-- =============================================================================
-- The run log
-- =============================================================================
select lives_ok($$ select private.run_sql_job('core.signing_unsaved_alert') $$, 'run_sql_job runs it');
select results_eq($$
  select status, detail from public.scheduled_job_runs where job_key = 'core.signing_unsaved_alert'
$$, $$ values ('ok'::text,
  'notified=0 cleared=0 stalled=0 resumed=0 unverified=0 verified=0 module_disabled=0 module_cleared=0 syncs_purged=0'::text) $$,
  'and logs an ok run with every count');


-- =============================================================================
-- The disabled_at backfill: the migration's own statement (supabase_migrations keeps it), replayed
-- on rows as they were before it (no column value, no trigger, no check)
-- =============================================================================
alter table public.org_modules drop constraint org_modules_disabled_at_check;
alter table public.org_modules disable trigger user;
update public.org_modules set disabled_at = null, updated_at = '2026-09-01 12:00:00+00'
 where org_id = 'b0000000-0000-0000-0000-00000000001b' and module_key = 'professionals';
insert into public.org_modules (org_id, module_key, enabled, updated_at)
values ('b0000000-0000-0000-0000-00000000000c', 'professionals', true, '2026-09-02 12:00:00+00');
select is((select count(*)::int
             from supabase_migrations.schema_migrations m, unnest(m.statements) st
            where m.version = '20261008151626' and st ~ 'set disabled_at = updated_at where not enabled'), 1,
  'the migration holds one backfill statement');
do $$
begin
  execute (select st from supabase_migrations.schema_migrations m, unnest(m.statements) st
            where m.version = '20261008151626' and st ~ 'set disabled_at = updated_at where not enabled');
end $$;
select results_eq($$
  select org_id, enabled, disabled_at from public.org_modules
   where (org_id, module_key) in (('b0000000-0000-0000-0000-00000000001b', 'professionals'),
                                  ('b0000000-0000-0000-0000-00000000000c', 'professionals'))
   order by org_id
$$, $$ values ('b0000000-0000-0000-0000-00000000000c'::uuid, true, null::timestamptz),
              ('b0000000-0000-0000-0000-00000000001b', false, '2026-09-01 12:00:00+00'::timestamptz) $$,
  'a module already disabled takes its updated_at as its switch-off time; an enabled one none');
alter table public.org_modules enable trigger user;
alter table public.org_modules
  add constraint org_modules_disabled_at_check check ((disabled_at is null) = enabled);

-- =============================================================================
-- list_unverified_signature_requests (« Signature électronique »)
-- Org M: an admin; an adjointe granted settings.integrations_manage and refused professionals.view;
-- a plain adjointe. m1 (core, last read 8 h ago, 404 since 7 h), m2 (Professionnels, never read),
-- m3 (core, read 1 h ago: verified), m4 and m0 (a read before the send, below). Org K's unverified
-- request is another org's.
-- =============================================================================
select results_eq($$
  select p.prosecdef, has_function_privilege('anon', p.oid, 'execute'),
         has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute'),
         (select has_function_privilege('authenticated', q.oid, 'execute') or has_function_privilege('service_role', q.oid, 'execute')
            from pg_proc q where q.oid = 'private.signing_unverified_requests(uuid)'::regprocedure)
    from pg_proc p where p.oid = 'public.list_unverified_signature_requests()'::regprocedure
$$, $$ values (true, false, true, false, false) $$,
  'the list: definer, authenticated only; its condition helper: no role');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at)
select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, '', now(), '{}', '{}',
       now(), now()
  from (values ('a3000000-0000-0000-0000-000000000001'::uuid, 'admin@m.test'),
               ('a3000000-0000-0000-0000-000000000002', 'integrations@m.test'),
               ('a3000000-0000-0000-0000-000000000003', 'adjointe@m.test')) x (id, email);
insert into public.organizations (id, name, timezone)
values ('b0000000-0000-0000-0000-00000000003a', 'Org M', 'America/Toronto');
insert into public.profiles (user_id, org_id, display_name, email, status) values
  ('a3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000003a', 'Admin M', 'admin@m.test', 'active'),
  ('a3000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000003a', 'Intégrations M', 'integrations@m.test', 'active'),
  ('a3000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000003a', 'Adjointe M', 'adjointe@m.test', 'active');
insert into public.user_roles (user_id, org_id, role) values
  ('a3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000003a', 'admin'),
  ('a3000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000003a', 'admin_assistant'),
  ('a3000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000003a', 'admin_assistant');
insert into public.user_permission_overrides (user_id, org_id, permission_key, granted) values
  ('a3000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000003a', 'settings.integrations_manage', true),
  ('a3000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000003a', 'professionals.view', false);
insert into public.org_modules (org_id, module_key, enabled)
values ('b0000000-0000-0000-0000-00000000003a', 'professionals', true);
insert into public.document_templates (id, org_id, key, module_key, title, view_permission, edit_permission)
values ('d0000000-0000-0000-0000-00000000003a', 'b0000000-0000-0000-0000-00000000003a', 'professionals.service_contract',
        'professionals', 'Contrat', 'professionals.view', 'professionals.manage');
insert into public.document_template_versions (id, template_id, org_id, version)
values ('d1000000-0000-0000-0000-00000000003a', 'd0000000-0000-0000-0000-00000000003a',
        'b0000000-0000-0000-0000-00000000003a', 1);
insert into public.signature_requests (id, org_id, module_key, purpose, template_version_id, subject_type, subject_id,
  title, status, envelope_id, idempotency_key, view_permission, created_at, sent_at, expires_at)
select x.id, 'b0000000-0000-0000-0000-00000000003a', x.module, x.purpose, x.version, 'signing_test',
       'a0000000-0000-0000-0000-000000000001', x.title, 'sent', 'envelope_' || x.doc, 'key-' || x.id, x.perm,
       now() - interval '3 days', now() - interval '3 days', now() + interval '4 days'
  from (values
    ('c3000000-0000-0000-0000-0000000000a1'::uuid, 'core', 'core.signing_test', null::uuid, 'Document test', '901',
     'settings.integrations_manage'),
    ('c3000000-0000-0000-0000-0000000000a2', 'professionals', 'professionals.service_contract',
     'd1000000-0000-0000-0000-00000000003a', 'Contrat de Jeanne Exemple', '902', 'professionals.view'),
    ('c3000000-0000-0000-0000-0000000000a3', 'core', 'core.signing_test', null, 'Autre document test', '903',
     'settings.integrations_manage')
  ) as x (id, module, purpose, version, title, doc, perm);
insert into public.signature_request_syncs (request_id, org_id, attempted_at, synced_at, error_code, failing_since)
values
  ('c3000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000003a', now() - interval '1 hour',
   now() - interval '8 hours', 'provider_not_found', now() - interval '7 hours'),
  ('c3000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000003a', now() - interval '1 hour',
   now() - interval '1 hour', null, null);
-- A read of the draft, before the send, does not count for the sent envelope (greatest, not
-- coalesce): m4 sent 1 h ago, last read 8 h before its send (not 6 h since the send: not
-- unverified); m0 sent 7 h ago, last read 1 h before its send (unverified, listed with no read).
insert into public.signature_requests (id, org_id, module_key, purpose, subject_type, subject_id, title, status,
  envelope_id, idempotency_key, view_permission, created_at, sent_at, expires_at)
select x.id, 'b0000000-0000-0000-0000-00000000003a', 'core', 'core.signing_test', 'signing_test',
       'a0000000-0000-0000-0000-000000000001', x.title, 'sent', 'envelope_' || x.doc, 'key-' || x.id,
       'settings.integrations_manage', now() - interval '3 days', x.sent, now() + interval '4 days'
  from (values
    ('c3000000-0000-0000-0000-0000000000a4'::uuid, 'Envoyé il y a 1 h', '904', now() - interval '1 hour'),
    ('c3000000-0000-0000-0000-0000000000a0', 'Envoyé il y a 7 h', '900', now() - interval '7 hours')
  ) as x (id, title, doc, sent);
insert into public.signature_request_syncs (request_id, org_id, attempted_at, synced_at)
values
  ('c3000000-0000-0000-0000-0000000000a4', 'b0000000-0000-0000-0000-00000000003a', now() - interval '9 hours',
   now() - interval '9 hours'),
  ('c3000000-0000-0000-0000-0000000000a0', 'b0000000-0000-0000-0000-00000000003a', now() - interval '8 hours',
   now() - interval '8 hours');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$ select id, module_key, title, sent_at, synced_at, failing_since, error_code
                       from public.list_unverified_signature_requests() $$,
  $$ values ('c3000000-0000-0000-0000-0000000000a2'::uuid, 'professionals'::text, 'Contrat de Jeanne Exemple'::text,
             now() - interval '3 days', null::timestamptz, null::timestamptz, null::text),
            ('c3000000-0000-0000-0000-0000000000a1', 'core', 'Document test', now() - interval '3 days',
             now() - interval '8 hours', now() - interval '7 hours', 'provider_not_found'),
            ('c3000000-0000-0000-0000-0000000000a0', 'core', 'Envoyé il y a 7 h', now() - interval '7 hours',
             null, null, null) $$,
  'an admin: the org''s requests no read reaches, oldest successful read since the send first, with their titles (not m3, read 1 h ago; not m4, sent 1 h ago though last read 9 h ago; m0''s read before its send is not shown; not org K''s)');

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$ select id, title from public.list_unverified_signature_requests() $$,
  $$ values ('c3000000-0000-0000-0000-0000000000a2'::uuid, null::text),
            ('c3000000-0000-0000-0000-0000000000a1', 'Document test'),
            ('c3000000-0000-0000-0000-0000000000a0', 'Envoyé il y a 7 h') $$,
  'an integration manager who may not see a request: listed, its title withheld');

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.list_unverified_signature_requests() $$, '42501',
  'Permission refusée : settings.integrations_manage', 'without settings.integrations_manage: refused');
reset role;

select * from finish();
rollback;
