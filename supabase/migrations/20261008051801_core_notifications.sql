-- =============================================================================
-- In-app notifications: addressed by permission, per-user read state, retention
-- =============================================================================
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.12 (P3-15, P3-21, P3-24)
-- Needs:   docs/plans/2026-10-08-professionals-module-plan.md, Task 4c.1 (kinds), P4-30
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * One row reaches every holder of `recipient_permission` in the org, optionally narrowed to
--   one user (`recipient_user_id`, same org through a composite FK). No fan-out: read state is
--   a separate per-user table, `notification_reads`. Deviation from PS Hub (per-user rows with
--   `is_read`, Realtime): the bell polls the count every 60 s instead (P3-24).
-- * Core knows no module kind. A module defines its kinds as `<module>.<name>` text (the
--   prefix is checked against `module_key`, like template and job keys) and stores French
--   `title` / `body` ready to display, so the bell never needs a module's labels. The
--   recipient permission belongs to the notice's own module, core's to core (private.notify,
--   22023): no module notice is addressed by a core permission.
-- * So the permission term is the module gate: a disabled module's permissions leave the
--   caller's array, so its notices leave the bell. Tested against the array once per
--   statement (P3-21).
-- * Addressing by permission is by design: whoever holds it now sees the notice, so a new
--   holder of a permission (a new member, a role change) sees the past notices too, and a
--   revoked one stops seeing them. A notice narrowed to one user (`recipient_user_id`, an
--   active member of the org) still needs the permission to be seen.
-- * `link_path` is app-relative only (`/x…`, never `//` or `/\`, no control character): the
--   UI navigates to it, so it can never be an open redirect.
-- * `dedupe_key` is unique per (org, kind): private.notify returns the existing id, so a job
--   re-run or a retried request never duplicates a notice. Deviation from the plan's
--   `unique (org_id, dedupe_key)`: scoping by kind keeps two modules' keys from colliding.
-- * Efficiency. The count (polled every 60 s) is bounded to the last 90 days, a range scan on
--   `created_at` (`notifications_org_created_idx`, or `notifications_created_idx` while there is
--   one org) with an anti-join on the caller's read rows. The list is keyset-paged on
--   (created_at, id), 20 by default, at most 50; the cursor is always an index bound (see the
--   function), and a cursor needs both fields (notices created in one transaction share
--   `created_at`). `is_read` is one primary-key probe per row of the page, not a pass over the
--   caller's read history; the unread-only list (« À surveiller ») is bounded to 90 days like
--   the count. Measured over 2 × 10 000 rows: count 1.2 ms, first page 0.8 ms, a page 300 days
--   deep 0.9 ms (20 rows read), no sequential scan of `notifications`.
-- * Retention: `core.notifications_purge` (daily, maintenance) deletes notices older than
--   12 months, or expired more than 30 days ago, in batches of 5 000 (each DELETE stays
--   bounded; the run is still one transaction, private.run_sql_job); reads cascade.
-- * Operational log: neither table is audited (000_invariants list, conventions §7). Clients
--   select `notifications` (RLS); `notification_reads` has no client privilege and no policy:
--   the RPCs below (definer) read and write it and return `is_read`.
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_notifications', true);

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null references public.modules(key),
  kind text not null check (pg_catalog.length(kind) <= 100 and kind ~ '^[a-z_]+\.[a-z0-9_]+$'),
  importance text not null default 'normal' check (importance in ('normal', 'important')),
  title text not null
    check (pg_catalog.length(title) <= 160 and pg_catalog.btrim(title) <> '' and title !~ '[[:cntrl:]]'),
  body text
    check (pg_catalog.length(body) <= 500 and pg_catalog.btrim(body) <> '' and body !~ '[[:cntrl:]]'),
  link_path text
    check (pg_catalog.length(link_path) <= 500 and link_path ~ '^/[^/\\]' and link_path !~ '[[:cntrl:]]'),
  -- The record the notice is about (`professional`, …), for a module to find its notices.
  subject_type text check (subject_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  subject_id uuid,
  recipient_permission text not null references public.permissions(key),
  recipient_user_id uuid,
  dedupe_key text check (pg_catalog.length(dedupe_key) between 1 and 200 and dedupe_key !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  foreign key (recipient_user_id, org_id) references public.profiles(user_id, org_id) on delete cascade,
  -- `<module>.<name>`, like permission keys.
  check (pg_catalog.split_part(kind, '.', 1) = module_key),
  check ((subject_type is null) = (subject_id is null)),
  constraint notifications_dedupe_key unique (org_id, kind, dedupe_key)
);
-- Serves the org FK, the RLS predicate, list_my_notifications and count_my_unread_notifications.
create index notifications_org_created_idx on public.notifications (org_id, created_at desc, id desc);
-- Serves a module's lookups by record (Professionnels 4c.2 expires a document's notices).
create index notifications_subject_idx on public.notifications (org_id, subject_type, subject_id)
  where subject_id is not null;
-- Serve core.notifications_purge (and the list and count across one org).
create index notifications_created_idx on public.notifications (created_at);
create index notifications_expires_idx on public.notifications (expires_at) where expires_at is not null;
create index notifications_module_key_idx on public.notifications (module_key);
create index notifications_recipient_permission_idx on public.notifications (recipient_permission);
create index notifications_recipient_user_idx on public.notifications (recipient_user_id, org_id)
  where recipient_user_id is not null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and recipient_permission = any ((select private.current_permission_keys())::text[])
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
    and (expires_at is null or expires_at > pg_catalog.now())
  );

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null,
  org_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id),
  foreign key (user_id, org_id) references public.profiles(user_id, org_id) on delete cascade
);
create index notification_reads_user_idx on public.notification_reads (user_id, notification_id);

-- RLS on, no policy, no client privilege: only the definer RPCs below read or write it (they
-- return `is_read`).
alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Creating notices
-- -----------------------------------------------------------------------------
-- Creates a notice, or returns the existing one with the same (org, kind, dedupe key). For SQL
-- callers: module RPCs (security definer) and SQL jobs. The checks raise 23514 (kind prefix,
-- link, lengths, blank or control characters); 22023: the permission must belong to the
-- notice's module, a narrowed recipient must be an active member of the org (whether they hold
-- the permission is not checked: visibility requires it anyway), and an expiry must be in the
-- future. A null importance is `normal`.
create function private.notify(
  p_org_id uuid,
  p_module_key text,
  p_kind text,
  p_importance text,
  p_title text,
  p_body text,
  p_link_path text,
  p_subject_type text,
  p_subject_id uuid,
  p_recipient_permission text,
  p_recipient_user_id uuid default null,
  p_dedupe_key text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_permission_module text;
  v_id uuid;
begin
  select p.module_key into v_permission_module
    from public.permissions p
   where p.key = p_recipient_permission;
  if v_permission_module is null or v_permission_module is distinct from p_module_key then
    raise exception 'Permission de destinataire invalide pour ce module' using errcode = '22023';
  end if;
  if p_recipient_user_id is not null
     and not exists (select 1 from public.profiles p
                      where p.user_id = p_recipient_user_id and p.org_id = p_org_id and p.status = 'active') then
    raise exception 'Le destinataire doit être un membre actif de l''organisation' using errcode = '22023';
  end if;
  if p_expires_at <= pg_catalog.now() then
    raise exception 'L''échéance d''une notification doit être dans le futur' using errcode = '22023';
  end if;

  insert into public.notifications
    (org_id, module_key, kind, importance, title, body, link_path, subject_type, subject_id,
     recipient_permission, recipient_user_id, dedupe_key, expires_at)
  values
    (p_org_id, p_module_key, p_kind, coalesce(p_importance, 'normal'), p_title, p_body, p_link_path, p_subject_type, p_subject_id,
     p_recipient_permission, p_recipient_user_id, p_dedupe_key, p_expires_at)
  on conflict (org_id, kind, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select n.id into v_id
      from public.notifications n
     where n.org_id = p_org_id and n.kind = p_kind and n.dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

revoke all on function
  private.notify(uuid, text, text, text, text, text, text, text, uuid, text, uuid, text, timestamptz)
from public, anon, authenticated, service_role;

-- private.notify for edge functions and function jobs (supabase/functions/_shared/notifications.ts).
create function public.create_notification(
  p_org_id uuid,
  p_module_key text,
  p_kind text,
  p_importance text,
  p_title text,
  p_body text,
  p_link_path text,
  p_subject_type text,
  p_subject_id uuid,
  p_recipient_permission text,
  p_recipient_user_id uuid default null,
  p_dedupe_key text default null,
  p_expires_at timestamptz default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.notify(p_org_id, p_module_key, p_kind, p_importance, p_title, p_body, p_link_path,
                        p_subject_type, p_subject_id, p_recipient_permission, p_recipient_user_id,
                        p_dedupe_key, p_expires_at)
$$;

revoke all on function
  public.create_notification(uuid, text, text, text, text, text, text, text, uuid, text, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.create_notification(uuid, text, text, text, text, text, text, text, uuid, text, uuid, text, timestamptz)
to service_role;

-- -----------------------------------------------------------------------------
-- User RPCs (the topbar bell and Accueil « À surveiller », Task 3.13)
-- -----------------------------------------------------------------------------
-- The caller's notices, newest first, keyset-paged on (created_at, id): pass the last row's
-- created_at and id (both: notices created in one transaction share created_at; p_before
-- alone raises 22023). `p_importance` and `p_unread_only` narrow the list (« À surveiller »:
-- important and unread, bounded to the last 90 days like the count).
-- Definer (notification_reads has no client privilege); the rows are exactly those of the
-- notifications_select policy, with the permission array read once.
-- plpgsql, so the cursor is resolved into variables first: the row comparison is then an index
-- bound on notifications_org_created_idx (a coalesce() in the query would stay a filter and a
-- deep page would scan the org). `is_read` is looked up after the limit, for the page's rows
-- only; the unread-only list needs it before (an anti-join, within 90 days).
create function public.list_my_notifications(
  p_before timestamptz default null,
  p_limit int default 20,
  p_importance text default null,
  p_unread_only boolean default false,
  p_before_id uuid default null
)
returns table (
  id uuid,
  module_key text,
  kind text,
  importance text,
  title text,
  body text,
  link_path text,
  subject_type text,
  subject_id uuid,
  created_at timestamptz,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := private.current_user_org_id();
  v_keys text[];
  -- No cursor: (infinity, max uuid).
  v_before timestamptz := coalesce(p_before, 'infinity');
  v_before_id uuid := coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if p_before is not null and p_before_id is null then
    raise exception 'Un curseur de pagination doit comprendre p_before et p_before_id' using errcode = '22023';
  end if;
  if v_org is null then
    return;
  end if;
  v_keys := private.current_permission_keys();

  if coalesce(p_unread_only, false) then
    return query
    select n.id, n.module_key, n.kind, n.importance, n.title, n.body, n.link_path, n.subject_type,
           n.subject_id, n.created_at, false
      from public.notifications n
     where n.org_id = v_org
       and (n.created_at, n.id) < (v_before, v_before_id)
       and n.created_at > pg_catalog.now() - interval '90 days'
       and n.recipient_permission = any (v_keys)
       and (n.recipient_user_id is null or n.recipient_user_id = v_uid)
       and (n.expires_at is null or n.expires_at > pg_catalog.now())
       and (p_importance is null or n.importance = p_importance)
       and not exists (select 1 from public.notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)
     order by n.created_at desc, n.id desc
     limit v_limit;
  else
    return query
    select x.id, x.module_key, x.kind, x.importance, x.title, x.body, x.link_path, x.subject_type,
           x.subject_id, x.created_at, rd.hit is not null
      from (select n.*
              from public.notifications n
             where n.org_id = v_org
               and (n.created_at, n.id) < (v_before, v_before_id)
               and n.recipient_permission = any (v_keys)
               and (n.recipient_user_id is null or n.recipient_user_id = v_uid)
               and (n.expires_at is null or n.expires_at > pg_catalog.now())
               and (p_importance is null or n.importance = p_importance)
             order by n.created_at desc, n.id desc
             limit v_limit) x
      -- One primary-key probe per row of the page (an EXISTS here may become a hashed subplan
      -- that reads all of the caller's read rows).
      left join lateral (select true as hit from public.notification_reads r
                          where r.notification_id = x.id and r.user_id = v_uid
                          limit 1) rd on true
     order by x.created_at desc, x.id desc;
  end if;
end;
$$;

-- The bell's dot: unread notices of the last 90 days (bounded), and how many are important.
-- Definer (notification_reads has no client privilege), with the policy's predicate.
create function public.count_my_unread_notifications()
returns table (total int, important int)
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::int,
         (pg_catalog.count(*) filter (where n.importance = 'important'))::int
    from public.notifications n
   where n.org_id = (select private.current_user_org_id())
     and n.created_at > pg_catalog.now() - interval '90 days'
     and n.recipient_permission = any ((select private.current_permission_keys())::text[])
     and (n.recipient_user_id is null or n.recipient_user_id = (select auth.uid()))
     and (n.expires_at is null or n.expires_at > pg_catalog.now())
     and not exists (select 1 from public.notification_reads r
                      where r.notification_id = n.id and r.user_id = (select auth.uid()))
$$;

-- Marks the given notices read for the caller, at most 200 per call. Ids the caller cannot
-- see (the policy's predicate, re-checked here) are ignored.
create function public.mark_notifications_read(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := private.current_user_org_id();
  v_keys text[];
begin
  if pg_catalog.cardinality(p_ids) > 200 then
    raise exception 'Au plus 200 notifications à la fois' using errcode = '22023';
  end if;
  if v_org is null or p_ids is null then
    return;
  end if;
  v_keys := private.current_permission_keys();

  insert into public.notification_reads (notification_id, user_id, org_id)
  select n.id, v_uid, v_org
    from public.notifications n
   where n.id = any (p_ids)
     and n.org_id = v_org
     and n.recipient_permission = any (v_keys)
     and (n.recipient_user_id is null or n.recipient_user_id = v_uid)
     and (n.expires_at is null or n.expires_at > pg_catalog.now())
  on conflict do nothing;
end;
$$;

-- Marks every notice the caller can see as read (« Tout marquer comme lu »).
create function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := private.current_user_org_id();
  v_keys text[];
begin
  if v_org is null then
    return;
  end if;
  v_keys := private.current_permission_keys();

  insert into public.notification_reads (notification_id, user_id, org_id)
  select n.id, v_uid, v_org
    from public.notifications n
   where n.org_id = v_org
     and n.recipient_permission = any (v_keys)
     and (n.recipient_user_id is null or n.recipient_user_id = v_uid)
     and (n.expires_at is null or n.expires_at > pg_catalog.now())
     and not exists (select 1 from public.notification_reads r
                      where r.notification_id = n.id and r.user_id = v_uid)
  on conflict do nothing;
end;
$$;

revoke all on function
  public.list_my_notifications(timestamptz, int, text, boolean, uuid),
  public.count_my_unread_notifications(),
  public.mark_notifications_read(uuid[]),
  public.mark_all_notifications_read()
from public, anon, authenticated, service_role;
grant execute on function
  public.list_my_notifications(timestamptz, int, text, boolean, uuid),
  public.count_my_unread_notifications(),
  public.mark_notifications_read(uuid[]),
  public.mark_all_notifications_read()
to authenticated;
-- service_role is revoked above: these act for the calling user (auth.uid()).

-- -----------------------------------------------------------------------------
-- Retention (private.run_sql_job, Task 3.3)
-- -----------------------------------------------------------------------------
-- Deletes notices older than 12 months, or expired more than 30 days ago, in batches of 5 000:
-- each DELETE (and its cascade to the read rows) stays bounded. The batches do not bound the
-- transaction: private.run_sql_job runs the whole purge in one, so its locks last until it
-- ends; they are on rows nothing else writes (old or long expired).
create function private.job_notifications_purge()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_batch bigint;
  v_total bigint := 0;
begin
  loop
    delete from public.notifications n
     where n.id in (select x.id from public.notifications x
                     where x.created_at < pg_catalog.now() - interval '12 months'
                        or x.expires_at < pg_catalog.now() - interval '30 days'
                     limit 5000);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < 5000;
  end loop;
  return 'deleted=' || v_total;
end;
$$;

revoke all on function private.job_notifications_purge() from public, anon, authenticated, service_role;

insert into public.scheduled_jobs
  (key, module_key, label, description, kind, sql_function, cron_job_name, is_maintenance)
values
  ('core.notifications_purge', 'core', 'Nettoyage des notifications',
   'Supprime les notifications de plus de 12 mois et celles échues depuis plus de 30 jours.',
   'sql', 'private.job_notifications_purge', 'core.notifications_purge', true)
on conflict do nothing;

select cron.schedule('core.notifications_purge', '0 9 * * *',
  $$select private.run_sql_job('core.notifications_purge')$$);
