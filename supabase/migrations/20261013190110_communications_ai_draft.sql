-- =============================================================================
-- Module Communications, batch CM4: « Rédiger avec l'IA »
-- =============================================================================
-- Plan:      docs/plans/2026-10-11-modules-coding-plan.md §11 (CM4); PS Hub's « Rédiger avec l'IA »
--            (its prompt and its bar « Utiliser / Annuler / Raffiner », taken as is)
-- Decisions: CM-18 … CM-20 (decisions log)
--
-- * Permissions: `communications.ai_draft` (Conseillère, Adjointe, admin: the plan's A C J, given
--   since CC-15) and `communications.ai_manage` (admin: Paramètres → IA).
-- * `ai_settings` (one row per clinic, audited): switched on, the model (default `gpt-5.4`), the
--   monthly cap (default 50 $) and the prices per million tokens it counts the cost with. **Off
--   until the clinic enters its OpenAI key** (`openai_api_key`, an org secret through
--   SecretField) and switches it on.
-- * `ai_requests`: one row per call, **never the text**: who, when, the model, the kind, the
--   result, the tokens and the cost. An operational log (000_invariants lists why it is not
--   audited); read with `communications.ai_manage` (the month's use).
-- * `communications-draft` (the edge function) reads `ai_draft_context_for_service` (the actor's
--   permission, the settings, the month's spending, and the names it must hide from OpenAI: the
--   file's person, the sender, the clinic), then records the call (`record_ai_request_for_service`).
-- * The composer asks `get_ai_draft_status()` whether to show « Rédiger avec l'IA ».
-- P3-40 does not apply: drafting sends nothing (the send is gmail-send's, with its own guard).
-- =============================================================================
select pg_catalog.set_config('app.audit_source', 'migration:communications_ai_draft', true);

insert into public.permissions (key, module_key, description) values
  ('communications.ai_draft', 'communications', 'Rédiger des courriels avec l''IA'),
  ('communications.ai_manage', 'communications', 'Régler l''IA (clé, modèle, plafond mensuel)')
on conflict do nothing;
insert into public.role_permissions (role, permission_key) values
  ('admin', 'communications.ai_draft'),
  ('admin', 'communications.ai_manage'),
  ('counselor', 'communications.ai_draft'),
  ('admin_assistant', 'communications.ai_draft')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------
create table public.ai_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  model text not null default 'gpt-5.4',
  monthly_cap_cents int not null default 5000,
  input_cents_per_mtok numeric(10, 2) not null default 125,
  output_cents_per_mtok numeric(10, 2) not null default 1000,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  constraint ai_settings_model_check check (model ~ '^[a-z0-9][a-z0-9.:_-]{1,63}$'),
  constraint ai_settings_cap_check check (monthly_cap_cents between 0 and 1000000),
  constraint ai_settings_prices_check check (input_cents_per_mtok between 0 and 100000 and output_cents_per_mtok between 0 and 100000)
);
create index ai_settings_updated_by_idx on public.ai_settings (updated_by);
create trigger ai_settings_set_updated_at before update on public.ai_settings
  for each row execute function private.set_updated_at();
create trigger ai_settings_audit after insert or update or delete on public.ai_settings
  for each row execute function private.audit_trigger();
alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon, authenticated;
grant select on public.ai_settings to authenticated;
create policy ai_settings_select on public.ai_settings for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('communications.ai_manage')));

-- -----------------------------------------------------------------------------
-- The calls (never the text)
-- -----------------------------------------------------------------------------
create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  model text not null,
  kind text not null,
  status text not null,
  error_code text,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  cost_cents numeric(12, 4) not null default 0,
  constraint ai_requests_kind_check check (kind in ('write', 'reply', 'refine')),
  constraint ai_requests_status_check check (status in ('ok', 'failed')),
  constraint ai_requests_error_check check (error_code is null or error_code ~ '^[a-z_]{1,60}$'),
  constraint ai_requests_tokens_check check (prompt_tokens >= 0 and completion_tokens >= 0 and cost_cents >= 0)
);
create index ai_requests_org_created_idx on public.ai_requests (org_id, created_at desc);
create index ai_requests_user_idx on public.ai_requests (user_id);
alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon, authenticated;
grant select on public.ai_requests to authenticated;
create policy ai_requests_select on public.ai_requests for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('communications.ai_manage')));

