-- =============================================================================
-- Module Rendez-vous, batch R6: a professional's Google busy times (decisions AP-40 … AP-45)
-- =============================================================================
-- Plan: docs/plans/2026-10-11-modules-coding-plan.md §R6 (« busy shown « Occupé », never a
-- title »); RZ's Zoom connection is the pattern (actor model, tokens apart and encrypted, the
-- reconnect notice), Gmail's Google OAuth client the app (org secrets `google_oauth_client_*`).
--
-- * Opt-in (AP-40): a professional connects her own Google account from « Agenda Google »; the
--   staff never connect one for her. The scopes are `openid email calendar.freebusy` (AP-41): the
--   FreeBusy API answers busy intervals only, so no title, attendee or place ever leaves Google.
-- * `calendar_connections` (state; audited, the address redacted), `calendar_connection_tokens`
--   (encrypted under the current key version, nobody reads the table, listed in
--   `pii_encrypted_values()`), `calendar_sync_status` (when each was last read, the last
--   failure's code) and `external_busy_blocks` (times only): both operational, not audited
--   (written at every sync, every 15 minutes), listed in 000_invariants.
-- * The sync (AP-42): `google-calendar-sync` asks FreeBusy for now → 62 days (the open slots'
--   reach) and replaces the connection's blocks; the job `appointments.google_busy_sync` every 15
--   minutes (off until switched on, like every business job), « Synchroniser » at once.
-- * What it changes (AP-43): `get_open_slots` skips a busy time (so the booking forms, the
--   proposals and the waiting list's offers do); the agenda shows « Occupé » (`list_external_busy`).
--   A staff booking over a busy time is not refused: she may have kept it free on purpose.
-- * A refused grant (AP-44): `needs_reconnect`, her blocks kept until she reconnects or
--   disconnects, one important notice to her. « Déconnecter » (AP-45): revoked at Google (best
--   effort), tokens and blocks deleted.
-- Additive: tables, functions, a job; `create or replace` of `pii_encrypted_values` and
-- `get_open_slots` (same signatures).

select pg_catalog.set_config('app.audit_source', 'migration:appointments_google_busy', true);

-- -----------------------------------------------------------------------------
-- calendar_connections: a professional's Google account (state only; tokens apart)
-- -----------------------------------------------------------------------------
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  provider text not null default 'google',
  state text not null default 'connected',
  external_user_id text,
  account_email text,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  connected_by uuid references public.profiles(user_id) on delete set null,
  disconnected_at timestamptz,
  reconnect_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connections_org_id_id_key unique (org_id, id),
  constraint calendar_connections_professional_key unique (org_id, professional_id, provider),
  constraint calendar_connections_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint calendar_connections_provider_check check (provider = 'google'),
  constraint calendar_connections_state_check check (state in ('connected', 'needs_reconnect', 'disconnected')),
  constraint calendar_connections_reason_check check (
    reconnect_reason is null or reconnect_reason in ('invalid_grant', 'unauthorized', 'scope_missing')),
  constraint calendar_connections_text_check check (
    (external_user_id is null or char_length(external_user_id) <= 255)
    and (account_email is null or char_length(account_email) <= 254))
);
-- One professional per Google account in a clinic, while connected.
create unique index calendar_connections_external_user_idx on public.calendar_connections (org_id, provider, external_user_id)
  where state <> 'disconnected';
create index calendar_connections_connected_by_idx on public.calendar_connections (connected_by);
revoke all on public.calendar_connections from anon, authenticated;
grant select on public.calendar_connections to authenticated;
alter table public.calendar_connections enable row level security;
create policy calendar_connections_select on public.calendar_connections
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and ((select private.has_permission('appointments.view'))
         or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id())))
  );
create trigger calendar_connections_set_updated_at before update on public.calendar_connections
  for each row execute function private.set_updated_at();
create trigger calendar_connections_audit after insert or update or delete on public.calendar_connections
  for each row execute function private.audit_trigger('account_email');

