-- =============================================================================
-- Clients: « Demander une nouvelle signature à tous les clients actifs » (batch C5b, part 3: C5b.4)
-- =============================================================================
-- Plan:    docs/plans/2026-10-11-modules-coding-plan.md §6 « C5 » (C5b.4); decisions R-49, CC-20.
-- Needs:   *_clients_consents.sql (consents, requests, the prepare RPC the job sends through),
--          *_core_scheduled_jobs.sql, *_core_module_testers.sql (P3-40).
-- Rules:   docs/standards/database-conventions.md; CLAUDE.md §6–§7; P3-40.
--
-- Key choices
-- * A campaign (`client_consent_campaigns`) asks every active file whose consent in force for one
--   consent is not the version published now (an older version, or GOrendezvous's) to sign again:
--   one item per file (`client_consent_campaign_items`), its consent flagged « À signer de
--   nouveau » at the start (R-49's flag, as « tous les clients actifs » at publishing). A file with
--   a request already out is left out. One running campaign per consent.
-- * The sends: the job `clients.consent_campaign` (function `clients-consent-campaign`, daily at 9 h
--   clinic time, **off by default** like every business job) takes at most **100 a day per clinic**
--   (the queued items, oldest first) and sends each through the same path as « Envoyer »
--   (`prepare_client_consent_request_for_service` with the campaign's author as the actor, then the
--   request email), so every rule of a send applies (who signs, an address, the text published in
--   the client's language). Each item ends `sent` or `failed` (the refusal's HINT kept: `client`,
--   `signer_required`, `signer_email`, `template`…); the campaign is `done` when none is left.
--   An item claimed (`sending`) for over an hour goes back to the queue (a run that died).
-- * P3-40: a campaign cannot start while Clients is reserved for its testers, and the job's batch
--   is empty then (nothing piles up for the launch: the items stay queued, sent once open).
-- * « Arrêter » cancels the campaign: its queued items are `skipped`; what was sent stays.
-- * Read with clients.view (`client_consent_campaigns_summary`: the counts per state); every write
--   is an RPC; both tables audited.
-- * Additive: two tables, a view, four RPCs, a job.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:clients_consent_campaigns', true);

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.client_consent_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  consent_key text not null,
  state text not null default 'running',
  total int not null default 0,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  cancelled_by uuid references public.profiles(user_id) on delete set null,
  constraint client_consent_campaigns_org_id_id_key unique (org_id, id),
  constraint client_consent_campaigns_type_fkey foreign key (org_id, consent_key)
    references public.client_consent_types (org_id, key),
  constraint client_consent_campaigns_state_check check (state in ('running', 'done', 'cancelled')),
  constraint client_consent_campaigns_total_check check (total >= 0),
  constraint client_consent_campaigns_finished_check check ((state = 'running') = (finished_at is null))
);
create unique index client_consent_campaigns_running_idx on public.client_consent_campaigns (org_id, consent_key) where state = 'running';
create index client_consent_campaigns_type_idx on public.client_consent_campaigns (org_id, consent_key);
create index client_consent_campaigns_created_by_idx on public.client_consent_campaigns (created_by);
create index client_consent_campaigns_cancelled_by_idx on public.client_consent_campaigns (cancelled_by);
create trigger client_consent_campaigns_set_updated_at before update on public.client_consent_campaigns
  for each row execute function private.set_updated_at();
create trigger client_consent_campaigns_audit after insert or update or delete on public.client_consent_campaigns
  for each row execute function private.audit_trigger();

create table public.client_consent_campaign_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid not null,
  client_id uuid not null,
  state text not null default 'queued',
  request_id uuid,
  -- The refusal's HINT when it failed (`client`, `signer_email`…): never a person's data.
  failure text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_consent_campaign_items_campaign_fkey foreign key (org_id, campaign_id)
    references public.client_consent_campaigns (org_id, id) on delete cascade,
  constraint client_consent_campaign_items_client_fkey foreign key (org_id, client_id)
    references public.clients (org_id, id) on delete cascade,
  constraint client_consent_campaign_items_request_fkey foreign key (org_id, request_id)
    references public.client_consent_requests (org_id, id) on delete set null (request_id),
  constraint client_consent_campaign_items_unique_key unique (campaign_id, client_id),
  constraint client_consent_campaign_items_state_check check (state in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  constraint client_consent_campaign_items_failure_check check (failure ~ '^[a-z_]{1,40}$')
);
create index client_consent_campaign_items_queue_idx on public.client_consent_campaign_items (org_id, state, created_at)
  where state in ('queued', 'sending');
create index client_consent_campaign_items_org_campaign_idx on public.client_consent_campaign_items (org_id, campaign_id);
create index client_consent_campaign_items_client_idx on public.client_consent_campaign_items (org_id, client_id);
create index client_consent_campaign_items_request_idx on public.client_consent_campaign_items (org_id, request_id);
create trigger client_consent_campaign_items_set_updated_at before update on public.client_consent_campaign_items
  for each row execute function private.set_updated_at();
create trigger client_consent_campaign_items_audit after insert or update or delete on public.client_consent_campaign_items
  for each row execute function private.audit_trigger();

alter table public.client_consent_campaigns enable row level security;
alter table public.client_consent_campaign_items enable row level security;
revoke all on public.client_consent_campaigns, public.client_consent_campaign_items from anon, authenticated;
grant select on public.client_consent_campaigns, public.client_consent_campaign_items to authenticated;
create policy client_consent_campaigns_select on public.client_consent_campaigns
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));
create policy client_consent_campaign_items_select on public.client_consent_campaign_items
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('clients.view')));

