-- =============================================================================
-- Webhook events: `gmail` joins the providers (made for the Communications module, CM1)
-- =============================================================================
-- `gmail-webhook` claims each Pub/Sub push (`<org>:<pubsub message id>`) with
-- `claim_webhook_event`, like the Resend and Documenso webhooks (CLAUDE.md §7): a redelivery of a
-- push already handled is a `duplicate`, a concurrent one `in_progress`. The provider list is a
-- check on the table and a check in the RPC: both gain `gmail`, after *_communications_sms.sql added
-- `yeastar` (kept). The RPC's body is otherwise the one of *_core_rate_limits_webhook_events.sql
-- (create or replace keeps its grants).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:core_webhook_events_gmail_provider', true);

alter table public.webhook_events drop constraint webhook_events_provider_check;
alter table public.webhook_events add constraint webhook_events_provider_check
  check (provider in ('resend', 'documenso', 'gmail', 'yeastar'));

create or replace function public.claim_webhook_event(
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
  if p_provider is null or p_provider not in ('resend', 'documenso', 'gmail', 'yeastar')
     or p_event_id is null or pg_catalog.length(p_event_id) not between 1 and 200
     or p_org_id is null
     or p_event_type is null or pg_catalog.length(p_event_type) not between 1 and 100
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 65536
     or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'Arguments invalides.' using errcode = '22023';
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
    raise exception 'Fournisseur ou événement invalide.' using errcode = '22023';
  end if;
  return query select case when v_status = 'completed' then 'duplicate' else 'in_progress' end, null::uuid, null::uuid;
end;
$$;
