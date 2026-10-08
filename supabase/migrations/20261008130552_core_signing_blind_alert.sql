-- =============================================================================
-- Signing alert: completions we cannot see (the Documenso VM is not backed up)
-- =============================================================================
-- Rule:    a person hears of it when a signed document may exist only on the Documenso VM, also
--          when we cannot see the completion (ADR 0005, « Pas de sauvegarde de la VM Documenso »).
-- Amends:  20261008124818_core_signing_capture.sql (private.job_signing_unsaved_alert and the
--          core.signing_unsaved_alert job's description); changed here to keep history clear.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Same job, not a new one. core.signing_unsaved_alert already answers « could a signed
--   document exist only on the Documenso VM right now? » for the completions we saw
--   (completed_event_at); this adds the two cases where we cannot see one. Same audience
--   (settings.integrations_manage), same link (« Signature électronique »), same timing (hourly at
--   :55, after the reconcile at :50), and it runs in the database, so it still speaks when the edge
--   function, pg_net or Documenso is what fails. A separate job would add a catalogue row, a cron
--   entry and 24 run rows a day for one more statement. Each case has its own kind, because each
--   dedups and resolves differently.
-- * `core.signing_reconcile_failing` (one notice per org and outage): the org has a sent or viewed
--   request of an enabled module, sent over 6 hours ago, and core.signing_reconcile has no `ok`
--   run for the org that started in the last 6 hours (or none at all). It does not matter why:
--   Documenso unreachable or the key refused (`reconcile_failed`), the function down
--   (`http_*`, `no_response`, `configuration_missing`, logged with org null), pg_net stuck: no
--   successful run is the signal. A healthy run always logs `ok`, even with nothing to follow
--   (« Aucune demande à suivre »), so a quiet clinic never trips it. The request must itself be
--   over 6 hours old: a completion cannot have been invisible longer than the request has been
--   out, and a brand-new database (no run yet) does not alert at once.
--   Dedupe key = the id of the org's last `ok` run (`none` when there is none): it does not change
--   while the outage lasts, so the notice is posted once; the next outage starts after a newer
--   `ok` run, so it gets a new key and a new notice. The notice expires at the first run after an
--   `ok` run finished after it was posted. A pg_cron outage stops this job too: not covered here.
-- * `core.signing_module_disabled` (one notice per org, module and switch-off): the module of a
--   sent or viewed request has been disabled for over 6 hours (org_modules.updated_at). Its
--   webhooks and the reconcile skip it (module gate), so a completion is never stamped and its
--   PDF waits on the VM. Dedupe key = `<module_key>:<epoch of org_modules.updated_at>`, so a later
--   switch-off is a new notice. It expires once the module is enabled again (or switched again,
--   or no sent or viewed request of it is left). Links to « Modules », where it is re-enabled.
--   Same recipients as the others (the task's audience); re-enabling needs modules.manage, which
--   admins hold too.
-- * Neither notice names a person or a request (titles may name one), and neither has a subject
--   (an org, a module key: no uuid record). Expiry is bounded to notices of the last 90 days, the
--   window « À surveiller » shows, like the existing clean-up.
-- * Cost, per hourly run: the open requests (bounded, see 20261008124818) grouped by org, then for
--   each such org the latest `ok` reconcile run (scheduled_job_runs_org_started_idx, newest
--   first, stops at the first `ok`; at most 90 days of hourly runs during an outage, purged
--   after); org_modules rows switched off (a handful); open notices of the two kinds.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_blind_alert', true);

-- -----------------------------------------------------------------------------
-- core.signing_unsaved_alert (private.run_sql_job), three cases
-- -----------------------------------------------------------------------------
-- Header. Each case posts its notices (private.notify's dedupe; counted only when new), then
-- expires those whose condition has ended. A handful of rows: one statement each.
create or replace function private.job_signing_unsaved_alert()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_notified bigint;
  v_cleared bigint;
  v_stalled bigint;
  v_resumed bigint;
  v_module_disabled bigint;
  v_module_cleared bigint;
begin
  -- 1. Completions we saw: unchanged (20261008124818).
  select pg_catalog.count(private.notify(
           r.org_id, 'core', 'core.signed_document_unsaved', 'important',
           'Un document signé n''est pas encore sauvegardé',
           'Documenso a terminé une signature, mais le PDF signé n''a pas encore été copié dans les '
             || 'fichiers de la clinique. La VM Documenso n''est pas sauvegardée : tant que la copie '
             || 'n''est pas faite, ce document n''existe que là-bas. Vérifiez la connexion dans '
             || '« Signature électronique » et le suivi des signatures dans « Tâches planifiées ».',
           '/parametres/signature-electronique', 'signature_request', r.id,
           'settings.integrations_manage', null, r.id::text, null))
    into v_notified
    from public.signature_requests r
   where ((r.status in ('sent', 'viewed') and r.completed_event_at < pg_catalog.now() - interval '6 hours')
          or (r.status = 'draft' and r.last_error = 'orphan_completed'))
     and not exists (select 1 from public.notifications n
                      where n.org_id = r.org_id and n.kind = 'core.signed_document_unsaved'
                        and n.dedupe_key = r.id::text);

  update public.notifications n
     set expires_at = pg_catalog.now()
   where n.kind = 'core.signed_document_unsaved'
     and n.created_at > pg_catalog.now() - interval '90 days'
     and n.expires_at is null
     and exists (select 1 from public.signature_requests r
                  where r.id = n.subject_id and r.org_id = n.org_id and r.status = 'signed');
  get diagnostics v_cleared = row_count;

  -- 2. The reconcile cannot see: no `ok` run for the org in 6 hours while a request is out.
  select pg_catalog.count(private.notify(
           s.org_id, 'core', 'core.signing_reconcile_failing', 'important',
           'Le suivi des signatures électroniques ne fonctionne plus',
           'Depuis plus de 6 heures, le suivi des signatures électroniques échoue alors que des demandes '
             || 'sont en cours : Documenso est peut-être injoignable ou refuse la clé d''API. Un document '
             || 'signé pendant ce temps n''existe peut-être que sur la VM Documenso, qui n''est pas '
             || 'sauvegardée. Vérifiez la connexion dans « Signature électronique » et le suivi des '
             || 'signatures dans « Tâches planifiées ».',
           '/parametres/signature-electronique', null, null,
           'settings.integrations_manage', null, s.episode, null))
    into v_stalled
    from (select o.org_id, coalesce(lo.id::text, 'none') as episode
            from (select distinct r.org_id
                    from public.signature_requests r
                   where r.status in ('sent', 'viewed')
                     and coalesce(r.sent_at, r.created_at) < pg_catalog.now() - interval '6 hours'
                     and public.module_enabled_for_org(r.org_id, r.module_key)) o
            left join lateral (
              select x.id, x.started_at
                from public.scheduled_job_runs x
               where x.org_id = o.org_id and x.job_key = 'core.signing_reconcile' and x.status = 'ok'
               order by x.started_at desc, x.id desc
               limit 1) lo on true
           where (lo.started_at is null or lo.started_at < pg_catalog.now() - interval '6 hours')
             and exists (select 1 from public.scheduled_jobs j
                          where j.key = 'core.signing_reconcile' and j.is_active)) s
   where not exists (select 1 from public.notifications n
                      where n.org_id = s.org_id and n.kind = 'core.signing_reconcile_failing'
                        and n.dedupe_key = s.episode);

  -- A run finishing `ok` after the notice ends the outage. Such a run started at most 30 minutes
  -- before it finished (a run still `running` after 15 is closed as abandoned by
  -- core.scheduled_jobs_reconcile, every 15): the hour bounds the index range.
  update public.notifications n
     set expires_at = pg_catalog.now()
   where n.kind = 'core.signing_reconcile_failing'
     and n.created_at > pg_catalog.now() - interval '90 days'
     and n.expires_at is null
     and exists (select 1 from public.scheduled_job_runs x
                  where x.org_id = n.org_id and x.job_key = 'core.signing_reconcile' and x.status = 'ok'
                    and x.started_at > n.created_at - interval '1 hour'
                    and x.finished_at > n.created_at);
  get diagnostics v_resumed = row_count;

  -- 3. The module gate hides it: a sent or viewed request's module disabled for over 6 hours.
  select pg_catalog.count(private.notify(
           m.org_id, 'core', 'core.signing_module_disabled', 'important',
           'Des signatures en cours ne sont plus suivies',
           'Le module « ' || m.name || ' » est désactivé depuis plus de 6 heures alors que des demandes '
             || 'de signature électronique sont en cours : un document signé pendant ce temps n''est pas '
             || 'copié dans les fichiers de la clinique et n''existe que sur la VM Documenso, qui n''est '
             || 'pas sauvegardée. Réactivez le module dans « Modules » pour que ces signatures soient '
             || 'récupérées.',
           '/parametres/modules', null, null,
           'settings.integrations_manage', null, m.episode, null))
    into v_module_disabled
    from (select om.org_id, md.name,
                 om.module_key || ':' || (extract(epoch from om.updated_at))::text as episode
            from public.org_modules om
            join public.modules md on md.key = om.module_key
           where not om.enabled
             and om.updated_at < pg_catalog.now() - interval '6 hours'
             and exists (select 1 from public.signature_requests r
                          where r.org_id = om.org_id and r.module_key = om.module_key
                            and r.status in ('sent', 'viewed'))) m
   where not exists (select 1 from public.notifications n
                      where n.org_id = m.org_id and n.kind = 'core.signing_module_disabled'
                        and n.dedupe_key = m.episode);

  -- Ends once the switch-off it names is over (enabled again, or switched again: a new key) or no
  -- sent or viewed request of the module is left.
  update public.notifications n
     set expires_at = pg_catalog.now()
   where n.kind = 'core.signing_module_disabled'
     and n.created_at > pg_catalog.now() - interval '90 days'
     and n.expires_at is null
     and not exists (select 1 from public.org_modules om
                      where om.org_id = n.org_id and not om.enabled
                        and n.dedupe_key = om.module_key || ':' || (extract(epoch from om.updated_at))::text
                        and exists (select 1 from public.signature_requests r
                                     where r.org_id = om.org_id and r.module_key = om.module_key
                                       and r.status in ('sent', 'viewed')));
  get diagnostics v_module_cleared = row_count;

  return 'notified=' || v_notified || ' cleared=' || v_cleared
      || ' stalled=' || v_stalled || ' resumed=' || v_resumed
      || ' module_disabled=' || v_module_disabled || ' module_cleared=' || v_module_cleared;
end;
$$;

-- create or replace keeps the privileges; restated so the file reads alone.
revoke all on function private.job_signing_unsaved_alert() from public, anon, authenticated, service_role;

update public.scheduled_jobs
   set description = 'Avertit dans « À surveiller » les personnes qui gèrent la signature électronique quand un '
                     || 'document signé dans Documenso n''est toujours pas copié dans les fichiers de la clinique '
                     || 'six heures plus tard, ou ne peut pas l''être sans intervention, et quand le suivi des '
                     || 'signatures ne peut plus le voir depuis six heures alors que des demandes sont en cours '
                     || '(aucun passage réussi, ou module désactivé). La VM Documenso n''est pas sauvegardée.'
 where key = 'core.signing_unsaved_alert';