-- The campaigns with their counts (Paramètres → Consentements).
create view public.client_consent_campaigns_summary with (security_invoker = true) as
select c.org_id, c.id, c.consent_key, c.state, c.total, c.created_by, c.created_at, c.finished_at,
       pg_catalog.count(i.id) filter (where i.state in ('queued', 'sending')) as queued,
       pg_catalog.count(i.id) filter (where i.state = 'sent') as sent,
       pg_catalog.count(i.id) filter (where i.state = 'failed') as failed,
       pg_catalog.count(i.id) filter (where i.state = 'skipped') as skipped
  from public.client_consent_campaigns c
  left join public.client_consent_campaign_items i on i.org_id = c.org_id and i.campaign_id = c.id
 group by c.org_id, c.id;
revoke all on public.client_consent_campaigns_summary from anon, authenticated;
grant select on public.client_consent_campaigns_summary to authenticated;

-- -----------------------------------------------------------------------------
-- Staff RPCs (clients.manage)
-- -----------------------------------------------------------------------------
-- Starts a campaign for p_consent_key; returns { campaign_id, total }. P0001: the module reserved
-- (HINT module_reserved), an unknown consent (consent_key), no text published (template), one
-- already running (running), nobody to ask (empty).
create function public.start_client_consent_campaign(p_consent_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_id uuid;
  v_total int;
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  if not public.module_open_to_all_for_org(v_org, 'clients') then
    raise exception 'Le module Clients est réservé aux testeurs : aucune demande ne part aux clients avant son ouverture à tous.'
      using errcode = 'P0001', hint = 'module_reserved';
  end if;
  if not exists (select 1 from public.client_consent_types t where t.org_id = v_org and t.key = p_consent_key and t.is_active) then
    raise exception 'Ce consentement n''existe pas.' using errcode = 'P0001', hint = 'consent_key';
  end if;
  if not exists (select 1 from public.document_templates t
                   join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
                  where t.org_id = v_org and t.is_active and t.key in ('clients.consent_' || p_consent_key || '_fr', 'clients.consent_' || p_consent_key || '_en')) then
    raise exception 'Le texte de ce consentement n''est pas encore publié : publiez-le dans Paramètres → Consentements.'
      using errcode = 'P0001', hint = 'template';
  end if;
  if exists (select 1 from public.client_consent_campaigns c where c.org_id = v_org and c.consent_key = p_consent_key and c.state = 'running') then
    raise exception 'Une campagne de nouvelles signatures est déjà en cours pour ce consentement.' using errcode = 'P0001', hint = 'running';
  end if;

  insert into public.client_consent_campaigns (org_id, consent_key, created_by)
  values (v_org, p_consent_key, auth.uid())
  returning id into v_id;
  -- Every active file whose consent in force is not a version published now, with no request out.
  with targets as (
    select k.id as consent_id, k.client_id
      from public.client_consents k
      join public.clients c on c.org_id = k.org_id and c.id = k.client_id
     where k.org_id = v_org and k.consent_key = p_consent_key
       and k.superseded_at is null and k.withdrawn_at is null
       and c.archived_at is null and c.anonymized_at is null and c.merged_into_id is null
       and (k.template_version_id is null or not exists (
             select 1 from public.document_template_versions v
               join public.document_templates t on t.id = v.template_id
              where v.id = k.template_version_id and v.status = 'published'))
       and not exists (select 1 from public.client_consent_requests r
                        where r.org_id = k.org_id and r.client_id = k.client_id and r.consent_key = k.consent_key and r.state = 'pending')
  ), flagged as (
    update public.client_consents k set resign_requested_at = pg_catalog.now()
      from targets x where k.id = x.consent_id and k.resign_requested_at is null
    returning k.id
  ), items as (
    insert into public.client_consent_campaign_items (org_id, campaign_id, client_id)
    select v_org, v_id, x.client_id from targets x
    on conflict do nothing
    returning id
  )
  -- `flagged` runs whether read or not (a data-modifying WITH always does).
  select pg_catalog.count(*) into v_total from items;
  if v_total = 0 then
    raise exception 'Tous les clients actifs ont déjà signé la version en vigueur de ce consentement, ou une demande leur est déjà envoyée.'
      using errcode = 'P0001', hint = 'empty';
  end if;
  update public.client_consent_campaigns c set total = v_total where c.id = v_id;
  return pg_catalog.jsonb_build_object('campaign_id', v_id, 'total', v_total);
end;
$$;

-- « Arrêter la campagne »: the queued items are skipped; what was sent stays.
create function public.cancel_client_consent_campaign(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
begin
  if not private.has_permission('clients.manage') then
    raise exception 'Permission refusée : clients.manage' using errcode = '42501';
  end if;
  update public.client_consent_campaigns c
     set state = 'cancelled', finished_at = pg_catalog.now(), cancelled_by = auth.uid()
   where c.org_id = v_org and c.id = p_id and c.state = 'running';
  if not found then
    raise exception 'Cette campagne n''est plus en cours.' using errcode = 'P0001', hint = 'state';
  end if;
  update public.client_consent_campaign_items i set state = 'skipped', processed_at = pg_catalog.now()
   where i.org_id = v_org and i.campaign_id = p_id and i.state = 'queued';
end;
$$;

-- -----------------------------------------------------------------------------
-- The job's RPCs (service role: clients-consent-campaign)
-- -----------------------------------------------------------------------------
-- Claims the items to send now: what is left of the clinic's 100 a day (its clinic day), oldest
-- first, of running campaigns; each `sending`. An item `sending` for over an hour is queued again
-- first. Nothing while Clients is reserved for its testers (P3-40). Returns
-- [{ item_id, client_id, consent_key, actor }].
create function public.client_consent_campaign_batch_for_service(p_org_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily constant int := 100;
  v_tz text;
  v_used int;
  v_take int;
  v_out jsonb;
begin
  if p_org_id is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  update public.client_consent_campaign_items i set state = 'queued', processed_at = null
   where i.org_id = p_org_id and i.state = 'sending' and i.processed_at < pg_catalog.now() - interval '1 hour';
  if not public.module_enabled_for_org(p_org_id, 'clients') or not public.module_open_to_all_for_org(p_org_id, 'clients') then
    return '[]'::jsonb;
  end if;
  v_tz := coalesce((select o.timezone from public.organizations o where o.id = p_org_id), 'America/Toronto');
  select pg_catalog.count(*) into v_used
    from public.client_consent_campaign_items i
   where i.org_id = p_org_id and i.state in ('sending', 'sent', 'failed')
     and i.processed_at >= ((pg_catalog.now() at time zone v_tz)::date)::timestamp at time zone v_tz;
  v_take := least(p_limit, v_daily - v_used);
  if v_take <= 0 then
    return '[]'::jsonb;
  end if;
  with due as (
    select i.id from public.client_consent_campaign_items i
      join public.client_consent_campaigns c on c.org_id = i.org_id and c.id = i.campaign_id and c.state = 'running'
     where i.org_id = p_org_id and i.state = 'queued'
     order by i.created_at, i.id
     limit v_take
     for update of i skip locked
  ), claimed as (
    update public.client_consent_campaign_items i set state = 'sending', processed_at = pg_catalog.now()
      from due where i.id = due.id
    returning i.id, i.client_id, i.campaign_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'item_id', x.id, 'client_id', x.client_id, 'consent_key', c.consent_key, 'actor', c.created_by)), '[]'::jsonb)
    into v_out
    from claimed x join public.client_consent_campaigns c on c.id = x.campaign_id;
  return v_out;
end;
$$;

-- An item's outcome: `sent` (its request) or `failed` (the refusal's HINT); the campaign `done`
-- once nothing is left to send.
create function public.finish_client_consent_campaign_item_for_service(
  p_org_id uuid, p_item_id uuid, p_sent boolean, p_request_id uuid default null, p_failure text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  if p_org_id is null or p_item_id is null or p_sent is null then
    raise exception 'Invalid arguments' using errcode = '22023';
  end if;
  update public.client_consent_campaign_items i
     set state = case when p_sent then 'sent' else 'failed' end,
         request_id = case when p_sent then p_request_id end,
         failure = case when p_sent then null
                        when p_failure ~ '^[a-z_]{1,40}$' then p_failure else 'other' end,
         processed_at = pg_catalog.now()
   where i.org_id = p_org_id and i.id = p_item_id and i.state = 'sending'
  returning i.campaign_id into v_campaign;
  if v_campaign is null then
    return;
  end if;
  update public.client_consent_campaigns c set state = 'done', finished_at = pg_catalog.now()
   where c.id = v_campaign and c.state = 'running'
     and not exists (select 1 from public.client_consent_campaign_items i
                      where i.campaign_id = v_campaign and i.state in ('queued', 'sending'));
end;
$$;

revoke all on function
  public.start_client_consent_campaign(text),
  public.cancel_client_consent_campaign(uuid),
  public.client_consent_campaign_batch_for_service(uuid, int),
  public.finish_client_consent_campaign_item_for_service(uuid, uuid, boolean, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.start_client_consent_campaign(text), public.cancel_client_consent_campaign(uuid) to authenticated;
grant execute on function
  public.client_consent_campaign_batch_for_service(uuid, int),
  public.finish_client_consent_campaign_item_for_service(uuid, uuid, boolean, uuid, text)
to service_role;

-- -----------------------------------------------------------------------------
-- The job (function clients-consent-campaign, daily at 9 h clinic time, off until switched on)
-- -----------------------------------------------------------------------------
insert into public.scheduled_jobs
  (key, module_key, label, description, kind, function_name, sql_function, cron_job_name, local_hour, is_maintenance)
values
  ('clients.consent_campaign', 'clients', 'Campagne de nouvelles signatures',
   'Envoie chaque jour, à 100 clients au plus, les demandes de nouvelle signature d''une campagne lancée dans Paramètres → Consentements.',
   'function', 'clients-consent-campaign', null, 'clients.consent_campaign', 9, false)
on conflict do nothing;

select cron.schedule('clients.consent_campaign', '15 * * * *',
  $$select private.invoke_job_function('clients.consent_campaign')$$);
