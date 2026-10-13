-- =============================================================================
-- Rendez-vous, batch RZ: video links (Zoom per professional, or a fixed personal link)
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §7 (RZ, RZ.1 – RZ.6)
-- Decisions: R-55 (Zoom or a fixed personal link), RZ-1 … RZ-8 (decisions log)
-- Recipe:    docs/standards/database-conventions.md §8 (encrypted columns), §8b (service RPCs with
--            an actor, catalogues)
--
-- Each professional runs her video meetings one of two ways (R-55, Christine's answer 4: Zoom,
-- Teams or Meet, each paying her own):
-- * **Zoom connected** (`video_connections`, one per professional): the clinic's Zoom app holds an
--   OAuth grant of her account; a meeting is made for each video appointment, moved with it and
--   deleted when it is cancelled. Tokens are encrypted (`video_connection_tokens`, no client and
--   no service-role privilege; the service RPCs below are the only path; listed in
--   `private.pii_encrypted_values()`).
-- * **A fixed personal link** (`professional_video_links`: Meet, Teams, a personal Zoom room…),
--   used whenever Zoom is not connected.
--
-- The appointments never call this batch: a trigger on `appointments` (columns mode, state,
-- starts_at, ends_at, professional_id; inserts) queues a reconcile task (`video_tasks`, one per
-- appointment, its `generation` bumped by each change) and marks a Zoom meeting `pending`. The job
-- `appointments.video_sync` (edge function `appointments-video-sync`, every 5 minutes) claims due
-- tasks, makes the appointment's meeting match what it should be (created, updated, deleted at
-- Zoom) and records it (`complete_video_task`): `appointment_video_meetings` (which account holds
-- the meeting) and the appointment's `video_url` / `video_external_id` / `video_status`. Three
-- failures → `failed` (« Réessayer »). When a meeting is created, the job emails its link to the
-- clients (`appointments.video_link`, once per link).
--
-- The effective link of an appointment (`private.appointment_video_link`, for R4's confirmations
-- and reminders; `get_appointment_video` for the screens): its Zoom meeting when ready, `pending`
-- while one is on its way, else the professional's fixed link, else none.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:appointments_video', true);

-- -----------------------------------------------------------------------------
-- professional_video_links: a professional's fixed link (Meet, Teams, other)
-- -----------------------------------------------------------------------------
create table public.professional_video_links (
  professional_id uuid primary key,
  org_id uuid not null,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint professional_video_links_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_video_links_url_check check (
    char_length(url) <= 500 and url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$')
);
create index professional_video_links_org_professional_idx on public.professional_video_links (org_id, professional_id);
create index professional_video_links_updated_by_idx on public.professional_video_links (updated_by);
create trigger professional_video_links_set_updated_at before update on public.professional_video_links
  for each row execute function private.set_updated_at();
create trigger professional_video_links_audit after insert or update or delete on public.professional_video_links
  for each row execute function private.audit_trigger('url');

-- -----------------------------------------------------------------------------
-- video_connections: a professional's Zoom account (state only; tokens apart)
-- -----------------------------------------------------------------------------
create table public.video_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  provider text not null default 'zoom',
  state text not null default 'connected',
  external_user_id text,
  external_account_id text,
  account_email text,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  connected_by uuid references public.profiles(user_id) on delete set null,
  disconnected_at timestamptz,
  reconnect_reason text,
  tokens_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_connections_org_id_id_key unique (org_id, id),
  constraint video_connections_professional_key unique (org_id, professional_id, provider),
  constraint video_connections_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint video_connections_provider_check check (provider = 'zoom'),
  constraint video_connections_state_check check (state in ('connected', 'needs_reconnect', 'disconnected')),
  constraint video_connections_reason_check check (
    reconnect_reason is null or reconnect_reason in ('invalid_grant', 'unauthorized', 'deauthorized')),
  constraint video_connections_text_check check (
    (external_user_id is null or char_length(external_user_id) <= 64)
    and (external_account_id is null or char_length(external_account_id) <= 64)
    and (account_email is null or char_length(account_email) <= 254))
);
-- One professional per Zoom account in a clinic, while connected.
create unique index video_connections_external_user_idx on public.video_connections (org_id, provider, external_user_id)
  where state <> 'disconnected';
create index video_connections_connected_by_idx on public.video_connections (connected_by);
create trigger video_connections_set_updated_at before update on public.video_connections
  for each row execute function private.set_updated_at();
create trigger video_connections_audit after insert or update or delete on public.video_connections
  for each row execute function private.audit_trigger('account_email');

-- -----------------------------------------------------------------------------
-- video_connection_tokens: the OAuth tokens, encrypted (conventions §8; nobody reads the table)
-- -----------------------------------------------------------------------------
create table public.video_connection_tokens (
  connection_id uuid primary key,
  org_id uuid not null,
  access_token bytea not null,
  refresh_token bytea not null,
  access_token_expires_at timestamptz not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_connection_tokens_key_version_check check (key_version >= 1),
  constraint video_connection_tokens_connection_fkey foreign key (org_id, connection_id)
    references public.video_connections (org_id, id) on delete cascade
);
create index video_connection_tokens_org_connection_idx on public.video_connection_tokens (org_id, connection_id);
revoke all on public.video_connection_tokens from anon, authenticated, service_role;
alter table public.video_connection_tokens enable row level security;
-- No policy on purpose: the service RPCs below are the only path.
create trigger video_connection_tokens_set_updated_at before update on public.video_connection_tokens
  for each row execute function private.set_updated_at();
create trigger video_connection_tokens_audit after insert or update or delete on public.video_connection_tokens
  for each row execute function private.audit_trigger('access_token', 'refresh_token');

-- The list of encrypted columns (conventions §8): the two token columns added. Same signature,
-- grants (none) and contract as *_core_pii_key_versions.sql.
create or replace function private.pii_encrypted_values()
returns table (table_name text, column_name text, row_key text, key_version integer, ciphertext bytea)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'organization_bank_details'::text, 'account_number'::text, b.org_id::text, b.key_version::integer, b.account_number
    from public.organization_bank_details b
   where b.account_number is not null
  union all
  select 'professional_private'::text, 'sin'::text, p.professional_id::text, p.key_version::integer, p.sin
    from public.professional_private p
   where p.sin is not null
  union all
  select 'professional_private'::text, 'bank_account'::text, p.professional_id::text, p.key_version::integer, p.bank_account
    from public.professional_private p
   where p.bank_account is not null
  union all
  select 'professional_submission_private'::text, 'sin'::text, s.submission_id::text, s.key_version::integer, s.sin
    from public.professional_submission_private s
   where s.sin is not null
  union all
  select 'professional_submission_private'::text, 'bank_account'::text, s.submission_id::text, s.key_version::integer, s.bank_account
    from public.professional_submission_private s
   where s.bank_account is not null
  union all
  select 'mail_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.mail_connection_tokens t
  union all
  select 'mail_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.mail_connection_tokens t
  union all
  select 'video_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.video_connection_tokens t
  union all
  select 'video_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.video_connection_tokens t
