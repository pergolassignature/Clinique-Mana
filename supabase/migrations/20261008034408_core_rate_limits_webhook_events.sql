-- =============================================================================
-- Rate limits and the shared webhook claim
-- =============================================================================
-- Design:  docs/plans/2026-10-08-phase-3-shared-services-design.md §2.6, §2.7, §3.2
-- Plan:    docs/plans/2026-10-08-phase-3-shared-services-plan.md, Task 3.2
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Both tables are operational logs: no client privilege, no audit trigger (listed in
--   000_invariants' exception list, conventions §12). Edge functions reach them through
--   service-role RPCs only (_shared/rate-limit.ts, _shared/webhooks.ts).
-- * Rate-limit keys are HMAC-hashed by the caller: no raw IP or address is stored. Fixed
--   windows (date_bin): a burst of 2×max at a window boundary is accepted.
-- * A webhook delivery is claimed under a lease (PS Hub claim_contract_webhook_event): a new
--   event, a failed one, or one whose lease lapsed is claimed with a fresh token; only the
--   token holder can complete or fail it. Completion clears the payload; a failure keeps it
--   for the retry and records an error code, never free text (no PII).
-- * The org comes from a database row resolved by the caller, never from the payload; an
--   event id already held by another org is refused.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rate limits
-- -----------------------------------------------------------------------------
create table public.rate_limits (
  bucket text not null check (bucket ~ '^[a-z][a-z0-9_.]{0,62}$'),
  key_hash bytea not null check (pg_catalog.length(key_hash) = 32),
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (bucket, key_hash, window_start)
);
-- Serves the hourly cleanup (Task 3.3, core.rate_limits_cleanup).
create index rate_limits_window_start_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Records one hit for (bucket, key) in the current fixed window and says whether it is allowed.
create function public.consume_rate_limit(p_bucket text, p_key_hash bytea, p_max int, p_window_seconds int)
returns table (allowed boolean, hits int, retry_after_seconds int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_window interval;
  v_start timestamptz;
  v_hits int;
begin
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_.]{0,62}$'
     or p_max is null or p_max < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_key_hash is null or pg_catalog.length(p_key_hash) <> 32 then
    raise exception 'Invalid rate limit arguments' using errcode = '22023';
  end if;
  v_window := pg_catalog.make_interval(secs => p_window_seconds);
  v_start := pg_catalog.date_bin(v_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00');
  insert into public.rate_limits as r (bucket, key_hash, window_start)
  values (p_bucket, p_key_hash, v_start)
  on conflict (bucket, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return query select v_hits <= p_max, v_hits,
    case when v_hits <= p_max then 0
         else pg_catalog.ceil(extract(epoch from (v_start + v_window - pg_catalog.now())))::int end;
end;
$$;

revoke all on function public.consume_rate_limit(text, bytea, int, int) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, bytea, int, int) to service_role;

-- -----------------------------------------------------------------------------
-- Webhook events
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend', 'documenso')),
  event_id text not null check (pg_catalog.length(event_id) between 1 and 200),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (pg_catalog.length(event_type) between 1 and 100),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  attempts int not null default 1,
  last_error text check (last_error ~ '^[a-z0-9_]{1,64}$'),
  -- Minimised by the caller (ids only); cleared on completion; at most 64 KB (a function body's cap).
  payload jsonb check (payload is null
                       or (pg_catalog.jsonb_typeof(payload) = 'object'
                           and pg_catalog.octet_length(payload::text) <= 65536)),
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
-- Serves the org FK and last_webhook_event_at.
create index webhook_events_org_provider_received_idx
  on public.webhook_events (org_id, provider, received_at desc);
-- Serves the purge (Task 3.3, core.webhook_events_purge).
create index webhook_events_received_at_idx on public.webhook_events (received_at);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;

-- Claims a provider event: 'claimed' (new, failed, or lapsed lease) with a lease token,
-- 'duplicate' (already completed) or 'in_progress' (another delivery holds a live lease).
create function public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_org_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_lease_seconds int default 300
)
returns table (status text, id uuid, claim_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_token uuid;
  v_org uuid;
  v_status text;
begin
  if p_provider is null or p_provider not in ('resend', 'documenso')
     or p_event_id is null or pg_catalog.length(p_event_id) not between 1 and 200
     or p_org_id is null
     or p_event_type is null or pg_catalog.length(p_event_type) not between 1 and 100
     or (p_payload is not null
         and (pg_catalog.jsonb_typeof(p_payload) <> 'object' or pg_catalog.octet_length(p_payload::text) > 65536))
     or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'Invalid webhook claim arguments' using errcode = '22023';
  end if;

  -- 1. A new event.
  insert into public.webhook_events as w
    (provider, event_id, org_id, event_type, payload, claim_token, claimed_at, lease_expires_at)
  values
    (p_provider, p_event_id, p_org_id, p_event_type, p_payload, gen_random_uuid(), pg_catalog.now(),
     pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds))
  on conflict (provider, event_id) do nothing
  returning w.id, w.claim_token into v_id, v_token;
  if v_id is not null then
    return query select 'claimed'::text, v_id, v_token;
    return;
  end if;

  -- 2. A failed event, or one whose lease lapsed, of the same org. A concurrent takeover
  --    re-checks this condition after the row lock, so only one wins.
  update public.webhook_events as w
     set status = 'processing',
         event_type = p_event_type,
         payload = p_payload,
         claim_token = gen_random_uuid(),
         claimed_at = pg_catalog.now(),
         lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
         attempts = w.attempts + 1
   where w.provider = p_provider
     and w.event_id = p_event_id
     and w.org_id = p_org_id
     and (w.status = 'failed' or (w.status = 'processing' and w.lease_expires_at < pg_catalog.now()))
  returning w.id, w.claim_token into v_id, v_token;
  if v_id is not null then
    return query select 'claimed'::text, v_id, v_token;
    return;
  end if;

  -- 3. Otherwise: refused for another org, a duplicate, or held by a live lease.
  select w.org_id, w.status into v_org, v_status
    from public.webhook_events w
   where w.provider = p_provider and w.event_id = p_event_id;
  if found and v_org <> p_org_id then
    raise exception 'Webhook event belongs to another organization' using errcode = '22023';
  end if;
  return query select case when v_status = 'completed' then 'duplicate' else 'in_progress' end, null::uuid, null::uuid;
end;
$$;

-- Marks a claimed event completed and clears its payload; false when the token no longer matches.
create function public.complete_webhook_event(p_id uuid, p_claim_token uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.webhook_events w
     set status = 'completed',
         completed_at = pg_catalog.now(),
         payload = null,
         claim_token = null,
         lease_expires_at = null
   where w.id = p_id
     and w.status = 'processing'
     and w.claim_token = p_claim_token;
  return found;
end;
$$;

-- Marks a claimed event failed with an error code, keeping its payload for the next delivery;
-- false when the token no longer matches.
create function public.fail_webhook_event(p_id uuid, p_claim_token uuid, p_error text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_error is null or p_error !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'Invalid webhook error code' using errcode = '22023';
  end if;
  update public.webhook_events w
     set status = 'failed',
         last_error = p_error,
         claim_token = null,
         lease_expires_at = null
   where w.id = p_id
     and w.status = 'processing'
     and w.claim_token = p_claim_token;
  return found;
end;
$$;

revoke all on function
  public.claim_webhook_event(text, text, uuid, text, jsonb, int),
  public.complete_webhook_event(uuid, uuid),
  public.fail_webhook_event(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.claim_webhook_event(text, text, uuid, text, jsonb, int),
  public.complete_webhook_event(uuid, uuid),
  public.fail_webhook_event(uuid, uuid, text)
to service_role;

-- When the caller's org last received an event from a provider (settings sections show it).
create function public.last_webhook_event_at(p_provider text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('settings.view') then
    raise exception 'Permission refusée : settings.view' using errcode = '42501';
  end if;
  return (select pg_catalog.max(w.received_at)
            from public.webhook_events w
           where w.org_id = private.current_user_org_id()
             and w.provider = p_provider);
end;
$$;

revoke all on function public.last_webhook_event_at(text) from public, anon, authenticated, service_role;
grant execute on function public.last_webhook_event_at(text) to authenticated;
-- service_role is revoked above (Supabase's default privileges grant it EXECUTE):
-- the result is scoped to the calling user's org (auth.uid()).
