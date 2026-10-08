-- =============================================================================
-- Signing capture: the Documenso VM is not backed up
-- =============================================================================
-- Rule:    every document Documenso produces (the signed PDF, with Documenso's certificate and
--          audit pages) is copied into our private storage as soon as it exists; a Documenso link
--          is never the only copy (ADR 0005, « Pas de sauvegarde de la VM Documenso »).
-- Amends:  20261008073909_core_signing.sql (the core.signing_reconcile job) and
--          20261008133453_core_signing_envelope.sql (list_signature_requests_to_reconcile, whose
--          latest body is the envelope one); applied there, so changed here.
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Hourly reconcile instead of daily (`cron.schedule` with the existing name, the convention of
--   20261008040525_core_scheduled_jobs.sql: same job, same command; « Tâches planifiées » reads the
--   schedule from cron.job and shows « Toutes les heures »). The webhook still stores the PDF at
--   once; the reconcile is the net for a lost webhook or a failed store.
-- * The list (same signature, so its grants stay), rebuilt from 20261008133453's envelope body: a
--   draft's Documenso state is its envelope id (the envelope API is the only reference; the
--   deprecated document id output column is still returned, always null). Every sent or viewed
--   request is read at each run, not only after a day. Without a webhook, polling is the only way
--   to learn that Documenso completed a document, so an hour between polls is what « captured
--   within about an hour » costs. The volume stays small: one open request per record and purpose
--   (signature_requests_open_subject_idx) and an expiry of 60 days at most (7 by default) bound it
--   to about one Documenso read per professional per hour while a contract is out (~50 at most,
--   usually a handful), and a read with nothing new applies no event.
-- * Fair rotation. A run reads at most 100 requests and starts no new batch after its soft
--   deadline (90 s, signing-events.ts), so with more open requests than one run covers, some wait.
--   Order: requests Documenso completed whose PDF is not stored first (completed_event_at: we know
--   a signed PDF exists), then the least recently attempted (signature_request_syncs.attempted_at,
--   never attempted first), so every open request is read within a few runs, whatever the volume.
--   A completion whose webhook was lost is not known before its read, so it sorts like any other
--   request: the rotation, not its place in the list, is what bounds its wait, and a request not
--   read successfully for 6 hours raises a notice (`…_core_signing_blind_alert`).
-- * `signature_request_syncs`: one row per request the reconcile has tried, written by
--   record_signature_sync after each one (service role): when it last tried (the rotation), when a
--   read last succeeded, the failure code and since when it fails, and when each code was last
--   reported to Sentry (the function reports a request's code at most once a day). Operational
--   state, not audited (000_invariants list, conventions §7): rewritten every hour for every open
--   request, it would add an audit row per request per hour forever; codes only, no personal data.
--   Rows of closed requests are deleted by core.signing_unsaved_alert (retention), and cascade with
--   the request. No client privilege, RLS on, no policy.
-- * core.signing_unsaved_alert (SQL, maintenance, hourly at :55, after the reconcile): one
--   important core notice per request and Documenso envelope (dedupe key `<request id>:<envelope
--   id>`, at most 36 + 1 + 73 characters; « À surveiller » and the bell of
--   settings.integrations_manage holders, i.e. whoever can fix the Documenso connection) when
--   Documenso completed it over 6 hours ago and its signed PDF is still not stored (sent or viewed
--   with completed_event_at), or when it is a draft left `orphan_completed` (Documenso completed
--   it but its recipients do not match: the reconcile leaves it for a person). It runs in the database, so it still speaks when the edge function,
--   pg_net or Documenso is what fails. The notice names no one (a request's title may name a
--   person) and links to « Signature électronique ». It expires at the next run once the request
--   no longer meets that condition for that envelope: signed, but also an orphan draft cancelled
--   (`abandoned`) or re-sent; a later envelope of the same request is a new key, so a new notice
--   (bounded to notices of the last 90 days, the window « À surveiller » shows).
-- * Each part of the job (the notices, the retention) runs in its own block: one that fails is
--   rolled back alone and logged in the run detail by its SQLSTATE (`unsaved_error=…`), the others
--   still run.
-- * Not covered here, on purpose: a request whose module is disabled, a completion nobody can see
--   because Documenso is unreachable or refuses the key, and a request no read reaches: see
--   `…_core_signing_blind_alert`.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_signing_capture', true);

-- -----------------------------------------------------------------------------
-- The reconcile's per-request state (operational)
-- -----------------------------------------------------------------------------
create table public.signature_request_syncs (
  request_id uuid primary key,
  org_id uuid not null,
  -- The last time the reconcile tried the request, whatever the outcome (the rotation).
  attempted_at timestamptz not null,
  -- The last time it was read and settled without error; null: never.
  synced_at timestamptz,
  -- The failure of the last attempt (a code, never a message), and since when the request fails
  -- without a success in between; both null after a success.
  error_code text check (error_code ~ '^[A-Za-z0-9_]{1,64}$'),
  failing_since timestamptz,
  -- `{code: last Sentry report}` for this request: a code is reported at most once a day.
  reported jsonb not null default '{}' check (pg_catalog.jsonb_typeof(reported) = 'object'),
  foreign key (request_id, org_id) references public.signature_requests (id, org_id) on delete cascade,
  check ((error_code is null) = (failing_since is null))
);

alter table public.signature_request_syncs enable row level security;
revoke all on public.signature_request_syncs from anon, authenticated, service_role;

-- Records one reconcile attempt of a request (signing-sync, service role): `p_error_code` null for
-- a success, else the failure's code. Returns, among `p_report_codes` (the codes the function
-- would report for this request: its failure, signing_orphan_completed, …), those not reported
-- for this request in the last day, and stamps them: the function reports only those. '{}' for a
-- request of another org (nothing recorded). Codes are identifiers (22023 otherwise), 10 at most.
create function public.record_signature_sync(
  p_org_id uuid,
  p_id uuid,
  p_error_code text default null,
  p_report_codes text[] default '{}'
)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reported jsonb;
  v_due text[];