-- The start of the clinic's month, and the month's spending in cents.
create function private.ai_month_start(p_org uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with z as (select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'America/Toronto') as tz)
  select pg_catalog.date_trunc('month', pg_catalog.now() at time zone z.tz) at time zone z.tz from z
$$;
revoke all on function private.ai_month_start(uuid) from public, anon, authenticated, service_role;

create function private.ai_month_spent_cents(p_org uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.cost_cents), 0)
    from public.ai_requests r
   where r.org_id = p_org and r.created_at >= private.ai_month_start(p_org)
$$;
revoke all on function private.ai_month_spent_cents(uuid) from public, anon, authenticated, service_role;

create function private.ai_key_configured(p_org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.org_secrets s where s.org_id = p_org and s.key = 'openai_api_key')
$$;
revoke all on function private.ai_key_configured(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Paramètres → IA (communications.ai_manage)
-- -----------------------------------------------------------------------------
create function public.get_ai_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  s public.ai_settings;
begin
  if not private.has_permission('communications.ai_manage') then
    raise exception 'Permission refusée : communications.ai_manage' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  select x.* into s from public.ai_settings x where x.org_id = v_org;
  return pg_catalog.jsonb_build_object(
    'enabled', coalesce(s.enabled, false),
    'model', coalesce(s.model, 'gpt-5.4'),
    'monthly_cap_cents', coalesce(s.monthly_cap_cents, 5000),
    'input_cents_per_mtok', coalesce(s.input_cents_per_mtok, 125),
    'output_cents_per_mtok', coalesce(s.output_cents_per_mtok, 1000),
    'key_configured', private.ai_key_configured(v_org),
    'month_requests', (select count(*)::int from public.ai_requests r
                        where r.org_id = v_org and r.created_at >= private.ai_month_start(v_org)),
    'month_spent_cents', private.ai_month_spent_cents(v_org),
    'updated_at', s.updated_at);
end;
$$;

create function public.set_ai_settings(p_enabled boolean, p_model text, p_monthly_cap_cents int,
                                       p_input_cents_per_mtok numeric, p_output_cents_per_mtok numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_model text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_model, '')));
begin
  if not private.has_permission('communications.ai_manage') then
    raise exception 'Permission refusée : communications.ai_manage' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  if v_model !~ '^[a-z0-9][a-z0-9.:_-]{1,63}$' then
    raise exception 'Le modèle s''écrit comme OpenAI le nomme (par exemple gpt-5.4).' using errcode = 'P0001', hint = 'model';
  end if;
  if p_monthly_cap_cents is null or p_monthly_cap_cents not between 0 and 1000000 then
    raise exception 'Le plafond mensuel est entre 0 $ et 10 000 $.' using errcode = 'P0001', hint = 'monthly_cap_cents';
  end if;
  if p_input_cents_per_mtok is null or p_output_cents_per_mtok is null
     or p_input_cents_per_mtok not between 0 and 100000 or p_output_cents_per_mtok not between 0 and 100000 then
    raise exception 'Les prix par million de jetons sont entre 0 $ et 1 000 $.' using errcode = 'P0001', hint = 'input_cents_per_mtok';
  end if;
  if coalesce(p_enabled, false) and not private.ai_key_configured(v_org) then
    raise exception 'Entrez d''abord la clé OpenAI de la clinique.' using errcode = 'P0001', hint = 'enabled';
  end if;
  insert into public.ai_settings (org_id, enabled, model, monthly_cap_cents, input_cents_per_mtok, output_cents_per_mtok, updated_by)
  values (v_org, coalesce(p_enabled, false), v_model, p_monthly_cap_cents, p_input_cents_per_mtok, p_output_cents_per_mtok, auth.uid())
  on conflict (org_id) do update
     set enabled = excluded.enabled, model = excluded.model, monthly_cap_cents = excluded.monthly_cap_cents,
         input_cents_per_mtok = excluded.input_cents_per_mtok, output_cents_per_mtok = excluded.output_cents_per_mtok,
         updated_by = excluded.updated_by;
end;
$$;

