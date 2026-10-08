-- =============================================================================
-- Dated tax rates (TPS / TVQ)
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.3
-- A rate applies on [effective_from, effective_to). The open rate has
-- effective_to = null. Periods never overlap (exclusion constraint). Facturation
-- asks tax_rate_on(tax, date) and stores the applied rate on each invoice.
-- Writes only through add_tax_rate / delete_tax_rate (settings.manage).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  tax text not null check (tax in ('gst', 'qst')),
  rate numeric(7, 6) not null check (rate >= 0 and rate < 1),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  constraint tax_rates_period_check check (effective_to is null or effective_to > effective_from),
  constraint tax_rates_no_overlap exclude using gist (
    org_id with =,
    tax with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);
-- The exclusion index leads with org_id, but keep a plain one for the FK invariant and lookups.
create index tax_rates_org_id_idx on public.tax_rates (org_id, tax, effective_from);
create index tax_rates_created_by_idx on public.tax_rates (created_by);

revoke all on public.tax_rates from anon, authenticated;
grant select on public.tax_rates to authenticated;
alter table public.tax_rates enable row level security;

-- Every member of the org: invoices and receipts need the rates.
create policy tax_rates_select on public.tax_rates
  for select to authenticated
  using (org_id = (select private.current_user_org_id()));

create trigger tax_rates_audit
  after insert or update or delete on public.tax_rates
  for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Defaults for every organization: GST 5 % (2008) and QST 9.975 % (2013)
-- -----------------------------------------------------------------------------
create function private.seed_org_tax_rates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tax_rates (org_id, tax, rate, effective_from) values
    (new.id, 'gst', 0.05,    date '2008-01-01'),
    (new.id, 'qst', 0.09975, date '2013-01-01');
  return null;
end;
$$;

create trigger organizations_seed_tax_rates
  after insert on public.organizations
  for each row execute function private.seed_org_tax_rates();

revoke all on function private.seed_org_tax_rates() from public, anon, authenticated, service_role;

-- Existing organizations (staging): same defaults, audited as this migration.
select pg_catalog.set_config('app.audit_source', 'migration:core_tax_rates', true);
insert into public.tax_rates (org_id, tax, rate, effective_from)
select o.id, d.tax, d.rate, d.effective_from
  from public.organizations o
 cross join (values ('gst', 0.05, date '2008-01-01'), ('qst', 0.09975, date '2013-01-01')) as d(tax, rate, effective_from)
 where not exists (select 1 from public.tax_rates t where t.org_id = o.id and t.tax = d.tax);
select pg_catalog.set_config('app.audit_source', '', true);

-- -----------------------------------------------------------------------------
-- Clinic-local date (the session runs in UTC)
-- -----------------------------------------------------------------------------
create function private.clinic_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (pg_catalog.now() at time zone o.timezone)::date
    from public.organizations o
   where o.id = private.current_user_org_id()
$$;
revoke all on function private.clinic_today() from public, anon;
grant execute on function private.clinic_today() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
-- The rate in force on a date for the caller's org (null when none).
create function public.tax_rate_on(p_tax text, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select t.rate
    from public.tax_rates t
   where t.org_id = (select private.current_user_org_id())
     and t.tax = p_tax
     and t.effective_from <= p_date
     and (t.effective_to is null or p_date < t.effective_to)
$$;

-- Appends a rate: closes the open one on p_effective_from.
create function public.add_tax_rate(p_tax text, p_rate numeric, p_effective_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_open public.tax_rates;
  v_id uuid;
  -- Rounded first, so the check below sees the value the numeric(7,6) column stores
  -- (0.9999995 would otherwise pass and fail the table check as 23514).
  v_rate numeric := round(p_rate, 6);
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;
  if p_tax is null or p_tax not in ('gst', 'qst') then
    raise exception 'Taxe inconnue : %', p_tax using errcode = '22023';
  end if;
  if v_rate is null or v_rate < 0 or v_rate >= 1 then
    raise exception 'Le taux doit être d''au moins 0 %% et de moins de 100 %%.' using errcode = 'P0001';
  end if;
  if p_effective_from is null then
    raise exception 'La date d''entrée en vigueur est requise.' using errcode = 'P0001';
  end if;

  -- One writer per org at a time.
  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_open
    from public.tax_rates t
   where t.org_id = v_org and t.tax = p_tax and t.effective_to is null;

  if v_open.id is not null then
    if p_effective_from <= v_open.effective_from then
      raise exception 'Le nouveau taux doit commencer après le %.', pg_catalog.to_char(v_open.effective_from, 'YYYY-MM-DD')
        using errcode = 'P0001';
    end if;
    update public.tax_rates t set effective_to = p_effective_from where t.id = v_open.id;
  end if;

  insert into public.tax_rates (org_id, tax, rate, effective_from, created_by)
  values (v_org, p_tax, v_rate, p_effective_from, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Removes the last (open) rate and reopens the previous one. Allowed when the rate
-- is not in force yet, or was created less than 24 hours ago: the window to fix a
-- typo, including on a back-dated rate (in force as soon as it is added).
-- Never allowed on a tax's first rate (nothing to reopen: the tax would be left
-- with no rate, e.g. a freshly seeded default still inside the window).
create function public.delete_tax_rate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_row public.tax_rates;
  v_reopened int;
begin
  if not private.has_permission('settings.manage') then
    raise exception 'Permission refusée : settings.manage' using errcode = '42501';
  end if;

  perform 1 from public.organizations o where o.id = v_org for no key update;

  select * into v_row from public.tax_rates t where t.id = p_id and t.org_id = v_org;
  if v_row.id is null then
    raise exception 'Taux introuvable.' using errcode = 'P0001';
  end if;
  if v_row.effective_to is not null then
    raise exception 'Seul le dernier taux peut être supprimé.' using errcode = 'P0001';
  end if;
  -- coalesce(…, false): a null (no clinic date) never lets a delete through.
  if not coalesce(v_row.effective_from > private.clinic_today(), false)
     and not coalesce(v_row.created_at > pg_catalog.now() - interval '24 hours', false) then
    raise exception 'Un taux déjà en vigueur ne peut pas être supprimé.' using errcode = 'P0001';
  end if;
  -- The previous rate must end exactly where this one starts (also refuses a gap).
  if not exists (
    select 1 from public.tax_rates t
     where t.org_id = v_org and t.tax = v_row.tax and t.effective_to = v_row.effective_from
  ) then
    raise exception 'Le premier taux d''une taxe ne peut pas être supprimé.' using errcode = 'P0001';
  end if;

  delete from public.tax_rates t where t.id = v_row.id;
  update public.tax_rates t
     set effective_to = null
   where t.org_id = v_org and t.tax = v_row.tax and t.effective_to = v_row.effective_from;
  get diagnostics v_reopened = row_count;
  -- Assertion: the check above guarantees exactly one row (the exclusion
  -- constraint forbids two). Never left with no open rate.
  if v_reopened <> 1 then
    raise exception 'L''historique des taux est incohérent ; contactez le soutien technique.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function
  public.tax_rate_on(text, date),
  public.add_tax_rate(text, numeric, date),
  public.delete_tax_rate(uuid)
from public, anon, authenticated;
grant execute on function
  public.tax_rate_on(text, date),
  public.add_tax_rate(text, numeric, date),
  public.delete_tax_rate(uuid)
to authenticated, service_role;