begin
  if p_error_code !~ '^[A-Za-z0-9_]{1,64}$'
     or pg_catalog.cardinality(p_report_codes) > 10
     or exists (select 1 from pg_catalog.unnest(p_report_codes) c(code)
                 where c.code is null or c.code !~ '^[A-Za-z0-9_]{1,64}$') then
    raise exception 'Code invalide' using errcode = '22023';
  end if;

  insert into public.signature_request_syncs as s
    (request_id, org_id, attempted_at, synced_at, error_code, failing_since)
  select r.id, r.org_id, pg_catalog.now(),
         case when p_error_code is null then pg_catalog.now() end,
         p_error_code,
         case when p_error_code is not null then pg_catalog.now() end
    from public.signature_requests r
   where r.id = p_id and r.org_id = p_org_id
  on conflict (request_id) do update
    set attempted_at = excluded.attempted_at,
        synced_at = coalesce(excluded.synced_at, s.synced_at),
        error_code = excluded.error_code,
        failing_since = case when excluded.error_code is null then null
                             else coalesce(s.failing_since, excluded.failing_since) end
  returning s.reported into v_reported;
  if v_reported is null then
    return '{}';
  end if;

  select coalesce(pg_catalog.array_agg(distinct c.code order by c.code), '{}')
    into v_due
    from pg_catalog.unnest(p_report_codes) c(code)
   where coalesce((v_reported ->> c.code)::timestamptz, '-infinity') <= pg_catalog.now() - interval '1 day';
  if v_due <> '{}' then
    -- Keeps the codes reported in the last day, then stamps the due ones.
    update public.signature_request_syncs s
       set reported = coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                                  from pg_catalog.jsonb_each(s.reported) e
                                 where (e.value #>> '{}')::timestamptz > pg_catalog.now() - interval '1 day'),
                               '{}'::jsonb)
                      || (select pg_catalog.jsonb_object_agg(c.code, pg_catalog.now())
                            from pg_catalog.unnest(v_due) c(code))
     where s.request_id = p_id;
  end if;
  return v_due;
end;
$$;

revoke all on function public.record_signature_sync(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.record_signature_sync(uuid, uuid, text, text[]) to service_role;

-- -----------------------------------------------------------------------------
-- The reconcile list: every sent or viewed request, completed-without-PDF first, then rotation
-- -----------------------------------------------------------------------------
-- core.signing_reconcile (signing-sync, hourly, one org at a time): the org's open requests to
-- act on, with the action, in this order: Documenso completed without the signed PDF stored, then
-- the least recently attempted (never attempted first; signature_request_syncs), then `expire`
-- and `abandon`, then by expiry (soonest first):
--   `sync`     any sent or viewed request (read Documenso, apply its events, download the signed
--              PDF when completed: a webhook may have been lost), including one Documenso
--              completed whose PDF is not stored yet (whatever its expiry); also a draft with an
--              envelope id whose last send started over an hour ago (last_send_at, else
--              created_at): read it, recover it when Documenso completed it, else cancel it there
--              and mark_signature_request_failed('abandoned');
--   `expire`   sent or viewed past expires_at, not completed: sync first, then
--              expire_signature_request, then cancel at Documenso;
--   `abandon`  a draft with no envelope id whose last send started over a day ago (the same
--              clock), not abandoned: mark_signature_request_failed('abandoned').
-- A draft is acted on only after begin_signature_request_send claims it. A disabled module's
-- requests are skipped. 20261008133453's envelope body (the deprecated document id output is
-- always null) with this file's rotation, every-sent-or-viewed condition and order. Reads
-- signature_requests_open_idx, then one primary-key probe per request into
-- signature_request_syncs.
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
  select r.id, r.module_key, r.status, null::text, r.envelope_id, r.expires_at, a.action
    from public.signature_requests r
    left join public.signature_request_syncs s on s.request_id = r.id
    cross join lateral (
      select case when r.status = 'draft' then case when r.envelope_id is null then 'abandon' else 'sync' end
                  when r.completed_event_at is not null then 'sync'
                  when r.expires_at < pg_catalog.now() then 'expire'
                  else 'sync' end as action) a
   where r.org_id = p_org_id
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'))
     and (r.status <> 'draft'
          or coalesce(r.last_send_at, r.created_at)
             < pg_catalog.now() - case when r.envelope_id is null then interval '1 day'
                                       else interval '1 hour' end)
     and public.module_enabled_for_org(r.org_id, r.module_key)
   order by (r.status <> 'draft' and r.completed_event_at is not null) desc,
            s.attempted_at nulls first,
            a.action in ('expire', 'abandon') desc, r.expires_at nulls last, r.created_at, r.id
   limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