-- The composer: whether « Rédiger avec l'IA » is there (switched on, with a key, under the cap).
create function public.get_ai_draft_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  s public.ai_settings;
begin
  if not private.has_permission('communications.ai_draft') then
    raise exception 'Permission refusée : communications.ai_draft' using errcode = '42501';
  end if;
  v_org := private.current_user_org_id();
  select x.* into s from public.ai_settings x where x.org_id = v_org;
  return pg_catalog.jsonb_build_object(
    'available', coalesce(s.enabled, false) and private.ai_key_configured(v_org),
    'cap_reached', coalesce(s.enabled, false) and private.ai_month_spent_cents(v_org) >= s.monthly_cap_cents);
end;
$$;

revoke all on function public.get_ai_settings(), public.set_ai_settings(boolean, text, int, numeric, numeric),
  public.get_ai_draft_status() from public, anon;
grant execute on function public.get_ai_settings(), public.set_ai_settings(boolean, text, int, numeric, numeric),
  public.get_ai_draft_status() to authenticated;

-- -----------------------------------------------------------------------------
-- For the edge function (service role)
-- -----------------------------------------------------------------------------
-- The actor's right to draft, the settings, the month's spending, and the names to keep from
-- OpenAI: the file's person (named, or the thread's link, as gmail-send finds it; only while
-- Clients is on and she may read it), the sender, the clinic.
create function public.ai_draft_context_for_service(p_org_id uuid, p_actor uuid, p_client_id uuid, p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_keys text[] := private.permission_keys_for(p_actor);
  s public.ai_settings;
  v_client uuid := p_client_id;
  v_first text;
  v_last text;
  v_sender text;
  v_clinic text;
begin
  if not ('communications.ai_draft' = any (v_keys))
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = p_org_id and p.status = 'active') then
    raise exception 'Permission refusée : communications.ai_draft' using errcode = '42501';
  end if;
  select x.* into s from public.ai_settings x where x.org_id = p_org_id;
  if v_client is null and p_thread_id is not null and 'clients.view' = any (v_keys) then
    select l.client_id into v_client
      from public.mail_thread_links l
      join public.mail_threads t on t.id = l.thread_id
     where l.thread_id = p_thread_id and t.org_id = p_org_id and l.status = 'linked';
  end if;
  if v_client is not null and 'clients.view' = any (v_keys) and public.module_enabled_for_org(p_org_id, 'clients') then
    select x.first_name, x.last_name into v_first, v_last
      from private.client_contacts_for(p_org_id, v_client, 'communications') x where x.is_self;
  end if;
  select p.display_name into v_sender from public.profiles p where p.user_id = p_actor;
  select o.name into v_clinic from public.organizations o where o.id = p_org_id;
  return pg_catalog.jsonb_build_object(
    'enabled', coalesce(s.enabled, false),
    'model', coalesce(s.model, 'gpt-5.4'),
    'monthly_cap_cents', coalesce(s.monthly_cap_cents, 5000),
    'input_cents_per_mtok', coalesce(s.input_cents_per_mtok, 125),
    'output_cents_per_mtok', coalesce(s.output_cents_per_mtok, 1000),
    'month_spent_cents', private.ai_month_spent_cents(p_org_id),
    'person', case when v_first is not null or v_last is not null
                   then pg_catalog.jsonb_build_object('first_name', v_first, 'last_name', v_last) end,
    'sender_name', v_sender,
    'clinic_name', v_clinic);
end;
$$;

create function public.record_ai_request_for_service(p_org_id uuid, p_actor uuid, p_model text, p_kind text, p_status text,
                                                      p_error_code text, p_prompt_tokens int, p_completion_tokens int,
                                                      p_cost_cents numeric)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_requests (org_id, user_id, model, kind, status, error_code, prompt_tokens, completion_tokens, cost_cents)
  values (p_org_id, p_actor, pg_catalog.left(coalesce(p_model, ''), 64), p_kind, p_status, p_error_code,
          greatest(coalesce(p_prompt_tokens, 0), 0), greatest(coalesce(p_completion_tokens, 0), 0), greatest(coalesce(p_cost_cents, 0), 0))
  returning id
$$;

revoke all on function public.ai_draft_context_for_service(uuid, uuid, uuid, uuid),
  public.record_ai_request_for_service(uuid, uuid, text, text, text, text, int, int, numeric) from public, anon, authenticated;
grant execute on function public.ai_draft_context_for_service(uuid, uuid, uuid, uuid),
  public.record_ai_request_for_service(uuid, uuid, text, text, text, text, int, int, numeric) to service_role;

select pg_catalog.set_config('app.audit_source', '', true);