-- -----------------------------------------------------------------------------
-- calendar_connection_tokens: the OAuth tokens, encrypted (conventions §8; nobody reads the table)
-- -----------------------------------------------------------------------------
create table public.calendar_connection_tokens (
  connection_id uuid primary key,
  org_id uuid not null,
  access_token bytea not null,
  refresh_token bytea not null,
  access_token_expires_at timestamptz not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connection_tokens_key_version_check check (key_version >= 1),
  constraint calendar_connection_tokens_connection_fkey foreign key (org_id, connection_id)
    references public.calendar_connections (org_id, id) on delete cascade
);
create index calendar_connection_tokens_org_connection_idx on public.calendar_connection_tokens (org_id, connection_id);
revoke all on public.calendar_connection_tokens from anon, authenticated, service_role;
alter table public.calendar_connection_tokens enable row level security;
-- No policy on purpose: the service RPCs below are the only path.
create trigger calendar_connection_tokens_set_updated_at before update on public.calendar_connection_tokens
  for each row execute function private.set_updated_at();
create trigger calendar_connection_tokens_audit after insert or update or delete on public.calendar_connection_tokens
  for each row execute function private.audit_trigger('access_token', 'refresh_token');

-- -----------------------------------------------------------------------------
-- calendar_sync_status: when each connection was last read, and the last failure's code
-- (operational, not audited: written at every sync, every 15 minutes; nobody reads the table)
-- -----------------------------------------------------------------------------
create table public.calendar_sync_status (
  connection_id uuid primary key,
  org_id uuid not null,
  last_synced_at timestamptz,
  last_sync_error text,
  updated_at timestamptz not null default now(),
  constraint calendar_sync_status_error_check check (last_sync_error is null or last_sync_error ~ '^[a-z0-9_]{1,64}$'),
  constraint calendar_sync_status_connection_fkey foreign key (org_id, connection_id)
    references public.calendar_connections (org_id, id) on delete cascade
);
create index calendar_sync_status_org_connection_idx on public.calendar_sync_status (org_id, connection_id);
revoke all on public.calendar_sync_status from anon, authenticated, service_role;
alter table public.calendar_sync_status enable row level security;
-- No policy on purpose: `get_my_calendar_setup` reads it, the service RPCs write it.
create trigger calendar_sync_status_set_updated_at before update on public.calendar_sync_status
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- external_busy_blocks: her busy times (times only), replaced at each sync
-- -----------------------------------------------------------------------------
create table public.external_busy_blocks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  connection_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint external_busy_blocks_times_check check (ends_at > starts_at),
  constraint external_busy_blocks_connection_fkey foreign key (org_id, connection_id)
    references public.calendar_connections (org_id, id) on delete cascade,
  constraint external_busy_blocks_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade
);
create index external_busy_blocks_professional_idx on public.external_busy_blocks (org_id, professional_id, starts_at);
create index external_busy_blocks_connection_idx on public.external_busy_blocks (org_id, connection_id);
revoke all on public.external_busy_blocks from anon, authenticated;
grant select on public.external_busy_blocks to authenticated;
alter table public.external_busy_blocks enable row level security;
create policy external_busy_blocks_select on public.external_busy_blocks
  for select to authenticated
  using (
    org_id = (select private.current_user_org_id())
    and ((select private.has_permission('appointments.view'))
         or ((select private.has_permission('appointments.self')) and professional_id = (select private.current_professional_id())))
  );

-- -----------------------------------------------------------------------------
-- The actor model (as RZ): the professional of the person connecting
-- -----------------------------------------------------------------------------
create function private.appointments_calendar_actor(p_actor uuid, p_org uuid)
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
    raise exception 'Seul un professionnel de la clinique peut connecter son agenda Google.' using errcode = 'P0001';
  end if;
  return v_professional;