-- -----------------------------------------------------------------------------
-- core.signing_reconcile: hourly
-- -----------------------------------------------------------------------------
select cron.schedule('core.signing_reconcile', '50 * * * *',
  $$select private.invoke_job_function('core.signing_reconcile')$$);

update public.scheduled_jobs
   set description = 'Copie dans les fichiers de la clinique le PDF de chaque document signé dans Documenso '
                     || '(la VM Documenso n''est pas sauvegardée), met à jour les demandes en attente, '
                     || 'expire celles dont l''échéance est passée et nettoie les envois qui n''ont pas abouti.'
 where key = 'core.signing_reconcile';

-- -----------------------------------------------------------------------------
-- core.signing_unsaved_alert (private.run_sql_job)
-- -----------------------------------------------------------------------------
-- Header. One notice per request and envelope (private.notify's dedupe), counted only when new;
-- then the notices whose condition has ended expire; then the retention of
-- signature_request_syncs. A handful of rows: one statement each, one block per part.
create function private.job_signing_unsaved_alert()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_notified bigint;
  v_cleared bigint;
  v_purged bigint;
  v_parts text[] := '{}';
begin
  begin
    select pg_catalog.count(private.notify(
             r.org_id, 'core', 'core.signed_document_unsaved', 'important',
             'Un document signé n''est pas encore sauvegardé',
             'Documenso a terminé une signature, mais le PDF signé n''a pas encore été copié dans les '
               || 'fichiers de la clinique. La VM Documenso n''est pas sauvegardée : tant que la copie '
               || 'n''est pas faite, ce document n''existe que là-bas. Vérifiez la connexion dans '
               || '« Signature électronique » et le suivi des signatures dans « Tâches planifiées ».',
             '/parametres/signature-electronique', 'signature_request', r.id,
             'settings.integrations_manage', null, r.id::text || ':' || r.envelope_id, null))
      into v_notified
      from public.signature_requests r
     where ((r.status in ('sent', 'viewed') and r.completed_event_at < pg_catalog.now() - interval '6 hours')
            or (r.status = 'draft' and r.last_error = 'orphan_completed' and r.envelope_id is not null))
       and not exists (select 1 from public.notifications n
                        where n.org_id = r.org_id and n.kind = 'core.signed_document_unsaved'
                          and n.dedupe_key = r.id::text || ':' || r.envelope_id);

    -- Ends once the request no longer meets the condition for the envelope the notice names:
    -- signed, an orphan draft cancelled (`abandoned`) or re-sent, or another envelope since.
    update public.notifications n
       set expires_at = pg_catalog.now()
     where n.kind = 'core.signed_document_unsaved'
       and n.created_at > pg_catalog.now() - interval '90 days'
       and n.expires_at is null
       and not exists (select 1 from public.signature_requests r
                        where r.id = n.subject_id and r.org_id = n.org_id
                          and n.dedupe_key = r.id::text || ':' || r.envelope_id
                          and ((r.status in ('sent', 'viewed') and r.completed_event_at is not null)
                               or (r.status = 'draft' and r.last_error = 'orphan_completed')));
    get diagnostics v_cleared = row_count;
    v_parts := v_parts || ('notified=' || v_notified) || ('cleared=' || v_cleared);
  exception when others then
    -- The SQLSTATE only (`sqlerrm` can quote row values), like private.run_sql_job.
    v_parts := v_parts || ('unsaved_error=' || sqlstate);
  end;

  -- Retention: the reconcile's state of requests no longer open.
  begin
    delete from public.signature_request_syncs s
     where not exists (select 1 from public.signature_requests r
                        where r.id = s.request_id
                          and (r.status in ('sent', 'viewed')
                               or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned')));
    get diagnostics v_purged = row_count;
    v_parts := v_parts || ('syncs_purged=' || v_purged);
  exception when others then
    v_parts := v_parts || ('purge_error=' || sqlstate);
  end;

  return pg_catalog.array_to_string(v_parts, ' ');
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