$$;

-- -----------------------------------------------------------------------------
-- appointment_video_meetings: the Zoom meeting of an appointment and the account holding it
-- -----------------------------------------------------------------------------
create table public.appointment_video_meetings (
  appointment_id uuid primary key,
  org_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  join_url text not null,
  -- The link last emailed to the clients (`appointments.video_link`): one email per link.
  emailed_join_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_video_meetings_appointment_fkey foreign key (org_id, appointment_id)
    references public.appointments (org_id, id) on delete cascade,
  constraint appointment_video_meetings_connection_fkey foreign key (org_id, connection_id)
    references public.video_connections (org_id, id) on delete cascade,
  constraint appointment_video_meetings_text_check check (
    char_length(external_id) between 1 and 64
    and char_length(join_url) <= 1000 and join_url ~ '^https://'
    and (emailed_join_url is null or char_length(emailed_join_url) <= 1000))
);
create index appointment_video_meetings_org_appointment_idx on public.appointment_video_meetings (org_id, appointment_id);
create index appointment_video_meetings_org_connection_idx on public.appointment_video_meetings (org_id, connection_id);
create trigger appointment_video_meetings_set_updated_at before update on public.appointment_video_meetings
  for each row execute function private.set_updated_at();
create trigger appointment_video_meetings_audit after insert or update or delete on public.appointment_video_meetings
  for each row execute function private.audit_trigger('join_url', 'emailed_join_url');

-- -----------------------------------------------------------------------------
-- video_tasks: one reconcile task per appointment (the queue of the sync job)
-- -----------------------------------------------------------------------------
create table public.video_tasks (
  appointment_id uuid primary key,
  org_id uuid not null,
  -- Bumped by each change of the appointment: a task completed for an older generation stays due.
  generation int not null default 1,
  state text not null default 'pending',
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_tasks_appointment_fkey foreign key (org_id, appointment_id)
    references public.appointments (org_id, id) on delete cascade,
  constraint video_tasks_state_check check (state in ('pending', 'done', 'failed')),
  constraint video_tasks_attempts_check check (attempts between 0 and 100),
  constraint video_tasks_error_check check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_]{1,64}$')
);
create index video_tasks_org_appointment_idx on public.video_tasks (org_id, appointment_id);
create index video_tasks_due_idx on public.video_tasks (org_id, next_attempt_at) where state = 'pending';
create trigger video_tasks_set_updated_at before update on public.video_tasks
  for each row execute function private.set_updated_at();
create trigger video_tasks_audit after insert or update or delete on public.video_tasks
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- RLS and grants: select only (every write is an RPC); tokens: nothing
-- -----------------------------------------------------------------------------
alter table public.professional_video_links enable row level security;
alter table public.video_connections enable row level security;
alter table public.appointment_video_meetings enable row level security;
alter table public.video_tasks enable row level security;

revoke all on public.professional_video_links, public.video_connections, public.appointment_video_meetings,
  public.video_tasks from anon, authenticated;
grant select on public.professional_video_links, public.video_connections, public.appointment_video_meetings,
  public.video_tasks to authenticated;

-- Staff see every professional's video setup; a professional her own.
create policy professional_video_links_select on public.professional_video_links
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view'))
              or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id()))));

create policy video_connections_select on public.video_connections
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view'))
              or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id()))));

-- A meeting and its task are visible with their appointment (its own policy).
create policy appointment_video_meetings_select on public.appointment_video_meetings
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view')) or (select private.has_permission('appointments.self')))
         and exists (select 1 from public.appointments a where a.id = appointment_id));

create policy video_tasks_select on public.video_tasks
  for select to authenticated
  using (org_id = (select private.current_user_org_id())
         and ((select private.has_permission('appointments.view')) or (select private.has_permission('appointments.self')))
         and exists (select 1 from public.appointments a where a.id = appointment_id));

-- -----------------------------------------------------------------------------
-- Helpers (private, granted to no role)
-- -----------------------------------------------------------------------------
-- The professional's connected Zoom account, when this appointment should have a meeting: a
-- future, active (booked or confirmed) video appointment with a client (not personal).
create function private.appointment_video_target(
  p_org uuid, p_professional uuid, p_mode text, p_state text, p_is_personal boolean, p_starts_at timestamptz)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id from public.video_connections c
   where c.org_id = p_org and c.professional_id = p_professional and c.provider = 'zoom' and c.state = 'connected'
     and p_mode = 'video' and p_state in ('booked', 'confirmed') and not coalesce(p_is_personal, false)
     and p_starts_at > pg_catalog.now()
$$;
revoke all on function private.appointment_video_target(uuid, uuid, text, text, boolean, timestamptz)
  from public, anon, authenticated, service_role;