end;
$$;
revoke all on function private.appointments_calendar_actor(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- User RPCs
-- -----------------------------------------------------------------------------
-- « Agenda Google »: the caller's own connection (no row: not connected, or not a professional).
create function public.get_my_calendar_setup()
returns table (professional_id uuid, state text, account_email text, connected_at timestamptz, reconnect_reason text,
               last_synced_at timestamptz, last_sync_error text, busy_count int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_professional uuid := private.current_professional_id();
begin
  if not private.has_permission('appointments.self') then
    raise exception 'Permission refusée : appointments.self' using errcode = '42501';
  end if;
  if v_professional is null then
    return;
  end if;
  return query
    select v_professional, c.state, c.account_email, c.connected_at, c.reconnect_reason, s.last_synced_at, s.last_sync_error,
           (select pg_catalog.count(*)::int from public.external_busy_blocks b
             where b.org_id = v_org and b.connection_id = c.id and b.ends_at > pg_catalog.now())
      from (select 1) one
      left join public.calendar_connections c
        on c.org_id = v_org and c.professional_id = v_professional and c.provider = 'google' and c.state <> 'disconnected'
      left join public.calendar_sync_status s on s.org_id = v_org and s.connection_id = c.id;
end;
$$;
revoke all on function public.get_my_calendar_setup() from public, anon;
grant execute on function public.get_my_calendar_setup() to authenticated;

-- The agenda's « Occupé » (AP-43): the busy times of the professionals asked (null: all the caller
-- may see), between two instants (62 days at most). Staff (appointments.view) for any
-- professional; a professional for herself. Times only.
create function public.list_external_busy(p_from timestamptz, p_to timestamptz, p_professional_ids uuid[] default null)
returns table (professional_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_staff boolean := private.has_permission('appointments.view');
  v_self uuid := private.current_professional_id();
begin
  if not (v_staff or private.has_permission('appointments.self')) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'Choisissez une période de 62 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  return query
    select b.professional_id, b.starts_at, b.ends_at
      from public.external_busy_blocks b
     where b.org_id = v_org
       and b.starts_at < p_to and b.ends_at > p_from
       and (p_professional_ids is null or b.professional_id = any (p_professional_ids))
       and (v_staff or b.professional_id = v_self)
     order by b.starts_at;
end;
$$;
revoke all on function public.list_external_busy(timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.list_external_busy(timestamptz, timestamptz, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Service RPCs (the functions: google-calendar-connect, -callback, -sync)
-- -----------------------------------------------------------------------------
-- Stores (or reconnects) the actor's Google account: `connected`, its tokens encrypted under the
-- current key version. P0001 when this Google account is connected for another professional.
create function public.store_calendar_connection(
  p_actor uuid, p_org_id uuid, p_external_user_id text, p_account_email text,
  p_access_token text, p_refresh_token text, p_access_token_expires_at timestamptz, p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional uuid := private.appointments_calendar_actor(p_actor, p_org_id);
  v_email text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, ''))), '');
  v_id uuid;
  v_previous uuid;
  v_version integer;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_access_token_expires_at is null
     or coalesce(p_external_user_id, '') = '' or pg_catalog.char_length(p_external_user_id) > 255
     or (v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or pg_catalog.char_length(v_email) > 254)) then
    raise exception 'Invalid connection' using errcode = '22023';
  end if;
  if not public.module_enabled_for_org(p_org_id, 'appointments') then
    raise exception 'Le module Rendez-vous n''est pas activé.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.calendar_connections c
              where c.org_id = p_org_id and c.provider = 'google' and c.external_user_id = p_external_user_id
                and c.state <> 'disconnected' and c.professional_id <> v_professional) then
    raise exception 'Ce compte Google est déjà connecté pour un autre professionnel de la clinique.' using errcode = 'P0001';
  end if;

  perform pg_catalog.set_config('app.audit_source', 'rpc:store_calendar_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);

  -- Another Google account than the one connected before: its busy times go.
  select c.id into v_previous from public.calendar_connections c
   where c.org_id = p_org_id and c.professional_id = v_professional and c.provider = 'google'
     and c.external_user_id is distinct from p_external_user_id;
  if v_previous is not null then
    delete from public.external_busy_blocks b where b.org_id = p_org_id and b.connection_id = v_previous;
    delete from public.calendar_sync_status s where s.org_id = p_org_id and s.connection_id = v_previous;
  end if;

  begin
  insert into public.calendar_connections as c
    (org_id, professional_id, provider, state, external_user_id, account_email, scopes, connected_at, connected_by)
  values (p_org_id, v_professional, 'google', 'connected', p_external_user_id, v_email, coalesce(p_scopes, '{}'), pg_catalog.now(), p_actor)
  on conflict (org_id, professional_id, provider) do update
    set state = 'connected', external_user_id = excluded.external_user_id, account_email = excluded.account_email,
        scopes = excluded.scopes, connected_at = pg_catalog.now(), connected_by = p_actor,
        disconnected_at = null, reconnect_reason = null
  returning c.id into v_id;
  exception when unique_violation then
    raise exception 'Ce compte Google est déjà connecté pour un autre professionnel de la clinique.' using errcode = 'P0001';
  end;

  v_version := private.pii_current_key_version();
  insert into public.calendar_connection_tokens as t (connection_id, org_id, access_token, refresh_token, access_token_expires_at, key_version)
  values (v_id, p_org_id, private.encrypt_pii(p_access_token, v_version), private.encrypt_pii(p_refresh_token, v_version),
          p_access_token_expires_at, v_version)
  on conflict (connection_id) do update
    set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        access_token_expires_at = excluded.access_token_expires_at, key_version = excluded.key_version;

  -- Connected again: the last failure is over (the next sync says how it went).
  update public.calendar_sync_status s set last_sync_error = null
   where s.org_id = p_org_id and s.connection_id = v_id and s.last_sync_error is not null;

  perform private.expire_notifications(p_org_id, 'calendar_connection', v_id, array['appointments.google_calendar_reconnect']);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return v_id;
end;
$$;
revoke all on function public.store_calendar_connection(uuid, uuid, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.store_calendar_connection(uuid, uuid, text, text, text, text, timestamptz, text[]) to service_role;

-- The actor's live connection and its tokens (« Déconnecter » revokes them first; « Synchroniser »).
create function public.get_my_calendar_credentials_for_service(p_actor uuid, p_org_id uuid)
returns table (connection_id uuid, state text, access_token text, refresh_token text, access_token_expires_at timestamptz, connected_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional uuid := private.appointments_calendar_actor(p_actor, p_org_id);
begin
  return query
    select c.id, c.state, private.decrypt_pii(t.access_token, t.key_version), private.decrypt_pii(t.refresh_token, t.key_version),
           t.access_token_expires_at, c.connected_at
      from public.calendar_connections c
      join public.calendar_connection_tokens t on t.org_id = c.org_id and t.connection_id = c.id
     where c.org_id = p_org_id and c.professional_id = v_professional and c.provider = 'google' and c.state <> 'disconnected';
end;
$$;
revoke all on function public.get_my_calendar_credentials_for_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_my_calendar_credentials_for_service(uuid, uuid) to service_role;

-- « Déconnecter » (the function revoked the grant at Google first): `disconnected`, tokens and busy
-- times deleted. False when nothing was connected.
create function public.disconnect_my_calendar_connection(p_actor uuid, p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_professional uuid := private.appointments_calendar_actor(p_actor, p_org_id);
  v_id uuid;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  select c.id into v_id from public.calendar_connections c
   where c.org_id = p_org_id and c.professional_id = v_professional and c.provider = 'google' and c.state <> 'disconnected';
  if v_id is null then
    return false;
  end if;
  perform pg_catalog.set_config('app.audit_source', 'rpc:disconnect_my_calendar_connection', true);
  perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
  update public.calendar_connections c set state = 'disconnected', disconnected_at = pg_catalog.now() where c.id = v_id;
  delete from public.calendar_connection_tokens t where t.org_id = p_org_id and t.connection_id = v_id;
  delete from public.external_busy_blocks b where b.org_id = p_org_id and b.connection_id = v_id;
  delete from public.calendar_sync_status s where s.org_id = p_org_id and s.connection_id = v_id;
  perform private.expire_notifications(p_org_id, 'calendar_connection', v_id, array['appointments.google_calendar_reconnect']);
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
  perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  return true;
end;
$$;
revoke all on function public.disconnect_my_calendar_connection(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disconnect_my_calendar_connection(uuid, uuid) to service_role;

-- A connection's tokens (the job's one reader). No row for another clinic's, or once disconnected.
create function public.get_calendar_credentials_for_service(p_org_id uuid, p_connection_id uuid)
returns table (state text, professional_id uuid, access_token text, refresh_token text, access_token_expires_at timestamptz, connected_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select c.state, c.professional_id, private.decrypt_pii(t.access_token, t.key_version), private.decrypt_pii(t.refresh_token, t.key_version),
         t.access_token_expires_at, c.connected_at
    from public.calendar_connections c
    join public.calendar_connection_tokens t on t.org_id = c.org_id and t.connection_id = c.id
   where c.org_id = p_org_id and c.id = p_connection_id
$$;
revoke all on function public.get_calendar_credentials_for_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_calendar_credentials_for_service(uuid, uuid) to service_role;

-- A refreshed access token (Google keeps the refresh token): re-encrypted under the current
-- version. False when the connection was reconnected since the job read it (`p_connected_at`).
create function public.set_calendar_token_for_service(
  p_org_id uuid, p_connection_id uuid, p_access_token text, p_access_token_expires_at timestamptz, p_connected_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := private.pii_current_key_version();
  v_refresh text;
begin
  if coalesce(p_access_token, '') = '' or p_access_token_expires_at is null then
    raise exception 'A token is required' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:appointments.google_busy_sync', true);
  select private.decrypt_pii(t.refresh_token, t.key_version) into v_refresh
    from public.calendar_connection_tokens t
    join public.calendar_connections c on c.org_id = t.org_id and c.id = t.connection_id
   where t.org_id = p_org_id and t.connection_id = p_connection_id and c.state <> 'disconnected'
     and c.connected_at is not distinct from p_connected_at;
  if v_refresh is null then
    return false;
  end if;
  update public.calendar_connection_tokens t
     set access_token = private.encrypt_pii(p_access_token, v_version), refresh_token = private.encrypt_pii(v_refresh, v_version),
         access_token_expires_at = p_access_token_expires_at, key_version = v_version
   where t.org_id = p_org_id and t.connection_id = p_connection_id;
  return true;
end;
$$;
revoke all on function public.set_calendar_token_for_service(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.set_calendar_token_for_service(uuid, uuid, text, timestamptz, timestamptz) to service_role;

-- Google refused the grant (AP-44): `needs_reconnect`, one important notice to her (and its
-- dedupe per connection). Her busy times stay until she reconnects or disconnects. False when it
-- was not connected, or was reconnected since the job read it.
create function public.mark_calendar_needs_reconnect_for_service(
  p_org_id uuid, p_connection_id uuid, p_reason text, p_connected_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.calendar_connections;
  v_profile uuid;
begin
  if p_reason is null or p_reason not in ('invalid_grant', 'unauthorized', 'scope_missing') then
    raise exception 'Invalid reason' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('app.audit_source', 'job:appointments.google_busy_sync', true);
  update public.calendar_connections c
     set state = 'needs_reconnect', reconnect_reason = p_reason
   where c.org_id = p_org_id and c.id = p_connection_id and c.state = 'connected'
     and c.connected_at is not distinct from p_connected_at
  returning c.* into v_conn;
  if v_conn.id is null then
    return false;
  end if;
  v_profile := private.professional_profile_id(p_org_id, v_conn.professional_id);
  if v_profile is not null and public.module_enabled_for_org(p_org_id, 'appointments') then
    perform private.notify(p_org_id, 'appointments', 'appointments.google_calendar_reconnect', 'important',
      'Reconnectez votre agenda Google',
      'Google refuse l''accès de la clinique à vos disponibilités. Vos plages occupées ne sont plus mises à jour tant que vous ne l''aurez pas reconnecté.',
      '/mon-agenda/agenda-google', 'calendar_connection', v_conn.id, 'appointments.self', v_profile,
      'google_calendar_reconnect:' || v_conn.id || ':' || coalesce(pg_catalog.date_part('epoch', v_conn.connected_at)::bigint::text, '0'));
  end if;
  return true;
end;
$$;
revoke all on function public.mark_calendar_needs_reconnect_for_service(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_calendar_needs_reconnect_for_service(uuid, uuid, text, timestamptz) to service_role;

-- The connections due a sync: connected, never synced or not in the last 10 minutes.
create function public.list_calendar_connections_to_sync_for_service(p_org_id uuid, p_limit int default 20)
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  select c.id from public.calendar_connections c
    left join public.calendar_sync_status s on s.org_id = c.org_id and s.connection_id = c.id
   where c.org_id = p_org_id and c.provider = 'google' and c.state = 'connected'
     and (s.last_synced_at is null or s.last_synced_at < pg_catalog.now() - interval '10 minutes')
   order by s.last_synced_at nulls first, c.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;
revoke all on function public.list_calendar_connections_to_sync_for_service(uuid, int) from public, anon, authenticated;
grant execute on function public.list_calendar_connections_to_sync_for_service(uuid, int) to service_role;

-- A sync's result (AP-42): the connection's busy times between p_from and p_to replaced by
-- p_blocks ([{start, end}], 2 000 at most, each ending after it starts); `last_synced_at` set.
-- Returns how many were stored, or -1 when the connection was reconnected (or ended) since the
-- job read it (nothing changes). A sync that failed records only its code
-- (`p_blocks` null and `p_error`): see `record_calendar_sync_error_for_service`.
create function public.replace_calendar_busy_for_service(
  p_org_id uuid, p_connection_id uuid, p_from timestamptz, p_to timestamptz, p_blocks jsonb, p_connected_at timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.calendar_connections;
  v_count int;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '93 days'
     or p_blocks is null or pg_catalog.jsonb_typeof(p_blocks) <> 'array' or pg_catalog.jsonb_array_length(p_blocks) > 2000 then
    raise exception 'Invalid busy times' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_blocks) x
              where pg_catalog.jsonb_typeof(x) <> 'object'
                 or (x ->> 'start') is null or (x ->> 'end') is null
                 or (x ->> 'end')::timestamptz <= (x ->> 'start')::timestamptz) then
    raise exception 'Invalid busy times' using errcode = '22023';
  end if;
  select c.* into v_conn from public.calendar_connections c
   where c.org_id = p_org_id and c.id = p_connection_id and c.state = 'connected'
     and c.connected_at is not distinct from p_connected_at
   for update;
  if v_conn.id is null then
    return -1;
  end if;
  delete from public.external_busy_blocks b
   where b.org_id = p_org_id and b.connection_id = p_connection_id and b.starts_at < p_to and b.ends_at > p_from;
  insert into public.external_busy_blocks (org_id, professional_id, connection_id, starts_at, ends_at)
  select p_org_id, v_conn.professional_id, p_connection_id, greatest((x ->> 'start')::timestamptz, p_from), least((x ->> 'end')::timestamptz, p_to)
    from pg_catalog.jsonb_array_elements(p_blocks) x
   where (x ->> 'end')::timestamptz > p_from and (x ->> 'start')::timestamptz < p_to;
  get diagnostics v_count = row_count;
  -- Busy times before the window are history: dropped.
  delete from public.external_busy_blocks b where b.org_id = p_org_id and b.connection_id = p_connection_id and b.ends_at <= p_from;
  insert into public.calendar_sync_status as s (connection_id, org_id, last_synced_at, last_sync_error)
  values (p_connection_id, p_org_id, pg_catalog.now(), null)
  on conflict (connection_id) do update set last_synced_at = excluded.last_synced_at, last_sync_error = null;
  return v_count;
end;
$$;
revoke all on function public.replace_calendar_busy_for_service(uuid, uuid, timestamptz, timestamptz, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.replace_calendar_busy_for_service(uuid, uuid, timestamptz, timestamptz, jsonb, timestamptz) to service_role;

-- A sync that failed for a passing reason (Google down, a timeout): its code, the blocks kept.
create function public.record_calendar_sync_error_for_service(p_org_id uuid, p_connection_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error is null or p_error !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Invalid error code' using errcode = '22023';
  end if;
  insert into public.calendar_sync_status as s (connection_id, org_id, last_sync_error)
  select c.id, c.org_id, p_error from public.calendar_connections c
   where c.org_id = p_org_id and c.id = p_connection_id and c.state <> 'disconnected'
  on conflict (connection_id) do update set last_sync_error = excluded.last_sync_error
   where s.last_sync_error is distinct from excluded.last_sync_error;
end;
$$;
revoke all on function public.record_calendar_sync_error_for_service(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_calendar_sync_error_for_service(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- The job (AP-42): every 15 minutes, off until switched on
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('appointments.google_busy_sync', 'appointments', 'Plages occupées des agendas Google',
   'Lit les plages occupées (jamais les titres) des professionnels qui ont connecté leur agenda Google, pour les 62 prochains jours, et les retire des créneaux offerts. Toutes les 15 minutes.',
   'function', 'google-calendar-sync', null, 'appointments.google_busy_sync', null, false)
on conflict do nothing;
select cron.schedule('appointments.google_busy_sync', '*/15 * * * *',
  $$select private.invoke_job_function('appointments.google_busy_sync')$$);

-- The list of encrypted columns (conventions §8): the two calendar token columns added (same signature, grants and contract).
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
  union all
  select 'calendar_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.calendar_connection_tokens t
  union all
  select 'calendar_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.calendar_connection_tokens t  union all
  select 'qbo_connection_tokens'::text, 'access_token'::text, t.connection_id::text, t.key_version::integer, t.access_token
    from public.qbo_connection_tokens t
  union all
  select 'qbo_connection_tokens'::text, 'refresh_token'::text, t.connection_id::text, t.key_version::integer, t.refresh_token
    from public.qbo_connection_tokens t
$$;
-- Open slots skip a professional's Google busy times (AP-43).
create or replace function public.get_open_slots(p_professional_id uuid, p_service_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_tz text := private.appointments_tz(v_org);
  v_pro record;
  v_service record;
  v_slot interval;
  v_length interval;
begin
  if not (private.has_permission('appointments.view')
          or (private.has_permission('appointments.self') and p_professional_id = private.current_professional_id())) then
    raise exception 'Permission refusée : appointments.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choisissez une période de 62 jours au plus.' using errcode = 'P0001', hint = 'period';
  end if;
  select * into v_pro from private.appointments_professional(v_org, p_professional_id);
  select * into v_service from private.appointments_service(v_org, p_service_id, v_pro.title_ids, true);
  v_length := pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_slot := pg_catalog.make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes);
  return query
    select s.starts_at, s.starts_at + v_length
      from (select distinct ((d.day + r.start_time) at time zone v_tz) + k.n * v_slot as starts_at,
                   r.end_time, r.overflow_allowed, d.day
              from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d0(ts)
             cross join lateral (select d0.ts::date as day) d
              join public.availability_rules r
                on r.org_id = v_org and r.professional_id = p_professional_id
               and r.weekday = extract(isodow from d.day)::smallint
               and d.day >= r.valid_from and (r.valid_until is null or d.day <= r.valid_until)
               and (pg_catalog.cardinality(r.service_ids) = 0 or p_service_id = any (r.service_ids))
             cross join lateral pg_catalog.generate_series(
                   0, pg_catalog.ceil(extract(epoch from (r.end_time - r.start_time)) / extract(epoch from v_slot))::int) as k(n)) s
     where ((s.starts_at at time zone v_tz)::date = s.day)
       and ((s.starts_at + v_length) at time zone v_tz)::date = s.day
       and (case when s.overflow_allowed then (s.starts_at at time zone v_tz)::time < s.end_time
                 else ((s.starts_at + v_length) at time zone v_tz)::time <= s.end_time end)
       and s.starts_at >= now()
       and not exists (select 1 from public.availability_exceptions e
                        where e.org_id = v_org and e.professional_id = p_professional_id
                          and pg_catalog.tstzrange(e.starts_at, e.ends_at, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_length, '[)'))
       -- AP-43: her Google busy times (when she connected her agenda).
       and not exists (select 1 from public.external_busy_blocks g
                        where g.org_id = v_org and g.professional_id = p_professional_id
                          and pg_catalog.tstzrange(g.starts_at, g.ends_at, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_length, '[)'))
       and not exists (select 1 from public.appointments a
                        where a.org_id = v_org and a.professional_id = p_professional_id
                          and (a.state <> 'cancelled' or a.kept_on_schedule)
                          and pg_catalog.tstzrange(a.starts_at, a.blocks_until, '[)') && pg_catalog.tstzrange(s.starts_at, s.starts_at + v_slot, '[)'))
     order by s.starts_at;
end;
$$;

select pg_catalog.set_config('app.audit_source', '', true);
