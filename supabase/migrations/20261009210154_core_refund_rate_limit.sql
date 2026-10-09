-- Core: one allowed rate-limit hit given back (service role only).
--
-- `places` (address suggestions) consumes the caller's own limit, then the clinic's ceiling. When
-- the clinic's refuses, the caller's hit was already counted: a refused call spent the person's
-- own quota. Checking the clinic first would be worse: a person past
-- their own limit would keep spending the clinic's. So the caller's limit stays first, and a
-- clinic refusal gives the caller's hit back with `refund_rate_limit` (_shared/rate-limit.ts
-- `refund`).
--
-- * The hit is taken off the CURRENT window of (bucket, key): a refund that lands just after the
--   window turned takes it off the new window, or finds no row (one hit of slack, harmless).
-- * Never below zero, and never a new row: a refund for a key with no hit is a no-op.
-- * The same argument checks as consume_rate_limit (22023). Service role only, like it; an
--   operational log table, so no audit (*_core_rate_limits_webhook_events.sql).

create function public.refund_rate_limit(p_bucket text, p_key_hash bytea, p_window_seconds int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window interval;
begin
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_.]{0,62}$'
     or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_key_hash is null or pg_catalog.length(p_key_hash) <> 32 then
    raise exception 'Arguments invalides.' using errcode = '22023';
  end if;
  v_window := pg_catalog.make_interval(secs => p_window_seconds);
  update public.rate_limits r
     set hits = r.hits - 1
   where r.bucket = p_bucket
     and r.key_hash = p_key_hash
     and r.window_start = pg_catalog.date_bin(v_window, pg_catalog.now(), timestamptz '2000-01-01 00:00:00+00')
     and r.hits > 0;
end;
$$;

revoke all on function public.refund_rate_limit(text, bytea, int) from public, anon, authenticated;
grant execute on function public.refund_rate_limit(text, bytea, int) to service_role;
