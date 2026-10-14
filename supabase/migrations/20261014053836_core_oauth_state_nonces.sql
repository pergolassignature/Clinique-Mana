-- =============================================================================
-- OAuth state nonces: truly single use (security review 2026-10-14)
-- =============================================================================
-- Rules:   docs/standards/database-conventions.md
-- Doc:     docs/modules/core.md, « Rate limits and webhook claims » (OAuth state)
--
-- The OAuth callbacks (gmail, qbo, zoom, google-calendar) spent a state's nonce on a rate-limit
-- bucket of one hit per 600 s (`oauth.state_nonce`). consume_rate_limit uses fixed date_bin
-- windows, so a state spent late in one window could be spent again right after the next window
-- began, while still inside its own 10-minute validity. The nonce is now recorded once, until the
-- state has expired, in its own table.
--
-- Key choices
-- * Operational, like rate_limits: no org_id, no audit trigger, no client privilege (RLS on, no
--   policy). Edge functions reach it only through the service-role RPC below
--   (_shared/oauth-state.ts spendStateNonce).
-- * Only the SHA-256 of the nonce is stored, never the nonce itself.
-- * A row lives until one hour past its state's expiry (a margin for clock skew between the edge
--   runtime that checks the expiry and the database), then the next spend purges it, at most 100
--   rows per call. A purged nonce's state is long expired: verifyState refuses it first.
-- =============================================================================

create table public.oauth_state_nonces (
  nonce_hash bytea primary key check (pg_catalog.length(nonce_hash) = 32),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- Serves the purge.
create index oauth_state_nonces_expires_at_idx on public.oauth_state_nonces (expires_at);

alter table public.oauth_state_nonces enable row level security;
revoke all on public.oauth_state_nonces from anon, authenticated;

-- Spends a state's nonce: true the first time, false for every later call with the same hash
-- (a replayed state). Concurrent spends of one hash serialise on the primary key: exactly one
-- inserts. The expiry must be the state's own (at most one day ahead).
create function public.spend_oauth_state_nonce_for_service(p_nonce_hash bytea, p_expires_at timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if p_nonce_hash is null or pg_catalog.length(p_nonce_hash) <> 32
     or p_expires_at is null or p_expires_at > pg_catalog.now() + interval '1 day' then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;

  delete from public.oauth_state_nonces n
   where n.nonce_hash in (
     select o.nonce_hash from public.oauth_state_nonces o
      where o.expires_at < pg_catalog.now() - interval '1 hour'
      order by o.expires_at
      limit 100
      for update skip locked);

  insert into public.oauth_state_nonces (nonce_hash, expires_at)
  values (p_nonce_hash, p_expires_at)
  on conflict (nonce_hash) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.spend_oauth_state_nonce_for_service(bytea, timestamptz) from public, anon, authenticated;
grant execute on function public.spend_oauth_state_nonce_for_service(bytea, timestamptz) to service_role;