-- Queues (or re-queues) the reconcile task of an appointment.
create function private.appointment_video_request(p_org uuid, p_appointment uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.video_tasks as t (appointment_id, org_id)
  values (p_appointment, p_org)
  on conflict (appointment_id) do update
    set generation = t.generation + 1, state = 'pending', attempts = 0,
        next_attempt_at = pg_catalog.now(), last_error_code = null
$$;
revoke all on function private.appointment_video_request(uuid, uuid) from public, anon, authenticated, service_role;

-- Re-queues every future active video appointment of a professional (a connection, a reconnection).
create function private.appointment_video_requeue_professional(p_org uuid, p_professional uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in select a.id from public.appointments a
            where a.org_id = p_org and a.professional_id = p_professional and a.mode = 'video'
              and a.state in ('booked', 'confirmed') and not a.is_personal and a.starts_at > pg_catalog.now() loop
    perform private.appointment_video_request(p_org, r.id);
    v_count := v_count + 1;
  end loop;
  update public.appointments a
     set video_status = 'pending'
   where a.org_id = p_org and a.professional_id = p_professional and a.mode = 'video'
     and a.state in ('booked', 'confirmed') and not a.is_personal and a.starts_at > pg_catalog.now()
     and a.video_url is null and a.video_status is distinct from 'pending';
  return v_count;
end;
$$;
revoke all on function private.appointment_video_requeue_professional(uuid, uuid) from public, anon, authenticated, service_role;

-- Forgets a connection's meetings of future appointments (it was disconnected: they cannot be
-- managed any more). Their appointments fall back to the fixed link.
create function private.appointment_video_forget_connection(p_org uuid, p_connection uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.appointments a
     set video_url = null, video_external_id = null, video_status = null
    from public.appointment_video_meetings m
   where m.org_id = p_org and m.connection_id = p_connection and a.id = m.appointment_id and a.org_id = p_org
     and a.starts_at > pg_catalog.now();
  delete from public.appointment_video_meetings m
   using public.appointments a
   where m.org_id = p_org and m.connection_id = p_connection and a.id = m.appointment_id
     and a.starts_at > pg_catalog.now();
  get diagnostics v_count = row_count;
  -- Appointments still waiting for a meeting of this professional: no meeting will come.
  update public.appointments a
     set video_status = null
    from public.video_connections c
   where c.org_id = p_org and c.id = p_connection and a.org_id = p_org and a.professional_id = c.professional_id
     and a.video_status = 'pending' and a.video_url is null;
  update public.video_tasks t
     set state = 'done', locked_until = null
    from public.video_connections c, public.appointments a
   where c.org_id = p_org and c.id = p_connection and a.org_id = p_org and a.professional_id = c.professional_id
     and t.appointment_id = a.id and t.state <> 'done'
     and not exists (select 1 from public.appointment_video_meetings m where m.appointment_id = a.id);
  return v_count;
end;
$$;
revoke all on function private.appointment_video_forget_connection(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The trigger: an appointment's change queues its reconcile task
-- -----------------------------------------------------------------------------
-- BEFORE: the status the change implies (a meeting on its way, or none any more). A move keeps the
-- link (Zoom moves the meeting, its address stays); another professional takes a new one. A
-- completed appointment keeps everything (its history).
create function private.appointments_video_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  if new.state = 'completed' then
    return new;
  end if;
  v_target := private.appointment_video_target(new.org_id, new.professional_id, new.mode, new.state, new.is_personal, new.starts_at);
  if tg_op = 'UPDATE' and new.professional_id is distinct from old.professional_id then
    new.video_url := null;
    new.video_external_id := null;
    new.video_status := null;
  end if;
  if v_target is not null then
    if new.video_url is null then
      new.video_status := 'pending';
    end if;
  elsif new.state = 'cancelled' or new.mode <> 'video' then
    -- No meeting any more (the job deletes it at Zoom).
    new.video_url := null;
    new.video_external_id := null;
    new.video_status := null;
  end if;
  return new;
end;
$$;
revoke all on function private.appointments_video_status() from public, anon, authenticated, service_role;

-- AFTER: the task, when a meeting should exist or one does.
create function private.appointments_video_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'completed' then
    return null;
  end if;
  if private.appointment_video_target(new.org_id, new.professional_id, new.mode, new.state, new.is_personal, new.starts_at) is not null
     or exists (select 1 from public.appointment_video_meetings m where m.appointment_id = new.id) then
    perform private.appointment_video_request(new.org_id, new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.appointments_video_queue() from public, anon, authenticated, service_role;

create trigger appointments_video_status
  before insert or update of mode, state, starts_at, ends_at, professional_id on public.appointments
  for each row execute function private.appointments_video_status();
create trigger appointments_video_queue
  after insert or update of mode, state, starts_at, ends_at, professional_id on public.appointments
  for each row execute function private.appointments_video_queue();

-- -----------------------------------------------------------------------------
-- Published: the effective link of an appointment
-- -----------------------------------------------------------------------------
-- (url, source, status): the Zoom meeting when ready (`zoom`, `ready`); `zoom`, `pending` while one
-- is on its way (say « le lien vous sera envoyé »: the job emails it); `zoom`, `failed` after three
-- failures (« Réessayer »); else the professional's fixed link (`fixed`, `ready`); else
-- (null, null, `none`). Phone, personal and cancelled appointments: `none`. For R4's confirmations
-- and reminders and the screens; granted to no role (definer callers after their own check).
create function private.appointment_video_link(p_org uuid, p_appointment uuid)
returns table (url text, source text, status text)
language sql
stable
set search_path = ''
as $$
  select case when a.video_status = 'ready' and a.video_url is not null then a.video_url
              when a.video_status in ('pending', 'failed') then null
              else l.url end,
         case when a.video_status is not null then 'zoom'
              when l.url is not null then 'fixed' end,
         case when a.video_status = 'ready' and a.video_url is not null then 'ready'
              when a.video_status in ('pending', 'failed') then a.video_status
              when l.url is not null then 'ready'
              else 'none' end
    from public.appointments a
    left join public.professional_video_links l on l.org_id = a.org_id and l.professional_id = a.professional_id
   where a.org_id = p_org and a.id = p_appointment
     and a.mode = 'video' and not a.is_personal and a.state <> 'cancelled'
  union all
  select null, null, 'none'
    from public.appointments a
   where a.org_id = p_org and a.id = p_appointment
     and not (a.mode = 'video' and not a.is_personal and a.state <> 'cancelled')
$$;
revoke all on function private.appointment_video_link(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Client RPCs
-- -----------------------------------------------------------------------------
-- The fixed link of a professional (`appointments.manage`, or `.self` for her own). A blank url
-- removes it. Only an https address; the clinic's Zoom connection, when there is one, wins.
create function public.set_professional_video_link(p_professional_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_url text := nullif(pg_catalog.btrim(coalesce(p_url, ''), E' \t\r\n'), '');
begin
  if not private.appointments_can_act(p_professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if not exists (select 1 from private.professional_booking_facts(v_org, p_professional_id)) then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001', hint = 'professional_id';
  end if;
  if v_url is null then
    delete from public.professional_video_links l where l.org_id = v_org and l.professional_id = p_professional_id;
    return;
  end if;
  if pg_catalog.char_length(v_url) > 500 then
    raise exception 'Le lien est trop long (500 caractères au plus).' using errcode = 'P0001', hint = 'url';
  end if;
  if v_url !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception 'Entrez l''adresse complète du lien, qui commence par https:// (par exemple https://meet.google.com/abc-defg-hij).'
      using errcode = 'P0001', hint = 'url';
  end if;
  insert into public.professional_video_links as l (professional_id, org_id, url, updated_by)
  values (p_professional_id, v_org, v_url, auth.uid())
  on conflict (professional_id) do update
    set url = excluded.url, updated_by = excluded.updated_by
    where l.url is distinct from excluded.url;
end;
$$;
revoke all on function public.set_professional_video_link(uuid, text) from public, anon;
grant execute on function public.set_professional_video_link(uuid, text) to authenticated;

-- Each professional's video setup: staff (`appointments.view`) every professional with a
-- connection or a fixed link; a professional (`.self`) her own row. The Zoom address is shown to
-- both (the account the meetings go to); the tokens never.
create function public.list_professional_video_status()
returns table (professional_id uuid, zoom_state text, zoom_email text, zoom_connected_at timestamptz,
               zoom_reconnect_reason text, fixed_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('appointments.view');
  v_own uuid := case when private.has_permission('appointments.self') then private.current_professional_id() end;
begin
  if not v_staff and v_own is null then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  return query
    with pros as (
      select c.professional_id from public.video_connections c where c.org_id = v_org
      union
      select l.professional_id from public.professional_video_links l where l.org_id = v_org
    )
    select p.professional_id, c.state, c.account_email, c.connected_at, c.reconnect_reason, l.url
      from pros p
      left join public.video_connections c on c.org_id = v_org and c.professional_id = p.professional_id and c.provider = 'zoom'
      left join public.professional_video_links l on l.org_id = v_org and l.professional_id = p.professional_id
     where v_staff or p.professional_id = v_own
     order by p.professional_id;
end;
$$;
revoke all on function public.list_professional_video_status() from public, anon;
grant execute on function public.list_professional_video_status() to authenticated;

-- The caller's own video setup (« Vidéoconférence » in her space): whether she is a professional of
-- the clinic, her Zoom connection and her fixed link.
create function public.get_my_video_setup()
returns table (professional_id uuid, zoom_state text, zoom_email text, zoom_connected_at timestamptz,
               zoom_reconnect_reason text, fixed_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_own uuid := private.current_professional_id();
begin
  if not private.has_permission('appointments.self') then
    raise exception 'Permission refusée : appointments.self' using errcode = '42501';
  end if;
  if v_own is null then
    return;
  end if;
  return query
    select v_own, c.state, c.account_email, c.connected_at, c.reconnect_reason, l.url
      from (select 1) one
      left join public.video_connections c on c.org_id = v_org and c.professional_id = v_own and c.provider = 'zoom'
      left join public.professional_video_links l on l.org_id = v_org and l.professional_id = v_own;
end;
$$;
revoke all on function public.get_my_video_setup() from public, anon;
grant execute on function public.get_my_video_setup() to authenticated;

-- The effective link of an appointment the caller may see (its own policy's rule: staff with
-- `appointments.view` but a personal one; a professional her own). Null row when not visible.
create function public.get_appointment_video(p_appointment_id uuid)
returns table (url text, source text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not (private.has_permission('appointments.view') or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.appointments a
     where a.org_id = v_org and a.id = p_appointment_id
       and ((private.has_permission('appointments.view') and not a.is_personal)
            or (private.has_permission('appointments.self') and a.professional_id = private.current_professional_id()))) then
    return;
  end if;
  return query select v.url, v.source, v.status from private.appointment_video_link(v_org, p_appointment_id) v;
end;
$$;
revoke all on function public.get_appointment_video(uuid) from public, anon;
grant execute on function public.get_appointment_video(uuid) to authenticated;

-- « Réessayer »: a failed meeting is tried again at the next run of the job.
create function public.retry_appointment_video(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_appt public.appointments;
begin
  select a.* into v_appt from public.appointments a where a.org_id = v_org and a.id = p_appointment_id;
  if v_appt.id is null or v_appt.is_personal and not (private.has_permission('appointments.self')
                                                      and v_appt.professional_id = private.current_professional_id()) then
    raise exception 'Rendez-vous introuvable.' using errcode = 'P0001', hint = 'appointment_id';
  end if;
  if not private.appointments_can_act(v_appt.professional_id) then
    raise exception 'Permission refusée : appointments.manage' using errcode = '42501';
  end if;
  if v_appt.video_status is distinct from 'failed' then
    raise exception 'Le lien de ce rendez-vous n''est pas en échec.' using errcode = 'P0001', hint = 'video_status';
  end if;
  perform private.appointment_video_request(v_org, p_appointment_id);
  update public.appointments a set video_status = 'pending' where a.id = p_appointment_id and a.org_id = v_org;
end;
$$;
revoke all on function public.retry_appointment_video(uuid) from public, anon;
grant execute on function public.retry_appointment_video(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Service RPCs: the connection's life (zoom-connect, zoom-callback, zoom-deauthorize)
-- -----------------------------------------------------------------------------
-- The actor's professional: an active member of p_org holding appointments.self (the function
-- verified it; re-checked here, conventions §8b), linked to a professional of the clinic.
create function private.appointments_actor_professional(p_actor uuid, p_org uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_professional uuid;
begin
  if p_actor is null or p_org is null
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org and p.status = 'active')
     or not ('appointments.self' = any (private.permission_keys_for(p_actor))) then
    raise exception 'Permission refusée : appointments.self' using errcode = '42501';
  end if;
  v_professional := private.professional_for_profile(p_org, p_actor);
  if v_professional is null then
    raise exception 'Seul un professionnel de la clinique peut connecter son compte Zoom.' using errcode = 'P0001';
  end if;
  return v_professional;
end;
$$;
revoke all on function private.appointments_actor_professional(uuid, uuid) from public, anon, authenticated, service_role;

-- The actor's Zoom connection: its id and its tokens (to revoke them before « Déconnecter »).
-- No row when she has no live connection.
create function public.get_my_zoom_credentials_for_service(p_actor uuid, p_org_id uuid)
returns table (connection_id uuid, access_token text, refresh_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional uuid := private.appointments_actor_professional(p_actor, p_org_id);
begin
  return query
    select c.id, private.decrypt_pii(t.access_token, t.key_version), private.decrypt_pii(t.refresh_token, t.key_version)
      from public.video_connections c
      join public.video_connection_tokens t on t.org_id = c.org_id and t.connection_id = c.id
     where c.org_id = p_org_id and c.professional_id = v_professional and c.provider = 'zoom'
       and c.state <> 'disconnected';
end;
$$;
revoke all on function public.get_my_zoom_credentials_for_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_my_zoom_credentials_for_service(uuid, uuid) to service_role;

-- Stores (or reconnects) the actor's Zoom account: the connection (`connected`), its tokens
-- encrypted under the current key version, and every future video appointment of hers queued for
-- a meeting. P0001 when this Zoom account is connected for another professional of the clinic.
create function public.store_zoom_connection(
  p_actor uuid, p_org_id uuid, p_external_user_id text, p_external_account_id text, p_account_email text,
  p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz, p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional uuid := private.appointments_actor_professional(p_actor, p_org_id);
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, ''))), '');
  v_id uuid;
  v_version integer;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null
     or coalesce(p_external_user_id, '') = '' or pg_catalog.char_length(p_external_user_id) > 64
     or pg_catalog.char_length(coalesce(p_external_account_id, '')) > 64
     or (v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or pg_catalog.char_length(v_email) > 254)) then
    raise exception 'Invalid connection' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'appointments') then
    raise exception 'Le module Rendez-vous n''est pas activé.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.video_connections c
              where c.org_id = p_org_id and c.provider = 'zoom' and c.external_user_id = p_external_user_id
                and c.state <> 'disconnected' and c.professional_id <> v_professional) then
    raise exception 'Ce compte Zoom est déjà connecté pour un autre professionnel de la clinique.' using errcode = 'P0001';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:store_zoom_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  -- Another Zoom account than the one connected before: the old account's meetings cannot be
  -- managed with the new grant; they are forgotten (re-made on the new account below).
  select c.id into v_id from public.video_connections c
   where c.org_id = p_org_id and c.professional_id = v_professional and c.provider = 'zoom'
     and c.external_user_id is distinct from p_external_user_id;
  if v_id is not null then
    perform private.appointment_video_forget_connection(p_org_id, v_id);
  end if;

  begin
  insert into public.video_connections as c
    (org_id, professional_id, provider, state, external_user_id, external_account_id, account_email, scopes,
     connected_at, connected_by, tokens_refreshed_at)
  values (p_org_id, v_professional, 'zoom', 'connected', p_external_user_id, nullif(p_external_account_id, ''), v_email,
          coalesce(p_scopes, '{}'), pg_catalog.now(), p_actor, pg_catalog.now())
  on conflict (org_id, professional_id, provider) do update
    set state = 'connected', external_user_id = excluded.external_user_id,
        external_account_id = excluded.external_account_id, account_email = excluded.account_email,
        scopes = excluded.scopes, connected_at = pg_catalog.now(), connected_by = p_actor,
        disconnected_at = null, reconnect_reason = null, tokens_refreshed_at = pg_catalog.now()
  returning c.id into v_id;
  exception when unique_violation then
    -- The same Zoom account connected for another professional at the same moment.
    raise exception 'Ce compte Zoom est déjà connecté pour un autre professionnel de la clinique.' using errcode = 'P0001';
  end;

  v_version := private.pii_current_key_version();
  insert into public.video_connection_tokens as t (connection_id, org_id, access_token, refresh_token, access_token_expires_at, key_version)
  values (v_id, p_org_id, private.encrypt_pii(p_access_token, v_version), private.encrypt_pii(p_refresh_token, v_version),
          p_access_token_expires_at, v_version)
  on conflict (connection_id) do update
    set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        access_token_expires_at = excluded.access_token_expires_at, key_version = excluded.key_version;

  -- « À reconnecter » is over.
  perform private.expire_notifications(p_org_id, 'video_connection', v_id, array['appointments.zoom_reconnect']);
  perform private.appointment_video_requeue_professional(p_org_id, v_professional);

  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_id;
end;
$$;
revoke all on function public.store_zoom_connection(uuid, uuid, text, text, text, text, text, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.store_zoom_connection(uuid, uuid, text, text, text, text, text, timestamptz, text[]) to service_role;

-- Ends a connection: `disconnected` (with a reason for a deauthorization), tokens deleted, the
-- meetings of future appointments forgotten (their appointments fall back to the fixed link).
create function private.appointment_video_disconnect(p_org uuid, p_connection uuid, p_reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.video_connections c
     set state = 'disconnected', disconnected_at = pg_catalog.now(), reconnect_reason = p_reason
   where c.org_id = p_org and c.id = p_connection and c.state <> 'disconnected';
  if not found then
    return false;
  end if;
  delete from public.video_connection_tokens t where t.org_id = p_org and t.connection_id = p_connection;
  perform private.appointment_video_forget_connection(p_org, p_connection);
  perform private.expire_notifications(p_org, 'video_connection', p_connection, array['appointments.zoom_reconnect']);
  return true;
end;
$$;
revoke all on function private.appointment_video_disconnect(uuid, uuid, text) from public, anon, authenticated, service_role;

-- « Déconnecter » (the function revoked the grant at Zoom first). False when nothing was connected.
create function public.disconnect_my_zoom_connection(p_actor uuid, p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional uuid := private.appointments_actor_professional(p_actor, p_org_id);
  v_id uuid;
  v_done boolean;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  select c.id into v_id from public.video_connections c
   where c.org_id = p_org_id and c.professional_id = v_professional and c.provider = 'zoom';
  if v_id is null then
    return false;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:disconnect_my_zoom_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  v_done := private.appointment_video_disconnect(p_org_id, v_id, null);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_done;
end;
$$;
revoke all on function public.disconnect_my_zoom_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_my_zoom_connection(uuid, uuid) to service_role;

-- Zoom's « app deauthorized » (the person removed the app from her Zoom account): the clinic's
-- connection of that Zoom user ends with the reason `deauthorized`, and the professional and the
-- staff are told. Returns the number of connections ended (0: not ours, or already ended).
create function public.zoom_deauthorized_for_service(p_org_id uuid, p_external_user_id text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  r record;
begin
  perform pg_catalog.set_config('app.audit_source', 'webhook:zoom', true);
  for r in select c.id, c.professional_id from public.video_connections c
            where c.org_id = p_org_id and c.provider = 'zoom' and c.external_user_id = p_external_user_id
              and c.state <> 'disconnected' loop
    if private.appointment_video_disconnect(p_org_id, r.id, 'deauthorized') then
      v_count := v_count + 1;
      perform private.appointment_video_notify_reconnect(p_org_id, r.id, 'deauthorized');
    end if;
  end loop;
  return v_count;
end;
$$;

-- The notices of a connection that must be redone: the professional (important) and the staff.
create function private.appointment_video_notify_reconnect(p_org uuid, p_connection uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conn public.video_connections;
  v_profile uuid;
  v_dedupe text;
begin
  select c.* into v_conn from public.video_connections c where c.org_id = p_org and c.id = p_connection;
  if v_conn.id is null or not public.module_enabled_for_org(p_org, 'appointments') then
    return;
  end if;
  v_profile := private.professional_profile_id(p_org, v_conn.professional_id);
  v_dedupe := 'zoom_reconnect:' || v_conn.id || ':' || coalesce(pg_catalog.date_part('epoch', v_conn.connected_at)::bigint::text, '0');
  if v_profile is not null and exists (select 1 from public.profiles p where p.user_id = v_profile and p.org_id = p_org and p.status = 'active') then
    perform private.notify(p_org, 'appointments', 'appointments.zoom_reconnect', 'important',
      case when p_reason = 'deauthorized' then 'Votre Zoom a été déconnecté'
           else 'Reconnectez votre Zoom' end,
      case when p_reason = 'deauthorized'
           then 'L''application de la clinique a été retirée de votre compte Zoom. Vos prochains rendez-vous en vidéo utiliseront votre lien fixe, s''il y en a un. Reconnectez Zoom pour que chaque rendez-vous ait de nouveau son lien.'
           else 'Zoom refuse l''accès de la clinique à votre compte. Les nouveaux rendez-vous en vidéo n''auront pas de lien Zoom tant que vous ne l''aurez pas reconnecté.' end,
      '/mon-agenda/videoconference', 'video_connection', v_conn.id, 'appointments.self', v_profile, v_dedupe || ':self');
  end if;
  perform private.notify(p_org, 'appointments', 'appointments.zoom_reconnect', 'normal',
    'Un professionnel doit reconnecter son Zoom',
    'Ses nouveaux rendez-vous en vidéo n''ont pas de lien Zoom tant qu''il ne l''a pas reconnecté. La liste est dans Paramètres → Vidéoconférence.',
    '/parametres/videoconference', 'video_connection', v_conn.id, 'appointments.manage', null, v_dedupe || ':staff');
end;
$$;
revoke all on function private.appointment_video_notify_reconnect(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.zoom_deauthorized_for_service(uuid, text) from public, anon, authenticated;
grant execute on function public.zoom_deauthorized_for_service(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Service RPCs: the job (appointments-video-sync)
-- -----------------------------------------------------------------------------
-- A connection's tokens (the job's one reader). No row for a connection that is not p_org's or
-- has no tokens (disconnected).
create function public.get_zoom_credentials_for_service(p_org_id uuid, p_connection_id uuid)
returns table (state text, access_token text, refresh_token text, access_token_expires_at timestamptz, connected_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select c.state, private.decrypt_pii(t.access_token, t.key_version), private.decrypt_pii(t.refresh_token, t.key_version),
         t.access_token_expires_at, c.connected_at
    from public.video_connections c
    join public.video_connection_tokens t on t.org_id = c.org_id and t.connection_id = c.id
   where c.org_id = p_org_id and c.id = p_connection_id
$$;
revoke all on function public.get_zoom_credentials_for_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_zoom_credentials_for_service(uuid, uuid) to service_role;

-- New tokens after a refresh (Zoom rotates the refresh token too): both re-encrypted under the
-- current version. False when the connection has no tokens any more, or was connected again since
-- the job read it (`p_connected_at`: the new grant's tokens are kept).
create function public.set_zoom_tokens_for_service(
  p_org_id uuid, p_connection_id uuid, p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz,
  p_connected_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := private.pii_current_key_version();
begin
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null then
    raise exception 'Tokens are required' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:appointments.video_sync', true);
  update public.video_connection_tokens t
     set access_token = private.encrypt_pii(p_access_token, v_version),
         refresh_token = private.encrypt_pii(p_refresh_token, v_version),
         access_token_expires_at = p_access_token_expires_at, key_version = v_version
   where t.org_id = p_org_id and t.connection_id = p_connection_id
     and exists (select 1 from public.video_connections c
                  where c.org_id = p_org_id and c.id = p_connection_id and c.state = 'connected'
                    and c.connected_at is not distinct from p_connected_at);
  if not found then
    return false;
  end if;
  update public.video_connections c set tokens_refreshed_at = pg_catalog.now()
   where c.org_id = p_org_id and c.id = p_connection_id;
  return true;
end;
$$;
revoke all on function public.set_zoom_tokens_for_service(uuid, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.set_zoom_tokens_for_service(uuid, uuid, text, text, timestamptz, timestamptz) to service_role;

-- Zoom refused the grant (`invalid_grant`, or a 401 that a fresh token does not cure): the
-- connection is `needs_reconnect` (its meetings stay: their links still work), the professional
-- and the staff are told once per connection. False when it was not connected, or was connected
-- again since the job read it (`p_connected_at`).
create function public.mark_zoom_needs_reconnect_for_service(
  p_org_id uuid, p_connection_id uuid, p_reason text, p_connected_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('invalid_grant', 'unauthorized') then
    raise exception 'Invalid reason' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:appointments.video_sync', true);
  update public.video_connections c
     set state = 'needs_reconnect', reconnect_reason = p_reason
   where c.org_id = p_org_id and c.id = p_connection_id and c.state = 'connected'
     and c.connected_at is not distinct from p_connected_at;
  if not found then
    return false;
  end if;
  perform private.appointment_video_notify_reconnect(p_org_id, p_connection_id, p_reason);
  return true;
end;
$$;
revoke all on function public.mark_zoom_needs_reconnect_for_service(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_zoom_needs_reconnect_for_service(uuid, uuid, text, timestamptz) to service_role;

-- The connections whose tokens were last refreshed more than 20 hours ago: the job refreshes them
-- (Zoom's refresh token lapses after 90 days unused; a revoked grant shows within a day).
create function public.list_zoom_connections_to_refresh_for_service(p_org_id uuid, p_limit int default 20)
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  select c.id from public.video_connections c
   where c.org_id = p_org_id and c.provider = 'zoom' and c.state = 'connected'
     and (c.tokens_refreshed_at is null or c.tokens_refreshed_at < pg_catalog.now() - interval '20 hours')
   order by c.tokens_refreshed_at nulls first
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.list_zoom_connections_to_refresh_for_service(uuid, int) from public, anon, authenticated;
grant execute on function public.list_zoom_connections_to_refresh_for_service(uuid, int) to service_role;

-- Claims up to p_limit due tasks (pending, their next attempt reached, not held), holding them 3
-- minutes, with what the job needs to reconcile each: whether the appointment wants a video meeting
-- (`wants_video`: active, video, not personal), whether it has `started` (its meeting is then left
-- as it is: never moved or deleted under a session), on which connection a meeting can be made or
-- moved (`target_connection_id`: her connected Zoom, for a future appointment, else null), the
-- existing meeting, its connection's state and professional, the times.
create function public.claim_video_tasks_for_service(p_org_id uuid, p_limit int default 10)
returns table (appointment_id uuid, generation int, attempts smallint, wants_video boolean, started boolean,
               target_connection_id uuid, professional_id uuid, starts_at timestamptz, ends_at timestamptz, timezone text,
               meeting_connection_id uuid, meeting_connection_state text, meeting_professional_id uuid,
               meeting_external_id text, meeting_join_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with due as (
      select t.appointment_id from public.video_tasks t
       where t.org_id = p_org_id and t.state = 'pending' and t.next_attempt_at <= pg_catalog.now()
         and (t.locked_until is null or t.locked_until < pg_catalog.now())
       order by t.next_attempt_at
       limit least(greatest(coalesce(p_limit, 10), 1), 50)
       for update skip locked
    ), claimed as (
      update public.video_tasks t set locked_until = pg_catalog.now() + interval '3 minutes'
        from due where t.appointment_id = due.appointment_id
      returning t.appointment_id, t.generation, t.attempts
    )
    select c.appointment_id, c.generation, c.attempts,
           (a.mode = 'video' and a.state in ('booked', 'confirmed') and not a.is_personal),
           a.starts_at <= pg_catalog.now(),
           private.appointment_video_target(a.org_id, a.professional_id, a.mode, a.state, a.is_personal, a.starts_at),
           a.professional_id, a.starts_at, a.ends_at, private.appointments_tz(a.org_id),
           m.connection_id, vc.state, vc.professional_id, m.external_id, m.join_url
      from claimed c
      join public.appointments a on a.id = c.appointment_id and a.org_id = p_org_id
      left join public.appointment_video_meetings m on m.appointment_id = c.appointment_id
      left join public.video_connections vc on vc.org_id = m.org_id and vc.id = m.connection_id;
end;
$$;
revoke all on function public.claim_video_tasks_for_service(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_video_tasks_for_service(uuid, int) to service_role;

-- The outcome of a claimed task. The meeting as it now is (`p_connection_id` / `p_external_id` /
-- `p_join_url`, all null: no meeting) is recorded whatever the error: a deletion that succeeded
-- before a creation failed stays recorded. `p_error_code` null: done, unless the appointment changed
-- since the claim (its generation moved: due again at once). An error: the next attempt after 2, 8
-- then `failed` at the third (`video_status = 'failed'`, « Réessayer »); `needs_reconnect` waits
-- for the reconnection (which re-queues). Returns whether the clients should be emailed the link
-- (a meeting of a future active appointment whose link was not emailed yet).
create function public.complete_video_task_for_service(
  p_org_id uuid, p_appointment_id uuid, p_generation int,
  p_connection_id uuid, p_external_id text, p_join_url text, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.video_tasks;
  v_appt public.appointments;
  v_attempts int;
  v_wanted boolean;
begin
  if (p_external_id is null) <> (p_join_url is null) or (p_external_id is null) <> (p_connection_id is null)
     or (p_join_url is not null and (p_join_url !~ '^https://' or pg_catalog.char_length(p_join_url) > 1000))
     or (p_external_id is not null and pg_catalog.char_length(p_external_id) not between 1 and 64)
     or (p_error_code is not null and p_error_code !~ '^[A-Za-z0-9_]{1,64}$') then
    raise exception 'Invalid outcome' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:appointments.video_sync', true);
  select t.* into v_task from public.video_tasks t
   where t.org_id = p_org_id and t.appointment_id = p_appointment_id for update;
  select a.* into v_appt from public.appointments a
   where a.org_id = p_org_id and a.id = p_appointment_id for update;
  if v_task.appointment_id is null or v_appt.id is null then
    return false;
  end if;
  v_wanted := private.appointment_video_target(v_appt.org_id, v_appt.professional_id, v_appt.mode, v_appt.state,
                                               v_appt.is_personal, v_appt.starts_at) is not null;

  -- The meeting as it now is.
  if p_external_id is null then
    delete from public.appointment_video_meetings m where m.org_id = p_org_id and m.appointment_id = p_appointment_id;
    if v_appt.state <> 'completed' then
      update public.appointments a
         set video_url = null, video_external_id = null,
             video_status = case when v_wanted then 'pending' end
       where a.id = p_appointment_id
         and (a.video_url is not null or a.video_external_id is not null
              or a.video_status is distinct from case when v_wanted then 'pending' end);
    end if;
  else
    if not exists (select 1 from public.video_connections c where c.org_id = p_org_id and c.id = p_connection_id) then
      raise exception 'Invalid connection' using errcode = '22023';
    end if;
    insert into public.appointment_video_meetings as m (appointment_id, org_id, connection_id, external_id, join_url)
    values (p_appointment_id, p_org_id, p_connection_id, p_external_id, p_join_url)
    on conflict (appointment_id) do update
      set connection_id = excluded.connection_id, external_id = excluded.external_id, join_url = excluded.join_url
      where (m.connection_id, m.external_id, m.join_url) is distinct from (excluded.connection_id, excluded.external_id, excluded.join_url);
    -- Only an active video appointment shows a link (a meeting kept on a cancelled one, waiting
    -- for its deletion, never gives the link back).
    update public.appointments a
       set video_url = p_join_url, video_external_id = p_external_id, video_status = 'ready'
     where a.id = p_appointment_id and a.mode = 'video' and a.state in ('booked', 'confirmed') and not a.is_personal
       and (a.video_url, a.video_external_id, a.video_status) is distinct from (p_join_url, p_external_id, 'ready');
  end if;

  -- The task.
  if p_error_code is null then
    update public.video_tasks t
       set state = case when t.generation = p_generation then 'done' else 'pending' end,
           attempts = 0, last_error_code = null, locked_until = null, next_attempt_at = pg_catalog.now()
     where t.appointment_id = p_appointment_id;
  elsif p_error_code = 'needs_reconnect' then
    -- Waits for the reconnection (store_zoom_connection re-queues); nothing failed for the client.
    update public.video_tasks t
       set state = 'done', last_error_code = p_error_code, locked_until = null
     where t.appointment_id = p_appointment_id;
  else
    v_attempts := v_task.attempts + 1;
    update public.video_tasks t
       set attempts = v_attempts, last_error_code = p_error_code, locked_until = null,
           state = case when v_attempts >= 3 then 'failed' else 'pending' end,
           next_attempt_at = pg_catalog.now() + case when v_attempts = 1 then interval '2 minutes' else interval '8 minutes' end
     where t.appointment_id = p_appointment_id;
    if v_attempts >= 3 and v_wanted and p_external_id is null then
      update public.appointments a set video_status = 'failed' where a.id = p_appointment_id;
    end if;
  end if;

  return p_join_url is not null and v_appt.state in ('booked', 'confirmed') and v_appt.starts_at > pg_catalog.now()
     and exists (select 1 from public.appointment_video_meetings m
                  where m.appointment_id = p_appointment_id and m.emailed_join_url is distinct from p_join_url);
end;
$$;
revoke all on function public.complete_video_task_for_service(uuid, uuid, int, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_video_task_for_service(uuid, uuid, int, uuid, text, text, text) to service_role;

-- Who receives « Votre lien de rencontre » for an appointment, and what the email says: each
-- client's contacts for appointments (Clients' `client_contacts_for`) with an address, once per
-- address, in the contact's language. No row: nothing to send.
create function public.video_link_email_for_service(p_org_id uuid, p_appointment_id uuid)
returns table (email text, first_name text, language text, clinic_name text, professional_name text,
               starts_at timestamptz, join_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select distinct on (pg_catalog.lower(c.email))
           c.email, c.first_name, case when c.language = 'en' then 'en' else 'fr' end,
           o.name, (select n.display_name from private.professional_display_names(a.org_id, array[a.professional_id]) n), a.starts_at, m.join_url
      from public.appointments a
      join public.appointment_video_meetings m on m.appointment_id = a.id
      join public.organizations o on o.id = a.org_id
      join public.appointment_participants ap on ap.appointment_id = a.id and ap.org_id = a.org_id
      cross join lateral private.client_contacts_for(a.org_id, ap.client_id, 'appointments') c
     where a.org_id = p_org_id and a.id = p_appointment_id
       and a.state in ('booked', 'confirmed') and a.starts_at > pg_catalog.now()
       and nullif(pg_catalog.btrim(coalesce(c.email, '')), '') is not null
     order by pg_catalog.lower(c.email), c.is_self desc;
end;
$$;
revoke all on function public.video_link_email_for_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.video_link_email_for_service(uuid, uuid) to service_role;

-- The link was emailed (or there was nobody to email): not sent again for this link.
create function public.mark_video_link_emailed_for_service(p_org_id uuid, p_appointment_id uuid, p_join_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.appointment_video_meetings m
     set emailed_join_url = p_join_url
   where m.org_id = p_org_id and m.appointment_id = p_appointment_id and m.join_url = p_join_url
     and m.emailed_join_url is distinct from p_join_url
$$;
revoke all on function public.mark_video_link_emailed_for_service(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_video_link_emailed_for_service(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Catalogues: the job, the email, the notice
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('appointments.video_sync', 'appointments', 'Liens Zoom des rendez-vous',
   'Crée, déplace et supprime les réunions Zoom des rendez-vous en vidéo des professionnels qui ont connecté Zoom, envoie leur lien aux clients et garde les connexions actives. Toutes les 5 minutes.',
   'function', 'appointments-video-sync', null, 'appointments.video_sync', null, false)
on conflict do nothing;

select cron.schedule('appointments.video_sync', '*/5 * * * *',
  $$select private.invoke_job_function('appointments.video_sync')$$);

insert into public.email_template_defaults
  (key, module_key, label, description, why_line, subject, body, button_label, variables, view_permission)
values
  ('appointments.video_link', 'appointments',
   'Lien de la rencontre en vidéo',
   'Envoyé au client quand le lien Zoom de son rendez-vous en vidéo est prêt (ou change de professionnel).',
   'Vous recevez ce courriel parce que vous avez un rendez-vous en vidéo avec la clinique.',
   'Votre lien de rencontre — {{clinic.name}}',
   E'Bonjour {{client.first_name}},\n\n'
   'Voici le lien de votre rendez-vous en vidéo avec {{appointment.professional_name}}, le {{appointment.starts_at}}. Gardez ce courriel : le même lien sert jusqu''à la rencontre.',
   'Rejoindre la rencontre',
   '[
     {"path": "client.first_name", "label": "Prénom du client", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "appointment.professional_name", "label": "Nom du professionnel", "sample": "Dominique Exemple", "required": true, "kind": "text"},
     {"path": "appointment.starts_at", "label": "Date et heure du rendez-vous", "sample": "15 octobre 2026 à 14 h 30", "required": true, "kind": "datetime"}
   ]',
   'appointments.view'),
  ('appointments.video_link_en', 'appointments',
   'Lien de la rencontre en vidéo (anglais)',
   'Le même courriel en anglais, pour un client dont la langue est l''anglais.',
   'You receive this email because you have a video appointment with the clinic.',
   'Your meeting link — {{clinic.name}}',
   E'Hello {{client.first_name}},\n\n'
   'Here is the link to your video appointment with {{appointment.professional_name}} on {{appointment.starts_at}}. Keep this email: the same link works until the meeting.',
   'Join the meeting',
   '[
     {"path": "client.first_name", "label": "Prénom du client", "sample": "Camille", "required": true, "kind": "text"},
     {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
     {"path": "appointment.professional_name", "label": "Nom du professionnel", "sample": "Dominique Exemple", "required": true, "kind": "text"},
     {"path": "appointment.starts_at", "label": "Date et heure du rendez-vous", "sample": "October 15, 2026 at 2:30 PM", "required": true, "kind": "datetime"}
   ]',
   'appointments.view')
on conflict do nothing;
