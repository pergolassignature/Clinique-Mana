-- =============================================================================
-- Signing capture: the Documenso VM is not backed up
-- =============================================================================
-- Rule:    every document Documenso produces (the signed PDF, with Documenso's certificate and
--          audit pages) is copied into our private storage as soon as it exists; a Documenso link
--          is never the only copy (ADR 0005, « Pas de sauvegarde de la VM Documenso »).
-- Amends:  20261008073909_core_signing.sql (list_signature_requests_to_reconcile, the
--          core.signing_reconcile job); applied there, so changed here.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Hourly reconcile instead of daily (cron.alter_job: same job, same command; « Tâches
--   planifiées » reads the schedule from cron.job and shows « Toutes les heures »). The webhook
--   still stores the PDF at once; the reconcile is the net for a lost webhook or a failed store.
-- * The list (same signature, so its grants stay): every sent or viewed request is read at each
--   run, not only after a day. Without a webhook, polling is the only way to learn that Documenso
--   completed a document, so an hour between polls is what « captured within about an hour »
--   costs. The volume stays small: one open request per record and purpose
--   (signature_requests_open_subject_idx) and an expiry of 60 days at most (7 by default) bound it
--   to about one Documenso read per professional per hour while a contract is out (~50 at most,
--   usually a handful), and a read with nothing new applies no event. Requests Documenso
--   completed whose PDF is not stored come first, so a full page (100) or the run's soft deadline
--   never leaves one for the next run. Drafts keep their clocks (an hour with a document, a day
--   without, from last_send_at), now honoured within the hour instead of the next 08:50 UTC.
-- * core.signing_unsaved_alert (SQL, maintenance, hourly at :55, after the reconcile): one
--   important core notice per request (dedupe key = the request id; « À surveiller » and the bell
--   of settings.integrations_manage holders, i.e. whoever can fix the Documenso connection) when
--   Documenso completed it over 6 hours ago and its signed PDF is still not stored (sent or viewed
--   with completed_event_at), or when it is a draft left `orphan_completed` (Documenso completed
--   it but its recipients do not match: the reconcile leaves it for a person). It runs in the
--   database, so it still speaks when the edge function, pg_net or Documenso is what fails. The
--   notice names no one (a request's title may name a person) and links to « Signature
--   électronique ». Once the request is signed, the next run expires its notice (bounded to
--   notices of the last 90 days, the window « À surveiller » shows).
-- * Not covered here, on purpose: a request whose module is disabled (its webhooks and reconcile
--   are skipped by the module gate, so completed_event_at is never stamped) and a completion
--   nobody can see because Documenso itself is unreachable or refuses the key (the reconcile's
--   runs then fail as `reconcile_failed`, reported to Sentry, shown in « Tâches planifiées »).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_capture', true);

-- -----------------------------------------------------------------------------
-- The reconcile list: every sent or viewed request, completed-without-PDF first
-- -----------------------------------------------------------------------------
-- core.signing_reconcile (signing-sync, hourly, one org at a time): the org's open requests to
-- act on, with the action, in this order: Documenso completed without the signed PDF stored,
-- then `expire` and `abandon`, then by expiry (soonest first):
--   `sync`     any sent or viewed request (read Documenso, apply its events, download the signed
--              PDF when completed: a webhook may have been lost), including one Documenso
--              completed whose PDF is not stored yet (whatever its expiry); also a draft with a
--              Documenso document whose last send started over an hour ago (last_send_at, else
--              created_at): read it, recover it when Documenso completed it, else cancel it there
--              and mark_signature_request_failed('abandoned');
--   `expire`   sent or viewed past expires_at, not completed: sync first, then
--              expire_signature_request, then cancel at Documenso;
--   `abandon`  a draft with no Documenso document whose last send started over a day ago (the
--              same clock), not abandoned: mark_signature_request_failed('abandoned').
-- A draft is acted on only after begin_signature_request_send claims it. A disabled module's
-- requests are skipped. Reads signature_requests_open_idx.
create or replace function public.list_signature_requests_to_reconcile(p_org_id uuid, p_limit int default 100)
returns table (
  id uuid,
  module_key text,
  status text,
  documenso_document_id text,
  envelope_id text,
  expires_at timestamptz,
  action text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.module_key, r.status, r.documenso_document_id, r.envelope_id, r.expires_at, a.action
    from public.signature_requests r
    cross join lateral (
      select case when r.status = 'draft' then case when r.documenso_document_id is null then 'abandon' else 'sync' end
                  when r.completed_event_at is not null then 'sync'
                  when r.expires_at < pg_catalog.now() then 'expire'
                  else 'sync' end as action) a
   where r.org_id = p_org_id
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
     and (r.status <> 'draft'
          or coalesce(r.last_send_at, r.created_at)
             < pg_catalog.now() - case when r.documenso_document_id is null then interval '1 day'
                                       else interval '1 hour' end)
     and public.module_enabled_for_org(r.org_id, r.module_key)
   order by (r.status <> 'draft' and r.completed_event_at is not null) desc,
            a.action in ('expire', 'abandon') desc, r.expires_at nulls last, r.created_at, r.id
   limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

-- -----------------------------------------------------------------------------
-- core.signing_reconcile: hourly
-- -----------------------------------------------------------------------------
select cron.alter_job((select j.jobid from cron.job j where j.jobname = 'core.signing_reconcile'),
                      schedule => '50 * * * *');

update public.scheduled_jobs
   set description = 'Copie dans les fichiers de la clinique le PDF de chaque document signé dans Documenso '
                     || '(la VM Documenso n''est pas sauvegardée), met à jour les demandes en attente, '
                     || 'expire celles dont l''échéance est passée et nettoie les envois qui n''ont pas abouti.'
 where key = 'core.signing_reconcile';

-- -----------------------------------------------------------------------------
-- core.signing_unsaved_alert (private.run_sql_job)
-- -----------------------------------------------------------------------------
-- Header. One notice per request (private.notify's dedupe), counted only when new; then the
-- notices of requests now signed expire. A handful of rows: one statement each.
create function private.job_signing_unsaved_alert()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_notified bigint;
  v_cleared bigint;
begin
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

  return 'notified=' || v_notified || ' cleared=' || v_cleared;
end;
$$;

revoke all on function private.job_signing_unsaved_alert() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('core.signing_unsaved_alert', 'core', 'Alerte : documents signés non sauvegardés',
   'Avertit dans « À surveiller » les personnes qui gèrent la signature électronique quand un document signé '
   || 'dans Documenso n''est toujours pas copié dans les fichiers de la clinique six heures plus tard, ou ne peut '
   || 'pas l''être sans intervention. La VM Documenso n''est pas sauvegardée.',
   'sql', 'private.job_signing_unsaved_alert', 'core.signing_unsaved_alert', true)
on conflict do nothing;

select cron.schedule('core.signing_unsaved_alert', '55 * * * *',
  $$select private.run_sql_job('core.signing_unsaved_alert')$$);
