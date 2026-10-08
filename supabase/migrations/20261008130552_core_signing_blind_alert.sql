-- =============================================================================
-- Signing alert: completions we cannot see (the Documenso VM is not backed up)
-- =============================================================================
-- Rule:    a person hears of it when a signed document may exist only on the Documenso VM, also
--          when we cannot see the completion (ADR 0005, « Pas de sauvegarde de la VM Documenso »).
-- Amends:  20261008124818_core_signing_capture.sql (private.job_signing_unsaved_alert and the
--          core.signing_unsaved_alert job's description); 20261007140517_core_access.sql
--          (org_modules.disabled_at). Changed here to keep history clear.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Same job, not a new one. core.signing_unsaved_alert already answers « could a signed
--   document exist only on the Documenso VM right now? » for the completions we saw
--   (completed_event_at); this adds the three cases where we cannot see one. Same audience
--   (settings.integrations_manage), same timing (hourly at :55, after the reconcile at :50), and it
--   runs in the database, so it still speaks when the edge function, pg_net or Documenso is what
--   fails. A separate job would add a catalogue row, a cron entry and 24 run rows a day. Each case
--   has its own kind, because each dedups and resolves differently, and its own block: a case that
--   fails is rolled back alone and logged in the run detail by its SQLSTATE (`<case>_error=…`).
-- * The deploy guard. The outage and coverage cases need 6 hours of hourly reconcile runs to mean
--   anything: right after the push, the last `ok` run is the old daily one and no request has a
--   sync state yet. So both wait until core.signing_unsaved_alert's catalogue row (inserted by
--   20261008124818, with the hourly schedule) is over 6 hours old. A brand-new database waits the
--   same 6 hours.
-- * `core.signing_reconcile_failing` (one notice per org and outage): the org has a sent or viewed
--   request of an enabled module, sent over 6 hours ago, and core.signing_reconcile has no `ok`
--   run for the org that started in the last 6 hours (or none at all). A run is `ok` as soon as
--   it read one request's own document at Documenso, even when other requests failed
--   (signing-events.ts). It fails when nothing was read and either Documenso was unreachable or
--   refused the key (`reconcile_failed`), or at least two requests failed and every one of them
--   with a client error or another document under its id (`reconcile_documents_missing`: a key of
--   another Documenso team, an instance rebuilt without its documents; a single 404 stays a
--   partial run). So this case means one of those, the function down (`http_*`, `no_response`,
--   `configuration_missing`, logged with org null), or pg_net stuck; the notice says the address,
--   the key or the instance may be wrong. A healthy run always logs `ok`, even with nothing to
--   follow, so a quiet clinic never trips it.
--   The request must itself be over 6 hours old: a completion cannot have been invisible longer
--   than the request has been out.
--   Dedupe key = the id of the org's last `ok` run (`none` when there is none): it does not change
--   while the outage lasts, so the notice is posted once; the next outage starts after a newer
--   `ok` run, so it gets a new key and a new notice. The notice expires at the first run after an
--   `ok` run finished after it was posted. A pg_cron outage stops this job too: not covered here.
-- * `core.signing_requests_unverified` (one notice per org and episode): the reconcile works for
--   the org (an `ok` run started in the last 6 hours) but a request of an enabled module, with a
--   Documenso document and no known completion (that is the unsaved case), has not been read
--   successfully for 6 hours: a sent or viewed one whose last successful read
--   (signature_request_syncs.synced_at, else its send) is over 6 hours old, or a draft that fails
--   to settle for over 6 hours (failing_since; `orphan_completed` is the unsaved case). Either a
--   request fails on its own (deleted at Documenso → 404, a signed PDF over 20 MB, another
--   instance's document), or the runs never reach it, or (a clinic with a single open request)
--   the address, the key or the instance is wrong: the notice does not claim the reconcile works.
--   The condition is private.signing_unverified_requests, shared by the post, the expiry and the
--   list « Signature électronique » shows (list_unverified_signature_requests): the notice points
--   there, and the list names each request (its title for those who may see it), its last
--   successful read, since when it fails and why. Dedupe key = `after:<id of the org's
--   previous notice of this kind>` (`first` when none): posted only when that previous notice has
--   expired (or is over 90 days old, gone from « À surveiller »: a reminder), so once per episode,
--   and two concurrent runs compute the same key. It expires once no
--   request of the org is in that state (whatever the reconcile's health: during an outage it
--   stays, and the outage notice joins it).
-- * `core.signing_module_disabled` (one notice per org, module and switch-off): the module of a
--   sent or viewed request has been disabled for over 6 hours. Its webhooks and the reconcile skip
--   it (module gate), so a completion is never stamped and its PDF waits on the VM. The switch-off
--   time is `org_modules.disabled_at`, added here and kept by a trigger: set when `enabled` turns
--   false (or a row is inserted disabled), cleared when it turns true, unchanged by any other
--   update (`updated_at` moves on every save, so it could neither key the notice nor time the 6
--   hours). Existing disabled rows take their `updated_at`. Dedupe key =
--   `<module_key>:<epoch of disabled_at>`, so a later switch-off is a new notice. It expires once
--   the module is enabled again (or switched again, or no sent or viewed request of it is left).
--   Same recipients as the others (the task's audience); re-enabling needs modules.manage, so the
--   notice says to ask a person who manages the modules (an administrator, usually) and links to
--   « Modules » for those who can.
-- * No notice names a person or a request (titles may name one), and only the unsaved one has a
--   subject. Expiry is bounded to notices of the last 90 days, the window « À surveiller » shows,
--   like the existing clean-up.
-- * list_unverified_signature_requests (definer, settings.integrations_manage, the caller's org):
--   the requests behind the unverified notice, oldest successful read first, 100 at most (open
--   requests are bounded, see 20261008124818). A request's title is returned only when its
--   view_permission is among the caller's keys (null otherwise: the UI names the module instead),
--   since a title may name a person. Codes only, never a provider message.
-- * Cost, per hourly run: the open requests (bounded, see 20261008124818) with one primary-key
--   probe each into signature_request_syncs, grouped by org; for each such org the latest `ok`
--   reconcile run (scheduled_job_runs_org_started_idx, newest first, stops at the first `ok`; at
--   most 90 days of hourly runs during an outage, purged after) and its previous unverified notice
--   (notifications_dedupe_key's (org, kind) prefix); org_modules rows switched off (a handful);
--   open notices of the four kinds.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_blind_alert', true);

-- -----------------------------------------------------------------------------
-- org_modules.disabled_at: when the module was switched off
-- -----------------------------------------------------------------------------
alter table public.org_modules add column disabled_at timestamptz;

-- Best estimate for the rows already disabled (before the trigger exists).
update public.org_modules set disabled_at = updated_at where not enabled;

alter table public.org_modules
  add constraint org_modules_disabled_at_check check ((disabled_at is null) = enabled);

-- Header. An insert may give the time (seeds, fixtures); an update only moves it when `enabled`
-- changes.
create function private.org_modules_track_disabled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled then
    new.disabled_at := null;
  elsif tg_op = 'INSERT' then
    new.disabled_at := coalesce(new.disabled_at, pg_catalog.now());
  elsif old.enabled then
    new.disabled_at := pg_catalog.now();
  else
    new.disabled_at := old.disabled_at;
  end if;
  return new;
end;
$$;

revoke all on function private.org_modules_track_disabled() from public, anon, authenticated, service_role;

create trigger org_modules_disabled_at
  before insert or update on public.org_modules
  for each row execute function private.org_modules_track_disabled();

-- -----------------------------------------------------------------------------
-- The requests no read reaches (one condition for the notice and the list)
-- -----------------------------------------------------------------------------
-- The open requests of an enabled module, with a Documenso document and no known completion (that
-- is the unsaved case), not read successfully for 6 hours: a sent or viewed one whose last
-- successful read (signature_request_syncs.synced_at, else its send) is over 6 hours old, or a
-- draft failing to settle for over 6 hours (failing_since; `orphan_completed` is the unsaved
-- case). `p_org_id` null: every org (the alert job). Invoker, granted to no role: called by the job
-- and by list_unverified_signature_requests (definer, after its permission check).
create function private.signing_unverified_requests(p_org_id uuid)
returns table (
  request_id uuid,
  org_id uuid,
  synced_at timestamptz,
  failing_since timestamptz,
  error_code text
)
language sql
stable
set search_path = ''
as $$
  select r.id, r.org_id, s.synced_at, s.failing_since, s.error_code
    from public.signature_requests r
    left join public.signature_request_syncs s on s.request_id = r.id
   where (p_org_id is null or r.org_id = p_org_id)
     and r.documenso_document_id is not null
     and r.completed_event_at is null
     and ((r.status in ('sent', 'viewed')
           and coalesce(s.synced_at, r.sent_at) < pg_catalog.now() - interval '6 hours')
          or (r.status = 'draft'
              and coalesce(r.last_error, '') not in ('abandoned', 'orphan_completed')
              and s.failing_since < pg_catalog.now() - interval '6 hours'))
     and public.module_enabled_for_org(r.org_id, r.module_key)
$$;

revoke all on function private.signing_unverified_requests(uuid) from public, anon, authenticated, service_role;

-- « Signature électronique » (settings.integrations_manage): the caller's org's requests no read
-- reaches (header), oldest successful read first. `title` is null unless the caller may see the
-- request (its view_permission). 42501 without the permission.
create function public.list_unverified_signature_requests()
returns table (
  id uuid,
  module_key text,
  title text,
  sent_at timestamptz,
  synced_at timestamptz,
  failing_since timestamptz,
  error_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_keys text[] := private.current_permission_keys();
begin
  if v_org is null or not ('settings.integrations_manage' = any (v_keys)) then
    raise exception 'Permission refusée : settings.integrations_manage' using errcode = '42501';
  end if;
  return query
  select r.id, r.module_key,
         case when r.view_permission = any (v_keys) then r.title end,
         r.sent_at, u.synced_at, u.failing_since, u.error_code
    from private.signing_unverified_requests(v_org) u
    join public.signature_requests r on r.id = u.request_id
   order by coalesce(u.synced_at, r.sent_at, r.created_at), r.id
   limit 100;
end;
$$;

revoke all on function public.list_unverified_signature_requests() from public, anon, authenticated, service_role;
grant execute on function public.list_unverified_signature_requests() to authenticated;

-- -----------------------------------------------------------------------------
-- core.signing_unsaved_alert (private.run_sql_job), four cases and the retention
-- -----------------------------------------------------------------------------
-- Header. Each case posts its notices (private.notify's dedupe; counted only when new), then
-- expires those whose condition has ended, in its own block. A handful of rows: one statement
-- each.
create or replace function private.job_signing_unsaved_alert()
returns text
language plpgsql
set search_path = ''
as $$
declare
  -- The deploy guard (header): the hourly reconcile has been in place for 6 hours.
  v_watching boolean := exists (select 1 from public.scheduled_jobs j
                                 where j.key = 'core.signing_unsaved_alert'
                                   and j.created_at < pg_catalog.now() - interval '6 hours');
  v_posted bigint;
  v_ended bigint;
  v_parts text[] := '{}';
begin
  -- 1. Completions we saw (20261008124818, unchanged).
  begin
    select pg_catalog.count(private.notify(
             r.org_id, 'core', 'core.signed_document_unsaved', 'important',
             'Un document signé n''est pas encore sauvegardé',
             'Documenso a terminé une signature, mais le PDF signé n''a pas encore été copié dans les '
               || 'fichiers de la clinique. La VM Documenso n''est pas sauvegardée : tant que la copie '
               || 'n''est pas faite, ce document n''existe que là-bas. Vérifiez la connexion dans '
               || '« Signature électronique » et le suivi des signatures dans « Tâches planifiées ».',
             '/parametres/signature-electronique', 'signature_request', r.id,
             'settings.integrations_manage', null, r.id::text || ':' || r.documenso_document_id, null))
      into v_posted
      from public.signature_requests r
     where ((r.status in ('sent', 'viewed') and r.completed_event_at < pg_catalog.now() - interval '6 hours')
            or (r.status = 'draft' and r.last_error = 'orphan_completed' and r.documenso_document_id is not null))
       and not exists (select 1 from public.notifications n
                        where n.org_id = r.org_id and n.kind = 'core.signed_document_unsaved'
                          and n.dedupe_key = r.id::text || ':' || r.documenso_document_id);

    update public.notifications n
       set expires_at = pg_catalog.now()
     where n.kind = 'core.signed_document_unsaved'
       and n.created_at > pg_catalog.now() - interval '90 days'
       and n.expires_at is null
       and not exists (select 1 from public.signature_requests r
                        where r.id = n.subject_id and r.org_id = n.org_id
                          and n.dedupe_key = r.id::text || ':' || r.documenso_document_id
                          and ((r.status in ('sent', 'viewed') and r.completed_event_at is not null)
                               or (r.status = 'draft' and r.last_error = 'orphan_completed')));
    get diagnostics v_ended = row_count;
    v_parts := v_parts || ('notified=' || v_posted) || ('cleared=' || v_ended);
  exception when others then
    -- The SQLSTATE only (`sqlerrm` can quote row values), like private.run_sql_job.
    v_parts := v_parts || ('unsaved_error=' || sqlstate);
  end;

  -- 2. The reconcile cannot see: no `ok` run for the org in 6 hours while a request is out.
  begin
    select pg_catalog.count(private.notify(
             s.org_id, 'core', 'core.signing_reconcile_failing', 'important',
             'Le suivi des signatures électroniques ne fonctionne plus',
             'Depuis plus de 6 heures, le suivi des signatures électroniques échoue alors que des demandes '
               || 'sont en cours : Documenso est peut-être injoignable, ou l''adresse, la clé d''API ou '
               || 'l''instance configurée n''est pas la bonne (une clé d''une autre équipe, une '
               || 'instance reconstruite sans ses documents). Un document signé pendant ce temps n''existe '
               || 'peut-être que sur la VM Documenso, qui n''est pas sauvegardée. Vérifiez la connexion dans '
               || '« Signature électronique » et le suivi dans « Tâches planifiées ».',
             '/parametres/signature-electronique', null, null,
             'settings.integrations_manage', null, s.episode, null))
      into v_posted
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
             where v_watching
               and (lo.started_at is null or lo.started_at < pg_catalog.now() - interval '6 hours')
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
    get diagnostics v_ended = row_count;
    v_parts := v_parts || ('stalled=' || v_posted) || ('resumed=' || v_ended);
  exception when others then
    v_parts := v_parts || ('failing_error=' || sqlstate);
  end;

  -- 3. Requests no read reaches: the reconcile works, but a request has not been read for 6 hours
  --    (private.signing_unverified_requests, the list « Signature électronique » shows).
  begin
    select pg_catalog.count(private.notify(
             u.org_id, 'core', 'core.signing_requests_unverified', 'important',
             'Des demandes de signature n''ont pas pu être vérifiées',
             'Depuis plus de 6 heures, une ou plusieurs demandes de signature électronique n''ont pas pu '
               || 'être vérifiées auprès de Documenso. Si l''une d''elles a été signée, le document n''existe '
               || 'peut-être que sur la VM Documenso, qui n''est pas sauvegardée. La liste des demandes '
               || 'concernées, avec la raison de chaque échec, est dans « Signature électronique ». Si toutes '
               || 'les demandes en cours y figurent, vérifiez aussi la connexion : l''adresse, la clé d''API '
               || 'ou l''instance n''est peut-être pas la bonne.',
             '/parametres/signature-electronique', null, null,
             'settings.integrations_manage', null, u.episode, null))
      into v_posted
      from (select o.org_id, coalesce('after:' || prev.id::text, 'first') as episode
              from (select distinct x.org_id from private.signing_unverified_requests(null) x) o
              left join lateral (
                select n.id, n.created_at, n.expires_at
                  from public.notifications n
                 where n.org_id = o.org_id and n.kind = 'core.signing_requests_unverified'
                 -- An open one wins a tie (two notices of one transaction share created_at).
                 order by n.created_at desc, n.expires_at is null desc, n.id desc
                 limit 1) prev on true
             where v_watching
               -- After 90 days the previous one has left « À surveiller »: a reminder.
               and (prev.id is null or prev.expires_at <= pg_catalog.now()
                    or prev.created_at <= pg_catalog.now() - interval '90 days')
               and exists (select 1 from public.scheduled_job_runs x
                            where x.org_id = o.org_id and x.job_key = 'core.signing_reconcile'
                              and x.status = 'ok' and x.started_at >= pg_catalog.now() - interval '6 hours')) u
     -- Counted only when new (private.notify returns the existing id on a dedupe).
     where not exists (select 1 from public.notifications n
                        where n.org_id = u.org_id and n.kind = 'core.signing_requests_unverified'
                          and n.dedupe_key = u.episode);

    update public.notifications n
       set expires_at = pg_catalog.now()
     where n.kind = 'core.signing_requests_unverified'
       and n.created_at > pg_catalog.now() - interval '90 days'
       and n.expires_at is null
       and not exists (select 1 from private.signing_unverified_requests(n.org_id));
    get diagnostics v_ended = row_count;
    v_parts := v_parts || ('unverified=' || v_posted) || ('verified=' || v_ended);
  exception when others then
    v_parts := v_parts || ('unverified_error=' || sqlstate);
  end;

  -- 4. The module gate hides it: a sent or viewed request's module disabled for over 6 hours.
  begin
    select pg_catalog.count(private.notify(
             m.org_id, 'core', 'core.signing_module_disabled', 'important',
             'Des signatures en cours ne sont plus suivies',
             'Le module « ' || m.name || ' » est désactivé depuis plus de 6 heures alors que des demandes '
               || 'de signature électronique sont en cours : un document signé pendant ce temps n''est pas '
               || 'copié dans les fichiers de la clinique et n''existe que sur la VM Documenso, qui n''est '
               || 'pas sauvegardée. Demandez à une personne qui gère les modules (un administrateur, en '
               || 'général) de le réactiver dans « Modules ».',
             '/parametres/modules', null, null,
             'settings.integrations_manage', null, m.episode, null))
      into v_posted
      from (select om.org_id, md.name,
                   om.module_key || ':' || (extract(epoch from om.disabled_at))::text as episode
              from public.org_modules om
              join public.modules md on md.key = om.module_key
             where not om.enabled
               and om.disabled_at < pg_catalog.now() - interval '6 hours'
               and exists (select 1 from public.signature_requests r
                            where r.org_id = om.org_id and r.module_key = om.module_key
                              and r.status in ('sent', 'viewed'))) m
     where not exists (select 1 from public.notifications n
                        where n.org_id = m.org_id and n.kind = 'core.signing_module_disabled'
                          and n.dedupe_key = m.episode);

    -- Ends once the switch-off it names is over (enabled again, or switched again: a new key) or
    -- no sent or viewed request of the module is left.
    update public.notifications n
       set expires_at = pg_catalog.now()
     where n.kind = 'core.signing_module_disabled'
       and n.created_at > pg_catalog.now() - interval '90 days'
       and n.expires_at is null
       and not exists (select 1 from public.org_modules om
                        where om.org_id = n.org_id and not om.enabled
                          and n.dedupe_key = om.module_key || ':' || (extract(epoch from om.disabled_at))::text
                          and exists (select 1 from public.signature_requests r
                                       where r.org_id = om.org_id and r.module_key = om.module_key
                                         and r.status in ('sent', 'viewed')));
    get diagnostics v_ended = row_count;
    v_parts := v_parts || ('module_disabled=' || v_posted) || ('module_cleared=' || v_ended);
  exception when others then
    v_parts := v_parts || ('module_error=' || sqlstate);
  end;

  -- 5. Retention: the reconcile's state of requests no longer open (20261008124818).
  begin
    delete from public.signature_request_syncs s
     where not exists (select 1 from public.signature_requests r
                        where r.id = s.request_id
                          and (r.status in ('sent', 'viewed')
                               or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned')));
    get diagnostics v_ended = row_count;
    v_parts := v_parts || ('syncs_purged=' || v_ended);
  exception when others then
    v_parts := v_parts || ('purge_error=' || sqlstate);
  end;

  return pg_catalog.array_to_string(v_parts, ' ');
end;
$$;

-- create or replace keeps the privileges; restated so the file reads alone.
revoke all on function private.job_signing_unsaved_alert() from public, anon, authenticated, service_role;

update public.scheduled_jobs
   set description = 'Avertit dans « À surveiller » les personnes qui gèrent la signature électronique quand un '
                     || 'document signé dans Documenso n''est toujours pas copié dans les fichiers de la clinique '
                     || 'six heures plus tard, ou ne peut pas l''être sans intervention, et quand le suivi des '
                     || 'signatures ne peut plus le voir depuis six heures alors que des demandes sont en cours '
                     || '(aucun passage réussi, demande qui ne peut pas être vérifiée, ou module désactivé). La VM '
                     || 'Documenso n''est pas sauvegardée.'
 where key = 'core.signing_unsaved_alert';
